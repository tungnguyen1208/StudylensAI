import { describe, expect, it } from 'vitest';
import type { TranscriptReadResult } from '../../../platform/youtube/transcript-reader';
import type { LearningPackage, SubmitFullTranscriptRequest } from '../../session-quiz/models/session-quiz-contracts';
import fixture from '../../../../../../contracts/examples/session-quiz/transcript-hash-canonical.json';
import { TranscriptService, canonicalizeTranscriptCues, createTranscriptRequest, hashTranscript, type SessionTranscriptApiPort } from '../services/transcript-service';

const sessionId = 'session-1';
const youtubeVideoId = 'dQw4w9WgXcQ';
const available: TranscriptReadResult = {
  status: 'available', language: 'en', cues: [
    { startMs: 0, endMs: 10_000, text: 'A sufficiently detailed transcript sentence explains the first concept.' },
    { startMs: 10_000, endMs: 20_000, text: 'A second sentence preserves enough evidence for full-video quiz generation.' },
  ],
};

const packageFor = (request: SubmitFullTranscriptRequest): LearningPackage => ({
  session: { sessionId, youtubeVideoId, videoTitle: 'Video', status: 'active', preferences: { questionType: 'multipleChoice', difficulty: 'medium' }, startedAtUtc: '2026-09-29T00:00:00Z' },
  transcript: { status: request.status === 'available' ? 'ready' : 'generating', cueCount: request.cues.length, cues: request.cues },
  quizStatus: request.status === 'available' ? 'queued' : 'notStarted',
});

class RecordingApi implements SessionTranscriptApiPort {
  public readonly calls: Array<{ sessionId: string; request: SubmitFullTranscriptRequest }> = [];
  public async submitTranscript(id: string, request: SubmitFullTranscriptRequest): Promise<LearningPackage> {
    this.calls.push({ sessionId: id, request });
    return packageFor(request);
  }
}

describe('TranscriptService 0.5', () => {
  it('submits one full transcript to the active session with a stable hash', async () => {
    const api = new RecordingApi();
    const service = new TranscriptService(api);
    await service.upload(sessionId, youtubeVideoId, available);
    await service.upload(sessionId, youtubeVideoId, available);
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1]).toEqual(api.calls[0]);
    expect(api.calls[0].request).toMatchObject({ contractVersion: '0.5.0', youtubeVideoId, status: 'available', durationMs: 20_000 });
    expect(api.calls[0].request.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('replays the exact prepared upload when YouTube changes its rendered captions during retry', async () => {
    const api = new RecordingApi();
    const service = new TranscriptService(api);
    await service.upload(sessionId, youtubeVideoId, available);
    await service.upload(sessionId, youtubeVideoId, {
      status: 'available', language: 'en', cues: [{ startMs: 0, endMs: 2_000, text: 'A later partial DOM snapshot must not replace the prepared upload.' }],
    });
    expect(api.calls[1].request).toEqual(api.calls[0].request);
  });

  it('uses the same cue canonicalization as Backend', async () => {
    expect(await hashTranscript([{ startMs: 0, endMs: 1000, text: '  hello   world ' }]))
      .toBe(await hashTranscript([{ startMs: 0, endMs: 1000, text: 'hello world' }]));
    expect(canonicalizeTranscriptCues(fixture.rawCues)).toEqual(fixture.normalizedCues);
    expect(await hashTranscript(fixture.rawCues)).toBe(fixture.contentHash);
    const request = await createTranscriptRequest(sessionId, youtubeVideoId, {
      status: 'available', language: 'en', cues: fixture.rawCues,
    }, 30_000);
    expect(request.cues).toEqual(fixture.normalizedCues);
    expect(request.contentHash).toBe(fixture.contentHash);
    expect(request.durationMs).toBe(30_000);
  });

  it('queues fallback without fake cues when YouTube captions are unavailable', async () => {
    const request = await createTranscriptRequest(sessionId, youtubeVideoId, { status: 'unavailable', language: 'vi', cues: [] });
    expect(request).toEqual({
      contractVersion: '0.5.0', idempotencyKey: `transcript:${sessionId}:${youtubeVideoId}:unavailable`,
      youtubeVideoId, language: 'vi', source: 'youtubeCaption', status: 'unavailable', cues: [],
    });
  });
});
