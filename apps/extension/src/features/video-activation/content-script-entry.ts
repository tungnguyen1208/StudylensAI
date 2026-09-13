import {
  createBrowserYoutubeEnvironment,
  parseYoutubeWatchUrl,
  YoutubeVideoDetector,
} from '../../platform/youtube/youtube-detector';
import { createVideoActivationMessage } from '../../platform/youtube/youtube-events';
import {
  PlayerPort,
  YoutubePlayerAdapter,
} from '../../platform/youtube/youtube-player-adapter';
import {
  createBrowserYoutubeTranscriptAdapter,
  YoutubeTranscriptDomAdapter,
} from '../../platform/youtube/youtube-transcript-adapter';
import { ExtensionMessage } from '../../shared/messaging/message-types';
import { messageBus } from '../../shared/messaging/message-bus';
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

export function initializeVideoActivationContentScript(
  options: VideoActivationContentScriptOptions,
): VideoActivationContentScriptController {
  const environment = createBrowserYoutubeEnvironment();
  const publish = options.publish ?? ((message) => messageBus.publish(message));
  const transcriptService = options.transcriptService ?? new TranscriptService();
  const activationManager = new ManualActivationManager({ publish });
  let playerAdapter: YoutubePlayerAdapter | null = null;
  let transcriptAdapter: YoutubeTranscriptDomAdapter | null = null;
  let contextVersion = 0;
  let latestContextMessage: ExtensionMessage | null = null;

  const detector = new YoutubeVideoDetector(environment, (detection) => {
    contextVersion += 1;
    const capturedVersion = contextVersion;

    if (detection.status !== 'supported') {
      playerAdapter?.dispose();
      playerAdapter = null;
      transcriptAdapter?.dispose();
      transcriptAdapter = null;
      latestContextMessage = null;
      return;
    }

    const { context } = detection;
    playerAdapter?.dispose();
    transcriptAdapter?.dispose();
    const correlationId = crypto.randomUUID();

    void activationManager.setContext({
      tabId: options.tabId,
      youtubeVideoId: context.youtubeVideoId,
      title: context.title,
    }, correlationId);

    latestContextMessage = createVideoActivationMessage('VIDEO_CONTEXT_CHANGED', toContextPayload(context), {
      correlationId,
      tabId: options.tabId,
      youtubeVideoId: context.youtubeVideoId,
    });
    void publish(latestContextMessage);

    playerAdapter = new YoutubePlayerAdapter(
      {
        getVideoElement: () => environment.getVideoElement(),
        getCurrentYoutubeVideoId: () => {
          const parsed = parseYoutubeWatchUrl(environment.getUrl());
          return parsed.status === 'supported' ? parsed.value.youtubeVideoId : null;
        },
      },
      context.youtubeVideoId,
      (event) => {
        void publish(
          createVideoActivationMessage(event.type, event.payload, {
            correlationId,
            tabId: options.tabId,
            youtubeVideoId: context.youtubeVideoId,
          }),
        );
      },
    );

    try {
      playerAdapter.start();
    } catch {
      playerAdapter = null;
    }

    transcriptAdapter = createBrowserYoutubeTranscriptAdapter();
    transcriptAdapter.start((transcript) => {
      if (capturedVersion !== contextVersion) return;
      void transcriptService.upload(context.youtubeVideoId, transcript).then(
        (snapshot) => {
          if (capturedVersion === contextVersion) activationManager.setTranscriptSnapshot(snapshot);
        },
        () => {
          // Transcript/backend failure must never interrupt YouTube playback.
        },
      );
    });
  });

  detector.start();

  const onManualActivationRequest = (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    if (isVideoContextLookupRequest(message)) {
      sendResponse(latestContextMessage);
      return;
    }
    if (!isManualActivationRequest(message, options.tabId)) return;
    void activationManager.request(
      message.payload.requestedState,
      message.youtubeVideoId,
      message.correlationId,
    );
  };
  chrome.runtime.onMessage.addListener(onManualActivationRequest);

  return {
    getPlayerPort: () => playerAdapter,
    dispose: () => {
      contextVersion += 1;
      playerAdapter?.dispose();
      playerAdapter = null;
      transcriptAdapter?.dispose();
      transcriptAdapter = null;
      detector.dispose();
      chrome.runtime.onMessage.removeListener(onManualActivationRequest);
    },
  };
}

function isVideoContextLookupRequest(value: unknown): value is { type: 'STUDYLENS_GET_VIDEO_CONTEXT' } {
  return Boolean(value) && typeof value === 'object' &&
    (value as { type?: unknown }).type === 'STUDYLENS_GET_VIDEO_CONTEXT';
}

function isManualActivationRequest(
  value: unknown,
  tabId: number,
): value is {
  type: 'MANUAL_ACTIVATION_REQUEST';
  tabId: number;
  youtubeVideoId: string;
  correlationId: string;
  payload: { requestedState: 'on' | 'off' };
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    type?: unknown; tabId?: unknown; youtubeVideoId?: unknown; correlationId?: unknown;
    payload?: { requestedState?: unknown };
  };
  return candidate.type === 'MANUAL_ACTIVATION_REQUEST' && candidate.tabId === tabId &&
    typeof candidate.youtubeVideoId === 'string' && typeof candidate.correlationId === 'string' &&
    (candidate.payload?.requestedState === 'on' || candidate.payload?.requestedState === 'off');
}

function toContextPayload(context: {
  title: string;
  canonicalUrl: string;
  currentTimeMs: number;
  durationMs?: number;
  playbackState?: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: context.title,
    canonicalUrl: context.canonicalUrl,
    currentTimeMs: context.currentTimeMs,
  };
  if (context.durationMs !== undefined) {
    payload.durationMs = context.durationMs;
  }
  if (context.playbackState !== undefined) {
    payload.playbackState = context.playbackState;
  }
  return payload;
}
