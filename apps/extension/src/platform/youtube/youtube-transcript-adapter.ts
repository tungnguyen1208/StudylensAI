import {
  createDomTranscriptSource,
  readTranscript,
  type TranscriptReadResult,
  type TranscriptSourcePort,
} from './transcript-reader';

export interface TranscriptAdapterEnvironment {
  createSource(): TranscriptSourcePort;
  subscribeDomChanges(listener: () => void): () => void;
  schedule(callback: () => void): void;
}

/**
 * Watches only YouTube's rendered transcript DOM. It never opens a panel,
 * calls a caption API, or controls playback.
 */
export class YoutubeTranscriptDomAdapter {
  private cleanup: (() => void) | null = null;
  private listener: ((result: TranscriptReadResult) => void) | null = null;
  private scheduled = false;
  private disposed = false;
  private lastFingerprint: string | null = null;

  public constructor(private readonly environment: TranscriptAdapterEnvironment) {}

  public start(listener: (result: TranscriptReadResult) => void): void {
    if (this.listener) return;
    this.listener = listener;
    this.cleanup = this.environment.subscribeDomChanges(() => this.scheduleRefresh());
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
      if (this.disposed || !this.listener) return;

      const result = readTranscript(this.environment.createSource());
      const fingerprint = transcriptFingerprint(result);
      if (fingerprint === this.lastFingerprint) return;

      this.lastFingerprint = fingerprint;
      this.listener(result);
    });
  }
}

export function createBrowserYoutubeTranscriptAdapter(
  root: ParentNode = document,
): YoutubeTranscriptDomAdapter {
  return new YoutubeTranscriptDomAdapter({
    createSource: () => createDomTranscriptSource(root),
    subscribeDomChanges: (listener) => {
      const observer = new MutationObserver(listener);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
    // Coalesces YouTube's bursty SPA DOM updates without polling.
    schedule: (callback) => window.setTimeout(callback, 200),
  });
}

function transcriptFingerprint(result: TranscriptReadResult): string {
  if (result.status !== 'available') return `${result.status}|${result.language}`;
  return `${result.status}|${result.language}|${result.cues
    .map((cue) => `${cue.startMs}|${cue.endMs}|${cue.text}`)
    .join('\n')}`;
}
