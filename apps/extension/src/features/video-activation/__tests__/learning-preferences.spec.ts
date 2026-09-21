import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEARNING_PREFERENCES,
  LEARNING_PREFERENCES_STORAGE_KEY,
  LearningPreferencesValidationError,
  loadLearningPreferences,
  saveLearningPreferences,
  type LocalStoragePort,
} from '../models/learning-preferences';

function createStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const writes: Array<Record<string, unknown>> = [];
  const storage: LocalStoragePort = {
    get: async () => ({ ...data }),
    set: async (value) => {
      writes.push({ ...value });
      Object.assign(data, value);
    },
  };
  return { storage, writes, data };
}

describe('learning preferences storage', () => {
  it('creates the approved local defaults when no valid preferences are stored', async () => {
    const { storage, writes } = createStorage();
    await expect(loadLearningPreferences(storage)).resolves.toEqual(DEFAULT_LEARNING_PREFERENCES);
    expect(writes).toEqual([{ [LEARNING_PREFERENCES_STORAGE_KEY]: DEFAULT_LEARNING_PREFERENCES }]);
  });

  it('restores a valid browser-local preference snapshot', async () => {
    const preferences = { quizIntervalMinutes: 15 as const, questionType: 'shortAnswer' as const, difficulty: 'hard' as const };
    const { storage, writes } = createStorage({ [LEARNING_PREFERENCES_STORAGE_KEY]: preferences });
    await expect(loadLearningPreferences(storage)).resolves.toEqual(preferences);
    expect(writes).toEqual([]);
  });

  it('persists only supported values and rejects invalid data without a write', async () => {
    const { storage, writes } = createStorage();
    await expect(saveLearningPreferences(storage, {
      quizIntervalMinutes: 5,
      questionType: 'multipleChoice',
      difficulty: 'easy',
    })).resolves.toEqual({ quizIntervalMinutes: 5, questionType: 'multipleChoice', difficulty: 'easy' });
    await expect(saveLearningPreferences(storage, {
      quizIntervalMinutes: 7,
      questionType: 'multipleChoice',
      difficulty: 'easy',
    })).rejects.toBeInstanceOf(LearningPreferencesValidationError);
    expect(writes).toHaveLength(1);
  });
});
