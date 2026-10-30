import { initializeVideoActivationContentScript } from '../features/video-activation/content-script-entry';
import { SESSION_QUIZ_CONTRACT_VERSION, SessionQuizApi, registerSessionQuizRuntime, type SessionState } from '../features/session-quiz';
import { messageBus } from '../shared/messaging/message-bus';

interface TabContextResponse {
  tabId?: number;
}

type StudyLensRuntimeState = Pick<SessionState, 'status' | 'learningPackage' | 'error'> & {
  sessionId?: string;
  youtubeVideoId?: string;
};

interface ContentScriptRuntime {
  bootstrap: Promise<boolean>;
}

type ContentScriptGlobal = typeof globalThis & {
  __studyLensContentScriptRuntime?: ContentScriptRuntime;
};

const runtimeGlobal = globalThis as ContentScriptGlobal;

// A worker retry, Side Panel poll, and browser injection can overlap while a
// page is loading. Reusing this runtime prevents each injected copy from
// creating its own activation and Backend session.
runtimeGlobal.__studyLensContentScriptRuntime ??= initializeContentScriptRuntime();

function initializeContentScriptRuntime(): ContentScriptRuntime {
  let getSessionRuntimeState: (() => StudyLensRuntimeState) | null = null;
  let getActivePlayerPort: (() => ReturnType<ReturnType<typeof initializeVideoActivationContentScript>['getPlayerPort']>) | null = null;
  let retryActiveSessionStart: (() => Promise<boolean>) | null = null;

  async function startVideoActivation(): Promise<boolean> {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'STUDYLENS_RESOLVE_TAB_ID',
      })) as TabContextResponse | undefined;

      const tabId = response?.tabId;
      if (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId < 0) return false;

      const api = new SessionQuizApi();
      const sessionRuntime = registerSessionQuizRuntime({
        api: {
          start: ({ youtubeVideoId, activation }) => api.startSession({
            contractVersion: SESSION_QUIZ_CONTRACT_VERSION,
            activationId: activation.activationId,
            idempotencyKey: `session:${activation.activationId}:${youtubeVideoId}`,
            youtubeVideoId,
            videoTitle: activation.videoTitle,
            preferences: activation.preferences,
          }),
          complete: (sessionId, request) => api.completeSession(sessionId, {
            contractVersion: SESSION_QUIZ_CONTRACT_VERSION,
            ...request,
          }),
          getLearningPackage: (sessionId) => api.getLearningPackage(sessionId),
        },
        bus: messageBus,
      });
      getSessionRuntimeState = () => {
        const state = sessionRuntime.store.getState();
        return {
          status: state.status,
          ...(state.learningPackage ? { learningPackage: state.learningPackage } : {}),
          ...(state.error ? { error: state.error } : {}),
          ...(state.session ? { sessionId: state.session.sessionId, youtubeVideoId: state.session.youtubeVideoId } : {}),
        };
      };
      const activationRuntime = initializeVideoActivationContentScript({
        tabId,
        getActiveSessionId: (youtubeVideoId) => {
          const session = sessionRuntime.store.getState().session;
          return session?.youtubeVideoId === youtubeVideoId && session.status === 'active' ? session.sessionId : null;
        },
        retrySessionStart: () => sessionRuntime.retryStart(),
      });
      getActivePlayerPort = () => activationRuntime.getPlayerPort();
      retryActiveSessionStart = () => activationRuntime.retrySessionStart();
      return true;
    } catch {
      // Extension bootstrap failure must not affect the YouTube page.
      return false;
    }
  }

  const bootstrap = startVideoActivation();

  // Registered synchronously so the service worker can await the asynchronous
  // bootstrap before it relays a command to this page.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'STUDYLENS_CONTENT_SCRIPT_READY') return;
    void bootstrap.then((ok) => sendResponse({ ok }));
    return true;
  });

  // Internal Side Panel bridge. These messages are intentionally not public
  // Extension envelopes and do not expose Backend or AI-private data.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'STUDYLENS_GET_SESSION_PROGRESS') {
      void bootstrap.then((ok) => sendResponse(ok && getSessionRuntimeState
        ? { ok: true, state: getSessionRuntimeState() }
        : { ok: false, code: 'sessionRuntimeUnavailable' }));
      return true;
    }
    if (message?.type === 'STUDYLENS_RETRY_SESSION_START') {
      void bootstrap.then(async (ok) => {
        const retried = ok && retryActiveSessionStart ? await retryActiveSessionStart() : false;
        sendResponse(retried ? { ok: true } : { ok: false, code: 'sessionStartUnavailable' });
      });
      return true;
    }
    if (message?.type === 'STUDYLENS_SEEK_TO_TIMESTAMP') {
      const timestampMs = message.timestampMs;
      const youtubeVideoId = message.youtubeVideoId;
      void bootstrap.then(async (ok) => {
        const player = getActivePlayerPort?.();
        if (!ok || !player || typeof timestampMs !== 'number' || !Number.isSafeInteger(timestampMs) || timestampMs < 0 ||
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

  return { bootstrap };
}
