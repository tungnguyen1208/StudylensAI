import { TranscriptReadResult } from '../../../platform/youtube/transcript-reader';
import { VideoActivationApi } from '../api/video-activation-api';
import {
  CreateTranscriptSnapshotRequest,
  TranscriptSnapshotRef,
} from '../models/video-activation.types';

export class TranscriptService {
  private readonly api: VideoActivationApi;

  public constructor(api: VideoActivationApi = new VideoActivationApi()) {
    this.api = api;
  }

  public async upload(
    youtubeVideoId: string,
    transcript: TranscriptReadResult,
  ): Promise<TranscriptSnapshotRef> {
    const request = await createTranscriptSnapshotRequest(youtubeVideoId, transcript);
    return this.api.createTranscriptSnapshot(request);
  }
}

export async function createTranscriptSnapshotRequest(
  youtubeVideoId: string,
  transcript: TranscriptReadResult,
): Promise<CreateTranscriptSnapshotRequest> {
  if (transcript.status !== 'available') {
    return {
      idempotencyKey: `transcript:${youtubeVideoId}:${transcript.status}:${transcript.language}`,
      youtubeVideoId,
      language: transcript.language,
      source: 'youtubeCaption',
      status: transcript.status,
      cues: [],
    };
  }

  const contentHash = await hashTranscript(transcript.cues);
  return {
    idempotencyKey: `transcript:${youtubeVideoId}:${contentHash}`,
    youtubeVideoId,
    language: transcript.language,
    source: 'youtubeCaption',
    status: 'available',
    contentHash,
    cues: transcript.cues,
  };
}

export async function hashTranscript(
  cues: ReadonlyArray<{ startMs: number; endMs: number; text: string }>,
): Promise<string> {
  const canonical = cues.map((cue) => `${cue.startMs}|${cue.endMs}|${cue.text}`).join('\n');
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
