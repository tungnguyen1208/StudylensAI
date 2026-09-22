import { useRef, useState } from 'react';
import type { GradeView, LocalAnswerSubmission, QuizAvailable } from '../types/assessment-types';
import { operationFailure, type OperationStatusPayload } from '../../../shared/messaging/operation-status';
import { AnswerForm } from './AnswerForm';

interface AssessmentPanelProps {
  quiz: QuizAvailable;
  submitAnswer: (submission: LocalAnswerSubmission, clientAttemptId: string) => Promise<GradeView>;
  onOperationStatus?: (status: OperationStatusPayload) => void;
  onGrade?: (grade: GradeView) => void;
}

/** Renders public questions and sends answers to the Backend. Result/history render in their own views. */
export function AssessmentPanel({
  quiz,
  submitAnswer,
  onOperationStatus = () => {},
  onGrade,
}: AssessmentPanelProps) {
  const [questionIndex, setQuestionIndex] = useState(0);
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
      setFailedSubmission(null);
      setCanRetrySubmission(false);
      setErrorMessage(null);
      onOperationStatus({ operation: 'answerSubmit', state: 'succeeded', message: 'Đã chấm câu trả lời.', retryable: false });
      onGrade?.(grade);
    } catch (error: unknown) {
      const failure = operationFailure(error, 'answerSubmitFailed', 'Không thể gửi câu trả lời tới Backend.');
      setFailedSubmission(submission);
      setCanRetrySubmission(failure.retryable);
      setErrorMessage(failure.message);
      onOperationStatus({ operation: 'answerSubmit', state: 'failed', ...failure });
    }
  };

  if (!question) return <p role="alert">Bài kiểm tra không có câu hỏi công khai để trả lời.</p>;

  return (
    <section aria-label="Đánh giá bài kiểm tra">
      <p>Câu {questionIndex + 1}/{quiz.questions.length}</p>
      <AnswerForm question={question} onSubmit={handleSubmit} />
      {errorMessage && <p role="alert">Lỗi: {errorMessage}</p>}
      {failedSubmission && canRetrySubmission && <button type="button" onClick={() => void handleSubmit(failedSubmission)}>Thử lại gửi đáp án</button>}
      <div>
        <button type="button" disabled={questionIndex === 0} onClick={() => setQuestionIndex(questionIndex - 1)}>Câu trước</button>
        <button type="button" disabled={questionIndex === quiz.questions.length - 1} onClick={() => setQuestionIndex(questionIndex + 1)}>Câu tiếp</button>
      </div>
    </section>
  );
}
