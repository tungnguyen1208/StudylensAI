import type { LearningPackage } from '../features/session-quiz/models/session-quiz-contracts';
import type { ActivationState } from '../features/video-activation';

export interface ProcessingStageView {
  code: string;
  label: string;
  summary: string;
  waiting: boolean;
}

export function resolveProcessingStage(
  state: ActivationState,
  value: LearningPackage | null,
): ProcessingStageView {
  if (!state.context) {
    return stage('noVideo', 'Chưa có video', 'Chưa mở video YouTube hợp lệ.', false);
  }
  if (state.status !== 'active') {
    return stage('inactive', 'StudyLens đang tắt', '', false);
  }
  if (!value) {
    return stage('sessionStart', 'Đang chuẩn bị bài học', 'Đang lấy nội dung video.', true);
  }
  if (value.transcript.status === 'generating') {
    return stage('transcriptAi', 'Đang xử lý nội dung video', 'Video chưa có đủ phụ đề; StudyLens đang bổ sung nội dung.', true);
  }
  if (value.transcript.status === 'validating') {
    return stage('transcriptValidation', 'Đang kiểm tra nội dung', 'Đang chuẩn bị nội dung để tạo câu hỏi.', true);
  }
  if (value.transcript.status === 'unavailable') {
    return stage('transcriptUnavailable', 'Transcript không khả dụng', 'Không thể tạo quiz khi chưa có transcript đủ bằng chứng.', false);
  }
  if (value.transcript.status === 'failed') {
    return stage('transcriptFailed', 'Không thể xử lý nội dung video', 'Vui lòng thử lại.', false);
  }
  if (value.quizStatus === 'queued') {
    return stage('quizQueued', 'Đang chuẩn bị câu hỏi', 'Bài kiểm tra sẽ sớm sẵn sàng.', true);
  }
  if (value.quizStatus === 'generating') {
    return stage('quizAi', 'Đang tạo câu hỏi', 'StudyLens đang tạo bài kiểm tra từ nội dung video.', true);
  }
  if (value.quizStatus === 'failed') {
    return stage('quizFailed', 'Không thể tạo bài kiểm tra', 'Vui lòng thử lại.', false);
  }
  if (value.quizStatus === 'ready') {
    return stage('ready', 'Bài kiểm tra đã sẵn sàng', '', false);
  }
  return stage('transcriptWaiting', 'Đang lấy nội dung video', 'StudyLens đang chuẩn bị bài kiểm tra.', true);
}

function stage(code: string, label: string, summary: string, waiting: boolean): ProcessingStageView {
  return { code, label, summary, waiting };
}
