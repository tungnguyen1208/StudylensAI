import { ExtensionMessage, MessageHandler } from './message-types';

export class MessageBus {
  private readonly handlers: Map<string, Set<MessageHandler<any>>> = new Map();
  private readonly deliveredMessageIds = new Set<string>();
  private isListening = false;

  public subscribe<T>(type: string, handler: MessageHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    this.ensureListener();

    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  public async publish<T>(message: ExtensionMessage<T>): Promise<void> {
    // A content script must consume its own domain events immediately. Chrome
    // runtime messaging only reaches the service worker/extension contexts;
    // it is not a replacement for the in-context feature bus.
    this.notify(message, {} as chrome.runtime.MessageSender);
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        await chrome.runtime.sendMessage(message);
      } catch {
        // Message target might not be listening yet, ignore safely
      }
    }
  }

  private ensureListener(): void {
    if (this.isListening || typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
      return;
    }

    this.isListening = true;
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== 'object' || !('type' in message)) {
        return;
      }

      this.notify(message as ExtensionMessage, sender, sendResponse);
    });
  }

  private notify(message: ExtensionMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void = () => {}): void {
    if (!this.markUndelivered(message)) return;
    const handlers = this.handlers.get(message.type);
    handlers?.forEach((handler) => {
      try {
        const result = handler(message, sender);
        if (result instanceof Promise) result.then(sendResponse).catch(() => {});
      } catch {
        // A feature listener must never break the host page or other listeners.
      }
    });
  }

  /**
   * Content scripts consume an event locally before relaying it to the service
   * worker. Chrome can then deliver that relay back to the same content script.
   * Keep the first delivery only so timer/segment reducers are never run twice.
   */
  private markUndelivered(message: ExtensionMessage): boolean {
    const key = `${message.type}:${message.correlationId}:${message.tabId}:${message.youtubeVideoId}:${message.occurredAtUtc}:${safePayloadKey(message.payload)}`;
    if (this.deliveredMessageIds.has(key)) return false;
    this.deliveredMessageIds.add(key);
    if (this.deliveredMessageIds.size > 500) {
      const oldest = this.deliveredMessageIds.values().next().value;
      if (oldest) this.deliveredMessageIds.delete(oldest);
    }
    return true;
  }
}

function safePayloadKey(payload: unknown): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return '[unserializable]';
  }
}

export const messageBus = new MessageBus();
