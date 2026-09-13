import { createVideoActivationMessage } from '../../../platform/youtube/youtube-events';
import type { ExtensionMessage } from '../../../shared/messaging/message-types';
import {
  DEFAULT_MANUAL_PREFERENCES,
  type ActivationContext,
  type ActivationDecisionPayload,
  type ActivationState,
  type ActivationStoppedReason,
  type PreferenceSnapshot,
} from '../models/activation.types';
import type { TranscriptSnapshotRef } from '../models/video-activation.types';
import { activationReducer, initialActivationState } from '../state/activation-reducer';

export interface ManualActivationManagerOptions {
  publish(message: ExtensionMessage): Promise<void>;
  preferences?: PreferenceSnapshot;
  createDecisionId?: () => string;
}

/** Business coordinator for Manual mode. It never reads or controls YouTube DOM. */
export class ManualActivationManager {
  private state: ActivationState = initialActivationState;
  private readonly preferences: PreferenceSnapshot;
  private readonly createDecisionId: () => string;

  public constructor(private readonly options: ManualActivationManagerOptions) {
    this.preferences = options.preferences ?? DEFAULT_MANUAL_PREFERENCES;
    this.createDecisionId = options.createDecisionId ?? (() => crypto.randomUUID());
  }

  public getState(): ActivationState { return this.state; }

  public async setContext(context: ActivationContext, correlationId: string): Promise<void> {
    const previous = this.state.context;
    const wasActive = this.state.status === 'active';
    if (previous && previous.youtubeVideoId !== context.youtubeVideoId && wasActive) {
      await this.publishStopped(previous, correlationId, 'videoChanged');
    }
    this.state = activationReducer(this.state, { type: 'contextChanged', context });
  }

  public setTranscriptSnapshot(transcriptSnapshot: TranscriptSnapshotRef): void {
    this.state = activationReducer(this.state, { type: 'transcriptUpdated', transcriptSnapshot });
  }

  public async request(requestedState: 'on' | 'off', videoId: string, correlationId: string): Promise<boolean> {
    const context = this.state.context;
    if (!context || context.youtubeVideoId !== videoId) {
      this.state = activationReducer(this.state, { type: 'requestRejected', code: 'videoContextUnavailable' });
      return false;
    }

    if (requestedState === 'off') {
      if (this.state.status === 'active') await this.publishStopped(context, correlationId, 'userDisabled');
      this.state = activationReducer(this.state, { type: 'manualOff' });
      return true;
    }

    if (this.state.status === 'active') return true;
    this.state = activationReducer(this.state, { type: 'manualOn' });
    const payload: ActivationDecisionPayload = {
      decisionId: this.createDecisionId(),
      state: 'active',
      source: 'manual',
      reasonCode: 'userEnabled',
      preferences: this.preferences,
    };
    if (this.state.transcriptSnapshot) payload.transcriptSnapshot = this.state.transcriptSnapshot;
    await this.options.publish(createVideoActivationMessage('ACTIVATION_DECIDED', payload, {
      correlationId,
      tabId: context.tabId,
      youtubeVideoId: context.youtubeVideoId,
    }));
    return true;
  }

  private publishStopped(context: ActivationContext, correlationId: string, reasonCode: ActivationStoppedReason): Promise<void> {
    return this.options.publish(createVideoActivationMessage('ACTIVATION_STOPPED', { reasonCode }, {
      correlationId,
      tabId: context.tabId,
      youtubeVideoId: context.youtubeVideoId,
    }));
  }
}
