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
      className={active ? 'activation-toggle activation-toggle--on' : 'activation-toggle activation-toggle--off'}
      role="switch"
      aria-checked={active}
      aria-label={active ? 'Tắt StudyLens' : 'Bật StudyLens'}
      disabled={disabled}
      onClick={() => onRequest(active ? 'off' : 'on')}
    >
      <span className="activation-toggle__indicator" aria-hidden="true" />
    </button>
  );
}
