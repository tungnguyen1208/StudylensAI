import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_STORAGE_KEY,
  loadPersistedActivationState,
  savePersistedActivationState,
  type PersistedActivationState,
} from '../models/persistent-activation';
import type { LocalStoragePort } from '../models/learning-preferences';

function createStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const writes: Array<Record<string, unknown>> = [];
  const storage: LocalStoragePort = {
    get: async () => ({ ...data }),
    set: async (value) => {
      writes.push({ ...value });
      Object.assign(data, value);
    },
  };
  return { storage, writes, data };
}

const firstInstallTime = () => new Date('2026-09-23T08:00:00.000Z');

describe('persistent activation storage', () => {
  it('initializes first install as OFF exactly once', async () => {
    const { storage, writes } = createStorage();

    await expect(loadPersistedActivationState(storage, firstInstallTime)).resolves.toEqual({
      enabled: false,
      persistedAtUtc: '2026-09-23T08:00:00.000Z',
    });
    expect(writes).toEqual([{
      [ACTIVATION_STORAGE_KEY]: { enabled: false, persistedAtUtc: '2026-09-23T08:00:00.000Z' },
    }]);
  });

  it('restores a saved ON state without replacing its original timestamp', async () => {
    const restored: PersistedActivationState = { enabled: true, persistedAtUtc: '2026-09-22T12:15:00.000Z' };
    const { storage, writes } = createStorage({ [ACTIVATION_STORAGE_KEY]: restored });

    await expect(loadPersistedActivationState(storage, firstInstallTime)).resolves.toEqual(restored);
    expect(writes).toEqual([]);
  });

  it('replaces malformed persisted data with a safe OFF default', async () => {
    const { storage, writes } = createStorage({ [ACTIVATION_STORAGE_KEY]: { enabled: true, persistedAtUtc: 'not-a-date' } });

    await expect(loadPersistedActivationState(storage, firstInstallTime)).resolves.toMatchObject({ enabled: false });
    expect(writes).toHaveLength(1);
  });

  it('persists an explicit learner toggle for a future browser restore', async () => {
    const { storage } = createStorage();
    const toggledAt = () => new Date('2026-09-23T09:30:00.000Z');

    await expect(savePersistedActivationState(storage, true, toggledAt)).resolves.toEqual({
      enabled: true,
      persistedAtUtc: '2026-09-23T09:30:00.000Z',
    });
    await expect(loadPersistedActivationState(storage, firstInstallTime)).resolves.toEqual({
      enabled: true,
      persistedAtUtc: '2026-09-23T09:30:00.000Z',
    });
  });
});
