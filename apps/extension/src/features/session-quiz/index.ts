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
  type CompleteStudySessionRequest,
  type CreateStudySegmentRequest,
  type PlaybackSpanPayload,
  type PreferenceSnapshot,
  type SessionSnapshot,
  type StartStudySessionRequest,
  type StudySegmentRef,
  type TranscriptSnapshotRef,
  type TranscriptCue,
  type QuestionOptionPublic,
  type QuestionPublic,
  type QuizPublic,
  type GenerateQuizRequest,
} from './models/session-quiz-contracts';

export { StudyTimer, ChromeStudyTimerStateStore, type Clock, type PlayerLifecycleEvent, type StudyTimerSnapshot, type StudyTimerStateStore } from './services/study-timer';
export { PlaybackSpanTracker, spanBounds, totalWatchedMs, type PlaybackEvent, type PlaybackSpan } from './services/playback-span-tracker';
export { SegmentManager, type PendingSegment, type PendingSegmentStore, type SegmentApiPort, type SegmentAttempt } from './services/segment-manager';
export { SessionManager } from './services/session-manager';
export {
  SessionQuizRuntime,
  registerSessionQuizRuntime,
  type MessageSubscriberPort,
  type SessionQuizRuntimeOptions,
} from './services/session-quiz-runtime';
export { SessionStore } from './state/session-store';
export { initialSessionState, sessionReducer } from './state/session-reducer';
export type { SegmentStatus, SessionAction, SessionState } from './state/session-types';
export { SessionQuizApi } from './api/session-quiz-api';
