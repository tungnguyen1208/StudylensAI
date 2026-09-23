import { describe, expect, it } from 'vitest';
import { MessageBus } from '../message-bus';

describe('MessageBus', () => {
  it('delivers a published content-script event to local subscribers', async () => {
    const bus = new MessageBus();
    const received: string[] = [];
    bus.subscribe('ACTIVATION_ENABLED', (message) => { received.push(message.type); });

    await bus.publish({
      type: 'ACTIVATION_ENABLED',
      contractVersion: '0.3.0',
      correlationId: 'local-event',
      tabId: 1,
      youtubeVideoId: 'dQw4w9WgXcQ',
      occurredAtUtc: '2026-09-20T00:00:00Z',
      payload: {},
    });

    expect(received).toEqual(['ACTIVATION_ENABLED']);
  });

  it('ignores a service-worker relay of an event already delivered locally', () => {
    const bus = new MessageBus();
    const received: string[] = [];
    const envelope = {
      type: 'PLAYER_PLAYING', contractVersion: '0.3.0' as const, correlationId: 'relay-event', tabId: 1,
      youtubeVideoId: 'dQw4w9WgXcQ', occurredAtUtc: '2026-09-20T00:00:00Z', payload: { currentTimeMs: 1000 },
    };
    const internal = bus as unknown as {
      notify(message: typeof envelope, sender: chrome.runtime.MessageSender): void;
    };
    bus.subscribe('PLAYER_PLAYING', (message) => { received.push(message.type); });

    internal.notify(envelope, {} as chrome.runtime.MessageSender);
    internal.notify(envelope, {} as chrome.runtime.MessageSender);

    expect(received).toEqual(['PLAYER_PLAYING']);
  });
});
