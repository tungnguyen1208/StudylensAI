import type { ActivationDecisionFixture, SessionSnapshot } from '../models/session-quiz-contracts';

export interface SessionState { status: 'idle' | 'starting' | 'active' | 'completing' | 'completed' | 'error'; session?: SessionSnapshot; error?: string; }
export type SessionAction =
  | { type: 'startRequested' }
  | { type: 'started'; session: SessionSnapshot }
  | { type: 'completeRequested' }
  | { type: 'completed'; session: SessionSnapshot }
  | { type: 'failed'; error: string };
export interface SessionApiPort { start(request: { youtubeVideoId: string; activationDecision: ActivationDecisionFixture }): Promise<SessionSnapshot>; complete(sessionId: string, request: { clientCompletionId: string; reason: 'activationStopped' | 'videoChanged' | 'videoEnded'; activeStudyMs: number }): Promise<SessionSnapshot>; }
