import { httpClient } from '../../../shared/http/http-client';
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
    return httpClient.post<SessionSnapshot>('api/sessions', request);
  }

  public completeSession(sessionId: string, request: CompleteStudySessionRequest): Promise<SessionSnapshot> {
    return httpClient.post<SessionSnapshot>(`api/sessions/${encodeURIComponent(sessionId)}/complete`, request);
  }

  public createSegment(sessionId: string, request: CreateStudySegmentRequest): Promise<StudySegmentRef> {
    return httpClient.post<StudySegmentRef>(`api/sessions/${encodeURIComponent(sessionId)}/segments`, request);
  }

  public generateQuiz(request: GenerateQuizRequest): Promise<QuizPublic> {
    return httpClient.post<QuizPublic>('api/quizzes/generate', request);
  }
}
