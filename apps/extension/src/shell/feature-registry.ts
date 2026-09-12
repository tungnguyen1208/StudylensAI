import {
  registerVideoActivationFeature,
  VideoActivationFeatureMetadata,
} from '../features/video-activation';
import {
  registerSessionQuizFeature,
  SessionQuizFeatureMetadata,
} from '../features/session-quiz';
import {
  registerAssessmentHistoryFeature,
  AssessmentHistoryFeatureMetadata,
} from '../features/assessment-history';

export interface RegisteredFeatures {
  videoActivation: VideoActivationFeatureMetadata;
  sessionQuiz: SessionQuizFeatureMetadata;
  assessmentHistory: AssessmentHistoryFeatureMetadata;
}

export function initializeFeatureRegistry(): RegisteredFeatures {
  return {
    videoActivation: registerVideoActivationFeature(),
    sessionQuiz: registerSessionQuizFeature(),
    assessmentHistory: registerAssessmentHistoryFeature(),
  };
}
