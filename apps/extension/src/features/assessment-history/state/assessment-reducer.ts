import type { AnswerDraft, LocalAnswerSubmission, QuestionPublic } from '../types/assessment-types';

export interface AnswerFormState {
  draft: AnswerDraft;
  isSubmitting: boolean;
  validationMessage?: string;
}

export type AnswerFormAction =
  | { type: 'reset'; question: QuestionPublic }
  | { type: 'selectOption'; optionId: string }
  | { type: 'changeShortAnswer'; answerText: string }
  | { type: 'submitRequested' }
  | { type: 'submitFinished' }
  | { type: 'validationFailed'; message: string };

export function createInitialAnswerFormState(question: QuestionPublic): AnswerFormState {
  return question.type === 'multipleChoice'
    ? { draft: { type: 'multipleChoice', selectedOptionId: '' }, isSubmitting: false }
    : { draft: { type: 'shortAnswer', answerText: '' }, isSubmitting: false };
}

export function assessmentReducer(state: AnswerFormState, action: AnswerFormAction): AnswerFormState {
  switch (action.type) {
    case 'reset': return createInitialAnswerFormState(action.question);
    case 'selectOption':
      return state.draft.type === 'multipleChoice'
        ? { ...state, draft: { type: 'multipleChoice', selectedOptionId: action.optionId }, validationMessage: undefined }
        : state;
    case 'changeShortAnswer':
      return state.draft.type === 'shortAnswer'
        ? { ...state, draft: { type: 'shortAnswer', answerText: action.answerText }, validationMessage: undefined }
        : state;
    case 'submitRequested': return { ...state, isSubmitting: true, validationMessage: undefined };
    case 'submitFinished': return { ...state, isSubmitting: false };
    case 'validationFailed': return { ...state, validationMessage: action.message };
  }
}

export function toLocalAnswerSubmission(
  question: QuestionPublic,
  draft: AnswerDraft,
): LocalAnswerSubmission | undefined {
  if (question.type === 'multipleChoice' && draft.type === 'multipleChoice' && draft.selectedOptionId) {
    return { questionId: question.questionId, type: 'multipleChoice', selectedOptionId: draft.selectedOptionId };
  }

  if (question.type === 'shortAnswer' && draft.type === 'shortAnswer') {
    const answerText = draft.answerText.trim();
    return answerText ? { questionId: question.questionId, type: 'shortAnswer', answerText } : undefined;
  }

  return undefined;
}
