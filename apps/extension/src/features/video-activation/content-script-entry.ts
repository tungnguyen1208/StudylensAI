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
  createDomTranscriptSource,
  readTranscript,
} from '../../platform/youtube/transcript-reader';
import { ExtensionMessage } from '../../shared/messaging/message-types';
import { messageBus } from '../../shared/messaging/message-bus';
import { TranscriptService } from './services/transcript-service';

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
  let playerAdapter: YoutubePlayerAdapter | null = null;
  let contextVersion = 0;

  const detector = new YoutubeVideoDetector(environment, (detection) => {
    contextVersion += 1;
    const capturedVersion = contextVersion;

    if (detection.status !== 'supported') {
      playerAdapter?.dispose();
      playerAdapter = null;
      return;
    }

    const { context } = detection;
    playerAdapter?.dispose();
    const correlationId = crypto.randomUUID();

    void publish(
      createVideoActivationMessage('VIDEO_CONTEXT_CHANGED', toContextPayload(context), {
        correlationId,
        tabId: options.tabId,
        youtubeVideoId: context.youtubeVideoId,
      }),
    );

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

    const transcript = readTranscript(createDomTranscriptSource());
    void transcriptService.upload(context.youtubeVideoId, transcript).then(
      () => {
        if (capturedVersion !== contextVersion) {
          return;
        }
      },
      () => {
        // Transcript/backend failure must never interrupt YouTube playback.
      },
    );
  });

  detector.start();

  return {
    getPlayerPort: () => playerAdapter,
    dispose: () => {
      contextVersion += 1;
      playerAdapter?.dispose();
      playerAdapter = null;
      detector.dispose();
    },
  };
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
