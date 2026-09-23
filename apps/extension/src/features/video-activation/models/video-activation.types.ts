import type { TranscriptSnapshotStatus, TranscriptCaptureRef } from '../../../shared/contracts/activation-handoff';

export type {
  AvailableTranscriptSnapshotRef,
  TranscriptCaptureRef,
  TranscriptSnapshotRef,
  TranscriptSnapshotStatus,
} from '../../../shared/contracts/activation-handoff';

export interface TranscriptCueDto {
  startMs: number;
  endMs: number;
  text: string;
}

export interface CreateTranscriptSnapshotRequest {
  idempotencyKey: string;
  youtubeVideoId: string;
  language: string;
  source: 'youtubeCaption';
  status: TranscriptSnapshotStatus;
  contentHash?: string;
  cues: TranscriptCueDto[];
}

export interface CreateTranscriptCaptureRequest {
  idempotencyKey: string;
  youtubeVideoId: string;
  languageHint?: string;
}

export interface UploadTranscriptAudioChunkRequest {
  captureId: string;
  idempotencyKey: string;
  chunkIndex: number;
  startMs: number;
  endMs: number;
  mimeType: string;
  audio: Blob;
}

export interface TranscriptCaptureProgress {
  capture: TranscriptCaptureRef;
  cueCount: number;
  acceptedChunkIndex: number;
}

/** Side Panel read model: normalized STT cues only, never raw tab audio. */
export interface TranscriptCaptureDetails {
  capture: TranscriptCaptureRef;
  cues: TranscriptCueDto[];
}
