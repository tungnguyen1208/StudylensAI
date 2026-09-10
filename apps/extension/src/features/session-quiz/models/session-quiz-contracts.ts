export const SESSION_QUIZ_CONTRACT_VERSION = '0.1.0' as const;

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
  version: typeof SESSION_QUIZ_CONTRACT_VERSION;
}

export interface ActivationDecisionFixture {
  decisionId: string;
  state: 'active' | 'inactive';
  source: 'auto' | 'manual';
  reasonCode: string;
  transcriptSnapshot?: TranscriptSnapshotRef;
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
  activationDecision: ActivationDecisionFixture;
}
