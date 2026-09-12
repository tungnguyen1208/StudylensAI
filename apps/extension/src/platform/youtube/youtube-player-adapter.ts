import { NormalizedPlayerEvent, PlayerEventPayload, PlayerEventType } from './youtube-events';
import { YoutubeVideoElementPort, secondsToMilliseconds } from './youtube-types';

export interface PlayerPort {
  getCurrentTimeMs(): number | null;
  getDurationMs(): number | null;
  isPlaying(): boolean;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(timestampMs: number): Promise<void>;
}

export type PlayerAdapterErrorCode =
  | 'playerUnavailable'
  | 'invalidTimestamp'
  | 'timestampOutOfRange'
  | 'videoContextChanged';

export class PlayerAdapterError extends Error {
  public readonly code: PlayerAdapterErrorCode;

  public constructor(code: PlayerAdapterErrorCode, message: string) {
    super(message);
    this.name = 'PlayerAdapterError';
    this.code = code;
  }
}

export interface PlayerAdapterEnvironment {
  getVideoElement(): YoutubeVideoElementPort | null;
  getCurrentYoutubeVideoId(): string | null;
}

export class YoutubePlayerAdapter implements PlayerPort {
  private readonly environment: PlayerAdapterEnvironment;
  private readonly boundYoutubeVideoId: string;
  private readonly onEvent: (event: NormalizedPlayerEvent) => void;
  private video: YoutubeVideoElementPort | null = null;
  private listeners: Array<{ type: string; listener: () => void }> = [];
  private previousTimeMs: number | undefined;

  public constructor(
    environment: PlayerAdapterEnvironment,
    boundYoutubeVideoId: string,
    onEvent: (event: NormalizedPlayerEvent) => void,
  ) {
    this.environment = environment;
    this.boundYoutubeVideoId = boundYoutubeVideoId;
    this.onEvent = onEvent;
  }

  public start(): void {
    if (this.video) {
      return;
    }

    const video = this.environment.getVideoElement();
    if (!video) {
      throw new PlayerAdapterError('playerUnavailable', 'YouTube player is not available.');
    }

    this.video = video;
    this.listen('playing', () => this.emit('PLAYER_PLAYING'));
    this.listen('pause', () => this.emit('PLAYER_PAUSED'));
    this.listen('waiting', () => this.emit('PLAYER_BUFFERING'));
    this.listen('seeking', () => {
      this.previousTimeMs = this.getCurrentTimeMs() ?? undefined;
    });
    this.listen('seeked', () => {
      this.emit('PLAYER_SEEKED', { previousTimeMs: this.previousTimeMs });
      this.previousTimeMs = undefined;
    });
    this.listen('ended', () => this.emit('PLAYER_ENDED'));
  }

  public dispose(): void {
    if (!this.video) {
      return;
    }

    this.listeners.forEach(({ type, listener }) => this.video?.removeEventListener(type, listener));
    this.listeners = [];
    this.video = null;
    this.previousTimeMs = undefined;
  }

  public getCurrentTimeMs(): number | null {
    return this.video ? secondsToMilliseconds(this.video.currentTime) : null;
  }

  public getDurationMs(): number | null {
    return this.video ? secondsToMilliseconds(this.video.duration) : null;
  }

  public isPlaying(): boolean {
    return this.video !== null && !this.video.paused && !this.video.ended;
  }

  public async play(): Promise<void> {
    this.assertContext();
    await this.requireVideo().play();
  }

  public async pause(): Promise<void> {
    this.assertContext();
    this.requireVideo().pause();
  }

  public async seek(timestampMs: number): Promise<void> {
    this.assertContext();
    if (!Number.isFinite(timestampMs) || !Number.isInteger(timestampMs) || timestampMs < 0) {
      throw new PlayerAdapterError('invalidTimestamp', 'Timestamp must be a non-negative integer.');
    }

    const video = this.requireVideo();
    const durationMs = this.getDurationMs();
    if (durationMs !== null && timestampMs > durationMs) {
      throw new PlayerAdapterError('timestampOutOfRange', 'Timestamp exceeds video duration.');
    }

    video.currentTime = timestampMs / 1000;
  }

  private listen(type: string, listener: () => void): void {
    this.video?.addEventListener(type, listener);
    this.listeners.push({ type, listener });
  }

  private emit(type: PlayerEventType, extra: Partial<PlayerEventPayload> = {}): void {
    const currentTimeMs = this.getCurrentTimeMs();
    if (currentTimeMs === null) {
      return;
    }

    const durationMs = this.getDurationMs();
    const payload: PlayerEventPayload = { currentTimeMs, ...extra };
    if (durationMs !== null) {
      payload.durationMs = durationMs;
    }

    if (type === 'PLAYER_BUFFERING') {
      const bufferedUntilMs = this.getBufferedUntilMs();
      if (bufferedUntilMs !== null) {
        payload.bufferedUntilMs = bufferedUntilMs;
      }
    }

    this.onEvent({ type, payload });
  }

  private getBufferedUntilMs(): number | null {
    const video = this.video;
    if (!video || video.buffered.length === 0) {
      return null;
    }

    try {
      return secondsToMilliseconds(video.buffered.end(video.buffered.length - 1));
    } catch {
      return null;
    }
  }

  private assertContext(): void {
    if (this.environment.getCurrentYoutubeVideoId() !== this.boundYoutubeVideoId) {
      throw new PlayerAdapterError('videoContextChanged', 'YouTube video context has changed.');
    }
  }

  private requireVideo(): YoutubeVideoElementPort {
    if (!this.video) {
      throw new PlayerAdapterError('playerUnavailable', 'YouTube player is not available.');
    }
    return this.video;
  }
}
