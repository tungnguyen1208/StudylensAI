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
  language: string;
  source: 'youtubeCaption';
  status: TranscriptSnapshotStatus;
  contentHash?: string;
  cues: TranscriptCueDto[];
}

/** Side Panel read model: normalized YouTube caption cues only. */
export interface TranscriptCaptureDetails {
  capture: TranscriptCaptureRef;
  cues: TranscriptCueDto[];
}
