import type { HistoryEntryReadModel } from '../types/assessment-types';

interface HistoryPageProps {
  entries: HistoryEntryReadModel[];
}

/** Groups persisted, submitted answers by their YouTube video and learning session. */
export function HistoryPage({ entries }: HistoryPageProps) {
  if (entries.length === 0) return <p role="status">Chưa có lịch sử trả lời.</p>;

  const byVideo = groupBy(entries, (entry) => entry.youtubeVideoId);
  return (
    <section className="history-list" aria-label="Lịch sử trả lời">
      <h3>Lịch sử trả lời</h3>
      {Array.from(byVideo, ([videoId, videoEntries]) => {
        const video = videoEntries[0];
        const watchUrl = /^[A-Za-z0-9_-]{11}$/.test(videoId)
          ? `https://www.youtube.com/watch?v=${videoId}` : null;
        const sessions = groupBy(videoEntries, (entry) => entry.sessionId);
        return (
          <article className="history-video" key={videoId}>
            <header className="history-video__header">
              <h4>{watchUrl
                ? <a href={watchUrl} target="_blank" rel="noopener noreferrer">{video.videoTitle || `Video ${videoId}`}</a>
                : video.videoTitle || `Video ${videoId}`}</h4>
              <span>{sessions.size} phiên học</span>
            </header>
            {Array.from(sessions, ([sessionId, sessionEntries]) => {
              const attempts = groupBy(sessionEntries, (entry) => entry.quizAttemptId || entry.answerAttemptId);
              return (
                <section className="history-session" key={sessionId} aria-label={`Phiên học ${sessionId}`}>
                  <strong>Phiên học {sessionId.slice(0, 8)} · {attempts.size} lần trả lời</strong>
                  {Array.from(attempts, ([attemptId, attemptEntries]) => {
                    const latest = attemptEntries[0];
                    const score = latest.attemptScore ??
                      attemptEntries.reduce((total, entry) => total + entry.score, 0) / attemptEntries.length;
                    return (
                      <div className="history-attempt" key={attemptId}>
                        <div className="history-session__summary">
                          <strong>{new Date(latest.submittedAtUtc).toLocaleString('vi-VN')}</strong>
                          <span>Điểm: {Math.round(score * 100)}%</span>
                        </div>
                        <ol>
                          {attemptEntries.map((entry) => (
                            <li key={entry.answerAttemptId}>
                              <strong>{entry.questionPrompt}</strong>
                              <p>Câu trả lời: {entry.submittedAnswer}</p>
                              <p>Kết quả: {entry.outcome} · Điểm: {entry.score}</p>
                            </li>
                          ))}
                        </ol>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </article>
        );
      })}
    </section>
  );
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}
