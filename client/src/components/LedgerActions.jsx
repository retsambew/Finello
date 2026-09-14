import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast } from './Toast.jsx';

// Bulk-loads a whole ledger export (e.g. an existing expense-tracker workbook)
// straight into the committed ledger, skipping the staged bank-statement review flow.
export function ImportLedgerButton({ onImported, className = 'btn', label = 'Import ledger (.xlsx)' }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const result = await api.post('/api/ledger/import', fd);
      toast(
        result.skipped
          ? `Imported ${result.inserted} entries (${result.skipped} already in the ledger were skipped).`
          : `Imported ${result.inserted} entries from "${result.sheetName}".`,
        'success'
      );
      onImported?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept=".xls,.xlsx" hidden onChange={(e) => handleFile(e.target.files[0])} />
      <button className={className} disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Importing…' : label}
      </button>
    </>
  );
}

export function ResetLedgerButton({ onReset, className = 'btn danger' }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const reset = async () => {
    setBusy(true);
    try {
      const result = await api.post('/api/ledger/reset');
      toast(`Ledger cleared — ${result.removed} transaction${result.removed === 1 ? '' : 's'} removed.`, 'success');
      setOpen(false);
      setText('');
      onReset?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>Reset ledger</button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reset ledger</h2>
            <p>
              This permanently deletes <strong>every transaction</strong> and any unfinished import. Accounts,
              categories and auto-mapping rules are kept. This cannot be undone.
            </p>
            <p className="muted small">Type <strong>RESET</strong> to confirm.</p>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="RESET" autoFocus />
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn danger" disabled={text !== 'RESET' || busy} onClick={reset}>
                {busy ? 'Resetting…' : 'Delete everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
