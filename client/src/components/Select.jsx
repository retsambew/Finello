import { Children, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchorRect, useDismiss } from './floating.js';

// Drop-in replacement for a native <select>: same value/onChange({target:{value}})
// contract and plain <option> children, but with a styled floating panel instead of
// the browser's own (unstyleable) dropdown list.
export default function Select({ value, onChange, children, className = '', disabled, placeholder }) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const options = Children.toArray(children)
    .filter((c) => c.props && c.type === 'option')
    .map((c) => ({ value: c.props.value ?? c.props.children, label: c.props.children, disabled: c.props.disabled }));
  const selected = options.find((o) => String(o.value) === String(value));

  const close = useCallback(() => setOpen(false), []);
  const rect = useAnchorRect(open, triggerRef);
  useDismiss(open, [triggerRef, panelRef], close);

  const openPanel = () => {
    if (disabled || !options.length) return;
    const idx = options.findIndex((o) => String(o.value) === String(value));
    setHighlight(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  const commit = (opt) => {
    if (!opt || opt.disabled) return;
    onChange && onChange({ target: { value: opt.value } });
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        openPanel();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(options[highlight]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      commit(options[highlight]);
    }
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        className={`select-trigger ${open ? 'open' : ''} ${className}`}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={onKeyDown}
      >
        <span className={`select-value ${!selected ? 'placeholder' : ''}`}>
          {selected ? selected.label : placeholder || ''}
        </span>
      </button>
      {open && rect && createPortal(
        <div
          ref={panelRef}
          className="select-panel"
          style={{ top: rect.bottom + 4, left: rect.left, minWidth: rect.width }}
        >
          {options.map((o, i) => (
            <div
              key={`${o.value}-${i}`}
              role="option"
              aria-selected={String(o.value) === String(value)}
              className={[
                'select-option',
                i === highlight ? 'active' : '',
                String(o.value) === String(value) ? 'selected' : '',
                o.disabled ? 'disabled' : '',
              ].join(' ').trim()}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(o)}
            >
              {o.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
