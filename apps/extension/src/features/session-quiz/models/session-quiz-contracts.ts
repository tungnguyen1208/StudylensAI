import type {
  ActivationEnabledPayload,
  Difficulty,
  QuestionType,
} from '../../../shared/contracts/activation-handoff';

export type {
  ActivationEnabledPayload,
  AvailableTranscriptSnapshotRef,
  Difficulty,
  PreferenceSnapshot,
  QuestionOptionPublic,
  QuestionPublic,
  QuestionType,
  QuizPublic,
  QuizIntervalMinutes,
  TranscriptSnapshotRef,
} from '../../../shared/contracts';

export const SESSION_QUIZ_CONTRACT_VERSION = '0.2.0' as const;

export interface SessionSnapshot {
  sessionId: string;
  youtubeVideoId: string;
  status: 'active' | 'completed';
  activeStudyMs: number;
  startedAtUtc: string;
  completedAtUtc?: string;
}

export interface StartStudySessionRequest {
  contractVersion: typeof SESSION_QUIZ_CONTRACT_VERSION;
  youtubeVideoId: string;
  activation: ActivationEnabledPayload;
}

export interface TranscriptCue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface GenerateQuizRequest {
  contractVersion: typeof SESSION_QUIZ_CONTRACT_VERSION;
  sessionId: string;
  segmentId: string;
  youtubeVideoId: string;
  questionType: QuestionType;
  difficulty: Difficulty;
  idempotencyKey: string;
}

// ============================================================
// segment contracts
// ============================================================

export interface PlaybackSpanPayload {
  startMs: number;
  endMs: number;
}

export interface CreateStudySegmentRequest {
  contractVersion: typeof SESSION_QUIZ_CONTRACT_VERSION;
  clientSegmentId: string;
  idempotencyKey: string;
  activeStudyMs?: number;
  playbackSpans: PlaybackSpanPayload[];
}

export interface StudySegmentRef {
  segmentId: string;
  sessionId: string;
  youtubeVideoId: string;
  startMs: number;
  endMs: number;
}

export interface CompleteStudySessionRequest {
  contractVersion: typeof SESSION_QUIZ_CONTRACT_VERSION;
  clientCompletionId: string;
  reason: 'activationDisabled' | 'videoEnded' | 'videoContextChanged';
  activeStudyMs: number;
}

