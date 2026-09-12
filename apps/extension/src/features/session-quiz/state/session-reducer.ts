import type { SessionAction, SessionState } from './session-types';

export const initialSessionState: SessionState = { status: 'idle' };
export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'startRequested': return state.status === 'idle' || state.status === 'completed' ? { status: 'starting' } : state;
    case 'started': return { status: 'active', session: action.session };
    case 'completeRequested': return state.status === 'active' ? { ...state, status: 'completing' } : state;
    case 'completed': return { status: 'completed', session: action.session };
    case 'failed': return { ...state, status: 'error', error: action.error };
  }
}
