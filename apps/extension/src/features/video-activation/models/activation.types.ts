import type { AvailableTranscriptSnapshotRef, TranscriptSnapshotRef } from './video-activation.types';
import {
  DEFAULT_LEARNING_PREFERENCES,
  type LearningPreferences,
} from './learning-preferences';

export const DEFAULT_MANUAL_PREFERENCES = DEFAULT_LEARNING_PREFERENCES;

export interface ActivationContext {
  tabId: number;
  youtubeVideoId: string;
  title: string;
}

export type PreferenceSnapshot = LearningPreferences;

export interface ActivationEnabledPayload {
  activationId: string;
  source: 'user' | 'storageRestore';
  videoTitle: string;
  transcriptSnapshot: AvailableTranscriptSnapshotRef;
  preferences: PreferenceSnapshot;
}

export type ActivationStoppedReason = 'userDisabled';

export interface ActivationState {
  context: ActivationContext | null;
  status: 'off' | 'active';
  transcriptSnapshot: TranscriptSnapshotRef | null;
  errorCode: string | null;
}
