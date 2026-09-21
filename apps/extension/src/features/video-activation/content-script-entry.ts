import {
  captureLearningTarget,
  type LearningTargetCapture,
} from '../../platform/youtube/learning-target-capture';
import { createVideoActivationMessage } from '../../platform/youtube/youtube-events';
import { PlayerPort, YoutubePlayerAdapter } from '../../platform/youtube/youtube-player-adapter';
import { createBrowserYoutubeTranscriptAdapter, YoutubeTranscriptDomAdapter } from '../../platform/youtube/youtube-transcript-adapter';
import type { TranscriptReadResult } from '../../platform/youtube/transcript-reader';
import { ExtensionMessage } from '../../shared/messaging/message-types';
import { messageBus } from '../../shared/messaging/message-bus';
import { operationFailure, type OperationStatusPayload } from '../../shared/messaging/operation-status';
import {
  DEFAULT_LEARNING_PREFERENCES,
  isLearningPreferences,
  type LearningPreferences,
} from './models/learning-preferences';
import { ManualActivationManager } from './services/activation-manager';
import { TranscriptService } from './services/transcript-service';
import {
  createBrowserYoutubeSpaTransitionObserver,
  type YoutubeSpaTransitionObserver,
} from './services/youtube-spa-transition-observer';

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
type ActivationSource = 'user' | 'storageRestore';

/**
 * Coordinates one persistent learner-selected flow per tab. While ON it
 * observes debounced YouTube SPA navigation, but never changes playback.
 */
export function initializeVideoActivationContentScript(
  options: VideoActivationContentScriptOptions,
): VideoActivationContentScriptController {
  const publish = options.publish ?? ((message) => messageBus.publish(message));
  const transcriptService = options.transcriptService ?? new TranscriptService();
  const activationManager = new ManualActivationManager({ publish });
  let playerAdapter: YoutubePlayerAdapter | null = null;
  let transcriptAdapter: YoutubeTranscriptDomAdapter | null = null;
  let transitionObserver: YoutubeSpaTransitionObserver | null = null;
  let lastTranscript: TranscriptReadResult | null = null;
  let lastTranscriptGeneration: number | null = null;
  let activeTargetId: string | null = null;
  let flowGeneration = 0;
  let flowEnabled = false;
  let activationSource: ActivationSource = 'user';
  let transitionQueue: Promise<void> = Promise.resolve();
  let disposed = false;

  const isCurrentFlow = (youtubeVideoId: string, generation: number): boolean =>
    !disposed && activeTargetId === youtubeVideoId && flowGeneration === generation;

  const disposePageResources = (): void => {
    flowGeneration += 1;
    playerAdapter?.dispose();
    playerAdapter = null;
    transcriptAdapter?.dispose();
    transcriptAdapter = null;
    lastTranscript = null;
    lastTranscriptGeneration = null;
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
    generation: number,
  ): Promise<void> => {
    if (!isCurrentFlow(youtubeVideoId, generation)) return;
    await publishOperationStatus(youtubeVideoId, correlationId, {
      operation: 'transcriptUpload', state: 'pending', message: 'Đang gửi transcript tới Backend.', retryable: false,
    });
    if (!isCurrentFlow(youtubeVideoId, generation)) return;
    try {
      const snapshot = await transcriptService.upload(youtubeVideoId, transcript);
      if (!isCurrentFlow(youtubeVideoId, generation)) return;
      activationManager.setTranscriptSnapshot(snapshot);
      await publishOperationStatus(youtubeVideoId, correlationId, snapshot.status === 'available'
        ? { operation: 'transcriptUpload', state: 'succeeded', message: 'Transcript đã sẵn sàng.', retryable: false }
        : {
          operation: 'transcriptUpload', state: 'failed', code: `transcript${snapshot.status[0].toUpperCase()}${snapshot.status.slice(1)}`,
          message: snapshot.status === 'unavailable' ? 'Video chưa có transcript khả dụng.' : 'Transcript chưa đủ nội dung để tạo bài kiểm tra.',
          retryable: false,
        });
    } catch (error: unknown) {
      if (!isCurrentFlow(youtubeVideoId, generation)) return;
      const failure = operationFailure(error, 'transcriptUploadFailed', 'Không thể gửi transcript tới Backend.');
      await publishOperationStatus(youtubeVideoId, correlationId, {
        operation: 'transcriptUpload', state: 'failed', ...failure,
      });
    }
  };

  const startCapturedFlow = async (
    target: LearningTargetCapture,
    correlationId: string,
    source: ActivationSource,
  ): Promise<void> => {
    const generation = flowGeneration + 1;
    flowGeneration = generation;
    activationSource = source;
    activeTargetId = target.youtubeVideoId;
    activationManager.setPreferences(await requestLearningPreferences());
    if (!flowEnabled || !isCurrentFlow(target.youtubeVideoId, generation)) return;
    await activationManager.setContext({
      tabId: options.tabId,
      youtubeVideoId: target.youtubeVideoId,
      title: target.title,
    }, correlationId);
    if (!flowEnabled || !isCurrentFlow(target.youtubeVideoId, generation)) return;
    await activationManager.request('on', target.youtubeVideoId, correlationId, source);
    if (!flowEnabled || !isCurrentFlow(target.youtubeVideoId, generation)) return;

    playerAdapter = new YoutubePlayerAdapter(
      {
        getVideoElement: () => document.querySelector<HTMLVideoElement>('video.html5-main-video'),
        getCurrentYoutubeVideoId: () => {
          const current = captureLearningTarget(window.location.href, document.title);
          return current.status === 'supported' ? current.target.youtubeVideoId : null;
        },
      },
      target.youtubeVideoId,
      (event) => {
        if (!isCurrentFlow(target.youtubeVideoId, generation)) return;
        void publish(createVideoActivationMessage(event.type, event.payload, {
          correlationId,
          tabId: options.tabId,
          youtubeVideoId: target.youtubeVideoId,
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
      if (!isCurrentFlow(target.youtubeVideoId, generation)) return;
      lastTranscript = transcript;
      lastTranscriptGeneration = generation;
      void uploadTranscript(target.youtubeVideoId, transcript, correlationId, generation);
    });
  };

  const enqueueTransition = (task: () => Promise<void>): void => {
    transitionQueue = transitionQueue.then(task, task).catch(() => undefined);
  };

  const handleSupportedTransition = async (
    previous: LearningTargetCapture | null,
    next: LearningTargetCapture,
  ): Promise<void> => {
    if (disposed || (previous && previous.youtubeVideoId !== activeTargetId)) return;
    const previousActivationId = activationManager.getCurrentActivationId();
    if (previous) {
      disposePageResources();
      activeTargetId = null;
      const transitionId = crypto.randomUUID();
      await publish(createVideoActivationMessage('VIDEO_CONTEXT_CHANGED', {
        transitionId,
        previousActivationId: previousActivationId ?? transitionId,
        previousYoutubeVideoId: previous.youtubeVideoId,
        videoTitle: next.title,
      }, {
        correlationId: transitionId,
        tabId: options.tabId,
        youtubeVideoId: next.youtubeVideoId,
      }));
    }
    if (!disposed && flowEnabled) await startCapturedFlow(next, crypto.randomUUID(), activationSource);
  };

  const handleUnsupportedPage = async (previous: LearningTargetCapture): Promise<void> => {
    if (disposed || previous.youtubeVideoId !== activeTargetId) return;
    const previousActivationId = activationManager.getCurrentActivationId();
    const transitionId = crypto.randomUUID();
    disposePageResources();
    activeTargetId = null;
    activationManager.clearUnavailableContext();
    await publish(createVideoActivationMessage('VIDEO_CONTEXT_UNAVAILABLE', {
      transitionId,
      previousActivationId: previousActivationId ?? transitionId,
      previousYoutubeVideoId: previous.youtubeVideoId,
      reasonCode: 'unsupportedWatchPage',
    }, {
      correlationId: transitionId,
      tabId: options.tabId,
      youtubeVideoId: previous.youtubeVideoId,
    }));
    await publishOperationStatus(previous.youtubeVideoId, transitionId, {
      operation: 'transcriptUpload', state: 'failed', code: 'unsupportedWatchPage',
      message: 'Mở một trang xem YouTube hợp lệ để tiếp tục StudyLens.', retryable: false,
    });
  };

  const ensureTransitionObserver = (initialTarget: LearningTargetCapture | null): void => {
    if (transitionObserver) return;
    transitionObserver = createBrowserYoutubeSpaTransitionObserver({
      onSupportedChange: (previous, next) => enqueueTransition(() => handleSupportedTransition(previous, next)),
      onUnsupportedPage: (previous) => enqueueTransition(() => handleUnsupportedPage(previous)),
    });
    transitionObserver.start(initialTarget);
  };

  const stopFlow = async (correlationId: string): Promise<void> => {
    flowEnabled = false;
    transitionObserver?.dispose();
    transitionObserver = null;
    const targetId = activeTargetId;
    if (targetId) await activationManager.request('off', targetId, correlationId, 'user');
    disposePageResources();
    activeTargetId = null;
  };

  const startFlow = async (
    correlationId: string,
    source: ActivationSource,
  ): Promise<{ ok: boolean; code?: string }> => {
    const capture = captureLearningTarget(window.location.href, document.title);
    flowEnabled = true;
    if (capture.status !== 'supported') {
      ensureTransitionObserver(null);
      // Global ON is valid even when this page has no supported capture yet.
      return { ok: true, code: capture.code };
    }
    if (activeTargetId === capture.target.youtubeVideoId) return { ok: true };
    if (activeTargetId) await stopFlow(correlationId);
    await startCapturedFlow(capture.target, correlationId, source);
    if (!disposed && activeTargetId === capture.target.youtubeVideoId) ensureTransitionObserver(capture.target);
    return { ok: true };
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
    if (!activeTargetId || !lastTranscript || lastTranscriptGeneration !== flowGeneration || disposed) return;
    void uploadTranscript(activeTargetId, lastTranscript, typeof request.correlationId === 'string' ? request.correlationId : crypto.randomUUID(), flowGeneration);
  };
  chrome.runtime.onMessage.addListener(onOperationRetryRequest);

  void chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_ACTIVATION_STATE' }).then(
    (state: { enabled?: boolean; correlationId?: string } | undefined) => {
      if (state?.enabled && !disposed) void startFlow(state.correlationId ?? crypto.randomUUID(), 'storageRestore');
    },
  ).catch(() => {
    // The content script stays inert if the service worker is unavailable.
  });

  return {
    getPlayerPort: () => playerAdapter,
    dispose: () => {
      disposed = true;
      flowEnabled = false;
      transitionObserver?.dispose();
      transitionObserver = null;
      disposePageResources();
      activeTargetId = null;
      chrome.runtime.onMessage.removeListener(onToggleRequest);
      chrome.runtime.onMessage.removeListener(onOperationRetryRequest);
    },
  };
}

async function requestLearningPreferences(): Promise<LearningPreferences> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_LEARNING_PREFERENCES' }) as {
      ok?: boolean;
      preferences?: unknown;
    } | undefined;
    return response?.ok && isLearningPreferences(response.preferences)
      ? { ...response.preferences }
      : { ...DEFAULT_LEARNING_PREFERENCES };
  } catch {
    return { ...DEFAULT_LEARNING_PREFERENCES };
  }
}

function isToggleRequest(value: unknown): value is ToggleRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ToggleRequest>;
  return candidate.type === 'ACTIVATION_TOGGLE_REQUEST' &&
    (candidate.requestedState === 'on' || candidate.requestedState === 'off') &&
    (candidate.source === 'user' || candidate.source === 'storageRestore') &&
    typeof candidate.correlationId === 'string';
}
