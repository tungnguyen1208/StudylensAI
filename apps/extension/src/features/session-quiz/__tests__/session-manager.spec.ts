import { describe, expect, it } from 'vitest';
import { SessionManager } from '../services/session-manager';

const activation = { activationId: '11111111-1111-4111-8111-111111111111', source: 'user' as const, videoTitle: 'Video', transcriptSnapshot: { transcriptSnapshotId: '22222222-2222-4222-8222-222222222222', youtubeVideoId: 'dQw4w9WgXcQ', language: 'en', status: 'available' as const, contentHash: 'a'.repeat(64), version: '0.2.0' }, preferences: { quizIntervalMinutes: 10 as const, questionType: 'multipleChoice' as const, difficulty: 'medium' as const } };
const session = { sessionId: '33333333-3333-4333-8333-333333333333', youtubeVideoId: 'dQw4w9WgXcQ', status: 'active' as const, activeStudyMs: 0, startedAtUtc: '2026-09-10T10:00:00Z' };

describe('SessionManager', () => {
  it('starts once for an enabled flow and completes once at the manager boundary', async () => {
    let starts = 0; let completes = 0;
    const manager = new SessionManager({ start: async () => { starts++; return session; }, complete: async () => { completes++; return { ...session, status: 'completed' as const, activeStudyMs: 12, completedAtUtc: '2026-09-10T10:01:00Z' }; } });
    await Promise.all([manager.activate('dQw4w9WgXcQ', activation), manager.activate('dQw4w9WgXcQ', activation)]);
    await manager.complete('videoEnded', 12, '77777777-7777-4777-8777-777777777777'); await manager.complete('videoEnded', 12, '77777777-7777-4777-8777-777777777777');
    expect([starts, completes, manager.getState().status]).toEqual([1, 1, 'completed']);
  });
});
