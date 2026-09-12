import { describe, expect, it } from 'vitest';
import {
  YoutubeVideoDetector,
  detectYoutubeVideo,
  parseYoutubeWatchUrl,
} from '../youtube-detector';
import { VideoDetectionResult, YoutubeEnvironment, YoutubeVideoElementPort } from '../youtube-types';

function createVideo(overrides: Partial<YoutubeVideoElementPort> = {}): YoutubeVideoElementPort {
  return {
    currentTime: 2.5,
    duration: 120,
    paused: true,
    ended: false,
    buffered: { length: 0, end: () => 0 },
    play: async () => undefined,
    pause: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    ...overrides,
  };
}

function createEnvironment(): YoutubeEnvironment & {
  url: string;
  title: string;
  video: YoutubeVideoElementPort | null;
  triggerNavigation(): void;
  triggerDomChange(): void;
} {
  let navigationListener: (() => void) | undefined;
  let domListener: (() => void) | undefined;
  return {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Linear Algebra - YouTube',
    video: createVideo(),
    getUrl() {
      return this.url;
    },
    getTitle() {
      return this.title;
    },
    getVideoElement() {
      return this.video;
    },
    subscribeNavigation(listener) {
      navigationListener = listener;
      return () => {
        navigationListener = undefined;
      };
    },
    subscribeDomChanges(listener) {
      domListener = listener;
      return () => {
        domListener = undefined;
      };
    },
    schedule(callback) {
      callback();
    },
    triggerNavigation() {
      navigationListener?.();
    },
    triggerDomChange() {
      domListener?.();
    },
  };
}

describe('parseYoutubeWatchUrl', () => {
  it.each([
    ['https://www.youtube.com/', 'notWatchPage'],
    ['https://www.youtube.com/results?search_query=math', 'notWatchPage'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'notWatchPage'],
    ['https://www.youtube.com/watch', 'missingVideoId'],
    ['https://www.youtube.com/watch?v=short', 'invalidVideoId'],
    ['http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'notYoutube'],
  ])('rejects unsupported URL %s', (url, reason) => {
    expect(parseYoutubeWatchUrl(url)).toMatchObject({ status: 'unsupported', reason });
  });

  it('returns a canonical watch URL', () => {
    expect(
      parseYoutubeWatchUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=20s'),
    ).toEqual({
      status: 'supported',
      value: {
        youtubeVideoId: 'dQw4w9WgXcQ',
        canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });
  });
});

describe('detectYoutubeVideo', () => {
  it('returns typed unavailable states instead of throwing', () => {
    const environment = createEnvironment();
    environment.video = null;
    expect(detectYoutubeVideo(environment)).toMatchObject({
      status: 'unavailable',
      reason: 'playerNotReady',
    });

    environment.video = createVideo();
    environment.title = '   ';
    expect(detectYoutubeVideo(environment)).toMatchObject({
      status: 'unavailable',
      reason: 'metadataMissing',
    });
  });

  it('normalizes metadata and video time', () => {
    const result = detectYoutubeVideo(createEnvironment());
    expect(result).toEqual({
      status: 'supported',
      context: {
        youtubeVideoId: 'dQw4w9WgXcQ',
        canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Linear Algebra',
        durationMs: 120000,
        currentTimeMs: 2500,
        playbackState: 'paused',
      },
    });
  });
});

describe('YoutubeVideoDetector', () => {
  it('emits metadata readiness and SPA video changes without duplicates', () => {
    const environment = createEnvironment();
    const results: VideoDetectionResult[] = [];
    environment.video = null;
    const detector = new YoutubeVideoDetector(environment, (result) => results.push(result));

    detector.start();
    environment.video = createVideo();
    environment.triggerDomChange();
    environment.title = 'Updated title';
    environment.triggerDomChange();
    environment.url = 'https://www.youtube.com/watch?v=abcdefghijk';
    environment.triggerNavigation();

    expect(results.map((result) => result.status)).toEqual([
      'unavailable',
      'supported',
      'supported',
    ]);
    expect(results.at(-1)).toMatchObject({
      status: 'supported',
      context: { youtubeVideoId: 'abcdefghijk' },
    });

    detector.dispose();
    environment.url = 'https://www.youtube.com/watch?v=ABCDEFGHIJK';
    environment.triggerNavigation();
    expect(results).toHaveLength(3);
  });
});
