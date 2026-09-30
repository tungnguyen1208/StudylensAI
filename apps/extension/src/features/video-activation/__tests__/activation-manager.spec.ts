import { describe, expect, it } from 'vitest';
import { ManualActivationManager } from '../services/activation-manager';
import { activationReducer, initialActivationState } from '../state/activation-reducer';

const context = { tabId: 7, youtubeVideoId: 'dQw4w9WgXcQ', title: 'Networking lesson' };

describe('activation reducer', () => {
  it('resets video-scoped data when another page is bound', () => {
    const active = activationReducer(activationReducer(initialActivationState, { type: 'contextChanged', context }), { type: 'manualOn' });
    const next = activationReducer(active, { type: 'contextChanged', context: { ...context, youtubeVideoId: '9bZkp7q19f0' } });
    expect(next.status).toBe('off');
    expect(next.errorCode).toBeNull();
  });
});

describe('ManualActivationManager 0.5', () => {
  it('publishes activation immediately before transcript acquisition', async () => {
    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const manager = new ManualActivationManager({ publish: async (message) => { messages.push(message as never); }, createActivationId: () => 'activation-1' });
    await manager.setContext(context, 'context-1');
    manager.setPreferences({ questionType: 'shortAnswer', difficulty: 'easy' });
    await manager.request('on', context.youtubeVideoId, 'on-1');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: 'ACTIVATION_ENABLED', payload: { activationId: 'activation-1', videoTitle: context.title, preferences: { questionType: 'shortAnswer', difficulty: 'easy' } } });
  });

  it('deduplicates repeated ON/OFF commands', async () => {
    const messages: Array<{ type: string }> = [];
    const manager = new ManualActivationManager({ publish: async (message) => { messages.push(message); }, createActivationId: () => 'activation-1' });
    await manager.setContext(context, 'context-1');
    await manager.request('on', context.youtubeVideoId, 'on-1');
    await manager.request('on', context.youtubeVideoId, 'on-2');
    await manager.request('off', context.youtubeVideoId, 'off-1');
    await manager.request('off', context.youtubeVideoId, 'off-2');
    expect(messages.map((message) => message.type)).toEqual(['ACTIVATION_ENABLED', 'ACTIVATION_DISABLED']);
  });

  it('marks restored activation with its storage source', async () => {
    const messages: Array<{ payload: Record<string, unknown> }> = [];
    const manager = new ManualActivationManager({ publish: async (message) => { messages.push(message as never); }, createActivationId: () => 'activation-restored' });
    await manager.setContext(context, 'context-1');
    await manager.request('on', context.youtubeVideoId, 'restore-1', 'storageRestore');
    expect(messages[0].payload).toMatchObject({ activationId: 'activation-restored', source: 'storageRestore' });
  });

  it('snapshots updated preferences for the replacement video', async () => {
    const messages: Array<{ payload: Record<string, unknown> }> = [];
    const manager = new ManualActivationManager({ publish: async (message) => { messages.push(message as never); } });
    await manager.setContext(context, 'context-a');
    manager.setPreferences({ questionType: 'multipleChoice', difficulty: 'easy' });
    await manager.request('on', context.youtubeVideoId, 'on-a');
    const replacement = { ...context, youtubeVideoId: '9bZkp7q19f0', title: 'Video B' };
    await manager.setContext(replacement, 'context-b');
    manager.setPreferences({ questionType: 'shortAnswer', difficulty: 'hard' });
    await manager.request('on', replacement.youtubeVideoId, 'on-b');

    expect(messages[1].payload).toMatchObject({
      videoTitle: 'Video B',
      preferences: { questionType: 'shortAnswer', difficulty: 'hard' },
    });
  });
});
