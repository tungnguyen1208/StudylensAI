import { describe, expect, it } from 'vitest';
import type { LearningPackage } from '../../features/session-quiz/models/session-quiz-contracts';
import { initialActivationState, type ActivationState } from '../../features/video-activation';
import { formatElapsedWait, resolveProcessingStage } from '../processing-stage';

const activeState: ActivationState = {
  ...initialActivationState,
  status: 'active',
  context: { tabId: 7, youtubeVideoId: 'dQw4w9WgXcQ', title: 'Test video' },
};

function learningPackage(
  transcriptStatus: LearningPackage['transcript']['status'],
  quizStatus: LearningPackage['quizStatus'],
): LearningPackage {
  return {
    session: {
      sessionId: 'session-1', youtubeVideoId: 'dQw4w9WgXcQ', videoTitle: 'Test video', status: 'active',
      preferences: { questionType: 'multipleChoice', difficulty: 'medium' }, startedAtUtc: '2026-10-14T00:00:00Z',
    },
    transcript: { status: transcriptStatus, cueCount: 0, cues: [] },
    quizStatus,
  };
}

describe('processing stage presentation', () => {
  it('describes the real queued and AI-call stages instead of a synthetic percentage', () => {
    expect(resolveProcessingStage(activeState, learningPackage('ready', 'queued')).label)
      .toBe('Đang chờ job tạo quiz');
    expect(resolveProcessingStage(activeState, learningPackage('ready', 'generating')).label)
      .toBe('Đang gọi AI tạo quiz');
  });

  it('does not present failed or ready states as waiting', () => {
    expect(resolveProcessingStage(activeState, learningPackage('ready', 'failed')).waiting).toBe(false);
    expect(resolveProcessingStage(activeState, learningPackage('ready', 'ready')).waiting).toBe(false);
  });

  it('formats elapsed time for seconds and minutes', () => {
    expect(formatElapsedWait(9_999)).toBe('Đã chờ 9 giây');
    expect(formatElapsedWait(65_000)).toBe('Đã chờ 1 phút 05 giây');
  });
});
