// A real on/off switch (role="switch"), not a checkbox styled to look like one —
// used wherever a boolean choice is presented as a toggle rather than a form field.
export default function Switch({ checked, onChange, label, disabled = false, title, className = '' }) {
  return (
    <label className={`switch-row ${disabled ? 'disabled' : ''} ${className}`} title={title}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`switch ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
      {label && <span className="switch-label">{label}</span>}
    </label>
  );
}
