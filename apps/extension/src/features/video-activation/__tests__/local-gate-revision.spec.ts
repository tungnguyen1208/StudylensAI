import { describe, expect, it } from 'vitest';
import { LocalGateRevision } from '../services/local-gate-revision';

describe('local activation gate revision', () => {
  it('prevents a delayed startup ON response from beating a newer storage OFF', () => {
    const gate = new LocalGateRevision();
    const delayedStartup = gate.snapshot();
    gate.invalidate();
    expect(gate.isCurrent(delayedStartup)).toBe(false);
  });
});
