import { HistoryPage } from './HistoryPage';
import type { HistoryLoadState } from '../state/history-load-state';

interface HistoryLoadPanelProps {
  state: HistoryLoadState;
  onRetry: () => void;
  onReviewEvidence?: (youtubeVideoId: string, timestampMs: number) => void;
}

export function HistoryLoadPanel({ state, onRetry, onReviewEvidence }: HistoryLoadPanelProps) {
  if (state.status === 'loading' && state.entries.length === 0) {
    return <p className="section-copy" role="status">Đang tải lịch sử học tập…</p>;
  }

  if (state.status === 'error') {
    return (
      <div className="history-load-error" role="alert">
        <p className="health-error">{state.error ?? 'Không thể tải lịch sử học tập.'}</p>
        <button type="button" className="secondary-button" onClick={onRetry}>Thử tải lại</button>
      </div>
    );
  }

  return <HistoryPage entries={state.entries} onReviewEvidence={onReviewEvidence} />;
}
