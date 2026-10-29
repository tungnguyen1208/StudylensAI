import type { HttpClient } from '../../../shared/http/http-client';
import type { GradeView, HistoryEntryReadModel, LocalAnswerSubmission, QuizAttemptView, QuizAvailable } from '../types/assessment-types';

interface HistoryResponse { items: HistoryEntryReadModel[]; }

export class AssessmentHistoryApi {
  public constructor(private readonly client?: HttpClient) {}

  public async submitAnswer(quiz: QuizAvailable, submission: LocalAnswerSubmission, clientAttemptId: string): Promise<GradeView> {
    const body = {
      contractVersion: '0.7.0',
      clientAttemptId,
      questionId: submission.questionId,
      ...(submission.type === 'multipleChoice' ? { selectedOptionId: submission.selectedOptionId } : { answerText: submission.answerText }),
    };
    if (this.client) return this.client.post<GradeView>(`api/quizzes/${encodeURIComponent(quiz.quizId)}/answer`, body);
    return sendAssessmentRequest<GradeView>({ operation: 'submitAnswer', quizId: quiz.quizId, body });
  }

  public async submitAttempt(quiz: QuizAvailable, submissions: LocalAnswerSubmission[], clientAttemptId: string): Promise<QuizAttemptView> {
    const body = {
      contractVersion: '0.7.0',
      clientAttemptId,
      answers: submissions.map((submission) => ({
        questionId: submission.questionId,
        ...(submission.type === 'multipleChoice'
          ? { selectedOptionId: submission.selectedOptionId }
          : { answerText: submission.answerText }),
      })),
    };
    if (this.client) return this.client.post<QuizAttemptView>(`api/quizzes/${encodeURIComponent(quiz.quizId)}/attempts`, body);
    return sendAssessmentRequest<QuizAttemptView>({ operation: 'submitAttempt', quizId: quiz.quizId, body });
  }

  public async getHistory(youtubeVideoId?: string): Promise<HistoryEntryReadModel[]> {
    if (this.client) {
      const path = youtubeVideoId ? `api/history/videos/${encodeURIComponent(youtubeVideoId)}` : 'api/history';
      return (await this.client.get<HistoryResponse>(path)).items;
    }
    return (await sendAssessmentRequest<HistoryResponse>({ operation: 'getHistory', youtubeVideoId })).items;
  }
}

function sendAssessmentRequest<T>(request: { operation: 'submitAnswer' | 'submitAttempt' | 'getHistory'; quizId?: string; body?: unknown; youtubeVideoId?: string }): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return Promise.reject(new Error('extensionRuntimeUnavailable'));
  return chrome.runtime.sendMessage({ type: 'STUDYLENS_ASSESSMENT_REQUEST', ...request }) as Promise<T>;
}
