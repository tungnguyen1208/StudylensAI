import type { YouTubeCaptionTrack } from '../../../platform/youtube/transcript-reader';

/** Internal Content Script -> Service Worker request; never a public envelope. */
export const PAGE_CAPTION_TRACKS_MESSAGE = 'STUDYLENS_READ_PAGE_CAPTION_TRACKS';

/** Validates the small, cue-free projection returned from Chrome MAIN world. */
export function sanitizePageCaptionTracks(value: unknown, youtubeVideoId: string): YouTubeCaptionTrack[] {
  if (!Array.isArray(value)) return [];
  const tracks: YouTubeCaptionTrack[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.baseUrl !== 'string' || typeof candidate.languageCode !== 'string') continue;
    if (!belongsToVideo(candidate.baseUrl, youtubeVideoId)) continue;
    tracks.push({
      baseUrl: candidate.baseUrl,
      languageCode: candidate.languageCode,
      ...(typeof candidate.kind === 'string' ? { kind: candidate.kind } : {}),
      label: typeof candidate.label === 'string' ? candidate.label : candidate.languageCode,
    });
  }
  return tracks.filter((track, index) => tracks.findIndex((item) => item.baseUrl === track.baseUrl) === index);
}

function belongsToVideo(baseUrl: string, youtubeVideoId: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.hostname.endsWith('youtube.com') && url.searchParams.get('v') === youtubeVideoId;
  } catch {
    return false;
  }
}
