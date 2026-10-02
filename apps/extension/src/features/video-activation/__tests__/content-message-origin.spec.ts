import { describe, expect, it } from 'vitest';
import { matchesContentMessageOrigin } from '../services/content-message-origin';

const envelope = {
  type: 'ACTIVATION_ENABLED', tabId: 7, youtubeVideoId: 'dQw4w9WgXcQ', payload: {},
};

describe('content message origin binding', () => {
  it('accepts only the authenticated sender tab and current video URL', () => {
    expect(matchesContentMessageOrigin(envelope, {
      id: 7, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    })).toBe(true);
    expect(matchesContentMessageOrigin(envelope, {
      id: 8, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    })).toBe(false);
    expect(matchesContentMessageOrigin(envelope, {
      id: 7, url: 'https://www.youtube.com/watch?v=9bZkp7q19f0',
    })).toBe(false);
  });

  it('allows unavailable context only from the same YouTube tab after leaving watch', () => {
    const unavailable = {
      type: 'VIDEO_CONTEXT_UNAVAILABLE', tabId: 7, youtubeVideoId: 'dQw4w9WgXcQ',
      payload: { previousYoutubeVideoId: 'dQw4w9WgXcQ' },
    };
    expect(matchesContentMessageOrigin(unavailable, { id: 7, url: 'https://www.youtube.com/' })).toBe(true);
    expect(matchesContentMessageOrigin(unavailable, { id: 7, url: 'https://example.com/' })).toBe(false);
    expect(matchesContentMessageOrigin({
      ...unavailable,
      youtubeVideoId: 'invalid',
      payload: { previousYoutubeVideoId: 'invalid' },
    }, { id: 7, url: 'https://www.youtube.com/' })).toBe(false);
  });
});
