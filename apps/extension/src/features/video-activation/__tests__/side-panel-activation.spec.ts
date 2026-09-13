import { describe, expect, it } from 'vitest';
import { initialActivationState } from '../state/activation-reducer';
import { applyVideoActivationMessage } from '../state/side-panel-activation';

describe('Side Panel activation state', () => {
  it('maps context, active decision, and stop envelopes without accessing YouTube DOM', () => {
    const context = applyVideoActivationMessage(initialActivationState, {
      type: 'VIDEO_CONTEXT_CHANGED', contractVersion: '0.1.0', correlationId: 'a', tabId: 7,
      youtubeVideoId: 'dQw4w9WgXcQ', occurredAtUtc: '2026-09-13T10:00:00.000Z',
      payload: { title: 'Networking lesson' },
    });
    const active = applyVideoActivationMessage(context, {
      type: 'ACTIVATION_DECIDED', contractVersion: '0.1.0', correlationId: 'b', tabId: 7,
      youtubeVideoId: 'dQw4w9WgXcQ', occurredAtUtc: '2026-09-13T10:00:01.000Z', payload: {},
    });
    const stopped = applyVideoActivationMessage(active, {
      type: 'ACTIVATION_STOPPED', contractVersion: '0.1.0', correlationId: 'c', tabId: 7,
      youtubeVideoId: 'dQw4w9WgXcQ', occurredAtUtc: '2026-09-13T10:00:02.000Z', payload: {},
    });

    expect(context.context?.title).toBe('Networking lesson');
    expect(active.status).toBe('active');
    expect(stopped.status).toBe('off');
  });
});
