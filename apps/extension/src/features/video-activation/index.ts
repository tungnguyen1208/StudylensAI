/**
 * Public metadata and stable types for the Video Activation feature.
 * The browser runtime initializer lives in content-script-entry.ts so the
 * manifest content script can be bundled as a self-contained classic script.
 */
export interface VideoActivationFeatureMetadata {
  name: string;
  version: string;
  owner: string;
}

export function registerVideoActivationFeature(): VideoActivationFeatureMetadata {
  return {
    name: 'video-activation',
    version: '0.2.0',
    owner: 'Dev 1',
  };
}

export type { PlayerPort } from '../../platform/youtube/youtube-player-adapter';
export type { TranscriptSnapshotRef } from './models/video-activation.types';
export { ActivationStatus } from './components/ActivationStatus';
export { ActivationToggle } from './components/ActivationToggle';
export { ManualActivationManager } from './services/activation-manager';
export { initialActivationState } from './state/activation-reducer';
export { applyVideoActivationMessage } from './state/side-panel-activation';
export type { ActivationState, PreferenceSnapshot } from './models/activation.types';
