import { describe, expect, it } from 'vitest';
import {
  PlaybackSpanTracker,
  spanBounds,
  totalWatchedMs,
  type PlaybackEvent,
} from '../services/playback-span-tracker';

// ============================================================
// helpers
// ============================================================

function play(currentTimeMs: number, durationMs = 300000): PlaybackEvent {
  return { type: 'PLAYER_PLAYING', currentTimeMs, durationMs };
}

function stop(type: PlaybackEvent['type'], currentTimeMs: number, previousTimeMs?: number): PlaybackEvent {
  return { type, currentTimeMs, durationMs: 300000, previousTimeMs };
}

// ============================================================
// opening and closing spans
// ============================================================

describe('PlaybackSpanTracker open/close rules', () => {
  it('records one span for continuous playback', () => {
    const tracker = new PlaybackSpanTracker();
    tracker.handle(play(0));
    tracker.handle(stop('PLAYER_PAUSED', 60000));
    expect(tracker.peek()).toEqual([{ startMs: 0, endMs: 60000 }]);
  });

  it('records one span per play/pause cycle', () => {
    const tracker = new PlaybackSpanTracker();
    tracker.handle(play(0));
    tracker.handle(stop('PLAYER_PAUSED', 30000));
    tracker.handle(play(30000));
    tracker.handle(stop('PLAYER_PAUSED', 45000));
    expect(tracker.peek()).toEqual([
      { startMs: 0, endMs: 30000 },
      { startMs: 30000, endMs: 45000 },
    ]);
    expect(totalWatchedMs(tracker.peek())).toBe(45000);
  });

  it('closes the open span on buffering, ended and activation disable', () => {
    for (const event of ['PLAYER_BUFFERING', 'PLAYER_ENDED', 'ACTIVATION_DISABLED'] as const) {
      const tracker = new PlaybackSpanTracker();
      tracker.handle(play(1000));
      const closed = tracker.handle(stop(event, 5000));
      expect(closed).toEqual({ startMs: 1000, endMs: 5000 });
      expect(tracker.hasOpenSpan()).toBe(false);
    }
  });

  it('ignores events that arrive with no open span', () => {
    const tracker = new PlaybackSpanTracker();
    expect(tracker.handle(stop('PLAYER_PAUSED', 10000))).toBeNull();
    expect(tracker.closeOpenSpan()).toBeNull();
    expect(tracker.peek()).toEqual([]);
  });
});

// ============================================================
// seek behaviour
// ============================================================

describe('PlaybackSpanTracker seek behaviour', () => {
  it('does not join two distant positions across a forward seek', () => {
    const tracker = new PlaybackSpanTracker();
    tracker.handle(play(0));
    tracker.handle(stop('PLAYER_SEEKED', 120000, 60000));
    tracker.handle(play(120000));
    tracker.handle(stop('PLAYER_PAUSED', 180000));
    expect(tracker.peek()).toEqual([
      { startMs: 0, endMs: 60000 },
      { startMs: 120000, endMs: 180000 },
    ]);
    expect(totalWatchedMs(tracker.peek())).toBe(120000);
  });

  it('keeps a replayed range as its own span after a backward seek', () => {
    const tracker = new PlaybackSpanTracker();
    tracker.handle(play(120000));
    tracker.handle(stop('PLAYER_SEEKED', 120000, 180000));
    tracker.handle(play(120000));
    tracker.handle(stop('PLAYER_PAUSED', 150000));
    expect(tracker.peek()).toEqual([
      { startMs: 120000, endMs: 180000 },
      { startMs: 120000, endMs: 150000 },
    ]);
  });

  it('never invents a span when a seek carries no previous time', () => {
    const tracker = new PlaybackSpanTracker();
    tracker.handle(play(10000));
    tracker.handle(stop('PLAYER_PAUSED', 40000));
    tracker.handle(play(40000));
    expect(tracker.handle(stop('PLAYER_SEEKED', 250000))).toBeNull();
    expect(tracker.peek()).toEqual([{ startMs: 10000, endMs: 40000 }]);
  });
});

// ============================================================
// invalid data and duration clamping
// ============================================================

describe('PlaybackSpanTracker validation', () => {
  it('drops zero-length and backwards spans', () => {
    const tracker = new PlaybackSpanTracker();
    tracker.handle(play(30000));
    expect(tracker.handle(stop('PLAYER_PAUSED', 30000))).toBeNull();
    tracker.handle(play(30000));
    expect(tracker.handle(stop('PLAYER_PAUSED', 10000))).toBeNull();
    expect(tracker.peek()).toEqual([]);
  });

  it('normalizes negative and non-finite positions to zero', () => {
    const tracker = new PlaybackSpanTracker();
    tracker.handle({ type: 'PLAYER_PLAYING', currentTimeMs: -5000 });
    tracker.handle({ type: 'PLAYER_PAUSED', currentTimeMs: Number.NaN });
    expect(tracker.peek()).toEqual([]);
    tracker.handle({ type: 'PLAYER_PLAYING', currentTimeMs: -1 });
    tracker.handle({ type: 'PLAYER_PAUSED', currentTimeMs: 4000 });
    expect(tracker.peek()).toEqual([{ startMs: 0, endMs: 4000 }]);
  });

  it('clamps a span to the known duration', () => {
    const tracker = new PlaybackSpanTracker();
    tracker.handle(play(290000, 300000));
    tracker.handle(stop('PLAYER_ENDED', 999999));
    expect(tracker.peek()).toEqual([{ startMs: 290000, endMs: 300000 }]);
  });
});

// ============================================================
// segment cycle and suspend/restore
// ============================================================

describe('PlaybackSpanTracker cycle handling', () => {
  it('drains spans for one interval and starts the next cycle empty', () => {
    const tracker = new PlaybackSpanTracker();
    tracker.handle(play(0));
    tracker.handle(stop('PLAYER_PAUSED', 60000));
    expect(tracker.drain()).toEqual([{ startMs: 0, endMs: 60000 }]);
    expect(tracker.peek()).toEqual([]);
    tracker.handle(play(60000));
    tracker.handle(stop('PLAYER_PAUSED', 90000));
    expect(tracker.peek()).toEqual([{ startMs: 60000, endMs: 90000 }]);
  });

  it('closes the open span when the session completes', () => {
    const tracker = new PlaybackSpanTracker();
    tracker.handle(play(5000));
    expect(tracker.closeOpenSpan(35000)).toEqual({ startMs: 5000, endMs: 35000 });
    expect(spanBounds(tracker.peek())).toEqual({ startMs: 5000, endMs: 35000 });
  });

  it('restores confirmed spans without reopening the suspended span', () => {
    const tracker = new PlaybackSpanTracker();
    tracker.handle(play(0));
    tracker.handle(stop('PLAYER_PAUSED', 20000));
    tracker.handle(play(20000));

    const restored = new PlaybackSpanTracker();
    restored.restore(tracker.snapshot());
    expect(restored.peek()).toEqual([{ startMs: 0, endMs: 20000 }]);
    expect(restored.hasOpenSpan()).toBe(false);

    restored.handle(play(20000));
    restored.handle(stop('PLAYER_PAUSED', 25000));
    expect(restored.peek()).toEqual([
      { startMs: 0, endMs: 20000 },
      { startMs: 20000, endMs: 25000 },
    ]);
  });

  it('returns no bounds for an empty cycle', () => {
    expect(spanBounds([])).toBeNull();
    expect(totalWatchedMs([])).toBe(0);
  });
});
