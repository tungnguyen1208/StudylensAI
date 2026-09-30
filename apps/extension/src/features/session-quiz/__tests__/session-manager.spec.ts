import { describe, expect, it } from 'vitest';
import type { LearningPackage, SessionSnapshot } from '../models/session-quiz-contracts';
import { SessionManager } from '../services/session-manager';

const preferences = { questionType: 'multipleChoice' as const, difficulty: 'medium' as const };
const activation = { activationId: 'activation-1', source: 'user' as const, videoTitle: 'Video', preferences };
const session: SessionSnapshot = {
  sessionId: 'session-1', youtubeVideoId: 'dQw4w9WgXcQ', videoTitle: 'Video', status: 'active', preferences,
  startedAtUtc: '2026-09-29T10:00:00Z',
};
const learningPackage: LearningPackage = {
  session,
  transcript: { status: 'waiting', cueCount: 0, cues: [] },
  quizStatus: 'notStarted',
};

describe('SessionManager', () => {
  it('starts immediately, refreshes the package, and completes once', async () => {
    let starts = 0;
    let completes = 0;
    const manager = new SessionManager({
      start: async () => { starts += 1; return session; },
      complete: async () => { completes += 1; return { ...session, status: 'completed', completedAtUtc: '2026-09-29T10:05:00Z' }; },
      getLearningPackage: async () => learningPackage,
    });

    await Promise.all([
      manager.activate(session.youtubeVideoId, activation),
      manager.activate(session.youtubeVideoId, activation),
    ]);
    await manager.refresh();
    await manager.complete('videoEnded', 'completion-1');
    await manager.complete('videoEnded', 'completion-1');

    expect(starts).toBe(1);
    expect(completes).toBe(1);
    expect(manager.getState()).toMatchObject({ status: 'completed', session: { status: 'completed' } });
  });
});
