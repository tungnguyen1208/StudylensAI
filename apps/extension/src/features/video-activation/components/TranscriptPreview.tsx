import { useEffect, useMemo, useRef } from 'react';
import type { TranscriptCaptureDetails } from '../models/video-activation.types';

export interface TranscriptPreviewProps {
  details: TranscriptCaptureDetails | null;
  loading: boolean;
  error: string | null;
  currentTimeMs: number | null;
  onRefresh: () => void;
  onSeek: (timestampMs: number) => void;
}

/** Read-only, time-synchronised subtitle view backed by persisted caption cues. */
export function TranscriptPreview({ details, loading, error, currentTimeMs, onRefresh, onSeek }: TranscriptPreviewProps) {
  const cues = details?.cues ?? [];
  const activeCueIndex = useMemo(() => findActiveCueIndex(cues, currentTimeMs), [cues, currentTimeMs]);
  const activeCueRef = useRef<HTMLLIElement | null>(null);
  const cueStatus = details ? `${cues.length} đoạn` : loading ? 'Đang tải' : null;

  useEffect(() => {
    activeCueRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeCueIndex]);

  return (
    <div className="transcript-preview">
      <div className="section-heading-row">
        <div>
          <h2 id="transcript-preview-heading" className="section-heading">Transcript</h2>
          <p className="section-copy">Subtitles có timestamp. Dòng tô sáng là nội dung đang phát.</p>
        </div>
        <div className="transcript-preview__actions">
          {cueStatus ? <span className="transcript-preview__status">{cueStatus}</span> : null}
          {error ? <button type="button" className="secondary-button" onClick={onRefresh} disabled={loading}>Thử lại</button> : null}
        </div>
      </div>

      {error ? <p className="health-error" role="alert">Không thể tải transcript: {error}</p> : null}
      {details ? (
        <>
          {cues.length > 0 ? (
            <ol className="transcript-preview__cues" aria-label="Transcript theo thời gian">
              {cues.map((cue, index) => {
                const isActive = index === activeCueIndex;
                return (
                <li
                  key={`${cue.startMs}-${cue.endMs}-${index}`}
                  ref={isActive ? activeCueRef : null}
                  className={isActive ? 'transcript-preview__cue transcript-preview__cue--active' : 'transcript-preview__cue'}
                  aria-current={isActive ? 'true' : undefined}
                >
                  <button
                    type="button"
                    className="transcript-preview__cue-button"
                    onClick={() => onSeek(cue.startMs)}
                    aria-label={`Tua video đến ${formatTimestamp(cue.startMs)}: ${cue.text}`}
                  >
                    <time dateTime={`PT${cue.startMs / 1000}S`}>{formatTimestamp(cue.startMs)}</time>
                    <span>{cue.text}</span>
                  </button>
                </li>
                );
              })}
            </ol>
          ) : (
            <p className="section-copy" role="status">Chưa có cue hợp lệ trong phụ đề YouTube.</p>
          )}
        </>
      ) : !loading ? (
        <p className="section-copy" role="status">Phụ đề sẽ xuất hiện ở đây sau khi Backend xác thực nội dung.</p>
      ) : null}
    </div>
  );
}

export function formatTimestamp(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function findActiveCueIndex(
  cues: ReadonlyArray<{ startMs: number; endMs: number }>,
  currentTimeMs: number | null,
): number {
  if (currentTimeMs === null) return -1;
  return cues.findIndex((cue, index) =>
    currentTimeMs >= cue.startMs && (currentTimeMs < cue.endMs || index === cues.length - 1),
  );
}
