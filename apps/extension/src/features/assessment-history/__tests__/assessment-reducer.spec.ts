import { describe, expect, it } from 'vitest';
import { assessmentReducer, createInitialAnswerFormState, toLocalAnswerSubmission } from '../state/assessment-reducer';
import { seedQuiz } from '../__fixtures__/seed-quiz';

describe('assessment answer state with public seed questions', () => {
  it('submits the selected MCQ option ID, not option text or a hidden answer', () => {
    const question = seedQuiz.questions[0];
    const state = assessmentReducer(createInitialAnswerFormState(question), { type: 'selectOption', optionId: 'option-b' });
    expect(toLocalAnswerSubmission(question, state.draft)).toEqual({
      questionId: question.questionId,
      type: 'multipleChoice',
      selectedOptionId: 'option-b',
    });
  });

  it('rejects blank short answers while preserving the learner draft', () => {
    const question = seedQuiz.questions[1];
    const typed = assessmentReducer(createInitialAnswerFormState(question), { type: 'changeShortAnswer', answerText: '   ' });
    const invalid = assessmentReducer(typed, { type: 'validationFailed', message: 'Vui lòng nhập câu trả lời.' });
    expect(toLocalAnswerSubmission(question, invalid.draft)).toBeUndefined();
    expect(invalid.draft).toEqual({ type: 'shortAnswer', answerText: '   ' });
    expect(invalid.validationMessage).toBe('Vui lòng nhập câu trả lời.');
  });

  it('keeps a non-empty short-answer draft after a failed submit state', () => {
    const question = seedQuiz.questions[1];
    const typed = assessmentReducer(createInitialAnswerFormState(question), { type: 'changeShortAnswer', answerText: 'Định danh thiết bị trên mạng.' });
    const submitting = assessmentReducer(typed, { type: 'submitRequested' });
    const completed = assessmentReducer(submitting, { type: 'submitFinished' });
    expect(completed).toMatchObject({ isSubmitting: false, draft: { answerText: 'Định danh thiết bị trên mạng.' } });
  });

  it('resets the draft when the quiz moves to a question of another type', () => {
    const selected = assessmentReducer(createInitialAnswerFormState(seedQuiz.questions[0]), { type: 'selectOption', optionId: 'option-b' });
    const next = assessmentReducer(selected, { type: 'reset', question: seedQuiz.questions[1] });
    expect(next).toEqual({ draft: { type: 'shortAnswer', answerText: '' }, isSubmitting: false });
  });
});
