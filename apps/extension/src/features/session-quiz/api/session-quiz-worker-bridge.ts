import type {
  CompleteStudySessionRequest,
  LearningPackage,
  RetryProcessingRequest,
  SessionSnapshot,
  StartStudySessionRequest,
  SubmitFullTranscriptRequest,
} from '../models/session-quiz-contracts';

/** Internal message only: the worker owns Backend network access. */
export const SESSION_QUIZ_REQUEST_MESSAGE = 'STUDYLENS_SESSION_QUIZ_REQUEST';

export interface SessionQuizBackendPort {
  start(request: StartStudySessionRequest): Promise<SessionSnapshot>;
  complete(sessionId: string, request: CompleteStudySessionRequest): Promise<SessionSnapshot>;
  submitTranscript(sessionId: string, request: SubmitFullTranscriptRequest): Promise<LearningPackage>;
  getLearningPackage(sessionId: string): Promise<LearningPackage>;
  retry(sessionId: string, request: RetryProcessingRequest): Promise<LearningPackage>;
}

type SessionQuizOperation = 'start' | 'complete' | 'submitTranscript' | 'getLearningPackage' | 'retry';
type WorkerRequest = {
  type: typeof SESSION_QUIZ_REQUEST_MESSAGE;
  operation: SessionQuizOperation;
  sessionId?: string;
  request: unknown;
};
type WorkerSuccess = { ok: true; result: unknown };
type WorkerFailure = { ok: false; code: string; status: number; message: string; retryable: boolean; traceId?: string };
type WorkerResponse = WorkerSuccess | WorkerFailure;
type WorkerMessageSender = (message: WorkerRequest) => Promise<unknown>;

export class SessionQuizWorkerError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly retryable: boolean,
    public readonly traceId?: string,
  ) {
    super(message);
    this.name = 'SessionQuizWorkerError';
  }
}

export async function requestSessionQuizThroughWorker<T>(
  operation: SessionQuizOperation,
  request: unknown,
  sessionId?: string,
  sendMessage: WorkerMessageSender = (message) => chrome.runtime.sendMessage(message),
): Promise<T> {
  const response = await sendMessage({ type: SESSION_QUIZ_REQUEST_MESSAGE, operation, request, ...(sessionId ? { sessionId } : {}) });
  if (isSuccess(response)) return response.result as T;
  if (isFailure(response)) throw new SessionQuizWorkerError(
    response.code, response.status, response.message, response.retryable, response.traceId,
  );
  throw new SessionQuizWorkerError('sessionQuizRequestUnavailable', 0, 'The Extension could not deliver the session request.', true);
}

export async function handleSessionQuizRequest(
  message: unknown,
  sender: { tab?: { id?: number; url?: string } },
  backend: SessionQuizBackendPort,
): Promise<WorkerResponse | null> {
  if (!isWorkerRequest(message)) return null;
  if (!isYoutubeWatchSender(sender.tab)) {
    return failure('sessionTargetUnavailable', 409, 'The YouTube page is no longer available for this session request.', false);
  }

  try {
    switch (message.operation) {
      case 'start':
        return { ok: true, result: await backend.start(message.request as StartStudySessionRequest) };
      case 'complete':
        return { ok: true, result: await backend.complete(message.sessionId!, message.request as CompleteStudySessionRequest) };
      case 'submitTranscript':
        return { ok: true, result: await backend.submitTranscript(message.sessionId!, message.request as SubmitFullTranscriptRequest) };
      case 'getLearningPackage':
        return { ok: true, result: await backend.getLearningPackage(message.sessionId!) };
      case 'retry':
        return { ok: true, result: await backend.retry(message.sessionId!, message.request as RetryProcessingRequest) };
    }
  } catch (error: unknown) {
    return failureFrom(error);
  }
}

function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<WorkerRequest>;
  if (request.type !== SESSION_QUIZ_REQUEST_MESSAGE || !isOperation(request.operation) || !request.request || typeof request.request !== 'object') return false;
  return request.operation === 'start' ? true
    : (request.operation === 'complete' || request.operation === 'submitTranscript' || request.operation === 'getLearningPackage' || request.operation === 'retry')
    ? typeof request.sessionId === 'string' && request.sessionId.length > 0
    : false;
}

function isOperation(value: unknown): value is SessionQuizOperation {
  return value === 'start' || value === 'complete' || value === 'submitTranscript' || value === 'getLearningPackage' || value === 'retry';
}

function isYoutubeWatchSender(tab: { id?: number; url?: string } | undefined): boolean {
  if (!tab || !Number.isInteger(tab.id)) return false;
  try {
    const url = new URL(tab.url ?? '');
    return url.protocol === 'https:' && url.hostname === 'www.youtube.com' && url.pathname === '/watch';
  } catch {
    return false;
  }
}

function isSuccess(value: unknown): value is WorkerSuccess {
  if (!value || typeof value !== 'object') return false;
  return (value as { ok?: unknown }).ok === true && 'result' in value;
}

function isFailure(value: unknown): value is WorkerFailure {
  if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok !== false) return false;
  const error = value as Partial<WorkerFailure>;
  return typeof error.code === 'string' && typeof error.status === 'number' &&
    typeof error.message === 'string' && typeof error.retryable === 'boolean';
}

function failureFrom(error: unknown): WorkerFailure {
  const value = error as Partial<{ code: unknown; status: unknown; message: unknown; retryable: unknown; traceId: unknown }>;
  return failure(
    typeof value?.code === 'string' ? value.code : 'sessionQuizRequestFailed',
    typeof value?.status === 'number' ? value.status : 0,
    typeof value?.message === 'string' ? value.message : 'The Backend could not process the session request.',
    typeof value?.retryable === 'boolean' ? value.retryable : true,
    typeof value?.traceId === 'string' ? value.traceId : undefined,
  );
}

function failure(code: string, status: number, message: string, retryable: boolean, traceId?: string): WorkerFailure {
  return { ok: false, code, status, message, retryable, ...(traceId ? { traceId } : {}) };
}
