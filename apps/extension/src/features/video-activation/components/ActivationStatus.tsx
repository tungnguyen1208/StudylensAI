import type { ActivationState } from '../models/activation.types';

export function ActivationStatus({ state }: { state: ActivationState }) {
  const transcriptStatus = state.transcriptSnapshot?.status ?? 'pending';
  return (
    <p role="status">
      StudyLens: {state.status}. Transcript: {transcriptStatus}.
      {state.errorCode ? ` ${state.errorCode}` : ''}
    </p>
  );
}
