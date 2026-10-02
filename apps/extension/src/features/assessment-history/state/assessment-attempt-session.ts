import type { LocalAnswerSubmission, QuizAttemptView } from '../types/assessment-types';

const STORAGE_PREFIX = 'studylens.assessment-attempt.';

export interface AssessmentAttemptSession {
  clientAttemptId: string;
  drafts: Record<string, string>;
  submittedAnswers: LocalAnswerSubmission[] | null;
  attempt: QuizAttemptView | null;
}

export interface AssessmentAttemptSessionStore {
  load(quizId: string): Promise<AssessmentAttemptSession | null>;
  save(quizId: string, value: AssessmentAttemptSession): Promise<void>;
}

export class BrowserAssessmentAttemptSessionStore implements AssessmentAttemptSessionStore {
  private readonly memory = new Map<string, AssessmentAttemptSession>();
  private readonly pendingWrites = new Map<string, Promise<void>>();

  public async load(quizId: string): Promise<AssessmentAttemptSession | null> {
    const cached = this.memory.get(quizId);
    if (cached) return clone(cached);
    if (typeof chrome === 'undefined' || !chrome.storage?.session) return null;
    const stored = (await chrome.storage.session.get(keyOf(quizId)))[keyOf(quizId)];
    if (!isSession(stored)) return null;
    this.memory.set(quizId, stored);
    return clone(stored);
  }

  public async save(quizId: string, value: AssessmentAttemptSession): Promise<void> {
    const copy = clone(value);
    this.memory.set(quizId, copy);
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const key = keyOf(quizId);
      const previous = this.pendingWrites.get(key) ?? Promise.resolve();
      const pending = previous.catch(() => undefined).then(() => chrome.storage.session.set({ [key]: copy }));
      this.pendingWrites.set(key, pending);
      try {
        await pending;
      } finally {
        if (this.pendingWrites.get(key) === pending) this.pendingWrites.delete(key);
      }
    }
  }
}

export class MemoryAssessmentAttemptSessionStore implements AssessmentAttemptSessionStore {
  private readonly values = new Map<string, AssessmentAttemptSession>();

  public async load(quizId: string): Promise<AssessmentAttemptSession | null> {
    const value = this.values.get(quizId);
    return value ? clone(value) : null;
  }

  public async save(quizId: string, value: AssessmentAttemptSession): Promise<void> {
    this.values.set(quizId, clone(value));
  }
}

export const assessmentAttemptSessionStore = new BrowserAssessmentAttemptSessionStore();

export function createAssessmentAttemptSession(createId: () => string = () => crypto.randomUUID()): AssessmentAttemptSession {
  return { clientAttemptId: createId(), drafts: {}, submittedAnswers: null, attempt: null };
}

export function prepareAttemptSubmission(
  session: AssessmentAttemptSession,
  answers: LocalAnswerSubmission[],
): { session: AssessmentAttemptSession; answers: LocalAnswerSubmission[] } {
  if (session.submittedAnswers) return { session, answers: cloneAnswers(session.submittedAnswers) };
  const submittedAnswers = cloneAnswers(answers);
  return { session: { ...session, submittedAnswers }, answers: cloneAnswers(submittedAnswers) };
}

function keyOf(quizId: string): string { return `${STORAGE_PREFIX}${quizId}`; }

function clone(value: AssessmentAttemptSession): AssessmentAttemptSession {
  return {
    ...value,
    drafts: { ...value.drafts },
    submittedAnswers: value.submittedAnswers ? cloneAnswers(value.submittedAnswers) : null,
    attempt: value.attempt ? structuredClone(value.attempt) : null,
  };
}

function cloneAnswers(value: LocalAnswerSubmission[]): LocalAnswerSubmission[] {
  return value.map(answer => ({ ...answer }));
}

function isSession(value: unknown): value is AssessmentAttemptSession {
  const item = value as Partial<AssessmentAttemptSession> | null;
  return Boolean(item) && typeof item?.clientAttemptId === 'string' && item.clientAttemptId.length > 0 &&
    typeof item.drafts === 'object' && item.drafts !== null &&
    Object.values(item.drafts).every(draft => typeof draft === 'string') &&
    (item.submittedAnswers === undefined || item.submittedAnswers === null || Array.isArray(item.submittedAnswers)) &&
    (item.attempt === null || typeof item.attempt === 'object');
}
