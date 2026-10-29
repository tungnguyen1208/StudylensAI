import { describe, expect, it } from 'vitest';
import type { ExtensionMessage } from '../../../shared/messaging/message-types';
import { shouldApplyActiveTabMessage } from '../state/active-tab-message';

const message = (tabId: number, youtubeVideoId: string, type: ExtensionMessage['type'] = 'ACTIVATION_ENABLED') => ({
  type,
  contractVersion: '0.7.0',
  correlationId: `${tabId}:${youtubeVideoId}:${type}`,
  tabId,
  youtubeVideoId,
  occurredAtUtc: '2026-10-02T00:00:00Z',
  payload: { videoTitle: `Video ${youtubeVideoId}` },
}) as ExtensionMessage;

describe('active Side Panel tab isolation', () => {
  it('rejects inactive-tab events while the learner alternates between two tabs', () => {
    const tabA = { tabId: 11, youtubeVideoId: 'dQw4w9WgXcQ', title: 'Video A' };
    const tabB = { tabId: 22, youtubeVideoId: 'RD53wLkH3mQ', title: 'Video B' };

    expect(shouldApplyActiveTabMessage(tabA, message(tabB.tabId, tabB.youtubeVideoId))).toBe(false);
    expect(shouldApplyActiveTabMessage(tabA, message(tabA.tabId, tabA.youtubeVideoId))).toBe(true);

    // After the Side Panel refreshes to B, a late event from A cannot replace B.
    expect(shouldApplyActiveTabMessage(tabB, message(tabA.tabId, tabA.youtubeVideoId))).toBe(false);
    expect(shouldApplyActiveTabMessage(tabB, message(tabB.tabId, tabB.youtubeVideoId))).toBe(true);
  });

  it('allows a same-tab SPA replacement and always accepts authoritative global OFF', () => {
    const active = { tabId: 11, youtubeVideoId: 'dQw4w9WgXcQ', title: 'Video A' };

    expect(shouldApplyActiveTabMessage(active, message(11, '9bZkp7q19f0', 'VIDEO_CONTEXT_CHANGED'))).toBe(true);
    expect(shouldApplyActiveTabMessage(null, message(22, 'RD53wLkH3mQ'))).toBe(false);
    expect(shouldApplyActiveTabMessage(null, message(22, 'RD53wLkH3mQ', 'ACTIVATION_DISABLED'))).toBe(true);
  });
});
