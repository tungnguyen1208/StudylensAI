/**
 * Video Activation Feature Entry Point — Dev 1
 *
 * Scope: YouTube video detection, video metadata, activation mode (Auto/Manual),
 * classification orchestration via Backend, and YouTube player adaptation.
 */

export interface VideoActivationFeatureMetadata {
  name: string;
  version: string;
  owner: string;
}

export function registerVideoActivationFeature(): VideoActivationFeatureMetadata {
  return {
    name: 'video-activation',
    version: '0.1.0',
    owner: 'Dev 1',
  };
}
