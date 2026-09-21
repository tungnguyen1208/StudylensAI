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
      className={`activation-toggle ${active ? 'activation-toggle--active' : ''}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={() => onRequest(active ? 'off' : 'on')}
    >
      <span className="activation-toggle__indicator" aria-hidden="true" />
      <span>{active ? 'Tắt StudyLens' : 'Bật StudyLens'}</span>
    </button>
  );
}
