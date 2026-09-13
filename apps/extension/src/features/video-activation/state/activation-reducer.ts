import type { ActivationContext, ActivationState } from '../models/activation.types';
import type { TranscriptSnapshotRef } from '../models/video-activation.types';

export type ActivationAction =
  | { type: 'contextChanged'; context: ActivationContext }
  | { type: 'transcriptUpdated'; transcriptSnapshot: TranscriptSnapshotRef }
  | { type: 'manualOn' }
  | { type: 'manualOff' }
  | { type: 'requestRejected'; code: string };

export const initialActivationState: ActivationState = {
  context: null,
  status: 'off',
  transcriptSnapshot: null,
  errorCode: null,
};

export function activationReducer(state: ActivationState, action: ActivationAction): ActivationState {
  switch (action.type) {
    case 'contextChanged':
      return {
        context: action.context,
        status: 'off',
        transcriptSnapshot: null,
        errorCode: null,
      };
    case 'transcriptUpdated':
      return state.context?.youtubeVideoId === action.transcriptSnapshot.youtubeVideoId
        ? { ...state, transcriptSnapshot: action.transcriptSnapshot }
        : state;
    case 'manualOn':
      return state.context ? { ...state, status: 'active', errorCode: null } : state;
    case 'manualOff':
      return { ...state, status: 'off', errorCode: null };
    case 'requestRejected':
      return { ...state, errorCode: action.code };
  }
}
