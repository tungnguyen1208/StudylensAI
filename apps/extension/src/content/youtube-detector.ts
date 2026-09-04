export interface VideoMetadata {
  videoId: string | null;
  url: string;
  title: string;
  duration: number | null;
  currentTime: number | null;
  isPlaying: boolean;
}

export function isYouTubeWatchPage(locationLike: Pick<Location, "hostname" | "pathname"> = window.location): boolean {
  return locationLike.hostname === "www.youtube.com" && locationLike.pathname === "/watch";
}

export function getYouTubeVideoId(url = window.location.href): string | null {
  const parsedUrl = new URL(url);
  return parsedUrl.searchParams.get("v");
}

export function readVideoMetadata(): VideoMetadata {
  const video = document.querySelector("video");

  return {
    videoId: isYouTubeWatchPage() ? getYouTubeVideoId() : null,
    url: window.location.href,
    title: document.title.replace(/\s+-\s+YouTube$/, ""),
    duration: video?.duration && Number.isFinite(video.duration) ? video.duration : null,
    currentTime: video?.currentTime ?? null,
    isPlaying: video ? !video.paused : false
  };
}

if (isYouTubeWatchPage()) {
  console.info("StudyLens detected a YouTube watch page.", readVideoMetadata());
}

