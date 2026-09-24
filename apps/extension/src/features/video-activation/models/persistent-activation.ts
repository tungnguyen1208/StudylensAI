import type { LocalStoragePort } from './learning-preferences';

export const ACTIVATION_STORAGE_KEY = 'extensionEnabled';

/** The only persisted global learning-flow switch for the unauthenticated MVP. */
export interface PersistedActivationState {
  enabled: boolean;
  persistedAtUtc: string;
}

export function isPersistedActivationState(value: unknown): value is PersistedActivationState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedActivationState>;
  return typeof candidate.enabled === 'boolean' &&
    typeof candidate.persistedAtUtc === 'string' &&
    !Number.isNaN(Date.parse(candidate.persistedAtUtc));
}

/**
 * Restores the learner's explicit choice without rewriting a valid saved ON/OFF
 * state. Missing or malformed storage is safely initialized to first-install OFF.
 */
export async function loadPersistedActivationState(
  storage: LocalStoragePort,
  now: () => Date = () => new Date(),
): Promise<PersistedActivationState> {
  const stored = await storage.get(ACTIVATION_STORAGE_KEY);
  const value = stored[ACTIVATION_STORAGE_KEY];
  if (isPersistedActivationState(value)) return { ...value };

  const initial: PersistedActivationState = { enabled: false, persistedAtUtc: now().toISOString() };
  await storage.set({ [ACTIVATION_STORAGE_KEY]: initial });
  return initial;
}

export async function savePersistedActivationState(
  storage: LocalStoragePort,
  enabled: boolean,
  now: () => Date = () => new Date(),
): Promise<PersistedActivationState> {
  const state: PersistedActivationState = { enabled, persistedAtUtc: now().toISOString() };
  await storage.set({ [ACTIVATION_STORAGE_KEY]: state });
  return state;
}
