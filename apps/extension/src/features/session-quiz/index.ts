/**
 * Study Session & Quiz Generation Feature Entry Point — Dev 2
 *
 * Scope: immediate study-session lifecycle, full transcript processing state,
 * and full-video quiz presentation.
 */

export interface SessionQuizFeatureMetadata {
  name: string;
  version: string;
  owner: string;
}

export function registerSessionQuizFeature(): SessionQuizFeatureMetadata {
  return {
    name: 'session-quiz',
    version: '0.5.0',
    owner: 'Dev 2',
  };
}

export {
  SESSION_QUIZ_CONTRACT_VERSION,
  type ActivationEnabledPayload,
  type CompleteStudySessionRequest,
  type LearningPackage,
  type LearningPackageQuiz,
  type PreferenceSnapshot,
  type ProcessingOperation,
  type RetryProcessingRequest,
  type SessionSnapshot,
  type StartStudySessionRequest,
  type SubmitFullTranscriptRequest,
  type TranscriptCue,
  type TranscriptView,
  type QuestionOptionPublic,
  type QuestionPublic,
  type QuizPublic,
} from './models/session-quiz-contracts';

export { SessionManager } from './services/session-manager';
export {
  SessionQuizRuntime,
  registerSessionQuizRuntime,
  type MessageSubscriberPort,
  type SessionQuizRuntimeOptions,
} from './services/session-quiz-runtime';
export { SessionStore } from './state/session-store';
export { initialSessionState, sessionReducer } from './state/session-reducer';
export type { SessionAction, SessionState } from './state/session-types';
export { SessionQuizApi } from './api/session-quiz-api';
