import type { ActivationState } from '../models/activation.types';

export function ActivationStatus({ state }: { state: ActivationState }) {
  const transcriptStatus = state.transcriptCapture?.status ?? 'pending';

  const activationLabel = state.status === 'active' ? 'đang bật' : 'đang tắt';
  const transcriptLabel = {
    available: 'sẵn sàng',
    unavailable: 'không có',
    insufficient: 'chưa đủ nội dung',
    pending: 'đang chờ',
  }[transcriptStatus] ?? transcriptStatus;

  return (
    <p className="activation-status" role="status">
      <span>StudyLens: <strong>{activationLabel}</strong></span>
      <span aria-hidden="true">·</span>
      <span>Transcript: <strong>{transcriptLabel}</strong></span>
      {state.errorCode ? <span className="activation-status__error">Lỗi: {state.errorCode}</span> : null}
      {transcriptStatus === 'pending' ? (
        <span className="activation-status__hint">
          StudyLens đang chờ âm thanh tab để tạo transcript. Nhấn Bắt đầu thu âm tab để cấp quyền.
        </span>
      ) : null}
    </p>
  );
}
