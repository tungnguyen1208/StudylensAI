import type { TranscriptSnapshotRef } from '../../../shared/contracts/activation-handoff';
import { DEFAULT_LEARNING_PREFERENCES } from './learning-preferences';

export const DEFAULT_MANUAL_PREFERENCES = DEFAULT_LEARNING_PREFERENCES;

export interface ActivationContext {
  tabId: number;
  youtubeVideoId: string;
  title: string;
}

export type { ActivationEnabledPayload, PreferenceSnapshot } from '../../../shared/contracts/activation-handoff';

export type ActivationStoppedReason = 'userDisabled';

export interface ActivationState {
  context: ActivationContext | null;
  status: 'off' | 'active';
  transcriptSnapshot: TranscriptSnapshotRef | null;
  errorCode: string | null;
}
