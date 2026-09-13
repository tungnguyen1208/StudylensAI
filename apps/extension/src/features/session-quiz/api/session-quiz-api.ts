import { httpClient } from '../../../shared/http/http-client';
import type { GenerateQuizRequest, QuizPublic, SessionSnapshot, StartStudySessionRequest } from '../models/session-quiz-contracts';

/** The only Extension gateway for the SessionQuiz public API. */
export class SessionQuizApi {
  public startSession(request: StartStudySessionRequest): Promise<SessionSnapshot> {
    return httpClient.post<SessionSnapshot>('api/sessions', request);
  }

  public generateQuiz(request: GenerateQuizRequest): Promise<QuizPublic> {
    return httpClient.post<QuizPublic>('api/quizzes/generate', request);
  }
}
