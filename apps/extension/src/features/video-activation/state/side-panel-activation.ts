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
    // The persistent global gate remains ON while the replacement session is created.
    return activationReducer(next, { type: 'manualOn' });
  }
  if (message.type === 'VIDEO_CONTEXT_UNAVAILABLE') {
    // This is not a learner OFF. Keep the UI ON but explain that page flow waits.
    return { ...state, context: null, status: 'active', errorCode: 'unsupportedWatchPage' };
  }
  return state;
}

function getVideoTitle(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'YouTube video';
  const title = (payload as { videoTitle?: unknown }).videoTitle;
  return typeof title === 'string' && title.trim() ? title : 'YouTube video';
}
