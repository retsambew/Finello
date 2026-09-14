import { useEffect, useState } from 'react';

// Text input backed by a <datalist>: pick any previous value from the dropdown,
// or type a new one. Commits on blur / Enter; `onCreate` fires for unseen values.
export default function ComboInput({ value, options, listId, onCommit, onCreate, placeholder, className = '', invalid }) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => setDraft(value || ''), [value]);

  const commit = async () => {
    const v = draft.trim();
    if (v === (value || '')) return;
    if (v && onCreate && !options.includes(v)) await onCreate(v);
    onCommit(v);
  };

  const isNew = draft.trim() && !options.includes(draft.trim());

  return (
    <div className={`combo ${className}`}>
      <input
        list={listId}
        value={draft}
        placeholder={placeholder}
        className={invalid ? 'invalid' : ''}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(value || '');
            e.currentTarget.blur();
          }
        }}
      />
      {isNew && draft.trim() !== (value || '') && <span className="new-hint">+ new</span>}
    </div>
  );
}
