import { initializeVideoActivationContentScript } from '../features/video-activation/content-script-entry';

interface TabContextResponse {
  tabId?: number;
}

async function startVideoActivation(): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'STUDYLENS_RESOLVE_TAB_ID',
    })) as TabContextResponse | undefined;

    if (!response || !Number.isInteger(response.tabId) || response.tabId! < 0) {
      return;
    }

    initializeVideoActivationContentScript({ tabId: response.tabId! });
  } catch {
    // Extension bootstrap failure must not affect the YouTube page.
  }
}

void startVideoActivation();
