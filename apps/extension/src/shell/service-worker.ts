/** StudyLens Manifest V3 service worker: persistence and safe tab relay only. */

import {
  LearningPreferencesValidationError,
  loadLearningPreferences,
  saveLearningPreferences,
  type LearningPreferences,
  type LocalStoragePort,
} from '../features/video-activation/models/learning-preferences';
import {
  loadPersistedActivationState,
  savePersistedActivationState,
  type PersistedActivationState,
} from '../features/video-activation/models/persistent-activation';
import {
  PAGE_CAPTION_TRACKS_MESSAGE,
  sanitizePageCaptionTracks,
} from '../features/video-activation/services/youtube-page-caption-tracks';
import {
  handleSessionQuizRequest,
  SESSION_QUIZ_REQUEST_MESSAGE,
  type SessionQuizBackendPort,
} from '../features/session-quiz/api/session-quiz-worker-bridge';
import { httpClient } from '../shared/http/http-client';

type ToggleRequest = { type: 'STUDYLENS_MANUAL_TOGGLE'; requestedState: 'on' | 'off' };
type StateRequest = { type: 'STUDYLENS_GET_ACTIVATION_STATE' };
type RetryRequest = { type: 'STUDYLENS_RETRY_OPERATION'; operation: string };
type PreferencesGetRequest = { type: 'STUDYLENS_GET_LEARNING_PREFERENCES' };
type PreferencesSaveRequest = { type: 'STUDYLENS_SAVE_LEARNING_PREFERENCES'; preferences: unknown };
type PageCaptionTracksRequest = { type: typeof PAGE_CAPTION_TRACKS_MESSAGE; youtubeVideoId: string };
type ActiveYoutubeContextRequest = { type: 'STUDYLENS_GET_ACTIVE_YOUTUBE_CONTEXT' };
type ActivePlayerTimeRequest = { type: 'STUDYLENS_GET_ACTIVE_PLAYER_TIME' };
type ActiveSessionProgressRequest = { type: 'STUDYLENS_GET_ACTIVE_SESSION_PROGRESS' };
type ActiveLearningPackageRequest = { type: 'STUDYLENS_GET_ACTIVE_LEARNING_PACKAGE' };
type SeekActivePlayerRequest = { type: 'STUDYLENS_SEEK_ACTIVE_PLAYER'; youtubeVideoId: string; timestampMs: number };
type ActiveYoutubeContext = { tabId: number; youtubeVideoId: string; title: string };
const relayableMessageTypes = new Set([
  'PLAYER_PLAYING', 'PLAYER_PAUSED', 'PLAYER_BUFFERING', 'PLAYER_SEEKED', 'PLAYER_ENDED',
  'ACTIVATION_ENABLED', 'ACTIVATION_DISABLED', 'VIDEO_CONTEXT_CHANGED', 'VIDEO_CONTEXT_UNAVAILABLE',
  'QUIZ_AVAILABLE', 'OPERATION_STATUS_CHANGED',
]);
const panelRefreshTimers = new Map<number, number>();
const sessionQuizBackend: SessionQuizBackendPort = {
  start: (request) => httpClient.post('api/sessions', request),
  complete: (sessionId, request) => httpClient.post(`api/sessions/${encodeURIComponent(sessionId)}/complete`, request),
  submitTranscript: (sessionId, request) => httpClient.put(`api/sessions/${encodeURIComponent(sessionId)}/transcript`, request),
  getLearningPackage: (sessionId) => httpClient.get(`api/sessions/${encodeURIComponent(sessionId)}/learning-package`),
  retry: (sessionId, request) => httpClient.post(`api/sessions/${encodeURIComponent(sessionId)}/retry`, request),
};

chrome.runtime.onInstalled.addListener(() => {
  void Promise.all([readActivationState(), readLearningPreferences()]);
});

// The Side Panel is global, so tell it to re-read its display context when the
// learner switches browser tabs. SPA A -> B navigation remains driven by the
// public VIDEO_CONTEXT_CHANGED event from the content script.
chrome.tabs.onActivated.addListener(() => {
  void chrome.runtime.sendMessage({ type: 'STUDYLENS_ACTIVE_TAB_CHANGED' }).catch(() => undefined);
});

// YouTube changes video URLs through SPA navigation and a normal page refresh
// recreates the content script. In either case, tell the global Side Panel to
// re-read context from the active tab rather than retaining a stale display.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (typeof changeInfo.url !== 'string' && changeInfo.status !== 'complete') return;
  if (!isYoutubeUrl(changeInfo.url ?? tab.url)) return;
  scheduleSidePanelContextRefresh(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if ((message as { type?: unknown })?.type === SESSION_QUIZ_REQUEST_MESSAGE) {
    void handleSessionQuizRequest(message, sender, sessionQuizBackend).then((response) => {
      if (response) sendResponse(response);
    });
    return true;
  }
  if (isPageCaptionTracksRequest(message)) {
    void readPageCaptionTracks(sender.tab, message.youtubeVideoId).then(sendResponse);
    return true;
  }
  if (isActiveYoutubeContextRequest(message)) {
    void readActiveYoutubeContext().then(sendResponse);
    return true;
  }
  if (isActivePlayerTimeRequest(message)) {
    void readActivePlayerTime().then(sendResponse);
    return true;
  }
  if (isActiveSessionProgressRequest(message)) {
    void readActiveSessionProgress().then(sendResponse);
    return true;
  }
  if (isActiveLearningPackageRequest(message)) {
    void readActiveLearningPackage().then(sendResponse);
    return true;
  }
  if (isSeekActivePlayerRequest(message)) {
    void seekActivePlayer(message.youtubeVideoId, message.timestampMs).then(sendResponse);
    return true;
  }
  if (message?.type === 'STUDYLENS_RESOLVE_TAB_ID') {
    sendResponse({ tabId: sender.tab?.id });
    return;
  }
  if (isStateRequest(message)) {
    void readActivationState().then((state) => sendResponse({ ...state, source: 'storageRestore', correlationId: crypto.randomUUID() }));
    return true;
  }
  if (isToggleRequest(message)) {
    void toggleForActiveTab(message.requestedState).then(sendResponse);
    return true;
  }
  if (isPreferencesGetRequest(message)) {
    void readLearningPreferences().then(
      (preferences) => sendResponse({ ok: true, preferences }),
      () => sendResponse({ ok: false, code: 'learningPreferencesUnavailable' }),
    );
    return true;
  }
  if (isPreferencesSaveRequest(message)) {
    void savePreferences(message.preferences).then(
      (preferences) => sendResponse({ ok: true, preferences }),
      (error: unknown) => sendResponse({
        ok: false,
        code: error instanceof LearningPreferencesValidationError ? 'invalidLearningPreferences' : 'learningPreferencesUnavailable',
      }),
    );
    return true;
  }
  if (isRetryRequest(message)) {
    void retryForActiveTab(message.operation).then(sendResponse);
    return true;
  }
  if (!sender.tab?.id || !isRelayableContentMessage(message)) return;
  void chrome.runtime.sendMessage(message).catch(() => undefined);
});

function storage(): LocalStoragePort {
  return chrome.storage.local as unknown as LocalStoragePort;
}

function scheduleSidePanelContextRefresh(tabId: number): void {
  const existing = panelRefreshTimers.get(tabId);
  if (existing !== undefined) clearTimeout(existing);
  const timer = setTimeout(() => {
    panelRefreshTimers.delete(tabId);
    void notifySidePanelIfActiveYoutubeTab(tabId);
  }, 300) as unknown as number;
  panelRefreshTimers.set(tabId, timer);
}

async function notifySidePanelIfActiveYoutubeTab(tabId: number): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id !== tabId || !isYoutubeUrl(activeTab.url)) return;
  await chrome.runtime.sendMessage({ type: 'STUDYLENS_ACTIVE_YOUTUBE_CONTEXT_CHANGED', tabId }).catch(() => undefined);
}

function readActivationState(): Promise<PersistedActivationState> {
  return loadPersistedActivationState(storage());
}

function readLearningPreferences(): Promise<LearningPreferences> {
  return loadLearningPreferences(storage());
}

function savePreferences(value: unknown): Promise<LearningPreferences> {
  return saveLearningPreferences(storage(), value);
}

async function toggleForActiveTab(requestedState: 'on' | 'off') {
  const state = await savePersistedActivationState(storage(), requestedState === 'on');
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !isYoutubeUrl(tab.url)) return { ok: true, pendingPageCapture: requestedState === 'on', state };
  try {
    await ensureContentScriptReady(tab.id);
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'ACTIVATION_TOGGLE_REQUEST', requestedState, source: 'user', correlationId: crypto.randomUUID(),
    }) as { ok?: boolean; code?: string } | undefined;
    return { ok: result?.ok !== false, code: result?.code, state };
  } catch {
    return {
      ok: true,
      pendingPageCapture: requestedState === 'on',
      ...(requestedState === 'on' ? { code: 'contentScriptUnavailable' } : {}),
      state,
    };
  }
}

async function retryForActiveTab(operation: string): Promise<{ ok: boolean; code?: string }> {
  if (operation === 'transcriptGenerate' || operation === 'quizGenerate') {
    const progress = await readActiveSessionProgress();
    const sessionId = sessionIdFromProgress(progress.state);
    if (!sessionId) return { ok: false, code: 'sessionRuntimeUnavailable' };
    try {
      await sessionQuizBackend.retry(sessionId, { contractVersion: '0.5.0', operation });
      return { ok: true };
    } catch (error) {
      return { ok: false, code: errorCode(error, 'retryFailed') };
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !isYoutubeUrl(tab.url)) return { ok: false, code: 'youtubeTabUnavailable' };
  try {
    await ensureContentScriptReady(tab.id);
    await chrome.tabs.sendMessage(tab.id, {
      type: 'OPERATION_RETRY_REQUEST', contractVersion: '0.5.0', correlationId: crypto.randomUUID(),
      tabId: tab.id, youtubeVideoId: '', occurredAtUtc: new Date().toISOString(), payload: { operation },
    });
    return { ok: true };
  } catch {
    return { ok: false, code: 'contentScriptUnavailable' };
  }
}

async function readActiveLearningPackage(): Promise<{ ok: boolean; learningPackage?: unknown; code?: string }> {
  const progress = await readActiveSessionProgress();
  const sessionId = sessionIdFromProgress(progress.state);
  if (!progress.ok || !sessionId) return { ok: false, code: progress.code ?? 'sessionRuntimeUnavailable' };
  try {
    return { ok: true, learningPackage: await sessionQuizBackend.getLearningPackage(sessionId) };
  } catch (error) {
    return { ok: false, code: errorCode(error, 'learningPackageUnavailable') };
  }
}

/** Reads title/ID only; opening the Side Panel never starts activation. */
async function readActiveYoutubeContext(): Promise<{ ok: boolean; context?: ActiveYoutubeContext; localTranscript?: unknown; code?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !isYoutubeUrl(tab.url)) return { ok: false, code: 'youtubeTabUnavailable' };

  try {
    await ensureContentScriptReady(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'STUDYLENS_GET_VIDEO_CONTEXT' }) as {
      ok?: unknown; context?: unknown; localTranscript?: unknown; code?: unknown;
    } | undefined;
    if (response?.ok === true && isActiveYoutubeContext(response.context, tab.id)) {
      return {
        ok: true,
        context: response.context,
        ...(isLocalTranscript(response.localTranscript) ? { localTranscript: response.localTranscript } : {}),
      };
    }
    return { ok: false, code: typeof response?.code === 'string' ? response.code : 'youtubeContextUnavailable' };
  } catch {
    return { ok: false, code: 'contentScriptUnavailable' };
  }
}

function isLocalTranscript(value: unknown): boolean {
  const transcript = value as { status?: unknown; language?: unknown; cues?: unknown } | undefined;
  return Boolean(transcript) &&
    (transcript?.status === 'available' || transcript?.status === 'unavailable' || transcript?.status === 'insufficient') &&
    typeof transcript.language === 'string' && Array.isArray(transcript.cues);
}

/** Internal Side Panel helper: read time only, without activating or altering playback. */
async function readActivePlayerTime(): Promise<{ ok: boolean; youtubeVideoId?: string; currentTimeMs?: number }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const youtubeVideoId = youtubeVideoIdFromUrl(tab?.url);
  if (!tab?.id || !youtubeVideoId) return { ok: false };
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'STUDYLENS_GET_PLAYER_TIME' }) as {
      currentTimeMs?: unknown;
    } | undefined;
    return typeof response?.currentTimeMs === 'number' && Number.isFinite(response.currentTimeMs)
      ? { ok: true, youtubeVideoId, currentTimeMs: Math.max(0, Math.round(response.currentTimeMs)) }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

async function readActiveSessionProgress(): Promise<{ ok: boolean; state?: unknown; code?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const youtubeVideoId = youtubeVideoIdFromUrl(tab?.url);
  if (!tab?.id || !youtubeVideoId) return { ok: false, code: 'youtubeTabUnavailable' };
  try {
    await ensureContentScriptReady(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'STUDYLENS_GET_SESSION_PROGRESS' }) as {
      ok?: unknown; state?: unknown; code?: unknown;
    } | undefined;
    return response?.ok === true ? { ok: true, state: response.state } : {
      ok: false,
      code: typeof response?.code === 'string' ? response.code : 'sessionRuntimeUnavailable',
    };
  } catch {
    return { ok: false, code: 'contentScriptUnavailable' };
  }
}

async function seekActivePlayer(youtubeVideoId: string, timestampMs: number): Promise<{ ok: boolean; code?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !youtubeUrlMatchesVideo(tab.url, youtubeVideoId) || !Number.isInteger(timestampMs) || timestampMs < 0) {
    return { ok: false, code: 'seekTargetUnavailable' };
  }
  try {
    await ensureContentScriptReady(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'STUDYLENS_SEEK_TO_TIMESTAMP', youtubeVideoId, timestampMs,
    }) as { ok?: unknown; code?: unknown } | undefined;
    return response?.ok === true ? { ok: true } : {
      ok: false,
      code: typeof response?.code === 'string' ? response.code : 'seekFailed',
    };
  } catch {
    return { ok: false, code: 'contentScriptUnavailable' };
  }
}

async function ensureContentScriptReady(tabId: number): Promise<void> {
  const ping = async (): Promise<boolean> => {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'STUDYLENS_CONTENT_SCRIPT_READY' }) as { ok?: unknown } | undefined;
    return response?.ok === true;
  };
  try {
    if (await ping()) return;
  } catch {
    // An unpacked Extension reload detaches the previous content script.
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
  if (!await ping()) throw new Error('contentScriptUnavailable');
}

function isYoutubeUrl(value: string | undefined): boolean {
  return Boolean(value?.startsWith('https://www.youtube.com/'));
}

function youtubeVideoIdFromUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    const videoId = url.protocol === 'https:' && url.hostname === 'www.youtube.com' && url.pathname === '/watch'
      ? url.searchParams.get('v')
      : null;
    return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
}

async function readPageCaptionTracks(
  tab: chrome.tabs.Tab | undefined,
  youtubeVideoId: string,
): Promise<{ ok: boolean; tracks?: unknown[]; code?: string }> {
  if (!tab?.id || !youtubeUrlMatchesVideo(tab.url, youtubeVideoId)) {
    return { ok: false, code: 'transcriptTargetChanged' };
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [youtubeVideoId],
      func: (expectedVideoId: string) => {
        const response = (globalThis as {
          ytInitialPlayerResponse?: { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] } } };
        }).ytInitialPlayerResponse;
        const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!Array.isArray(tracks)) return [];
        return tracks.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const value = item as { baseUrl?: unknown; languageCode?: unknown; kind?: unknown; name?: { simpleText?: unknown } };
          if (typeof value.baseUrl !== 'string' || typeof value.languageCode !== 'string') return [];
          try {
            if (new URL(value.baseUrl).searchParams.get('v') !== expectedVideoId) return [];
          } catch { return []; }
          return [{
            baseUrl: value.baseUrl,
            languageCode: value.languageCode,
            ...(typeof value.kind === 'string' ? { kind: value.kind } : {}),
            label: typeof value.name?.simpleText === 'string' ? value.name.simpleText : value.languageCode,
          }];
        });
      },
    });
    return { ok: true, tracks: sanitizePageCaptionTracks(results[0]?.result, youtubeVideoId) };
  } catch {
    return { ok: false, code: 'captionMetadataUnavailable' };
  }
}

function youtubeUrlMatchesVideo(value: string | undefined, youtubeVideoId: string): boolean {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && url.hostname === 'www.youtube.com' &&
      url.pathname === '/watch' && url.searchParams.get('v') === youtubeVideoId;
  } catch {
    return false;
  }
}

function isToggleRequest(value: unknown): value is ToggleRequest {
  const item = value as Partial<ToggleRequest>;
  return Boolean(item) && item.type === 'STUDYLENS_MANUAL_TOGGLE' && (item.requestedState === 'on' || item.requestedState === 'off');
}

function isStateRequest(value: unknown): value is StateRequest {
  return Boolean(value) && typeof value === 'object' && (value as Partial<StateRequest>).type === 'STUDYLENS_GET_ACTIVATION_STATE';
}

function isRetryRequest(value: unknown): value is RetryRequest {
  return Boolean(value) && typeof value === 'object' && (value as Partial<RetryRequest>).type === 'STUDYLENS_RETRY_OPERATION' && typeof (value as Partial<RetryRequest>).operation === 'string';
}

function isPreferencesGetRequest(value: unknown): value is PreferencesGetRequest {
  return Boolean(value) && typeof value === 'object' && (value as Partial<PreferencesGetRequest>).type === 'STUDYLENS_GET_LEARNING_PREFERENCES';
}

function isPreferencesSaveRequest(value: unknown): value is PreferencesSaveRequest {
  return Boolean(value) && typeof value === 'object' && (value as Partial<PreferencesSaveRequest>).type === 'STUDYLENS_SAVE_LEARNING_PREFERENCES';
}

function isPageCaptionTracksRequest(value: unknown): value is PageCaptionTracksRequest {
  return Boolean(value) && typeof value === 'object' &&
    (value as Partial<PageCaptionTracksRequest>).type === PAGE_CAPTION_TRACKS_MESSAGE &&
    typeof (value as Partial<PageCaptionTracksRequest>).youtubeVideoId === 'string' &&
    /^[A-Za-z0-9_-]{11}$/.test((value as Partial<PageCaptionTracksRequest>).youtubeVideoId ?? '');
}

function isActiveYoutubeContextRequest(value: unknown): value is ActiveYoutubeContextRequest {
  return Boolean(value) && typeof value === 'object' &&
    (value as Partial<ActiveYoutubeContextRequest>).type === 'STUDYLENS_GET_ACTIVE_YOUTUBE_CONTEXT';
}

function isActivePlayerTimeRequest(value: unknown): value is ActivePlayerTimeRequest {
  return Boolean(value) && typeof value === 'object' &&
    (value as Partial<ActivePlayerTimeRequest>).type === 'STUDYLENS_GET_ACTIVE_PLAYER_TIME';
}

function isActiveSessionProgressRequest(value: unknown): value is ActiveSessionProgressRequest {
  return Boolean(value) && typeof value === 'object' && (value as Partial<ActiveSessionProgressRequest>).type === 'STUDYLENS_GET_ACTIVE_SESSION_PROGRESS';
}

function isActiveLearningPackageRequest(value: unknown): value is ActiveLearningPackageRequest {
  return Boolean(value) && typeof value === 'object' &&
    (value as Partial<ActiveLearningPackageRequest>).type === 'STUDYLENS_GET_ACTIVE_LEARNING_PACKAGE';
}

function sessionIdFromProgress(value: unknown): string | null {
  const state = value as { sessionId?: unknown } | undefined;
  return typeof state?.sessionId === 'string' && state.sessionId.length > 0 ? state.sessionId : null;
}

function errorCode(error: unknown, fallback: string): string {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : fallback;
}

function isSeekActivePlayerRequest(value: unknown): value is SeekActivePlayerRequest {
  const item = value as Partial<SeekActivePlayerRequest>;
  return Boolean(item) && item.type === 'STUDYLENS_SEEK_ACTIVE_PLAYER' &&
    typeof item.youtubeVideoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(item.youtubeVideoId) &&
    typeof item.timestampMs === 'number' && Number.isInteger(item.timestampMs) && item.timestampMs >= 0;
}

function isActiveYoutubeContext(value: unknown, expectedTabId: number): value is ActiveYoutubeContext {
  const item = value as Partial<ActiveYoutubeContext>;
  return Boolean(item) && item.tabId === expectedTabId &&
    typeof item.youtubeVideoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(item.youtubeVideoId) &&
    typeof item.title === 'string' && item.title.trim().length > 0;
}

function isRelayableContentMessage(value: unknown): value is { type: string; contractVersion: '0.5.0'; tabId: number; youtubeVideoId: string; payload: unknown } {
  const item = value as Partial<{ type: string; contractVersion: string; tabId: number; youtubeVideoId: string; payload: unknown }>;
  return Boolean(item) && typeof item.type === 'string' && relayableMessageTypes.has(item.type) &&
    item.contractVersion === '0.5.0' && Number.isInteger(item.tabId) && typeof item.youtubeVideoId === 'string' && 'payload' in item;
}

if (chrome.sidePanel?.setPanelBehavior) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
}
