import { describe, expect, it } from 'vitest';
import type { LearningTargetCaptureResult } from '../../../platform/youtube/learning-target-capture';
import { YoutubeSpaTransitionObserver, type YoutubeSpaTransitionEnvironment } from '../services/youtube-spa-transition-observer';

const videoA = { youtubeVideoId: 'dQw4w9WgXcQ', canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Video A' };
const videoB = { youtubeVideoId: '9bZkp7q19f0', canonicalUrl: 'https://www.youtube.com/watch?v=9bZkp7q19f0', title: 'Video B' };

function createEnvironment(initial: LearningTargetCaptureResult) {
  let capture = initial;
  let scheduled: (() => void) | null = null;
  const listeners = new Map<string, () => void>();
  const environment: YoutubeSpaTransitionEnvironment = {
    capture: () => capture,
    addNavigationListener: (type, listener) => listeners.set(type, listener),
    removeNavigationListener: (type) => listeners.delete(type),
    schedule: (listener) => { scheduled = listener; return 1; },
    cancelSchedule: () => { scheduled = null; },
  };
  return {
    environment,
    setCapture: (value: LearningTargetCaptureResult) => { capture = value; },
    navigate: (type: 'yt-navigate-finish' | 'popstate') => listeners.get(type)?.(),
    flush: () => { const pending = scheduled; scheduled = null; pending?.(); },
  };
}

describe('YoutubeSpaTransitionObserver', () => {
  it('emits one debounced supported A-to-B transition', () => {
    const harness = createEnvironment({ status: 'supported', target: videoA });
    const transitions: Array<{ previous: string | null; next: string }> = [];
    const observer = new YoutubeSpaTransitionObserver(harness.environment, {
      onSupportedChange: (previous, next) => transitions.push({ previous: previous?.youtubeVideoId ?? null, next: next.youtubeVideoId }),
      onUnsupportedPage: () => undefined,
    });
    observer.start(videoA);

    harness.setCapture({ status: 'supported', target: videoB });
    harness.navigate('yt-navigate-finish');
    harness.navigate('popstate');
    harness.flush();
    harness.navigate('yt-navigate-finish');
    harness.flush();

    expect(transitions).toEqual([{ previous: videoA.youtubeVideoId, next: videoB.youtubeVideoId }]);
  });

  it('reports an unsupported route once and resumes when a supported page returns', () => {
    const harness = createEnvironment({ status: 'supported', target: videoA });
    const unsupported: string[] = [];
    const transitions: Array<{ previous: string | null; next: string }> = [];
    const observer = new YoutubeSpaTransitionObserver(harness.environment, {
      onSupportedChange: (previous, next) => transitions.push({ previous: previous?.youtubeVideoId ?? null, next: next.youtubeVideoId }),
      onUnsupportedPage: (previous) => unsupported.push(previous.youtubeVideoId),
    });
    observer.start(videoA);

    harness.setCapture({ status: 'unsupported', code: 'notYoutubeWatchPage' });
    harness.navigate('yt-navigate-finish');
    harness.flush();
    harness.navigate('popstate');
    harness.flush();
    harness.setCapture({ status: 'supported', target: videoB });
    harness.navigate('yt-navigate-finish');
    harness.flush();

    expect(unsupported).toEqual([videoA.youtubeVideoId]);
    expect(transitions).toEqual([{ previous: null, next: videoB.youtubeVideoId }]);
  });

  it('can wait on an unsupported page until a supported watch page appears', () => {
    const harness = createEnvironment({ status: 'unsupported', code: 'notYoutubeWatchPage' });
    const transitions: Array<{ previous: string | null; next: string }> = [];
    const observer = new YoutubeSpaTransitionObserver(harness.environment, {
      onSupportedChange: (previous, next) => transitions.push({ previous: previous?.youtubeVideoId ?? null, next: next.youtubeVideoId }),
      onUnsupportedPage: () => undefined,
    });
    observer.start(null);

    harness.setCapture({ status: 'supported', target: videoB });
    harness.navigate('yt-navigate-finish');
    harness.flush();

    expect(transitions).toEqual([{ previous: null, next: videoB.youtubeVideoId }]);
  });

  it('cancels a pending route change when the page flow is disposed', () => {
    const harness = createEnvironment({ status: 'supported', target: videoA });
    const unsupported: string[] = [];
    const transitions: string[] = [];
    const observer = new YoutubeSpaTransitionObserver(harness.environment, {
      onSupportedChange: (_previous, next) => transitions.push(next.youtubeVideoId),
      onUnsupportedPage: (previous) => unsupported.push(previous.youtubeVideoId),
    });
    observer.start(videoA);

    harness.setCapture({ status: 'unsupported', code: 'notYoutubeWatchPage' });
    harness.navigate('yt-navigate-finish');
    observer.dispose();
    harness.flush();

    expect(unsupported).toEqual([]);
    expect(transitions).toEqual([]);
  });
});
