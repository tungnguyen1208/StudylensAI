import type { TranscriptReadResult } from '../../../platform/youtube/transcript-reader';
import type { TranscriptCaptureRef } from '../../../shared/contracts/activation-handoff';
import type { CreateTranscriptCaptureRequest } from '../models/video-activation.types';
import {
  uploadTranscriptCaptureThroughWorker,
  type TranscriptCaptureBackendPort,
} from './transcript-worker-bridge';

export type TranscriptCaptureApiPort = TranscriptCaptureBackendPort;

/** Sends normalized YouTube caption evidence to the Backend system of record. */
export class TranscriptService {
  public constructor(private readonly api: TranscriptCaptureApiPort = {
    createTranscriptCapture: uploadTranscriptCaptureThroughWorker,
  }) {}

  public async upload(youtubeVideoId: string, transcript: TranscriptReadResult): Promise<TranscriptCaptureRef> {
    return this.api.createTranscriptCapture(await createTranscriptCaptureRequest(youtubeVideoId, transcript));
  }
}

export async function createTranscriptCaptureRequest(
  youtubeVideoId: string,
  transcript: TranscriptReadResult,
): Promise<CreateTranscriptCaptureRequest> {
  if (transcript.status !== 'available') {
    return {
      idempotencyKey: `caption:${youtubeVideoId}:${transcript.status}:${transcript.language}`,
      youtubeVideoId,
      language: transcript.language,
      source: 'youtubeCaption',
      status: transcript.status,
      cues: [],
    };
  }
  const contentHash = await hashTranscript(transcript.cues);
  return {
    idempotencyKey: `caption:${youtubeVideoId}:${contentHash}`,
    youtubeVideoId,
    language: transcript.language,
    source: 'youtubeCaption',
    status: 'available',
    contentHash,
    cues: transcript.cues,
  };
}

export async function hashTranscript(cues: ReadonlyArray<{ startMs: number; endMs: number; text: string }>): Promise<string> {
  const canonical = cues.map((cue) => `${cue.startMs}|${cue.endMs}|${cue.text}`).join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
