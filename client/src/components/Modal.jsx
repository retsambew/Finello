import { useEffect } from 'react';

// Shared modal shell: Escape and a backdrop click both call `onClose` (omit onClose to
// make a step non-dismissible, e.g. a required "map this account" prompt); Enter anywhere
// except a <button> or <textarea> triggers `onSubmit`, so a form can be filled out and
// confirmed without reaching for the mouse.
export default function Modal({ children, onClose, onSubmit, className = '' }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' || !onSubmit) return;
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${className}`} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        {children}
      </div>
    </div>
  );
}
