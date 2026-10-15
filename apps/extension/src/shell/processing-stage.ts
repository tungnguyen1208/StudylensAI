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
    return stage('inactive', 'StudyLens đang tắt', 'Bật lại trong Cài đặt để bắt đầu.', false);
  }
  if (!value) {
    return stage('sessionStart', 'Đang tạo phiên học', 'Đang tạo phiên học và thu thập transcript toàn video.', true);
  }
  if (value.transcript.status === 'generating') {
    return stage('transcriptAi', 'Đang gọi AI tạo transcript', 'AI Service đang tạo transcript dự phòng từ video công khai.', true);
  }
  if (value.transcript.status === 'validating') {
    return stage('transcriptValidation', 'Đang kiểm tra transcript', 'Backend đang xác thực timestamp và nội dung transcript.', true);
  }
  if (value.transcript.status === 'unavailable') {
    return stage('transcriptUnavailable', 'Transcript không khả dụng', 'Không thể tạo quiz khi chưa có transcript đủ bằng chứng.', false);
  }
  if (value.transcript.status === 'failed') {
    return stage('transcriptFailed', 'Tạo transcript thất bại', 'Có thể thử lại đúng bước mà không tạo phiên trùng.', false);
  }
  if (value.quizStatus === 'queued') {
    return stage('quizQueued', 'Đang chờ job tạo quiz', 'Transcript đã xác thực; yêu cầu đang chờ Backend xử lý.', true);
  }
  if (value.quizStatus === 'generating') {
    return stage('quizAi', 'Đang gọi AI tạo quiz', 'AI Service đang tạo và Backend sẽ kiểm tra kết quả.', true);
  }
  if (value.quizStatus === 'failed') {
    return stage('quizFailed', 'Tạo quiz thất bại', 'Có thể thử lại đúng bước mà không tạo quiz trùng.', false);
  }
  if (value.quizStatus === 'ready') {
    return stage('ready', 'Quiz đã sẵn sàng', 'Quiz toàn video đã được kiểm tra và lưu.', false);
  }
  return stage('transcriptWaiting', 'Đang chờ transcript', 'Extension đang lấy phụ đề toàn video.', true);
}

export function formatElapsedWait(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  if (totalSeconds < 60) return `Đã chờ ${totalSeconds} giây`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `Đã chờ ${minutes} phút ${seconds.toString().padStart(2, '0')} giây`;
}

function stage(code: string, label: string, summary: string, waiting: boolean): ProcessingStageView {
  return { code, label, summary, waiting };
}
