import { describe, expect, it } from 'vitest';
import {
  handleSessionQuizRequest,
  requestSessionQuizThroughWorker,
  SESSION_QUIZ_REQUEST_MESSAGE,
  type SessionQuizBackendPort,
} from '../api/session-quiz-worker-bridge';
import type { StartStudySessionRequest } from '../models/session-quiz-contracts';

const request: StartStudySessionRequest = {
  contractVersion: '0.4.0',
  youtubeVideoId: 'dQw4w9WgXcQ',
  activation: {
    activationId: '11111111-1111-4111-8111-111111111111', source: 'user', videoTitle: 'Video',
    transcriptCapture: { transcriptCaptureId: 'capture-1', youtubeVideoId: 'dQw4w9WgXcQ', language: 'en', source: 'youtubeCaption', status: 'available', availableCueCount: 2, version: 1 },
    preferences: { quizIntervalMinutes: 5, questionType: 'multipleChoice', difficulty: 'medium' },
  },
};

const session = { sessionId: 'session-1', youtubeVideoId: request.youtubeVideoId, status: 'active' as const, activeStudyMs: 0, startedAtUtc: '2026-09-24T00:00:00.000Z' };

class FakeBackend implements SessionQuizBackendPort {
  public starts: StartStudySessionRequest[] = [];
  public async start(value: StartStudySessionRequest) { this.starts.push(value); return session; }
  public async complete() { return { ...session, status: 'completed' as const }; }
  public async createSegment() { return { segmentId: 'segment-1', sessionId: session.sessionId, youtubeVideoId: request.youtubeVideoId, startMs: 0, endMs: 5000 }; }
  public async generateQuiz() { return { quizId: 'quiz-1', sessionId: session.sessionId, segmentId: 'segment-1', status: 'available' as const, createdAtUtc: '2026-09-24T00:00:00.000Z', questions: [] }; }
}

describe('session quiz worker bridge', () => {
  it('keeps session creation in the Service Worker', async () => {
    const backend = new FakeBackend();
    const response = await handleSessionQuizRequest(
      { type: SESSION_QUIZ_REQUEST_MESSAGE, operation: 'start', request },
      { tab: { id: 7, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }, backend,
    );
    expect(response).toEqual({ ok: true, result: session });
    expect(backend.starts).toEqual([request]);
  });

  it('rejects a session request after the watch page is unavailable', async () => {
    const backend = new FakeBackend();
    const response = await handleSessionQuizRequest(
      { type: SESSION_QUIZ_REQUEST_MESSAGE, operation: 'start', request },
      { tab: { id: 7, url: 'https://www.youtube.com/' } }, backend,
    );
    expect(response).toMatchObject({ ok: false, code: 'sessionTargetUnavailable' });
    expect(backend.starts).toEqual([]);
  });

  it('turns a worker response back into a session result', async () => {
    await expect(requestSessionQuizThroughWorker('start', request, undefined, async (message) => {
      expect(message).toEqual({ type: SESSION_QUIZ_REQUEST_MESSAGE, operation: 'start', request });
      return { ok: true, result: session };
    })).resolves.toEqual(session);
  });
});
