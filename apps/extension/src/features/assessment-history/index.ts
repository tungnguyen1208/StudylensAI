/**
 * Assessment, Grading & History Feature Entry Point — Dev 3
 *
 * Scope: Answer submission UI, deterministic & AI grading via Backend,
 * explanation and timestamp review, seek dispatch, and learning history.
 */

export interface AssessmentHistoryFeatureMetadata {
  name: string;
  version: string;
  owner: string;
}

export function registerAssessmentHistoryFeature(): AssessmentHistoryFeatureMetadata {
  return {
    name: 'assessment-history',
    version: '0.1.0',
    owner: 'Dev 3',
  };
}

export { AnswerForm } from './components/AnswerForm';
export { MultipleChoiceAnswer } from './components/MultipleChoiceAnswer';
export { ShortAnswerInput } from './components/ShortAnswerInput';
export { seedQuiz } from './__fixtures__/seed-quiz';
export {
  ASSESSMENT_HISTORY_CONTRACT_VERSION,
  type AnswerDraft,
  type LocalAnswerSubmission,
  type QuestionOptionPublic,
  type QuestionPublic,
  type QuestionSourceRef,
  type QuestionType,
  type QuizAvailable,
} from './types/assessment-types';
