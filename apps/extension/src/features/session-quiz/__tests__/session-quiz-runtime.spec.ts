import { describe, expect, it } from 'vitest';
import type { ExtensionMessage } from '../../../shared/messaging/message-types';
import { SessionQuizRuntime, type MessageSubscriberPort } from '../services/session-quiz-runtime';
import type { SegmentApiPort } from '../services/segment-manager';
import type { SessionApiPort } from '../state/session-types';
import type { Clock } from '../services/study-timer';
import type { CreateStudySegmentRequest, SessionSnapshot, StudySegmentRef } from '../models/session-quiz-contracts';

// ============================================================
// doubles
// ============================================================

const VIDEO_ID = 'dQw4w9WgXcQ';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

const decision = {
  decisionId: '11111111-1111-4111-8111-111111111111',
  state: 'active' as const,
  source: 'manual' as const,
  reasonCode: 'userEnabled',
  preferences: { quizIntervalMinutes: 5 as const, questionType: 'multipleChoice' as const, difficulty: 'medium' as const },
};

class FakeClock implements Clock {
  public constructor(private value = 0) {}
  public nowMs(): number { return this.value; }
  public advance(ms: number): void { this.value += ms; }
}

class FakeApi implements SessionApiPort, SegmentApiPort {
  public starts = 0;
  public completions: { activeStudyMs: number; reason: string }[] = [];
  public segments: CreateStudySegmentRequest[] = [];

  public async start(): Promise<SessionSnapshot> {
    this.starts += 1;
    return { sessionId: SESSION_ID, youtubeVideoId: VIDEO_ID, status: 'active', activeStudyMs: 0, startedAtUtc: '2026-09-16T10:00:00Z' };
  }

  public async complete(_sessionId: string, request: { reason: string; activeStudyMs: number }): Promise<SessionSnapshot> {
    this.completions.push({ activeStudyMs: request.activeStudyMs, reason: request.reason });
    return {
      sessionId: SESSION_ID,
      youtubeVideoId: VIDEO_ID,
      status: 'completed',
      activeStudyMs: request.activeStudyMs,
      startedAtUtc: '2026-09-16T10:00:00Z',
      completedAtUtc: '2026-09-16T10:10:00Z',
    };
  }

  public async createSegment(sessionId: string, request: CreateStudySegmentRequest): Promise<StudySegmentRef> {
    this.segments.push(request);
    return { segmentId: `segment-${this.segments.length}`, sessionId, youtubeVideoId: VIDEO_ID, startMs: 0, endMs: 300000 };
  }
}

class FakeBus implements MessageSubscriberPort {
  private readonly handlers = new Map<string, Set<(message: ExtensionMessage) => void>>();

  public subscribe(type: string, handler: (message: ExtensionMessage) => void): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  public async emit(type: string, payload: unknown, youtubeVideoId = VIDEO_ID): Promise<void> {
    const message: ExtensionMessage = {
      type,
      contractVersion: '0.1.0',
      correlationId: 'c-1',
      tabId: 7,
      youtubeVideoId,
      occurredAtUtc: '2026-09-16T10:00:00Z',
      payload,
    };
    this.handlers.get(type)?.forEach((handler) => handler(message));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function build() {
  const api = new FakeApi();
  const bus = new FakeBus();
  const clock = new FakeClock();
  const runtime = new SessionQuizRuntime({ api, bus, clock, createCompletionId: () => 'completion-1' });
  const dispose = runtime.start();
  return { api, bus, clock, runtime, dispose };
}

// ============================================================
// activation to session
// ============================================================

describe('SessionQuizRuntime activation', () => {
  it('starts a session from an active activation decision', async () => {
    const { api, bus, runtime } = build();

    await bus.emit('ACTIVATION_DECIDED', decision);

    expect(api.starts).toBe(1);
    expect(runtime.getStore().getState().status).toBe('active');
    expect(runtime.getStore().getState().session?.sessionId).toBe(SESSION_ID);
  });

  it('ignores an inactive decision and duplicated activations', async () => {
    const { api, bus } = build();

    await bus.emit('ACTIVATION_DECIDED', { ...decision, state: 'inactive' });
    expect(api.starts).toBe(0);

    await bus.emit('ACTIVATION_DECIDED', decision);
    await bus.emit('ACTIVATION_DECIDED', decision);
    expect(api.starts).toBe(1);
  });
});

// ============================================================
// timer and segment through player events
// ============================================================

describe('SessionQuizRuntime playback', () => {
  it('counts only playing time and closes a segment at the interval', async () => {
    const { api, bus, clock, runtime } = build();
    await bus.emit('ACTIVATION_DECIDED', decision);

    await bus.emit('PLAYER_PLAYING', { currentTimeMs: 0, durationMs: 1800000 });
    clock.advance(120000);
    await bus.emit('PLAYER_PAUSED', { currentTimeMs: 120000 });
    clock.advance(600000);
    await bus.emit('PLAYER_PLAYING', { currentTimeMs: 120000 });
    clock.advance(180000);
    await bus.emit('PLAYER_PAUSED', { currentTimeMs: 300000 });

    expect(runtime.getStore().getState().activeStudyMs).toBe(300000);
    expect(api.segments).toHaveLength(1);
    expect(api.segments[0].activeStudyMs).toBe(300000);
    expect(api.segments[0].playbackSpans).toEqual([
      { startMs: 0, endMs: 120000 },
      { startMs: 120000, endMs: 300000 },
    ]);
    expect(runtime.getStore().getState().lastSegment?.segmentId).toBe('segment-1');
  });

  it('ignores player events from another video', async () => {
    const { api, bus, clock } = build();
    await bus.emit('ACTIVATION_DECIDED', decision);

    await bus.emit('PLAYER_PLAYING', { currentTimeMs: 0 }, 'otherVideoId');
    clock.advance(300000);
    await bus.emit('PLAYER_PAUSED', { currentTimeMs: 300000 }, 'otherVideoId');

    expect(api.segments).toHaveLength(0);
  });
});

// ============================================================
// completion paths
// ============================================================

describe('SessionQuizRuntime completion', () => {
  it('completes the session when activation stops', async () => {
    const { api, bus, clock, runtime } = build();
    await bus.emit('ACTIVATION_DECIDED', decision);
    await bus.emit('PLAYER_PLAYING', { currentTimeMs: 0 });
    clock.advance(45000);

    await bus.emit('ACTIVATION_STOPPED', { reasonCode: 'userDisabled' });

    expect(api.completions).toEqual([{ activeStudyMs: 45000, reason: 'activationStopped' }]);
    expect(runtime.getStore().getState().status).toBe('completed');
  });

  it('completes the session when the video ends or changes', async () => {
    const ended = build();
    await ended.bus.emit('ACTIVATION_DECIDED', decision);
    await ended.bus.emit('PLAYER_PLAYING', { currentTimeMs: 0 });
    ended.clock.advance(20000);
    await ended.bus.emit('PLAYER_ENDED', { currentTimeMs: 20000 });
    expect(ended.api.completions[0]).toEqual({ activeStudyMs: 20000, reason: 'videoEnded' });

    const changed = build();
    await changed.bus.emit('ACTIVATION_DECIDED', decision);
    await changed.bus.emit('PLAYER_PLAYING', { currentTimeMs: 0 });
    changed.clock.advance(30000);
    await changed.bus.emit('VIDEO_CONTEXT_CHANGED', { currentTimeMs: 0 }, 'anotherVideo');
    expect(changed.api.completions[0]).toEqual({ activeStudyMs: 30000, reason: 'videoChanged' });
  });

  it('stops reacting to events after dispose', async () => {
    const { api, bus, clock, dispose } = build();
    await bus.emit('ACTIVATION_DECIDED', decision);
    dispose();

    await bus.emit('PLAYER_PLAYING', { currentTimeMs: 0 });
    clock.advance(300000);
    await bus.emit('PLAYER_PAUSED', { currentTimeMs: 300000 });

    expect(api.segments).toHaveLength(0);
    expect(api.completions).toHaveLength(0);
  });
});
