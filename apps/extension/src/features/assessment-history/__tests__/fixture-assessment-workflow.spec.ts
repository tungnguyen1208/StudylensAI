import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FakeAssessmentWorkflow } from '../__fixtures__/fake-assessment-workflow';
import { seedQuiz } from '../__fixtures__/seed-quiz';
import { AssessmentPanel } from '../components/AssessmentFixturePanel';
import { GradeResult } from '../components/GradeResult';
import { HistoryPage } from '../components/HistoryPage';
import { assessmentHistoryReducer, initialAssessmentHistoryState } from '../state/assessment-history-reducer';

describe('assessment view-model workflow', () => {
  it('produces a post-submit result and history entry for a MCQ fixture answer', async () => {
    const workflow = new FakeAssessmentWorkflow();
    const question = seedQuiz.questions[0];
    const grade = await workflow.submit(seedQuiz, question, {
      questionId: question.questionId,
      type: 'multipleChoice',
      selectedOptionId: 'option-b',
    });

    expect(grade).toMatchObject({ questionId: question.questionId, outcome: 'correct', score: 1, referenceAnswer: 'IP' });
    expect(workflow.getHistory()).toHaveLength(1);
    expect(workflow.getHistory()[0]).toMatchObject({ submittedAnswer: 'IP', outcome: 'correct', timestampMs: 300000 });
  });

  it('keeps an incorrect answer as incorrect rather than treating it as a service failure', async () => {
    const workflow = new FakeAssessmentWorkflow();
    const question = seedQuiz.questions[0];
    const grade = await workflow.submit(seedQuiz, question, {
      questionId: question.questionId,
      type: 'multipleChoice',
      selectedOptionId: 'option-a',
    });

    expect(grade).toMatchObject({ outcome: 'incorrect', score: 0 });
  });

  it('stores the latest grade and prepends its corresponding history read model', async () => {
    const workflow = new FakeAssessmentWorkflow();
    const question = seedQuiz.questions[1];
    const submission = { questionId: question.questionId, type: 'shortAnswer' as const, answerText: 'Dùng để định danh thiết bị trên mạng.' };
    const grade = await workflow.submit(seedQuiz, question, submission);
    const entry = workflow.getHistory()[0];

    const state = assessmentHistoryReducer(initialAssessmentHistoryState, { type: 'gradeReceived', grade, entry });
    expect(state.latestGrade).toEqual(grade);
    expect(state.entries).toEqual([entry]);
  });

  it('renders public answer, result, and empty history states without accessing YouTube DOM', async () => {
    const workflow = new FakeAssessmentWorkflow();
    const grade = await workflow.submit(seedQuiz, seedQuiz.questions[0], {
      questionId: seedQuiz.questions[0].questionId,
      type: 'multipleChoice',
      selectedOptionId: 'option-b',
    });
    const resultMarkup = renderToStaticMarkup(createElement(GradeResult, { grade }));
    const historyMarkup = renderToStaticMarkup(createElement(HistoryPage, { entries: workflow.getHistory().slice() }));
    const panelMarkup = renderToStaticMarkup(createElement(AssessmentPanel, {
      quiz: seedQuiz,
      submitAnswer: async () => grade,
    }));

    expect(resultMarkup).toContain('Đáp án tham khảo: IP');
    expect(historyMarkup).toContain('Lịch sử trả lời');
    expect(panelMarkup).toContain('Đánh giá bài kiểm tra');
    expect(panelMarkup).not.toContain('youtube-player');
  });
});
