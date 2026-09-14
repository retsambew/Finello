import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, inr } from '../api.js';
import TxnTable, { MetaDatalists } from '../components/TxnTable.jsx';
import { useToast } from '../components/Toast.jsx';
import { ImportLedgerButton, ResetLedgerButton } from '../components/LedgerActions.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const lastDay = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

export default function LedgerPage({ meta, reloadMeta }) {
  const [months, setMonths] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', account: '', type: '', category: '', q: '' });
  const [period, setPeriod] = useState('');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const query = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString(), [filters]);
  const load = useCallback(() => api.get(`/api/transactions?${query}`).then(setRows), [query]);
  const loadMonths = useCallback(() => api.get('/api/months').then((m) => {
    setMonths(m);
    if (m.length && !period) choosePeriod(m[0]);
    return m;
  }), [period]);

  const refreshAll = () => {
    loadMonths();
    load();
    reloadMeta();
  };

  useEffect(() => {
    loadMonths();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function choosePeriod(value) {
    setPeriod(value);
    if (!value) setFilters((f) => ({ ...f, from: '', to: '' }));
    else if (value !== 'custom') setFilters((f) => ({ ...f, from: `${value}-01`, to: lastDay(value) }));
  }

  const summary = useMemo(() => {
    const byType = {};
    const byCategory = {};
    for (const r of rows) {
      byType[r.type] = (byType[r.type] || 0) + r.amount;
      if (r.type === 'Expense') byCategory[r.category] = (byCategory[r.category] || 0) + r.amount;
    }
    const cats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    return { byType, cats, max: cats[0]?.[1] || 1 };
  }, [rows]);

  const patchRow = async (row, patch) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    try {
      await api.patch(`/api/transactions/${row.id}`, patch);
      if ('description' in patch) reloadMeta();
    } catch (e) {
      toast(e.message, 'error');
      load();
    }
  };

  const deleteRow = async (row) => {
    if (!window.confirm(`Delete "${row.description || row.narration}" (${inr(row.amount)})?`)) return;
    await api.del(`/api/transactions/${row.id}`);
    load();
  };

  const bulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} selected transaction(s)?`)) return;
    await api.post('/api/transactions/bulk', { ids: [...selected], action: 'delete' });
    setSelected(new Set());
    load();
  };

  const copyForExcel = async () => {
    const lines = rows.map((r) => {
      const [y, m, d] = r.date.split('-');
      return [r.account, `${d}-${MONTHS[+m - 1]}-${y}`, r.month, r.category, r.type, r.amount, r.description || '', r.details || '']
        .map((v) => String(v).replace(/[\t\n]/g, ' '))
        .join('\t');
    });
    await navigator.clipboard.writeText(lines.join('\n'));
    toast(`Copied ${rows.length} rows. Paste into the first empty row of the Entries table (column B).`, 'success');
  };

  const net = (summary.byType.Income || 0) - (summary.byType.Expense || 0) - (summary.byType.Investment || 0);

  return (
    <div className="page">
      <MetaDatalists meta={meta} />
      {months.length === 0 && (
        <div className="card">
          <h3>Your ledger is empty</h3>
          <p className="muted small">
            Already have a tracker? Import its "Entries" sheet (Account, Date, Type, Category, Amount columns)
            to bring your existing history in, or add transactions by importing bank/card statements from the
            Import tab.
          </p>
          <ImportLedgerButton onImported={refreshAll} className="btn primary" />
        </div>
      )}
      <div className="page-head">
        <h1>Ledger</h1>
        <div className="head-actions">
          <button className="btn" onClick={() => setAdding(true)}>+ Manual entry</button>
          <button className="btn" onClick={copyForExcel} disabled={!rows.length}>Copy rows for Excel</button>
          <a className={`btn primary ${rows.length ? '' : 'disabled'}`} href={`/api/export.xlsx?${query}`}>
            Download .xlsx
          </a>
          <ImportLedgerButton onImported={refreshAll} />
          <ResetLedgerButton onReset={refreshAll} />
        </div>
      </div>

      <div className="toolbar">
        <select value={period} onChange={(e) => choosePeriod(e.target.value)}>
          <option value="">All time</option>
          {months.map((m) => {
            const [y, mo] = m.split('-');
            return <option key={m} value={m}>{MONTHS[+mo - 1]} {y}</option>;
          })}
          <option value="custom">Custom range…</option>
        </select>
        {period === 'custom' && (
          <>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            <span className="muted">to</span>
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </>
        )}
        <select value={filters.account} onChange={(e) => setFilters({ ...filters, account: e.target.value })}>
          <option value="">All accounts</option>
          {meta.accounts.map((a) => <option key={a.id}>{a.name}</option>)}
        </select>
        <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value, category: '' })}>
          <option value="">All types</option>
          {meta.types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
          <option value="">All categories</option>
          {meta.categories.filter((c) => !filters.type || c.type === filters.type).map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <input className="search" placeholder="Search…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
      </div>

      <div className="stats">
        <Stat label="Income" value={inr(summary.byType.Income)} tone="good" />
        <Stat label="Expense" value={inr(summary.byType.Expense)} tone="bad" />
        <Stat label="Investment" value={inr(summary.byType.Investment)} />
        <Stat label="CC Bill paid" value={inr(summary.byType['CC Bill'])} />
        <Stat label="Net (Income − Expense − Investment)" value={inr(net)} tone={net >= 0 ? 'good' : 'bad'} />
      </div>

      {summary.cats.length > 0 && (
        <div className="card breakdown">
          <h3>Expenses by category</h3>
          {summary.cats.map(([cat, amt]) => (
            <div key={cat} className="bar-row">
              <span className="bar-label">{cat || 'Uncategorised'}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(amt / summary.max) * 100}%` }} />
              </span>
              <span className="bar-value">{inr(amt)}</span>
            </div>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="toolbar secondary">
          <strong>{selected.size} selected</strong>
          <button className="btn small danger" onClick={bulkDelete}>Delete</button>
          <button className="btn small ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <TxnTable
        rows={rows}
        meta={meta}
        reloadMeta={reloadMeta}
        onPatch={patchRow}
        onDelete={deleteRow}
        selected={selected}
        onToggle={(id) => {
          const next = new Set(selected);
          next.has(id) ? next.delete(id) : next.add(id);
          setSelected(next);
        }}
        onToggleAll={(on) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set())}
      />
      {rows.length === 0 && <p className="muted center">No transactions for these filters yet.</p>}

      {adding && (
        <ManualEntry
          meta={meta}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
            api.get('/api/months').then(setMonths);
            reloadMeta();
          }}
        />
      )}
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

function ManualEntry({ meta, onClose, onSaved }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10), account: 'Cash', type: 'Expense', category: '', amount: '', description: '', details: '',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    try {
      if (form.category && !meta.categories.some((c) => c.type === form.type && c.name === form.category)) {
        await api.post('/api/categories', { type: form.type, name: form.category });
      }
      await api.post('/api/transactions', form);
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Manual entry</h2>
        <div className="form-grid">
          <label>Date<input type="date" value={form.date} onChange={set('date')} /></label>
          <label>Account<input list="dl-accounts" value={form.account} onChange={set('account')} /></label>
          <label>Type<input list="dl-types" value={form.type} onChange={set('type')} /></label>
          <label>Category<input list={`dl-cat-${form.type}`} value={form.category} onChange={set('category')} /></label>
          <label>Amount (₹)<input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} /></label>
          <label>Description<input list="dl-descriptions" value={form.description} onChange={set('description')} /></label>
          <label className="span-2">More details<input value={form.details} onChange={set('details')} /></label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
