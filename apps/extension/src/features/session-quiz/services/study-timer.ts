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
  sessionId?: string;
}

export interface StudyTimerStateStore {
  save(snapshot: StudyTimerSnapshot): Promise<void>;
  load(): Promise<StudyTimerSnapshot | null>;
}

// ============================================================
// timer
// ============================================================

export class StudyTimer {
  private activeStudyMs = 0;
  private sessionActive = false;
  private playingSinceMs: number | null = null;
  private sessionId: string | undefined;

  public constructor(private readonly clock: Clock, private readonly store?: StudyTimerStateStore) {}

  public async hydrate(sessionId?: string): Promise<StudyTimerSnapshot | null> {
    if (!this.store) return null;
    const stored = await this.store.load();
    if (!stored) return null;
    if (sessionId !== undefined && stored.sessionId !== sessionId) return null;
    this.restore(stored);
    return stored;
  }

  public startSession(sessionId?: string): void {
    this.activeStudyMs = 0;
    this.sessionActive = true;
    this.playingSinceMs = null;
    this.sessionId = sessionId;
    this.persist();
  }

  public stopSession(): number {
    this.flush();
    this.sessionActive = false;
    this.playingSinceMs = null;
    this.persist();
    return this.activeStudyMs;
  }

  public handle(event: PlayerLifecycleEvent): number {
    this.flush();
    if (!this.sessionActive) return this.activeStudyMs;
    this.playingSinceMs = event === 'PLAYER_PLAYING' ? this.clock.nowMs() : null;
    if (event === 'VIDEO_CONTEXT_CHANGED' || event === 'ACTIVATION_STOPPED' || event === 'PLAYER_ENDED') {
      this.sessionActive = false;
    }
    this.persist();
    return this.activeStudyMs;
  }

  public getActiveStudyMs(): number {
    this.flush();
    return this.activeStudyMs;
  }

  public snapshot(): StudyTimerSnapshot {
    this.flush();
    return { activeStudyMs: this.activeStudyMs, sessionActive: this.sessionActive, sessionId: this.sessionId };
  }

  public restore(snapshot: StudyTimerSnapshot): void {
    this.activeStudyMs = Math.max(0, Math.trunc(snapshot.activeStudyMs));
    this.sessionActive = snapshot.sessionActive;
    this.sessionId = snapshot.sessionId;
    this.playingSinceMs = null;
  }

  private flush(): void {
    if (this.playingSinceMs === null) return;
    const now = this.clock.nowMs();
    this.activeStudyMs += Math.max(0, now - this.playingSinceMs);
    this.playingSinceMs = now;
  }

  private persist(): void {
    if (!this.store) return;
    void this.store.save(this.snapshot()).catch(() => undefined);
  }
}

// ============================================================
// chrome session storage store
// ============================================================

interface SessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export class ChromeStudyTimerStateStore implements StudyTimerStateStore {
  public constructor(private readonly key: string, private readonly area: SessionStorageArea | null = resolveSessionArea()) {}

  public async save(snapshot: StudyTimerSnapshot): Promise<void> {
    if (!this.area) return;
    await this.area.set({ [this.key]: snapshot });
  }

  public async load(): Promise<StudyTimerSnapshot | null> {
    if (!this.area) return null;
    const stored = await this.area.get(this.key);
    const value = stored?.[this.key] as Partial<StudyTimerSnapshot> | undefined;
    if (!value || typeof value.activeStudyMs !== 'number') return null;
    return {
      activeStudyMs: Math.max(0, Math.trunc(value.activeStudyMs)),
      sessionActive: value.sessionActive === true,
      sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined,
    };
  }
}

function resolveSessionArea(): SessionStorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return null;
  return chrome.storage.session as unknown as SessionStorageArea;
}

