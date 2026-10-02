import { describe, expect, it } from 'vitest';
import { isAuthoritativeToggleState, scheduleStorageOnFallback } from '../services/activation-toggle-authority';
import { LocalGateRevision } from '../services/local-gate-revision';

const stored = (enabled: boolean) => ({ enabled, persistedAtUtc: '2026-10-02T08:00:00.000Z' });

describe('activation toggle authority', () => {
  it('rejects a late ON command after authoritative storage is OFF', () => {
    expect(isAuthoritativeToggleState('on', stored(false))).toBe(false);
    expect(isAuthoritativeToggleState('off', stored(false))).toBe(true);
    expect(isAuthoritativeToggleState('on', { enabled: true, persistedAtUtc: 'invalid' })).toBe(false);
  });

  it('keeps a delayed valid explicit command as source=user and suppresses storage fallback', () => {
    const gate = new LocalGateRevision();
    const storageRevision = gate.invalidate();
    let scheduled: (() => void) | null = null;
    const sources: string[] = [];
    scheduleStorageOnFallback({
      gate,
      revision: storageRevision,
      delayMs: 3_500,
      schedule: (callback) => { scheduled = callback; return 1; },
      activate: (source) => sources.push(source),
    });

    // The receiver accepts the matching explicit command before fallback.
    gate.invalidate();
    sources.push('user');
    (scheduled as (() => void) | null)?.();
    expect(sources).toEqual(['user']);
  });

  it('uses source=storageRestore only after the true relay timeout fallback', () => {
    const gate = new LocalGateRevision();
    const storageRevision = gate.invalidate();
    let scheduled: (() => void) | null = null;
    const sources: string[] = [];
    scheduleStorageOnFallback({
      gate,
      revision: storageRevision,
      delayMs: 3_500,
      schedule: (callback, delayMs) => {
        expect(delayMs).toBe(3_500);
        scheduled = callback;
        return 1;
      },
      activate: (source) => sources.push(source),
    });

    (scheduled as (() => void) | null)?.();
    expect(sources).toEqual(['storageRestore']);
  });
});
