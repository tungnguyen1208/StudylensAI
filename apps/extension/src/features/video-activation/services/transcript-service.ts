import type { TranscriptReadResult } from '../../../platform/youtube/transcript-reader';
import { SessionQuizApi } from '../../session-quiz/api/session-quiz-api';
import {
  SESSION_QUIZ_CONTRACT_VERSION,
  type LearningPackage,
  type SubmitFullTranscriptRequest,
} from '../../session-quiz/models/session-quiz-contracts';

export interface SessionTranscriptApiPort {
  submitTranscript(sessionId: string, request: SubmitFullTranscriptRequest): Promise<LearningPackage>;
}

/** Sends one immutable, full-video caption payload to the active Backend session. */
export class TranscriptService {
  public constructor(private readonly api: SessionTranscriptApiPort = new SessionQuizApi()) {}

  public async upload(
    sessionId: string,
    youtubeVideoId: string,
    transcript: TranscriptReadResult,
  ): Promise<LearningPackage> {
    return this.api.submitTranscript(
      sessionId,
      await createTranscriptRequest(sessionId, youtubeVideoId, transcript),
    );
  }
}

export async function createTranscriptRequest(
  sessionId: string,
  youtubeVideoId: string,
  transcript: TranscriptReadResult,
): Promise<SubmitFullTranscriptRequest> {
  const contentHash = transcript.status === 'available'
    ? await hashTranscript(transcript.cues)
    : undefined;
  const durationMs = transcript.status === 'available'
    ? transcript.cues.reduce((maximum, cue) => Math.max(maximum, cue.endMs), 0)
    : undefined;
  const identity = contentHash ?? transcript.status;

  return {
    contractVersion: SESSION_QUIZ_CONTRACT_VERSION,
    idempotencyKey: `transcript:${sessionId}:${youtubeVideoId}:${identity}`,
    youtubeVideoId,
    language: transcript.language,
    source: 'youtubeCaption',
    status: transcript.status,
    ...(contentHash ? { contentHash } : {}),
    ...(durationMs && durationMs > 0 ? { durationMs } : {}),
    cues: transcript.cues,
  };
}

export async function hashTranscript(
  cues: readonly { startMs: number; endMs: number; text: string }[],
): Promise<string> {
  const canonical = cues.map((cue) => `${cue.startMs}|${cue.endMs}|${cue.text.replace(/\s+/g, ' ').trim()}`).join('\n');
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
