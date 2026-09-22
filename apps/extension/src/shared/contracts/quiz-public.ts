/**
 * Public Dev 2 -> Dev 3 quiz projection.
 * Answer keys, rubrics, and private grading data must never be added here.
 */
import type { QuestionType } from './activation-handoff';

export type { QuestionType } from './activation-handoff';

export interface QuestionSourceRef {
  youtubeVideoId: string;
  startMs: number;
  endMs: number;
}

export interface QuestionOptionPublic {
  optionId: string;
  text: string;
}

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

export interface QuizPublic extends QuizAvailable {
  status: 'available';
}
