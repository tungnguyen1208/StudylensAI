import type { GradeView, HistoryEntryReadModel, LocalAnswerSubmission, QuestionPublic, QuizAvailable } from '../types/assessment-types';

/**
 * Test-only fake grading workflow. It is deliberately not exported from the feature entry point
 * or used by extension runtime code, so answer keys never reach the public quiz payload.
 */
export class FakeAssessmentWorkflow {
  private readonly entries: HistoryEntryReadModel[] = [];

  public async submit(quiz: QuizAvailable, question: QuestionPublic, submission: LocalAnswerSubmission): Promise<GradeView> {
    const grade = this.grade(question, submission);
    this.entries.unshift({
      answerAttemptId: grade.answerAttemptId,
      youtubeVideoId: question.source.youtubeVideoId,
      sessionId: quiz.sessionId,
      questionId: question.questionId,
      questionPrompt: question.prompt,
      questionType: question.type,
      submittedAnswer: submission.type === 'multipleChoice'
        ? question.options?.find((option) => option.optionId === submission.selectedOptionId)?.text ?? submission.selectedOptionId
        : submission.answerText,
      outcome: grade.outcome,
      score: grade.score,
      explanation: grade.explanation,
      timestampMs: question.source.startMs,
      submittedAtUtc: grade.gradedAtUtc,
    });
    return grade;
  }

  public getHistory(): readonly HistoryEntryReadModel[] {
    return this.entries;
  }

  private grade(question: QuestionPublic, submission: LocalAnswerSubmission): GradeView {
    const isMcqCorrect = submission.type === 'multipleChoice' && submission.selectedOptionId === 'option-b';
    const isShortAnswerRelevant = submission.type === 'shortAnswer' && /định danh|xác định|thiết bị/i.test(submission.answerText);
    const correct = isMcqCorrect || isShortAnswerRelevant;
    const partial = submission.type === 'shortAnswer' && !correct && submission.answerText.length >= 8;
    const outcome = correct ? 'correct' : partial ? 'partiallyCorrect' : 'incorrect';

    return {
      answerAttemptId: `fixture-${question.questionId}`,
      questionId: question.questionId,
      outcome,
      score: correct ? 1 : partial ? 0.5 : 0,
      referenceAnswer: question.type === 'multipleChoice' ? 'IP' : 'Địa chỉ IP định danh thiết bị hoặc giao diện mạng để định tuyến dữ liệu.',
      explanation: correct ? 'Câu trả lời phù hợp với nội dung quiz fixture.' : 'Hãy đối chiếu lại nội dung đã học trong đoạn video.',
      source: question.source,
      gradedAtUtc: '2026-09-17T09:00:00Z',
    };
  }
}
