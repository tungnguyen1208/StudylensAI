import type { TranscriptSnapshotRef } from './video-activation.types';

export const DEFAULT_MANUAL_PREFERENCES = {
  quizIntervalMinutes: 10,
  questionType: 'multipleChoice',
  difficulty: 'medium',
} as const;

export interface ActivationContext {
  tabId: number;
  youtubeVideoId: string;
  title: string;
}

export interface PreferenceSnapshot {
  quizIntervalMinutes: 5 | 10 | 15;
  questionType: 'multipleChoice' | 'shortAnswer';
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface ActivationDecisionPayload {
  decisionId: string;
  state: 'active';
  source: 'manual';
  reasonCode: 'userEnabled';
  transcriptSnapshot?: TranscriptSnapshotRef;
  preferences: PreferenceSnapshot;
}

export type ActivationStoppedReason = 'userDisabled' | 'videoChanged';

export interface ActivationState {
  context: ActivationContext | null;
  status: 'off' | 'active';
  transcriptSnapshot: TranscriptSnapshotRef | null;
  errorCode: string | null;
}
