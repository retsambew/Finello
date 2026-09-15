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
      if (result.incompleteRows?.length) {
        const rowList = result.incompleteRows.slice(0, 10).map((r) => r.row).join(', ');
        const more = result.incompleteRows.length > 10 ? `, +${result.incompleteRows.length - 10} more` : '';
        toast(
          `${result.incompleteRows.length} row(s) had some fields filled in but were missing account/type/date/amount, so they were NOT imported: row ${rowList}${more}. Check these in your source file.`,
          'error'
        );
      }
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
