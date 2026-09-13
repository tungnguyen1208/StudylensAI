export function ActivationToggle({
  active,
  disabled = false,
  onRequest,
}: {
  active: boolean;
  disabled?: boolean;
  onRequest: (requestedState: 'on' | 'off') => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={() => onRequest(active ? 'off' : 'on')}
    >
      {active ? 'Turn StudyLens off' : 'Turn StudyLens on'}
    </button>
  );
}
