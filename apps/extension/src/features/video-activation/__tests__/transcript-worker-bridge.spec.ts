import { describe, expect, it } from 'vitest';
import {
  handleTranscriptCaptureUpload,
  TRANSCRIPT_CAPTURE_UPLOAD_MESSAGE,
  uploadTranscriptCaptureThroughWorker,
  type TranscriptCaptureBackendPort,
} from '../services/transcript-worker-bridge';
import type { CreateTranscriptCaptureRequest, TranscriptCaptureRef } from '../models/video-activation.types';

const request: CreateTranscriptCaptureRequest = {
  idempotencyKey: 'caption:dQw4w9WgXcQ:abc',
  youtubeVideoId: 'dQw4w9WgXcQ',
  language: 'en',
  source: 'youtubeCaption',
  status: 'available',
  contentHash: 'a'.repeat(64),
  cues: [{ startMs: 0, endMs: 3_000, text: 'A valid caption cue from the currently active YouTube video.' }],
};

const capture: TranscriptCaptureRef = {
  transcriptCaptureId: 'capture-1',
  youtubeVideoId: request.youtubeVideoId,
  language: request.language,
  source: 'youtubeCaption',
  status: 'available',
  availableCueCount: 1,
  version: 1,
};

class FakeBackend implements TranscriptCaptureBackendPort {
  public requests: CreateTranscriptCaptureRequest[] = [];
  public async createTranscriptCapture(value: CreateTranscriptCaptureRequest): Promise<TranscriptCaptureRef> {
    this.requests.push(value);
    return capture;
  }
}

describe('transcript worker bridge', () => {
  it('keeps the Backend request in the Service Worker and returns its capture', async () => {
    const backend = new FakeBackend();
    const response = await handleTranscriptCaptureUpload(
      { type: TRANSCRIPT_CAPTURE_UPLOAD_MESSAGE, request },
      { tab: { id: 7, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
      backend,
    );
    expect(response).toEqual({ ok: true, capture });
    expect(backend.requests).toEqual([request]);
  });

  it('rejects a stale tab/video before calling Backend', async () => {
    const backend = new FakeBackend();
    const response = await handleTranscriptCaptureUpload(
      { type: TRANSCRIPT_CAPTURE_UPLOAD_MESSAGE, request },
      { tab: { id: 7, url: 'https://www.youtube.com/watch?v=abcdefghijk' } },
      backend,
    );
    expect(response).toMatchObject({ ok: false, code: 'transcriptTargetChanged', retryable: false });
    expect(backend.requests).toEqual([]);
  });

  it('turns a typed Worker result back into the public capture ref', async () => {
    await expect(uploadTranscriptCaptureThroughWorker(request, async (message) => {
      expect(message).toEqual({ type: TRANSCRIPT_CAPTURE_UPLOAD_MESSAGE, request });
      return { ok: true, capture };
    })).resolves.toEqual(capture);
  });
});
