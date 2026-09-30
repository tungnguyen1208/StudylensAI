import type { SessionAction, SessionState } from './session-types';

export const initialSessionState: SessionState = { status: 'idle' };

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'startRequested': return { status: 'starting' };
    case 'started': return { status: 'active', session: action.session };
    case 'packageChanged': return { ...state, session: action.learningPackage.session, learningPackage: action.learningPackage };
    case 'completeRequested': return state.session ? { ...state, status: 'completing' } : state;
    case 'completed': return { status: action.session.status === 'closed' ? 'closed' : 'completed', session: action.session };
    case 'failed': return { ...state, status: 'error', error: action.error };
    case 'reset': return initialSessionState;
  }
}
