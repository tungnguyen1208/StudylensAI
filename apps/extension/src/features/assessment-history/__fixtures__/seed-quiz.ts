import type { QuizAvailable } from '../types/assessment-types';

/** Deterministic public fixture for C02; intentionally has no answer keys or rubrics. */
export const seedQuiz: QuizAvailable = {
  quizId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  segmentId: '33333333-3333-4333-8333-333333333333',
  createdAtUtc: '2026-09-13T09:00:00Z',
  questions: [
    {
      questionId: '44444444-4444-4444-8444-444444444444',
      type: 'multipleChoice',
      prompt: 'Trong mô hình TCP/IP, giao thức nào chịu trách nhiệm định tuyến gói tin?',
      options: [
        { optionId: 'option-a', text: 'HTTP' },
        { optionId: 'option-b', text: 'IP' },
        { optionId: 'option-c', text: 'HTML' },
      ],
      source: { youtubeVideoId: 'dQw4w9WgXcQ', startMs: 300000, endMs: 360000 },
    },
    {
      questionId: '55555555-5555-4555-8555-555555555555',
      type: 'shortAnswer',
      prompt: 'Nêu ngắn gọn vai trò của địa chỉ IP.',
      source: { youtubeVideoId: 'dQw4w9WgXcQ', startMs: 360000, endMs: 420000 },
    },
  ],
};
