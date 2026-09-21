import { FormEvent, useEffect, useReducer, useRef } from 'react';
import { assessmentReducer, createInitialAnswerFormState, toLocalAnswerSubmission } from '../state/assessment-reducer';
import type { LocalAnswerSubmission, QuestionPublic } from '../types/assessment-types';
import { MultipleChoiceAnswer } from './MultipleChoiceAnswer';
import { ShortAnswerInput } from './ShortAnswerInput';

interface AnswerFormProps {
  question: QuestionPublic;
  isLoading?: boolean;
  onSubmit: (submission: LocalAnswerSubmission) => void | Promise<void>;
}

/** Holds the learner draft locally and delegates the actual submission to the Backend API. */
export function AnswerForm({ question, isLoading = false, onSubmit }: AnswerFormProps) {
  const [state, dispatch] = useReducer(assessmentReducer, question, createInitialAnswerFormState);
  const submissionInFlight = useRef(false);

  useEffect(() => {
    submissionInFlight.current = false;
    dispatch({ type: 'reset', question });
  }, [question.questionId]);

  const disabled = isLoading || state.isSubmitting;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submissionInFlight.current || disabled) return;

    const submission = toLocalAnswerSubmission(question, state.draft);
    if (!submission) {
      dispatch({ type: 'validationFailed', message: question.type === 'shortAnswer' ? 'Vui lòng nhập câu trả lời.' : 'Vui lòng chọn một đáp án.' });
      return;
    }

    submissionInFlight.current = true;
    dispatch({ type: 'submitRequested' });
    try {
      await onSubmit(submission);
    } finally {
      submissionInFlight.current = false;
      dispatch({ type: 'submitFinished' });
    }
  };

  return (
    <form onSubmit={submit} aria-busy={disabled}>
      <p>{question.prompt}</p>
      {question.type === 'multipleChoice' ? (
        <MultipleChoiceAnswer
          name={`question-${question.questionId}`}
          options={question.options ?? []}
          selectedOptionId={state.draft.type === 'multipleChoice' ? state.draft.selectedOptionId : ''}
          disabled={disabled}
          onChange={(optionId) => dispatch({ type: 'selectOption', optionId })}
        />
      ) : (
        <ShortAnswerInput
          value={state.draft.type === 'shortAnswer' ? state.draft.answerText : ''}
          disabled={disabled}
          onChange={(answerText) => dispatch({ type: 'changeShortAnswer', answerText })}
        />
      )}
      {state.validationMessage && <p role="alert">{state.validationMessage}</p>}
      <button type="submit" disabled={disabled}>{disabled ? 'Đang gửi…' : 'Nộp câu trả lời'}</button>
    </form>
  );
}
