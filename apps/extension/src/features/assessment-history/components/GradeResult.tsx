import type { GradeView } from '../types/assessment-types';

interface GradeResultProps {
  grade: GradeView;
}

const outcomeLabels: Record<GradeView['outcome'], string> = {
  correct: 'Chính xác',
  incorrect: 'Chưa chính xác',
  partiallyCorrect: 'Đúng một phần',
};

/** Renders a post-submit result only; it never receives a question answer key. */
export function GradeResult({ grade }: GradeResultProps) {
  return (
    <section aria-label="Kết quả chấm điểm" aria-live="polite">
      <h3>Kết quả: {outcomeLabels[grade.outcome]}</h3>
      <p>Điểm: {grade.score}</p>
      <p>Đáp án tham khảo: {grade.referenceAnswer}</p>
      <p>Giải thích: {grade.explanation}</p>
    </section>
  );
}
