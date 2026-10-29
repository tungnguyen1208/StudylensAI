import { useEffect, useMemo, useRef } from 'react';

export interface TranscriptPreviewDetails {
  cues: ReadonlyArray<{ startMs: number; endMs: number; text: string }>;
}

export interface TranscriptPreviewProps {
  details: TranscriptPreviewDetails | null;
  currentTimeMs: number | null;
  statusText: string;
  onSeek: (timestampMs: number) => void;
}

/** Read-only, time-synchronised subtitle view from the active video/session. */
export function TranscriptPreview({ details, currentTimeMs, statusText, onSeek }: TranscriptPreviewProps) {
  const cues = details?.cues ?? [];
  const activeCueIndex = useMemo(() => findActiveCueIndex(cues, currentTimeMs), [cues, currentTimeMs]);
  const activeCueRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    activeCueRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeCueIndex]);

  return (
    <div className="transcript-preview">
      <div className="section-heading-row">
        <h2 id="transcript-preview-heading" className="section-heading">Transcript</h2>
        {cues.length > 0 ? <span className="transcript-preview__status">{cues.length} đoạn</span> : null}
      </div>
      <p className="section-copy" role="status">{statusText}</p>
      {cues.length > 0 ? <ol className="transcript-preview__cues" aria-label="Transcript theo thời gian">
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
      </ol> : null}
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
