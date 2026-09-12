/**
 * StudyLens Background Service Worker
 * Manifest V3 background process entry point.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[StudyLens] Service Worker installed.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'STUDYLENS_RESOLVE_TAB_ID') {
    return;
  }

  sendResponse({ tabId: sender.tab?.id });
});

// Configure side panel behavior if supported
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Ignore unsupported edge cases
  });
}
