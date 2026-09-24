import { VideoActivationApiError } from '../api/video-activation-api';
import type {
  CreateTranscriptCaptureRequest,
  TranscriptCaptureRef,
} from '../models/video-activation.types';

/**
 * Internal-only message. The content script can supply caption evidence but
 * cannot choose a Backend URL; the Service Worker owns the network request.
 */
export const TRANSCRIPT_CAPTURE_UPLOAD_MESSAGE = 'STUDYLENS_CREATE_TRANSCRIPT_CAPTURE';

export interface TranscriptCaptureBackendPort {
  createTranscriptCapture(request: CreateTranscriptCaptureRequest): Promise<TranscriptCaptureRef>;
}

export interface TabSenderContext {
  tab?: { id?: number; url?: string };
}

type WorkerUploadRequest = {
  type: typeof TRANSCRIPT_CAPTURE_UPLOAD_MESSAGE;
  request: CreateTranscriptCaptureRequest;
};

type WorkerUploadSuccess = { ok: true; capture: TranscriptCaptureRef };
type WorkerUploadFailure = {
  ok: false;
  code: string;
  status: number;
  message: string;
  retryable: boolean;
  traceId?: string;
};

export type WorkerUploadResponse = WorkerUploadSuccess | WorkerUploadFailure;
export type WorkerMessageSender = (message: WorkerUploadRequest) => Promise<unknown>;

/** Used by Content Script. This keeps the actual fetch in the extension origin. */
export async function uploadTranscriptCaptureThroughWorker(
  request: CreateTranscriptCaptureRequest,
  sendMessage: WorkerMessageSender = (message) => chrome.runtime.sendMessage(message),
): Promise<TranscriptCaptureRef> {
  const response = await sendMessage({ type: TRANSCRIPT_CAPTURE_UPLOAD_MESSAGE, request });
  if (isWorkerUploadSuccess(response)) return response.capture;
  if (isWorkerUploadFailure(response)) {
    throw new VideoActivationApiError(
      response.code,
      response.status,
      response.message,
      response.retryable,
      response.traceId,
    );
  }
  throw new VideoActivationApiError(
    'transcriptUploadUnavailable',
    0,
    'The Extension could not deliver the caption capture to the Backend.',
    true,
  );
}

/** Used by Service Worker. It rejects stale/mismatched content-script tabs. */
export async function handleTranscriptCaptureUpload(
  message: unknown,
  sender: TabSenderContext,
  backend: TranscriptCaptureBackendPort,
): Promise<WorkerUploadResponse | null> {
  if (!isWorkerUploadRequest(message)) return null;

  const request = message.request;
  if (!requestMatchesYoutubeTab(request, sender.tab)) {
    return failure('transcriptTargetChanged', 409, 'The YouTube video changed before its captions could be saved.', false);
  }

  try {
    const capture = await backend.createTranscriptCapture(request);
    if (capture.youtubeVideoId !== request.youtubeVideoId || capture.source !== 'youtubeCaption') {
      return failure('invalidTranscriptCaptureResponse', 502, 'The Backend returned an invalid caption capture.', true);
    }
    return { ok: true, capture };
  } catch (error: unknown) {
    if (error instanceof VideoActivationApiError) {
      return failure(error.code, error.status, error.message, error.retryable, error.traceId);
    }
    return failure('networkError', 0, 'The Backend could not be reached to save captions.', true);
  }
}

function requestMatchesYoutubeTab(request: CreateTranscriptCaptureRequest, tab: TabSenderContext['tab']): boolean {
  if (!tab || !Number.isInteger(tab.id) || !isValidCaptureRequest(request)) return false;
  try {
    const url = new URL(tab.url ?? '');
    return url.protocol === 'https:' && url.hostname === 'www.youtube.com' && url.pathname === '/watch' &&
      url.searchParams.get('v') === request.youtubeVideoId;
  } catch {
    return false;
  }
}

function isValidCaptureRequest(value: unknown): value is CreateTranscriptCaptureRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<CreateTranscriptCaptureRequest>;
  return typeof request.idempotencyKey === 'string' && request.idempotencyKey.length > 0 &&
    typeof request.youtubeVideoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(request.youtubeVideoId) &&
    typeof request.language === 'string' && request.source === 'youtubeCaption' &&
    (request.status === 'available' || request.status === 'unavailable' || request.status === 'insufficient') &&
    Array.isArray(request.cues);
}

function isWorkerUploadRequest(value: unknown): value is WorkerUploadRequest {
  return Boolean(value) && typeof value === 'object' &&
    (value as Partial<WorkerUploadRequest>).type === TRANSCRIPT_CAPTURE_UPLOAD_MESSAGE &&
    isValidCaptureRequest((value as Partial<WorkerUploadRequest>).request);
}

function isWorkerUploadSuccess(value: unknown): value is WorkerUploadSuccess {
  return Boolean(value) && typeof value === 'object' && (value as { ok?: unknown }).ok === true &&
    typeof (value as { capture?: { transcriptCaptureId?: unknown } }).capture?.transcriptCaptureId === 'string';
}

function isWorkerUploadFailure(value: unknown): value is WorkerUploadFailure {
  if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok !== false) return false;
  const response = value as Partial<WorkerUploadFailure>;
  return typeof response.code === 'string' && typeof response.status === 'number' &&
    typeof response.message === 'string' && typeof response.retryable === 'boolean';
}

function failure(code: string, status: number, message: string, retryable: boolean, traceId?: string): WorkerUploadFailure {
  return { ok: false, code, status, message, retryable, ...(traceId ? { traceId } : {}) };
}
