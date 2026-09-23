import type { TranscriptCaptureDetails } from '../models/video-activation.types';

export interface TranscriptPreviewProps {
  details: TranscriptCaptureDetails | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

/** Read-only demo view of normalized STT cues persisted by the Backend. */
export function TranscriptPreview({ details, loading, error, onRefresh }: TranscriptPreviewProps) {
  const cues = details?.cues ?? [];

  return (
    <div className="transcript-preview">
      <div className="section-heading-row">
        <div>
          <h2 id="transcript-preview-heading" className="section-heading">Transcript đang thu</h2>
          <p className="section-copy">Dữ liệu STT đã chuẩn hóa từ Backend, dùng để đối chiếu với âm thanh video.</p>
        </div>
        <button type="button" className="secondary-button" onClick={onRefresh} disabled={loading}>
          {loading ? 'Đang tải...' : 'Làm mới'}
        </button>
      </div>

      {error ? <p className="health-error" role="alert">Không thể tải transcript: {error}</p> : null}
      {details ? (
        <>
          <dl className="transcript-preview__meta">
            <div><dt>Ngôn ngữ</dt><dd>{details.capture.language}</dd></div>
            <div><dt>Cue đã ghi</dt><dd>{details.cues.length}</dd></div>
            <div><dt>Phiên bản</dt><dd>{details.capture.version}</dd></div>
          </dl>
          {cues.length > 0 ? (
            <ol className="transcript-preview__cues" aria-label="Các câu transcript mới nhất">
              {cues.slice(-20).map((cue, index) => (
                <li key={`${cue.startMs}-${cue.endMs}-${index}`}>
                  <time dateTime={`PT${cue.startMs / 1000}S`}>{formatTimestamp(cue.startMs)} – {formatTimestamp(cue.endMs)}</time>
                  <span>{cue.text}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="section-copy" role="status">Chưa có cue hợp lệ. Hãy để video phát hết một chunk 30 giây rồi làm mới.</p>
          )}
        </>
      ) : !loading ? (
        <p className="section-copy" role="status">Transcript sẽ xuất hiện ở đây sau khi Backend nhận cue STT đầu tiên.</p>
      ) : null}
    </div>
  );
}

export function formatTimestamp(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
