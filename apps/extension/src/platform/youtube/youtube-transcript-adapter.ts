import {
  createDomTranscriptSource,
  extractCaptionTracksFromDom,
  fetchTimedtextCues,
  readTranscript,
  selectBestCaptionTrack,
  type TranscriptReadResult,
  type TranscriptSourcePort,
  type YouTubeCaptionTrack,
} from './transcript-reader';

export interface TranscriptAdapterEnvironment {
  createSource(): TranscriptSourcePort;
  subscribeDomChanges(listener: () => void): () => void;
  schedule(callback: () => void): void;
  readDirectTranscript?(): Promise<TranscriptReadResult | null>;
  triggerDomTranscriptExpansion?(): void;
  /**
   * A YouTube SPA transition can leave video A's transcript panel rendered
   * briefly while video B is loading. Do not trust that initial DOM snapshot
   * for a replacement flow; wait until the panel has produced new evidence.
   */
  ignoreInitialDomTranscript?: boolean;
}

/**
 * First reads YouTube's caption track in the learner's browser context. Only
 * when that cannot yield an available transcript does it open the rendered
 * Transcript panel and observe its DOM.
 */
export class YoutubeTranscriptDomAdapter {
  private cleanup: (() => void) | null = null;
  private listener: ((result: TranscriptReadResult) => void) | null = null;
  private scheduled = false;
  private refreshing = false;
  private directAttempted = false;
  private domFallbackRequested = false;
  private disposed = false;
  private lastFingerprint: string | null = null;
  private readonly initialDomFingerprint: string | null;

  public constructor(private readonly environment: TranscriptAdapterEnvironment) {
    this.initialDomFingerprint = environment.ignoreInitialDomTranscript
      ? transcriptFingerprint(readTranscript(environment.createSource()))
      : null;
  }

  public start(listener: (result: TranscriptReadResult) => void): void {
    if (this.listener) return;
    this.listener = listener;
    this.cleanup = this.environment.subscribeDomChanges(() => this.scheduleRefresh());
    this.scheduleRefresh();
  }

  public retry(): void {
    if (this.disposed) return;
    this.directAttempted = false;
    this.domFallbackRequested = false;
    this.scheduleRefresh();
  }

  public dispose(): void {
    this.disposed = true;
    this.cleanup?.();
    this.cleanup = null;
    this.listener = null;
    this.scheduled = false;
  }

  private scheduleRefresh(): void {
    if (this.disposed || this.scheduled) return;
    this.scheduled = true;
    this.environment.schedule(() => {
      this.scheduled = false;
      void this.refresh();
    });
  }

  private async refresh(): Promise<void> {
    if (this.disposed || !this.listener || this.refreshing) return;
    this.refreshing = true;
    try {
      if (!this.directAttempted && this.environment.readDirectTranscript) {
        this.directAttempted = true;
        const direct = await this.environment.readDirectTranscript();
        if (this.disposed || !this.listener) return;
        if (direct?.status === 'available') {
          this.emit(direct);
          return;
        }
      }
      if (!this.domFallbackRequested) {
        this.domFallbackRequested = true;
        this.environment.triggerDomTranscriptExpansion?.();
      }
      this.emitDomTranscript(readTranscript(this.environment.createSource()));
    } finally {
      this.refreshing = false;
    }
  }

  private emit(result: TranscriptReadResult): void {
    const fingerprint = transcriptFingerprint(result);
    if (fingerprint === this.lastFingerprint) return;
    this.lastFingerprint = fingerprint;
    this.listener?.(result);
  }

  private emitDomTranscript(result: TranscriptReadResult): void {
    const fingerprint = transcriptFingerprint(result);
    // Only available cues are dangerous here: unavailable/insufficient state
    // is still useful feedback while YouTube loads the replacement panel.
    if (
      this.environment.ignoreInitialDomTranscript &&
      result.status === 'available' &&
      fingerprint === this.initialDomFingerprint
    ) {
      return;
    }
    this.emit(result);
  }
}

export interface BrowserYoutubeTranscriptAdapterOptions {
  youtubeVideoId?: string;
  readPageCaptionTracks?: () => Promise<readonly YouTubeCaptionTrack[]>;
  ignoreInitialDomTranscript?: boolean;
  resetDomTranscriptPanel?: boolean;
}

export function createBrowserYoutubeTranscriptAdapter(
  root: ParentNode = document,
  options: BrowserYoutubeTranscriptAdapterOptions = {},
): YoutubeTranscriptDomAdapter {
  if (options.resetDomTranscriptPanel) resetDomTranscriptPanel(root);
  return new YoutubeTranscriptDomAdapter({
    createSource: () => createDomTranscriptSource(root),
    readDirectTranscript: async () => {
      const videoId = options.youtubeVideoId ?? new URL(window.location.href).searchParams.get('v') ?? undefined;
      const domTracks = extractCaptionTracksFromDom(root, videoId);
      const pageTracks = options.readPageCaptionTracks ? await options.readPageCaptionTracks() : [];
      const track = selectBestCaptionTrack([...domTracks, ...pageTracks]);
      if (!track) return null;
      const cues = await fetchTimedtextCues(track.baseUrl);
      return readTranscript({ getLanguage: () => track.languageCode, readRawCues: () => cues });
    },
    triggerDomTranscriptExpansion: () => triggerDomTranscriptExpansion(root),
    ignoreInitialDomTranscript: options.ignoreInitialDomTranscript,
    subscribeDomChanges: (listener) => {
      const observer = new MutationObserver(listener);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
    schedule: (callback) => window.setTimeout(callback, 200),
  });
}

function triggerDomTranscriptExpansion(root: ParentNode): void {
  root.querySelector<HTMLElement>('#description-inline-expander #expand, #description button#expand, ytd-text-inline-expander #expand')?.click();
  const directTranscriptButton = root.querySelector<HTMLElement>(
    'button[aria-label*="Show transcript" i], button[aria-label*="Hiện bản ghi lời" i], ytd-video-description-transcript-section-renderer button',
  );
  const transcriptButton = directTranscriptButton ?? Array.from(root.querySelectorAll<HTMLElement>('button, tp-yt-paper-button'))
    .find((button) => /show transcript|show full transcript|hiện bản ghi lời|bản ghi lời/i.test(`${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`));
  transcriptButton?.click();
}

/**
 * YouTube keeps the transcript drawer mounted through some SPA transitions.
 * Closing that old drawer before opening B's transcript prevents stale rows
 * from being mistaken for B's evidence. This never touches video playback.
 */
function resetDomTranscriptPanel(root: ParentNode): void {
  root.querySelector<HTMLElement>([
    'ytd-transcript-search-panel-renderer #close-button button',
    'ytd-transcript-search-panel-renderer button[aria-label*="Close" i]',
    'ytd-transcript-search-panel-renderer button[aria-label*="Đóng" i]',
  ].join(','))?.click();
}

function transcriptFingerprint(result: TranscriptReadResult): string {
  if (result.status !== 'available') return `${result.status}|${result.language}`;
  return `${result.status}|${result.language}|${result.cues.map((cue) => `${cue.startMs}|${cue.endMs}|${cue.text}`).join('\n')}`;
}
