import { describe, expect, it } from 'vitest';
import { ContentScriptReadinessCoordinator, type ContentScriptReadinessPort } from '../content-script-readiness';

describe('ContentScriptReadinessCoordinator', () => {
  it('shares one injection while concurrent callers wait for the same tab', async () => {
    let ready = false;
    let injectionCount = 0;
    let finishInjection: (() => void) | undefined;
    const injectionFinished = new Promise<void>((resolve) => { finishInjection = resolve; });
    const port: ContentScriptReadinessPort = {
      ping: async () => ready,
      inject: async () => {
        injectionCount += 1;
        await injectionFinished;
        ready = true;
      },
    };
    const coordinator = new ContentScriptReadinessCoordinator();

    const first = coordinator.ensure(8, port);
    const second = coordinator.ensure(8, port);
    await Promise.resolve();
    expect(injectionCount).toBe(1);

    finishInjection?.();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(injectionCount).toBe(1);
  });

  it('does not inject when the existing content script is ready', async () => {
    const port: ContentScriptReadinessPort = {
      ping: async () => true,
      inject: async () => { throw new Error('should not inject'); },
    };

    await expect(new ContentScriptReadinessCoordinator().ensure(8, port)).resolves.toBeUndefined();
  });
});
