import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FakeAssessmentWorkflow } from '../__fixtures__/fake-assessment-workflow';
import { seedQuiz } from '../__fixtures__/seed-quiz';
import { AssessmentPanel } from '../components/AssessmentPanel';
import { MultipleChoiceAnswer } from '../components/MultipleChoiceAnswer';
import { GradeResult } from '../components/GradeResult';
import { HistoryPage } from '../components/HistoryPage';

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

  it('keeps the history read model in the history workflow rather than the quiz-answer view', async () => {
    const workflow = new FakeAssessmentWorkflow();
    const question = seedQuiz.questions[1];
    const submission = { questionId: question.questionId, type: 'shortAnswer' as const, answerText: 'Dùng để định danh thiết bị trên mạng.' };
    const grade = await workflow.submit(seedQuiz, question, submission);
    expect(grade.questionId).toBe(question.questionId);
    expect(workflow.getHistory()).toEqual([
      expect.objectContaining({ answerAttemptId: grade.answerAttemptId, questionId: question.questionId }),
    ]);
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
      submitAttempt: async () => ({
        quizAttemptId: 'attempt-1', quizId: seedQuiz.quizId, score: grade.score,
        results: [{
          questionId: grade.questionId, outcome: grade.outcome, score: grade.score,
          submittedAnswer: 'IP', referenceAnswer: grade.referenceAnswer,
          explanation: grade.explanation, source: grade.source,
        }],
        submittedAtUtc: grade.gradedAtUtc,
      }),
    }));

    expect(resultMarkup).toContain('Đáp án tham khảo: IP');
    expect(historyMarkup).toContain('Lịch sử trả lời');
    expect(panelMarkup).toContain('Bài kiểm tra toàn video');
    expect(panelMarkup).toContain('assessment__question-number');
    expect(panelMarkup).toContain('assessment__option');
    expect(panelMarkup).toContain('type="radio"');
    expect(panelMarkup).not.toContain('correctOptionId');
    expect(panelMarkup).not.toContain('youtube-player');
  });

  it('renders each radio and answer text inside one selectable label', () => {
    const markup = renderToStaticMarkup(createElement(MultipleChoiceAnswer, {
      name: 'quiz-question',
      options: seedQuiz.questions[0].options ?? [],
      selectedOptionId: 'option-b',
      disabled: false,
      onChange: () => {},
    }));

    expect(markup).toContain('assessment__option--selected');
    expect(markup).toMatch(/<label[^>]*><input[^>]*type="radio"[^>]*checked=""[^>]*\/><span>IP<\/span><\/label>/);
    expect(markup).not.toContain('style=');
  });

  it('groups submitted results under their video and session with a watch link', () => {
    const base = {
      answerAttemptId: 'answer-a', youtubeVideoId: 'dQw4w9WgXcQ', videoTitle: 'Networking lesson',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', sessionId: 'session-a',
      questionId: 'question-a', questionPrompt: 'Question A', questionType: 'multipleChoice' as const,
      submittedAnswer: 'A', outcome: 'correct' as const, score: 1, explanation: 'Correct',
      timestampMs: 0, submittedAtUtc: '2026-10-01T10:00:00Z', quizAttemptId: 'attempt-a', attemptScore: 1,
    };
    const markup = renderToStaticMarkup(createElement(HistoryPage, { entries: [
      base,
      { ...base, answerAttemptId: 'answer-b', sessionId: 'session-b', questionId: 'question-b', questionPrompt: 'Question B' },
      { ...base, answerAttemptId: 'answer-c', youtubeVideoId: 'RD53wLkH3mQ', videoTitle: 'Binary search',
        videoUrl: 'https://www.youtube.com/watch?v=RD53wLkH3mQ', sessionId: 'session-c',
        questionId: 'question-c', questionPrompt: 'Question C' },
    ] }));

    expect(markup.match(/class="history-video"/g)).toHaveLength(2);
    expect(markup.match(/class="history-session"/g)).toHaveLength(3);
    expect(markup).toContain('Networking lesson');
    expect(markup).toContain('Binary search');
    expect(markup).toContain('https://www.youtube.com/watch?v=RD53wLkH3mQ');
  });
});
