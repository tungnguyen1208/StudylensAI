import type { ActivationContext, ActivationState } from '../models/activation.types';

export type ActivationAction =
  | { type: 'contextChanged'; context: ActivationContext }
  | { type: 'manualOn' }
  | { type: 'manualOff' }
  | { type: 'contextUnavailable'; code: string }
  | { type: 'requestRejected'; code: string };

export const initialActivationState: ActivationState = {
  context: null,
  status: 'off',
  errorCode: null,
};

export function activationReducer(state: ActivationState, action: ActivationAction): ActivationState {
  switch (action.type) {
    case 'contextChanged':
      return {
        context: action.context,
        status: 'off',
        errorCode: null,
      };
    case 'manualOn':
      return state.context ? { ...state, status: 'active', errorCode: null } : state;
    case 'manualOff':
      return { ...state, status: 'off', errorCode: null };
    case 'contextUnavailable':
      return { context: null, status: 'off', errorCode: action.code };
    case 'requestRejected':
      return { ...state, errorCode: action.code };
  }
}
