/**
 * Public Extension handoff types for Dev 1 -> Dev 2.
 *
 * These are TypeScript projections of the versioned contracts. They contain
 * no browser persistence, DOM, or feature-internal state.
 */
export type QuizIntervalMinutes = 5 | 10 | 15;
export type QuestionType = 'multipleChoice' | 'shortAnswer';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface PreferenceSnapshot {
  quizIntervalMinutes: QuizIntervalMinutes;
  questionType: QuestionType;
  difficulty: Difficulty;
}

export type TranscriptSnapshotStatus = 'available' | 'unavailable' | 'insufficient';

export interface TranscriptSnapshotRef {
  transcriptSnapshotId: string;
  youtubeVideoId: string;
  language: string;
  status: TranscriptSnapshotStatus;
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
