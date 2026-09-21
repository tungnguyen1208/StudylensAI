import type { GradeView, HistoryEntryReadModel } from '../types/assessment-types';

export interface AssessmentHistoryState {
  latestGrade?: GradeView;
  entries: HistoryEntryReadModel[];
}

export type AssessmentHistoryAction =
  | { type: 'gradeReceived'; grade: GradeView; entry: HistoryEntryReadModel }
  | { type: 'historyLoaded'; entries: HistoryEntryReadModel[] }
  | { type: 'clearLatestGrade' };

export const initialAssessmentHistoryState: AssessmentHistoryState = { entries: [] };

export function assessmentHistoryReducer(
  state: AssessmentHistoryState,
  action: AssessmentHistoryAction,
): AssessmentHistoryState {
  switch (action.type) {
    case 'gradeReceived':
      return { latestGrade: action.grade, entries: [action.entry, ...state.entries] };
    case 'historyLoaded':
      return { ...state, entries: action.entries };
    case 'clearLatestGrade':
      return { ...state, latestGrade: undefined };
  }
}
