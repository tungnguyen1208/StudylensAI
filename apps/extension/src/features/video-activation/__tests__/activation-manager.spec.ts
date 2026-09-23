import { describe, expect, it } from 'vitest';
import { ManualActivationManager } from '../services/activation-manager';
import { activationReducer, initialActivationState } from '../state/activation-reducer';

const context = { tabId: 7, youtubeVideoId: 'dQw4w9WgXcQ', title: 'Networking lesson' };

describe('activation reducer', () => {
  it('resets the local flow when a different page is explicitly bound', () => {
    const active = activationReducer(activationReducer(initialActivationState, { type: 'contextChanged', context }), { type: 'manualOn' });
    const next = activationReducer(active, { type: 'contextChanged', context: { ...context, youtubeVideoId: '9bZkp7q19f0' } });
    expect(next.status).toBe('off');
    expect(next.transcriptCapture).toBeNull();
  });
});

describe('ManualActivationManager', () => {
  it('publishes one enabled event and one disabled event for repeated toggles', async () => {
    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const manager = new ManualActivationManager({ publish: async (message) => { messages.push(message as never); }, createActivationId: () => 'activation-1' });
    await manager.setContext(context, 'context-correlation');
    manager.setTranscriptCapture({ transcriptCaptureId: 'snapshot-1', youtubeVideoId: context.youtubeVideoId, language: 'en', source: 'tabAudioStt' as const, status: 'available', availableCueCount: 1, version: 1 });
    await manager.request('on', context.youtubeVideoId, 'on-correlation');
    await manager.request('on', context.youtubeVideoId, 'duplicate-on');
    await manager.request('off', context.youtubeVideoId, 'off-correlation');
    expect(messages.map((message) => message.type)).toEqual(['ACTIVATION_ENABLED', 'ACTIVATION_DISABLED']);
    expect(messages[0].payload).toMatchObject({ source: 'user', activationId: 'activation-1' });
    expect(messages[1].payload).toEqual({ reasonCode: 'userDisabled' });
  });

  it('publishes one restored activation when a remounted content script replays ON', async () => {
    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const manager = new ManualActivationManager({ publish: async (message) => { messages.push(message as never); }, createActivationId: () => 'activation-restored' });
    await manager.setContext(context, 'restore-context');
    manager.setTranscriptCapture({ transcriptCaptureId: 'snapshot-restore', youtubeVideoId: context.youtubeVideoId, language: 'en', source: 'tabAudioStt' as const, status: 'available', availableCueCount: 1, version: 1 });

    await manager.request('on', context.youtubeVideoId, 'restore-correlation', 'storageRestore');
    await manager.request('on', context.youtubeVideoId, 'duplicate-restore', 'storageRestore');

    expect(messages).toHaveLength(1);
    expect(messages[0].payload).toMatchObject({ activationId: 'activation-restored', source: 'storageRestore' });
  });

  it('does not publish an automatic stop when a different page is explicitly bound', async () => {
    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const manager = new ManualActivationManager({ publish: async (message) => { messages.push(message as never); }, createActivationId: () => 'activation-1' });
    await manager.setContext(context, 'a');
    manager.setTranscriptCapture({ transcriptCaptureId: 'snapshot-1', youtubeVideoId: context.youtubeVideoId, language: 'en', source: 'tabAudioStt' as const, status: 'available', availableCueCount: 1, version: 1 });
    await manager.request('on', context.youtubeVideoId, 'b');
    await manager.setContext({ ...context, youtubeVideoId: '9bZkp7q19f0' }, 'c');
    expect(messages).toHaveLength(1);
    expect(manager.getState().status).toBe('off');
  });

  it('waits for a transcript snapshot before publishing the enabled event', async () => {
    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const manager = new ManualActivationManager({ publish: async (message) => { messages.push(message as never); }, createActivationId: () => 'activation-late-snapshot' });
    await manager.setContext(context, 'context-correlation');
    await manager.request('on', context.youtubeVideoId, 'on-correlation');
    expect(messages).toEqual([]);
    manager.setTranscriptCapture({ transcriptCaptureId: 'snapshot-1', youtubeVideoId: context.youtubeVideoId, language: 'en', source: 'tabAudioStt' as const, status: 'available', availableCueCount: 1, version: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(messages).toHaveLength(1);
    expect(messages[0].payload).toMatchObject({ activationId: 'activation-late-snapshot', transcriptCapture: { transcriptCaptureId: 'snapshot-1' } });
  });

  it('waits through unavailable transcript evidence and publishes once after a valid retry', async () => {
    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const manager = new ManualActivationManager({ publish: async (message) => { messages.push(message as never); }, createActivationId: () => 'activation-retry' });
    await manager.setContext(context, 'context-correlation');
    await manager.request('on', context.youtubeVideoId, 'on-correlation');

    manager.setTranscriptCapture({ transcriptCaptureId: 'snapshot-unavailable', youtubeVideoId: context.youtubeVideoId, language: 'en', source: 'tabAudioStt' as const, status: 'insufficient', availableCueCount: 0, version: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(messages).toEqual([]);

    manager.setTranscriptCapture({ transcriptCaptureId: 'snapshot-available', youtubeVideoId: context.youtubeVideoId, language: 'en', source: 'tabAudioStt' as const, status: 'available', availableCueCount: 1, version: 1 });
    manager.setTranscriptCapture({ transcriptCaptureId: 'snapshot-replayed', youtubeVideoId: context.youtubeVideoId, language: 'en', source: 'tabAudioStt' as const, status: 'available', availableCueCount: 1, version: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(messages.map((message) => message.type)).toEqual(['ACTIVATION_ENABLED']);
  });

  it('captures an immutable preference snapshot at activation request time', async () => {
    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const manager = new ManualActivationManager({ publish: async (message) => { messages.push(message as never); }, createActivationId: () => 'activation-preferences' });
    await manager.setContext(context, 'context-correlation');
    manager.setPreferences({ quizIntervalMinutes: 5, questionType: 'shortAnswer', difficulty: 'easy' });
    await manager.request('on', context.youtubeVideoId, 'on-correlation');
    manager.setPreferences({ quizIntervalMinutes: 15, questionType: 'multipleChoice', difficulty: 'hard' });
    manager.setTranscriptCapture({ transcriptCaptureId: 'snapshot-1', youtubeVideoId: context.youtubeVideoId, language: 'en', source: 'tabAudioStt' as const, status: 'available', availableCueCount: 1, version: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(messages[0].payload).toMatchObject({
      preferences: { quizIntervalMinutes: 5, questionType: 'shortAnswer', difficulty: 'easy' },
    });
  });
});
