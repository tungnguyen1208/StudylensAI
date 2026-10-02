export interface LocalActivationStopOptions {
  /** Must synchronously cancel timers, fetches, observers and player listeners. */
  invalidateLocalWork(): void;
  publishDisabled(): Promise<unknown>;
}

/**
 * Safety boundary for explicit OFF. Local work is invalidated before the
 * first fallible await so a failed event relay cannot leave acquisition live.
 */
export async function stopLocalActivation(options: LocalActivationStopOptions): Promise<void> {
  options.invalidateLocalWork();
  await options.publishDisabled();
}
