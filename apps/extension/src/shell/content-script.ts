import { initializeVideoActivationContentScript } from '../features/video-activation/content-script-entry';
import { SESSION_QUIZ_CONTRACT_VERSION, SessionQuizApi, registerSessionQuizRuntime, type SessionState } from '../features/session-quiz';
import { messageBus } from '../shared/messaging/message-bus';

interface TabContextResponse {
  tabId?: number;
}

type StudyLensRuntimeState = Pick<SessionState, 'status' | 'activeStudyMs' | 'segmentStatus' | 'segmentError'> & {
  sessionId?: string;
  youtubeVideoId?: string;
};

let getSessionRuntimeState: (() => StudyLensRuntimeState) | null = null;
let getActivePlayerPort: (() => ReturnType<ReturnType<typeof initializeVideoActivationContentScript>['getPlayerPort']>) | null = null;

async function startVideoActivation(): Promise<boolean> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'STUDYLENS_RESOLVE_TAB_ID',
    })) as TabContextResponse | undefined;

    if (!response || !Number.isInteger(response.tabId) || response.tabId! < 0) {
      return false;
    }

    const api = new SessionQuizApi();
    const sessionRuntime = registerSessionQuizRuntime({
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
    getSessionRuntimeState = () => {
      const state = sessionRuntime.store.getState();
      return {
        status: state.status,
        activeStudyMs: state.activeStudyMs,
        segmentStatus: state.segmentStatus,
        ...(state.segmentError ? { segmentError: state.segmentError } : {}),
        ...(state.session ? { sessionId: state.session.sessionId, youtubeVideoId: state.session.youtubeVideoId } : {}),
      };
    };
    const activationRuntime = initializeVideoActivationContentScript({ tabId: response.tabId! });
    getActivePlayerPort = () => activationRuntime.getPlayerPort();
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

// Internal Side Panel bridge. These messages are intentionally not public
// Extension envelopes and do not expose any Backend or AI-private data.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'STUDYLENS_GET_SESSION_PROGRESS') {
    void bootstrap.then((ok) => sendResponse(ok && getSessionRuntimeState
      ? { ok: true, state: getSessionRuntimeState() }
      : { ok: false, code: 'sessionRuntimeUnavailable' }));
    return true;
  }
  if (message?.type === 'STUDYLENS_SEEK_TO_TIMESTAMP') {
    const timestampMs = message.timestampMs;
    const youtubeVideoId = message.youtubeVideoId;
    void bootstrap.then(async (ok) => {
      const player = getActivePlayerPort?.();
      if (!ok || !player || typeof timestampMs !== 'number' || !Number.isInteger(timestampMs) || timestampMs < 0 ||
        typeof youtubeVideoId !== 'string') {
        sendResponse({ ok: false, code: 'seekUnavailable' });
        return;
      }
      try {
        await player.seek(timestampMs);
        sendResponse({ ok: true });
      } catch (error) {
        const code = error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : 'seekFailed';
        sendResponse({ ok: false, code });
      }
    });
    return true;
  }
});
