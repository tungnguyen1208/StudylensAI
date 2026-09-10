import {
  CreateTranscriptSnapshotRequest,
  TranscriptSnapshotRef,
} from '../models/video-activation.types';

export interface VideoActivationHttpClient {
  post<T>(path: string, body?: unknown): Promise<T>;
}

export class VideoActivationApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly retryable: boolean;

  public constructor(code: string, status: number, message: string, retryable: boolean) {
    super(message);
    this.name = 'VideoActivationApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
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
}

async function readError(response: Response): Promise<{
  code: string;
  message: string;
  retryable: boolean;
}> {
  try {
    const value = (await response.json()) as Record<string, unknown>;
    return {
      code: typeof value.code === 'string' ? value.code : 'httpError',
      message: typeof value.message === 'string' ? value.message : 'Transcript upload failed.',
      retryable: typeof value.retryable === 'boolean' ? value.retryable : response.status >= 500,
    };
  } catch {
    return {
      code: 'httpError',
      message: 'Transcript upload failed.',
      retryable: response.status >= 500,
    };
  }
}
