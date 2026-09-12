import { ExtensionMessage } from '../../shared/messaging/message-types';

export type PlayerEventType =
  | 'PLAYER_PLAYING'
  | 'PLAYER_PAUSED'
  | 'PLAYER_BUFFERING'
  | 'PLAYER_SEEKED'
  | 'PLAYER_ENDED';

export interface PlayerEventPayload {
  currentTimeMs: number;
  durationMs?: number;
  bufferedUntilMs?: number;
  previousTimeMs?: number;
}

export interface NormalizedPlayerEvent {
  type: PlayerEventType;
  payload: PlayerEventPayload;
}

export function createVideoActivationMessage<TPayload>(
  type: string,
  payload: TPayload,
  context: {
    correlationId: string;
    tabId: number;
    youtubeVideoId: string;
    occurredAtUtc?: string;
  },
): ExtensionMessage<TPayload> {
  return {
    type,
    contractVersion: '0.1.0',
    correlationId: context.correlationId,
    tabId: context.tabId,
    youtubeVideoId: context.youtubeVideoId,
    occurredAtUtc: context.occurredAtUtc ?? new Date().toISOString(),
    payload,
  };
}
