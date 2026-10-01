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
  schedule(callback: () => void, delayMs?: number): void;
  readDirectTranscript?(signal: AbortSignal): Promise<TranscriptReadResult | null>;
  triggerDomTranscriptExpansion?(): void;
  /**
   * A YouTube SPA transition can leave video A's transcript panel rendered
   * briefly while video B is loading. Do not trust that initial DOM snapshot
   * for a replacement flow; wait until the panel has produced new evidence.
   */
  ignoreInitialDomTranscript?: boolean;
}

export type TranscriptOrigin = 'timedtext' | 'dom';

const MAX_DIRECT_ATTEMPTS = 4;
const DIRECT_RETRY_DELAYS_MS = [300, 600, 1_200];

/**
 * First reads YouTube's caption track in the learner's browser context. Only
 * when that cannot yield an available transcript does it open the rendered
 * Transcript panel and observe its DOM.
 */
export class YoutubeTranscriptDomAdapter {
  private cleanup: (() => void) | null = null;
  private listener: ((result: TranscriptReadResult, origin: TranscriptOrigin) => void) | null = null;
  private scheduled = false;
  private refreshing = false;
  private directAttempts = 0;
  private directRetryPending = false;
  private directAvailable = false;
  private domFallbackRequested = false;
  private disposed = false;
  private lastFingerprint: string | null = null;
  private acquisitionVersion = 0;
  private directAbort = new AbortController();
  private readonly initialDomFingerprint: string | null;

  public constructor(private readonly environment: TranscriptAdapterEnvironment) {
    this.initialDomFingerprint = environment.ignoreInitialDomTranscript
      ? transcriptFingerprint(readTranscript(environment.createSource(), 0))
      : null;
  }

  public start(listener: (result: TranscriptReadResult, origin: TranscriptOrigin) => void): void {
    if (this.listener) return;
    this.listener = listener;
    this.cleanup = this.environment.subscribeDomChanges(() => this.scheduleRefresh());
    this.scheduleRefresh();
  }

  public retry(): void {
    if (this.disposed) return;
    this.acquisitionVersion += 1;
    this.directAbort.abort();
    this.directAbort = new AbortController();
    this.directAttempts = 0;
    this.directRetryPending = false;
    this.directAvailable = false;
    this.domFallbackRequested = false;
    this.lastFingerprint = null;
    this.scheduleRefresh();
  }

  public dispose(): void {
    this.disposed = true;
    this.acquisitionVersion += 1;
    this.directAbort.abort();
    this.cleanup?.();
    this.cleanup = null;
    this.listener = null;
    this.scheduled = false;
  }

  private scheduleRefresh(): void {
    if (this.disposed || this.scheduled || this.directRetryPending) return;
    this.scheduled = true;
    this.environment.schedule(() => {
      this.scheduled = false;
      void this.refresh();
    });
  }

  private async refresh(): Promise<void> {
    if (this.disposed || !this.listener || this.refreshing || this.directRetryPending) return;
    // Timedtext is definitive for this acquisition. MutationObserver events
    // from YouTube's virtualized transcript drawer must never submit a second
    // cue set after Backend has accepted the direct source.
    if (this.directAvailable) return;
    this.refreshing = true;
    const version = this.acquisitionVersion;
    try {
      if (this.directAttempts < MAX_DIRECT_ATTEMPTS && this.environment.readDirectTranscript) {
        this.directAttempts += 1;
        let direct: TranscriptReadResult | null = null;
        try {
          direct = await this.environment.readDirectTranscript(this.directAbort.signal);
        } catch {
          // Retry metadata or Timedtext once YouTube has finished loading.
        }
        if (this.disposed || !this.listener || version !== this.acquisitionVersion) return;
        if (direct?.status === 'available') {
          this.directAvailable = true;
          this.emit(direct, 'timedtext');
          return;
        }
        if (this.directAttempts < MAX_DIRECT_ATTEMPTS) {
          const delay = DIRECT_RETRY_DELAYS_MS[this.directAttempts - 1];
          this.directRetryPending = true;
          this.environment.schedule(() => {
            if (this.disposed || version !== this.acquisitionVersion) return;
            this.directRetryPending = false;
            this.scheduleRefresh();
          }, delay);
          return;
        }
      }
      if (!this.domFallbackRequested) {
        this.domFallbackRequested = true;
        this.environment.triggerDomTranscriptExpansion?.();
      }
      // Any non-empty DOM row is a preview. Completeness is determined later
      // from stable, full-duration coverage rather than character count.
      this.emitDomTranscript(readTranscript(this.environment.createSource(), 0));
    } finally {
      this.refreshing = false;
      if (!this.disposed && version !== this.acquisitionVersion) this.scheduleRefresh();
    }
  }

  private emit(result: TranscriptReadResult, origin: TranscriptOrigin): void {
    const fingerprint = `${origin}|${transcriptFingerprint(result)}`;
    if (fingerprint === this.lastFingerprint) return;
    this.lastFingerprint = fingerprint;
    this.listener?.(result, origin);
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
    this.emit(result, 'dom');
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
    readDirectTranscript: async (signal) => {
      const videoId = options.youtubeVideoId ?? new URL(window.location.href).searchParams.get('v') ?? undefined;
      const domTracks = extractCaptionTracksFromDom(root, videoId);
      const pageTracks = options.readPageCaptionTracks ? await options.readPageCaptionTracks() : [];
      if (signal.aborted) return null;
      const track = selectBestCaptionTrack([...domTracks, ...pageTracks]);
      if (!track) return null;
      const cues = await fetchTimedtextCues(track.baseUrl, fetch, signal);
      if (signal.aborted) return null;
      // A Timedtext response is the whole caption track, including videos
      // whose entire transcript is shorter than the DOM preview threshold.
      return readTranscript({ getLanguage: () => track.languageCode, readRawCues: () => cues }, 0);
    },
    triggerDomTranscriptExpansion: () => triggerDomTranscriptExpansion(root),
    ignoreInitialDomTranscript: options.ignoreInitialDomTranscript,
    subscribeDomChanges: (listener) => {
      const observer = new MutationObserver(listener);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
    schedule: (callback, delayMs = 200) => window.setTimeout(callback, delayMs),
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
