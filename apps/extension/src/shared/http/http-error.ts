export interface ErrorEnvelope {
  code: string;
  status: number;
  message: string;
  traceId?: string;
  retryable: boolean;
}

export class HttpError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly traceId?: string;
  public readonly retryable: boolean;

  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = 'HttpError';
    this.code = envelope.code;
    this.status = envelope.status;
    this.traceId = envelope.traceId;
    this.retryable = envelope.retryable;
  }
}
