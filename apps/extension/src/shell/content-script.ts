import { initializeVideoActivationContentScript } from '../features/video-activation/content-script-entry';
import { SESSION_QUIZ_CONTRACT_VERSION, SessionQuizApi, registerSessionQuizRuntime } from '../features/session-quiz';
import { messageBus } from '../shared/messaging/message-bus';

interface TabContextResponse {
  tabId?: number;
}

async function startVideoActivation(): Promise<boolean> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'STUDYLENS_RESOLVE_TAB_ID',
    })) as TabContextResponse | undefined;

    if (!response || !Number.isInteger(response.tabId) || response.tabId! < 0) {
      return false;
    }

    const api = new SessionQuizApi();
    registerSessionQuizRuntime({
      api: {
        start: ({ youtubeVideoId, activation }) => api.startSession({
          contractVersion: SESSION_QUIZ_CONTRACT_VERSION,
          youtubeVideoId,
          activation,
        }),
        complete: (sessionId, request) => api.completeSession(sessionId, {
          contractVersion: SESSION_QUIZ_CONTRACT_VERSION,
          ...request,
        }),
        createSegment: (sessionId, request) => api.createSegment(sessionId, request),
        generateQuiz: (request) => api.generateQuiz(request),
      },
      bus: messageBus,
    });
    initializeVideoActivationContentScript({ tabId: response.tabId! });
    return true;
  } catch {
    // Extension bootstrap failure must not affect the YouTube page.
    return false;
  }
}

const bootstrap = startVideoActivation();

// Registered synchronously so the service worker can verify that an injected
// script has completed its asynchronous bootstrap before sending commands.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'STUDYLENS_CONTENT_SCRIPT_READY') return;
  void bootstrap.then((ok) => sendResponse({ ok }));
  return true;
});
