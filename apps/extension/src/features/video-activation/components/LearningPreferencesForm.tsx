import { useEffect, useRef, useState } from 'react';
import type { LearningPreferences } from '../models/learning-preferences';

/** Quiz preferences are snapshotted when the next video session starts. */
export function LearningPreferencesForm({
  preferences,
  saving = false,
  error = null,
  onSave,
}: {
  preferences: LearningPreferences;
  saving?: boolean;
  error?: string | null;
  onSave: (preferences: LearningPreferences) => Promise<void>;
}) {
  const [draft, setDraft] = useState<LearningPreferences>(preferences);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => setDraft(preferences), [preferences]);

  const update = (next: LearningPreferences) => {
    setDraft(next);
    saveQueue.current = saveQueue.current.catch(() => undefined).then(() => onSave(next));
  };

  return (
    <div className="learning-preferences" aria-busy={saving}>
      <PreferenceSummary label="Dạng câu hỏi" value={draft.questionType === 'multipleChoice' ? 'Trắc nghiệm nhiều lựa chọn' : 'Trả lời ngắn'} />
      <fieldset disabled={saving}>
        <legend className="visually-hidden">Chọn dạng câu hỏi</legend>
        <div className="preference-options preference-options--two" role="group" aria-label="Dạng câu hỏi">
          <button type="button" className={draft.questionType === 'multipleChoice' ? 'preference-option preference-option--selected' : 'preference-option'} aria-pressed={draft.questionType === 'multipleChoice'} onClick={() => update({ ...draft, questionType: 'multipleChoice' })}>Trắc nghiệm</button>
          <button type="button" className={draft.questionType === 'shortAnswer' ? 'preference-option preference-option--selected' : 'preference-option'} aria-pressed={draft.questionType === 'shortAnswer'} onClick={() => update({ ...draft, questionType: 'shortAnswer' })}>Trả lời ngắn</button>
        </div>
      </fieldset>

      <PreferenceSummary label="Độ khó" value={difficultyLabel(draft.difficulty)} />
      <fieldset disabled={saving}>
        <legend className="visually-hidden">Chọn độ khó</legend>
        <div className="preference-options" role="group" aria-label="Độ khó">
          {(['easy', 'medium', 'hard'] as const).map((difficulty) => (
            <button key={difficulty} type="button" className={draft.difficulty === difficulty ? 'preference-option preference-option--selected' : 'preference-option'} aria-pressed={draft.difficulty === difficulty} onClick={() => update({ ...draft, difficulty })}>{difficultyLabel(difficulty)}</button>
          ))}
        </div>
      </fieldset>
      <p className="learning-preferences__hint">Tùy chọn áp dụng cho phiên video tiếp theo và được gửi cùng yêu cầu tạo quiz toàn video.</p>
      {saving ? <p className="learning-preferences__hint" role="status">Đang lưu tùy chọn…</p> : null}
      {error ? <p className="health-error" role="alert">Lỗi: {error}</p> : null}
    </div>
  );
}

function PreferenceSummary({ label, value }: { label: string; value: string }) {
  return <div className="preference-summary"><span>{label}</span><strong>{value}</strong></div>;
}

function difficultyLabel(value: LearningPreferences['difficulty']): string {
  return { easy: 'Dễ', medium: 'Trung bình', hard: 'Khó' }[value];
}
