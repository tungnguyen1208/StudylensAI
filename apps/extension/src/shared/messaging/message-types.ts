export interface ExtensionMessage<T = unknown> {
  type: string;
  contractVersion: '0.4.0';
  correlationId: string;
  tabId: number;
  youtubeVideoId: string;
  occurredAtUtc: string;
  payload: T;
}

export type MessageHandler<T = unknown> = (
  message: ExtensionMessage<T>,
  sender: chrome.runtime.MessageSender
) => void | Promise<unknown>;
