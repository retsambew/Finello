import { api, fmtDate, inr } from '../api.js';
import ComboInput from './ComboInput.jsx';

export default function TxnTable({ rows, meta, reloadMeta, onPatch, selected, onToggle, onToggleAll, staged, onDelete }) {
  const categoriesFor = (type) => meta.categories.filter((c) => c.type === type).map((c) => c.name);
  const tagFor = (type, category) => meta.categories.find((c) => c.type === type && c.name === category)?.tag || '';
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const createCategory = async (type, name) => {
    if (!type) return;
    await api.post('/api/categories', { type, name });
    await reloadMeta();
  };
  const createAccount = async (name) => {
    await api.post('/api/accounts', { name });
    await reloadMeta();
  };
  const createType = async (type) => {
    // A new type only exists once it has a category; seed it with a same-named one.
    await api.post('/api/categories', { type, name: type });
    await reloadMeta();
  };

  return (
    <div className="table-wrap">
      <table className="txn-table">
        <thead>
          <tr>
            <th className="col-check">
              <input type="checkbox" checked={allSelected} onChange={() => onToggleAll(!allSelected)} />
            </th>
            {staged && <th title="Include this row when saving">Use</th>}
            <th>Date</th>
            <th>Account</th>
            <th className="col-amount">Amount</th>
            <th>Type</th>
            <th>Category</th>
            <th>Tag</th>
            <th>Sub category</th>
            <th>Description</th>
            <th>Statement narration</th>
            {!staged && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const catMissing = r.include_row && !r.category;
            const rowClass = [
              !r.include_row ? 'excluded' : '',
              r.is_duplicate ? 'dup' : '',
              staged && !r.auto_mapped ? 'needs-review' : '',
              selected.has(r.id) ? 'selected' : '',
            ].join(' ');
            return (
              <tr key={r.id} className={rowClass}>
                <td className="col-check">
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => onToggle(r.id)} />
                </td>
                {staged && (
                  <td>
                    <input
                      type="checkbox"
                      checked={!!r.include_row}
                      onChange={(e) => onPatch(r, { include_row: e.target.checked })}
                    />
                  </td>
                )}
                <td className="nowrap">
                  <input
                    type="date"
                    className="date-input"
                    value={r.date}
                    onChange={(e) => e.target.value && onPatch(r, { date: e.target.value })}
                    title={fmtDate(r.date)}
                  />
                </td>
                <td>
                  <ComboInput
                    value={r.account}
                    options={meta.accounts.map((a) => a.name)}
                    invalid={!r.account}
                    onCreate={createAccount}
                    onCommit={(v) => onPatch(r, { account: v })}
                    className="w-account"
                  />
                </td>
                <td className={`col-amount ${r.direction}`}>
                  {r.direction === 'credit' ? '+' : '−'}
                  {inr(r.amount)}
                </td>
                <td>
                  <ComboInput
                    value={r.type}
                    options={meta.types}
                    onCreate={createType}
                    onCommit={(v) => onPatch(r, { type: v })}
                    className="w-type"
                  />
                </td>
                <td>
                  <ComboInput
                    value={r.category}
                    options={categoriesFor(r.type)}
                    invalid={catMissing}
                    placeholder="Pick or add…"
                    onCreate={(v) => createCategory(r.type, v)}
                    onCommit={(v) => onPatch(r, { category: v })}
                    className="w-category"
                  />
                </td>
                <td>
                  <span className={`tag tag-${tagFor(r.type, r.category).toLowerCase()}`}>{tagFor(r.type, r.category)}</span>
                </td>
                <td>
                  <ComboInput
                    value={r.description}
                    options={meta.descriptions}
                    onCommit={(v) => onPatch(r, { description: v })}
                    className="w-desc"
                  />
                  <div className="badges">
                    {staged && !r.auto_mapped && <span className="badge warn">Needs review</span>}
                    {!!r.is_duplicate && <span className="badge dup" title={r.duplicate_reason}>Duplicate</span>}
                  </div>
                </td>
                <td>
                  <ComboInput
                    value={r.details}
                    options={[]}
                    onCommit={(v) => onPatch(r, { details: v })}
                    className="w-details"
                  />
                </td>
                <td className="narration" title={`${r.narration || ''}\n${r.source_file || ''}`}>
                  {r.narration || <span className="muted">Manual entry</span>}
                </td>
                {!staged && (
                  <td>
                    <button className="icon-btn" title="Delete" onClick={() => onDelete(r)}>✕</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
