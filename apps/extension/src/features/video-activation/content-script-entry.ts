import { captureLearningTarget } from '../../platform/youtube/learning-target-capture';
import { createVideoActivationMessage } from '../../platform/youtube/youtube-events';
import { PlayerPort, YoutubePlayerAdapter } from '../../platform/youtube/youtube-player-adapter';
import { createBrowserYoutubeTranscriptAdapter, YoutubeTranscriptDomAdapter } from '../../platform/youtube/youtube-transcript-adapter';
import type { TranscriptReadResult } from '../../platform/youtube/transcript-reader';
import { ExtensionMessage } from '../../shared/messaging/message-types';
import { messageBus } from '../../shared/messaging/message-bus';
import { operationFailure, type OperationStatusPayload } from '../../shared/messaging/operation-status';
import { TranscriptService } from './services/transcript-service';
import { ManualActivationManager } from './services/activation-manager';

export interface VideoActivationContentScriptOptions {
  tabId: number;
  publish?: (message: ExtensionMessage) => Promise<void>;
  transcriptService?: TranscriptService;
}

export interface VideoActivationContentScriptController {
  getPlayerPort(): PlayerPort | null;
  dispose(): void;
}

type ToggleRequest = {
  type: 'ACTIVATION_TOGGLE_REQUEST';
  requestedState: 'on' | 'off';
  source: 'user' | 'storageRestore';
  correlationId: string;
};

type OperationRetryRequest = ExtensionMessage<{ operation?: string }>;

/**
 * Owns exactly one flow for an explicitly captured page. It never watches
 * navigation and never publishes a replacement context for another video.
 */
export function initializeVideoActivationContentScript(
  options: VideoActivationContentScriptOptions,
): VideoActivationContentScriptController {
  const publish = options.publish ?? ((message) => messageBus.publish(message));
  const transcriptService = options.transcriptService ?? new TranscriptService();
  const activationManager = new ManualActivationManager({ publish });
  let playerAdapter: YoutubePlayerAdapter | null = null;
  let transcriptAdapter: YoutubeTranscriptDomAdapter | null = null;
  let lastTranscript: TranscriptReadResult | null = null;
  let activeTargetId: string | null = null;
  let disposed = false;

  const stopFlow = async (correlationId: string): Promise<void> => {
    await activationManager.request('off', activeTargetId ?? '', correlationId, 'user');
    playerAdapter?.dispose();
    playerAdapter = null;
    transcriptAdapter?.dispose();
    transcriptAdapter = null;
    lastTranscript = null;
    activeTargetId = null;
  };

  const startFlow = async (
    correlationId: string,
    source: 'user' | 'storageRestore',
  ): Promise<{ ok: boolean; code?: string }> => {
    const capture = captureLearningTarget(window.location.href, document.title);
    if (capture.status !== 'supported') return { ok: false, code: capture.code };
    if (activeTargetId === capture.target.youtubeVideoId) return { ok: true };
    if (activeTargetId) await stopFlow(correlationId);

    activeTargetId = capture.target.youtubeVideoId;
    await activationManager.setContext({
      tabId: options.tabId,
      youtubeVideoId: capture.target.youtubeVideoId,
      title: capture.target.title,
    }, correlationId);
    await activationManager.request('on', capture.target.youtubeVideoId, correlationId, source);

    playerAdapter = new YoutubePlayerAdapter(
      {
        getVideoElement: () => document.querySelector<HTMLVideoElement>('video.html5-main-video'),
        getCurrentYoutubeVideoId: () => {
          const current = captureLearningTarget(window.location.href, document.title);
          return current.status === 'supported' ? current.target.youtubeVideoId : null;
        },
      },
      capture.target.youtubeVideoId,
      (event) => {
        if (activeTargetId !== capture.target.youtubeVideoId) return;
        void publish(createVideoActivationMessage(event.type, event.payload, {
          correlationId,
          tabId: options.tabId,
          youtubeVideoId: capture.target.youtubeVideoId,
        }));
      },
    );
    try {
      playerAdapter.start();
    } catch {
      playerAdapter = null;
    }

    transcriptAdapter = createBrowserYoutubeTranscriptAdapter();
    transcriptAdapter.start((transcript) => {
      if (activeTargetId !== capture.target.youtubeVideoId || disposed) return;
      lastTranscript = transcript;
      void uploadTranscript(capture.target.youtubeVideoId, transcript, correlationId);
    });
    return { ok: true };
  };

  const publishOperationStatus = async (
    youtubeVideoId: string,
    correlationId: string,
    payload: OperationStatusPayload,
  ): Promise<void> => {
    await publish(createVideoActivationMessage('OPERATION_STATUS_CHANGED', payload, {
      correlationId,
      tabId: options.tabId,
      youtubeVideoId,
    }));
  };

  const uploadTranscript = async (
    youtubeVideoId: string,
    transcript: TranscriptReadResult,
    correlationId: string,
  ): Promise<void> => {
    await publishOperationStatus(youtubeVideoId, correlationId, {
      operation: 'transcriptUpload', state: 'pending', message: 'Đang gửi transcript tới Backend.', retryable: false,
    });
    try {
      const snapshot = await transcriptService.upload(youtubeVideoId, transcript);
      if (activeTargetId !== youtubeVideoId || disposed) return;
      activationManager.setTranscriptSnapshot(snapshot);
      await publishOperationStatus(youtubeVideoId, correlationId, snapshot.status === 'available'
        ? { operation: 'transcriptUpload', state: 'succeeded', message: 'Transcript đã sẵn sàng.', retryable: false }
        : {
          operation: 'transcriptUpload', state: 'failed', code: `transcript${snapshot.status[0].toUpperCase()}${snapshot.status.slice(1)}`,
          message: snapshot.status === 'unavailable' ? 'Video chưa có transcript khả dụng.' : 'Transcript chưa đủ nội dung để tạo bài kiểm tra.',
          retryable: false,
        });
    } catch (error: unknown) {
      if (activeTargetId !== youtubeVideoId || disposed) return;
      const failure = operationFailure(error, 'transcriptUploadFailed', 'Không thể gửi transcript tới Backend.');
      await publishOperationStatus(youtubeVideoId, correlationId, {
        operation: 'transcriptUpload', state: 'failed', ...failure,
      });
    }
  };

  const onToggleRequest = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (!isToggleRequest(message)) return;
    void (message.requestedState === 'on'
      ? startFlow(message.correlationId, message.source)
      : stopFlow(message.correlationId).then(() => ({ ok: true })))
      .then(sendResponse, () => sendResponse({ ok: false, code: 'activationUnavailable' }));
    return true;
  };
  chrome.runtime.onMessage.addListener(onToggleRequest);

  const onOperationRetryRequest = (message: unknown) => {
    const request = message as Partial<OperationRetryRequest>;
    if (request?.type !== 'OPERATION_RETRY_REQUEST' || request.payload?.operation !== 'transcriptUpload') return;
    if (!activeTargetId || !lastTranscript || disposed) return;
    void uploadTranscript(activeTargetId, lastTranscript, typeof request.correlationId === 'string' ? request.correlationId : crypto.randomUUID());
  };
  chrome.runtime.onMessage.addListener(onOperationRetryRequest);

  void chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_ACTIVATION_STATE' }).then(
    (state: { enabled?: boolean; correlationId?: string } | undefined) => {
      if (state?.enabled && !disposed) {
        void startFlow(state.correlationId ?? crypto.randomUUID(), 'storageRestore');
      }
    },
  ).catch(() => {
    // The content script stays inert if the service worker is unavailable.
  });

  return {
    getPlayerPort: () => playerAdapter,
    dispose: () => {
      disposed = true;
      playerAdapter?.dispose();
      transcriptAdapter?.dispose();
      chrome.runtime.onMessage.removeListener(onToggleRequest);
      chrome.runtime.onMessage.removeListener(onOperationRetryRequest);
    },
  };
}

function isToggleRequest(value: unknown): value is ToggleRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ToggleRequest>;
  return candidate.type === 'ACTIVATION_TOGGLE_REQUEST' &&
    (candidate.requestedState === 'on' || candidate.requestedState === 'off') &&
    (candidate.source === 'user' || candidate.source === 'storageRestore') &&
    typeof candidate.correlationId === 'string';
}
