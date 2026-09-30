import { describe, expect, it } from 'vitest';
import {
  handleSessionQuizRequest,
  requestSessionQuizThroughWorker,
  SESSION_QUIZ_REQUEST_MESSAGE,
  type SessionQuizBackendPort,
} from '../api/session-quiz-worker-bridge';
import type { LearningPackage, StartStudySessionRequest } from '../models/session-quiz-contracts';

const request: StartStudySessionRequest = {
  contractVersion: '0.5.0', activationId: 'activation-1', idempotencyKey: 'session:activation-1:dQw4w9WgXcQ',
  youtubeVideoId: 'dQw4w9WgXcQ', videoTitle: 'Video',
  preferences: { questionType: 'multipleChoice', difficulty: 'medium' },
};
const session = { sessionId: 'session-1', youtubeVideoId: request.youtubeVideoId, videoTitle: 'Video', status: 'active' as const, preferences: request.preferences, startedAtUtc: '2026-09-29T00:00:00Z' };
const learningPackage: LearningPackage = { session, transcript: { status: 'waiting', cueCount: 0, cues: [] }, quizStatus: 'notStarted' };

class FakeBackend implements SessionQuizBackendPort {
  public starts: StartStudySessionRequest[] = [];
  public async start(value: StartStudySessionRequest) { this.starts.push(value); return session; }
  public async complete() { return { ...session, status: 'completed' as const }; }
  public async submitTranscript() { return learningPackage; }
  public async getLearningPackage() { return learningPackage; }
  public async retry() { return learningPackage; }
}

describe('session quiz worker bridge', () => {
  it('keeps Backend access in the Service Worker', async () => {
    const backend = new FakeBackend();
    const response = await handleSessionQuizRequest(
      { type: SESSION_QUIZ_REQUEST_MESSAGE, operation: 'start', request },
      { tab: { id: 7, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }, backend,
    );
    expect(response).toEqual({ ok: true, result: session });
    expect(backend.starts).toEqual([request]);
  });

  it('rejects requests after the watch page becomes unavailable', async () => {
    const backend = new FakeBackend();
    const response = await handleSessionQuizRequest(
      { type: SESSION_QUIZ_REQUEST_MESSAGE, operation: 'start', request },
      { tab: { id: 7, url: 'https://www.youtube.com/' } }, backend,
    );
    expect(response).toMatchObject({ ok: false, code: 'sessionTargetUnavailable' });
  });

  it('round-trips a worker result', async () => {
    await expect(requestSessionQuizThroughWorker('start', request, undefined, async () => ({ ok: true, result: session }))).resolves.toEqual(session);
  });
});
