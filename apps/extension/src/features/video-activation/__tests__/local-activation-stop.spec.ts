import { describe, expect, it } from 'vitest';
import { stopLocalActivation } from '../services/local-activation-stop';

describe('local activation OFF safety', () => {
  it('invalidates pending work before publishing ACTIVATION_DISABLED', async () => {
    let current = true;
    let observedDuringPublish = true;

    await stopLocalActivation({
      invalidateLocalWork: () => { current = false; },
      publishDisabled: async () => { observedDuringPublish = current; },
    });

    expect(observedDuringPublish).toBe(false);
  });

  it('keeps pending work invalidated when publishing OFF fails', async () => {
    let current = true;
    await expect(stopLocalActivation({
      invalidateLocalWork: () => { current = false; },
      publishDisabled: async () => { throw new Error('relay unavailable'); },
    })).rejects.toThrow('relay unavailable');

    expect(current).toBe(false);
  });
});
