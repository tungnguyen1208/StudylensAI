import type { ActivationDecisionFixture } from '../models/session-quiz-contracts';
import { initialSessionState, sessionReducer } from '../state/session-reducer';
import type { SessionAction, SessionApiPort, SessionState } from '../state/session-types';

export class SessionManager {
  private state: SessionState = initialSessionState;
  public constructor(private readonly api: SessionApiPort, private readonly dispatch: (action: SessionAction) => void = () => {}) {}
  public getState(): SessionState { return this.state; }
  public async activate(youtubeVideoId: string, decision: ActivationDecisionFixture): Promise<void> {
    if (decision.state !== 'active' || this.state.status === 'active' || this.state.status === 'starting') return;
    this.apply({ type: 'startRequested' });
    try { this.apply({ type: 'started', session: await this.api.start({ youtubeVideoId, activationDecision: decision }) }); }
    catch { this.apply({ type: 'failed', error: 'sessionStartFailed' }); }
  }
  public async complete(reason: 'activationStopped' | 'videoChanged' | 'videoEnded', activeStudyMs: number, clientCompletionId: string): Promise<void> {
    if (this.state.status !== 'active' || !this.state.session) return;
    this.apply({ type: 'completeRequested' });
    try { this.apply({ type: 'completed', session: await this.api.complete(this.state.session.sessionId, { clientCompletionId, reason, activeStudyMs }) }); }
    catch { this.apply({ type: 'failed', error: 'sessionCompleteFailed' }); }
  }
  private apply(action: SessionAction): void { this.state = sessionReducer(this.state, action); this.dispatch(action); }
}
