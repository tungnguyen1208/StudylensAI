import type { QuestionSourceRef, QuestionType } from '../../../shared/contracts';

/** Public quiz data consumed from Dev 2's SessionQuiz contract (v0.2.0). */
export const ASSESSMENT_HISTORY_CONTRACT_VERSION = '0.2.0' as const;

export type {
  QuestionOptionPublic,
  QuestionPublic,
  QuestionSourceRef,
  QuestionType,
  QuizAvailable,
} from '../../../shared/contracts';

export type LocalAnswerSubmission =
  | { questionId: string; type: 'multipleChoice'; selectedOptionId: string }
  | { questionId: string; type: 'shortAnswer'; answerText: string };

export type AnswerDraft =
  | { type: 'multipleChoice'; selectedOptionId: string }
  | { type: 'shortAnswer'; answerText: string };

/** Available only after a learner has submitted an answer. */
export type GradeOutcome = 'correct' | 'incorrect' | 'partiallyCorrect';

export interface GradeView {
  answerAttemptId: string;
  questionId: string;
  outcome: GradeOutcome;
  score: number;
  referenceAnswer: string;
  explanation: string;
  source: QuestionSourceRef;
  gradedAtUtc: string;
}

/** Persistent Backend read model. It deliberately never includes private grading material. */
export interface HistoryEntryReadModel {
  answerAttemptId: string;
  youtubeVideoId: string;
  sessionId: string;
  questionId: string;
  questionPrompt: string;
  questionType: QuestionType;
  submittedAnswer: string;
  outcome: GradeOutcome;
  score: number;
  explanation: string;
  timestampMs: number;
  submittedAtUtc: string;
}
