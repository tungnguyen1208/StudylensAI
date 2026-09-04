chrome.runtime.onInstalled.addListener(() => {
  console.info("StudyLens AI extension installed.");
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) {
    return;
  }

  await chrome.sidePanel.open({ tabId: tab.id });
});

