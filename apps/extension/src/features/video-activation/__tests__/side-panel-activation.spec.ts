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

  it('keeps the global toggle on while the next page waits for transcript evidence', () => {
    const transitioned = applyVideoActivationMessage(initialActivationState, {
      type: 'VIDEO_CONTEXT_CHANGED', contractVersion: '0.2.0', correlationId: 'transition', tabId: 7,
      youtubeVideoId: '9bZkp7q19f0', occurredAtUtc: '2026-09-21T10:00:00.000Z',
      payload: {
        transitionId: 'transition-1', previousActivationId: 'activation-1',
        previousYoutubeVideoId: 'dQw4w9WgXcQ', videoTitle: 'Video B',
      },
    });

    expect(transitioned).toMatchObject({
      status: 'active',
      context: { youtubeVideoId: '9bZkp7q19f0', title: 'Video B' },
      transcriptSnapshot: null,
    });
  });

  it('keeps the global toggle on when navigation leaves a supported watch page', () => {
    const waiting = applyVideoActivationMessage(initialActivationState, {
      type: 'VIDEO_CONTEXT_UNAVAILABLE', contractVersion: '0.2.0', correlationId: 'away', tabId: 7,
      youtubeVideoId: 'dQw4w9WgXcQ', occurredAtUtc: '2026-09-21T10:00:00.000Z',
      payload: {
        transitionId: 'transition-away', previousActivationId: 'activation-1',
        previousYoutubeVideoId: 'dQw4w9WgXcQ', reasonCode: 'unsupportedWatchPage',
      },
    });

    expect(waiting).toMatchObject({ status: 'active', context: null, errorCode: 'unsupportedWatchPage' });
  });
});
