import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { MetaDatalists } from '../components/TxnTable.jsx';
import { useToast } from '../components/Toast.jsx';
import { ImportLedgerButton, ResetLedgerButton } from '../components/LedgerActions.jsx';

const EMPTY_RULE = { pattern: '', direction: '', type: 'Expense', category: '', description: '', ignore: false, priority: 70 };

export default function SettingsPage({ meta, reloadMeta }) {
  const [rules, setRules] = useState([]);
  const [newRule, setNewRule] = useState(EMPTY_RULE);
  const [newCat, setNewCat] = useState({ type: 'Expense', name: '', tag: 'Need' });
  const [newAccount, setNewAccount] = useState('');
  const [ruleFilter, setRuleFilter] = useState('');
  const toast = useToast();

  useEffect(() => {
    api.get('/api/rules').then(setRules);
  }, []);

  const run = async (fn, msg) => {
    try {
      await fn();
      if (msg) toast(msg, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const saveRule = (rule) => run(async () => setRules(await api.put(`/api/rules/${rule.id}`, rule)));
  const addRule = () =>
    run(async () => {
      setRules(await api.post('/api/rules', newRule));
      setNewRule(EMPTY_RULE);
    }, 'Rule added');

  const types = meta.types;
  const visibleRules = rules.filter((r) =>
    [r.pattern, r.category, r.description].some((v) => v?.toLowerCase().includes(ruleFilter.toLowerCase()))
  );

  return (
    <div className="page">
      <MetaDatalists meta={meta} />
      <h1>Settings</h1>

      <section className="card">
        <div className="section-head">
          <div>
            <h2>Auto-mapping rules</h2>
            <p className="muted small">
              If a statement narration contains the pattern, the row gets this type, category and description. Highest
              priority wins. "Ignore" rows are excluded by default (e.g. card bill payments already counted from your bank).
            </p>
          </div>
          <input className="search" placeholder="Filter rules…" value={ruleFilter} onChange={(e) => setRuleFilter(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table className="txn-table rules">
            <thead>
              <tr>
                <th>Narration contains</th><th>Applies to</th><th>Type</th><th>Category</th><th>Description</th>
                <th>Ignore</th><th>Priority</th><th />
              </tr>
            </thead>
            <tbody>
              <RuleRow rule={newRule} onChange={setNewRule} isNew onSave={addRule} types={types} />
              {visibleRules.map((r) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  types={types}
                  onChange={(next) => setRules(rules.map((x) => (x.id === r.id ? next : x)))}
                  onSave={saveRule}
                  onDelete={() => run(async () => setRules(await api.del(`/api/rules/${r.id}`)), 'Rule deleted')}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h2>Ledger data</h2>
            <p className="muted small">
              Import an existing ledger workbook (a sheet with Account, Date, Type, Category and Amount columns —
              e.g. your Expense Tracker's "Entries" sheet) straight into the ledger, or wipe all transactions to
              start over. Re-importing the same file skips rows already in the ledger.
            </p>
          </div>
          <div className="row wrap">
            <ImportLedgerButton onImported={reloadMeta} />
            <ResetLedgerButton onReset={reloadMeta} />
          </div>
        </div>
      </section>

      <div className="settings-grid">
        <section className="card">
          <h2>Categories</h2>
          <div className="row wrap">
            <input list="dl-types" value={newCat.type} onChange={(e) => setNewCat({ ...newCat, type: e.target.value })} placeholder="Type" />
            <input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} placeholder="Category name" />
            <select value={newCat.tag} onChange={(e) => setNewCat({ ...newCat, tag: e.target.value })}>
              <option value="">No tag</option><option>Need</option><option>Want</option>
            </select>
            <button className="btn primary" onClick={() => run(async () => {
              await api.post('/api/categories', newCat);
              await reloadMeta();
              setNewCat({ ...newCat, name: '' });
            }, 'Category added')}>Add</button>
          </div>
          {types.map((t) => (
            <div key={t} className="cat-group">
              <h3>{t}</h3>
              <div className="pill-list">
                {meta.categories.filter((c) => c.type === t).map((c) => (
                  <span key={c.id} className="pill">
                    {c.name}
                    <select
                      className="pill-tag"
                      value={c.tag || ''}
                      onChange={(e) => run(async () => { await api.put(`/api/categories/${c.id}`, { tag: e.target.value }); reloadMeta(); })}
                    >
                      <option value="">–</option><option>Need</option><option>Want</option>
                    </select>
                    <button className="icon-btn" title="Remove from dropdowns" onClick={() => run(async () => {
                      await api.del(`/api/categories/${c.id}`);
                      reloadMeta();
                    })}>✕</button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>Accounts</h2>
          <div className="row">
            <input value={newAccount} onChange={(e) => setNewAccount(e.target.value)} placeholder="Account name" />
            <button className="btn primary" onClick={() => run(async () => {
              await api.post('/api/accounts', { name: newAccount });
              await reloadMeta();
              setNewAccount('');
            }, 'Account added')}>Add</button>
          </div>
          <ul className="file-list">
            {meta.accounts.map((a) => (
              <li key={a.id}>
                <input
                  className="grow"
                  defaultValue={a.name}
                  onBlur={(e) => e.target.value !== a.name && run(async () => {
                    await api.put(`/api/accounts/${a.id}`, { name: e.target.value });
                    reloadMeta();
                  }, 'Account renamed')}
                />
                <span className="muted small">{a.identifier || 'manual'}</span>
                <button className="icon-btn" onClick={() => run(async () => { await api.del(`/api/accounts/${a.id}`); reloadMeta(); })}>✕</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function RuleRow({ rule, onChange, onSave, onDelete, isNew, types }) {
  const set = (k, v) => onChange({ ...rule, [k]: v });
  const blurSave = () => !isNew && onSave(rule);
  return (
    <tr className={isNew ? 'new-rule' : ''}>
      <td><input value={rule.pattern} placeholder={isNew ? 'e.g. DOMINOS' : ''} onChange={(e) => set('pattern', e.target.value)} onBlur={blurSave} /></td>
      <td>
        <select value={rule.direction || ''} onChange={(e) => { const next = { ...rule, direction: e.target.value }; onChange(next); if (!isNew) onSave(next); }}>
          <option value="">Debit & credit</option><option value="debit">Debits</option><option value="credit">Credits</option>
        </select>
      </td>
      <td><input list="dl-types" value={rule.type || ''} onChange={(e) => set('type', e.target.value)} onBlur={blurSave} className="w-type" /></td>
      <td><input list={types.includes(rule.type) ? `dl-cat-${rule.type}` : 'dl-cat-all'} value={rule.category || ''} onChange={(e) => set('category', e.target.value)} onBlur={blurSave} className="w-category" /></td>
      <td><input list="dl-descriptions" value={rule.description || ''} onChange={(e) => set('description', e.target.value)} onBlur={blurSave} /></td>
      <td><input type="checkbox" checked={!!rule.ignore} onChange={(e) => { const next = { ...rule, ignore: e.target.checked }; onChange(next); if (!isNew) onSave(next); }} /></td>
      <td><input type="number" className="w-num" value={rule.priority} onChange={(e) => set('priority', e.target.value)} onBlur={blurSave} /></td>
      <td>
        {isNew
          ? <button className="btn small primary" disabled={!rule.pattern} onClick={onSave}>Add</button>
          : <button className="icon-btn" onClick={onDelete}>✕</button>}
      </td>
    </tr>
  );
}
