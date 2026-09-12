import { describe, expect, it } from 'vitest';
import { StudyTimer, type Clock } from '../services/study-timer';

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
