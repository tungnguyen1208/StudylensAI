import type { PlaybackSpan, PlaybackSpanTracker } from './playback-span-tracker';
import { spanBounds } from './playback-span-tracker';
import type { CreateStudySegmentRequest, StudySegmentRef } from '../models/session-quiz-contracts';
import { SESSION_QUIZ_CONTRACT_VERSION } from '../models/session-quiz-contracts';

// ============================================================
// types
// ============================================================

export interface SegmentApiPort {
  createSegment(sessionId: string, request: CreateStudySegmentRequest): Promise<StudySegmentRef>;
}

export interface PendingSegment {
  clientSegmentId: string;
  idempotencyKey: string;
  activeStudyMs: number;
  playbackSpans: PlaybackSpan[];
}

export interface SegmentManagerSnapshot {
  completedCycles: number;
  pending: PendingSegment | null;
  sessionId?: string;
}

export interface PendingSegmentStore {
  save(snapshot: SegmentManagerSnapshot): Promise<void>;
  load(): Promise<SegmentManagerSnapshot | null>;
}

export interface SegmentManagerOptions {
  sessionId: string;
  intervalMinutes: 5 | 10 | 15;
  api: SegmentApiPort;
  tracker: PlaybackSpanTracker;
  createClientSegmentId?: () => string;
  store?: PendingSegmentStore;
  clock?: { nowMs(): number };
  minRetryIntervalMs?: number;
  onSegmentCreated?: (segment: StudySegmentRef) => void;
}

export type SegmentAttempt =
  | { status: 'idle' }
  | { status: 'pending'; pending: PendingSegment }
  | { status: 'created'; segment: StudySegmentRef }
  | { status: 'retryable'; pending: PendingSegment; error: string }
  | { status: 'blocked'; pending: PendingSegment; code: string };

const NON_RETRYABLE_CODES = new Set(['transcriptUnavailable', 'transcriptInsufficient', 'segmentConflict', 'sessionCompleted', 'sessionNotFound']);
const DEFAULT_MIN_RETRY_INTERVAL_MS = 5_000;

// ============================================================
// manager
// ============================================================

export class SegmentManager {
  private completedCycles = 0;
  private pending: PendingSegment | null = null;
  private inFlight = false;
  private lastAttemptAtMs: number | null = null;

  public constructor(private readonly options: SegmentManagerOptions) {}

  public get intervalMs(): number {
    return this.options.intervalMinutes * 60_000;
  }

  public get nextThresholdMs(): number {
    return (this.completedCycles + 1) * this.intervalMs;
  }

  public getPending(): PendingSegment | null {
    return this.pending;
  }

  public snapshot(): SegmentManagerSnapshot {
    return { completedCycles: this.completedCycles, pending: this.pending, sessionId: this.options.sessionId };
  }

  public async hydrate(): Promise<SegmentManagerSnapshot | null> {
    if (!this.options.store) return null;
    const stored = await this.options.store.load();
    if (!stored) return null;
    if (stored.sessionId !== undefined && stored.sessionId !== this.options.sessionId) return null;
    this.completedCycles = Math.max(0, Math.trunc(stored.completedCycles));
    this.pending = stored.pending;
    return stored;
  }

  public async onActiveStudyMs(activeStudyMs: number, positionMs?: number): Promise<SegmentAttempt> {
    if (this.pending) return this.send(this.pending);
    if (activeStudyMs < this.nextThresholdMs) return { status: 'idle' };

    this.options.tracker.closeOpenSpan(positionMs);
    const playbackSpans = this.options.tracker.drain();
    if (playbackSpans.length === 0) {
      this.completedCycles += 1;
      await this.persist();
      return { status: 'idle' };
    }

    const clientSegmentId = (this.options.createClientSegmentId ?? defaultClientSegmentId)();
    const pending: PendingSegment = {
      clientSegmentId,
      idempotencyKey: `segment:${this.options.sessionId}:${clientSegmentId}`,
      activeStudyMs,
      playbackSpans,
    };
    this.pending = pending;
    this.lastAttemptAtMs = null;
    await this.persist();
    return this.send(pending);
  }

  public async retryPending(force = true): Promise<SegmentAttempt> {
    if (!this.pending) return { status: 'idle' };
    return force ? this.send(this.pending, { ignoreThrottle: true }) : this.send(this.pending);
  }

  public bounds(): { startMs: number; endMs: number } | null {
    return this.pending ? spanBounds(this.pending.playbackSpans) : null;
  }

  // ============================================================
  // internals
  // ============================================================

  private async send(pending: PendingSegment, options: { ignoreThrottle?: boolean } = {}): Promise<SegmentAttempt> {
    if (this.inFlight) return { status: 'pending', pending };
    if (!options.ignoreThrottle && this.isThrottled()) return { status: 'pending', pending };

    this.inFlight = true;
    this.lastAttemptAtMs = this.now();
    try {
      const segment = await this.options.api.createSegment(this.options.sessionId, {
        contractVersion: SESSION_QUIZ_CONTRACT_VERSION,
        clientSegmentId: pending.clientSegmentId,
        idempotencyKey: pending.idempotencyKey,
        activeStudyMs: pending.activeStudyMs,
        playbackSpans: pending.playbackSpans.map((span) => ({ startMs: span.startMs, endMs: span.endMs })),
      });
      this.pending = null;
      this.completedCycles += 1;
      await this.persist();
      this.options.onSegmentCreated?.(segment);
      return { status: 'created', segment };
    } catch (error: unknown) {
      if (isNonRetryable(error)) {
        this.pending = null;
        this.completedCycles += 1;
        await this.persist();
        return { status: 'blocked', pending, code: errorCode(error) };
      }
      return { status: 'retryable', pending, error: errorCode(error) };
    } finally {
      this.inFlight = false;
    }
  }

  private isThrottled(): boolean {
    if (this.lastAttemptAtMs === null) return false;
    const minInterval = this.options.minRetryIntervalMs ?? DEFAULT_MIN_RETRY_INTERVAL_MS;
    return this.now() - this.lastAttemptAtMs < minInterval;
  }

  private now(): number {
    return this.options.clock?.nowMs() ?? Date.now();
  }

  private async persist(): Promise<void> {
    await this.options.store?.save(this.snapshot()).catch(() => undefined);
  }
}

// ============================================================
// helpers
// ============================================================

function defaultClientSegmentId(): string {
  return crypto.randomUUID();
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return error instanceof Error ? error.message : 'segmentRequestFailed';
}

function isNonRetryable(error: unknown): boolean {
  if (error && typeof error === 'object' && 'retryable' in error && typeof (error as { retryable: unknown }).retryable === 'boolean') {
    return (error as { retryable: boolean }).retryable === false;
  }
  return NON_RETRYABLE_CODES.has(errorCode(error));
}
