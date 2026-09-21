export const LEARNING_PREFERENCES_STORAGE_KEY = 'studylensLearningPreferences';

export interface LearningPreferences {
  quizIntervalMinutes: 5 | 10 | 15;
  questionType: 'multipleChoice' | 'shortAnswer';
  difficulty: 'easy' | 'medium' | 'hard';
}

export const DEFAULT_LEARNING_PREFERENCES: LearningPreferences = {
  quizIntervalMinutes: 10,
  questionType: 'multipleChoice',
  difficulty: 'medium',
};

export interface LocalStoragePort {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

export class LearningPreferencesValidationError extends Error {
  public constructor() {
    super('Learning preferences are invalid.');
    this.name = 'LearningPreferencesValidationError';
  }
}

export function isLearningPreferences(value: unknown): value is LearningPreferences {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LearningPreferences>;
  return (candidate.quizIntervalMinutes === 5 || candidate.quizIntervalMinutes === 10 || candidate.quizIntervalMinutes === 15) &&
    (candidate.questionType === 'multipleChoice' || candidate.questionType === 'shortAnswer') &&
    (candidate.difficulty === 'easy' || candidate.difficulty === 'medium' || candidate.difficulty === 'hard');
}

export async function loadLearningPreferences(storage: LocalStoragePort): Promise<LearningPreferences> {
  const stored = await storage.get(LEARNING_PREFERENCES_STORAGE_KEY);
  const value = stored[LEARNING_PREFERENCES_STORAGE_KEY];
  if (isLearningPreferences(value)) return { ...value };

  const defaults = { ...DEFAULT_LEARNING_PREFERENCES };
  await storage.set({ [LEARNING_PREFERENCES_STORAGE_KEY]: defaults });
  return defaults;
}

export async function saveLearningPreferences(
  storage: LocalStoragePort,
  preferences: unknown,
): Promise<LearningPreferences> {
  if (!isLearningPreferences(preferences)) throw new LearningPreferencesValidationError();
  const saved = { ...preferences };
  await storage.set({ [LEARNING_PREFERENCES_STORAGE_KEY]: saved });
  return saved;
}
