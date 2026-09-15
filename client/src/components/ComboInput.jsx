import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchorRect, useDismiss } from './floating.js';

// Text input with a styled floating panel of matching options: pick any previous
// value, or type a new one. Commits on blur / Enter; `onCreate` fires for unseen
// values. Same behavior as the old <datalist>-backed version, just with a panel we
// can actually style instead of the browser's own dropdown list.
export default function ComboInput({ value, options, onCommit, onCreate, placeholder, className = '', invalid }) {
  const [draft, setDraft] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const skipBlurCommit = useRef(false);
  useEffect(() => setDraft(value || ''), [value]);

  const rect = useAnchorRect(open, wrapRef);
  useDismiss(open, [wrapRef, panelRef], () => setOpen(false));

  const hasOptions = options.length > 0;
  const q = draft.trim().toLowerCase();
  const matches = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const exactMatch = options.some((o) => o.toLowerCase() === q);
  const showCreateRow = hasOptions && q && !exactMatch;
  const rowCount = matches.length + (showCreateRow ? 1 : 0);

  const commit = async (v) => {
    const next = (v ?? draft).trim();
    setDraft(next);
    setOpen(false);
    if (next === (value || '')) return;
    if (next && onCreate && !options.includes(next)) await onCreate(next);
    onCommit(next);
  };

  const pick = (v) => commit(v);

  const isNew = draft.trim() && !options.includes(draft.trim());

  return (
    <div className={`combo ${className}`} ref={wrapRef}>
      <input
        value={draft}
        title={draft}
        placeholder={placeholder}
        className={invalid ? 'invalid' : ''}
        onChange={(e) => {
          setDraft(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => {
          setHighlight(0);
          setOpen(true);
        }}
        onBlur={() => {
          if (skipBlurCommit.current) { skipBlurCommit.current = false; return; }
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(rowCount - 1, h + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(0, h - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && highlight < matches.length) commit(matches[highlight]);
            else e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(value || '');
            setOpen(false);
            e.currentTarget.blur();
          } else if (e.key === 'Tab' && open && highlight < matches.length) {
            skipBlurCommit.current = true;
            commit(matches[highlight]);
          }
        }}
      />
      {isNew && draft.trim() !== (value || '') && <span className="new-hint">+ new</span>}
      {open && rect && (matches.length > 0 || showCreateRow) && createPortal(
        <div
          ref={panelRef}
          className="select-panel combo-panel"
          style={{ top: rect.bottom + 4, left: rect.left, minWidth: rect.width }}
        >
          {matches.map((o, i) => (
            <div
              key={o}
              className={`select-option ${i === highlight ? 'active' : ''} ${o === value ? 'selected' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
            >
              {o}
            </div>
          ))}
          {showCreateRow && (
            <div
              className={`select-option combo-create ${highlight === matches.length ? 'active' : ''}`}
              onMouseEnter={() => setHighlight(matches.length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(draft)}
            >
              + Add "{draft.trim()}"
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
