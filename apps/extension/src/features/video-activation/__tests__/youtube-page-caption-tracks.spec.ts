import { describe, expect, it } from 'vitest';
import { sanitizePageCaptionTracks } from '../services/youtube-page-caption-tracks';

describe('page caption metadata sanitizer', () => {
  it('keeps only caption tracks for the requested YouTube video', () => {
    const tracks = sanitizePageCaptionTracks([
      { baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en', languageCode: 'en', label: 'English' },
      { baseUrl: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=vi', languageCode: 'vi', label: 'Vietnamese' },
      { baseUrl: 'not-a-url', languageCode: 'en', label: 'Broken' },
    ], 'dQw4w9WgXcQ');
    expect(tracks).toEqual([
      { baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en', languageCode: 'en', label: 'English' },
    ]);
  });
});
