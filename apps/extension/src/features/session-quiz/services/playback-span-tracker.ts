import type { PlayerLifecycleEvent } from './study-timer';

// ============================================================
// types
// ============================================================

export interface PlaybackSpan {
  startMs: number;
  endMs: number;
}

export interface PlaybackEvent {
  type: PlayerLifecycleEvent;
  currentTimeMs: number;
  durationMs?: number;
  previousTimeMs?: number;
}

export interface PlaybackSpanTrackerSnapshot {
  spans: PlaybackSpan[];
  openSpanStartMs: number | null;
  lastPositionMs: number;
  durationMs: number | null;
}

const CLOSING_EVENTS: ReadonlySet<PlayerLifecycleEvent> = new Set([
  'PLAYER_PAUSED',
  'PLAYER_BUFFERING',
  'PLAYER_SEEKED',
  'PLAYER_ENDED',
  'ACTIVATION_DISABLED',
]);

// ============================================================
// tracker
// ============================================================

export class PlaybackSpanTracker {
  private spans: PlaybackSpan[] = [];
  private openSpanStartMs: number | null = null;
  private lastPositionMs = 0;
  private durationMs: number | null = null;

  public handle(event: PlaybackEvent): PlaybackSpan | null {
    this.rememberDuration(event.durationMs);
    const position = normalizePosition(event.currentTimeMs);

    if (event.type === 'PLAYER_PLAYING') {
      const closed = this.closeAt(position);
      this.openSpanStartMs = this.clamp(position);
      this.lastPositionMs = position;
      return closed;
    }

    if (!CLOSING_EVENTS.has(event.type)) {
      this.lastPositionMs = position;
      return null;
    }

    const endMs = event.type === 'PLAYER_SEEKED'
      ? normalizePosition(event.previousTimeMs ?? this.lastPositionMs)
      : position;
    const closed = this.closeAt(endMs);
    this.lastPositionMs = position;
    return closed;
  }

  public closeOpenSpan(atMs?: number): PlaybackSpan | null {
    return this.closeAt(normalizePosition(atMs ?? this.lastPositionMs));
  }

  public peek(): readonly PlaybackSpan[] {
    return this.spans;
  }

  public hasOpenSpan(): boolean {
    return this.openSpanStartMs !== null;
  }

  public drain(): PlaybackSpan[] {
    const drained = this.spans;
    this.spans = [];
    return drained;
  }

  public reset(): void {
    this.spans = [];
    this.openSpanStartMs = null;
    this.lastPositionMs = 0;
    this.durationMs = null;
  }

  public snapshot(): PlaybackSpanTrackerSnapshot {
    return {
      spans: this.spans.map((span) => ({ ...span })),
      openSpanStartMs: this.openSpanStartMs,
      lastPositionMs: this.lastPositionMs,
      durationMs: this.durationMs,
    };
  }

  public restore(snapshot: PlaybackSpanTrackerSnapshot): void {
    this.durationMs = snapshot.durationMs;
    this.lastPositionMs = normalizePosition(snapshot.lastPositionMs);
    this.spans = snapshot.spans.map((span) => ({ ...span })).filter((span) => span.endMs > span.startMs);
    this.openSpanStartMs = null;
  }

  // ============================================================
  // internals
  // ============================================================

  private closeAt(endMs: number): PlaybackSpan | null {
    if (this.openSpanStartMs === null) return null;
    const startMs = this.openSpanStartMs;
    this.openSpanStartMs = null;
    const clampedEnd = this.clamp(endMs);
    if (clampedEnd <= startMs) return null;
    const span: PlaybackSpan = { startMs, endMs: clampedEnd };
    this.spans.push(span);
    return span;
  }

  private clamp(positionMs: number): number {
    if (this.durationMs === null) return positionMs;
    return Math.min(positionMs, this.durationMs);
  }

  private rememberDuration(durationMs?: number): void {
    if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) return;
    this.durationMs = Math.trunc(durationMs);
  }
}

// ============================================================
// helpers
// ============================================================

export function totalWatchedMs(spans: readonly PlaybackSpan[]): number {
  return spans.reduce((total, span) => total + (span.endMs - span.startMs), 0);
}

export function spanBounds(spans: readonly PlaybackSpan[]): { startMs: number; endMs: number } | null {
  if (spans.length === 0) return null;
  return {
    startMs: Math.min(...spans.map((span) => span.startMs)),
    endMs: Math.max(...spans.map((span) => span.endMs)),
  };
}

function normalizePosition(positionMs: number): number {
  if (!Number.isFinite(positionMs) || positionMs < 0) return 0;
  return Math.trunc(positionMs);
}
