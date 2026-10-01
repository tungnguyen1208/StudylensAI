import { describe, expect, it } from 'vitest';
import {
  RawTranscriptCue,
  TranscriptSourcePort,
  normalizeTranscriptCues,
  parseJson3Transcript,
  parseXmlTranscript,
  parseTimestampText,
  readTranscript,
  selectBestCaptionTrack,
  extractCaptionTracksFromDom,
  fetchTimedtextCues,
  isDomTranscriptComplete,
} from '../transcript-reader';
import {
  createTranscriptRequest,
  hashTranscript,
} from '../../../features/video-activation/services/transcript-service';

function source(cues: RawTranscriptCue[]): TranscriptSourcePort {
  return { getLanguage: () => 'vi', readRawCues: () => cues };
}

describe('transcript normalization', () => {
  it('parses JSON3 and XML timedtext while decoding caption entities', () => {
    expect(parseJson3Transcript('{"events":[{"tStartMs":1000,"dDurationMs":500,"segs":[{"utf8":"A & B"}]}]}')).toEqual([{ startMs: 1000, endMs: 1500, text: 'A & B' }]);
    expect(parseXmlTranscript('<transcript><text start="2" dur="1.5">A &amp; B</text></transcript>')).toEqual([{ startMs: 2000, endMs: 3500, text: 'A & B' }]);
  });

  it('fetches the whole timedtext track without depending on playback position', async () => {
    const urls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Intro.' }] },
        { tStartMs: 600_000, dDurationMs: 1000, segs: [{ utf8: 'Ending.' }] },
      ] }), { status: 200 });
    };
    const cues = await fetchTimedtextCues('https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ', fetcher as typeof fetch);
    expect(cues.map((cue) => cue.startMs)).toEqual([0, 600_000]);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('fmt=json3');
  });

  it('tries XML when the JSON3 timedtext response is unavailable', async () => {
    const fetcher = async (input: RequestInfo | URL) => String(input).includes('fmt=json3')
      ? new Response('', { status: 503 })
      : new Response('<transcript><text start="2" dur="1">XML caption</text></transcript>', { status: 200 });
    expect(await fetchTimedtextCues('https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ', fetcher as typeof fetch))
      .toEqual([{ startMs: 2000, endMs: 3000, text: 'XML caption' }]);
  });

  it('prefers Vietnamese manual captions before ASR and other languages', () => {
    const track = selectBestCaptionTrack([
      { baseUrl: 'https://www.youtube.com/api/timedtext?x=1', languageCode: 'en', kind: 'asr', label: 'English' },
      { baseUrl: 'https://www.youtube.com/api/timedtext?x=2', languageCode: 'vi', kind: 'asr', label: 'Vietnamese auto' },
      { baseUrl: 'https://www.youtube.com/api/timedtext?x=3', languageCode: 'vi', label: 'Vietnamese' },
    ], 'en');
    expect(track?.baseUrl).toContain('x=3');
  });
  it('reads matching captionTracks from the page player response before script scanning', () => {
    const response = {
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [
        { baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en', languageCode: 'en', name: { simpleText: 'English' } },
      ] } },
    };
    const root = {
      defaultView: { ytInitialPlayerResponse: response },
      querySelectorAll: () => [],
    } as unknown as ParentNode;
    expect(extractCaptionTracksFromDom(root, 'dQw4w9WgXcQ')).toMatchObject([
      { languageCode: 'en', label: 'English' },
    ]);
    expect(extractCaptionTracksFromDom(root, 'abcdefghijk')).toEqual([]);
  });
  it('parses YouTube timestamp text', () => {
    expect(parseTimestampText('01:30')).toBe(90000);
    expect(parseTimestampText('1:02:03')).toBe(3723000);
    expect(parseTimestampText('30 giây')).toBe(30000);
    expect(parseTimestampText('1 phút, 9 giây')).toBe(69000);
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
    expect(readTranscript(source([{ startMs: 0, endMs: 1000, text: 'Too short' }]), 0).status).toBe(
      'available',
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

  it('does not treat a visible middle slice of the DOM transcript as full video', () => {
    const middleOnly = [{ startMs: 100_000, endMs: 110_000, text: 'A visible middle cue.' }];
    expect(isDomTranscriptComplete(middleOnly, 600_000)).toBe(false);
    expect(isDomTranscriptComplete(middleOnly, null)).toBe(false);
    expect(isDomTranscriptComplete([
      { startMs: 0, endMs: 10_000, text: 'First cue.' },
      { startMs: 10_000, endMs: 20_000, text: 'Second cue.' },
    ], 20_000)).toBe(true);
    expect(isDomTranscriptComplete([
      { startMs: 0, endMs: 10_000, text: 'First cue.' },
      { startMs: 150_001, endMs: 260_000, text: 'Last cue.' },
    ], 260_000)).toBe(false);
    expect(isDomTranscriptComplete([
      { startMs: 0, endMs: 300_000, text: 'One oversized row cannot prove coverage.' },
    ], 300_000)).toBe(false);
  });
});

describe('transcript request identity', () => {
  it('creates stable hashes and idempotency keys', async () => {
    const cues = [
      { startMs: 0, endMs: 5000, text: 'A normalized transcript cue with deterministic content.' },
    ];
    expect(await hashTranscript(cues)).toBe(await hashTranscript(cues));

    const transcript = { status: 'available' as const, language: 'en', cues };
    const first = await createTranscriptRequest('session-1', 'dQw4w9WgXcQ', transcript);
    const replay = await createTranscriptRequest('session-1', 'dQw4w9WgXcQ', transcript);
    expect(replay.contentHash).toBe(first.contentHash);
    expect(replay.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('never sends cues for non-available transcript states', async () => {
    const request = await createTranscriptRequest('session-1', 'dQw4w9WgXcQ', {
      status: 'insufficient',
      language: 'vi',
      cues: [],
    });
    expect(request).toEqual({
      contractVersion: '0.5.0',
      idempotencyKey: 'transcript:session-1:dQw4w9WgXcQ:insufficient',
      youtubeVideoId: 'dQw4w9WgXcQ',
      language: 'vi',
      source: 'youtubeCaption',
      status: 'insufficient',
      cues: [],
    });
  });
});
