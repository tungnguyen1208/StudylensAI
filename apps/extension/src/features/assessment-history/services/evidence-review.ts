const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Builds a safe public YouTube URL for reviewing persisted answer evidence. */
export function youtubeEvidenceUrl(youtubeVideoId: string, timestampMs: number): string | null {
  if (!YOUTUBE_VIDEO_ID.test(youtubeVideoId) || !Number.isFinite(timestampMs) || timestampMs < 0) return null;
  const seconds = Math.floor(timestampMs / 1000);
  return `https://www.youtube.com/watch?v=${youtubeVideoId}&t=${seconds}s`;
}
