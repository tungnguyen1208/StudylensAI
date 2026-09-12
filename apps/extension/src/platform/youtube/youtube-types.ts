export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export type PlaybackState = 'playing' | 'paused' | 'buffering' | 'ended';

export interface YoutubeVideoContext {
  youtubeVideoId: string;
  canonicalUrl: string;
  title: string;
  durationMs?: number;
  currentTimeMs: number;
  playbackState?: PlaybackState;
}

export type VideoDetectionResult =
  | { status: 'supported'; context: YoutubeVideoContext }
  | {
      status: 'unsupported';
      reason: 'notYoutube' | 'notWatchPage' | 'missingVideoId' | 'invalidVideoId';
      url: string;
    }
  | {
      status: 'unavailable';
      reason: 'playerNotReady' | 'metadataMissing';
      youtubeVideoId: string;
      canonicalUrl: string;
    };

export interface BufferedRangesPort {
  readonly length: number;
  end(index: number): number;
}

export interface YoutubeVideoElementPort {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  readonly buffered: BufferedRangesPort;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface YoutubeEnvironment {
  getUrl(): string;
  getTitle(): string;
  getVideoElement(): YoutubeVideoElementPort | null;
  subscribeNavigation(listener: () => void): () => void;
  subscribeDomChanges(listener: () => void): () => void;
  schedule(callback: () => void): void;
}

export function secondsToMilliseconds(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  return Math.round(seconds * 1000);
}
