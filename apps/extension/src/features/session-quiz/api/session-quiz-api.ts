import { requestSessionQuizThroughWorker } from './session-quiz-worker-bridge';
import type {
  CompleteStudySessionRequest,
  CreateStudySegmentRequest,
  GenerateQuizRequest,
  QuizPublic,
  SessionSnapshot,
  StartStudySessionRequest,
  StudySegmentRef,
} from '../models/session-quiz-contracts';

/** The only Extension gateway for the SessionQuiz public API. */
export class SessionQuizApi {
  public startSession(request: StartStudySessionRequest): Promise<SessionSnapshot> {
    return requestSessionQuizThroughWorker<SessionSnapshot>('start', request);
  }

  public completeSession(sessionId: string, request: CompleteStudySessionRequest): Promise<SessionSnapshot> {
    return requestSessionQuizThroughWorker<SessionSnapshot>('complete', request, sessionId);
  }

  public createSegment(sessionId: string, request: CreateStudySegmentRequest): Promise<StudySegmentRef> {
    return requestSessionQuizThroughWorker<StudySegmentRef>('createSegment', request, sessionId);
  }

  public generateQuiz(request: GenerateQuizRequest): Promise<QuizPublic> {
    return requestSessionQuizThroughWorker<QuizPublic>('generateQuiz', request);
  }
}
