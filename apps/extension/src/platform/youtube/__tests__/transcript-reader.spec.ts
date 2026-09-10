import { describe, expect, it } from 'vitest';
import {
  RawTranscriptCue,
  TranscriptSourcePort,
  normalizeTranscriptCues,
  parseTimestampText,
  readTranscript,
} from '../transcript-reader';
import {
  createTranscriptSnapshotRequest,
  hashTranscript,
} from '../../../features/video-activation/services/transcript-service';

function source(cues: RawTranscriptCue[]): TranscriptSourcePort {
  return { getLanguage: () => 'vi', readRawCues: () => cues };
}

describe('transcript normalization', () => {
  it('parses YouTube timestamp text', () => {
    expect(parseTimestampText('01:30')).toBe(90000);
    expect(parseTimestampText('1:02:03')).toBe(3723000);
    expect(parseTimestampText('invalid')).toBeNull();
  });

  it('sorts, trims, infers end time, and removes invalid or duplicate cues', () => {
    expect(
      normalizeTranscriptCues([
        { startMs: 5000, text: '  second   cue  ' },
        { startMs: 1000, endMs: 4000, text: ' first cue ' },
        { startMs: 1000, endMs: 4000, text: ' first cue ' },
        { startMs: 9000, endMs: 8000, text: 'invalid range' },
        { startMs: 10000, text: '   ' },
      ]),
    ).toEqual([
      { startMs: 1000, endMs: 4000, text: 'first cue' },
      { startMs: 5000, endMs: 9000, text: 'second cue' },
    ]);
  });

  it('distinguishes unavailable, insufficient, and available transcripts', () => {
    expect(readTranscript(source([])).status).toBe('unavailable');
    expect(readTranscript(source([{ startMs: 0, endMs: 1000, text: 'Too short' }])).status).toBe(
      'insufficient',
    );

    const result = readTranscript(
      source([
        {
          startMs: 0,
          endMs: 5000,
          text: 'Hôm nay chúng ta tìm hiểu cách biểu diễn một hệ phương trình tuyến tính bằng ma trận.',
        },
        {
          startMs: 5000,
          endMs: 10000,
          text: 'Mỗi hàng biểu diễn một phương trình và mỗi cột biểu diễn một biến trong hệ phương trình.',
        },
      ]),
    );
    expect(result.status).toBe('available');
  });
});

describe('transcript request identity', () => {
  it('creates stable hashes and idempotency keys', async () => {
    const cues = [
      { startMs: 0, endMs: 5000, text: 'A normalized transcript cue with deterministic content.' },
    ];
    expect(await hashTranscript(cues)).toBe(await hashTranscript(cues));

    const transcript = { status: 'available' as const, language: 'en', cues };
    const first = await createTranscriptSnapshotRequest('dQw4w9WgXcQ', transcript);
    const replay = await createTranscriptSnapshotRequest('dQw4w9WgXcQ', transcript);
    expect(replay.contentHash).toBe(first.contentHash);
    expect(replay.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('never sends cues for non-available transcript states', async () => {
    const request = await createTranscriptSnapshotRequest('dQw4w9WgXcQ', {
      status: 'insufficient',
      language: 'vi',
      cues: [],
    });
    expect(request).toEqual({
      idempotencyKey: 'transcript:dQw4w9WgXcQ:insufficient:vi',
      youtubeVideoId: 'dQw4w9WgXcQ',
      language: 'vi',
      source: 'youtubeCaption',
      status: 'insufficient',
      cues: [],
    });
  });
});
