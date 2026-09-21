import { useEffect, useState, type FormEvent } from 'react';
import type { LearningPreferences } from '../models/learning-preferences';

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

  useEffect(() => {
    setDraft(preferences);
  }, [preferences]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSave(draft);
  };

  return (
    <form className="learning-preferences" onSubmit={submit}>
      <label>
        Chu kỳ tạo quiz
        <select
          value={draft.quizIntervalMinutes}
          onChange={(event) => setDraft((value) => ({ ...value, quizIntervalMinutes: Number(event.target.value) as LearningPreferences['quizIntervalMinutes'] }))}
        >
          <option value={5}>5 phút</option>
          <option value={10}>10 phút</option>
          <option value={15}>15 phút</option>
        </select>
      </label>
      <label>
        Dạng câu hỏi
        <select
          value={draft.questionType}
          onChange={(event) => setDraft((value) => ({ ...value, questionType: event.target.value as LearningPreferences['questionType'] }))}
        >
          <option value="multipleChoice">Trắc nghiệm</option>
          <option value="shortAnswer">Trả lời ngắn</option>
          <option value="trueFalse">Ngẫu nhiên</option>
        </select>
      </label>
      <label>
        Độ khó
        <select
          value={draft.difficulty}
          onChange={(event) => setDraft((value) => ({ ...value, difficulty: event.target.value as LearningPreferences['difficulty'] }))}
        >
          <option value="easy">Dễ</option>
          <option value="medium">Trung bình</option>
          <option value="hard">Khó</option>
        </select>
      </label>
      <p className="learning-preferences__hint">Thay đổi chỉ áp dụng cho lần bật StudyLens hoặc video kế tiếp.</p>
      {error && <p className="health-error" role="alert">Lỗi: {error}</p>}
      <button type="submit" className="secondary-button" disabled={saving}>
        {saving ? 'Đang lưu...' : 'Lưu tùy chọn'}
      </button>
    </form>
  );
}
