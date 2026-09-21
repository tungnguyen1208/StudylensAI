import { useReducer, useRef, useState } from 'react';
import { createHistoryEntry } from '../services/history-entry-mapper';
import { assessmentHistoryReducer, initialAssessmentHistoryState } from '../state/assessment-history-reducer';
import type { GradeView, HistoryEntryReadModel, LocalAnswerSubmission, QuizAvailable } from '../types/assessment-types';
import { operationFailure, type OperationStatusPayload } from '../../../shared/messaging/operation-status';
import { AnswerForm } from './AnswerForm';
import { GradeResult } from './GradeResult';
import { HistoryPage } from './HistoryPage';

interface AssessmentPanelProps {
  quiz: QuizAvailable;
  submitAnswer: (submission: LocalAnswerSubmission, clientAttemptId: string) => Promise<GradeView>;
  loadHistory?: () => Promise<HistoryEntryReadModel[]>;
  onOperationStatus?: (status: OperationStatusPayload) => void;
  onGrade?: (grade: GradeView) => void;
  showGrade?: boolean;
  showHistory?: boolean;
}

/** Renders public questions only; grading and history stay behind the Backend API. */
export function AssessmentPanel({
  quiz,
  submitAnswer,
  loadHistory = async () => [],
  onOperationStatus = () => {},
  onGrade,
  showGrade = true,
  showHistory = true,
}: AssessmentPanelProps) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [state, dispatch] = useReducer(assessmentHistoryReducer, initialAssessmentHistoryState);
  const [failedSubmission, setFailedSubmission] = useState<LocalAnswerSubmission | null>(null);
  const [canRetrySubmission, setCanRetrySubmission] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const attemptIds = useRef(new Map<string, string>());
  const question = quiz.questions[questionIndex];

  const handleSubmit = async (submission: LocalAnswerSubmission) => {
    onOperationStatus({ operation: 'answerSubmit', state: 'pending', message: 'Đang gửi câu trả lời.', retryable: false });
    try {
      const key = submission.type === 'multipleChoice'
        ? `${submission.questionId}:${submission.selectedOptionId}`
        : `${submission.questionId}:${submission.answerText}`;
      const clientAttemptId = attemptIds.current.get(key) ?? crypto.randomUUID();
      attemptIds.current.set(key, clientAttemptId);
      const grade = await submitAnswer(submission, clientAttemptId);
      dispatch({
        type: 'gradeReceived',
        grade,
        entry: createHistoryEntry(quiz, question, submission, grade, grade.gradedAtUtc),
      });
      setFailedSubmission(null);
      setCanRetrySubmission(false);
      setErrorMessage(null);
      onOperationStatus({ operation: 'answerSubmit', state: 'succeeded', message: 'Đã chấm câu trả lời.', retryable: false });
      onGrade?.(grade);
      if (showHistory) await refreshHistory();
    } catch (error: unknown) {
      const failure = operationFailure(error, 'answerSubmitFailed', 'Không thể gửi câu trả lời tới Backend.');
      setFailedSubmission(submission);
      setCanRetrySubmission(failure.retryable);
      setErrorMessage(failure.message);
      onOperationStatus({ operation: 'answerSubmit', state: 'failed', ...failure });
    }
  };

  const refreshHistory = async () => {
    onOperationStatus({ operation: 'historyLoad', state: 'pending', message: 'Đang tải lịch sử học.', retryable: false });
    try {
      dispatch({ type: 'historyLoaded', entries: await loadHistory() });
      onOperationStatus({ operation: 'historyLoad', state: 'succeeded', message: 'Đã tải lịch sử học.', retryable: false });
    } catch (error: unknown) {
      const failure = operationFailure(error, 'historyLoadFailed', 'Không thể tải lịch sử học.');
      setErrorMessage(failure.message);
      onOperationStatus({ operation: 'historyLoad', state: 'failed', ...failure });
    }
  };

  if (!question) return <p role="alert">Bài kiểm tra không có câu hỏi công khai để trả lời.</p>;

  return (
    <section aria-label="Đánh giá bài kiểm tra">
      <p>Câu {questionIndex + 1}/{quiz.questions.length}</p>
      <AnswerForm question={question} onSubmit={handleSubmit} />
      {showGrade && state.latestGrade && <GradeResult grade={state.latestGrade} />}
      {showHistory && <HistoryPage entries={state.entries} />}
      {errorMessage && <p role="alert">Lỗi: {errorMessage}</p>}
      {failedSubmission && canRetrySubmission && <button type="button" onClick={() => void handleSubmit(failedSubmission)}>Thử lại gửi đáp án</button>}
      {showHistory && <button type="button" onClick={() => void refreshHistory()}>Tải lại lịch sử</button>}
      <div>
        <button type="button" disabled={questionIndex === 0} onClick={() => setQuestionIndex(questionIndex - 1)}>Câu trước</button>
        <button type="button" disabled={questionIndex === quiz.questions.length - 1} onClick={() => setQuestionIndex(questionIndex + 1)}>Câu tiếp</button>
      </div>
    </section>
  );
}

/** @deprecated Use AssessmentPanel. Kept temporarily for existing consumers. */
export const AssessmentFixturePanel = AssessmentPanel;
