import type { HistoryEntryReadModel } from '../types/assessment-types';

export type HistoryLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface HistoryLoadState {
  status: HistoryLoadStatus;
  entries: HistoryEntryReadModel[];
  error: string | null;
}

export const INITIAL_HISTORY_LOAD_STATE: HistoryLoadState = {
  status: 'idle',
  entries: [],
  error: null,
};

export function historyLoadStarted(state: HistoryLoadState): HistoryLoadState {
  return { ...state, status: 'loading', error: null };
}

export function historyLoadSucceeded(entries: HistoryEntryReadModel[]): HistoryLoadState {
  return { status: 'ready', entries, error: null };
}

export function historyLoadFailed(state: HistoryLoadState, error: string): HistoryLoadState {
  return { ...state, status: 'error', error };
}
