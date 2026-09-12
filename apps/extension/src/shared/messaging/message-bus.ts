import { ExtensionMessage, MessageHandler } from './message-types';

export class MessageBus {
  private readonly handlers: Map<string, Set<MessageHandler<any>>> = new Map();
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

      const handlers = this.handlers.get((message as ExtensionMessage).type);
      if (handlers && handlers.size > 0) {
        handlers.forEach((handler) => {
          try {
            const result = handler(message as ExtensionMessage, sender);
            if (result instanceof Promise) {
              result.then(sendResponse).catch(() => {});
            }
          } catch {
            // Handler error suppressed to not disrupt communication
          }
        });
      }
    });
  }
}

export const messageBus = new MessageBus();
