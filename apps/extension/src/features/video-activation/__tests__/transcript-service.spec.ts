import { describe, expect, it } from 'vitest';
import { VideoActivationApiError } from '../api/video-activation-api';
import { operationFailure } from '../../../shared/messaging/operation-status';
import type {
  CreateTranscriptSnapshotRequest,
  TranscriptSnapshotRef,
} from '../models/video-activation.types';
import {
  TranscriptService,
  type TranscriptSnapshotApiPort,
} from '../services/transcript-service';
import type { TranscriptReadResult } from '../../../platform/youtube/transcript-reader';

const youtubeVideoId = 'dQw4w9WgXcQ';
const availableTranscript: TranscriptReadResult = {
  status: 'available',
  language: 'en',
  cues: [
    { startMs: 0, endMs: 10_000, text: 'A sufficiently detailed transcript sentence explains the first learning concept.' },
    { startMs: 10_000, endMs: 20_000, text: 'A second detailed sentence preserves enough evidence for quiz generation.' },
  ],
};

class ScriptedTranscriptApi implements TranscriptSnapshotApiPort {
  public readonly requests: CreateTranscriptSnapshotRequest[] = [];
  private calls = 0;

  public async createTranscriptSnapshot(request: CreateTranscriptSnapshotRequest): Promise<TranscriptSnapshotRef> {
    this.requests.push(request);
    this.calls += 1;
    if (this.calls === 1) {
      throw new VideoActivationApiError('backendUnavailable', 503, 'Backend unavailable.', true, 'trace-upload-1');
    }
    return {
      transcriptSnapshotId: 'snapshot-1',
      youtubeVideoId: request.youtubeVideoId,
      language: request.language,
      status: 'available',
      contentHash: request.contentHash!,
      version: '0.3.0',
    };
  }
}

describe('TranscriptService retry semantics', () => {
  it('replays the exact same available transcript request after a retryable Backend error', async () => {
    const api = new ScriptedTranscriptApi();
    const service = new TranscriptService(api);

    await expect(service.upload(youtubeVideoId, availableTranscript)).rejects.toMatchObject({
      code: 'backendUnavailable', retryable: true, traceId: 'trace-upload-1',
    });
    await expect(service.upload(youtubeVideoId, availableTranscript)).resolves.toMatchObject({
      status: 'available', youtubeVideoId,
    });

    expect(api.requests).toHaveLength(2);
    expect(api.requests[1]).toEqual(api.requests[0]);
    expect(api.requests[0].idempotencyKey).toMatch(/^transcript:dQw4w9WgXcQ:[a-f0-9]{64}$/);
    expect(api.requests[0].contentHash).toHaveLength(64);
  });

  it('keeps unavailable transcript evidence explicit and without a content hash', async () => {
    const api: TranscriptSnapshotApiPort = {
      createTranscriptSnapshot: async (request) => ({
        transcriptSnapshotId: 'snapshot-unavailable',
        youtubeVideoId: request.youtubeVideoId,
        language: request.language,
        status: 'unavailable',
        version: '0.3.0',
      }),
    };
    const service = new TranscriptService(api);

    await expect(service.upload(youtubeVideoId, { status: 'unavailable', language: 'vi', cues: [] })).resolves.toMatchObject({
      status: 'unavailable',
    });
  });

  it('preserves a non-retryable Backend error and trace ID for the status card', () => {
    const error = new VideoActivationApiError(
      'idempotencyConflict',
      409,
      'The same key was used with different transcript data.',
      false,
      'trace-upload-conflict',
    );

    expect(operationFailure(error, 'transcriptUploadFailed', 'Fallback')).toEqual({
      code: 'idempotencyConflict',
      message: 'The same key was used with different transcript data.',
      retryable: false,
      traceId: 'trace-upload-conflict',
    });
  });
});
