import { isPersistedActivationState } from '../models/persistent-activation';
import type { LocalGateRevision } from './local-gate-revision';

export function isAuthoritativeToggleState(
  requestedState: 'on' | 'off',
  storedValue: unknown,
): boolean {
  return isPersistedActivationState(storedValue) &&
    storedValue.enabled === (requestedState === 'on');
}

export function scheduleStorageOnFallback(options: {
  gate: LocalGateRevision;
  revision: number;
  delayMs: number;
  schedule(callback: () => void, delayMs: number): number;
  activate(source: 'storageRestore'): void;
}): number {
  return options.schedule(() => {
    if (options.gate.isCurrent(options.revision)) options.activate('storageRestore');
  }, options.delayMs);
}
