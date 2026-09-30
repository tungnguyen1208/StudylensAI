import type { ActivationState } from '../models/activation.types';

/** Session-specific transcript status is rendered from the learning package. */
export function ActivationStatus({ state }: { state: ActivationState }) {
  const activationLabel = state.status === 'active' ? 'đang bật' : 'đang tắt';
  return (
    <p className="activation-status" role="status">
      <span>StudyLens: <strong>{activationLabel}</strong></span>
      <span aria-hidden="true">·</span>
      <span>Transcript: <strong>đang chờ xử lý</strong></span>
      {state.errorCode ? <span className="activation-status__error">Lỗi: {state.errorCode}</span> : null}
      {state.status === 'active' ? (
        <span className="activation-status__hint">StudyLens đang tạo phiên và xử lý phụ đề YouTube.</span>
      ) : null}
    </p>
  );
}
