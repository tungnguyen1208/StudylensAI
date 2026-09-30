import { requestSessionQuizThroughWorker } from './session-quiz-worker-bridge';
import type {
  CompleteStudySessionRequest,
  LearningPackage,
  RetryProcessingRequest,
  SessionSnapshot,
  StartStudySessionRequest,
  SubmitFullTranscriptRequest,
} from '../models/session-quiz-contracts';

/** The only Extension gateway for the SessionQuiz public API. */
export class SessionQuizApi {
  public startSession(request: StartStudySessionRequest): Promise<SessionSnapshot> {
    return requestSessionQuizThroughWorker<SessionSnapshot>('start', request);
  }

  public completeSession(sessionId: string, request: CompleteStudySessionRequest): Promise<SessionSnapshot> {
    return requestSessionQuizThroughWorker<SessionSnapshot>('complete', request, sessionId);
  }

  public submitTranscript(sessionId: string, request: SubmitFullTranscriptRequest): Promise<LearningPackage> {
    return requestSessionQuizThroughWorker<LearningPackage>('submitTranscript', request, sessionId);
  }

  public getLearningPackage(sessionId: string): Promise<LearningPackage> {
    return requestSessionQuizThroughWorker<LearningPackage>('getLearningPackage', {}, sessionId);
  }

  public retry(sessionId: string, request: RetryProcessingRequest): Promise<LearningPackage> {
    return requestSessionQuizThroughWorker<LearningPackage>('retry', request, sessionId);
  }
}
