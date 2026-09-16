import { describe, expect, it } from 'vitest';
import { StudyTimer, type Clock, type StudyTimerSnapshot, type StudyTimerStateStore } from '../services/study-timer';

class FakeClock implements Clock {
  public constructor(private value = 0) {}
  public nowMs(): number { return this.value; }
  public advance(ms: number): void { this.value += ms; }
  public set(ms: number): void { this.value = ms; }
}

describe('StudyTimer', () => {
  it('counts only active playing time', () => {
    const clock = new FakeClock(); const timer = new StudyTimer(clock);
    timer.startSession(); timer.handle('PLAYER_PLAYING'); clock.advance(3000); timer.handle('PLAYER_PAUSED'); clock.advance(5000); timer.handle('PLAYER_PLAYING'); clock.advance(7000);
    expect(timer.stopSession()).toBe(10000);
  });

  it('does not count buffering, seek, or events after the session ends', () => {
    const clock = new FakeClock(); const timer = new StudyTimer(clock);
    timer.startSession(); timer.handle('PLAYER_PLAYING'); clock.advance(1000); timer.handle('PLAYER_BUFFERING'); clock.advance(5000); timer.handle('PLAYER_SEEKED'); clock.advance(5000); timer.handle('PLAYER_ENDED'); clock.advance(5000);
    expect(timer.getActiveStudyMs()).toBe(1000);
  });

  it('never subtracts time when the clock moves backwards or events repeat', () => {
    const clock = new FakeClock(100); const timer = new StudyTimer(clock);
    timer.startSession(); timer.handle('PLAYER_PLAYING'); clock.set(50); timer.handle('PLAYER_PLAYING'); clock.advance(20); timer.handle('PLAYER_PLAYING');
    expect(timer.stopSession()).toBe(20);
  });

  it('restores confirmed time but does not credit the suspended gap', () => {
    const clock = new FakeClock(); const original = new StudyTimer(clock);
    original.startSession(); original.handle('PLAYER_PLAYING'); clock.advance(5000);
    const restored = new StudyTimer(clock); restored.restore(original.snapshot()); clock.advance(60000);
    expect(restored.getActiveStudyMs()).toBe(5000);
    restored.handle('PLAYER_PLAYING'); clock.advance(2000);
    expect(restored.stopSession()).toBe(7000);
  });
});

// ============================================================
// suspend/resume through a state store
// ============================================================

class MemoryStore implements StudyTimerStateStore {
  public saves = 0;
  private snapshot: StudyTimerSnapshot | null = null;
  public async save(snapshot: StudyTimerSnapshot): Promise<void> { this.saves += 1; this.snapshot = { ...snapshot }; }
  public async load(): Promise<StudyTimerSnapshot | null> { return this.snapshot; }
}

describe('StudyTimer state store', () => {
  it('persists progress on every lifecycle event', async () => {
    const clock = new FakeClock(); const store = new MemoryStore();
    const timer = new StudyTimer(clock, store);
    timer.startSession(); timer.handle('PLAYER_PLAYING'); clock.advance(4000); timer.handle('PLAYER_PAUSED');
    await Promise.resolve();
    expect(store.saves).toBeGreaterThan(0);
    expect(await store.load()).toEqual({ activeStudyMs: 4000, sessionActive: true });
  });

  it('hydrates a new timer after the service worker is suspended', async () => {
    const clock = new FakeClock(); const store = new MemoryStore();
    const before = new StudyTimer(clock, store);
    before.startSession(); before.handle('PLAYER_PLAYING'); clock.advance(9000); before.handle('PLAYER_PAUSED');
    await Promise.resolve();

    clock.advance(120000);
    const after = new StudyTimer(clock, store);
    expect(await after.hydrate()).toEqual({ activeStudyMs: 9000, sessionActive: true });
    expect(after.getActiveStudyMs()).toBe(9000);
    after.handle('PLAYER_PLAYING'); clock.advance(1000);
    expect(after.stopSession()).toBe(10000);
  });

  it('returns null when no timer state was stored yet', async () => {
    expect(await new StudyTimer(new FakeClock(), new MemoryStore()).hydrate()).toBeNull();
    expect(await new StudyTimer(new FakeClock()).hydrate()).toBeNull();
  });

  it('starts a new session from zero and ignores another session snapshot', async () => {
    const clock = new FakeClock(); const store = new MemoryStore();
    const previous = new StudyTimer(clock, store);
    previous.startSession('session-a'); previous.handle('PLAYER_PLAYING'); clock.advance(400000); previous.handle('PLAYER_PAUSED');
    await Promise.resolve();

    const fresh = new StudyTimer(clock, store);
    expect(await fresh.hydrate('session-b')).toBeNull();
    fresh.startSession('session-b');
    expect(fresh.getActiveStudyMs()).toBe(0);
  });

  it('resumes the same session after a suspend', async () => {
    const clock = new FakeClock(); const store = new MemoryStore();
    const before = new StudyTimer(clock, store);
    before.startSession('session-a'); before.handle('PLAYER_PLAYING'); clock.advance(9000); before.handle('PLAYER_PAUSED');
    await Promise.resolve();

    const after = new StudyTimer(clock, store);
    expect(await after.hydrate('session-a')).toMatchObject({ activeStudyMs: 9000, sessionId: 'session-a' });
    expect(after.getActiveStudyMs()).toBe(9000);
  });
});
