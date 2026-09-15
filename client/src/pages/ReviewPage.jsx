import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, inr } from '../api.js';
import TxnTable from '../components/TxnTable.jsx';
import ComboInput from '../components/ComboInput.jsx';
import { useToast } from '../components/Toast.jsx';
import Switch from '../components/Switch.jsx';
import Modal from '../components/Modal.jsx';

const FILTERS = [
  ['all', 'All'],
  ['review', 'Needs review'],
  ['dup', 'Duplicates'],
  ['excluded', 'Excluded'],
];

export default function ReviewPage({ batchId, meta, reloadMeta, onPickBatch, onDone }) {
  const [batch, setBatch] = useState(null);
  const [pending, setPending] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [remember, setRemember] = useState(true);
  const [dupDecided, setDupDecided] = useState(false);
  const [bulk, setBulk] = useState({ type: '', category: '' });
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    if (!batchId) return;
    setBatch(await api.get(`/api/imports/${batchId}`));
  }, [batchId]);

  useEffect(() => {
    setBatch(null);
    setSelected(new Set());
    setDupDecided(false);
    setFilter('all');
    if (batchId) load();
    else api.get('/api/imports').then(setPending);
  }, [batchId, load]);

  const rows = useMemo(() => {
    if (!batch) return [];
    const q = search.trim().toLowerCase();
    return batch.rows.filter((r) => {
      if (filter === 'review' && r.auto_mapped) return false;
      if (filter === 'dup' && !r.is_duplicate) return false;
      if (filter === 'excluded' && r.include_row) return false;
      if (q && ![r.narration, r.description, r.details, r.category, r.account].some((v) => v?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [batch, filter, search]);

  if (!batchId) {
    return (
      <div className="page narrow">
        <h1>Review</h1>
        {pending?.length ? (
          <div className="card">
            <p>Pick an unfinished import to review:</p>
            {pending.map((b) => (
              <button key={b.id} className="btn" onClick={() => onPickBatch(b.id)}>
                Import #{b.id} · {b.row_count} rows
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">Nothing to review. Import statements first.</p>
        )}
      </div>
    );
  }
  if (!batch) return <p className="muted">Loading import…</p>;

  const needsReview = batch.rows.filter((r) => !r.auto_mapped && r.include_row).length;
  const excluded = batch.rows.filter((r) => !r.include_row).length;
  const incomplete = batch.rows.filter((r) => r.include_row && (!r.account || !r.type || !r.category)).length;
  const included = batch.rows.filter((r) => r.include_row);
  const totals = included.reduce(
    (acc, r) => {
      acc[r.type] = (acc[r.type] || 0) + r.amount;
      return acc;
    },
    {}
  );

  const patchRow = async (row, patch) => {
    // Optimistic update keeps the table responsive while the server saves.
    setBatch((b) => ({ ...b, rows: b.rows.map((r) => (r.id === row.id ? { ...r, ...patch } : r)) }));
    try {
      const { appliedTo } = await api.patch(`/api/transactions/${row.id}`, { ...patch, remember });
      if (appliedTo > 0) toast(`Mapping remembered and applied to ${appliedTo} similar row(s)`, 'success');
      if ('description' in patch) reloadMeta();
      await load();
    } catch (e) {
      toast(e.message, 'error');
      load();
    }
  };

  const bulkAction = async (action, patch) => {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === 'delete' && !window.confirm(`Delete ${ids.length} selected row(s) from this import?`)) return;
    await api.post('/api/transactions/bulk', { ids, action, patch });
    setSelected(new Set());
    toast(`${action === 'delete' ? 'Deleted' : 'Updated'} ${ids.length} row(s)`, 'success');
    load();
  };

  const deleteAllDuplicates = async () => {
    setBatch(await api.post(`/api/imports/${batchId}/duplicates`, { action: 'delete' }));
    setSelected(new Set());
    setDupDecided(true);
    toast('Duplicates removed', 'success');
  };

  const mapAccount = async (identifier, name) => {
    if (!name) return;
    setBatch(await api.post(`/api/imports/${batchId}/accounts`, { identifier, name }));
    reloadMeta();
  };

  const commit = async () => {
    try {
      const { committed } = await api.post(`/api/imports/${batchId}/commit`);
      toast(`Saved ${committed} transactions to your ledger`, 'success');
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const discard = async () => {
    setDiscarding(true);
    try {
      await api.del(`/api/imports/${batchId}`);
      onDone();
    } catch (e) {
      toast(e.message, 'error');
      setDiscarding(false);
    }
  };

  const showAccountModal = batch.unmappedAccounts.length > 0;
  const showDupModal = !showAccountModal && !dupDecided && batch.duplicateCount > 0;

  return (
    <div className="page">
      {showAccountModal && (
        <AccountModal accounts={meta.accounts} unmapped={batch.unmappedAccounts} onMap={mapAccount} />
      )}
      {showDiscardModal && (
        <Modal onClose={() => !discarding && setShowDiscardModal(false)} onSubmit={() => !discarding && discard()}>
          <h2>Discard import #{batch.id}?</h2>
          <p>
            This removes all <strong>{batch.rows.length}</strong> row(s) from this import. Nothing from it will be
            saved to your ledger — this cannot be undone.
          </p>
          <div className="modal-actions">
            <button className="btn ghost" disabled={discarding} onClick={() => setShowDiscardModal(false)}>Cancel</button>
            <button className="btn danger" disabled={discarding} onClick={discard}>
              {discarding ? 'Discarding…' : 'Discard import'}
            </button>
          </div>
        </Modal>
      )}
      {showDupModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Possible duplicates found</h2>
            <p>
              <strong>{batch.duplicateCount}</strong> transaction(s) look like they were already imported earlier, or
              appear in more than one of the uploaded files.
            </p>
            <div className="modal-actions">
              <button className="btn primary" onClick={deleteAllDuplicates}>Skip duplicates</button>
              <button
                className="btn"
                onClick={() => {
                  setDupDecided(true);
                  setFilter('dup');
                }}
              >
                Keep and review them
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page-head">
        <div>
          <h1>Review import #{batch.id}</h1>
          <p className="muted small">{batch.files.map((f) => `${f.file} (${f.count})`).join(' · ')}</p>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={() => setShowDiscardModal(true)}>Discard import</button>
          <button className="btn primary" onClick={commit} disabled={incomplete > 0} title={incomplete ? `${incomplete} row(s) need account/type/category` : ''}>
            Save {included.length} to ledger
          </button>
        </div>
      </div>

      <div className="stats">
        <Stat label="Rows" value={batch.rows.length} />
        <Stat label="Needs review" value={needsReview} tone={needsReview ? 'warn' : ''} />
        <Stat label="Duplicates" value={batch.duplicateCount} tone={batch.duplicateCount ? 'dup' : ''} />
        <Stat label="Excluded" value={excluded} />
        <Stat label="Expense" value={inr(totals.Expense)} />
        <Stat label="Income" value={inr(totals.Income)} />
        <Stat label="Investment" value={inr(totals.Investment)} />
      </div>

      <div className="toolbar sticky">
        <div className="chips">
          {FILTERS.map(([k, label]) => (
            <button key={k} className={filter === k ? 'chip active' : 'chip'} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <input className="search" placeholder="Search narration, sub category, description…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Switch
          className="right"
          checked={remember}
          onChange={setRemember}
          label="Remember my mappings"
          title="When you set a category on an unmapped merchant, save it as an auto-mapping rule for future imports"
        />
      </div>

      <div className="toolbar secondary">
        <button
          className="btn small"
          disabled={!batch.duplicateCount}
          onClick={() => setSelected(new Set(batch.rows.filter((r) => r.is_duplicate).map((r) => r.id)))}
        >
          Select all duplicates
        </button>
        <button className="btn small danger" disabled={!batch.duplicateCount} onClick={() => {
          if (window.confirm(`Delete all ${batch.duplicateCount} duplicate row(s)?`)) deleteAllDuplicates();
        }}>
          Delete all duplicates
        </button>
        {selected.size > 0 && (
          <div className="bulk">
            <strong>{selected.size} selected</strong>
            <button className="btn small" onClick={() => bulkAction('update', { include_row: true })}>Include</button>
            <button className="btn small" onClick={() => bulkAction('update', { include_row: false })}>Exclude</button>
            <ComboInput value={bulk.type} options={meta.types} placeholder="Type" className="w-type"
              onCommit={(v) => setBulk({ ...bulk, type: v })} />
            <ComboInput value={bulk.category} options={meta.categories.filter((c) => c.type === bulk.type).map((c) => c.name)}
              placeholder="Category" className="w-category"
              onCommit={(v) => setBulk({ ...bulk, category: v })} />
            <button className="btn small" disabled={!bulk.type || !bulk.category}
              onClick={() => bulkAction('update', { type: bulk.type, category: bulk.category })}>
              Apply
            </button>
            <button className="btn small danger" onClick={() => bulkAction('delete')}>Delete</button>
            <button className="btn small ghost" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>

      <TxnTable
        staged
        rows={rows}
        meta={meta}
        reloadMeta={reloadMeta}
        onPatch={patchRow}
        selected={selected}
        onToggle={(id) => {
          const next = new Set(selected);
          next.has(id) ? next.delete(id) : next.add(id);
          setSelected(next);
        }}
        onToggleAll={(on) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set())}
      />
      {rows.length === 0 && <p className="muted center">No rows match this filter.</p>}
    </div>
  );
}

function Stat({ label, value, tone = '' }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function AccountModal({ accounts, unmapped, onMap }) {
  const [names, setNames] = useState(() => Object.fromEntries(unmapped.map((u) => [u.identifier, u.suggestedName])));
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>New account detected</h2>
        <p className="muted">Pick an existing account or type a new name. Finello will remember this for future statements.</p>
        {unmapped.map((u) => (
          <div key={u.identifier} className="account-map">
            <div>
              <strong>{u.file}</strong>
              <div className="muted small">{u.identifier} · {u.count} transactions</div>
            </div>
            <div className="row">
              <ComboInput
                value={names[u.identifier]}
                options={accounts.map((a) => a.name)}
                onCommit={(v) => setNames({ ...names, [u.identifier]: v })}
              />
              <button className="btn primary" onClick={() => onMap(u.identifier, names[u.identifier])}>Save</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
