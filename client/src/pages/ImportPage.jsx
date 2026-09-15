import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';

const TYPE_LABELS = {
  hdfc_savings: 'HDFC bank account',
  hdfc_card: 'HDFC credit card',
  hdfc_card_pdf: 'HDFC credit card (PDF)',
  sbi_card_pdf: 'SBI credit card (PDF)',
};

export default function ImportPage({ onOpenBatch }) {
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState([]);
  const inputRef = useRef(null);
  const toast = useToast();

  const loadPending = () => api.get('/api/imports').then(setPending);
  useEffect(() => {
    loadPending();
  }, []);

  const addFiles = (list) => {
    const incoming = [...list].filter((f) => /\.(xls|xlsx|csv|pdf)$/i.test(f.name));
    setFiles((prev) => [...prev, ...incoming.filter((f) => !prev.some((p) => p.name === f.name))]);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      const { batch, errors } = await api.post('/api/imports', fd);
      errors?.forEach((e) => toast(`${e.file}: ${e.error}`, 'error'));
      toast(`Parsed ${batch.rows.length} transactions from ${batch.files.length} file(s)`, 'success');
      setFiles([]);
      onOpenBatch(batch.id);
    } catch (e) {
      if (e.errors?.length) {
        e.errors.forEach((err) => toast(`${err.file}: ${err.error}`, 'error'));
      } else {
        toast(e.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const discard = async (id) => {
    await api.del(`/api/imports/${id}`);
    loadPending();
  };

  return (
    <div className="page narrow">
      <h1>Import statements</h1>
      <p className="muted">
        Drop this month's bank and credit card statements (HDFC .xls, SBI Card PDF). Nothing is saved to your ledger
        until you review and confirm.
      </p>

      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <div className="dz-icon">⇪</div>
        <div>
          <strong>Drag files here</strong> or click to browse
        </div>
        <div className="muted small">.xls · .xlsx · .pdf</div>
        <input ref={inputRef} type="file" multiple hidden accept=".xls,.xlsx,.csv,.pdf" onChange={(e) => addFiles(e.target.files)} />
      </div>

      {files.length > 0 && (
        <div className="card">
          <ul className="file-list">
            {files.map((f) => (
              <li key={f.name}>
                <span className="file-ext">{f.name.split('.').pop().toUpperCase()}</span>
                <span className="grow">{f.name}</span>
                <span className="muted small">{(f.size / 1024).toFixed(0)} KB</span>
                <button className="icon-btn" onClick={() => setFiles(files.filter((x) => x !== f))}>✕</button>
              </li>
            ))}
          </ul>
          <button className="btn primary" disabled={busy} onClick={submit}>
            {busy ? 'Parsing…' : `Parse ${files.length} file${files.length > 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <>
          <h2>Unfinished imports</h2>
          <div className="card">
            <ul className="file-list">
              {pending.map((b) => (
                <li key={b.id}>
                  <span className="grow">
                    <strong>Import #{b.id}</strong> · {b.row_count} rows ·{' '}
                    <span className="muted small">
                      {b.files.map((f) => `${f.file} (${TYPE_LABELS[f.type] || f.type})`).join(', ')}
                    </span>
                  </span>
                  <button className="btn" onClick={() => onOpenBatch(b.id)}>Resume review</button>
                  <button className="btn ghost" onClick={() => discard(b.id)}>Discard</button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
