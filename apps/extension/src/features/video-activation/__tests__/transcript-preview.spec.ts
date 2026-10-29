import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TranscriptPreview } from '../components/TranscriptPreview';

describe('TranscriptPreview', () => {
  it('keeps the Transcript card visible before cues arrive without demo instructions', () => {
    const markup = renderToStaticMarkup(createElement(TranscriptPreview, {
      details: null,
      currentTimeMs: null,
      statusText: 'Đang lấy transcript…',
      onSeek: () => undefined,
    }));

    expect(markup).toContain('Transcript');
    expect(markup).toContain('Đang lấy transcript');
    expect(markup).not.toContain('Subtitles có timestamp');
    expect(markup).not.toContain('Transcript sẽ xuất hiện');
  });

  it('shows timestamped cues and the source saved by Backend', () => {
    const markup = renderToStaticMarkup(createElement(TranscriptPreview, {
      details: { cues: [{ startMs: 12_000, endMs: 15_000, text: 'Nội dung video đã nhận' }] },
      currentTimeMs: 13_000,
      statusText: 'Đã lưu từ phụ đề YouTube.',
      onSeek: () => undefined,
    }));

    expect(markup).toContain('Đã lưu từ phụ đề YouTube');
    expect(markup).toContain('0:12');
    expect(markup).toContain('Nội dung video đã nhận');
    expect(markup).toContain('aria-current="true"');
  });
});
