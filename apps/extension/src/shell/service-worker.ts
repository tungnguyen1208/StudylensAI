/** StudyLens Manifest V3 service worker. */

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
import { VideoActivationApi, VideoActivationApiError } from '../features/video-activation/api/video-activation-api';
import type { TranscriptCaptureRef } from '../shared/contracts/activation-handoff';

type SidePanelToggleRequest = { type: 'STUDYLENS_MANUAL_TOGGLE'; requestedState: 'on' | 'off' };
type SidePanelStateRequest = { type: 'STUDYLENS_GET_ACTIVATION_STATE' };
type SidePanelRetryRequest = { type: 'STUDYLENS_RETRY_OPERATION'; operation: string };
type LearningPreferencesGetRequest = { type: 'STUDYLENS_GET_LEARNING_PREFERENCES' };
type LearningPreferencesSaveRequest = { type: 'STUDYLENS_SAVE_LEARNING_PREFERENCES'; preferences: unknown };
type LearnerApprovedAudioStreamRequest = {
  streamId: string;
  tabId: number;
  youtubeVideoId: string;
  title: string;
  captureAttemptId: string;
};
type AudioSwitchRequest = { type: 'STUDYLENS_SWITCH_AUDIO_CAPTURE'; youtubeVideoId: string };
type AudioStopRequest = { type: 'STUDYLENS_STOP_AUDIO_CAPTURE' };
type AudioTimingRequest = { type: 'STUDYLENS_AUDIO_CHUNK_TIMING'; tabId: number; captureId: string; chunkIndex: number };

const relayableContentMessageTypes = new Set([
  'PLAYER_PLAYING', 'PLAYER_PAUSED', 'PLAYER_BUFFERING', 'PLAYER_SEEKED', 'PLAYER_ENDED',
  'ACTIVATION_ENABLED', 'ACTIVATION_DISABLED', 'VIDEO_CONTEXT_CHANGED', 'VIDEO_CONTEXT_UNAVAILABLE',
  'QUIZ_AVAILABLE', 'OPERATION_STATUS_CHANGED',
]);
const audioCaptureByTab = new Map<number, { capture: TranscriptCaptureRef; lastPlayerMs: number }>();
const pendingAudioCaptureByTab = new Map<number, { attemptId: string; youtubeVideoId: string; title: string }>();
const videoActivationApi = new VideoActivationApi();

chrome.runtime.onInstalled.addListener(() => {
  void Promise.all([ensureActivationDefault(), readLearningPreferences()]);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'STUDYLENS_RESOLVE_TAB_ID') {
    sendResponse({ tabId: sender.tab?.id });
    return;
  }
  if (isSidePanelStateRequest(message)) {
    void readActivationState().then((state) => sendResponse({ ...state, source: 'storageRestore', correlationId: crypto.randomUUID() }));
    return true;
  }
  if (isSidePanelToggleRequest(message)) {
    void toggleForActiveTab(message.requestedState).then(sendResponse);
    return true;
  }
  if (isLearningPreferencesGetRequest(message)) {
    void readLearningPreferences().then(
      (preferences) => sendResponse({ ok: true, preferences }),
      () => sendResponse({ ok: false, code: 'learningPreferencesUnavailable' }),
    );
    return true;
  }
  if (isLearningPreferencesSaveRequest(message)) {
    void writeLearningPreferences(message.preferences).then(
      (preferences) => sendResponse({ ok: true, preferences }),
      (error: unknown) => sendResponse({
        ok: false,
        code: error instanceof LearningPreferencesValidationError
          ? 'invalidLearningPreferences'
          : 'learningPreferencesUnavailable',
      }),
    );
    return true;
  }
  if (isSidePanelRetryRequest(message)) {
    void retryOperationForActiveTab(message.operation).then(sendResponse);
    return true;
  }
  if (message?.type === 'STUDYLENS_GET_AUDIO_CAPTURE_TARGET') {
    void getActiveAudioCaptureTarget().then(sendResponse);
    return true;
  }
  if (isLearnerApprovedAudioStreamRequest(message)) {
    void startLearnerApprovedAudioCapture(message).then(sendResponse, (error: unknown) => sendResponse(captureStartFailure(error)));
    return true;
  }
  if (isAudioSwitchRequest(message) && sender.tab?.id) {
    void switchAudioCapture(sender.tab.id, message.youtubeVideoId).then(sendResponse, (error: unknown) => sendResponse(audioFailure(error)));
    return true;
  }
  if (isAudioStopRequest(message) && sender.tab?.id) {
    void stopAudioCapture(sender.tab.id).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (isAudioTimingRequest(message)) {
    void resolveChunkTiming(message).then(sendResponse);
    return true;
  }
  if (message?.type === 'STUDYLENS_AUDIO_TRANSCRIPTION_PROGRESS' || message?.type === 'STUDYLENS_AUDIO_TRANSCRIPTION_STATUS') {
    const targetTabId = Number(message.tabId);
    if (Number.isInteger(targetTabId)) {
      void chrome.tabs.sendMessage(targetTabId, message).catch(() => undefined);
      void chrome.runtime.sendMessage(message).catch(() => undefined);
    }
    return;
  }
  if (!sender.tab?.id || !isRelayableContentMessage(message)) return;

  void chrome.runtime.sendMessage(message).catch(() => {
    // A closed Side Panel must never affect YouTube playback.
  });
});

async function ensureActivationDefault(): Promise<PersistedActivationState> {
  return loadPersistedActivationState(extensionLocalStorage());
}

async function readActivationState(): Promise<PersistedActivationState> {
  return ensureActivationDefault();
}

function extensionLocalStorage(): LocalStoragePort {
  return chrome.storage.local as unknown as LocalStoragePort;
}

async function readLearningPreferences(): Promise<LearningPreferences> {
  return loadLearningPreferences(extensionLocalStorage());
}

async function writeLearningPreferences(value: unknown): Promise<LearningPreferences> {
  return saveLearningPreferences(extensionLocalStorage(), value);
}

async function toggleForActiveTab(requestedState: 'on' | 'off') {
  const state = await savePersistedActivationState(extensionLocalStorage(), requestedState === 'on');

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://www.youtube.com/')) {
    return { ok: true, pendingPageCapture: requestedState === 'on', state };
  }
  try {
    await ensureContentScriptReady(tab.id);
    if (requestedState === 'off') {
      await stopAudioCapture(tab.id);
    }
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'ACTIVATION_TOGGLE_REQUEST',
      requestedState,
      source: 'user',
      correlationId: crypto.randomUUID(),
    }) as { ok?: boolean; code?: string } | undefined;
    return { ok: result?.ok !== false, code: result?.code, state };
  } catch {
    // Content scripts are not reinjected into tabs that were already open when
    // an unpacked extension is reloaded. Keep the learner's ON choice, but let
    // the Side Panel explain that the current YouTube tab must be reloaded.
    return {
      ok: true,
      pendingPageCapture: requestedState === 'on',
      ...(requestedState === 'on' ? { code: 'contentScriptUnavailable' } : {}),
      state,
    };
  }
}

async function retryOperationForActiveTab(operation: string) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://www.youtube.com/')) return { ok: false, code: 'youtubeTabUnavailable' };
  if (operation === 'audioTranscription') return retryPendingAudioCapture(tab.id);
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'OPERATION_RETRY_REQUEST',
      contractVersion: '0.3.0',
      correlationId: crypto.randomUUID(),
      tabId: tab.id,
      youtubeVideoId: '',
      occurredAtUtc: new Date().toISOString(),
      payload: { operation },
    });
    return { ok: true };
  } catch {
    return { ok: false, code: 'contentScriptUnavailable' };
  }
}

async function getActiveAudioCaptureTarget(): Promise<{ tabId: number; youtubeVideoId: string; title: string } | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const youtubeVideoId = tab?.url ? supportedYoutubeVideoId(tab.url) : null;
  return tab?.id && youtubeVideoId ? { tabId: tab.id, youtubeVideoId, title: tab.title ?? '' } : null;
}

async function startLearnerApprovedAudioCapture(request: LearnerApprovedAudioStreamRequest): Promise<{ ok: boolean; capture?: TranscriptCaptureRef; code?: string; message?: string }> {
  const target = await getActiveAudioCaptureTarget();
  if (!target || target.tabId !== request.tabId || target.youtubeVideoId !== request.youtubeVideoId) {
    return { ok: false, code: 'tabCaptureTargetChanged', message: 'Tab hoặc video đã thay đổi. Hãy bấm Bắt đầu thu âm tab lại.' };
  }
  const existing = audioCaptureByTab.get(request.tabId);
  if (existing?.capture.youtubeVideoId === request.youtubeVideoId) return { ok: true, capture: existing.capture };
  await ensureAudioOffscreenDocument();
  const consumed = await chrome.runtime.sendMessage({
    type: 'STUDYLENS_AUDIO_STREAM_CONSUME', streamId: request.streamId, tabId: request.tabId,
    youtubeVideoId: request.youtubeVideoId, captureAttemptId: request.captureAttemptId,
  }) as { ok?: boolean; code?: string; message?: string } | undefined;
  if (!consumed?.ok) throw new Error(consumed?.message ?? consumed?.code ?? 'tabCaptureUnavailable');
  pendingAudioCaptureByTab.set(request.tabId, {
    attemptId: request.captureAttemptId,
    youtubeVideoId: request.youtubeVideoId,
    title: request.title,
  });
  return bindPendingAudioCapture(request.tabId);
}

async function retryPendingAudioCapture(tabId: number): Promise<{ ok: boolean; capture?: TranscriptCaptureRef; code?: string; message?: string }> {
  if (!pendingAudioCaptureByTab.has(tabId)) {
    return { ok: false, code: 'tabCapturePermissionDenied', message: 'Hãy bấm Bắt đầu thu âm tab để cấp quyền lại.' };
  }
  try {
    return await bindPendingAudioCapture(tabId);
  } catch (error: unknown) {
    return audioFailure(error);
  }
}

async function bindPendingAudioCapture(tabId: number): Promise<{ ok: true; capture: TranscriptCaptureRef }> {
  const pending = pendingAudioCaptureByTab.get(tabId);
  if (!pending) throw new Error('tabCaptureUnavailable');
  await publishAudioStatus(tabId, pending.youtubeVideoId, {
    operation: 'audioTranscription', state: 'pending', message: 'Đang tạo transcript cho âm thanh tab.', retryable: false,
  });
  let capture: TranscriptCaptureRef;
  try {
    capture = await videoActivationApi.createTranscriptCapture({
      idempotencyKey: `capture:${tabId}:${pending.youtubeVideoId}:${pending.attemptId}`,
      youtubeVideoId: pending.youtubeVideoId,
    });
  } catch (error: unknown) {
    const failure = captureStartFailure(error);
    await publishAudioStatus(tabId, pending.youtubeVideoId, {
      operation: 'audioTranscription', state: 'failed', code: failure.code, message: failure.message, retryable: true,
    });
    throw error;
  }
  const currentTimeMs = await readPlayerTime(tabId);
  const response = await chrome.runtime.sendMessage({
    type: 'STUDYLENS_AUDIO_CAPTURE_BIND', tabId, captureId: capture.transcriptCaptureId, youtubeVideoId: pending.youtubeVideoId,
  }) as { ok?: boolean; code?: string; message?: string } | undefined;
  if (!response?.ok) throw new Error(response?.message ?? response?.code ?? 'tabCaptureUnavailable');
  audioCaptureByTab.set(tabId, { capture, lastPlayerMs: currentTimeMs });
  pendingAudioCaptureByTab.delete(tabId);
  await chrome.tabs.sendMessage(tabId, {
    type: 'STUDYLENS_AUDIO_CAPTURE_READY', youtubeVideoId: pending.youtubeVideoId, capture,
  }).catch(() => undefined);
  return { ok: true, capture };
}

async function switchAudioCapture(tabId: number, youtubeVideoId: string): Promise<{ ok: true; capture: TranscriptCaptureRef }> {
  const existing = audioCaptureByTab.get(tabId);
  if (!existing) throw new Error('tabCapturePermissionDenied');
  if (existing.capture.youtubeVideoId === youtubeVideoId) return { ok: true, capture: existing.capture };
  pendingAudioCaptureByTab.set(tabId, { attemptId: crypto.randomUUID(), youtubeVideoId, title: '' });
  const capture = await videoActivationApi.createTranscriptCapture({
    idempotencyKey: `capture:${tabId}:${youtubeVideoId}:${pendingAudioCaptureByTab.get(tabId)!.attemptId}`,
    youtubeVideoId,
  });
  const currentTimeMs = await readPlayerTime(tabId);
  const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_AUDIO_CAPTURE_SWITCH', tabId, captureId: capture.transcriptCaptureId, youtubeVideoId }) as { ok?: boolean; code?: string; message?: string } | undefined;
  if (!response?.ok) throw new Error(response?.message ?? response?.code ?? 'tabCaptureUnavailable');
  audioCaptureByTab.set(tabId, { capture, lastPlayerMs: currentTimeMs });
  pendingAudioCaptureByTab.delete(tabId);
  await chrome.tabs.sendMessage(tabId, { type: 'STUDYLENS_AUDIO_CAPTURE_READY', youtubeVideoId, capture }).catch(() => undefined);
  return { ok: true, capture };
}

async function stopAudioCapture(tabId: number): Promise<void> {
  audioCaptureByTab.delete(tabId);
  pendingAudioCaptureByTab.delete(tabId);
  await chrome.runtime.sendMessage({ type: 'STUDYLENS_AUDIO_CAPTURE_STOP', tabId }).catch(() => undefined);
}

async function publishAudioStatus(tabId: number, youtubeVideoId: string, payload: {
  operation: 'audioTranscription'; state: 'pending' | 'succeeded' | 'failed'; code?: string; message: string; retryable: boolean;
}): Promise<void> {
  await chrome.tabs.sendMessage(tabId, {
    type: 'STUDYLENS_AUDIO_TRANSCRIPTION_STATUS', tabId, youtubeVideoId, payload,
  }).catch(() => undefined);
}

async function resolveChunkTiming(request: AudioTimingRequest): Promise<{ ok: boolean; startMs?: number; endMs?: number }> {
  const active = audioCaptureByTab.get(request.tabId);
  if (!active || active.capture.transcriptCaptureId !== request.captureId) return { ok: false };
  const endMs = await readPlayerTime(request.tabId);
  const startMs = active.lastPlayerMs;
  active.lastPlayerMs = endMs;
  return { ok: endMs > startMs, startMs, endMs };
}

async function readPlayerTime(tabId: number): Promise<number> {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: 'STUDYLENS_GET_PLAYER_TIME' }) as { currentTimeMs?: unknown };
    return typeof result?.currentTimeMs === 'number' && Number.isInteger(result.currentTimeMs) && result.currentTimeMs >= 0 ? result.currentTimeMs : 0;
  } catch { return 0; }
}

async function ensureAudioOffscreenDocument(): Promise<void> {
  const url = chrome.runtime.getURL('audio-capture.html');
  const runtime = chrome.runtime as unknown as { getContexts?: (filter: unknown) => Promise<unknown[]> };
  const contexts = await runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] }) ?? [];
  if (contexts.length) return;
  const offscreen = chrome.offscreen as unknown as { createDocument(input: unknown): Promise<void> };
  await offscreen.createDocument({
    url: 'audio-capture.html',
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Capture learner-approved YouTube tab audio and keep it audible during transcription.',
  });
}

function supportedYoutubeVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    const id = url.hostname === 'www.youtube.com' && url.pathname === '/watch' ? url.searchParams.get('v') : null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

function audioFailure(error: unknown): { ok: false; code: string; message: string } {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const code = message.includes('permission') || message.includes('denied') || message.includes('notallowed') ||
    message.includes('not been invoked') || message.includes('activetab')
    ? 'tabCapturePermissionDenied'
    : 'tabCaptureUnavailable';
  return {
    ok: false,
    code,
    message: code === 'tabCapturePermissionDenied'
      ? 'Chrome đã từ chối quyền thu âm tab. Hãy bấm Bắt đầu thu âm tab để cấp quyền lại.'
      : 'Không thể khởi tạo âm thanh của tab YouTube. Hãy tải lại tab rồi thử lại.',
  };
}

function captureStartFailure(error: unknown): { ok: false; code: string; message: string } {
  if (error instanceof VideoActivationApiError) {
    return {
      ok: false,
      code: 'transcriptCaptureCreateFailed',
      message: 'Không thể tạo transcript trên Backend. Bạn có thể thử lại mà không làm gián đoạn YouTube.',
    };
  }
  return audioFailure(error);
}

function isSidePanelToggleRequest(value: unknown): value is SidePanelToggleRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SidePanelToggleRequest>;
  return candidate.type === 'STUDYLENS_MANUAL_TOGGLE' &&
    (candidate.requestedState === 'on' || candidate.requestedState === 'off');
}

function isSidePanelStateRequest(value: unknown): value is SidePanelStateRequest {
  return Boolean(value) && typeof value === 'object' &&
    (value as Partial<SidePanelStateRequest>).type === 'STUDYLENS_GET_ACTIVATION_STATE';
}

function isSidePanelRetryRequest(value: unknown): value is SidePanelRetryRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SidePanelRetryRequest>;
  return candidate.type === 'STUDYLENS_RETRY_OPERATION' && typeof candidate.operation === 'string';
}

function isLearningPreferencesGetRequest(value: unknown): value is LearningPreferencesGetRequest {
  return Boolean(value) && typeof value === 'object' &&
    (value as Partial<LearningPreferencesGetRequest>).type === 'STUDYLENS_GET_LEARNING_PREFERENCES';
}

function isLearningPreferencesSaveRequest(value: unknown): value is LearningPreferencesSaveRequest {
  return Boolean(value) && typeof value === 'object' &&
    (value as Partial<LearningPreferencesSaveRequest>).type === 'STUDYLENS_SAVE_LEARNING_PREFERENCES';
}

function isLearnerApprovedAudioStreamRequest(value: unknown): value is LearnerApprovedAudioStreamRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LearnerApprovedAudioStreamRequest>;
  return typeof candidate.streamId === 'string' &&
    Number.isInteger(candidate.tabId) && typeof candidate.youtubeVideoId === 'string' &&
    typeof candidate.title === 'string' && typeof candidate.captureAttemptId === 'string';
}
function isAudioSwitchRequest(value: unknown): value is AudioSwitchRequest {
  return Boolean(value) && typeof value === 'object' && (value as Partial<AudioSwitchRequest>).type === 'STUDYLENS_SWITCH_AUDIO_CAPTURE' && typeof (value as Partial<AudioSwitchRequest>).youtubeVideoId === 'string';
}
function isAudioStopRequest(value: unknown): value is AudioStopRequest {
  return Boolean(value) && typeof value === 'object' && (value as Partial<AudioStopRequest>).type === 'STUDYLENS_STOP_AUDIO_CAPTURE';
}
function isAudioTimingRequest(value: unknown): value is AudioTimingRequest {
  return Boolean(value) && typeof value === 'object' && (value as Partial<AudioTimingRequest>).type === 'STUDYLENS_AUDIO_CHUNK_TIMING' && typeof (value as Partial<AudioTimingRequest>).tabId === 'number' && typeof (value as Partial<AudioTimingRequest>).captureId === 'string';
}

function isRelayableContentMessage(value: unknown): value is { type: string; contractVersion: '0.3.0'; tabId: number; youtubeVideoId: string } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<{ type: string; contractVersion: string; tabId: number; youtubeVideoId: string }>;
  return typeof candidate.type === 'string' && relayableContentMessageTypes.has(candidate.type) &&
    candidate.contractVersion === '0.3.0' && typeof candidate.tabId === 'number' &&
    typeof candidate.youtubeVideoId === 'string';
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !tab.url) return;

  // This is deliberately the first browser operation in the action callback.
  // Chrome grants tabCapture/activeTab only when the learner invokes the
  // extension action; a click inside an already-open Side Panel is not enough.
  const streamIdPromise = getActionApprovedTabStreamId(tab.id);
  void chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
  void startAudioCaptureFromExtensionAction(tab, streamIdPromise);
});

async function startAudioCaptureFromExtensionAction(tab: chrome.tabs.Tab, streamIdPromise: Promise<string>): Promise<void> {
  const youtubeVideoId = tab.url ? supportedYoutubeVideoId(tab.url) : null;
  if (!tab.id || !youtubeVideoId) return;

  try {
    const streamId = await streamIdPromise;
    await ensureContentScriptReady(tab.id);
    const state = await readActivationState();
    if (!state.enabled) return;

    const response = await startLearnerApprovedAudioCapture({
      streamId,
      tabId: tab.id,
      youtubeVideoId,
      title: tab.title ?? '',
      captureAttemptId: crypto.randomUUID(),
    });
    if (!response.ok) {
      await publishAudioStatus(tab.id, youtubeVideoId, {
        operation: 'audioTranscription',
        state: 'failed',
        code: response.code ?? 'tabCaptureUnavailable',
        message: response.message ?? 'Không thể bắt đầu thu âm tab YouTube.',
        retryable: response.code === 'transcriptCaptureCreateFailed',
      });
    }
  } catch (error: unknown) {
    const failure = audioFailure(error);
    await publishAudioStatus(tab.id, youtubeVideoId, {
      operation: 'audioTranscription',
      state: 'failed',
      code: failure.code,
      message: failure.message,
      retryable: false,
    });
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
    // A reload of an unpacked extension detaches its old content script. The
    // scoped host permission lets us attach the current bundled script again.
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-script.js'],
  });

  if (!await ping()) throw new Error('contentScriptUnavailable');
}

function getActionApprovedTabStreamId(targetTabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      const error = chrome.runtime.lastError;
      if (error || !streamId) {
        reject(new Error(error?.message ?? 'tabCaptureUnavailable'));
        return;
      }
      resolve(streamId);
    });
  });
}
