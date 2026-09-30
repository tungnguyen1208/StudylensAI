import type { ExtensionMessage } from '../../../shared/messaging/message-types';
import { operationFailure, type OperationStatusPayload } from '../../../shared/messaging/operation-status';
import { SESSION_QUIZ_CONTRACT_VERSION, type ActivationEnabledPayload } from '../models/session-quiz-contracts';
import { SessionStore } from '../state/session-store';
import type { SessionApiPort } from '../state/session-types';
import { SessionManager } from './session-manager';

export interface MessageSubscriberPort {
  subscribe(type: string, handler: (message: ExtensionMessage) => void): () => void;
}

export interface MessagePublisherPort {
  publish(message: ExtensionMessage): Promise<void>;
}

export interface SessionQuizRuntimeOptions {
  api: SessionApiPort;
  bus: MessageSubscriberPort & Partial<MessagePublisherPort>;
  store?: SessionStore;
  createCompletionId?: () => string;
}

export class SessionQuizRuntime {
  private readonly store: SessionStore;
  private readonly sessions: SessionManager;
  private youtubeVideoId: string | null = null;
  private activationId: string | null = null;
  private messageContext: Pick<ExtensionMessage, 'correlationId' | 'tabId'> | null = null;
  private readonly closedActivationIds = new Set<string>();
  private lifecycleQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: SessionQuizRuntimeOptions) {
    this.store = options.store ?? new SessionStore();
    this.sessions = new SessionManager(options.api, (action) => void this.store.dispatch(action));
  }

  public getStore(): SessionStore { return this.store; }

  public start(): () => void {
    const unsubscribers = [
      this.options.bus.subscribe('ACTIVATION_ENABLED', (message) => this.enqueue(() => this.enable(message))),
      this.options.bus.subscribe('ACTIVATION_DISABLED', (message) => this.enqueue(() => this.closeFor(message, 'activationDisabled'))),
      this.options.bus.subscribe('VIDEO_CONTEXT_CHANGED', (message) => this.enqueue(() => this.closePrevious(message, 'videoContextChanged'))),
      this.options.bus.subscribe('VIDEO_CONTEXT_UNAVAILABLE', (message) => this.enqueue(() => this.closePrevious(message, 'unsupportedWatchPage'))),
      this.options.bus.subscribe('PLAYER_ENDED', (message) => this.enqueue(() => this.closeFor(message, 'videoEnded'))),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  private async enable(message: ExtensionMessage): Promise<void> {
    const activation = message.payload as ActivationEnabledPayload | undefined;
    if (!activation?.activationId || this.closedActivationIds.has(activation.activationId)) return;
    if (this.store.getState().session?.youtubeVideoId === message.youtubeVideoId && this.store.getState().status === 'active') return;
    this.youtubeVideoId = message.youtubeVideoId;
    this.activationId = activation.activationId;
    this.messageContext = { correlationId: message.correlationId, tabId: message.tabId };
    await this.publishStatus({ operation: 'sessionStart', state: 'pending', message: 'Đang tạo phiên học cho video.', retryable: false });
    await this.sessions.activate(message.youtubeVideoId, activation);
    if (!this.store.getState().session) {
      await this.publishStatus({ operation: 'sessionStart', state: 'failed', ...operationFailure(this.sessions.getLastError(), 'sessionStartFailed', 'Không thể tạo phiên học.') });
      return;
    }
    if (this.closedActivationIds.has(activation.activationId)) {
      await this.finish('videoContextChanged');
      return;
    }
    await this.publishStatus({ operation: 'sessionStart', state: 'succeeded', message: 'Phiên học đã sẵn sàng; đang lấy transcript.', retryable: false });
  }

  private async closeFor(message: ExtensionMessage, reason: 'activationDisabled' | 'videoEnded'): Promise<void> {
    if (message.youtubeVideoId !== this.youtubeVideoId) return;
    await this.finish(reason);
  }

  private async closePrevious(message: ExtensionMessage, reason: 'videoContextChanged' | 'unsupportedWatchPage'): Promise<void> {
    const payload = message.payload as { previousActivationId?: unknown; previousYoutubeVideoId?: unknown } | undefined;
    if (!payload || typeof payload.previousActivationId !== 'string' || typeof payload.previousYoutubeVideoId !== 'string') return;
    this.closedActivationIds.add(payload.previousActivationId);
    if (payload.previousActivationId === this.activationId && payload.previousYoutubeVideoId === this.youtubeVideoId) await this.finish(reason);
  }

  private async finish(reason: 'activationDisabled' | 'videoEnded' | 'videoContextChanged' | 'unsupportedWatchPage'): Promise<void> {
    if (!this.store.getState().session) return;
    await this.sessions.complete(reason, (this.options.createCompletionId ?? (() => crypto.randomUUID()))());
    this.youtubeVideoId = null;
    this.activationId = null;
    this.messageContext = null;
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.lifecycleQueue = this.lifecycleQueue.then(task, task).catch(() => undefined);
    return this.lifecycleQueue;
  }

  private async publishStatus(payload: OperationStatusPayload): Promise<void> {
    if (!this.options.bus.publish || !this.messageContext || !this.youtubeVideoId) return;
    await this.options.bus.publish({
      type: 'OPERATION_STATUS_CHANGED', contractVersion: SESSION_QUIZ_CONTRACT_VERSION,
      correlationId: this.messageContext.correlationId, tabId: this.messageContext.tabId,
      youtubeVideoId: this.youtubeVideoId, occurredAtUtc: new Date().toISOString(), payload,
    });
  }
}

export function registerSessionQuizRuntime(options: SessionQuizRuntimeOptions): { store: SessionStore; dispose: () => void } {
  const runtime = new SessionQuizRuntime(options);
  return { store: runtime.getStore(), dispose: runtime.start() };
}
