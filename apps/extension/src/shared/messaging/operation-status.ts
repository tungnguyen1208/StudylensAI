import type { ExtensionMessage } from './message-types';

export type StudyLensOperation =
  | 'audioTranscription'
  | 'transcriptUpload'
  | 'sessionStart'
  | 'segmentCreate'
  | 'quizGenerate'
  | 'answerSubmit'
  | 'historyLoad';

export type OperationState = 'pending' | 'succeeded' | 'failed';

export interface OperationStatusPayload {
  operation: StudyLensOperation;
  state: OperationState;
  code?: string;
  message: string;
  retryable: boolean;
  traceId?: string;
}

export function isOperationStatusMessage(message: ExtensionMessage): message is ExtensionMessage<OperationStatusPayload> {
  return message.type === 'OPERATION_STATUS_CHANGED' &&
    Boolean(message.payload) && typeof message.payload === 'object' &&
    typeof (message.payload as Partial<OperationStatusPayload>).operation === 'string' &&
    typeof (message.payload as Partial<OperationStatusPayload>).state === 'string';
}

export function operationFailure(error: unknown, fallbackCode: string, fallbackMessage: string): Pick<OperationStatusPayload, 'code' | 'message' | 'retryable' | 'traceId'> {
  if (error && typeof error === 'object') {
    const value = error as Partial<{ code: unknown; message: unknown; retryable: unknown; traceId: unknown }>;
    return {
      code: typeof value.code === 'string' ? value.code : fallbackCode,
      message: typeof value.message === 'string' && value.message.trim() ? value.message : fallbackMessage,
      retryable: value.retryable !== false,
      ...(typeof value.traceId === 'string' ? { traceId: value.traceId } : {}),
    };
  }
  return { code: fallbackCode, message: fallbackMessage, retryable: true };
}
