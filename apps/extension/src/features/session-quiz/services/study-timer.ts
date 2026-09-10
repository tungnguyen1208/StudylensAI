export interface Clock { nowMs(): number; }

export type PlayerLifecycleEvent =
  | 'PLAYER_PLAYING'
  | 'PLAYER_PAUSED'
  | 'PLAYER_BUFFERING'
  | 'PLAYER_SEEKED'
  | 'PLAYER_ENDED'
  | 'VIDEO_CONTEXT_CHANGED'
  | 'ACTIVATION_STOPPED';

export interface StudyTimerSnapshot {
  activeStudyMs: number;
  sessionActive: boolean;
}

export interface StudyTimerStateStore {
  save(snapshot: StudyTimerSnapshot): Promise<void>;
  load(): Promise<StudyTimerSnapshot | null>;
}

export class StudyTimer {
  private activeStudyMs = 0;
  private sessionActive = false;
  private playingSinceMs: number | null = null;

  public constructor(private readonly clock: Clock) {}

  public startSession(): void {
    this.sessionActive = true;
    this.playingSinceMs = null;
  }

  public stopSession(): number {
    this.flush();
    this.sessionActive = false;
    this.playingSinceMs = null;
    return this.activeStudyMs;
  }

  public handle(event: PlayerLifecycleEvent): number {
    this.flush();
    if (!this.sessionActive) return this.activeStudyMs;
    this.playingSinceMs = event === 'PLAYER_PLAYING' ? this.clock.nowMs() : null;
    if (event === 'VIDEO_CONTEXT_CHANGED' || event === 'ACTIVATION_STOPPED' || event === 'PLAYER_ENDED') {
      this.sessionActive = false;
    }
    return this.activeStudyMs;
  }

  public getActiveStudyMs(): number {
    this.flush();
    return this.activeStudyMs;
  }

  public snapshot(): StudyTimerSnapshot {
    this.flush();
    return { activeStudyMs: this.activeStudyMs, sessionActive: this.sessionActive };
  }

  public restore(snapshot: StudyTimerSnapshot): void {
    this.activeStudyMs = Math.max(0, Math.trunc(snapshot.activeStudyMs));
    this.sessionActive = snapshot.sessionActive;
    // The elapsed time while suspended is unknown and is deliberately not credited.
    this.playingSinceMs = null;
  }

  private flush(): void {
    if (this.playingSinceMs === null) return;
    const now = this.clock.nowMs();
    this.activeStudyMs += Math.max(0, now - this.playingSinceMs);
    this.playingSinceMs = now;
  }
}
