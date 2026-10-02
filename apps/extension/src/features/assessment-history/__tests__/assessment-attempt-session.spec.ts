import { describe, expect, it } from 'vitest';
import {
  createAssessmentAttemptSession,
  MemoryAssessmentAttemptSessionStore,
  prepareAttemptSubmission,
} from '../state/assessment-attempt-session';

describe('assessment attempt session', () => {
  it('preserves drafts and the same clientAttemptId across panel remounts', async () => {
    const store = new MemoryAssessmentAttemptSessionStore();
    const session = createAssessmentAttemptSession(() => 'stable-attempt-id');
    session.drafts = { questionA: 'option-a', questionB: 'short answer' };
    await store.save('quiz-a', session);

    const restored = await store.load('quiz-a');

    expect(restored).toEqual(session);
    expect(restored?.clientAttemptId).toBe('stable-attempt-id');
  });

  it('isolates a new quiz and retains a completed attempt for duplicate-submit protection', async () => {
    const store = new MemoryAssessmentAttemptSessionStore();
    const completed = createAssessmentAttemptSession(() => 'attempt-a');
    completed.attempt = {
      quizAttemptId: 'result-a', quizId: 'quiz-a', score: 1, submittedAtUtc: '2026-10-02T08:00:00Z', results: [],
    };
    await store.save('quiz-a', completed);
    await store.save('quiz-b', createAssessmentAttemptSession(() => 'attempt-b'));

    expect((await store.load('quiz-a'))?.attempt?.quizAttemptId).toBe('result-a');
    expect((await store.load('quiz-b'))?.clientAttemptId).toBe('attempt-b');
    expect((await store.load('quiz-b'))?.attempt).toBeNull();
  });

  it('retries the immutable first payload with the same clientAttemptId after drafts change', () => {
    const original = createAssessmentAttemptSession(() => 'stable-attempt-id');
    original.drafts = { questionA: 'option-a' };
    const first = prepareAttemptSubmission(original, [
      { questionId: 'questionA', type: 'multipleChoice', selectedOptionId: 'option-a' },
    ]);
    first.session.drafts.questionA = 'option-b';

    const retry = prepareAttemptSubmission(first.session, [
      { questionId: 'questionA', type: 'multipleChoice', selectedOptionId: 'option-b' },
    ]);

    expect(retry.session.clientAttemptId).toBe('stable-attempt-id');
    expect(retry.answers).toEqual([
      { questionId: 'questionA', type: 'multipleChoice', selectedOptionId: 'option-a' },
    ]);
  });
});
