import { describe, expect, it } from 'vitest';
import type { ExtensionMessage } from '../../../shared/messaging/message-types';
import type { LearningPackage, SessionSnapshot } from '../models/session-quiz-contracts';
import { SessionQuizRuntime, type MessageSubscriberPort } from '../services/session-quiz-runtime';
import type { SessionApiPort } from '../state/session-types';

const VIDEO_A = 'dQw4w9WgXcQ';
const VIDEO_B = '9bZkp7q19f0';
const preferences = { questionType: 'multipleChoice' as const, difficulty: 'medium' as const };
const activation = { activationId: 'activation-a', source: 'user' as const, videoTitle: 'Video A', preferences };

class FakeApi implements SessionApiPort {
  public starts: string[] = [];
  public completions: string[] = [];

  public async start(request: { youtubeVideoId: string }): Promise<SessionSnapshot> {
    this.starts.push(request.youtubeVideoId);
    return {
      sessionId: `session-${request.youtubeVideoId}`,
      youtubeVideoId: request.youtubeVideoId,
      videoTitle: request.youtubeVideoId === VIDEO_A ? 'Video A' : 'Video B',
      status: 'active', preferences, startedAtUtc: '2026-09-29T10:00:00Z',
    };
  }

  public async complete(_sessionId: string, request: { reason: 'activationDisabled' | 'videoEnded' | 'videoContextChanged' | 'unsupportedWatchPage' }): Promise<SessionSnapshot> {
    this.completions.push(request.reason);
    return {
      sessionId: 'closed-session', youtubeVideoId: VIDEO_A, videoTitle: 'Video A', status: 'completed',
      preferences, startedAtUtc: '2026-09-29T10:00:00Z', completedAtUtc: '2026-09-29T10:05:00Z',
    };
  }

  public async getLearningPackage(): Promise<LearningPackage> {
    throw new Error('not used');
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
  public async publish(message: ExtensionMessage): Promise<void> { this.published.push(message); }
  public async emit(type: string, payload: unknown, youtubeVideoId = VIDEO_A): Promise<void> {
    const message: ExtensionMessage = { type, contractVersion: '0.5.0', correlationId: 'c-1', tabId: 7, youtubeVideoId, occurredAtUtc: '2026-09-29T10:00:00Z', payload };
    this.handlers.get(type)?.forEach((handler) => handler(message));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('SessionQuizRuntime 0.5 lifecycle', () => {
  it('creates the session immediately on activation without waiting for transcript', async () => {
    const api = new FakeApi(); const bus = new FakeBus();
    const runtime = new SessionQuizRuntime({ api, bus, createCompletionId: () => 'completion-1' });
    runtime.start();
    await bus.emit('ACTIVATION_ENABLED', activation);
    expect(api.starts).toEqual([VIDEO_A]);
    expect(runtime.getStore().getState().status).toBe('active');
  });

  it('closes A on navigation and then opens B while global ON remains active', async () => {
    const api = new FakeApi(); const bus = new FakeBus();
    const runtime = new SessionQuizRuntime({ api, bus, createCompletionId: () => 'completion-1' });
    runtime.start();
    await bus.emit('ACTIVATION_ENABLED', activation);
    await bus.emit('VIDEO_CONTEXT_CHANGED', { previousActivationId: activation.activationId, previousYoutubeVideoId: VIDEO_A }, VIDEO_B);
    await bus.emit('ACTIVATION_ENABLED', { ...activation, activationId: 'activation-b', videoTitle: 'Video B' }, VIDEO_B);
    expect(api.completions).toEqual(['videoContextChanged']);
    expect(api.starts).toEqual([VIDEO_A, VIDEO_B]);
  });

  it('ignores a stale activation after that activation was closed', async () => {
    const api = new FakeApi(); const bus = new FakeBus();
    const runtime = new SessionQuizRuntime({ api, bus });
    runtime.start();
    await bus.emit('VIDEO_CONTEXT_CHANGED', { previousActivationId: activation.activationId, previousYoutubeVideoId: VIDEO_A }, VIDEO_B);
    await bus.emit('ACTIVATION_ENABLED', activation);
    expect(api.starts).toEqual([]);
  });
});
