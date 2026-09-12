import { extensionConfig } from '../config/extension-config';
import { HttpError } from './http-error';

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

export class HttpClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = extensionConfig.backendUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  public async post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  private async request<T>(path: string, options: RequestOptions): Promise<T> {
    const url = `${this.baseUrl}/${path.replace(/^\/+/, '')}`;
    const timeoutMs = options.timeoutMs ?? 10000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
      });

      if (!response.ok) {
        let errorData: unknown;
        try {
          errorData = await response.json();
        } catch {
          // Response was not JSON
        }

        const envelope = (errorData && typeof errorData === 'object' ? errorData : {}) as Record<string, unknown>;
        throw new HttpError({
          code: String(envelope.code || 'HTTP_ERROR'),
          status: response.status,
          message: String(envelope.message || response.statusText || 'Request failed'),
          traceId: envelope.traceId ? String(envelope.traceId) : undefined,
          retryable: response.status >= 500,
        });
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        throw err;
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new HttpError({
          code: 'REQUEST_TIMEOUT',
          status: 408,
          message: `Request timed out after ${timeoutMs}ms`,
          retryable: true,
        });
      }
      throw new HttpError({
        code: 'NETWORK_ERROR',
        status: 0,
        message: err instanceof Error ? err.message : 'Network request failed',
        retryable: true,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const httpClient = new HttpClient();
