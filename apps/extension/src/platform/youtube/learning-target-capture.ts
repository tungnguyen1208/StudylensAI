const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export interface LearningTargetCapture {
  youtubeVideoId: string;
  canonicalUrl: string;
  title: string;
}

export type LearningTargetCaptureResult =
  | { status: 'supported'; target: LearningTargetCapture }
  | { status: 'unsupported'; code: 'notYoutubeWatchPage' | 'missingVideoId' | 'invalidVideoId' };

/** Captures the current page only when a learning flow starts. */
export function captureLearningTarget(rawUrl: string, rawTitle: string): LearningTargetCaptureResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { status: 'unsupported', code: 'notYoutubeWatchPage' };
  }

  if (url.protocol !== 'https:' || url.hostname !== 'www.youtube.com' || url.pathname !== '/watch') {
    return { status: 'unsupported', code: 'notYoutubeWatchPage' };
  }

  const youtubeVideoId = url.searchParams.get('v');
  if (!youtubeVideoId) return { status: 'unsupported', code: 'missingVideoId' };
  if (!YOUTUBE_VIDEO_ID.test(youtubeVideoId)) return { status: 'unsupported', code: 'invalidVideoId' };

  return {
    status: 'supported',
    target: {
      youtubeVideoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
      title: normalizeTitle(rawTitle) || 'YouTube video',
    },
  };
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+-\s+YouTube\s*$/i, '').replace(/\s+/g, ' ').trim();
}
