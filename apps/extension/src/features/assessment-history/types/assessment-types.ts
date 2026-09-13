/** Public quiz data consumed from Dev 2's SessionQuiz contract (v0.1.0). */
export const ASSESSMENT_HISTORY_CONTRACT_VERSION = '0.1.0' as const;

export type QuestionType = 'multipleChoice' | 'shortAnswer';

export interface QuestionSourceRef {
  youtubeVideoId: string;
  startMs: number;
  endMs: number;
}

export interface QuestionOptionPublic {
  optionId: string;
  text: string;
}

/** Deliberately excludes answer keys, reference answers, and grading rubrics. */
export interface QuestionPublic {
  questionId: string;
  type: QuestionType;
  prompt: string;
  options?: QuestionOptionPublic[];
  source: QuestionSourceRef;
}

export interface QuizAvailable {
  quizId: string;
  sessionId: string;
  segmentId: string;
  questions: QuestionPublic[];
  createdAtUtc: string;
}

export type LocalAnswerSubmission =
  | { questionId: string; type: 'multipleChoice'; selectedOptionId: string }
  | { questionId: string; type: 'shortAnswer'; answerText: string };

export type AnswerDraft =
  | { type: 'multipleChoice'; selectedOptionId: string }
  | { type: 'shortAnswer'; answerText: string };
