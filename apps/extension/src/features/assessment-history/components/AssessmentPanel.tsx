import { useEffect, useState } from 'react';
import type { LocalAnswerSubmission, QuestionSourceRef, QuizAttemptView, QuizAvailable } from '../types/assessment-types';
import { operationFailure, type OperationStatusPayload } from '../../../shared/messaging/operation-status';
import { MultipleChoiceAnswer } from './MultipleChoiceAnswer';
import { ShortAnswerInput } from './ShortAnswerInput';
import {
  assessmentAttemptSessionStore,
  createAssessmentAttemptSession,
  prepareAttemptSubmission,
  type AssessmentAttemptSession,
  type AssessmentAttemptSessionStore,
} from '../state/assessment-attempt-session';
import { isValidEvidenceTarget } from '../services/evidence-review';

interface AssessmentPanelProps {
  quiz: QuizAvailable;
  submitAttempt: (submissions: LocalAnswerSubmission[], clientAttemptId: string) => Promise<QuizAttemptView>;
  onOperationStatus?: (status: OperationStatusPayload) => void;
  onAttempt?: (attempt: QuizAttemptView) => void;
  onSeekEvidence?: (source: QuestionSourceRef) => void;
  sessionStore?: AssessmentAttemptSessionStore;
  initialSession?: AssessmentAttemptSession;
}

/** Collects every answer locally and retries with one stable client attempt ID. */
export function AssessmentPanel({
  quiz,
  submitAttempt,
  onOperationStatus = () => {},
  onAttempt,
  onSeekEvidence,
  sessionStore = assessmentAttemptSessionStore,
  initialSession,
}: AssessmentPanelProps) {
  const [session, setSession] = useState<AssessmentAttemptSession | null>(initialSession ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof operationFailure> | null>(null);

  useEffect(() => {
    if (initialSession) return;
    let current = true;
    void sessionStore.load(quiz.quizId).then(async (stored) => {
      const restored = stored ?? createAssessmentAttemptSession();
      if (!stored) await sessionStore.save(quiz.quizId, restored).catch(() => undefined);
      if (current) setSession(restored);
    }).catch(() => {
      if (current) setSession(createAssessmentAttemptSession());
    });
    return () => { current = false; };
  }, [initialSession, quiz.quizId, sessionStore]);

  const persist = async (next: AssessmentAttemptSession): Promise<void> => {
    setSession(next);
    await sessionStore.save(quiz.quizId, next).catch(() => undefined);
  };

  const submissions = (): LocalAnswerSubmission[] | null => {
    if (!session) return null;
    const values: LocalAnswerSubmission[] = [];
    for (const question of quiz.questions) {
      const value = session.drafts[question.questionId]?.trim() ?? '';
      if (!value) return null;
      values.push(question.type === 'multipleChoice'
        ? { questionId: question.questionId, type: 'multipleChoice', selectedOptionId: value }
        : { questionId: question.questionId, type: 'shortAnswer', answerText: value });
    }
    return values;
  };

  const handleSubmit = async () => {
    const draftAnswers = session?.submittedAnswers ?? submissions();
    if (!draftAnswers || !session) {
      setFailure({ code: 'incompleteAttempt', message: 'Vui lòng trả lời đầy đủ tất cả câu hỏi trước khi nộp bài.', retryable: false });
      return;
    }
    const prepared = prepareAttemptSubmission(session, draftAnswers);
    setSubmitting(true);
    setFailure(null);
    onOperationStatus({ operation: 'answerSubmit', state: 'pending', message: 'Đang nộp toàn bộ bài làm.', retryable: false });
    try {
      if (prepared.session !== session) await persist(prepared.session);
      const result = await submitAttempt(prepared.answers, prepared.session.clientAttemptId);
      await persist({ ...prepared.session, attempt: result });
      onAttempt?.(result);
      onOperationStatus({ operation: 'answerSubmit', state: 'succeeded', message: 'Backend đã chấm và lưu toàn bộ bài làm.', retryable: false });
    } catch (error: unknown) {
      const nextFailure = operationFailure(error, 'answerSubmitFailed', 'Không thể nộp bài tới Backend.');
      setFailure(nextFailure);
      onOperationStatus({ operation: 'answerSubmit', state: 'failed', ...nextFailure });
    } finally {
      setSubmitting(false);
    }
  };

  if (quiz.questions.length === 0) return <p role="alert">Bài kiểm tra không có câu hỏi để trả lời.</p>;
  if (!session) return <p role="status">Đang khôi phục bài làm…</p>;

  const editAfterFailure = () => {
    const replacement = createAssessmentAttemptSession();
    void persist({ ...replacement, drafts: { ...session.drafts } });
    setFailure(null);
  };

  return (
    <section className="assessment" aria-label="Bài kiểm tra toàn video">
      {quiz.questions.map((question, index) => {
        const result = session.attempt?.results.find((item) => item.questionId === question.questionId);
        return (
          <article className="assessment__question" key={question.questionId}>
            <h3><span className="assessment__question-number">Câu {index + 1}/{quiz.questions.length}</span>{question.prompt}</h3>
            {question.type === 'multipleChoice' ? (
              <MultipleChoiceAnswer
                name={`question-${question.questionId}`}
                options={question.options ?? []}
                selectedOptionId={session.drafts[question.questionId] ?? ''}
                disabled={submitting || Boolean(session.attempt) || Boolean(session.submittedAnswers)}
                onChange={(value) => void persist({ ...session, drafts: { ...session.drafts, [question.questionId]: value } })}
              />
            ) : (
              <ShortAnswerInput
                value={session.drafts[question.questionId] ?? ''}
                disabled={submitting || Boolean(session.attempt) || Boolean(session.submittedAnswers)}
                onChange={(value) => void persist({ ...session, drafts: { ...session.drafts, [question.questionId]: value } })}
              />
            )}
            {result ? (
              <div className={`assessment__feedback assessment__feedback--${result.outcome}`}>
                <strong>{result.outcome === 'correct' ? 'Chính xác' : result.outcome === 'partiallyCorrect' ? 'Đúng một phần' : 'Chưa chính xác'}</strong>
                <p>Đáp án tham khảo: {result.referenceAnswer}</p>
                <p>{result.explanation}</p>
                {result.outcome !== 'correct' && isValidEvidenceTarget(result.source.youtubeVideoId, result.source.startMs) ? (
                  <button type="button" className="secondary-button" onClick={() => onSeekEvidence?.(result.source)}>
                    Xem lại tại mốc {formatTimestamp(result.source.startMs)}
                  </button>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
      {failure ? <p className="health-error" role="alert">{failure.message}</p> : null}
      {session.attempt ? <p className="assessment__score" role="status">Điểm toàn bài: {session.attempt.score}</p> : failure && !failure.retryable && session.submittedAnswers ? (
        <button type="button" className="secondary-button" onClick={editAfterFailure}>Sửa câu trả lời</button>
      ) : (
        <button type="button" className="primary-button" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? 'Đang nộp bài…' : failure?.retryable ? 'Thử lại chấm bài' : 'Nộp toàn bộ bài'}
        </button>
      )}
    </section>
  );
}

function formatTimestamp(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
