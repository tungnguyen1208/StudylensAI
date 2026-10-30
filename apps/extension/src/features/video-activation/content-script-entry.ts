import { captureLearningTarget, type LearningTargetCapture } from '../../platform/youtube/learning-target-capture';
import { createVideoActivationMessage } from '../../platform/youtube/youtube-events';
import { PlayerPort, YoutubePlayerAdapter } from '../../platform/youtube/youtube-player-adapter';
import { createBrowserYoutubeTranscriptAdapter, type TranscriptOrigin, type YoutubeTranscriptDomAdapter } from '../../platform/youtube/youtube-transcript-adapter';
import { isDomTranscriptComplete, type TranscriptReadResult } from '../../platform/youtube/transcript-reader';
import { messageBus } from '../../shared/messaging/message-bus';
import { type ExtensionMessage } from '../../shared/messaging/message-types';
import { operationFailure, type OperationStatusPayload } from '../../shared/messaging/operation-status';
import { DEFAULT_LEARNING_PREFERENCES, isLearningPreferences, type LearningPreferences } from './models/learning-preferences';
import { ACTIVATION_STORAGE_KEY, activationEnabledFromStorageChange } from './models/persistent-activation';
import { isAuthoritativeToggleState, scheduleStorageOnFallback } from './services/activation-toggle-authority';
import { ManualActivationManager } from './services/activation-manager';
import { stopLocalActivation } from './services/local-activation-stop';
import { LocalGateRevision } from './services/local-gate-revision';
import { TranscriptService } from './services/transcript-service';
import { continueAfterContextPublish } from './services/transition-safety';
import { PAGE_CAPTION_TRACKS_MESSAGE } from './services/youtube-page-caption-tracks';
import { createBrowserYoutubeSpaTransitionObserver, type YoutubeSpaTransitionObserver } from './services/youtube-spa-transition-observer';

const SESSION_WAIT_ATTEMPTS = 100;
const SESSION_WAIT_INTERVAL_MS = 100;
const DOM_FALLBACK_SETTLE_MS = 8_000;
const DOM_QUIET_PERIOD_MS = 1_500;
// A relay can spend 1.5s ensuring the script and 1.5s awaiting its response.
// Storage fallback must start after that explicit-user delivery window.
const STORAGE_ON_FALLBACK_DELAY_MS = 3_500;

export interface VideoActivationContentScriptOptions {
  tabId: number;
  publish?: (message: ExtensionMessage) => Promise<void>;
  getActiveSessionId?: (youtubeVideoId: string) => string | null;
  retrySessionStart?: () => Promise<boolean>;
}

export interface VideoActivationContentScriptController {
  getPlayerPort(): PlayerPort | null;
  retrySessionStart(): Promise<boolean>;
  dispose(): void;
}
type ToggleRequest = { type: 'ACTIVATION_TOGGLE_REQUEST'; requestedState: 'on' | 'off'; source: 'user' | 'storageRestore'; correlationId: string; };
type RetryRequest = { type: 'OPERATION_RETRY_REQUEST'; payload?: { operation?: string } };
type ActivationSource = 'user' | 'storageRestore';

/** Owns YouTube-only caption acquisition. It never captures audio or calls AI. */
export function initializeVideoActivationContentScript(options: VideoActivationContentScriptOptions): VideoActivationContentScriptController {
  const publish = options.publish ?? ((message) => messageBus.publish(message));
  const manager = new ManualActivationManager({ publish });
  const transcriptService = new TranscriptService();
  let player: YoutubePlayerAdapter | null = null;
  let transcript: YoutubeTranscriptDomAdapter | null = null;
  let observer: YoutubeSpaTransitionObserver | null = null;
  let activeId: string | null = null;
  let generation = 0;
  let enabled = false;
  let source: ActivationSource = 'user';
  let disposed = false;
  let fallbackTimer: number | null = null;
  let domDeadlineAt: number | null = null;
  let submittedGeneration: number | null = null;
  let latestTranscript: TranscriptReadResult | null = null;
  let activeTarget: LearningTargetCapture | null = null;
  let activeCorrelationId: string | null = null;
  let storageOnTimer: number | null = null;
  const gateRevision = new LocalGateRevision();

  const current = (id: string, value: number) => !disposed && enabled && activeId === id && generation === value;
  const publishStatus = (youtubeVideoId: string, correlationId: string, payload: OperationStatusPayload) => publish(createVideoActivationMessage('OPERATION_STATUS_CHANGED', payload, { correlationId, tabId: options.tabId, youtubeVideoId }));
  const clearFallbackTimer = () => {
    if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    fallbackTimer = null;
  };
  const disposePage = () => {
    generation += 1;
    clearFallbackTimer();
    domDeadlineAt = null;
    submittedGeneration = null;
    activeTarget = null;
    activeCorrelationId = null;
    player?.dispose();
    player = null;
    transcript?.dispose();
    transcript = null;
  };

  const waitForSessionId = async (youtubeVideoId: string, value: number): Promise<string | null> => {
    for (let attempt = 0; attempt < SESSION_WAIT_ATTEMPTS && current(youtubeVideoId, value); attempt += 1) {
      const sessionId = options.getActiveSessionId?.(youtubeVideoId) ?? null;
      if (sessionId) return sessionId;
      await new Promise<void>((resolve) => window.setTimeout(resolve, SESSION_WAIT_INTERVAL_MS));
    }
    return null;
  };

  const upload = async (target: LearningTargetCapture, correlationId: string, value: number, read: TranscriptReadResult) => {
    if (!current(target.youtubeVideoId, value) || submittedGeneration === value) return;
    submittedGeneration = value;
    await publishStatus(target.youtubeVideoId, correlationId, {
      operation: 'transcriptUpload',
      state: 'pending',
      message: read.status === 'available'
        ? 'Đang xác thực và lưu transcript YouTube.'
        : 'Đang chuyển sang bước tạo transcript dự phòng.',
      retryable: false,
    });
    try {
      const sessionId = await waitForSessionId(target.youtubeVideoId, value);
      if (!sessionId) throw new Error('activeSessionUnavailable');
      const learningPackage = await transcriptService.upload(sessionId, target.youtubeVideoId, read, player?.getDurationMs());
      if (!current(target.youtubeVideoId, value)) return;
      await publishStatus(target.youtubeVideoId, correlationId, {
        operation: 'transcriptUpload',
        state: 'succeeded',
        message: learningPackage.transcript.status === 'ready'
          ? 'Backend đã xác thực và lưu transcript YouTube.'
          : 'Backend đã nhận trạng thái phụ đề và đang xử lý dự phòng.',
        retryable: false,
      });
    } catch (error) {
      if (!current(target.youtubeVideoId, value)) return;
      submittedGeneration = null;
      await publishStatus(target.youtubeVideoId, correlationId, {
        operation: 'transcriptUpload',
        state: 'failed',
        ...operationFailure(error, 'transcriptUploadFailed', 'Không thể gửi transcript tới Backend. Bạn có thể thử lại.'),
      });
    }
  };

  const settleDom = (target: LearningTargetCapture, correlationId: string, value: number) => {
    if (!current(target.youtubeVideoId, value) || submittedGeneration === value) return;
    const read = latestTranscript;
    if (read?.status === 'available' && isDomTranscriptComplete(read.cues, player?.getDurationMs() ?? null)) {
      void upload(target, correlationId, value, read);
      return;
    }
    const remaining = (domDeadlineAt ?? Date.now()) - Date.now();
    if (remaining <= 0) {
      void upload(target, correlationId, value, {
        status: 'insufficient', language: read?.language ?? 'und', cues: [],
      });
      return;
    }
    fallbackTimer = window.setTimeout(() => settleDom(target, correlationId, value), Math.min(DOM_QUIET_PERIOD_MS, remaining));
  };

  const ingest = (target: LearningTargetCapture, correlationId: string, value: number, read: TranscriptReadResult, origin: TranscriptOrigin) => {
    if (!current(target.youtubeVideoId, value) || submittedGeneration === value) return;
    latestTranscript = read;
    clearFallbackTimer();
    if (origin === 'timedtext' && read.status === 'available') {
      void upload(target, correlationId, value, read);
      return;
    }
    // A transcript drawer can contain just the visible rows. Preview it now,
    // but submit it only after its time span has been checked against the video.
    domDeadlineAt ??= Date.now() + DOM_FALLBACK_SETTLE_MS;
    const remaining = domDeadlineAt - Date.now();
    fallbackTimer = window.setTimeout(() => settleDom(target, correlationId, value), Math.min(DOM_QUIET_PERIOD_MS, remaining));
  };

  const begin = async (
    target: LearningTargetCapture,
    correlationId: string,
    activationSource: ActivationSource,
    isReplacement = false,
  ) => {
    const value = generation + 1;
    generation = value;
    activeId = target.youtubeVideoId;
    activeTarget = target;
    activeCorrelationId = correlationId;
    source = activationSource;
    submittedGeneration = null;
    latestTranscript = null;
    clearFallbackTimer();
    domDeadlineAt = null;
    await manager.setContext({ tabId: options.tabId, youtubeVideoId: target.youtubeVideoId, title: target.title }, correlationId);
    if (!current(target.youtubeVideoId, value)) return;
    manager.setPreferences(await preferences());
    if (!current(target.youtubeVideoId, value)) return;
    await manager.request('on', target.youtubeVideoId, correlationId, activationSource);
    if (!current(target.youtubeVideoId, value)) return;
    player = new YoutubePlayerAdapter({
      getVideoElement: () => document.querySelector<HTMLVideoElement>('video.html5-main-video'),
      getCurrentYoutubeVideoId: () => {
        const targetNow = captureLearningTarget(window.location.href, document.title);
        return targetNow.status === 'supported' ? targetNow.target.youtubeVideoId : null;
      },
    }, target.youtubeVideoId, (event) => {
      if (current(target.youtubeVideoId, value)) void publish(createVideoActivationMessage(event.type, event.payload, { correlationId, tabId: options.tabId, youtubeVideoId: target.youtubeVideoId }));
    });
    try { player.start(); } catch { player = null; }
    transcript = createBrowserYoutubeTranscriptAdapter(document, {
      youtubeVideoId: target.youtubeVideoId,
      readPageCaptionTracks: () => readPageCaptionTracks(target.youtubeVideoId),
      ignoreInitialDomTranscript: isReplacement,
      resetDomTranscriptPanel: isReplacement,
    });
    transcript.start((result, origin) => ingest(target, correlationId, value, result, origin));
  };

  const transition = async (previous: LearningTargetCapture | null, next: LearningTargetCapture) => {
    if (disposed || (previous && previous.youtubeVideoId !== activeId)) return;
    if (previous) {
      const oldActivation = manager.getCurrentActivationId();
      disposePage();
      // Reserve the observed destination before the fallible relay. If B is
      // immediately replaced by C, C can invalidate this generation while B
      // is still publishing and B can never resume stale work afterwards.
      activeId = next.youtubeVideoId;
      const transitionGeneration = generation;
      const transitionId = crypto.randomUUID();
      await continueAfterContextPublish(
        () => publish(createVideoActivationMessage('VIDEO_CONTEXT_CHANGED', {
          transitionId,
          previousActivationId: oldActivation ?? transitionId,
          previousYoutubeVideoId: previous.youtubeVideoId,
          videoTitle: next.title,
        }, { correlationId: transitionId, tabId: options.tabId, youtubeVideoId: next.youtubeVideoId })),
        () => current(next.youtubeVideoId, transitionGeneration),
        () => begin(next, crypto.randomUUID(), source, true),
      );
      return;
    }
    if (!disposed && enabled) await begin(next, crypto.randomUUID(), source, Boolean(previous));
  };

  const unsupported = async (previous: LearningTargetCapture) => {
    if (disposed || previous.youtubeVideoId !== activeId) return;
    const transitionId = crypto.randomUUID();
    const oldActivation = manager.getCurrentActivationId();
    disposePage();
    activeId = null;
    manager.clearUnavailableContext();
    await publish(createVideoActivationMessage('VIDEO_CONTEXT_UNAVAILABLE', {
      transitionId,
      previousActivationId: oldActivation ?? transitionId,
      previousYoutubeVideoId: previous.youtubeVideoId,
      reasonCode: 'unsupportedWatchPage',
    }, { correlationId: transitionId, tabId: options.tabId, youtubeVideoId: previous.youtubeVideoId }));
  };

  const watch = (initial: LearningTargetCapture | null) => {
    if (observer) return;
    observer = createBrowserYoutubeSpaTransitionObserver({
      onSupportedChange: (previous, next) => { void transition(previous, next); },
      onUnsupportedPage: (previous) => { void unsupported(previous); },
    });
    observer.start(initial);
  };

  const stop = async (correlationId: string) => {
    const stoppingVideoId = activeId;
    await stopLocalActivation({
      invalidateLocalWork: () => {
        // This must remain synchronous and before the event publish. It makes
        // every pending fetch/timer/player callback stale even if relay fails.
        enabled = false;
        observer?.dispose();
        observer = null;
        disposePage();
        activeId = null;
        latestTranscript = null;
      },
      publishDisabled: () => stoppingVideoId
        ? manager.request('off', stoppingVideoId, correlationId, 'user')
        : Promise.resolve(true),
    });
  };
  const clearStorageOnTimer = () => {
    if (storageOnTimer !== null) window.clearTimeout(storageOnTimer);
    storageOnTimer = null;
  };

  const start = async (correlationId: string, activationSource: ActivationSource) => {
    const target = captureLearningTarget(window.location.href, document.title);
    enabled = true;
    if (target.status !== 'supported') { watch(null); return { ok: true, code: target.code }; }
    if (activeId !== target.target.youtubeVideoId) {
      if (activeId) await stop(correlationId);
      enabled = true;
      await begin(target.target, correlationId, activationSource);
    }
    watch(target.target);
    return { ok: true };
  };

  const onMessage = (message: unknown, _sender: chrome.runtime.MessageSender, respond: (response?: unknown) => void) => {
    const toggleRequest = message as Partial<ToggleRequest>;
    const retryRequest = message as Partial<RetryRequest>;
    if ((message as { type?: unknown }).type === 'STUDYLENS_CONTENT_SCRIPT_READY') { respond({ ok: true }); return; }
    if ((message as { type?: unknown }).type === 'STUDYLENS_GET_VIDEO_CONTEXT') {
      const target = captureLearningTarget(window.location.href, document.title);
      respond(target.status === 'supported'
        ? {
          ok: true,
          context: { tabId: options.tabId, youtubeVideoId: target.target.youtubeVideoId, title: target.target.title },
          ...(activeId === target.target.youtubeVideoId && latestTranscript ? { localTranscript: latestTranscript } : {}),
        }
        : { ok: false, code: target.code });
      return;
    }
    if (toggleRequest.type === 'ACTIVATION_TOGGLE_REQUEST' &&
      (toggleRequest.requestedState === 'on' || toggleRequest.requestedState === 'off') &&
      typeof toggleRequest.correlationId === 'string' &&
      (toggleRequest.source === 'user' || toggleRequest.source === 'storageRestore')) {
      const commandRevision = gateRevision.invalidate();
      clearStorageOnTimer();
      void chrome.storage.local.get(ACTIVATION_STORAGE_KEY).then(async (stored) => {
        if (!gateRevision.isCurrent(commandRevision) ||
          !isAuthoritativeToggleState(toggleRequest.requestedState!, stored[ACTIVATION_STORAGE_KEY])) {
          return { ok: true, code: 'staleActivationCommand' };
        }
        return toggleRequest.requestedState === 'on'
          ? start(toggleRequest.correlationId!, toggleRequest.source!)
          : stop(toggleRequest.correlationId!).then(() => ({ ok: true }));
      }).then(respond, () => respond({ ok: false, code: 'activationUnavailable' }));
      return true;
    }
    if (retryRequest.type === 'OPERATION_RETRY_REQUEST' && retryRequest.payload?.operation === 'transcriptUpload') {
      submittedGeneration = null;
      clearFallbackTimer();
      domDeadlineAt = null;
      transcript?.retry();
      respond({ ok: true });
      return;
    }
    if ((message as { type?: string }).type === 'STUDYLENS_GET_PLAYER_TIME') respond({ currentTimeMs: player?.getCurrentTimeMs() ?? 0 });
  };

  chrome.runtime.onMessage.addListener(onMessage);
  const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    const nextEnabled = activationEnabledFromStorageChange(changes, areaName);
    if (nextEnabled === null || disposed) return;
    const revision = gateRevision.invalidate();
    clearStorageOnTimer();
    const correlationId = crypto.randomUUID();
    // chrome.storage.local is the authoritative global gate. Calling stop()
    // begins with synchronous invalidation before its first fallible publish.
    if (nextEnabled) {
      // Give the explicit user command a chance to arrive with source=user.
      // If that tab relay fails, storage remains an authoritative fallback.
      storageOnTimer = scheduleStorageOnFallback({
        gate: gateRevision,
        revision,
        delayMs: STORAGE_ON_FALLBACK_DELAY_MS,
        schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
        activate: () => {
          storageOnTimer = null;
          if (!disposed) void start(correlationId, 'storageRestore');
        },
      });
    } else void stop(correlationId).catch(() => undefined);
  };
  chrome.storage.onChanged.addListener(onStorageChanged);
  const startupRevision = gateRevision.snapshot();
  void chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_ACTIVATION_STATE' })
    .then((state: { enabled?: boolean; correlationId?: string; source?: unknown } | undefined) => {
      if (state?.enabled && !disposed && gateRevision.isCurrent(startupRevision)) {
        const activationSource = state.source === 'user' ? 'user' : 'storageRestore';
        void start(state.correlationId ?? crypto.randomUUID(), activationSource);
      }
    })
    .catch(() => undefined);

  return {
    getPlayerPort: () => player,
    retrySessionStart: async () => {
      const target = activeTarget;
      const correlationId = activeCorrelationId;
      const value = generation;
      if (!target || !correlationId || !current(target.youtubeVideoId, value) || !options.retrySessionStart) return false;

      const started = await options.retrySessionStart();
      if (!started || !current(target.youtubeVideoId, value)) return false;

      submittedGeneration = null;
      clearFallbackTimer();
      domDeadlineAt = null;
      if (latestTranscript) {
        void upload(target, correlationId, value, latestTranscript);
      } else {
        transcript?.retry();
      }
      return true;
    },
    dispose: () => {
      disposed = true;
      enabled = false;
      observer?.dispose();
      disposePage();
      activeId = null;
      latestTranscript = null;
      clearStorageOnTimer();
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.storage.onChanged.removeListener(onStorageChanged);
    },
  };
}

async function preferences(): Promise<LearningPreferences> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_LEARNING_PREFERENCES' }) as { ok?: boolean; preferences?: unknown } | undefined;
    return response?.ok && isLearningPreferences(response.preferences)
      ? { ...response.preferences }
      : { ...DEFAULT_LEARNING_PREFERENCES };
  } catch {
    return { ...DEFAULT_LEARNING_PREFERENCES };
  }
}

async function readPageCaptionTracks(youtubeVideoId: string) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: PAGE_CAPTION_TRACKS_MESSAGE,
      youtubeVideoId,
    }) as { ok?: unknown; tracks?: unknown } | undefined;
    return response?.ok === true && Array.isArray(response.tracks)
      ? response.tracks as import('../../platform/youtube/transcript-reader').YouTubeCaptionTrack[]
      : [];
  } catch {
    return [];
  }
}
