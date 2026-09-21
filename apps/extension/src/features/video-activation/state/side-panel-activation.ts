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
    const transcriptSnapshot = getTranscriptSnapshot(message.payload);
    if (transcriptSnapshot) {
      next = activationReducer(next, { type: 'transcriptUpdated', transcriptSnapshot });
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
    return { ...state, context: null, transcriptSnapshot: null, status: 'active', errorCode: 'unsupportedWatchPage' };
  }
  return state;
}

function getTranscriptSnapshot(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const snapshot = (payload as { transcriptSnapshot?: unknown }).transcriptSnapshot;
  if (!snapshot || typeof snapshot !== 'object') return null;
  const value = snapshot as {
    transcriptSnapshotId?: unknown; youtubeVideoId?: unknown; language?: unknown;
    status?: unknown; version?: unknown; contentHash?: unknown;
  };
  if (typeof value.transcriptSnapshotId !== 'string' || typeof value.youtubeVideoId !== 'string' ||
    typeof value.language !== 'string' || typeof value.version !== 'string' ||
    !['available', 'unavailable', 'insufficient'].includes(String(value.status))) return null;
  return {
    transcriptSnapshotId: value.transcriptSnapshotId,
    youtubeVideoId: value.youtubeVideoId,
    language: value.language,
    status: value.status as 'available' | 'unavailable' | 'insufficient',
    version: value.version,
    ...(typeof value.contentHash === 'string' ? { contentHash: value.contentHash } : {}),
  };
}

function getVideoTitle(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'YouTube video';
  const title = (payload as { videoTitle?: unknown }).videoTitle;
  return typeof title === 'string' && title.trim() ? title : 'YouTube video';
}
