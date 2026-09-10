import { describe, expect, it } from 'vitest';
import {
  PlayerAdapterError,
  YoutubePlayerAdapter,
} from '../youtube-player-adapter';
import { NormalizedPlayerEvent } from '../youtube-events';
import { YoutubeVideoElementPort } from '../youtube-types';

class FakeVideo implements YoutubeVideoElementPort {
  public currentTime = 5;
  public duration = 120;
  public paused = true;
  public ended = false;
  public buffered = { length: 1, end: () => 14 };
  public playCalls = 0;
  public pauseCalls = 0;
  private readonly listeners = new Map<string, Set<() => void>>();

  public async play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
  }

  public pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
  }

  public addEventListener(type: string, listener: () => void): void {
    const entries = this.listeners.get(type) ?? new Set();
    entries.add(listener);
    this.listeners.set(type, entries);
  }

  public removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public dispatch(type: string): void {
    this.listeners.get(type)?.forEach((listener) => listener());
  }

  public listenerCount(): number {
    return Array.from(this.listeners.values()).reduce((total, entries) => total + entries.size, 0);
  }
}

describe('YoutubePlayerAdapter', () => {
  it('reports a typed error when the player is unavailable', () => {
    const adapter = new YoutubePlayerAdapter(
      { getVideoElement: () => null, getCurrentYoutubeVideoId: () => 'dQw4w9WgXcQ' },
      'dQw4w9WgXcQ',
      () => undefined,
    );
    expect(() => adapter.start()).toThrowError(PlayerAdapterError);
  });

  it('maps media events to millisecond payloads', () => {
    const video = new FakeVideo();
    const events: NormalizedPlayerEvent[] = [];
    const adapter = new YoutubePlayerAdapter(
      { getVideoElement: () => video, getCurrentYoutubeVideoId: () => 'dQw4w9WgXcQ' },
      'dQw4w9WgXcQ',
      (event) => events.push(event),
    );

    adapter.start();
    adapter.start();
    video.dispatch('playing');
    video.dispatch('waiting');
    video.dispatch('seeking');
    video.currentTime = 60;
    video.dispatch('seeked');
    video.dispatch('ended');

    expect(events).toEqual([
      { type: 'PLAYER_PLAYING', payload: { currentTimeMs: 5000, durationMs: 120000 } },
      {
        type: 'PLAYER_BUFFERING',
        payload: { currentTimeMs: 5000, durationMs: 120000, bufferedUntilMs: 14000 },
      },
      {
        type: 'PLAYER_SEEKED',
        payload: { currentTimeMs: 60000, durationMs: 120000, previousTimeMs: 5000 },
      },
      { type: 'PLAYER_ENDED', payload: { currentTimeMs: 60000, durationMs: 120000 } },
    ]);

    expect(video.listenerCount()).toBe(6);
    adapter.dispose();
    adapter.dispose();
    expect(video.listenerCount()).toBe(0);
  });

  it('validates seek boundaries and the bound video context', async () => {
    const video = new FakeVideo();
    let currentVideoId = 'dQw4w9WgXcQ';
    const adapter = new YoutubePlayerAdapter(
      { getVideoElement: () => video, getCurrentYoutubeVideoId: () => currentVideoId },
      'dQw4w9WgXcQ',
      () => undefined,
    );
    adapter.start();

    await adapter.seek(0);
    expect(video.currentTime).toBe(0);
    await adapter.seek(120000);
    expect(video.currentTime).toBe(120);
    await expect(adapter.seek(-1)).rejects.toMatchObject({ code: 'invalidTimestamp' });
    await expect(adapter.seek(120001)).rejects.toMatchObject({ code: 'timestampOutOfRange' });
    await expect(adapter.seek(Number.NaN)).rejects.toMatchObject({ code: 'invalidTimestamp' });

    currentVideoId = 'abcdefghijk';
    await expect(adapter.seek(1000)).rejects.toMatchObject({ code: 'videoContextChanged' });
  });
});
