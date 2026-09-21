import { createVideoActivationMessage } from '../../../platform/youtube/youtube-events';
import type { ExtensionMessage } from '../../../shared/messaging/message-types';
import {
  DEFAULT_MANUAL_PREFERENCES,
  type ActivationContext,
  type ActivationEnabledPayload,
  type ActivationState,
  type ActivationStoppedReason,
  type PreferenceSnapshot,
} from '../models/activation.types';
import type { AvailableTranscriptSnapshotRef, TranscriptSnapshotRef } from '../models/video-activation.types';
import { activationReducer, initialActivationState } from '../state/activation-reducer';

export interface ManualActivationManagerOptions {
  publish(message: ExtensionMessage): Promise<void>;
  preferences?: PreferenceSnapshot;
  createActivationId?: () => string;
}

/** Business coordinator for Manual mode. It never reads or controls YouTube DOM. */
export class ManualActivationManager {
  private state: ActivationState = initialActivationState;
  private preferences: PreferenceSnapshot;
  private readonly createActivationId: () => string;
  private pendingActivation: { correlationId: string; activationId: string; source: 'user' | 'storageRestore' } | null = null;
  private currentActivationId: string | null = null;

  public constructor(private readonly options: ManualActivationManagerOptions) {
    this.preferences = { ...(options.preferences ?? DEFAULT_MANUAL_PREFERENCES) };
    this.createActivationId = options.createActivationId ?? (() => crypto.randomUUID());
  }

  public getState(): ActivationState { return this.state; }

  /** Identifies the running or transcript-pending flow for a transition seam. */
  public getCurrentActivationId(): string | null {
    return this.currentActivationId ?? this.pendingActivation?.activationId ?? null;
  }

  /** Applies only before the next activation snapshot is created. */
  public setPreferences(preferences: PreferenceSnapshot): void {
    if (this.state.status === 'active') return;
    this.preferences = { ...preferences };
  }

  public async setContext(context: ActivationContext, _correlationId: string): Promise<void> {
    this.state = activationReducer(this.state, { type: 'contextChanged', context });
    this.pendingActivation = null;
    this.currentActivationId = null;
  }

  public setTranscriptSnapshot(transcriptSnapshot: TranscriptSnapshotRef): void {
    this.state = activationReducer(this.state, { type: 'transcriptUpdated', transcriptSnapshot });
    void this.publishPendingActivation();
  }

  /** Stops local page work without persisting or publishing a user OFF action. */
  public clearUnavailableContext(code = 'unsupportedWatchPage'): void {
    this.pendingActivation = null;
    this.currentActivationId = null;
    this.state = activationReducer(this.state, { type: 'contextUnavailable', code });
  }

  public async request(
    requestedState: 'on' | 'off',
    videoId: string,
    correlationId: string,
    source: 'user' | 'storageRestore' = 'user',
  ): Promise<boolean> {
    const context = this.state.context;
    if (!context || context.youtubeVideoId !== videoId) {
      this.state = activationReducer(this.state, { type: 'requestRejected', code: 'videoContextUnavailable' });
      return false;
    }

    if (requestedState === 'off') {
      if (this.state.status === 'active') await this.publishStopped(context, correlationId, 'userDisabled');
      this.state = activationReducer(this.state, { type: 'manualOff' });
      this.currentActivationId = null;
      return true;
    }

    if (this.state.status === 'active') return true;
    this.state = activationReducer(this.state, { type: 'manualOn' });
    this.pendingActivation = { correlationId, activationId: this.createActivationId(), source };
    await this.publishPendingActivation();
    return true;
  }

  private async publishPendingActivation(): Promise<void> {
    const context = this.state.context;
    const transcriptSnapshot = this.state.transcriptSnapshot;
    const pending = this.pendingActivation;
    if (this.state.status !== 'active' || !context || !transcriptSnapshot || transcriptSnapshot.status !== 'available' || !transcriptSnapshot.contentHash || !pending) return;

    this.pendingActivation = null;
    this.currentActivationId = pending.activationId;
    const payload: ActivationEnabledPayload = {
      activationId: pending.activationId,
      source: pending.source,
      videoTitle: context.title,
      preferences: { ...this.preferences },
      transcriptSnapshot: transcriptSnapshot as AvailableTranscriptSnapshotRef,
    };
    await this.options.publish(createVideoActivationMessage('ACTIVATION_ENABLED', payload, {
      correlationId: pending.correlationId,
      tabId: context.tabId,
      youtubeVideoId: context.youtubeVideoId,
    }));
  }

  private publishStopped(context: ActivationContext, correlationId: string, reasonCode: ActivationStoppedReason): Promise<void> {
    this.pendingActivation = null;
    return this.options.publish(createVideoActivationMessage('ACTIVATION_DISABLED', { reasonCode }, {
      correlationId,
      tabId: context.tabId,
      youtubeVideoId: context.youtubeVideoId,
    }));
  }
}
