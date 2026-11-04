import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, inr, fmtDate } from '../api.js';
import DateRangePicker, { defaultRange } from '../components/DateRangePicker.jsx';
import Select from '../components/Select.jsx';
import Switch from '../components/Switch.jsx';

// Read-only analysis over committed ledger rows. Everything is computed client-side from
// the same GET /api/transactions the Ledger uses — this page never writes anything.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromIso = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
const dayDiff = (a, b) => Math.round((fromIso(b) - fromIso(a)) / 864e5);

const compact = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${+(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `₹${+(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${+(n / 1e3).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
};
const pct = (n) => `${(n * 100).toFixed(n !== 0 && Math.abs(n) < 0.1 ? 1 : 0)}%`;

function niceMax(max) {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

// The window the current range is compared against: the same-length span immediately
// before it, or the same dates one year earlier.
function compareRange(from, to, mode) {
  if (!from || !to || mode === 'none') return null;
  if (mode === 'yoy') {
    const shift = (iso) => {
      const [y, m, d] = iso.split('-');
      return `${+y - 1}-${m}-${m === '02' && d === '29' ? '28' : d}`;
    };
    return { from: shift(from), to: shift(to) };
  }
  const len = dayDiff(from, to) + 1;
  const pTo = addDays(fromIso(from), -1);
  return { from: toIso(addDays(pTo, -(len - 1))), to: toIso(pTo) };
}

// Daily buckets for short ranges, monthly otherwise; empty buckets are kept so gaps show.
function buildTrend(rows, from, to) {
  const dates = rows.map((r) => r.date).sort();
  const start = from || dates[0];
  const end = to || dates[dates.length - 1];
  if (!start || !end || start > end) return { buckets: [], keyOf: (d) => d };
  const daily = dayDiff(start, end) <= 45;
  const keyOf = daily ? (d) => d : (d) => d.slice(0, 7);
  const buckets = [];
  if (daily) {
    for (let d = fromIso(start); d <= fromIso(end); d = addDays(d, 1)) {
      const key = toIso(d);
      buckets.push({ key, label: String(d.getDate()), long: fmtDate(key) });
    }
  } else {
    let [y, m] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    const multiYear = y !== ey;
    while (y < ey || (y === ey && m <= em)) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      buckets.push({ key, label: multiYear ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : MONTHS[m - 1], long: `${MONTHS[m - 1]} ${y}` });
      if (++m > 12) { m = 1; y++; }
    }
  }
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  for (const b of buckets) { b.total = 0; b.count = 0; }
  for (const r of rows) {
    const b = buckets[idx.get(keyOf(r.date))];
    if (b) { b.total += r.amount; b.count++; }
  }
  return { buckets, keyOf, daily };
}

function group(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r) || '';
    let g = m.get(k);
    if (!g) m.set(k, (g = { key: k, total: 0, count: 0, max: 0, rows: [] }));
    g.total += r.amount;
    g.count++;
    g.rows.push(r);
    if (r.amount > g.max) g.max = r.amount;
  }
  return m;
}

function sortList(list, { key, dir }) {
  const sign = dir === 'asc' ? 1 : -1;
  const val = (x) => (key === 'avg' ? x.total / (x.count || 1) : key === 'delta' ? x.delta ?? -Infinity : x[key]);
  return [...list].sort((a, b) => {
    if (key === 'name') return sign * (a.key || '').localeCompare(b.key || '');
    return sign * (val(a) - val(b));
  });
}

// Mirrors merchantKey() in server/src/rules.js: raw narrations are nearly all unique (UPI
// refs, card refs), so grouping needs the payee part only — strip UPI-/PAYU*-style prefixes,
// "(Ref# ...)" and anything after a double space, then title-case it.
function payeeOf(narration) {
  let s = String(narration || '').replace(/\(Ref#[^)]*\)/gi, '').trim();
  if (/^UPI-/i.test(s)) s = s.split('-')[1] || s;
  else if (/^(PAYU|RAZORPAY|RAZ|RSP)\*/i.test(s)) s = s.replace(/^[A-Z]+\*/i, '');
  s = s.replace(/\s{2,}.*$/, '').replace(/\s+/g, ' ').trim();
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
const withPayee = (rows) => rows.map((r) => ({ ...r, payee: payeeOf(r.narration) }));

// Note the column/label flip (see CLAUDE.md): `description` is shown as "Sub category",
// `details` as "Description".
const GROUPS = [
  ['category', 'Category → Sub category'],
  ['description', 'Sub category'],
  ['details', 'Description'],
  ['payee', 'Narration (payee)'],
  ['account', 'Account'],
];
const DIMS = ['category', 'description', 'details', 'payee', 'account'];
const DIM_LABEL = {
  category: 'Category', description: 'Sub category', details: 'Description', payee: 'Payee', account: 'Account', bucket: 'Period',
};
const SEARCH_FIELDS = {
  any: ['description', 'details', 'narration'],
  description: ['description'],
  details: ['details'],
  narration: ['narration'],
};

function searchFilter(rows, { q, field, exact }) {
  const term = q.trim().toLowerCase();
  if (!term) return rows;
  const fields = SEARCH_FIELDS[field];
  return rows.filter((r) => fields.some((f) => {
    const v = String(r[f] || '').toLowerCase();
    return exact ? v === term : v.includes(term);
  }));
}

export default function AnalysisPage({ meta }) {
  const [filters, setFilters] = useState({ ...defaultRange(), account: '' });
  const [type, setType] = useState(meta.types.includes('Expense') ? 'Expense' : meta.types[0] || '');
  const [compare, setCompare] = useState('prev');
  const [groupBy, setGroupBy] = useState('category');
  const [rows, setRows] = useState(null);
  const [prevRows, setPrevRows] = useState([]);
  const [drill, setDrill] = useState({});
  const [expanded, setExpanded] = useState(new Set());
  const [sort, setSort] = useState({ key: 'total', dir: 'desc' });
  const [search, setSearch] = useState({ q: '', field: 'any', exact: false });

  const cmp = useMemo(() => compareRange(filters.from, filters.to, compare), [filters.from, filters.to, compare]);

  useEffect(() => {
    let cancelled = false;
    const qs = (f) => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    Promise.all([
      api.get(`/api/transactions?${qs(filters)}`),
      cmp ? api.get(`/api/transactions?${qs({ ...cmp, account: filters.account })}`) : Promise.resolve([]),
    ]).then(([cur, prev]) => {
      if (cancelled) return;
      setRows(withPayee(cur));
      setPrevRows(withPayee(prev));
    });
    return () => { cancelled = true; };
  }, [filters, cmp]);

  // Any change to what's being analysed invalidates the current drill-down.
  useEffect(() => { setDrill({}); setExpanded(new Set()); }, [filters, type, groupBy]);

  const tagOf = useMemo(() => {
    const m = new Map();
    for (const c of meta.categories) m.set(`${c.type}|${c.name}`, c.tag);
    return m;
  }, [meta.categories]);

  const all = useMemo(() => rows || [], [rows]);
  const typed = useMemo(() => searchFilter(all.filter((r) => r.type === type), search), [all, type, search]);
  const prevTyped = useMemo(() => searchFilter(prevRows.filter((r) => r.type === type), search), [prevRows, type, search]);

  // Bucket span comes from the whole typed set so drilling never flips day <-> month buckets.
  const span = useMemo(() => {
    const dates = typed.map((r) => r.date).sort();
    return { from: filters.from || dates[0], to: filters.to || dates[dates.length - 1] };
  }, [typed, filters.from, filters.to]);
  const trend = useMemo(() => buildTrend(typed, span.from, span.to), [typed, span]);

  // Each view is filtered by every drill dimension except the ones it sets itself, so the
  // view you clicked keeps showing the full picture with your pick highlighted.
  const matches = (r, skip = []) =>
    DIMS.every((d) => skip.includes(d) || drill[d] === undefined || (r[d] || '') === drill[d]) &&
    (skip.includes('bucket') || !drill.bucket || trend.keyOf(r.date) === drill.bucket);
  const breakdownSkip = groupBy === 'category' ? ['category', 'description'] : [groupBy];
  const scoped = typed.filter((r) => matches(r));
  const forTrend = typed.filter((r) => matches(r, ['bucket']));
  const forBreakdown = typed.filter((r) => matches(r, breakdownSkip));
  const prevScoped = prevTyped.filter((r) => matches(r, ['bucket']));

  const trendView = buildTrend(forTrend, span.from, span.to);

  const cash = useMemo(() => {
    const t = {};
    for (const r of all) t[r.type] = (t[r.type] || 0) + r.amount;
    return t;
  }, [all]);

  const kpi = (() => {
    const total = scoped.reduce((s, r) => s + r.amount, 0);
    const largest = scoped.reduce((m, r) => (!m || r.amount > m.amount ? r : m), null);
    const dates = scoped.map((r) => r.date).sort();
    const start = drill.bucket ? null : filters.from || dates[0];
    const end = drill.bucket ? null : filters.to || dates[dates.length - 1];
    const days = start && end ? dayDiff(start, end) + 1 : 0;
    const prevTotal = prevScoped.reduce((s, r) => s + r.amount, 0);
    let need = 0;
    let want = 0;
    for (const r of scoped) {
      const tag = tagOf.get(`${r.type}|${r.category}`);
      if (tag === 'Need') need += r.amount;
      else if (tag === 'Want') want += r.amount;
    }
    return { total, count: scoped.length, largest, days, prevTotal, need, want };
  })();

  const breakdown = (() => {
    const keyFn = (r) => r[groupBy];
    const cur = group(forBreakdown, keyFn);
    const prev = cmp && !drill.bucket ? group(prevTyped.filter((r) => matches(r, [...breakdownSkip, 'bucket'])), keyFn) : null;
    if (prev) for (const k of prev.keys()) if (!cur.has(k)) cur.set(k, { key: k, total: 0, count: 0, max: 0, rows: [] });
    const total = forBreakdown.reduce((s, r) => s + r.amount, 0) || 1;
    const withMeta = (g, p) => ({
      ...g,
      share: g.total / total,
      prev: p ? p.total : null,
      delta: p ? (p.total ? (g.total - p.total) / p.total : g.total ? Infinity : 0) : null,
    });
    const list = [...cur.values()].map((g) => {
      const p = prev ? prev.get(g.key) || { total: 0, rows: [] } : null;
      const out = withMeta(g, p);
      if (groupBy === 'category') {
        const sub = group(g.rows, (r) => r.description);
        const psub = p ? group(p.rows, (r) => r.description) : null;
        out.children = [...sub.values()].map((s) => withMeta(s, psub ? psub.get(s.key) || { total: 0 } : null));
      }
      return out;
    });
    return { list, total };
  })();

  const pick = (patch) => setDrill((d) => {
    const next = { ...d, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === null) delete next[k];
    return next;
  });
  const clearDim = (dim) => pick(dim === 'category' ? { category: undefined, description: undefined } : { [dim]: undefined });

  const upIsGood = type === 'Income' || type === 'Investment';
  const bucketLabel = drill.bucket && trend.buckets.find((b) => b.key === drill.bucket)?.long;

  if (!rows) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Analysis</h1>
          <p className="muted small">Click a bar or a row to drill in. Everything here is read-only.</p>
        </div>
      </div>

      <div className="toolbar">
        <DateRangePicker from={filters.from} to={filters.to} onChange={(range) => setFilters({ ...filters, ...range })} />
        <Select value={filters.account} onChange={(e) => setFilters({ ...filters, account: e.target.value })}>
          <option value="">All accounts</option>
          {meta.accounts.map((a) => <option key={a.id}>{a.name}</option>)}
        </Select>
        <div className="chips">
          {meta.types.map((t) => (
            <button key={t} className={`chip ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>{t}</button>
          ))}
        </div>
        <Select value={compare} onChange={(e) => setCompare(e.target.value)}>
          <option value="prev">vs previous period</option>
          <option value="yoy">vs same period last year</option>
          <option value="none">No comparison</option>
        </Select>
      </div>

      <div className="toolbar">
        <input
          className="search"
          placeholder="Filter by text…"
          value={search.q}
          onChange={(e) => setSearch({ ...search, q: e.target.value })}
        />
        <Select value={search.field} onChange={(e) => setSearch({ ...search, field: e.target.value })}>
          <option value="any">in any field</option>
          <option value="description">in Sub category</option>
          <option value="details">in Description</option>
          <option value="narration">in Narration</option>
        </Select>
        <Switch
          checked={search.exact}
          onChange={(exact) => setSearch({ ...search, exact })}
          label="Exact match"
          title="Match the whole field exactly (ignoring case), instead of anywhere inside it"
        />
        {search.q && <button className="btn small ghost" onClick={() => setSearch({ q: '', field: 'any', exact: false })}>Clear</button>}
      </div>

      <div className="cashflow muted small">
        <span>Income <strong className="credit-ink">{inr(cash.Income)}</strong></span>
        <span>Expense <strong className="debit-ink">{inr(cash.Expense)}</strong></span>
        <span>Investment <strong>{inr(cash.Investment)}</strong></span>
        {cash.Income > 0 && (
          <span title="(Income − Expense) / Income">
            Savings rate <strong>{pct(((cash.Income || 0) - (cash.Expense || 0)) / cash.Income)}</strong>
          </span>
        )}
        {cmp && <span>Comparing with {fmtDate(cmp.from)} – {fmtDate(cmp.to)}</span>}
      </div>

      {Object.keys(drill).length > 0 && (
        <div className="toolbar secondary">
          <span className="muted small">Drilled into:</span>
          {Object.entries(drill).map(([dim, v]) => (
            <button key={dim} className="chip active" onClick={() => clearDim(dim)} title="Remove">
              {DIM_LABEL[dim]}: {dim === 'bucket' ? bucketLabel : v || '(none)'} ✕
            </button>
          ))}
          <button className="btn small ghost" onClick={() => setDrill({})}>Clear all</button>
        </div>
      )}

      <div className="stats">
        <Stat label={`Total ${type.toLowerCase()}`} value={inr(kpi.total)}
          sub={!drill.bucket && cmp ? <Delta cur={kpi.total} prev={kpi.prevTotal} upIsGood={upIsGood} showPrev /> : null} />
        <Stat label="Transactions" value={kpi.count.toLocaleString('en-IN')} />
        <Stat label="Average per transaction" value={inr(kpi.count ? kpi.total / kpi.count : 0)} />
        {kpi.days > 1 && (
          <Stat label={kpi.days > 62 ? 'Average per month' : 'Average per day'}
            value={inr(kpi.days > 62 ? kpi.total / (kpi.days / 30.44) : kpi.total / kpi.days)} />
        )}
        {kpi.largest && (
          <Stat label="Largest" value={inr(kpi.largest.amount)}
            sub={<span className="muted small">{kpi.largest.description || kpi.largest.category} · {fmtDate(kpi.largest.date)}</span>} />
        )}
      </div>

      {type === 'Expense' && kpi.need + kpi.want > 0 && <NeedWant need={kpi.need} want={kpi.want} total={kpi.total} />}

      <div className="card">
        <div className="section-head">
          <h2>{type} over time{drill.category ? ` · ${drill.description || drill.category}` : ''}</h2>
          <span className="muted small">{trendView.daily ? 'Daily' : 'Monthly'} totals · click a bar to focus that period</span>
        </div>
        {trendView.buckets.length ? (
          <TrendChart buckets={trendView.buckets} activeKey={drill.bucket} onPick={(key) => pick({ bucket: key ?? undefined })} />
        ) : <p className="muted">Nothing in this range.</p>}
      </div>

      <div className="card">
        <div className="section-head">
          <h2>Breakdown{bucketLabel ? ` · ${bucketLabel}` : ''}</h2>
          <div className="chips">
            {GROUPS.map(([k, label]) => (
              <button key={k} className={`chip ${groupBy === k ? 'active' : ''}`} onClick={() => setGroupBy(k)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table className="txn-table analysis-table">
            <thead>
              <tr>
                <SortTh k="name" sort={sort} setSort={setSort}>{GROUPS.find(([k]) => k === groupBy)[1]}</SortTh>
                <SortTh k="total" sort={sort} setSort={setSort} className="num">Total</SortTh>
                <SortTh k="share" sort={sort} setSort={setSort} className="share-col">Share</SortTh>
                <SortTh k="count" sort={sort} setSort={setSort} className="num">Txns</SortTh>
                <SortTh k="avg" sort={sort} setSort={setSort} className="num">Avg</SortTh>
                <SortTh k="max" sort={sort} setSort={setSort} className="num">Largest</SortTh>
                {cmp && !drill.bucket && <SortTh k="delta" sort={sort} setSort={setSort} className="num">Change</SortTh>}
              </tr>
            </thead>
            <tbody>
              {sortList(breakdown.list, sort).map((g) => {
                const isOpen = expanded.has(g.key);
                const active = drill[groupBy] === g.key && drill.description === undefined;
                return (
                  <Fragment key={g.key}>
                    <BreakdownRow
                      g={g}
                      active={groupBy === 'category' ? active : drill[groupBy] === g.key}
                      showDelta={cmp && !drill.bucket}
                      upIsGood={upIsGood}
                      toggle={groupBy === 'category' && g.children.length > 0 ? () => {
                        const next = new Set(expanded);
                        next.has(g.key) ? next.delete(g.key) : next.add(g.key);
                        setExpanded(next);
                      } : null}
                      open={isOpen}
                      onPick={() => {
                        if (groupBy === 'category') pick(active ? { category: undefined, description: undefined } : { category: g.key, description: undefined });
                        else pick({ [groupBy]: drill[groupBy] === g.key ? undefined : g.key });
                      }}
                    />
                    {isOpen && sortList(g.children, sort).map((s) => {
                      const subActive = drill.category === g.key && drill.description === s.key;
                      return (
                        <BreakdownRow key={`${g.key}|${s.key}`} g={s} child active={subActive}
                          showDelta={cmp && !drill.bucket} upIsGood={upIsGood}
                          onPick={() => pick(subActive ? { description: undefined } : { category: g.key, description: s.key })} />
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {breakdown.list.length === 0 && <p className="muted center">Nothing to break down.</p>}
      </div>

      <TxnList rows={scoped} />
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function Delta({ cur, prev, upIsGood, showPrev }) {
  if (prev === null || prev === undefined) return null;
  if (!prev && !cur) return <span className="muted small">—</span>;
  if (!prev) return <span className="delta small">new</span>;
  const d = (cur - prev) / prev;
  const good = d === 0 ? null : (d > 0) === upIsGood;
  return (
    <span className={`delta small ${good === null ? '' : good ? 'good' : 'bad'}`} title={`Before: ${inr(prev)}`}>
      {d > 0 ? '▲' : d < 0 ? '▼' : ''} {pct(Math.abs(d))}
      {showPrev && <span className="muted"> vs {inr(prev)}</span>}
    </span>
  );
}

function NeedWant({ need, want, total }) {
  const other = Math.max(total - need - want, 0);
  const segs = [['Need', need, 'need'], ['Want', want, 'want'], ['Untagged', other, 'other']].filter(([, v]) => v > 0);
  return (
    <div className="card needwant">
      <div className="section-head">
        <h2>Needs vs wants</h2>
        <div className="legend small">
          {segs.map(([label, v, cls]) => (
            <span key={label}><i className={`swatch ${cls}`} />{label} <strong>{inr(v)}</strong> <span className="muted">({pct(v / total)})</span></span>
          ))}
        </div>
      </div>
      <div className="seg-bar" role="img" aria-label={segs.map(([l, v]) => `${l} ${pct(v / total)}`).join(', ')}>
        {segs.map(([label, v, cls]) => (
          <span key={label} className={`seg ${cls}`} style={{ flexGrow: v }} title={`${label}: ${inr(v)} (${pct(v / total)})`} />
        ))}
      </div>
    </div>
  );
}

function TrendChart({ buckets, activeKey, onPick }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...buckets.map((b) => b.total), 0);
  const top = niceMax(max);
  const avg = buckets.reduce((s, b) => s + b.total, 0) / buckets.length;
  const every = Math.ceil(buckets.length / 14);
  const h = hover !== null ? buckets[hover] : null;
  return (
    <div className="trend">
      <div className="trend-plot">
        {[1, 0.5, 0].map((f) => (
          <div key={f} className="trend-grid" style={{ bottom: `${f * 100}%` }}><span>{compact(top * f)}</span></div>
        ))}
        {avg > 0 && (
          <div className="trend-avg" style={{ bottom: `${(avg / top) * 100}%` }}><span>avg {compact(avg)}</span></div>
        )}
        <div className="trend-bars" onMouseLeave={() => setHover(null)}>
          {buckets.map((b, i) => (
            <button
              key={b.key}
              className={`trend-col ${activeKey === b.key ? 'active' : ''} ${activeKey && activeKey !== b.key ? 'dim' : ''}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onPick(activeKey === b.key ? null : b.key)}
              aria-label={`${b.long}: ${inr(b.total)}, ${b.count} transactions`}
            >
              <span className="trend-bar" style={{ height: `${(b.total / top) * 100}%` }} />
            </button>
          ))}
        </div>
        {h && (
          <div className="trend-tip" style={{ left: `${((hover + 0.5) / buckets.length) * 100}%` }}>
            <div className="muted small">{h.long}</div>
            <strong>{inr(h.total)}</strong>
            <div className="muted small">{h.count} txn{h.count === 1 ? '' : 's'}</div>
          </div>
        )}
      </div>
      <div className="trend-labels">
        {buckets.map((b, i) => <span key={b.key}>{i % every === 0 ? b.label : ''}</span>)}
      </div>
    </div>
  );
}

function SortTh({ k, sort, setSort, children, className = '' }) {
  const active = sort.key === k;
  return (
    <th className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        className={`sort-btn ${active ? 'active' : ''}`}
        onClick={() => setSort({ key: k, dir: active ? (sort.dir === 'desc' ? 'asc' : 'desc') : k === 'name' || k === 'date' ? 'asc' : 'desc' })}
      >
        {children}<span className="sort-ind">{active ? (sort.dir === 'desc' ? '↓' : '↑') : ''}</span>
      </button>
    </th>
  );
}

function BreakdownRow({ g, child, active, open, toggle, onPick, showDelta, upIsGood }) {
  return (
    <tr className={`clickable ${child ? 'child-row' : ''} ${active ? 'selected' : ''}`} onClick={onPick}>
      <td className="name-cell">
        {toggle ? (
          <button className="icon-btn caret" onClick={(e) => { e.stopPropagation(); toggle(); }} aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open}>
            {open ? '▾' : '▸'}
          </button>
        ) : <span className="caret-spacer" />}
        {g.key || <span className="muted">(none)</span>}
      </td>
      <td className="num strong">{inr(g.total)}</td>
      <td className="share-col">
        <span className="share">
          <span className="bar-track"><span className="bar-fill" style={{ width: `${g.share * 100}%` }} /></span>
          <span className="share-val">{pct(g.share)}</span>
        </span>
      </td>
      <td className="num">{g.count}</td>
      <td className="num">{g.count ? inr(g.total / g.count) : '—'}</td>
      <td className="num">{g.count ? inr(g.max) : '—'}</td>
      {showDelta && <td className="num"><Delta cur={g.total} prev={g.prev} upIsGood={upIsGood} /></td>}
    </tr>
  );
}

function TxnList({ rows }) {
  const [sort, setSort] = useState({ key: 'amount', dir: 'desc' });
  const [limit, setLimit] = useState(25);
  const [min, setMin] = useState('');
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = rows.filter((r) =>
      (!min || r.amount >= +min) &&
      (!term || [r.description, r.details, r.narration, r.category].some((v) => (v || '').toLowerCase().includes(term))));
    const sign = sort.dir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      const x = a[sort.key] ?? '';
      const y = b[sort.key] ?? '';
      return sign * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y)));
    });
  }, [rows, sort, min, q]);

  const total = list.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="card">
      <div className="section-head">
        <h2>Transactions <span className="muted small">({list.length} · {inr(total)})</span></h2>
        <div className="row wrap">
          <input className="search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
          <input type="number" min="0" placeholder="Min ₹" className="w-min" value={min} onChange={(e) => setMin(e.target.value)} />
        </div>
      </div>
      <div className="table-wrap">
        <table className="txn-table analysis-table">
          <thead>
            <tr>
              <SortTh k="date" sort={sort} setSort={setSort}>Date</SortTh>
              <SortTh k="account" sort={sort} setSort={setSort}>Account</SortTh>
              <SortTh k="category" sort={sort} setSort={setSort}>Category</SortTh>
              <SortTh k="description" sort={sort} setSort={setSort}>Sub category</SortTh>
              <th>Description</th>
              <SortTh k="amount" sort={sort} setSort={setSort} className="num">Amount</SortTh>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{fmtDate(r.date)}</td>
                <td>{r.account}</td>
                <td>{r.category}</td>
                <td>{r.description}</td>
                <td className="narration" title={r.details || r.narration}>{r.details || r.narration}</td>
                <td className="num strong">{inr(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length === 0 && <p className="muted center">No transactions match.</p>}
      {list.length > limit && (
        <div className="center" style={{ marginTop: 10 }}>
          <button className="btn small" onClick={() => setLimit(limit + 100)}>Show more ({list.length - limit} left)</button>
          <button className="btn small ghost" onClick={() => setLimit(Infinity)}>Show all</button>
        </div>
      )}
    </div>
  );
}
