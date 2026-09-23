import type { ExtensionMessage } from '../../../shared/messaging/message-types';
import type { ActivationState } from '../models/activation.types';
import { activationReducer } from './activation-reducer';

/** Maps only public activation event envelopes into Side Panel display state. */
export function applyVideoActivationMessage(
  state: ActivationState,
  message: ExtensionMessage,
): ActivationState {
  if (message.type === 'ACTIVATION_ENABLED') {
    const title = getVideoTitle(message.payload);
    let next = activationReducer(state, {
      type: 'contextChanged',
      context: { tabId: message.tabId, youtubeVideoId: message.youtubeVideoId, title },
    });
    next = activationReducer(next, { type: 'manualOn' });
    const transcriptCapture = getTranscriptCapture(message.payload);
    if (transcriptCapture) {
      next = activationReducer(next, { type: 'transcriptCaptureUpdated', transcriptCapture });
    }
    return next;
  }
  if (message.type === 'ACTIVATION_DISABLED') {
    return activationReducer(state, { type: 'manualOff' });
  }
  if (message.type === 'VIDEO_CONTEXT_CHANGED') {
    const title = getVideoTitle(message.payload);
    const next = activationReducer(state, {
      type: 'contextChanged',
      context: { tabId: message.tabId, youtubeVideoId: message.youtubeVideoId, title },
    });
    // The persistent global gate remains ON while the new transcript is captured.
    return activationReducer(next, { type: 'manualOn' });
  }
  if (message.type === 'VIDEO_CONTEXT_UNAVAILABLE') {
    // This is not a learner OFF. Keep the UI ON but explain that page flow waits.
    return { ...state, context: null, transcriptCapture: null, status: 'active', errorCode: 'unsupportedWatchPage' };
  }
  return state;
}

function getTranscriptCapture(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const capture = (payload as { transcriptCapture?: unknown }).transcriptCapture;
  if (!capture || typeof capture !== 'object') return null;
  const value = capture as {
    transcriptCaptureId?: unknown; youtubeVideoId?: unknown; language?: unknown;
    source?: unknown; status?: unknown; version?: unknown; availableCueCount?: unknown;
  };
  if (typeof value.transcriptCaptureId !== 'string' || typeof value.youtubeVideoId !== 'string' ||
    typeof value.language !== 'string' || value.source !== 'tabAudioStt' || typeof value.version !== 'number' ||
    typeof value.availableCueCount !== 'number' || !['pending', 'available', 'insufficient'].includes(String(value.status))) return null;
  return {
    transcriptCaptureId: value.transcriptCaptureId,
    youtubeVideoId: value.youtubeVideoId,
    language: value.language,
    source: 'tabAudioStt' as const,
    status: value.status as 'pending' | 'available' | 'insufficient',
    version: value.version,
    availableCueCount: value.availableCueCount,
  };
}

function getVideoTitle(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'YouTube video';
  const title = (payload as { videoTitle?: unknown }).videoTitle;
  return typeof title === 'string' && title.trim() ? title : 'YouTube video';
}
