export interface YoutubeTabRef {
  id?: number;
  url?: string;
}

export interface GlobalActivationTogglePort {
  queryTabs(): Promise<readonly YoutubeTabRef[]>;
  ensureContentScriptReady(tabId: number): Promise<void>;
  sendToggle(tabId: number, request: ActivationToggleCommand): Promise<{ ok?: boolean; code?: string } | undefined>;
  createCorrelationId(): string;
}

export interface ActivationToggleCommand {
  type: 'ACTIVATION_TOGGLE_REQUEST';
  requestedState: 'on' | 'off';
  source: 'user';
  correlationId: string;
}

export interface GlobalActivationToggleResult {
  matchedTabIds: number[];
  deliveredTabIds: number[];
  failedTabIds: number[];
  staleTabIds: number[];
}

/** Serializes only authoritative persistence; slow relays remain independent. */
export class GlobalActivationGateCoordinator<TState> {
  private persistenceTail: Promise<void> = Promise.resolve();
  private revision = 0;

  public request<TResult>(
    persist: () => Promise<TState>,
    relay: (state: TState, isCurrent: () => boolean) => Promise<TResult>,
  ): Promise<TResult> {
    const revision = ++this.revision;
    const persisted = this.persistenceTail.then(persist, persist);
    this.persistenceTail = persisted.then(() => undefined, () => undefined);
    return persisted.then((state) => relay(state, () => revision === this.revision));
  }
}

export interface GlobalActivationBroadcastOptions {
  isCurrent?: () => boolean;
  timeoutMs?: number;
}

/**
 * Relays the persisted global gate to every existing YouTube tab. Each tab is
 * isolated so an unavailable or reloading content script cannot block the
 * remaining tabs from observing OFF/ON.
 */
export async function broadcastGlobalActivation(
  requestedState: 'on' | 'off',
  port: GlobalActivationTogglePort,
  options: GlobalActivationBroadcastOptions = {},
): Promise<GlobalActivationToggleResult> {
  const tabs = (await port.queryTabs()).filter(isSupportedYoutubeTab);
  const outcomes = await Promise.all(tabs.map(async (tab) => {
    const tabId = tab.id!;
    try {
      if (options.isCurrent && !options.isCurrent()) return { tabId, delivered: false, stale: true };
      await withTimeout(port.ensureContentScriptReady(tabId), options.timeoutMs ?? 1_500);
      if (options.isCurrent && !options.isCurrent()) return { tabId, delivered: false, stale: true };
      const response = await withTimeout(port.sendToggle(tabId, {
        type: 'ACTIVATION_TOGGLE_REQUEST',
        requestedState,
        source: 'user',
        correlationId: port.createCorrelationId(),
      }), options.timeoutMs ?? 1_500);
      return { tabId, delivered: response?.ok !== false, stale: false };
    } catch {
      return { tabId, delivered: false, stale: false };
    }
  }));

  return {
    matchedTabIds: outcomes.map(({ tabId }) => tabId),
    deliveredTabIds: outcomes.filter(({ delivered }) => delivered).map(({ tabId }) => tabId),
    failedTabIds: outcomes.filter(({ delivered, stale }) => !delivered && !stale).map(({ tabId }) => tabId),
    staleTabIds: outcomes.filter(({ stale }) => stale).map(({ tabId }) => tabId),
  };
}

export function isSupportedYoutubeTab(tab: YoutubeTabRef): tab is YoutubeTabRef & { id: number } {
  return Number.isInteger(tab.id) && tab.id! >= 0 && typeof tab.url === 'string' && isYoutubeUrl(tab.url);
}

function isYoutubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.youtube.com';
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('activationRelayTimeout')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
