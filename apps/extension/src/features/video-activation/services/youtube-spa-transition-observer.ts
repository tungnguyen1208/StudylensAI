import {
  captureLearningTarget,
  type LearningTargetCapture,
  type LearningTargetCaptureResult,
} from '../../../platform/youtube/learning-target-capture';

type YoutubeNavigationEvent = 'yt-navigate-finish' | 'popstate';

export interface YoutubeSpaTransitionEnvironment {
  capture(): LearningTargetCaptureResult;
  addNavigationListener(type: YoutubeNavigationEvent, listener: () => void): void;
  removeNavigationListener(type: YoutubeNavigationEvent, listener: () => void): void;
  observeTitleChange?(listener: () => void): () => void;
  schedule(listener: () => void): number;
  cancelSchedule(handle: number): void;
}

export interface YoutubeSpaTransitionObserverOptions {
  onSupportedChange(previous: LearningTargetCapture | null, next: LearningTargetCapture): void;
  onUnsupportedPage(previous: LearningTargetCapture): void;
}

/** Observes only debounced YouTube SPA navigation while a learning flow is ON. */
export class YoutubeSpaTransitionObserver {
  private currentTarget: LearningTargetCapture | null = null;
  private scheduledHandle: number | null = null;
  private stopObservingTitle: (() => void) | null = null;
  private started = false;

  public constructor(
    private readonly environment: YoutubeSpaTransitionEnvironment,
    private readonly options: YoutubeSpaTransitionObserverOptions,
  ) {}

  public start(initialTarget: LearningTargetCapture | null): void {
    if (this.started) return;
    this.started = true;
    this.currentTarget = initialTarget;
    this.environment.addNavigationListener('yt-navigate-finish', this.onNavigation);
    this.environment.addNavigationListener('popstate', this.onNavigation);
    this.stopObservingTitle = this.environment.observeTitleChange?.(this.onNavigation) ?? null;
  }

  public dispose(): void {
    if (!this.started) return;
    this.started = false;
    this.environment.removeNavigationListener('yt-navigate-finish', this.onNavigation);
    this.environment.removeNavigationListener('popstate', this.onNavigation);
    this.stopObservingTitle?.();
    this.stopObservingTitle = null;
    if (this.scheduledHandle !== null) this.environment.cancelSchedule(this.scheduledHandle);
    this.scheduledHandle = null;
    this.currentTarget = null;
  }

  private readonly onNavigation = (): void => {
    if (!this.started || this.scheduledHandle !== null) return;
    this.scheduledHandle = this.environment.schedule(() => {
      this.scheduledHandle = null;
      this.refresh();
    });
  };

  private refresh(): void {
    if (!this.started) return;
    const capture = this.environment.capture();
    if (capture.status !== 'supported') {
      if (this.currentTarget) {
        const previous = this.currentTarget;
        this.currentTarget = null;
        this.options.onUnsupportedPage(previous);
      }
      return;
    }

    if (this.currentTarget?.youtubeVideoId === capture.target.youtubeVideoId) return;
    const previous = this.currentTarget;
    this.currentTarget = capture.target;
    this.options.onSupportedChange(previous, capture.target);
  }
}

export function createBrowserYoutubeSpaTransitionObserver(
  options: YoutubeSpaTransitionObserverOptions,
): YoutubeSpaTransitionObserver {
  return new YoutubeSpaTransitionObserver({
    capture: () => captureLearningTarget(window.location.href, document.title),
    // YouTube can dispatch SPA events on document rather than window.
    addNavigationListener: (type, listener) => {
      window.addEventListener(type, listener);
      document.addEventListener(type, listener);
    },
    removeNavigationListener: (type, listener) => {
      window.removeEventListener(type, listener);
      document.removeEventListener(type, listener);
    },
    observeTitleChange: (listener) => {
      const observer = new MutationObserver(() => listener());
      observer.observe(document.querySelector('title') ?? document.head, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      return () => observer.disconnect();
    },
    schedule: (listener) => window.setTimeout(listener, 200),
    cancelSchedule: (handle) => window.clearTimeout(handle),
  }, options);
}
