import type { ActivationDecisionFixture, SessionSnapshot, StudySegmentRef } from '../models/session-quiz-contracts';

// ============================================================
// state
// ============================================================

export type SegmentStatus = 'idle' | 'creating' | 'created' | 'retryable' | 'blocked';

export interface SessionState {
  status: 'idle' | 'starting' | 'active' | 'completing' | 'completed' | 'error';
  session?: SessionSnapshot;
  error?: string;
  activeStudyMs: number;
  segmentStatus: SegmentStatus;
  lastSegment?: StudySegmentRef;
  segmentError?: string;
}

// ============================================================
// actions
// ============================================================

export type SessionAction =
  | { type: 'startRequested' }
  | { type: 'started'; session: SessionSnapshot }
  | { type: 'completeRequested' }
  | { type: 'completed'; session: SessionSnapshot }
  | { type: 'failed'; error: string }
  | { type: 'activeStudyMsChanged'; activeStudyMs: number }
  | { type: 'segmentRequested' }
  | { type: 'segmentCreated'; segment: StudySegmentRef }
  | { type: 'segmentRetryable'; error: string }
  | { type: 'segmentBlocked'; code: string };

// ============================================================
// ports
// ============================================================

export interface SessionApiPort {
  start(request: { youtubeVideoId: string; activationDecision: ActivationDecisionFixture }): Promise<SessionSnapshot>;
  complete(sessionId: string, request: { clientCompletionId: string; reason: 'activationStopped' | 'videoChanged' | 'videoEnded'; activeStudyMs: number }): Promise<SessionSnapshot>;
}
