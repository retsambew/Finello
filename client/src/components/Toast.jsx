import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Modal from './Modal.jsx';

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const schedule = useCallback((id, ms) => {
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => dismiss(id), ms);
  }, [dismiss]);

  // `action` (e.g. { label: 'Undo', onClick }) adds a button to the toast and gives it
  // longer to sit on screen — a delete is only actually safe to make "too easy" if
  // there's a moment to catch it. Hovering pauses the auto-dismiss entirely.
  const push = useCallback((message, kind = 'info', action) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, kind, action }]);
    // Errors stay on screen until dismissed — an import failure is worthless
    // as a warning if it can auto-vanish while the app moves on to Review.
    if (kind !== 'error') schedule(id, action ? 6000 : 4000);
    return id;
  }, [schedule]);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind}`}
            onMouseEnter={() => clearTimeout(timers.current[t.id])}
            onMouseLeave={() => t.kind !== 'error' && schedule(t.id, 2000)}
          >
            <span
              className="toast-msg"
              onClick={() => {
                if (t.kind === 'error') setExpanded(t);
                dismiss(t.id);
              }}
            >
              {t.message}
            </span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => { t.action.onClick(); dismiss(t.id); }}
              >
                {t.action.label}
              </button>
            )}
            {t.kind === 'error' && <span className="toast-close" onClick={() => dismiss(t.id)}>✕</span>}
          </div>
        ))}
      </div>
      {expanded && (
        <Modal className="modal-fullscreen" onClose={() => setExpanded(null)}>
          <div className="modal-fullscreen-head">
            <h2>Error</h2>
            <span className="toast-close" onClick={() => setExpanded(null)}>✕</span>
          </div>
          <pre className="modal-fullscreen-body">{expanded.message}</pre>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setExpanded(null)}>Close</button>
          </div>
        </Modal>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
