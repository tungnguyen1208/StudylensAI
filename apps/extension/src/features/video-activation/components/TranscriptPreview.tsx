import { useEffect, useMemo, useRef } from 'react';
import type { TranscriptCaptureDetails } from '../models/video-activation.types';

export interface TranscriptPreviewProps {
  details: TranscriptCaptureDetails | null;
  loading: boolean;
  error: string | null;
  currentTimeMs: number | null;
  onRefresh: () => void;
}

/** Read-only, time-synchronised subtitle view backed by persisted caption cues. */
export function TranscriptPreview({ details, loading, error, currentTimeMs, onRefresh }: TranscriptPreviewProps) {
  const cues = details?.cues ?? [];
  const activeCueIndex = useMemo(() => findActiveCueIndex(cues, currentTimeMs), [cues, currentTimeMs]);
  const activeCueRef = useRef<HTMLLIElement | null>(null);

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
        <button type="button" className="secondary-button" onClick={onRefresh} disabled={loading}>
          {loading ? 'Đang tải...' : 'Làm mới'}
        </button>
      </div>

      {error ? <p className="health-error" role="alert">Không thể tải transcript: {error}</p> : null}
      {details ? (
        <>
          <dl className="transcript-preview__meta">
            <div><dt>Ngôn ngữ</dt><dd>{details.capture.language}</dd></div>
            <div><dt>Video ID</dt><dd>{details.capture.youtubeVideoId}</dd></div>
            <div><dt>Cue đã ghi</dt><dd>{details.cues.length}</dd></div>
            <div><dt>Phiên bản</dt><dd>{details.capture.version}</dd></div>
          </dl>
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
                  <time dateTime={`PT${cue.startMs / 1000}S`}>{formatTimestamp(cue.startMs)}</time>
                  <span>{cue.text}</span>
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
