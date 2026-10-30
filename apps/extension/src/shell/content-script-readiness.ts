export interface ContentScriptReadinessPort {
  ping(tabId: number): Promise<boolean>;
  inject(tabId: number): Promise<void>;
}

/**
 * Shares one readiness/injection attempt per tab. A Side Panel refresh and a
 * concurrent learning-package poll must not inject two content scripts into
 * the same YouTube document.
 */
export class ContentScriptReadinessCoordinator {
  private readonly pending = new Map<number, Promise<void>>();

  public ensure(tabId: number, port: ContentScriptReadinessPort): Promise<void> {
    const existing = this.pending.get(tabId);
    if (existing) return existing;

    const task = this.ensureCore(tabId, port).finally(() => this.pending.delete(tabId));
    this.pending.set(tabId, task);
    return task;
  }

  private async ensureCore(tabId: number, port: ContentScriptReadinessPort): Promise<void> {
    if (await port.ping(tabId)) return;

    try {
      await port.inject(tabId);
    } catch (error) {
      // A parallel browser injection can report an error although the script
      // is already ready by the time its request completes.
      if (await port.ping(tabId)) return;
      throw error;
    }

    if (!await port.ping(tabId)) throw new Error('contentScriptUnavailable');
  }
}
