/**
 * StudyLens Background Service Worker
 * Manifest V3 background process entry point.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[StudyLens] Service Worker installed.');
});

type VideoContextMessage = {
  type: 'VIDEO_CONTEXT_CHANGED';
  contractVersion: '0.1.0';
  correlationId: string;
  tabId: number;
  youtubeVideoId: string;
  occurredAtUtc: string;
  payload: unknown;
};

type SidePanelManualToggleRequest = {
  type: 'STUDYLENS_MANUAL_TOGGLE';
  requestedState: 'on' | 'off';
};

type SidePanelContextRequest = { type: 'STUDYLENS_GET_ACTIVE_CONTEXT' };

const videoContexts = new Map<number, VideoContextMessage>();
const relayableContentMessageTypes = new Set([
  'VIDEO_CONTEXT_CHANGED',
  'PLAYER_PLAYING',
  'PLAYER_PAUSED',
  'PLAYER_BUFFERING',
  'PLAYER_SEEKED',
  'PLAYER_ENDED',
  'ACTIVATION_DECIDED',
  'ACTIVATION_STOPPED',
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'STUDYLENS_RESOLVE_TAB_ID') {
    sendResponse({ tabId: sender.tab?.id });
    return;
  }

  if (isSidePanelManualToggleRequest(message)) {
    void sendManualToggleToActiveYoutubeTab(message.requestedState).then(sendResponse);
    return true;
  }

  if (isSidePanelContextRequest(message)) {
    void getActiveYoutubeContext().then(sendResponse);
    return true;
  }

  if (!sender.tab?.id || !isRelayableContentMessage(message)) {
    return;
  }

  if (message.type === 'VIDEO_CONTEXT_CHANGED') {
    videoContexts.set(sender.tab.id, message);
  }

  void chrome.runtime.sendMessage(message).catch(() => {
    // A closed Side Panel is not an error and must not affect YouTube playback.
  });
});

async function sendManualToggleToActiveYoutubeTab(requestedState: 'on' | 'off') {
  const active = await getActiveYoutubeContext();
  if (!active.ok) return active;
  const { tabId, context } = active;

  const message = {
    type: 'MANUAL_ACTIVATION_REQUEST',
    contractVersion: '0.1.0' as const,
    correlationId: crypto.randomUUID(),
    tabId,
    youtubeVideoId: context.youtubeVideoId,
    occurredAtUtc: new Date().toISOString(),
    payload: { requestedState },
  };
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return { ok: true };
  } catch {
    return { ok: false, code: 'contentScriptUnavailable' };
  }
}

async function getActiveYoutubeContext(): Promise<
  | { ok: true; tabId: number; context: VideoContextMessage }
  | { ok: false; code: string }
> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return { ok: false, code: 'activeTabUnavailable' };

  const cached = videoContexts.get(tab.id);
  if (cached) return { ok: true, tabId: tab.id, context: cached };

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'STUDYLENS_GET_VIDEO_CONTEXT' });
    if (!isVideoContextMessage(response)) return { ok: false, code: 'youtubeContextUnavailable' };
    videoContexts.set(tab.id, response);
    return { ok: true, tabId: tab.id, context: response };
  } catch {
    return { ok: false, code: 'youtubeContextUnavailable' };
  }
}

function isSidePanelManualToggleRequest(value: unknown): value is SidePanelManualToggleRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SidePanelManualToggleRequest>;
  return candidate.type === 'STUDYLENS_MANUAL_TOGGLE' &&
    (candidate.requestedState === 'on' || candidate.requestedState === 'off');
}

function isSidePanelContextRequest(value: unknown): value is SidePanelContextRequest {
  return Boolean(value) && typeof value === 'object' &&
    (value as Partial<SidePanelContextRequest>).type === 'STUDYLENS_GET_ACTIVE_CONTEXT';
}

function isVideoContextMessage(value: unknown): value is VideoContextMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VideoContextMessage>;
  return candidate.type === 'VIDEO_CONTEXT_CHANGED' && candidate.contractVersion === '0.1.0' &&
    typeof candidate.tabId === 'number' && typeof candidate.youtubeVideoId === 'string';
}

function isRelayableContentMessage(value: unknown): value is VideoContextMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VideoContextMessage>;
  return typeof candidate.type === 'string' && relayableContentMessageTypes.has(candidate.type) &&
    candidate.contractVersion === '0.1.0' && typeof candidate.tabId === 'number' &&
    typeof candidate.youtubeVideoId === 'string';
}

// Configure side panel behavior if supported
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Ignore unsupported edge cases
  });
}
