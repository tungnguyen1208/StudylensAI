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
  private prepared: { sessionId: string; request: SubmitFullTranscriptRequest } | null = null;

  public constructor(private readonly api: SessionTranscriptApiPort = new SessionQuizApi()) {}

  public async upload(
    sessionId: string,
    youtubeVideoId: string,
    transcript: TranscriptReadResult,
    videoDurationMs?: number | null,
  ): Promise<LearningPackage> {
    if (this.prepared?.sessionId !== sessionId) {
      this.prepared = {
        sessionId,
        request: await createTranscriptRequest(sessionId, youtubeVideoId, transcript, videoDurationMs),
      };
    }
    return this.api.submitTranscript(
      sessionId,
      this.prepared.request,
    );
  }
}

export async function createTranscriptRequest(
  sessionId: string,
  youtubeVideoId: string,
  transcript: TranscriptReadResult,
  videoDurationMs?: number | null,
): Promise<SubmitFullTranscriptRequest> {
  const cues = transcript.status === 'available' ? canonicalizeTranscriptCues(transcript.cues) : [];
  const contentHash = transcript.status === 'available'
    ? await hashTranscript(cues)
    : undefined;
  const durationMs = transcript.status === 'available'
    ? videoDurationMs && Number.isFinite(videoDurationMs) && videoDurationMs > 0
      ? Math.round(videoDurationMs)
      : cues.reduce((maximum, cue) => Math.max(maximum, cue.endMs), 0)
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
    cues,
  };
}

/** Mirrors Backend NormalizeCues before hashing and sending the payload. */
export function canonicalizeTranscriptCues(
  cues: readonly { startMs: number; endMs: number; text: string }[],
): Array<{ startMs: number; endMs: number; text: string }> {
  return cues
    // Match .NET Char.IsWhiteSpace used by LearningPackageService.NormalizeText.
    // JavaScript's \s differs for U+0085 and U+FEFF, so it is not sufficient.
    .map((cue) => ({ ...cue, text: cue.text
      .replace(/[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g, ' ')
      .replace(/^ +| +$/g, '') }))
    .filter((cue) => cue.text.length > 0)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

export async function hashTranscript(
  cues: readonly { startMs: number; endMs: number; text: string }[],
): Promise<string> {
  const canonical = canonicalizeTranscriptCues(cues)
    .map((cue) => `${cue.startMs}|${cue.endMs}|${cue.text}`).join('\n');
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
