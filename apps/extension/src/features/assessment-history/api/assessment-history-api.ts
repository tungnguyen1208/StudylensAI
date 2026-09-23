import { httpClient, type HttpClient } from '../../../shared/http/http-client';
import type { GradeView, HistoryEntryReadModel, LocalAnswerSubmission, QuizAvailable } from '../types/assessment-types';

interface HistoryResponse { items: HistoryEntryReadModel[]; }

export class AssessmentHistoryApi {
  public constructor(private readonly client: HttpClient = httpClient) {}

  public async submitAnswer(quiz: QuizAvailable, submission: LocalAnswerSubmission, clientAttemptId: string): Promise<GradeView> {
    return this.client.post<GradeView>(`api/quizzes/${encodeURIComponent(quiz.quizId)}/answer`, {
      contractVersion: '0.3.0',
      clientAttemptId,
      questionId: submission.questionId,
      ...(submission.type === 'multipleChoice' ? { selectedOptionId: submission.selectedOptionId } : { answerText: submission.answerText }),
    });
  }

  public async getHistory(youtubeVideoId?: string): Promise<HistoryEntryReadModel[]> {
    const path = youtubeVideoId
      ? `api/history/videos/${encodeURIComponent(youtubeVideoId)}`
      : 'api/history';
    return (await this.client.get<HistoryResponse>(path)).items;
  }
}
