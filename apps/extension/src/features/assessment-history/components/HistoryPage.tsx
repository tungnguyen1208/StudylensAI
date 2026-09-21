import type { HistoryEntryReadModel } from '../types/assessment-types';

interface HistoryPageProps {
  entries: HistoryEntryReadModel[];
}

/** Renders persistent answer history returned by the Backend API. */
export function HistoryPage({ entries }: HistoryPageProps) {
  if (entries.length === 0) {
    return <p role="status">Chưa có lịch sử trả lời.</p>;
  }

  return (
    <section aria-label="Lịch sử trả lời">
      <h3>Lịch sử trả lời</h3>
      <ol>
        {entries.map((entry) => (
          <li key={entry.answerAttemptId}>
            <p>{entry.questionPrompt}</p>
            <p>Kết quả: {entry.outcome} — Điểm: {entry.score}</p>
            <p>Câu trả lời: {entry.submittedAnswer}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
