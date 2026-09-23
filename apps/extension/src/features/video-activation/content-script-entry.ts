import {
  captureLearningTarget,
  type LearningTargetCapture,
} from '../../platform/youtube/learning-target-capture';
import { createVideoActivationMessage } from '../../platform/youtube/youtube-events';
import { PlayerPort, YoutubePlayerAdapter } from '../../platform/youtube/youtube-player-adapter';
import { ExtensionMessage } from '../../shared/messaging/message-types';
import { messageBus } from '../../shared/messaging/message-bus';
import { type OperationStatusPayload } from '../../shared/messaging/operation-status';
import type { TranscriptCaptureRef } from '../../shared/contracts/activation-handoff';
import {
  DEFAULT_LEARNING_PREFERENCES,
  isLearningPreferences,
  type LearningPreferences,
} from './models/learning-preferences';
import { ManualActivationManager } from './services/activation-manager';
import {
  createBrowserYoutubeSpaTransitionObserver,
  type YoutubeSpaTransitionObserver,
} from './services/youtube-spa-transition-observer';

export interface VideoActivationContentScriptOptions {
  tabId: number;
  publish?: (message: ExtensionMessage) => Promise<void>;
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

type ActivationSource = 'user' | 'storageRestore';

/**
 * Coordinates one persistent learner-selected flow per tab. While ON it
 * observes debounced YouTube SPA navigation, but never changes playback.
 */
export function initializeVideoActivationContentScript(
  options: VideoActivationContentScriptOptions,
): VideoActivationContentScriptController {
  const publish = options.publish ?? ((message) => messageBus.publish(message));
  const activationManager = new ManualActivationManager({ publish });
  let playerAdapter: YoutubePlayerAdapter | null = null;
  let transitionObserver: YoutubeSpaTransitionObserver | null = null;
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

  const switchAudioCapture = async (
    target: LearningTargetCapture,
    correlationId: string,
  ): Promise<void> => {
    const response = await chrome.runtime.sendMessage({
      type: 'STUDYLENS_SWITCH_AUDIO_CAPTURE',
      youtubeVideoId: target.youtubeVideoId,
    }) as { ok?: boolean; code?: string } | undefined;
    if (response?.ok === false) {
      await publishOperationStatus(target.youtubeVideoId, correlationId, {
        operation: 'audioTranscription', state: 'failed', code: response.code ?? 'tabCaptureUnavailable',
        message: 'Không thể bắt đầu thu âm thanh của tab YouTube.', retryable: true,
      });
    }
  };

  const startCapturedFlow = async (
    target: LearningTargetCapture,
    correlationId: string,
    source: ActivationSource,
    switched = false,
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

    // Initial capture is deliberately started only by the Side Panel click so
    // Chrome receives a direct learner gesture. A SPA A-to-B transition reuses
    // the already approved tab stream and only switches its Backend capture.
    if (switched) void switchAudioCapture(target, correlationId);
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
    if (!disposed && flowEnabled) await startCapturedFlow(next, crypto.randomUUID(), activationSource, true);
  };

  const handleUnsupportedPage = async (previous: LearningTargetCapture): Promise<void> => {
    if (disposed || previous.youtubeVideoId !== activeTargetId) return;
    const previousActivationId = activationManager.getCurrentActivationId();
    const transitionId = crypto.randomUUID();
    disposePageResources();
    await chrome.runtime.sendMessage({ type: 'STUDYLENS_STOP_AUDIO_CAPTURE' }).catch(() => undefined);
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
    await chrome.runtime.sendMessage({ type: 'STUDYLENS_STOP_AUDIO_CAPTURE' }).catch(() => undefined);
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

  const onAudioCaptureMessage = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'STUDYLENS_GET_PLAYER_TIME') {
      const currentTimeMs = playerAdapter?.getCurrentTimeMs() ?? 0;
      sendResponse({ currentTimeMs });
      return;
    }
    const candidate = message as Partial<{ type: string; youtubeVideoId: string; progress: { capture?: TranscriptCaptureRef }; payload: OperationStatusPayload }>;
    if (candidate?.type === 'STUDYLENS_AUDIO_CAPTURE_READY' && candidate.youtubeVideoId === activeTargetId) {
      const readyCapture = (message as { capture?: TranscriptCaptureRef }).capture;
      if (readyCapture?.youtubeVideoId === activeTargetId) activationManager.setTranscriptCapture(readyCapture);
      return;
    }
    if (candidate?.type === 'STUDYLENS_AUDIO_TRANSCRIPTION_PROGRESS' && candidate.youtubeVideoId === activeTargetId) {
      const capture = candidate.progress?.capture;
      if (capture && capture.youtubeVideoId === activeTargetId && capture.status === 'available') activationManager.setTranscriptCapture(capture);
      return;
    }
    if (candidate?.type === 'STUDYLENS_AUDIO_TRANSCRIPTION_STATUS' && candidate.youtubeVideoId === activeTargetId && candidate.payload) {
      void publishOperationStatus(candidate.youtubeVideoId, crypto.randomUUID(), candidate.payload);
    }
  };
  chrome.runtime.onMessage.addListener(onAudioCaptureMessage);

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
      chrome.runtime.onMessage.removeListener(onAudioCaptureMessage);
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
