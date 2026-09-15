import { Fragment, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { DeleteSettingsButton, FactoryResetButton } from '../components/DangerZoneActions.jsx';
import Modal from '../components/Modal.jsx';
import DeleteButton from '../components/DeleteButton.jsx';
import Select from '../components/Select.jsx';
import ComboInput from '../components/ComboInput.jsx';

const EMPTY_RULE = { pattern: '', direction: '', type: 'Expense', category: '', description: '', details: '', ignore: false, priority: 70 };
const TABS = ['Categories', 'Auto-mapping', 'Accounts & data'];

export default function SettingsPage({ meta, reloadMeta }) {
  const [tab, setTab] = useState('Categories');
  return (
    <div className="page page-mid">
      <h1>Settings</h1>
      <div className="tabs subtabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Categories' && <CategoriesTab meta={meta} reloadMeta={reloadMeta} />}
      {tab === 'Auto-mapping' && <RulesTab meta={meta} />}
      {tab === 'Accounts & data' && <AccountsTab meta={meta} reloadMeta={reloadMeta} />}
    </div>
  );
}

// Wraps a toast with an `undo` action: fire `deleteFn`, tell the user, and give them a
// button that runs `restoreFn` to put it back. Used everywhere something can be removed
// with one click, so that click doesn't have to be scary.
function useRun() {
  const toast = useToast();
  const run = async (fn, msg) => {
    try {
      await fn();
      if (msg) toast(msg, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const runDeleteWithUndo = (deleteFn, restoreFn, msg) => run(async () => {
    await deleteFn();
    toast(msg, 'success', { label: 'Undo', onClick: () => run(restoreFn) });
  });
  return { run, toast, runDeleteWithUndo };
}

// ---------- Categories & sub categories ----------

function CategoriesTab({ meta, reloadMeta }) {
  const [usage, setUsage] = useState({});
  const [descDetail, setDescDetail] = useState([]);
  const [newCat, setNewCat] = useState({ type: 'Expense', name: '', tag: 'Need' });
  const [newDesc, setNewDesc] = useState('');
  const [descSearch, setDescSearch] = useState('');
  const { run, runDeleteWithUndo } = useRun();

  const loadUsage = () => {
    api.get('/api/categories/usage').then(setUsage);
    api.get('/api/descriptions/detail').then(setDescDetail);
  };
  useEffect(loadUsage, []);

  const types = meta.types;
  const q = descSearch.trim().toLowerCase();
  const filteredDesc = descDetail.filter((d) => !q || d.name.toLowerCase().includes(q));

  const addCategory = (e) => {
    e.preventDefault();
    if (!newCat.type.trim() || !newCat.name.trim()) return;
    run(async () => {
      await api.post('/api/categories', newCat);
      await reloadMeta();
      loadUsage();
      setNewCat({ ...newCat, name: '' });
    }, 'Category added');
  };

  const addDescription = (e) => {
    e.preventDefault();
    if (!newDesc.trim()) return;
    run(async () => {
      await api.post('/api/descriptions', { name: newDesc.trim() });
      setNewDesc('');
      await reloadMeta();
      loadUsage();
    }, 'Sub category added');
  };

  return (
    <>
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Categories</h2>
            <p className="muted small">Click a name to rename it. Hover a row to edit its tag or remove it.</p>
          </div>
          <form className="row wrap" onSubmit={addCategory}>
            <ComboInput
              value={newCat.type}
              options={meta.types}
              placeholder="Type"
              className="w-type"
              onCommit={(v) => setNewCat({ ...newCat, type: v })}
            />
            <input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} placeholder="New category name" title={newCat.name} />
            <Select value={newCat.tag} onChange={(e) => setNewCat({ ...newCat, tag: e.target.value })}>
              <option value="">No tag</option><option>Need</option><option>Want</option>
            </Select>
            <button type="submit" className="btn primary small" disabled={!newCat.type.trim() || !newCat.name.trim()}>Add</button>
          </form>
        </div>

        <div className="table-wrap">
          <table className="txn-table mgmt-table">
            <thead>
              <tr><th>Category</th><th style={{ width: 90 }}>Tag</th><th className="center" style={{ width: 60 }}>Used</th><th style={{ width: 34 }} /></tr>
            </thead>
            <tbody>
              {types.map((t) => {
                const cats = meta.categories.filter((c) => c.type === t);
                return (
                  <Fragment key={t}>
                    <tr className="group-row"><td colSpan={4}>{t}</td></tr>
                    {cats.map((c) => (
                      <CategoryRow
                        key={c.id}
                        cat={c}
                        usage={usage[`${c.type}|${c.name}`]}
                        onRename={(name) => run(async () => {
                          await api.put(`/api/categories/${c.id}`, { name });
                          await reloadMeta();
                          loadUsage();
                        })}
                        onTag={(tag) => run(async () => { await api.put(`/api/categories/${c.id}`, { tag }); reloadMeta(); })}
                        onDelete={() => runDeleteWithUndo(
                          async () => { await api.del(`/api/categories/${c.id}`); await reloadMeta(); loadUsage(); },
                          async () => { await api.post('/api/categories', { type: c.type, name: c.name, tag: c.tag }); await reloadMeta(); loadUsage(); },
                          `"${c.name}" removed from the picker`
                        )}
                      />
                    ))}
                    {cats.length === 0 && <tr><td colSpan={4} className="muted small">No categories yet.</td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h2>Sub categories</h2>
            <p className="muted small">
              Every merchant / sub category value used across rules and the ledger. Renaming merges it
              everywhere it's used; deleting only removes it from the "pick or add new" dropdowns.
            </p>
          </div>
          <input className="search" placeholder="Filter sub categories…" value={descSearch} onChange={(e) => setDescSearch(e.target.value)} />
        </div>
        <form className="row" style={{ marginBottom: 10 }} onSubmit={addDescription}>
          <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="New sub category name" title={newDesc} />
          <button type="submit" className="btn primary small" disabled={!newDesc.trim()}>Add</button>
        </form>
        <div className="table-wrap">
          <table className="txn-table mgmt-table">
            <thead>
              <tr><th>Sub category</th><th className="center" style={{ width: 60 }}>Used</th><th style={{ width: 34 }} /></tr>
            </thead>
            <tbody>
              {filteredDesc.map((d) => (
                <DescRow
                  key={d.name}
                  detail={d}
                  onRename={(name) => run(async () => {
                    await api.put('/api/descriptions', { oldName: d.name, name });
                    await reloadMeta();
                    loadUsage();
                  })}
                  onDelete={() => runDeleteWithUndo(
                    async () => { await api.del('/api/descriptions', { name: d.name }); await reloadMeta(); loadUsage(); },
                    async () => { await api.post('/api/descriptions', { name: d.name }); await reloadMeta(); loadUsage(); },
                    `"${d.name}" removed from the picker`
                  )}
                />
              ))}
              {filteredDesc.length === 0 && <tr><td colSpan={3} className="muted small">No matches.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function useInlineName(name, onRename) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  return {
    value: draft,
    title: name,
    onChange: (e) => setDraft(e.target.value),
    onBlur: () => {
      const v = draft.trim() || name;
      setDraft(v);
      if (v !== name) onRename(v);
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter') e.currentTarget.blur();
      if (e.key === 'Escape') { setDraft(name); e.currentTarget.blur(); }
    },
  };
}

function CategoryRow({ cat, usage, onRename, onTag, onDelete }) {
  const nameProps = useInlineName(cat.name, onRename);
  const total = (usage?.transactions || 0) + (usage?.rules || 0);
  return (
    <tr>
      <td><input {...nameProps} /></td>
      <td>
        <Select value={cat.tag || ''} onChange={(e) => onTag(e.target.value)}>
          <option value="">–</option><option>Need</option><option>Want</option>
        </Select>
      </td>
      <td className="center muted small" title={`${usage?.transactions || 0} transactions, ${usage?.rules || 0} rules`}>{total || '–'}</td>
      <td className="row-actions"><DeleteButton onConfirm={onDelete} title="Remove from the picker" /></td>
    </tr>
  );
}

function DescRow({ detail: d, onRename, onDelete }) {
  const nameProps = useInlineName(d.name, onRename);
  const total = d.transactions + d.rules;
  return (
    <tr>
      <td><input {...nameProps} /></td>
      <td className="center muted small" title={`${d.transactions} transactions, ${d.rules} rules`}>{total || '–'}</td>
      <td className="row-actions"><DeleteButton onConfirm={onDelete} title="Remove from the picker" /></td>
    </tr>
  );
}

// ---------- Auto-mapping rules ----------

function RulesTab({ meta }) {
  const [rules, setRules] = useState([]);
  const [filter, setFilter] = useState('');
  const [modalRule, setModalRule] = useState(null);
  const { run, runDeleteWithUndo } = useRun();

  useEffect(() => { api.get('/api/rules').then(setRules); }, []);

  const saveRule = () => run(async () => {
    setRules(modalRule.id ? await api.put(`/api/rules/${modalRule.id}`, modalRule) : await api.post('/api/rules', modalRule));
    setModalRule(null);
  }, modalRule.id ? 'Rule saved' : 'Rule added');

  const deleteRule = (rule) => {
    if (modalRule?.id === rule.id) setModalRule(null);
    return runDeleteWithUndo(
      async () => setRules(await api.del(`/api/rules/${rule.id}`)),
      async () => setRules(await api.post('/api/rules', rule)),
      'Rule deleted'
    );
  };

  const q = filter.trim().toLowerCase();
  const visible = rules.filter((r) => !q || [r.pattern, r.category, r.description, r.details].some((v) => v?.toLowerCase().includes(q)));

  return (
    <section className="card">
      <div className="section-head">
        <div>
          <h2>Auto-mapping rules</h2>
          <p className="muted small">
            If a statement narration contains the pattern, the row gets this type, category, sub category and
            description. Highest priority wins. "Ignore" rules exclude the row by default (e.g. card bill
            payments already counted from your bank).
          </p>
        </div>
        <div className="row wrap">
          <input className="search" placeholder="Filter rules…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="btn primary" onClick={() => setModalRule({ ...EMPTY_RULE })}>+ New rule</button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="txn-table mgmt-table">
          <thead>
            <tr>
              <th>Narration contains</th><th>Applies to</th><th>Type</th><th>Category</th><th>Sub category</th>
              <th>Description</th><th className="center">Ignore</th><th className="center">Priority</th><th style={{ width: 54 }} />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <ViewRuleRow key={r.id} rule={r} onEdit={() => setModalRule({ ...r })} onDelete={() => deleteRule(r)} />
            ))}
            {visible.length === 0 && <tr><td colSpan={9} className="muted small">No rules match.</td></tr>}
          </tbody>
        </table>
      </div>

      {modalRule && (
        <RuleModal
          rule={modalRule}
          onChange={setModalRule}
          meta={meta}
          onClose={() => setModalRule(null)}
          onSave={saveRule}
          onDelete={modalRule.id ? () => deleteRule(modalRule) : undefined}
        />
      )}
    </section>
  );
}

function ViewRuleRow({ rule: r, onEdit, onDelete }) {
  const dirLabel = r.direction === 'debit' ? 'Debits' : r.direction === 'credit' ? 'Credits' : 'Both';
  return (
    <tr onDoubleClick={onEdit}>
      <td className="rule-pattern-cell" title={r.pattern}>{r.pattern}</td>
      <td className="muted small nowrap">{dirLabel}</td>
      <td className="rule-cat-cell" title={r.type || ''}>{r.type || <span className="muted">–</span>}</td>
      <td className="rule-cat-cell" title={r.category || ''}>{r.category || <span className="muted">–</span>}</td>
      <td className="rule-cat-cell" title={r.description || ''}>{r.description || <span className="muted">–</span>}</td>
      <td className="rule-cat-cell muted small" title={r.details || ''}>{r.details || '–'}</td>
      <td className="center">{r.ignore ? '✓' : ''}</td>
      <td className="center muted small">{r.priority}</td>
      <td className="row-actions">
        <button className="icon-btn" title="Edit rule" onClick={onEdit}>✎</button>
        <DeleteButton onConfirm={onDelete} title="Delete rule" />
      </td>
    </tr>
  );
}

function RuleModal({ rule, onChange, onClose, onSave, onDelete, meta }) {
  const set = (k, v) => onChange({ ...rule, [k]: v });
  const isEdit = !!rule.id;
  const valid = rule.pattern.trim().length > 0;
  return (
    <Modal onClose={onClose} onSubmit={() => valid && onSave()}>
      <h2>{isEdit ? 'Edit rule' : 'New rule'}</h2>
      <div className="form-grid">
        <label className="span-2">Narration contains
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- opening the modal should put you straight into the one field every rule needs */}
          <input autoFocus value={rule.pattern} placeholder="e.g. DOMINOS" onChange={(e) => set('pattern', e.target.value.toUpperCase())} />
        </label>
        <label>Applies to
          <Select value={rule.direction || ''} onChange={(e) => set('direction', e.target.value)}>
            <option value="">Debit & credit</option><option value="debit">Debits only</option><option value="credit">Credits only</option>
          </Select>
        </label>
        <label>Priority
          <input type="number" value={rule.priority} onChange={(e) => set('priority', e.target.value)} />
        </label>
        <label>Type
          <ComboInput value={rule.type || ''} options={meta.types} onCommit={(v) => set('type', v)} />
        </label>
        <label>Category
          <ComboInput
            value={rule.category || ''}
            options={meta.categories.filter((c) => c.type === rule.type).map((c) => c.name)}
            onCommit={(v) => set('category', v)}
          />
        </label>
        <label>Sub category
          <ComboInput value={rule.description || ''} options={meta.descriptions} onCommit={(v) => set('description', v)} />
        </label>
        <label>Description
          <input value={rule.details || ''} onChange={(e) => set('details', e.target.value)} />
        </label>
        <label className="toggle-label span-2">
          <input type="checkbox" checked={!!rule.ignore} onChange={(e) => set('ignore', e.target.checked)} />
          Ignore by default
        </label>
      </div>
      <div className="modal-actions">
        {onDelete && <DeleteButton className="btn danger" label="Delete rule" confirmLabel="Confirm delete?" title="Delete rule" onConfirm={onDelete} />}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!valid} onClick={onSave}>{isEdit ? 'Save' : 'Add rule'}</button>
      </div>
    </Modal>
  );
}

// ---------- Accounts & bulk data ----------

function AccountsTab({ meta, reloadMeta }) {
  const [newAccount, setNewAccount] = useState('');
  const { run, runDeleteWithUndo } = useRun();

  const addAccount = (e) => {
    e.preventDefault();
    if (!newAccount.trim()) return;
    run(async () => {
      await api.post('/api/accounts', { name: newAccount });
      await reloadMeta();
      setNewAccount('');
    }, 'Account added');
  };

  return (
    <>
      <section className="card">
        <h2>Accounts</h2>
        <form className="row" onSubmit={addAccount}>
          <input value={newAccount} onChange={(e) => setNewAccount(e.target.value)} placeholder="Account name" title={newAccount} />
          <button type="submit" className="btn primary" disabled={!newAccount.trim()}>Add</button>
        </form>
        <ul className="file-list">
          {meta.accounts.map((a) => (
            <li key={a.id}>
              <input
                className="grow"
                defaultValue={a.name}
                title={a.name}
                onBlur={(e) => e.target.value !== a.name && run(async () => {
                  await api.put(`/api/accounts/${a.id}`, { name: e.target.value });
                  reloadMeta();
                }, 'Account renamed')}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = a.name; e.currentTarget.blur(); } }}
              />
              <span className="muted small" title={a.identifier || 'Manually created — not matched to a statement'}>{a.identifier || 'manual'}</span>
              <DeleteButton
                title="Delete account"
                onConfirm={() => runDeleteWithUndo(
                  async () => { await api.del(`/api/accounts/${a.id}`); await reloadMeta(); },
                  async () => { await api.post('/api/accounts', { name: a.name, identifier: a.identifier }); await reloadMeta(); },
                  `"${a.name}" deleted`
                )}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="card danger-zone">
        <h2>Danger zone</h2>
        <p className="muted small">
          These actions are permanent and cannot be undone.
        </p>
        <div className="row wrap">
          <DeleteSettingsButton onDone={reloadMeta} />
          <FactoryResetButton onDone={reloadMeta} />
        </div>
      </section>
    </>
  );
}
