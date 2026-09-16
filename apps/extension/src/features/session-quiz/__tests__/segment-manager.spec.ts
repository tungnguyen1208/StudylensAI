import { describe, expect, it } from 'vitest';
import { PlaybackSpanTracker } from '../services/playback-span-tracker';
import {
  SegmentManager,
  type PendingSegmentStore,
  type SegmentApiPort,
  type SegmentManagerSnapshot,
} from '../services/segment-manager';
import type { CreateStudySegmentRequest, StudySegmentRef } from '../models/session-quiz-contracts';

// ============================================================
// doubles
// ============================================================

const SESSION_ID = '22222222-2222-4222-8222-222222222222';

class FakeSegmentApi implements SegmentApiPort {
  public readonly requests: CreateStudySegmentRequest[] = [];
  public failures = 0;
  public error: unknown = { code: 'networkError' };

  public async createSegment(sessionId: string, request: CreateStudySegmentRequest): Promise<StudySegmentRef> {
    this.requests.push(request);
    if (this.failures > 0) {
      this.failures -= 1;
      throw this.error;
    }
    const bounds = request.playbackSpans.reduce(
      (acc, span) => ({ startMs: Math.min(acc.startMs, span.startMs), endMs: Math.max(acc.endMs, span.endMs) }),
      { startMs: Number.MAX_SAFE_INTEGER, endMs: 0 },
    );
    return { segmentId: `segment-${this.requests.length}`, sessionId, youtubeVideoId: 'dQw4w9WgXcQ', ...bounds };
  }
}

class MemoryPendingStore implements PendingSegmentStore {
  private snapshot: SegmentManagerSnapshot | null = null;
  public async save(snapshot: SegmentManagerSnapshot): Promise<void> { this.snapshot = JSON.parse(JSON.stringify(snapshot)); }
  public async load(): Promise<SegmentManagerSnapshot | null> { return this.snapshot; }
}

function build(api: SegmentApiPort, tracker = new PlaybackSpanTracker(), store?: PendingSegmentStore) {
  let counter = 0;
  const manager = new SegmentManager({
    sessionId: SESSION_ID,
    intervalMinutes: 5,
    api,
    tracker,
    store,
    minRetryIntervalMs: 0,
    createClientSegmentId: () => `client-segment-${++counter}`,
  });
  return { manager, tracker };
}

function watch(tracker: PlaybackSpanTracker, startMs: number, endMs: number): void {
  tracker.handle({ type: 'PLAYER_PLAYING', currentTimeMs: startMs, durationMs: 1_800_000 });
  tracker.handle({ type: 'PLAYER_PAUSED', currentTimeMs: endMs, durationMs: 1_800_000 });
}

// ============================================================
// interval trigger
// ============================================================

describe('SegmentManager interval trigger', () => {
  it('does nothing before the configured interval is reached', async () => {
    const api = new FakeSegmentApi();
    const { manager, tracker } = build(api);
    watch(tracker, 0, 200_000);

    expect((await manager.onActiveStudyMs(299_999)).status).toBe('idle');
    expect(api.requests).toHaveLength(0);
  });

  it('creates exactly one segment when the interval is reached', async () => {
    const api = new FakeSegmentApi();
    const { manager, tracker } = build(api);
    watch(tracker, 0, 300_000);

    const attempt = await manager.onActiveStudyMs(300_000);

    expect(attempt.status).toBe('created');
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0].playbackSpans).toEqual([{ startMs: 0, endMs: 300_000 }]);
    expect(api.requests[0].activeStudyMs).toBe(300_000);
    expect(api.requests[0].idempotencyKey).toBe(`segment:${SESSION_ID}:client-segment-1`);
  });

  it('opens the next cycle only at the next multiple of the interval', async () => {
    const api = new FakeSegmentApi();
    const { manager, tracker } = build(api);
    watch(tracker, 0, 300_000);
    await manager.onActiveStudyMs(300_000);

    watch(tracker, 300_000, 500_000);
    expect((await manager.onActiveStudyMs(500_000)).status).toBe('idle');

    watch(tracker, 500_000, 600_000);
    expect((await manager.onActiveStudyMs(600_000)).status).toBe('created');
    expect(api.requests).toHaveLength(2);
    expect(api.requests[1].clientSegmentId).toBe('client-segment-2');
  });

  it('closes the open span at the current position when the interval hits mid-playback', async () => {
    const api = new FakeSegmentApi();
    const { manager, tracker } = build(api);
    tracker.handle({ type: 'PLAYER_PLAYING', currentTimeMs: 0, durationMs: 1_800_000 });

    await manager.onActiveStudyMs(300_000, 300_000);

    expect(api.requests[0].playbackSpans).toEqual([{ startMs: 0, endMs: 300_000 }]);
    expect(tracker.peek()).toEqual([]);
  });

  it('skips a cycle with no watched span instead of sending an empty segment', async () => {
    const api = new FakeSegmentApi();
    const { manager } = build(api);

    expect((await manager.onActiveStudyMs(300_000)).status).toBe('idle');
    expect(api.requests).toHaveLength(0);
    expect(manager.nextThresholdMs).toBe(600_000);
  });
});

// ============================================================
// retry and idempotency
// ============================================================

describe('SegmentManager retry behaviour', () => {
  it('reuses the same clientSegmentId after a retryable failure', async () => {
    const api = new FakeSegmentApi();
    api.failures = 2;
    const { manager, tracker } = build(api);
    watch(tracker, 0, 300_000);

    const first = await manager.onActiveStudyMs(300_000);
    expect(first.status).toBe('retryable');
    expect(manager.getPending()?.clientSegmentId).toBe('client-segment-1');

    await manager.retryPending();
    const third = await manager.retryPending();

    expect(third.status).toBe('created');
    expect(api.requests).toHaveLength(3);
    expect(new Set(api.requests.map((request) => request.clientSegmentId))).toEqual(new Set(['client-segment-1']));
    expect(manager.getPending()).toBeNull();
  });

  it('does not start a new cycle while a segment is still pending', async () => {
    const api = new FakeSegmentApi();
    api.failures = 1;
    const { manager, tracker } = build(api);
    watch(tracker, 0, 300_000);
    await manager.onActiveStudyMs(300_000);

    watch(tracker, 300_000, 600_000);
    const attempt = await manager.onActiveStudyMs(600_000);

    expect(attempt.status).toBe('created');
    expect(api.requests).toHaveLength(2);
    expect(api.requests.every((request) => request.clientSegmentId === 'client-segment-1')).toBe(true);
  });

  it('stops retrying when the Backend reports a non-retryable code', async () => {
    const api = new FakeSegmentApi();
    api.failures = 1;
    api.error = { code: 'transcriptInsufficient' };
    const { manager, tracker } = build(api);
    watch(tracker, 0, 300_000);

    const attempt = await manager.onActiveStudyMs(300_000);

    expect(attempt).toMatchObject({ status: 'blocked', code: 'transcriptInsufficient' });
    expect(manager.getPending()).toBeNull();
    expect(manager.nextThresholdMs).toBe(600_000);
  });

  it('keeps the pending segment across a service worker restart', async () => {
    const store = new MemoryPendingStore();
    const api = new FakeSegmentApi();
    api.failures = 1;
    const first = build(api, new PlaybackSpanTracker(), store);
    watch(first.tracker, 0, 300_000);
    await first.manager.onActiveStudyMs(300_000);

    const revived = build(api, new PlaybackSpanTracker(), store);
    const hydrated = await revived.manager.hydrate();
    expect(hydrated?.pending?.clientSegmentId).toBe('client-segment-1');

    const attempt = await revived.manager.retryPending();
    expect(attempt.status).toBe('created');
    expect(api.requests.every((request) => request.clientSegmentId === 'client-segment-1')).toBe(true);
  });
});

// ============================================================
// regression guards
// ============================================================

describe('SegmentManager failure classification', () => {
  it('treats any non-retryable error envelope as blocked instead of retrying forever', async () => {
    const api = new FakeSegmentApi();
    api.failures = 1;
    api.error = { code: 'invalidPlaybackSpans', status: 400, retryable: false };
    const { manager, tracker } = build(api);
    watch(tracker, 0, 300_000);

    const attempt = await manager.onActiveStudyMs(300_000);

    expect(attempt).toMatchObject({ status: 'blocked', code: 'invalidPlaybackSpans' });
    expect(manager.getPending()).toBeNull();
  });

  it('throttles automatic retries but honours an explicit retry', async () => {
    const api = new FakeSegmentApi();
    api.failures = 3;
    api.error = { code: 'NETWORK_ERROR', status: 0, retryable: true };
    let now = 0;
    const tracker = new PlaybackSpanTracker();
    const manager = new SegmentManager({
      sessionId: SESSION_ID,
      intervalMinutes: 5,
      api,
      tracker,
      clock: { nowMs: () => now },
      minRetryIntervalMs: 5_000,
      createClientSegmentId: () => 'client-segment-1',
    });
    watch(tracker, 0, 300_000);

    expect((await manager.onActiveStudyMs(300_000)).status).toBe('retryable');
    expect(api.requests).toHaveLength(1);

    now = 1_000;
    expect((await manager.onActiveStudyMs(300_000)).status).toBe('pending');
    expect(api.requests).toHaveLength(1);

    now = 7_000;
    expect((await manager.onActiveStudyMs(300_000)).status).toBe('retryable');
    expect(api.requests).toHaveLength(2);

    expect((await manager.retryPending()).status).toBe('retryable');
    expect(api.requests).toHaveLength(3);
  });

  it('ignores a stored snapshot that belongs to another session', async () => {
    const store = new MemoryPendingStore();
    const api = new FakeSegmentApi();
    api.failures = 1;
    const first = build(api, new PlaybackSpanTracker(), store);
    watch(first.tracker, 0, 300_000);
    await first.manager.onActiveStudyMs(300_000);

    const other = new SegmentManager({
      sessionId: 'another-session-id',
      intervalMinutes: 5,
      api,
      tracker: new PlaybackSpanTracker(),
      store,
    });

    expect(await other.hydrate()).toBeNull();
    expect(other.getPending()).toBeNull();
    expect(other.nextThresholdMs).toBe(300_000);
  });
});
