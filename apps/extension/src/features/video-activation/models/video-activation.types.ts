export type TranscriptSnapshotStatus = 'available' | 'unavailable' | 'insufficient';

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

export interface TranscriptSnapshotRef {
  transcriptSnapshotId: string;
  youtubeVideoId: string;
  language: string;
  status: TranscriptSnapshotStatus;
  contentHash?: string;
  version: string;
}

/** A session may begin only from uploaded, usable transcript evidence. */
export type AvailableTranscriptSnapshotRef = TranscriptSnapshotRef & {
  status: 'available';
  contentHash: string;
};
