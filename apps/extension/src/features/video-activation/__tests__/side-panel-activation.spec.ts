import { describe, expect, it } from 'vitest';
import { initialActivationState } from '../state/activation-reducer';
import { applyVideoActivationMessage } from '../state/side-panel-activation';

describe('Side Panel activation state', () => {
  it('maps enabled and disabled envelopes without accessing YouTube DOM', () => {
    const active = applyVideoActivationMessage(initialActivationState, {
      type: 'ACTIVATION_ENABLED', contractVersion: '0.2.0', correlationId: 'b', tabId: 7,
      youtubeVideoId: 'dQw4w9WgXcQ', occurredAtUtc: '2026-09-13T10:00:01.000Z',
      payload: { activationId: 'a', source: 'user', videoTitle: 'Networking lesson', transcriptSnapshot: { transcriptSnapshotId: 'snapshot-1', youtubeVideoId: 'dQw4w9WgXcQ', language: 'en', status: 'available', contentHash: 'a'.repeat(64), version: '0.2.0' }, preferences: { quizIntervalMinutes: 10, questionType: 'multipleChoice', difficulty: 'medium' } },
    });
    const stopped = applyVideoActivationMessage(active, {
      type: 'ACTIVATION_DISABLED', contractVersion: '0.2.0', correlationId: 'c', tabId: 7,
      youtubeVideoId: 'dQw4w9WgXcQ', occurredAtUtc: '2026-09-13T10:00:02.000Z', payload: {},
    });

    expect(active.context?.title).toBe('Networking lesson');
    expect(active.status).toBe('active');
    expect(stopped.status).toBe('off');
  });
});
