import { describe, expect, it } from 'vitest';
import { ManualActivationManager } from '../services/activation-manager';
import { activationReducer, initialActivationState } from '../state/activation-reducer';

const context = { tabId: 7, youtubeVideoId: 'dQw4w9WgXcQ', title: 'Networking lesson' };

describe('activation reducer', () => {
  it('resets a manual override and transcript when the video changes', () => {
    const active = activationReducer(
      activationReducer(initialActivationState, { type: 'contextChanged', context }),
      { type: 'manualOn' },
    );
    const next = activationReducer(active, {
      type: 'contextChanged',
      context: { ...context, youtubeVideoId: '9bZkp7q19f0' },
    });

    expect(next.status).toBe('off');
    expect(next.transcriptSnapshot).toBeNull();
  });
});

describe('ManualActivationManager', () => {
  it('publishes one manual decision and one stop event for repeated toggles', async () => {
    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const manager = new ManualActivationManager({
      publish: async (message) => { messages.push(message as never); },
      createDecisionId: () => 'decision-1',
    });
    await manager.setContext(context, 'context-correlation');
    manager.setTranscriptSnapshot({
      transcriptSnapshotId: 'snapshot-1', youtubeVideoId: context.youtubeVideoId,
      language: 'en', status: 'unavailable', version: '0.1.0',
    });

    await manager.request('on', context.youtubeVideoId, 'on-correlation');
    await manager.request('on', context.youtubeVideoId, 'duplicate-on');
    await manager.request('off', context.youtubeVideoId, 'off-correlation');

    expect(messages.map((message) => message.type)).toEqual(['ACTIVATION_DECIDED', 'ACTIVATION_STOPPED']);
    expect(messages[0].payload).toMatchObject({ source: 'manual', state: 'active' });
    expect(messages[1].payload).toEqual({ reasonCode: 'userDisabled' });
  });

  it('stops an active video before resetting state for a different video', async () => {
    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const manager = new ManualActivationManager({
      publish: async (message) => { messages.push(message as never); },
      createDecisionId: () => 'decision-1',
    });
    await manager.setContext(context, 'a');
    await manager.request('on', context.youtubeVideoId, 'b');
    await manager.setContext({ ...context, youtubeVideoId: '9bZkp7q19f0' }, 'c');

    expect(messages[1]).toMatchObject({ type: 'ACTIVATION_STOPPED', payload: { reasonCode: 'videoChanged' } });
    expect(manager.getState().status).toBe('off');
  });
});
