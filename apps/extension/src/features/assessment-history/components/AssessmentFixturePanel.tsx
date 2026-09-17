import { useReducer, useState } from 'react';
import { createHistoryEntry } from '../services/history-entry-mapper';
import { assessmentHistoryReducer, initialAssessmentHistoryState } from '../state/assessment-history-reducer';
import type { GradeView, LocalAnswerSubmission, QuizAvailable } from '../types/assessment-types';
import { AnswerForm } from './AnswerForm';
import { GradeResult } from './GradeResult';
import { HistoryPage } from './HistoryPage';

interface AssessmentFixturePanelProps {
  quiz: QuizAvailable;
  /** Test/demo seam. Production wiring will provide the Backend client in a later task. */
  submitAnswer: (submission: LocalAnswerSubmission) => Promise<GradeView>;
}

/** Demonstrates answer → result → local read model without network or a direct AI call. */
export function AssessmentFixturePanel({ quiz, submitAnswer }: AssessmentFixturePanelProps) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [state, dispatch] = useReducer(assessmentHistoryReducer, initialAssessmentHistoryState);
  const question = quiz.questions[questionIndex];

  const handleSubmit = async (submission: LocalAnswerSubmission) => {
    const grade = await submitAnswer(submission);
    dispatch({
      type: 'gradeReceived',
      grade,
      entry: createHistoryEntry(quiz, question, submission, grade, grade.gradedAtUtc),
    });
  };

  if (!question) return <p role="alert">Quiz fixture không có câu hỏi để trả lời.</p>;

  return (
    <section aria-label="Quiz fixture assessment">
      <p>Câu {questionIndex + 1}/{quiz.questions.length}</p>
      <AnswerForm question={question} onSubmit={handleSubmit} />
      {state.latestGrade && <GradeResult grade={state.latestGrade} />}
      <HistoryPage entries={state.entries} />
      <div>
        <button type="button" disabled={questionIndex === 0} onClick={() => setQuestionIndex(questionIndex - 1)}>Câu trước</button>
        <button type="button" disabled={questionIndex === quiz.questions.length - 1} onClick={() => setQuestionIndex(questionIndex + 1)}>Câu tiếp</button>
      </div>
    </section>
  );
}
