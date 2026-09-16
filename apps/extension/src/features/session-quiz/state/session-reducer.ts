import type { SessionAction, SessionState } from './session-types';

export const initialSessionState: SessionState = { status: 'idle', activeStudyMs: 0, segmentStatus: 'idle' };

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    // ============================================================
    // session lifecycle
    // ============================================================
    case 'startRequested':
      return state.status === 'idle' || state.status === 'completed'
        ? { ...initialSessionState, status: 'starting' }
        : state;
    case 'started':
      return { ...state, status: 'active', session: action.session, error: undefined };
    case 'completeRequested':
      return state.status === 'active' ? { ...state, status: 'completing' } : state;
    case 'completed':
      return { ...state, status: 'completed', session: action.session, activeStudyMs: action.session.activeStudyMs };
    case 'failed':
      return { ...state, status: 'error', error: action.error };

    // ============================================================
    // timer and segments
    // ============================================================
    case 'activeStudyMsChanged':
      return { ...state, activeStudyMs: Math.max(state.activeStudyMs, action.activeStudyMs) };
    case 'segmentRequested':
      return { ...state, segmentStatus: 'creating', segmentError: undefined };
    case 'segmentCreated':
      return { ...state, segmentStatus: 'created', lastSegment: action.segment, segmentError: undefined };
    case 'segmentRetryable':
      return { ...state, segmentStatus: 'retryable', segmentError: action.error };
    case 'segmentBlocked':
      return { ...state, segmentStatus: 'blocked', segmentError: action.code };
  }
}
