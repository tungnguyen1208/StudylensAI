import { initializeVideoActivationContentScript } from '../features/video-activation/content-script-entry';
import { SESSION_QUIZ_CONTRACT_VERSION, SessionQuizApi, registerSessionQuizRuntime } from '../features/session-quiz';
import { messageBus } from '../shared/messaging/message-bus';

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
  } catch {
    // Extension bootstrap failure must not affect the YouTube page.
  }
}

void startVideoActivation();
