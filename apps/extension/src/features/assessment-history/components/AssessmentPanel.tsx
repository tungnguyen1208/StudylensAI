import { useRef, useState } from 'react';
import type { LocalAnswerSubmission, QuizAttemptView, QuizAvailable } from '../types/assessment-types';
import { operationFailure, type OperationStatusPayload } from '../../../shared/messaging/operation-status';
import { MultipleChoiceAnswer } from './MultipleChoiceAnswer';
import { ShortAnswerInput } from './ShortAnswerInput';

interface AssessmentPanelProps {
  quiz: QuizAvailable;
  submitAttempt: (submissions: LocalAnswerSubmission[], clientAttemptId: string) => Promise<QuizAttemptView>;
  onOperationStatus?: (status: OperationStatusPayload) => void;
  onAttempt?: (attempt: QuizAttemptView) => void;
  onSeekEvidence?: (timestampMs: number) => void;
}

type Drafts = Record<string, string>;

/** Collects every answer locally and submits one complete quiz attempt. */
export function AssessmentPanel({
  quiz,
  submitAttempt,
  onOperationStatus = () => {},
  onAttempt,
  onSeekEvidence,
}: AssessmentPanelProps) {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [attempt, setAttempt] = useState<QuizAttemptView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clientAttemptId = useRef(crypto.randomUUID());

  const submissions = (): LocalAnswerSubmission[] | null => {
    const values: LocalAnswerSubmission[] = [];
    for (const question of quiz.questions) {
      const value = drafts[question.questionId]?.trim() ?? '';
      if (!value) return null;
      values.push(question.type === 'multipleChoice'
        ? { questionId: question.questionId, type: 'multipleChoice', selectedOptionId: value }
        : { questionId: question.questionId, type: 'shortAnswer', answerText: value });
    }
    return values;
  };

  const handleSubmit = async () => {
    const answers = submissions();
    if (!answers) {
      setErrorMessage('Vui lòng trả lời đầy đủ tất cả câu hỏi trước khi nộp bài.');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    onOperationStatus({ operation: 'answerSubmit', state: 'pending', message: 'Đang nộp toàn bộ bài làm.', retryable: false });
    try {
      const result = await submitAttempt(answers, clientAttemptId.current);
      setAttempt(result);
      onAttempt?.(result);
      onOperationStatus({ operation: 'answerSubmit', state: 'succeeded', message: 'Backend đã chấm và lưu toàn bộ bài làm.', retryable: false });
    } catch (error: unknown) {
      const failure = operationFailure(error, 'answerSubmitFailed', 'Không thể nộp bài tới Backend.');
      setErrorMessage(failure.message);
      onOperationStatus({ operation: 'answerSubmit', state: 'failed', ...failure });
    } finally {
      setSubmitting(false);
    }
  };

  if (quiz.questions.length === 0) return <p role="alert">Bài kiểm tra không có câu hỏi để trả lời.</p>;

  return (
    <section className="assessment" aria-label="Bài kiểm tra toàn video">
      {quiz.questions.map((question, index) => {
        const result = attempt?.results.find((item) => item.questionId === question.questionId);
        return (
          <article className="assessment__question" key={question.questionId}>
            <h3><span className="assessment__question-number">Câu {index + 1}/{quiz.questions.length}</span>{question.prompt}</h3>
            {question.type === 'multipleChoice' ? (
              <MultipleChoiceAnswer
                name={`question-${question.questionId}`}
                options={question.options ?? []}
                selectedOptionId={drafts[question.questionId] ?? ''}
                disabled={submitting || Boolean(attempt)}
                onChange={(value) => setDrafts((current) => ({ ...current, [question.questionId]: value }))}
              />
            ) : (
              <ShortAnswerInput
                value={drafts[question.questionId] ?? ''}
                disabled={submitting || Boolean(attempt)}
                onChange={(value) => setDrafts((current) => ({ ...current, [question.questionId]: value }))}
              />
            )}
            {result ? (
              <div className={`assessment__feedback assessment__feedback--${result.outcome}`}>
                <strong>{result.outcome === 'correct' ? 'Chính xác' : result.outcome === 'partiallyCorrect' ? 'Đúng một phần' : 'Chưa chính xác'}</strong>
                <p>Đáp án tham khảo: {result.referenceAnswer}</p>
                <p>{result.explanation}</p>
                {result.outcome !== 'correct' ? (
                  <button type="button" className="secondary-button" onClick={() => onSeekEvidence?.(result.source.startMs)}>
                    Xem lại tại mốc {formatTimestamp(result.source.startMs)}
                  </button>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
      {errorMessage ? <p className="health-error" role="alert">{errorMessage}</p> : null}
      {attempt ? <p className="assessment__score" role="status">Điểm toàn bài: {attempt.score}</p> : (
        <button type="button" className="primary-button" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? 'Đang nộp bài…' : 'Nộp toàn bộ bài'}
        </button>
      )}
    </section>
  );
}

function formatTimestamp(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
