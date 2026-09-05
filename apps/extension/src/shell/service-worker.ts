/**
 * StudyLens Background Service Worker
 * Manifest V3 background process entry point.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[StudyLens] Service Worker installed.');
});

// Configure side panel behavior if supported
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Ignore unsupported edge cases
  });
}
