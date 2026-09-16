import { initialSessionState, sessionReducer } from './session-reducer';
import type { SessionAction, SessionState } from './session-types';

export type SessionStateListener = (state: SessionState) => void;

export class SessionStore {
  private state: SessionState = initialSessionState;
  private readonly listeners = new Set<SessionStateListener>();

  public getState(): SessionState {
    return this.state;
  }

  public dispatch(action: SessionAction): SessionState {
    const next = sessionReducer(this.state, action);
    if (next === this.state) return this.state;
    this.state = next;
    this.listeners.forEach((listener) => listener(next));
    return next;
  }

  public subscribe(listener: SessionStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
}
