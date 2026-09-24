/**
 * Assessment, Grading & History Feature Entry Point — Dev 3
 *
 * Scope: Answer submission UI, deterministic fake-AI grading via Backend,
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
    version: '0.4.0',
    owner: 'Dev 3',
  };
}

export { AnswerForm } from './components/AnswerForm';
export { AssessmentPanel } from './components/AssessmentPanel';
export { AssessmentHistoryApi } from './api/assessment-history-api';
export { GradeResult } from './components/GradeResult';
export { HistoryPage } from './components/HistoryPage';
export { MultipleChoiceAnswer } from './components/MultipleChoiceAnswer';
export { ShortAnswerInput } from './components/ShortAnswerInput';
export {
  ASSESSMENT_HISTORY_CONTRACT_VERSION,
  type AnswerDraft,
  type GradeOutcome,
  type GradeView,
  type HistoryEntryReadModel,
  type LocalAnswerSubmission,
  type QuestionOptionPublic,
  type QuestionPublic,
  type QuestionSourceRef,
  type QuestionType,
  type QuizAvailable,
} from './types/assessment-types';
