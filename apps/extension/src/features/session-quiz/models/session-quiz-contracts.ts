export const SESSION_QUIZ_CONTRACT_VERSION = '0.2.0' as const;

export type QuizIntervalMinutes = 5 | 10 | 15;
export type QuestionType = 'multipleChoice' | 'shortAnswer';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface PreferenceSnapshot {
  quizIntervalMinutes: QuizIntervalMinutes;
  questionType: QuestionType;
  difficulty: Difficulty;
}

export interface TranscriptSnapshotRef {
  transcriptSnapshotId: string;
  youtubeVideoId: string;
  language: string;
  status: 'available' | 'unavailable' | 'insufficient';
  contentHash?: string;
  version: string;
}

export type AvailableTranscriptSnapshotRef = TranscriptSnapshotRef & {
  status: 'available';
  contentHash: string;
};

export interface ActivationEnabledPayload {
  activationId: string;
  source: 'user' | 'storageRestore';
  videoTitle: string;
  transcriptSnapshot: AvailableTranscriptSnapshotRef;
  preferences: PreferenceSnapshot;
}

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

export interface QuestionOptionPublic {
  optionId: string;
  text: string;
}

/** Safe for the Extension: answer keys and rubrics are intentionally absent. */
export interface QuestionPublic {
  questionId: string;
  type: QuestionType;
  prompt: string;
  options?: QuestionOptionPublic[];
  source: { youtubeVideoId: string; startMs: number; endMs: number };
}

export interface QuizPublic {
  quizId: string;
  sessionId: string;
  segmentId: string;
  status: 'available';
  questions: QuestionPublic[];
  createdAtUtc: string;
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

