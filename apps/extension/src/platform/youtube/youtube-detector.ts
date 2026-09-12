import {
  PlaybackState,
  VideoDetectionResult,
  YOUTUBE_VIDEO_ID_PATTERN,
  YoutubeEnvironment,
  YoutubeVideoContext,
  YoutubeVideoElementPort,
  secondsToMilliseconds,
} from './youtube-types';

export interface ParsedYoutubeWatchUrl {
  youtubeVideoId: string;
  canonicalUrl: string;
}

export type ParsedYoutubeUrlResult =
  | { status: 'supported'; value: ParsedYoutubeWatchUrl }
  | Extract<VideoDetectionResult, { status: 'unsupported' }>;

export function parseYoutubeWatchUrl(rawUrl: string): ParsedYoutubeUrlResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { status: 'unsupported', reason: 'notYoutube', url: rawUrl };
  }

  if (url.protocol !== 'https:' || url.hostname !== 'www.youtube.com') {
    return { status: 'unsupported', reason: 'notYoutube', url: rawUrl };
  }

  if (url.pathname !== '/watch') {
    return { status: 'unsupported', reason: 'notWatchPage', url: rawUrl };
  }

  const youtubeVideoId = url.searchParams.get('v');
  if (!youtubeVideoId) {
    return { status: 'unsupported', reason: 'missingVideoId', url: rawUrl };
  }

  if (!YOUTUBE_VIDEO_ID_PATTERN.test(youtubeVideoId)) {
    return { status: 'unsupported', reason: 'invalidVideoId', url: rawUrl };
  }

  return {
    status: 'supported',
    value: {
      youtubeVideoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
    },
  };
}

export function detectYoutubeVideo(environment: YoutubeEnvironment): VideoDetectionResult {
  const parsedUrl = parseYoutubeWatchUrl(environment.getUrl());
  if (parsedUrl.status === 'unsupported') {
    return parsedUrl;
  }

  const video = environment.getVideoElement();
  if (!video) {
    return {
      status: 'unavailable',
      reason: 'playerNotReady',
      ...parsedUrl.value,
    };
  }

  const title = normalizeYoutubeTitle(environment.getTitle());
  if (!title) {
    return {
      status: 'unavailable',
      reason: 'metadataMissing',
      ...parsedUrl.value,
    };
  }

  return {
    status: 'supported',
    context: buildContext(parsedUrl.value, title, video),
  };
}

export class YoutubeVideoDetector {
  private readonly environment: YoutubeEnvironment;
  private readonly onDetection: (result: VideoDetectionResult) => void;
  private cleanupNavigation: (() => void) | null = null;
  private cleanupDomChanges: (() => void) | null = null;
  private lastDetectionKey: string | null = null;
  private evaluationScheduled = false;
  private running = false;

  public constructor(
    environment: YoutubeEnvironment,
    onDetection: (result: VideoDetectionResult) => void,
  ) {
    this.environment = environment;
    this.onDetection = onDetection;
  }

  public start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.cleanupNavigation = this.environment.subscribeNavigation(() => {
      this.ensureDomWatch();
      this.scheduleEvaluation();
    });
    this.ensureDomWatch();
    this.evaluate();
  }

  public dispose(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.cleanupNavigation?.();
    this.cleanupNavigation = null;
    this.stopDomWatch();
    this.lastDetectionKey = null;
    this.evaluationScheduled = false;
  }

  private scheduleEvaluation(): void {
    if (!this.running || this.evaluationScheduled) {
      return;
    }

    this.evaluationScheduled = true;
    this.environment.schedule(() => {
      this.evaluationScheduled = false;
      if (this.running) {
        this.evaluate();
      }
    });
  }

  private evaluate(): void {
    const result = detectYoutubeVideo(this.environment);
    if (result.status === 'unavailable') {
      this.ensureDomWatch();
    } else {
      this.stopDomWatch();
    }

    const key = detectionKey(result);
    if (key === this.lastDetectionKey) {
      return;
    }

    this.lastDetectionKey = key;
    this.onDetection(result);
  }

  private ensureDomWatch(): void {
    if (!this.cleanupDomChanges) {
      this.cleanupDomChanges = this.environment.subscribeDomChanges(() => this.scheduleEvaluation());
    }
  }

  private stopDomWatch(): void {
    this.cleanupDomChanges?.();
    this.cleanupDomChanges = null;
  }
}

export function createBrowserYoutubeEnvironment(): YoutubeEnvironment {
  return {
    getUrl: () => window.location.href,
    getTitle: () => {
      const heading = document.querySelector<HTMLElement>(
        'ytd-watch-metadata h1 yt-formatted-string, h1.title yt-formatted-string',
      );
      return heading?.textContent ?? document.title;
    },
    getVideoElement: () =>
      document.querySelector<HTMLVideoElement>('video.html5-main-video') as YoutubeVideoElementPort | null,
    subscribeNavigation: (listener) => {
      document.addEventListener('yt-navigate-finish', listener);
      window.addEventListener('popstate', listener);
      return () => {
        document.removeEventListener('yt-navigate-finish', listener);
        window.removeEventListener('popstate', listener);
      };
    },
    subscribeDomChanges: (listener) => {
      const observer = new MutationObserver(listener);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
    schedule: (callback) => queueMicrotask(callback),
  };
}

function buildContext(
  parsedUrl: ParsedYoutubeWatchUrl,
  title: string,
  video: YoutubeVideoElementPort,
): YoutubeVideoContext {
  const currentTimeMs = secondsToMilliseconds(video.currentTime) ?? 0;
  const durationMs = secondsToMilliseconds(video.duration);
  const context: YoutubeVideoContext = {
    ...parsedUrl,
    title,
    currentTimeMs,
    playbackState: getPlaybackState(video),
  };

  if (durationMs !== null) {
    context.durationMs = durationMs;
  }

  return context;
}

function getPlaybackState(video: YoutubeVideoElementPort): PlaybackState {
  if (video.ended) {
    return 'ended';
  }
  return video.paused ? 'paused' : 'playing';
}

function normalizeYoutubeTitle(rawTitle: string): string {
  return rawTitle.replace(/\s+-\s+YouTube\s*$/i, '').replace(/\s+/g, ' ').trim();
}

function detectionKey(result: VideoDetectionResult): string {
  if (result.status === 'supported') {
    return `supported:${result.context.youtubeVideoId}`;
  }
  if (result.status === 'unavailable') {
    return `unavailable:${result.youtubeVideoId}:${result.reason}`;
  }
  return `unsupported:${result.reason}:${result.url}`;
}
