import { describe, expect, it } from 'vitest';
import type { ExtensionMessage } from '../../../shared/messaging/message-types';
import { SessionQuizRuntime, type MessageSubscriberPort } from '../services/session-quiz-runtime';
import type { SegmentApiPort } from '../services/segment-manager';
import type { SessionApiPort } from '../state/session-types';
import type { Clock } from '../services/study-timer';
import type { CreateStudySegmentRequest, GenerateQuizRequest, QuizPublic, SessionSnapshot, StudySegmentRef } from '../models/session-quiz-contracts';

// ============================================================
// doubles
// ============================================================

const VIDEO_ID = 'dQw4w9WgXcQ';
const VIDEO_B_ID = '9bZkp7q19f0';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

const activation = {
  activationId: '11111111-1111-4111-8111-111111111111',
  source: 'user' as const,
  videoTitle: 'Video',
  transcriptCapture: { transcriptCaptureId: '33333333-3333-4333-8333-333333333333', youtubeVideoId: VIDEO_ID, language: 'en', source: 'youtubeCaption' as const, status: 'available' as const, availableCueCount: 1, version: 1 },
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
  public quizzes: GenerateQuizRequest[] = [];
  public failNextStart = false;

  public async start(): Promise<SessionSnapshot> {
    this.starts += 1;
    if (this.failNextStart) {
      this.failNextStart = false;
      throw Object.assign(new Error('Backend unavailable'), { code: 'sessionStartUnavailable', retryable: true, traceId: 'trace-session-1' });
    }
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

  public async generateQuiz(request: GenerateQuizRequest): Promise<QuizPublic> {
    this.quizzes.push(request);
    return {
      quizId: '44444444-4444-4444-8444-444444444444',
      sessionId: request.sessionId,
      segmentId: request.segmentId,
      status: 'available',
      createdAtUtc: '2026-09-16T10:05:00Z',
      questions: [{
        questionId: '55555555-5555-4555-8555-555555555555',
        type: 'multipleChoice',
        prompt: 'Question',
        options: [{ optionId: 'a', text: 'A' }, { optionId: 'b', text: 'B' }],
        source: { youtubeVideoId: VIDEO_ID, startMs: 0, endMs: 300000 },
      }],
    };
  }
}

class FakeBus implements MessageSubscriberPort {
  private readonly handlers = new Map<string, Set<(message: ExtensionMessage) => void>>();
  public readonly published: ExtensionMessage[] = [];

  public subscribe(type: string, handler: (message: ExtensionMessage) => void): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  public async emit(type: string, payload: unknown, youtubeVideoId = VIDEO_ID): Promise<void> {
    const message: ExtensionMessage = {
      type,
      contractVersion: '0.4.0',
      correlationId: 'c-1',
      tabId: 7,
      youtubeVideoId,
      occurredAtUtc: '2026-09-16T10:00:00Z',
      payload,
    };
    this.handlers.get(type)?.forEach((handler) => handler(message));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  public async publish(message: ExtensionMessage): Promise<void> {
    this.published.push(message);
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

    await bus.emit('ACTIVATION_ENABLED', activation);

    expect(api.starts).toBe(1);
    expect(runtime.getStore().getState().status).toBe('active');
    expect(runtime.getStore().getState().session?.sessionId).toBe(SESSION_ID);
  });

  it('ignores an inactive decision and duplicated activations', async () => {
    const { api, bus } = build();

    await bus.emit('ACTIVATION_ENABLED', {});
    expect(api.starts).toBe(0);

    await bus.emit('ACTIVATION_ENABLED', activation);
    await bus.emit('ACTIVATION_ENABLED', activation);
    expect(api.starts).toBe(1);
  });

  it('rejects a stale enabled handoff after its activation was closed by a transition', async () => {
    const { api, bus } = build();
    await bus.emit('VIDEO_CONTEXT_CHANGED', {
      transitionId: 'transition-a-b',
      previousActivationId: activation.activationId,
      previousYoutubeVideoId: VIDEO_ID,
      videoTitle: 'Video B',
    }, VIDEO_B_ID);

    await bus.emit('ACTIVATION_ENABLED', activation);

    expect(api.starts).toBe(0);
  });

  it('retries the same activation after a retryable session-start failure', async () => {
    const { api, bus, runtime } = build();
    api.failNextStart = true;

    await bus.emit('ACTIVATION_ENABLED', activation);
    await bus.emit('OPERATION_RETRY_REQUEST', { operation: 'sessionStart' });

    expect(api.starts).toBe(2);
    expect(runtime.getStore().getState().status).toBe('active');
    const failure = bus.published.find((message) => message.type === 'OPERATION_STATUS_CHANGED' &&
      (message.payload as { operation?: string; state?: string }).operation === 'sessionStart' &&
      (message.payload as { state?: string }).state === 'failed');
    expect((failure?.payload as { traceId?: string }).traceId).toBe('trace-session-1');
  });
});

// ============================================================
// timer and segment through player events
// ============================================================

describe('SessionQuizRuntime playback', () => {
  it('counts only playing time and closes a segment at the interval', async () => {
    const { api, bus, clock, runtime } = build();
    await bus.emit('ACTIVATION_ENABLED', activation);

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
    expect(api.quizzes).toHaveLength(1);
    const quizMessages = bus.published.filter((message) => message.type === 'QUIZ_AVAILABLE');
    expect(quizMessages).toHaveLength(1);
    expect((quizMessages[0].payload as { questions?: unknown[] }).questions).toHaveLength(1);
    expect(bus.published.some((message) => message.type === 'OPERATION_STATUS_CHANGED')).toBe(true);
  });

  it('ignores player events from another video', async () => {
    const { api, bus, clock } = build();
    await bus.emit('ACTIVATION_ENABLED', activation);

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
    await bus.emit('ACTIVATION_ENABLED', activation);
    await bus.emit('PLAYER_PLAYING', { currentTimeMs: 0 });
    clock.advance(45000);

    await bus.emit('ACTIVATION_DISABLED', { reasonCode: 'userDisabled' });

    expect(api.completions).toEqual([{ activeStudyMs: 45000, reason: 'activationDisabled' }]);
    expect(runtime.getStore().getState().status).toBe('completed');
  });

  it('completes the session when the bound video ends', async () => {
    const ended = build();
    await ended.bus.emit('ACTIVATION_ENABLED', activation);
    await ended.bus.emit('PLAYER_PLAYING', { currentTimeMs: 0 });
    ended.clock.advance(20000);
    await ended.bus.emit('PLAYER_ENDED', { currentTimeMs: 20000 });
    expect(ended.api.completions[0]).toEqual({ activeStudyMs: 20000, reason: 'videoEnded' });
  });

  it('closes A once on a matching transition and starts B only after its enabled handoff', async () => {
    const { api, bus, clock, runtime } = build();
    await bus.emit('ACTIVATION_ENABLED', activation);
    await bus.emit('PLAYER_PLAYING', { currentTimeMs: 0 });
    clock.advance(30000);

    await bus.emit('VIDEO_CONTEXT_CHANGED', {
      transitionId: 'transition-a-b',
      previousActivationId: activation.activationId,
      previousYoutubeVideoId: VIDEO_ID,
      videoTitle: 'Video B',
    }, VIDEO_B_ID);
    await bus.emit('VIDEO_CONTEXT_CHANGED', {
      transitionId: 'transition-a-b-duplicate',
      previousActivationId: activation.activationId,
      previousYoutubeVideoId: VIDEO_ID,
      videoTitle: 'Video B',
    }, VIDEO_B_ID);

    expect(api.completions).toEqual([{ activeStudyMs: 30000, reason: 'videoContextChanged' }]);
    expect(runtime.getStore().getState().status).toBe('completed');
    expect(api.starts).toBe(1);

    await bus.emit('ACTIVATION_ENABLED', {
      ...activation,
      activationId: '11111111-1111-4111-8111-111111111112',
      videoTitle: 'Video B',
      transcriptCapture: { ...activation.transcriptCapture, youtubeVideoId: VIDEO_B_ID },
    }, VIDEO_B_ID);

    expect(api.starts).toBe(2);
    expect(runtime.getStore().getState().status).toBe('active');
  });

  it('closes only the matching old session when ON navigation leaves watch', async () => {
    const { api, bus } = build();
    await bus.emit('ACTIVATION_ENABLED', activation);

    await bus.emit('VIDEO_CONTEXT_UNAVAILABLE', {
      transitionId: 'transition-away',
      previousActivationId: 'different-activation',
      previousYoutubeVideoId: VIDEO_ID,
      reasonCode: 'unsupportedWatchPage',
    });
    expect(api.completions).toEqual([]);

    await bus.emit('VIDEO_CONTEXT_UNAVAILABLE', {
      transitionId: 'transition-away',
      previousActivationId: activation.activationId,
      previousYoutubeVideoId: VIDEO_ID,
      reasonCode: 'unsupportedWatchPage',
    });
    expect(api.completions).toEqual([{ activeStudyMs: 0, reason: 'videoContextChanged' }]);
  });

  it('stops reacting to events after dispose', async () => {
    const { api, bus, clock, dispose } = build();
    await bus.emit('ACTIVATION_ENABLED', activation);
    dispose();

    await bus.emit('PLAYER_PLAYING', { currentTimeMs: 0 });
    clock.advance(300000);
    await bus.emit('PLAYER_PAUSED', { currentTimeMs: 300000 });

    expect(api.segments).toHaveLength(0);
    expect(api.completions).toHaveLength(0);
  });
});
