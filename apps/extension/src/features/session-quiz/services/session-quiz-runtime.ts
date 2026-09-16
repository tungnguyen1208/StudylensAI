import type { ExtensionMessage } from '../../../shared/messaging/message-types';
import type { ActivationDecisionFixture, PreferenceSnapshot } from '../models/session-quiz-contracts';
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

export interface SessionQuizRuntimeOptions {
  api: SessionApiPort & SegmentApiPort;
  bus: MessageSubscriberPort;
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
      this.options.bus.subscribe('ACTIVATION_DECIDED', (message) => void this.onActivationDecided(message)),
      this.options.bus.subscribe('ACTIVATION_STOPPED', () => void this.finish('activationStopped')),
      this.options.bus.subscribe('VIDEO_CONTEXT_CHANGED', (message) => void this.onVideoContextChanged(message)),
      ...PLAYER_EVENTS.map((type) => this.options.bus.subscribe(type, (message) => void this.onPlayerEvent(type, message))),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  // ============================================================
  // activation
  // ============================================================

  private async onActivationDecided(message: ExtensionMessage): Promise<void> {
    const decision = message.payload as ActivationDecisionFixture | undefined;
    if (!decision || decision.state !== 'active') return;
    if (this.store.getState().status === 'active') return;

    await this.sessions.activate(message.youtubeVideoId, decision);
    const session = this.store.getState().session;
    if (!session) return;

    this.youtubeVideoId = message.youtubeVideoId;
    this.tracker = new PlaybackSpanTracker();
    this.timer = new StudyTimer(this.clock, this.options.timerStore);
    const restored = await this.timer.hydrate(session.sessionId);
    if (!restored) this.timer.startSession(session.sessionId);
    this.segments = new SegmentManager({
      sessionId: session.sessionId,
      intervalMinutes: intervalOf(decision.preferences),
      api: this.options.api,
      tracker: this.tracker,
      store: this.options.pendingSegmentStore,
      clock: this.clock,
    });
    await this.segments.hydrate();
  }

  private async onVideoContextChanged(message: ExtensionMessage): Promise<void> {
    if (!this.youtubeVideoId || message.youtubeVideoId === this.youtubeVideoId) return;
    await this.finish('videoChanged');
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
    const attempt = await this.segments.onActiveStudyMs(activeStudyMs, currentTimeMs);
    if (attempt.status === 'created') this.store.dispatch({ type: 'segmentCreated', segment: attempt.segment });
    if (attempt.status === 'retryable') this.store.dispatch({ type: 'segmentRetryable', error: attempt.error });
    if (attempt.status === 'blocked') this.store.dispatch({ type: 'segmentBlocked', code: attempt.code });
  }

  // ============================================================
  // completion
  // ============================================================

  private async finish(reason: 'activationStopped' | 'videoChanged' | 'videoEnded'): Promise<void> {
    if (this.store.getState().status !== 'active' || !this.timer) return;

    this.tracker?.closeOpenSpan();
    const activeStudyMs = this.timer.stopSession();
    const completionId = (this.options.createCompletionId ?? (() => crypto.randomUUID()))();
    await this.sessions.complete(reason, activeStudyMs, completionId);

    this.timer = null;
    this.tracker = null;
    this.segments = null;
    this.youtubeVideoId = null;
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
