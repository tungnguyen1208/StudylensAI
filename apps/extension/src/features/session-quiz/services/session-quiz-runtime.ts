import type { ExtensionMessage } from '../../../shared/messaging/message-types';
import { operationFailure, type OperationStatusPayload, type StudyLensOperation } from '../../../shared/messaging/operation-status';
import { SESSION_QUIZ_CONTRACT_VERSION, type ActivationEnabledPayload, type GenerateQuizRequest, type PreferenceSnapshot, type QuizPublic } from '../models/session-quiz-contracts';
import { SessionStore } from '../state/session-store';
import type { SessionApiPort } from '../state/session-types';
import { PlaybackSpanTracker } from './playback-span-tracker';
import { SegmentManager, type PendingSegmentStore, type SegmentApiPort } from './segment-manager';
import { SessionManager } from './session-manager';
import { StudyTimer, type Clock, type PlayerLifecycleEvent, type StudyTimerStateStore } from './study-timer';

// ============================================================
// ports
// ============================================================

export interface MessageSubscriberPort {
  subscribe(type: string, handler: (message: ExtensionMessage) => void): () => void;
}

export interface MessagePublisherPort {
  publish(message: ExtensionMessage): Promise<void>;
}

export interface QuizApiPort {
  generateQuiz(request: GenerateQuizRequest): Promise<QuizPublic>;
}

export interface SessionQuizRuntimeOptions {
  api: SessionApiPort & SegmentApiPort & QuizApiPort;
  bus: MessageSubscriberPort & Partial<MessagePublisherPort>;
  clock?: Clock;
  store?: SessionStore;
  timerStore?: StudyTimerStateStore;
  pendingSegmentStore?: PendingSegmentStore;
  createCompletionId?: () => string;
}

const PLAYER_EVENTS: PlayerLifecycleEvent[] = [
  'PLAYER_PLAYING',
  'PLAYER_PAUSED',
  'PLAYER_BUFFERING',
  'PLAYER_SEEKED',
  'PLAYER_ENDED',
];

// ============================================================
// runtime
// ============================================================

export class SessionQuizRuntime {
  private readonly store: SessionStore;
  private readonly clock: Clock;
  private readonly sessions: SessionManager;
  private tracker: PlaybackSpanTracker | null = null;
  private timer: StudyTimer | null = null;
  private segments: SegmentManager | null = null;
  private youtubeVideoId: string | null = null;
  private preferences: PreferenceSnapshot | null = null;
  private messageContext: Pick<ExtensionMessage, 'correlationId' | 'tabId'> | null = null;
  private lastQuizSegment: { segmentId: string; sessionId: string; youtubeVideoId: string } | null = null;
  private lastActivationMessage: ExtensionMessage | null = null;
  private activationId: string | null = null;
  private readonly closedActivationIds = new Set<string>();
  private lifecycleQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: SessionQuizRuntimeOptions) {
    this.store = options.store ?? new SessionStore();
    this.clock = options.clock ?? { nowMs: () => Date.now() };
    this.sessions = new SessionManager(options.api, (action) => void this.store.dispatch(action));
  }

  public getStore(): SessionStore {
    return this.store;
  }

  public start(): () => void {
    const unsubscribers = [
      this.options.bus.subscribe('ACTIVATION_ENABLED', (message) => this.enqueueLifecycle(() => this.onActivationEnabled(message))),
      this.options.bus.subscribe('ACTIVATION_DISABLED', (message) => this.enqueueLifecycle(() => this.onActivationDisabled(message))),
      this.options.bus.subscribe('VIDEO_CONTEXT_CHANGED', (message) => this.enqueueLifecycle(() => this.onVideoContextClosed(message))),
      this.options.bus.subscribe('VIDEO_CONTEXT_UNAVAILABLE', (message) => this.enqueueLifecycle(() => this.onVideoContextClosed(message))),
      this.options.bus.subscribe('OPERATION_RETRY_REQUEST', (message) => void this.retryOperation(message)),
      ...PLAYER_EVENTS.map((type) => this.options.bus.subscribe(type, (message) => void this.onPlayerEvent(type, message))),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  // ============================================================
  // activation
  // ============================================================

  private async onActivationEnabled(message: ExtensionMessage): Promise<void> {
    const activation = message.payload as ActivationEnabledPayload | undefined;
    if (!activation || !activation.activationId) return;
    if (this.closedActivationIds.has(activation.activationId)) return;
    if (this.store.getState().status === 'active') return;

    this.lastActivationMessage = message;
    this.activationId = activation.activationId;
    this.youtubeVideoId = message.youtubeVideoId;
    this.messageContext = { correlationId: message.correlationId, tabId: message.tabId };
    await this.publishStatus({ operation: 'sessionStart', state: 'pending', message: 'Đang tạo phiên học.', retryable: false });
    await this.sessions.activate(message.youtubeVideoId, activation);
    const session = this.store.getState().session;
    if (!session) {
      const failure = operationFailure(this.sessions.getLastError(), 'sessionStartFailed', 'Không thể tạo phiên học.');
      await this.publishStatus({ operation: 'sessionStart', state: 'failed', ...failure });
      return;
    }
    if (this.closedActivationIds.has(activation.activationId)) {
      await this.finish('videoContextChanged');
      return;
    }

    this.preferences = activation.preferences;
    this.tracker = new PlaybackSpanTracker();
    this.timer = new StudyTimer(this.clock, this.options.timerStore);
    const restored = await this.timer.hydrate(session.sessionId);
    if (!restored) this.timer.startSession(session.sessionId);
    this.segments = new SegmentManager({
      sessionId: session.sessionId,
      intervalMinutes: intervalOf(activation.preferences),
      api: this.options.api,
      tracker: this.tracker,
      store: this.options.pendingSegmentStore,
      clock: this.clock,
    });
    await this.segments.hydrate();
    await this.publishStatus({ operation: 'sessionStart', state: 'succeeded', message: 'Phiên học đã sẵn sàng.', retryable: false });
  }

  // ============================================================
  // playback
  // ============================================================

  private async onPlayerEvent(type: PlayerLifecycleEvent, message: ExtensionMessage): Promise<void> {
    if (!this.timer || !this.tracker || !this.segments) return;
    if (message.youtubeVideoId !== this.youtubeVideoId) return;

    const payload = (message.payload ?? {}) as { currentTimeMs?: number; durationMs?: number; previousTimeMs?: number };
    const currentTimeMs = typeof payload.currentTimeMs === 'number' ? payload.currentTimeMs : 0;

    const activeStudyMs = this.timer.handle(type);
    this.tracker.handle({ type, currentTimeMs, durationMs: payload.durationMs, previousTimeMs: payload.previousTimeMs });
    this.store.dispatch({ type: 'activeStudyMsChanged', activeStudyMs });

    if (type === 'PLAYER_ENDED') {
      await this.finish('videoEnded');
      return;
    }

    await this.closeSegmentIfDue(activeStudyMs, currentTimeMs);
  }

  private async closeSegmentIfDue(activeStudyMs: number, currentTimeMs: number): Promise<void> {
    if (!this.segments) return;
    if (!this.segments.getPending() && activeStudyMs < this.segments.nextThresholdMs) return;

    if (!this.segments.getPending()) this.store.dispatch({ type: 'segmentRequested' });
    await this.publishStatus({ operation: 'segmentCreate', state: 'pending', message: 'Đang tạo phân đoạn học.', retryable: false });
    const attempt = await this.segments.onActiveStudyMs(activeStudyMs, currentTimeMs);
    if (attempt.status === 'created') {
      this.store.dispatch({ type: 'segmentCreated', segment: attempt.segment });
      await this.publishStatus({ operation: 'segmentCreate', state: 'succeeded', message: 'Đã tạo phân đoạn học.', retryable: false });
      await this.generateQuiz(attempt.segment);
    }
    if (attempt.status === 'retryable') {
      this.store.dispatch({ type: 'segmentRetryable', error: attempt.error });
      await this.publishStatus({ operation: 'segmentCreate', state: 'failed', code: attempt.error, message: 'Chưa thể tạo phân đoạn học.', retryable: true });
    }
    if (attempt.status === 'blocked') {
      this.store.dispatch({ type: 'segmentBlocked', code: attempt.code });
      await this.publishStatus({ operation: 'segmentCreate', state: 'failed', code: attempt.code, message: 'Transcript không đủ để tạo phân đoạn học.', retryable: false });
    }
  }

  // ============================================================
  // completion
  // ============================================================

  private async onActivationDisabled(message: ExtensionMessage): Promise<void> {
    if (message.youtubeVideoId !== this.youtubeVideoId) return;
    await this.finish('activationDisabled');
  }

  private async onVideoContextClosed(message: ExtensionMessage): Promise<void> {
    const payload = message.payload as {
      previousActivationId?: unknown;
      previousYoutubeVideoId?: unknown;
    } | undefined;
    if (!payload || typeof payload.previousActivationId !== 'string' ||
      typeof payload.previousYoutubeVideoId !== 'string') return;
    this.rememberClosedActivation(payload.previousActivationId);
    if (payload.previousActivationId !== this.activationId ||
      payload.previousYoutubeVideoId !== this.youtubeVideoId) return;
    await this.finish('videoContextChanged');
  }

  private async finish(reason: 'activationDisabled' | 'videoEnded' | 'videoContextChanged'): Promise<void> {
    if (this.store.getState().status !== 'active' || !this.timer) return;

    this.tracker?.closeOpenSpan();
    const activeStudyMs = this.timer.stopSession();
    const completionId = (this.options.createCompletionId ?? (() => crypto.randomUUID()))();
    await this.sessions.complete(reason, activeStudyMs, completionId);

    this.timer = null;
    this.tracker = null;
    this.segments = null;
    this.youtubeVideoId = null;
    this.preferences = null;
    this.messageContext = null;
    this.lastQuizSegment = null;
    this.lastActivationMessage = null;
    this.activationId = null;
  }

  private enqueueLifecycle(task: () => Promise<void>): Promise<void> {
    this.lifecycleQueue = this.lifecycleQueue.then(task, task).catch(() => undefined);
    return this.lifecycleQueue;
  }

  private rememberClosedActivation(activationId: string): void {
    this.closedActivationIds.add(activationId);
    if (this.closedActivationIds.size > 100) {
      const oldest = this.closedActivationIds.values().next().value;
      if (oldest) this.closedActivationIds.delete(oldest);
    }
  }

  private async generateQuiz(segment: { segmentId: string; sessionId: string; youtubeVideoId: string }): Promise<void> {
    if (!this.preferences || !this.messageContext) return;
    this.lastQuizSegment = segment;
    await this.publishStatus({ operation: 'quizGenerate', state: 'pending', message: 'Đang tạo bài kiểm tra.', retryable: false });
    try {
      const quiz = await this.options.api.generateQuiz({
        contractVersion: SESSION_QUIZ_CONTRACT_VERSION,
        sessionId: segment.sessionId,
        segmentId: segment.segmentId,
        youtubeVideoId: segment.youtubeVideoId,
        questionType: this.preferences.questionType,
        difficulty: this.preferences.difficulty,
        idempotencyKey: `quiz:${segment.sessionId}:${segment.segmentId}`,
      });
      if (quiz.status !== 'available' || quiz.questions.length === 0) {
        await this.publishStatus({
          operation: 'quizGenerate',
          state: 'failed',
          code: 'quizUnavailable',
          message: 'Chưa thể tạo bài kiểm tra từ transcript hiện tại.',
          retryable: true,
        });
        return;
      }
      if (!this.options.bus.publish) return;
      const { status: _status, ...payload } = quiz;
      await this.options.bus.publish({
        type: 'QUIZ_AVAILABLE',
        contractVersion: SESSION_QUIZ_CONTRACT_VERSION,
        correlationId: this.messageContext.correlationId,
        tabId: this.messageContext.tabId,
        youtubeVideoId: segment.youtubeVideoId,
        occurredAtUtc: new Date().toISOString(),
        payload,
      });
      await this.publishStatus({ operation: 'quizGenerate', state: 'succeeded', message: 'Bài kiểm tra đã sẵn sàng.', retryable: false });
    } catch (error: unknown) {
      const failure = operationFailure(error, 'quizGenerationFailed', 'Không thể tạo bài kiểm tra.');
      await this.publishStatus({ operation: 'quizGenerate', state: 'failed', ...failure });
    }
  }

  private async retryOperation(message: ExtensionMessage): Promise<void> {
    const operation = (message.payload as { operation?: StudyLensOperation } | undefined)?.operation;
    if (operation === 'sessionStart' && this.lastActivationMessage) {
      await this.onActivationEnabled(this.lastActivationMessage);
      return;
    }
    if (operation === 'segmentCreate' && this.segments) {
      const attempt = await this.segments.retryPending();
      if (attempt.status === 'created') {
        this.store.dispatch({ type: 'segmentCreated', segment: attempt.segment });
        await this.publishStatus({ operation: 'segmentCreate', state: 'succeeded', message: 'Đã tạo phân đoạn học.', retryable: false });
        await this.generateQuiz(attempt.segment);
      } else if (attempt.status === 'retryable') {
        await this.publishStatus({ operation: 'segmentCreate', state: 'failed', code: attempt.error, message: 'Chưa thể tạo phân đoạn học.', retryable: true });
      }
    }
    if (operation === 'quizGenerate' && this.lastQuizSegment) await this.generateQuiz(this.lastQuizSegment);
  }

  private async publishStatus(payload: OperationStatusPayload): Promise<void> {
    if (!this.options.bus.publish || !this.messageContext || !this.youtubeVideoId) return;
    await this.options.bus.publish({
      type: 'OPERATION_STATUS_CHANGED',
      contractVersion: SESSION_QUIZ_CONTRACT_VERSION,
      correlationId: this.messageContext.correlationId,
      tabId: this.messageContext.tabId,
      youtubeVideoId: this.youtubeVideoId,
      occurredAtUtc: new Date().toISOString(),
      payload,
    });
  }
}

// ============================================================
// registration for the shell
// ============================================================

export function registerSessionQuizRuntime(options: SessionQuizRuntimeOptions): { store: SessionStore; dispose: () => void } {
  const runtime = new SessionQuizRuntime(options);
  return { store: runtime.getStore(), dispose: runtime.start() };
}

function intervalOf(preferences: PreferenceSnapshot | undefined): 5 | 10 | 15 {
  const minutes = preferences?.quizIntervalMinutes;
  return minutes === 5 || minutes === 10 || minutes === 15 ? minutes : 10;
}
