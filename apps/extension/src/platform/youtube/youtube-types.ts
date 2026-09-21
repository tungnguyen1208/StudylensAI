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

export function secondsToMilliseconds(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  return Math.round(seconds * 1000);
}
