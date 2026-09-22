import type { TranscriptSnapshotStatus } from '../../../shared/contracts/activation-handoff';

export type {
  AvailableTranscriptSnapshotRef,
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
