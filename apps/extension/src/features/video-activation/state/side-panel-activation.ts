import type { ExtensionMessage } from '../../../shared/messaging/message-types';
import type { ActivationState } from '../models/activation.types';
import { activationReducer } from './activation-reducer';

/** Maps only public VideoActivation event envelopes into Side Panel display state. */
export function applyVideoActivationMessage(
  state: ActivationState,
  message: ExtensionMessage,
): ActivationState {
  if (message.type === 'VIDEO_CONTEXT_CHANGED' && isContextPayload(message.payload)) {
    return activationReducer(state, {
      type: 'contextChanged',
      context: { tabId: message.tabId, youtubeVideoId: message.youtubeVideoId, title: message.payload.title },
    });
  }
  if (message.type === 'ACTIVATION_DECIDED') {
    let next = activationReducer(state, { type: 'manualOn' });
    const transcriptSnapshot = getTranscriptSnapshot(message.payload);
    if (transcriptSnapshot) {
      next = activationReducer(next, { type: 'transcriptUpdated', transcriptSnapshot });
    }
    return next;
  }
  if (message.type === 'ACTIVATION_STOPPED') {
    return activationReducer(state, { type: 'manualOff' });
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

function isContextPayload(payload: unknown): payload is { title: string } {
  return Boolean(payload) && typeof payload === 'object' &&
    typeof (payload as { title?: unknown }).title === 'string';
}
