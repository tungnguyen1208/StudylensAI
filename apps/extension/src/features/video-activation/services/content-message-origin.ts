export interface ContentMessageSenderTab {
  id?: number;
  url?: string;
}

export interface RelayableActivationEnvelope {
  type: string;
  tabId: number;
  youtubeVideoId: string;
  payload: unknown;
}

/** Binds an untrusted envelope to the Chrome-authenticated sender tab. */
export function matchesContentMessageOrigin(
  message: RelayableActivationEnvelope,
  senderTab: ContentMessageSenderTab | undefined,
): boolean {
  if (!senderTab || senderTab.id !== message.tabId || !isYoutubeOrigin(senderTab.url) ||
    !/^[A-Za-z0-9_-]{11}$/.test(message.youtubeVideoId)) return false;
  if (message.type === 'VIDEO_CONTEXT_UNAVAILABLE') {
    const previous = (message.payload as { previousYoutubeVideoId?: unknown } | null)?.previousYoutubeVideoId;
    return typeof previous === 'string' && /^[A-Za-z0-9_-]{11}$/.test(previous) &&
      previous === message.youtubeVideoId && youtubeVideoIdFromUrl(senderTab.url) === null;
  }
  return youtubeVideoIdFromUrl(senderTab.url) === message.youtubeVideoId;
}

function isYoutubeOrigin(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && url.hostname === 'www.youtube.com';
  } catch {
    return false;
  }
}

function youtubeVideoIdFromUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    const videoId = url.pathname === '/watch' ? url.searchParams.get('v') : null;
    return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
}
