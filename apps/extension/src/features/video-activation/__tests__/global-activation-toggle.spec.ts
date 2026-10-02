import { describe, expect, it } from 'vitest';
import { broadcastGlobalActivation, GlobalActivationGateCoordinator, type GlobalActivationTogglePort } from '../services/global-activation-toggle';

function createPort(overrides: Partial<GlobalActivationTogglePort> = {}): GlobalActivationTogglePort {
  let correlation = 0;
  return {
    queryTabs: async () => [],
    ensureContentScriptReady: async () => undefined,
    sendToggle: async () => ({ ok: true }),
    createCorrelationId: () => `correlation-${++correlation}`,
    ...overrides,
  };
}

describe('global activation toggle', () => {
  it('broadcasts OFF to every existing YouTube tab, not only the active tab', async () => {
    const calls: Array<{ tabId: number; state: string; correlationId: string }> = [];
    const result = await broadcastGlobalActivation('off', createPort({
      queryTabs: async () => [
        { id: 3, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        { id: 8, url: 'https://www.youtube.com/' },
        { id: 9, url: 'https://example.com/' },
      ],
      sendToggle: async (tabId, request) => {
        calls.push({ tabId, state: request.requestedState, correlationId: request.correlationId });
        return { ok: true };
      },
    }));

    expect(calls).toEqual([
      { tabId: 3, state: 'off', correlationId: 'correlation-1' },
      { tabId: 8, state: 'off', correlationId: 'correlation-2' },
    ]);
    expect(result).toEqual({ matchedTabIds: [3, 8], deliveredTabIds: [3, 8], failedTabIds: [], staleTabIds: [] });
  });

  it('isolates a failed tab and still disables every reachable tab', async () => {
    const delivered: number[] = [];
    const result = await broadcastGlobalActivation('off', createPort({
      queryTabs: async () => [
        { id: 1, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        { id: 2, url: 'https://www.youtube.com/watch?v=9bZkp7q19f0' },
        { id: 3, url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
      ],
      ensureContentScriptReady: async (tabId) => {
        if (tabId === 2) throw new Error('tab reloading');
      },
      sendToggle: async (tabId) => {
        delivered.push(tabId);
        return { ok: true };
      },
    }));

    expect(delivered).toEqual([1, 3]);
    expect(result.deliveredTabIds).toEqual([1, 3]);
    expect(result.failedTabIds).toEqual([2]);
  });

  it('initializes all already-open YouTube tabs when the global gate turns ON', async () => {
    const enabled: number[] = [];
    const result = await broadcastGlobalActivation('on', createPort({
      queryTabs: async () => [
        { id: 4, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        { id: 5, url: 'https://www.youtube.com/results?search_query=learning' },
      ],
      sendToggle: async (tabId, request) => {
        if (request.requestedState === 'on') enabled.push(tabId);
        return { ok: true };
      },
    }));

    expect(enabled).toEqual([4, 5]);
    expect(result.failedTabIds).toEqual([]);
  });

  it('persists OFF without waiting for a hung ON relay and makes that relay stale', async () => {
    const coordinator = new GlobalActivationGateCoordinator<string>();
    const order: string[] = [];
    let onIsCurrent: (() => boolean) | undefined;
    const on = coordinator.request(
      async () => { order.push('persist:on'); return 'on'; },
      async (_state, isCurrent) => {
        order.push('relay:on');
        onIsCurrent = isCurrent;
        await new Promise<void>(() => {});
        return 'never';
      },
    );
    void on;
    await Promise.resolve();
    const off = coordinator.request(
      async () => { order.push('persist:off'); return 'off'; },
      async () => { order.push('relay:off'); return 'off'; },
    );

    await expect(off).resolves.toBe('off');
    expect(order).toEqual(['persist:on', 'relay:on', 'persist:off', 'relay:off']);
    expect(onIsCurrent?.()).toBe(false);
  });
});
