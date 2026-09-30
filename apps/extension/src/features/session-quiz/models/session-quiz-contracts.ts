import type { PreferenceSnapshot, QuestionType } from '../../../shared/contracts/activation-handoff';

export type {
  ActivationEnabledPayload,
  Difficulty,
  PreferenceSnapshot,
  QuestionOptionPublic,
  QuestionPublic,
  QuestionType,
  QuizPublic,
} from '../../../shared/contracts';

export const SESSION_QUIZ_CONTRACT_VERSION = '0.5.0' as const;

export type SessionStatus = 'active' | 'completed' | 'closed' | 'failed';
export type TranscriptProcessingStatus = 'waiting' | 'validating' | 'generating' | 'ready' | 'unavailable' | 'failed';
export type QuizProcessingStatus = 'notStarted' | 'queued' | 'generating' | 'ready' | 'failed';
export type ProcessingOperation = 'transcriptGenerate' | 'quizGenerate';

export interface SessionSnapshot {
  sessionId: string;
  youtubeVideoId: string;
  videoTitle: string;
  status: SessionStatus;
  preferences: PreferenceSnapshot;
  startedAtUtc: string;
  completedAtUtc?: string;
}

export interface StartStudySessionRequest {
  contractVersion: typeof SESSION_QUIZ_CONTRACT_VERSION;
  activationId: string;
  idempotencyKey: string;
  youtubeVideoId: string;
  videoTitle: string;
  preferences: PreferenceSnapshot;
}

export interface TranscriptCue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SubmitFullTranscriptRequest {
  contractVersion: typeof SESSION_QUIZ_CONTRACT_VERSION;
  idempotencyKey: string;
  youtubeVideoId: string;
  language: string;
  source: 'youtubeCaption';
  status: 'available' | 'unavailable' | 'insufficient';
  contentHash?: string;
  durationMs?: number;
  cues: TranscriptCue[];
}

export interface TranscriptView {
  status: TranscriptProcessingStatus;
  transcriptCaptureId?: string;
  source?: 'youtubeCaption' | 'geminiVideo';
  language?: string;
  contentHash?: string;
  cueCount: number;
  cues: TranscriptCue[];
}

export interface LearningPackageQuestionOption { optionId: string; text: string; }
export interface LearningPackageQuestion {
  questionId: string;
  type: QuestionType;
  prompt: string;
  options?: LearningPackageQuestionOption[];
  source: { youtubeVideoId: string; startMs: number; endMs: number };
}
export interface LearningPackageQuiz {
  quizId: string;
  sessionId: string;
  status: 'ready';
  questions: LearningPackageQuestion[];
  createdAtUtc: string;
}
export interface ProcessingError {
  operation: ProcessingOperation;
  code: string;
  message: string;
  retryable: boolean;
}
export interface LearningPackage {
  session: SessionSnapshot;
  transcript: TranscriptView;
  quizStatus: QuizProcessingStatus;
  quiz?: LearningPackageQuiz;
  error?: ProcessingError;
}

export interface RetryProcessingRequest {
  contractVersion: typeof SESSION_QUIZ_CONTRACT_VERSION;
  operation: ProcessingOperation;
}

export interface CompleteStudySessionRequest {
  contractVersion: typeof SESSION_QUIZ_CONTRACT_VERSION;
  clientCompletionId: string;
  reason: 'activationDisabled' | 'videoEnded' | 'videoContextChanged' | 'unsupportedWatchPage';
}

