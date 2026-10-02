import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HistoryLoadPanel } from '../components/HistoryLoadPanel';
import {
  INITIAL_HISTORY_LOAD_STATE,
  historyLoadFailed,
  historyLoadStarted,
  historyLoadSucceeded,
} from '../state/history-load-state';
import type { HistoryEntryReadModel } from '../types/assessment-types';

describe('history load UI recovery', () => {
  it('moves from empty to network error and then renders recovered history', () => {
    const empty = historyLoadSucceeded([]);
    expect(render(empty)).toContain('Chưa có lịch sử trả lời.');

    const loading = historyLoadStarted(empty);
    expect(render(loading)).toContain('Đang tải lịch sử học tập');

    const failed = historyLoadFailed(loading, 'Backend tạm thời không khả dụng.');
    const failedMarkup = render(failed);
    expect(failedMarkup).toContain('role="alert"');
    expect(failedMarkup).toContain('Backend tạm thời không khả dụng.');
    expect(failedMarkup).toContain('Thử tải lại');

    const recovered = historyLoadSucceeded([historyEntry]);
    const recoveredMarkup = render(recovered);
    expect(recoveredMarkup).toContain('Binary search lesson');
    expect(recoveredMarkup).toContain('Lịch sử trả lời');
    expect(recoveredMarkup).not.toContain('Backend tạm thời không khả dụng.');
  });

  it('starts from a stable idle state without exposing an error', () => {
    const markup = render(INITIAL_HISTORY_LOAD_STATE);
    expect(markup).toContain('Chưa có lịch sử trả lời.');
    expect(markup).not.toContain('role="alert"');
  });
});

function render(state: Parameters<typeof HistoryLoadPanel>[0]['state']): string {
  return renderToStaticMarkup(createElement(HistoryLoadPanel, { state, onRetry: () => {} }));
}

const historyEntry: HistoryEntryReadModel = {
  answerAttemptId: 'answer-1', youtubeVideoId: 'RD53wLkH3mQ', videoTitle: 'Binary search lesson',
  videoUrl: 'https://www.youtube.com/watch?v=RD53wLkH3mQ', sessionId: 'session-1',
  quizAttemptId: 'attempt-1', attemptScore: 1, questionId: 'question-1',
  questionPrompt: 'Binary search requires what input?', questionType: 'multipleChoice',
  submittedAnswer: 'Sorted input', referenceAnswer: 'Sorted input', outcome: 'correct', score: 1,
  explanation: 'The transcript states that the input is sorted.', timestampMs: 1_000,
  submittedAtUtc: '2026-10-02T09:00:00Z',
};
