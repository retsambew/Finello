import { useState } from 'react';
import { api } from '../api.js';
import { useToast } from './Toast.jsx';
import Modal from './Modal.jsx';
import Switch from './Switch.jsx';

// Shared shell for the two destructive Danger zone actions below: a typed-confirmation
// modal (same "type X to confirm" pattern used elsewhere) plus a Switch for whether to
// reseed default categories/accounts/rules afterward instead of leaving everything blank.
function ConfirmModal({ title, body, confirmWord, onClose, onConfirm }) {
  const [text, setText] = useState('');
  const [reseed, setReseed] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm(reseed);
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const valid = text === confirmWord;

  return (
    <Modal onClose={onClose} onSubmit={() => valid && !busy && run()}>
      <h2>{title}</h2>
      {body}
      <p className="muted small">Type <strong>{confirmWord}</strong> to confirm.</p>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={confirmWord} autoFocus />
      <div className="row" style={{ margin: '14px 0' }}>
        <Switch checked={reseed} onChange={setReseed} label="Reseed default categories, accounts and rules afterward" />
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn danger" disabled={!valid || busy} onClick={run}>
          {busy ? 'Working…' : title}
        </button>
      </div>
    </Modal>
  );
}

export function DeleteSettingsButton({ onDone, className = 'btn danger' }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();

  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>Delete settings</button>
      {open && (
        <ConfirmModal
          title="Delete settings"
          confirmWord="DELETE"
          body={(
            <p>
              This permanently deletes every <strong>category, sub category, auto-mapping rule and account</strong>.
              Your ledger transactions are kept as-is — this cannot be undone.
            </p>
          )}
          onClose={() => setOpen(false)}
          onConfirm={async (reseed) => {
            await api.post('/api/settings/reset', { reseed });
            toast('Settings deleted' + (reseed ? ' and reseeded with defaults.' : '.'), 'success');
            onDone?.();
          }}
        />
      )}
    </>
  );
}

export function FactoryResetButton({ onDone, className = 'btn danger' }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();

  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>Delete all data (factory reset)</button>
      {open && (
        <ConfirmModal
          title="Factory reset"
          confirmWord="RESET"
          body={(
            <p>
              This permanently deletes <strong>every transaction, import, category, sub category, auto-mapping
              rule and account</strong> — everything in the app. This cannot be undone.
            </p>
          )}
          onClose={() => setOpen(false)}
          onConfirm={async (reseed) => {
            const result = await api.post('/api/factory-reset', { reseed });
            toast(
              `Everything deleted — ${result.removed} transaction${result.removed === 1 ? '' : 's'} removed`
              + (reseed ? ', reseeded with defaults.' : '.'),
              'success'
            );
            onDone?.();
          }}
        />
      )}
    </>
  );
}
