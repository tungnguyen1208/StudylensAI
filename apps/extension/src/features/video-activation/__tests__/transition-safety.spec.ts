import { describe, expect, it } from 'vitest';
import { continueAfterContextPublish } from '../services/transition-safety';

describe('video transition safety', () => {
  it('continues replacement B when the external context relay fails', async () => {
    let replacementStarted = false;
    await continueAfterContextPublish(
      async () => { throw new Error('relay failed'); },
      () => true,
      async () => { replacementStarted = true; },
    );
    expect(replacementStarted).toBe(true);
  });

  it('does not resume B when a newer C transition invalidated it', async () => {
    let replacementStarted = false;
    await continueAfterContextPublish(
      async () => undefined,
      () => false,
      async () => { replacementStarted = true; },
    );
    expect(replacementStarted).toBe(false);
  });
});
