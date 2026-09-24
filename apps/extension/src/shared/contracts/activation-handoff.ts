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
export type TranscriptSource = 'youtubeCaption';

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

/**
 * A capture references the immutable caption cue set persisted by Backend.
 * Dev 2 freezes the relevant cue range when it creates a segment.
 */
export interface TranscriptCaptureRef {
  transcriptCaptureId: string;
  youtubeVideoId: string;
  language: string;
  source: TranscriptSource;
  status: 'available' | 'unavailable' | 'insufficient';
  availableCueCount: number;
  version: number;
}

export interface ActivationEnabledPayload {
  activationId: string;
  source: 'user' | 'storageRestore';
  videoTitle: string;
  transcriptCapture: TranscriptCaptureRef & { status: 'available' };
  preferences: PreferenceSnapshot;
}
