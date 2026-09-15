import { useEffect, useState } from 'react';

// A single click used to delete outright, which turned out too easy to trigger by
// accident (a stray click right where "edit" also lives). Now the first click just arms
// it — the button flips to a "confirm" state for a few seconds — and only a second click
// (or Enter, since it's still a real button) actually deletes. Escape, a blur, or letting
// it time out disarms without doing anything.
export default function DeleteButton({
  onConfirm,
  title = 'Delete',
  label = '✕',
  confirmLabel = 'Confirm ✕',
  className = 'icon-btn',
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!armed) {
    return (
      <button className={className} title={title} onClick={(e) => { e.stopPropagation(); setArmed(true); }}>
        {label}
      </button>
    );
  }

  return (
    <button
      className={`${className} confirm-delete`}
      title="Click again to confirm delete"
      autoFocus
      onClick={(e) => { e.stopPropagation(); setArmed(false); onConfirm(); }}
      onBlur={() => setArmed(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setArmed(false); } }}
    >
      {confirmLabel}
    </button>
  );
}
