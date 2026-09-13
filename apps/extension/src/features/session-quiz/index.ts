/**
 * Study Session & Quiz Generation Feature Entry Point — Dev 2
 *
 * Scope: Study session lifecycle, active watch time tracking, transcript segmentation,
 * quiz generation request via Backend, and QuestionPublic presentation.
 */

export interface SessionQuizFeatureMetadata {
  name: string;
  version: string;
  owner: string;
}

export function registerSessionQuizFeature(): SessionQuizFeatureMetadata {
  return {
    name: 'session-quiz',
    version: '0.1.0',
    owner: 'Dev 2',
  };
}

export {
  SESSION_QUIZ_CONTRACT_VERSION,
  type ActivationDecisionFixture,
  type PreferenceSnapshot,
  type SessionSnapshot,
  type StartStudySessionRequest,
  type TranscriptSnapshotRef,
  type TranscriptCue,
  type QuestionOptionPublic,
  type QuestionPublic,
  type QuizPublic,
  type GenerateQuizRequest,
} from './models/session-quiz-contracts';

export { StudyTimer, type Clock, type PlayerLifecycleEvent, type StudyTimerSnapshot, type StudyTimerStateStore } from './services/study-timer';
export { SessionQuizApi } from './api/session-quiz-api';
