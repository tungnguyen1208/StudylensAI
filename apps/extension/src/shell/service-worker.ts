/** StudyLens Manifest V3 service worker. */

const ACTIVATION_STORAGE_KEY = 'extensionEnabled';

type StoredActivationState = { enabled: boolean; persistedAtUtc: string };
type SidePanelToggleRequest = { type: 'STUDYLENS_MANUAL_TOGGLE'; requestedState: 'on' | 'off' };
type SidePanelStateRequest = { type: 'STUDYLENS_GET_ACTIVATION_STATE' };
type SidePanelRetryRequest = { type: 'STUDYLENS_RETRY_OPERATION'; operation: string };

const relayableContentMessageTypes = new Set([
  'PLAYER_PLAYING', 'PLAYER_PAUSED', 'PLAYER_BUFFERING', 'PLAYER_SEEKED', 'PLAYER_ENDED',
  'ACTIVATION_ENABLED', 'ACTIVATION_DISABLED', 'QUIZ_AVAILABLE', 'OPERATION_STATUS_CHANGED',
]);

chrome.runtime.onInstalled.addListener(() => {
  void ensureActivationDefault();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'STUDYLENS_RESOLVE_TAB_ID') {
    sendResponse({ tabId: sender.tab?.id });
    return;
  }
  if (isSidePanelStateRequest(message)) {
    void readActivationState().then((state) => sendResponse({ ...state, source: 'storageRestore', correlationId: crypto.randomUUID() }));
    return true;
  }
  if (isSidePanelToggleRequest(message)) {
    void toggleForActiveTab(message.requestedState).then(sendResponse);
    return true;
  }
  if (isSidePanelRetryRequest(message)) {
    void retryOperationForActiveTab(message.operation).then(sendResponse);
    return true;
  }
  if (!sender.tab?.id || !isRelayableContentMessage(message)) return;

  void chrome.runtime.sendMessage(message).catch(() => {
    // A closed Side Panel must never affect YouTube playback.
  });
});

async function ensureActivationDefault(): Promise<StoredActivationState> {
  const current = await chrome.storage.local.get(ACTIVATION_STORAGE_KEY) as Record<string, unknown>;
  const value = current[ACTIVATION_STORAGE_KEY];
  if (isStoredActivationState(value)) return value;
  const initial: StoredActivationState = { enabled: false, persistedAtUtc: new Date().toISOString() };
  await chrome.storage.local.set({ [ACTIVATION_STORAGE_KEY]: initial });
  return initial;
}

async function readActivationState(): Promise<StoredActivationState> {
  return ensureActivationDefault();
}

async function toggleForActiveTab(requestedState: 'on' | 'off') {
  const state: StoredActivationState = { enabled: requestedState === 'on', persistedAtUtc: new Date().toISOString() };
  await chrome.storage.local.set({ [ACTIVATION_STORAGE_KEY]: state });

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://www.youtube.com/')) {
    return { ok: true, pendingPageCapture: requestedState === 'on', state };
  }
  try {
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'ACTIVATION_TOGGLE_REQUEST',
      requestedState,
      source: 'user',
      correlationId: crypto.randomUUID(),
    }) as { ok?: boolean; code?: string } | undefined;
    return { ok: result?.ok !== false, code: result?.code, state };
  } catch {
    return { ok: true, pendingPageCapture: requestedState === 'on', state };
  }
}

async function retryOperationForActiveTab(operation: string) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://www.youtube.com/')) return { ok: false, code: 'youtubeTabUnavailable' };
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'OPERATION_RETRY_REQUEST',
      contractVersion: '0.2.0',
      correlationId: crypto.randomUUID(),
      tabId: tab.id,
      youtubeVideoId: '',
      occurredAtUtc: new Date().toISOString(),
      payload: { operation },
    });
    return { ok: true };
  } catch {
    return { ok: false, code: 'contentScriptUnavailable' };
  }
}

function isSidePanelToggleRequest(value: unknown): value is SidePanelToggleRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SidePanelToggleRequest>;
  return candidate.type === 'STUDYLENS_MANUAL_TOGGLE' &&
    (candidate.requestedState === 'on' || candidate.requestedState === 'off');
}

function isSidePanelStateRequest(value: unknown): value is SidePanelStateRequest {
  return Boolean(value) && typeof value === 'object' &&
    (value as Partial<SidePanelStateRequest>).type === 'STUDYLENS_GET_ACTIVATION_STATE';
}

function isSidePanelRetryRequest(value: unknown): value is SidePanelRetryRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SidePanelRetryRequest>;
  return candidate.type === 'STUDYLENS_RETRY_OPERATION' && typeof candidate.operation === 'string';
}

function isStoredActivationState(value: unknown): value is StoredActivationState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredActivationState>;
  return typeof candidate.enabled === 'boolean' && typeof candidate.persistedAtUtc === 'string';
}

function isRelayableContentMessage(value: unknown): value is { type: string; contractVersion: '0.2.0'; tabId: number; youtubeVideoId: string } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<{ type: string; contractVersion: string; tabId: number; youtubeVideoId: string }>;
  return typeof candidate.type === 'string' && relayableContentMessageTypes.has(candidate.type) &&
    candidate.contractVersion === '0.2.0' && typeof candidate.tabId === 'number' &&
    typeof candidate.youtubeVideoId === 'string';
}

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
}
