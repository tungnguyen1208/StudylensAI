import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { seedQuiz } from '../__fixtures__/seed-quiz';
import { AnswerForm } from '../components/AnswerForm';

describe('AnswerForm component smoke tests', () => {
  it('renders accessible radio controls for a public MCQ without exposing an answer key', () => {
    const markup = renderToStaticMarkup(createElement(AnswerForm, { question: seedQuiz.questions[0], onSubmit: () => undefined }));
    expect(markup).toContain('type="radio"');
    expect(markup).toContain('value="option-b"');
    expect(markup).toContain('Nộp câu trả lời');
    expect(markup).not.toContain('correctAnswer');
  });

  it('renders a labeled short-answer input and native submit button', () => {
    const markup = renderToStaticMarkup(createElement(AnswerForm, { question: seedQuiz.questions[1], onSubmit: () => undefined }));
    expect(markup).toContain('aria-label="Câu trả lời ngắn"');
    expect(markup).toContain('<textarea');
    expect(markup).toContain('type="submit"');
  });
});
