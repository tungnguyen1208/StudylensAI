import { captureLearningTarget, type LearningTargetCapture } from '../../platform/youtube/learning-target-capture';
import { createVideoActivationMessage } from '../../platform/youtube/youtube-events';
import { PlayerPort, YoutubePlayerAdapter } from '../../platform/youtube/youtube-player-adapter';
import { createBrowserYoutubeTranscriptAdapter, type YoutubeTranscriptDomAdapter } from '../../platform/youtube/youtube-transcript-adapter';
import { type TranscriptReadResult } from '../../platform/youtube/transcript-reader';
import { messageBus } from '../../shared/messaging/message-bus';
import { type ExtensionMessage } from '../../shared/messaging/message-types';
import { operationFailure, type OperationStatusPayload } from '../../shared/messaging/operation-status';
import { DEFAULT_LEARNING_PREFERENCES, isLearningPreferences, type LearningPreferences } from './models/learning-preferences';
import { ManualActivationManager } from './services/activation-manager';
import { TranscriptService } from './services/transcript-service';
import type { TranscriptCaptureRef } from './models/video-activation.types';
import { PAGE_CAPTION_TRACKS_MESSAGE } from './services/youtube-page-caption-tracks';
import { createBrowserYoutubeSpaTransitionObserver, type YoutubeSpaTransitionObserver } from './services/youtube-spa-transition-observer';

export interface VideoActivationContentScriptOptions { tabId: number; publish?: (message: ExtensionMessage) => Promise<void>; }
export interface VideoActivationContentScriptController { getPlayerPort(): PlayerPort | null; dispose(): void; }
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
  // The panel can be closed while caption ingestion succeeds. Keep only the
  // public capture reference in the content-script runtime so a reopened Side
  // Panel can reload the persisted cues from the Backend for this video.
  let latestTranscriptCapture: TranscriptCaptureRef | null = null;

  const current = (id: string, value: number) => !disposed && enabled && activeId === id && generation === value;
  const publishStatus = (youtubeVideoId: string, correlationId: string, payload: OperationStatusPayload) => publish(createVideoActivationMessage('OPERATION_STATUS_CHANGED', payload, { correlationId, tabId: options.tabId, youtubeVideoId }));
  const disposePage = () => { generation += 1; player?.dispose(); player = null; transcript?.dispose(); transcript = null; };

  const ingest = async (target: LearningTargetCapture, correlationId: string, value: number, read: TranscriptReadResult) => {
    if (!current(target.youtubeVideoId, value)) return;
    await publishStatus(target.youtubeVideoId, correlationId, { operation: 'transcriptUpload', state: 'pending', message: read.status === 'available' ? 'Đang xác thực và lưu phụ đề YouTube.' : 'Đang xác thực trạng thái phụ đề YouTube.', retryable: false });
    try {
      const capture = await transcriptService.upload(target.youtubeVideoId, read);
      if (!current(target.youtubeVideoId, value)) return;
      if (capture.status === 'available') {
        latestTranscriptCapture = capture;
        await manager.setTranscriptCapture(capture);
        await publishStatus(target.youtubeVideoId, correlationId, { operation: 'transcriptUpload', state: 'succeeded', message: 'Đã nhận và lưu phụ đề YouTube.', retryable: false });
      } else await publishStatus(target.youtubeVideoId, correlationId, { operation: 'transcriptUpload', state: 'failed', code: capture.status === 'insufficient' ? 'transcriptInsufficient' : 'transcriptUnavailable', message: 'Phụ đề không đủ điều kiện để tạo phiên học.', retryable: false });
    } catch (error) {
      if (current(target.youtubeVideoId, value)) await publishStatus(target.youtubeVideoId, correlationId, { operation: 'transcriptUpload', state: 'failed', ...operationFailure(error, 'transcriptUploadFailed', 'Không thể lưu phụ đề. Bạn có thể thử lại.') });
    }
  };

  const begin = async (
    target: LearningTargetCapture,
    correlationId: string,
    activationSource: ActivationSource,
    isReplacement = false,
  ) => {
    const value = generation + 1; generation = value; activeId = target.youtubeVideoId; source = activationSource; latestTranscriptCapture = null;
    manager.setPreferences(await preferences());
    if (!current(target.youtubeVideoId, value)) return;
    await manager.setContext({ tabId: options.tabId, youtubeVideoId: target.youtubeVideoId, title: target.title }, correlationId);
    if (!current(target.youtubeVideoId, value)) return;
    await manager.request('on', target.youtubeVideoId, correlationId, activationSource);
    if (!current(target.youtubeVideoId, value)) return;
    player = new YoutubePlayerAdapter({
      getVideoElement: () => document.querySelector<HTMLVideoElement>('video.html5-main-video'),
      getCurrentYoutubeVideoId: () => { const targetNow = captureLearningTarget(window.location.href, document.title); return targetNow.status === 'supported' ? targetNow.target.youtubeVideoId : null; },
    }, target.youtubeVideoId, (event) => { if (current(target.youtubeVideoId, value)) void publish(createVideoActivationMessage(event.type, event.payload, { correlationId, tabId: options.tabId, youtubeVideoId: target.youtubeVideoId })); });
    try { player.start(); } catch { player = null; }
    transcript = createBrowserYoutubeTranscriptAdapter(document, {
      youtubeVideoId: target.youtubeVideoId,
      readPageCaptionTracks: () => readPageCaptionTracks(target.youtubeVideoId),
      // A replacement may start before YouTube removes A's open transcript
      // drawer. Direct Timedtext is still accepted immediately because its
      // track URL is validated against B; only stale DOM fallback is delayed.
      ignoreInitialDomTranscript: isReplacement,
      resetDomTranscriptPanel: isReplacement,
    });
    void transcript.start((result) => { void ingest(target, correlationId, value, result); });
  };
  const transition = async (previous: LearningTargetCapture | null, next: LearningTargetCapture) => {
    if (disposed || (previous && previous.youtubeVideoId !== activeId)) return;
    if (previous) {
      const oldActivation = manager.getCurrentActivationId(); disposePage(); activeId = null;
      const transitionId = crypto.randomUUID();
      await publish(createVideoActivationMessage('VIDEO_CONTEXT_CHANGED', { transitionId, previousActivationId: oldActivation ?? transitionId, previousYoutubeVideoId: previous.youtubeVideoId, videoTitle: next.title }, { correlationId: transitionId, tabId: options.tabId, youtubeVideoId: next.youtubeVideoId }));
    }
    if (!disposed && enabled) await begin(next, crypto.randomUUID(), source, Boolean(previous));
  };
  const unsupported = async (previous: LearningTargetCapture) => {
    if (disposed || previous.youtubeVideoId !== activeId) return;
    const transitionId = crypto.randomUUID(); const oldActivation = manager.getCurrentActivationId();
    disposePage(); activeId = null; manager.clearUnavailableContext();
    await publish(createVideoActivationMessage('VIDEO_CONTEXT_UNAVAILABLE', { transitionId, previousActivationId: oldActivation ?? transitionId, previousYoutubeVideoId: previous.youtubeVideoId, reasonCode: 'unsupportedWatchPage' }, { correlationId: transitionId, tabId: options.tabId, youtubeVideoId: previous.youtubeVideoId }));
  };
  const watch = (initial: LearningTargetCapture | null) => {
    if (observer) return;
    observer = createBrowserYoutubeSpaTransitionObserver({ onSupportedChange: (previous, next) => { void transition(previous, next); }, onUnsupportedPage: (previous) => { void unsupported(previous); } });
    observer.start(initial);
  };
  const stop = async (correlationId: string) => { enabled = false; observer?.dispose(); observer = null; if (activeId) await manager.request('off', activeId, correlationId, 'user'); disposePage(); activeId = null; latestTranscriptCapture = null; };
  const start = async (correlationId: string, activationSource: ActivationSource) => {
    const target = captureLearningTarget(window.location.href, document.title); enabled = true;
    if (target.status !== 'supported') { watch(null); return { ok: true, code: target.code }; }
    if (activeId !== target.target.youtubeVideoId) { if (activeId) await stop(correlationId); enabled = true; await begin(target.target, correlationId, activationSource); }
    watch(target.target); return { ok: true };
  };
  const onMessage = (message: unknown, _sender: chrome.runtime.MessageSender, respond: (response?: unknown) => void) => {
    const toggleRequest = message as Partial<ToggleRequest>;
    const retryRequest = message as Partial<RetryRequest>;
    if ((message as { type?: unknown }).type === 'STUDYLENS_CONTENT_SCRIPT_READY') { respond({ ok: true }); return; }
    if ((message as { type?: unknown }).type === 'STUDYLENS_GET_VIDEO_CONTEXT') {
      const target = captureLearningTarget(window.location.href, document.title);
      if (target.status !== 'supported') {
        respond({ ok: false, code: target.code });
      } else {
        respond({
          ok: true,
          context: { tabId: options.tabId, youtubeVideoId: target.target.youtubeVideoId, title: target.target.title },
          ...(latestTranscriptCapture?.youtubeVideoId === target.target.youtubeVideoId
            ? { transcriptCapture: latestTranscriptCapture }
            : {}),
        });
      }
      return;
    }
    if (toggleRequest.type === 'ACTIVATION_TOGGLE_REQUEST' && (toggleRequest.requestedState === 'on' || toggleRequest.requestedState === 'off') && typeof toggleRequest.correlationId === 'string' && (toggleRequest.source === 'user' || toggleRequest.source === 'storageRestore')) { void (toggleRequest.requestedState === 'on' ? start(toggleRequest.correlationId, toggleRequest.source) : stop(toggleRequest.correlationId).then(() => ({ ok: true }))).then(respond, () => respond({ ok: false, code: 'activationUnavailable' })); return true; }
    if (retryRequest.type === 'OPERATION_RETRY_REQUEST' && retryRequest.payload?.operation === 'transcriptUpload') { void transcript?.retry(); respond({ ok: true }); return; }
    if ((message as { type?: string }).type === 'STUDYLENS_GET_PLAYER_TIME') respond({ currentTimeMs: player?.getCurrentTimeMs() ?? 0 });
  };
  chrome.runtime.onMessage.addListener(onMessage);
  void chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_ACTIVATION_STATE' }).then((state: { enabled?: boolean; correlationId?: string } | undefined) => { if (state?.enabled && !disposed) void start(state.correlationId ?? crypto.randomUUID(), 'storageRestore'); }).catch(() => undefined);
  return { getPlayerPort: () => player, dispose: () => { disposed = true; enabled = false; observer?.dispose(); disposePage(); activeId = null; latestTranscriptCapture = null; chrome.runtime.onMessage.removeListener(onMessage); } };
}

async function preferences(): Promise<LearningPreferences> {
  try { const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_LEARNING_PREFERENCES' }) as { ok?: boolean; preferences?: unknown } | undefined; return response?.ok && isLearningPreferences(response.preferences) ? { ...response.preferences } : { ...DEFAULT_LEARNING_PREFERENCES }; } catch { return { ...DEFAULT_LEARNING_PREFERENCES }; }
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
