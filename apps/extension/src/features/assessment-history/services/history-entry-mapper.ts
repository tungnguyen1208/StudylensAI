import type {
  GradeView,
  HistoryEntryReadModel,
  LocalAnswerSubmission,
  QuestionPublic,
  QuizAvailable,
} from '../types/assessment-types';

export function createHistoryEntry(
  quiz: QuizAvailable,
  question: QuestionPublic,
  submission: LocalAnswerSubmission,
  grade: GradeView,
  submittedAtUtc: string,
): HistoryEntryReadModel {
  const selectedOption = submission.type === 'multipleChoice'
    ? question.options?.find((option) => option.optionId === submission.selectedOptionId)?.text ?? submission.selectedOptionId
    : submission.answerText;

  return {
    answerAttemptId: grade.answerAttemptId,
    youtubeVideoId: question.source.youtubeVideoId,
    sessionId: quiz.sessionId,
    questionId: question.questionId,
    questionPrompt: question.prompt,
    questionType: question.type,
    submittedAnswer: selectedOption,
    outcome: grade.outcome,
    score: grade.score,
    explanation: grade.explanation,
    timestampMs: grade.source.startMs,
    submittedAtUtc,
  };
}
