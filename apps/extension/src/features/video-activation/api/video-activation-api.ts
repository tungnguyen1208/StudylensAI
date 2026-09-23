import {
  CreateTranscriptCaptureRequest,
  CreateTranscriptSnapshotRequest,
  TranscriptCaptureDetails,
  TranscriptCaptureProgress,
  TranscriptCaptureRef,
  TranscriptSnapshotRef,
  UploadTranscriptAudioChunkRequest,
} from '../models/video-activation.types';

export interface VideoActivationHttpClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  postForm<T>(path: string, body: FormData): Promise<T>;
}

export class VideoActivationApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly retryable: boolean;
  public readonly traceId?: string;

  public constructor(code: string, status: number, message: string, retryable: boolean, traceId?: string) {
    super(message);
    this.name = 'VideoActivationApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.traceId = traceId;
  }
}

class FetchVideoActivationHttpClient implements VideoActivationHttpClient {
  private readonly baseUrl: string;

  public constructor(baseUrl = 'http://localhost:5000') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public async post<T>(path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${this.baseUrl}/${path.replace(/^\/+/, '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await readError(response);
        throw new VideoActivationApiError(
          error.code,
          response.status,
          error.message,
          error.retryable,
          error.traceId,
        );
      }

      return (await response.json()) as T;
    } catch (error: unknown) {
      if (error instanceof VideoActivationApiError) {
        throw error;
      }
      const timeout = error instanceof DOMException && error.name === 'AbortError';
      throw new VideoActivationApiError(
        timeout ? 'requestTimeout' : 'networkError',
        timeout ? 408 : 0,
        timeout ? 'Transcript upload timed out.' : 'Transcript upload failed.',
        true,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${this.baseUrl}/${path.replace(/^\/+/, '')}`, { signal: controller.signal });
      if (!response.ok) {
        const error = await readError(response);
        throw new VideoActivationApiError(error.code, response.status, error.message, error.retryable, error.traceId);
      }
      return (await response.json()) as T;
    } catch (error: unknown) {
      if (error instanceof VideoActivationApiError) throw error;
      const timeout = error instanceof DOMException && error.name === 'AbortError';
      throw new VideoActivationApiError(timeout ? 'requestTimeout' : 'networkError', timeout ? 408 : 0,
        timeout ? 'Transcript preview timed out.' : 'Transcript preview could not be loaded.', true);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public async postForm<T>(path: string, body: FormData): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(`${this.baseUrl}/${path.replace(/^\/+/, '')}`, {
        method: 'POST', body, signal: controller.signal,
      });
      if (!response.ok) {
        const error = await readError(response);
        throw new VideoActivationApiError(error.code, response.status, error.message, error.retryable, error.traceId);
      }
      return (await response.json()) as T;
    } catch (error: unknown) {
      if (error instanceof VideoActivationApiError) throw error;
      const timeout = error instanceof DOMException && error.name === 'AbortError';
      throw new VideoActivationApiError(timeout ? 'requestTimeout' : 'audioChunkUploadFailed', timeout ? 408 : 0,
        timeout ? 'Audio transcription timed out.' : 'Audio transcription upload failed.', true);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export class VideoActivationApi {
  private readonly client: VideoActivationHttpClient;

  public constructor(client: VideoActivationHttpClient = new FetchVideoActivationHttpClient()) {
    this.client = client;
  }

  public createTranscriptSnapshot(
    request: CreateTranscriptSnapshotRequest,
  ): Promise<TranscriptSnapshotRef> {
    return this.client.post<TranscriptSnapshotRef>(
      '/api/video-activation/transcript-snapshots',
      request,
    );
  }

  public createTranscriptCapture(request: CreateTranscriptCaptureRequest): Promise<TranscriptCaptureRef> {
    return this.client.post<TranscriptCaptureRef>('/api/video-activation/transcript-captures', request);
  }

  public getTranscriptCaptureDetails(captureId: string): Promise<TranscriptCaptureDetails> {
    return this.client.get<TranscriptCaptureDetails>(
      `/api/video-activation/transcript-captures/${encodeURIComponent(captureId)}`,
    );
  }

  public uploadAudioChunk(request: UploadTranscriptAudioChunkRequest): Promise<TranscriptCaptureProgress> {
    const body = new FormData();
    body.set('idempotencyKey', request.idempotencyKey);
    body.set('chunkIndex', String(request.chunkIndex));
    body.set('startMs', String(request.startMs));
    body.set('endMs', String(request.endMs));
    body.set('mimeType', request.mimeType);
    body.set('audio', request.audio, `chunk-${request.chunkIndex}.webm`);
    return this.client.postForm<TranscriptCaptureProgress>(
      `/api/video-activation/transcript-captures/${encodeURIComponent(request.captureId)}/audio-chunks`, body,
    );
  }
}

async function readError(response: Response): Promise<{
  code: string;
  message: string;
  retryable: boolean;
  traceId?: string;
}> {
  try {
    const value = (await response.json()) as Record<string, unknown>;
    return {
      code: typeof value.code === 'string' ? value.code : 'httpError',
      message: typeof value.message === 'string' ? value.message : 'Transcript upload failed.',
      retryable: typeof value.retryable === 'boolean' ? value.retryable : response.status >= 500,
      ...(typeof value.traceId === 'string' ? { traceId: value.traceId } : {}),
    };
  } catch {
    return {
      code: 'httpError',
      message: 'Transcript upload failed.',
      retryable: response.status >= 500,
    };
  }
}
