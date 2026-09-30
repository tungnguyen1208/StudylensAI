/**
 * Public Extension handoff types for Dev 1 -> Dev 2.
 *
 * These are TypeScript projections of the versioned contracts. They contain
 * no browser persistence, DOM, or feature-internal state.
 */
export type QuestionType = 'multipleChoice' | 'shortAnswer';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface PreferenceSnapshot {
  questionType: QuestionType;
  difficulty: Difficulty;
}

export interface ActivationEnabledPayload {
  activationId: string;
  source: 'user' | 'storageRestore';
  videoTitle: string;
  preferences: PreferenceSnapshot;
}
