import type { ActivationEnabledPayload, LearningPackage, SessionSnapshot } from '../models/session-quiz-contracts';

export interface SessionState {
  status: 'idle' | 'starting' | 'active' | 'completing' | 'completed' | 'closed' | 'error';
  session?: SessionSnapshot;
  learningPackage?: LearningPackage;
  error?: string;
}

export type SessionAction =
  | { type: 'startRequested' }
  | { type: 'started'; session: SessionSnapshot }
  | { type: 'packageChanged'; learningPackage: LearningPackage }
  | { type: 'completeRequested' }
  | { type: 'completed'; session: SessionSnapshot }
  | { type: 'reset' }
  | { type: 'failed'; error: string };

export interface SessionApiPort {
  start(request: { youtubeVideoId: string; activation: ActivationEnabledPayload }): Promise<SessionSnapshot>;
  complete(sessionId: string, request: { clientCompletionId: string; reason: 'activationDisabled' | 'videoEnded' | 'videoContextChanged' | 'unsupportedWatchPage' }): Promise<SessionSnapshot>;
  getLearningPackage(sessionId: string): Promise<LearningPackage>;
}
