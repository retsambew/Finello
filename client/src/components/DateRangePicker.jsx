import { useEffect, useRef, useState } from 'react';
import { fmtDate } from '../api.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromIso = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const sameDay = (a, b) => a && b && a.getTime() === b.getTime();
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const addDays = (d, n) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

function buildWeeks(monthStart) {
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const weeks = [];
  let cur = gridStart;
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(cur);
      cur = addDays(cur, 1);
    }
    weeks.push(days);
  }
  return weeks;
}

function presets() {
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfLastMonth = addDays(startOfThisMonth, -1);
  const startOfLastMonth = new Date(endOfLastMonth.getFullYear(), endOfLastMonth.getMonth(), 1);
  return [
    { label: 'Today', from: today, to: today },
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
    { label: 'This month', from: startOfThisMonth, to: today },
    { label: 'Last month', from: startOfLastMonth, to: endOfLastMonth },
    { label: 'This year', from: new Date(today.getFullYear(), 0, 1), to: today },
    { label: 'All time', from: null, to: null },
  ];
}

const presetIso = (p) => ({ from: p.from ? toIso(p.from) : '', to: p.to ? toIso(p.to) : '' });

// The Ledger page's default filter — used so its initial state matches a real preset
// instead of duplicating the "this year" date math.
export function defaultRange() {
  return presetIso(presets().find((p) => p.label === 'This year'));
}

// Modern popover range picker: two side-by-side month calendars, click-drag style
// start/end selection with a live hover preview, a presets column, and explicit
// Apply/Cancel — replaces two bare <input type="date"> boxes dropped into the toolbar.
export default function DateRangePicker({ from, to, onChange }) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(to ? fromIso(to) : new Date()));
  const [draftFrom, setDraftFrom] = useState(from ? fromIso(from) : null);
  const [draftTo, setDraftTo] = useState(to ? fromIso(to) : null);
  const [hover, setHover] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openPicker = () => {
    setDraftFrom(from ? fromIso(from) : null);
    setDraftTo(to ? fromIso(to) : null);
    setViewMonth(startOfMonth(to ? fromIso(to) : new Date()));
    setOpen(true);
  };

  const pick = (day) => {
    if (!draftFrom || draftTo) {
      setDraftFrom(day);
      setDraftTo(null);
    } else if (day < draftFrom) {
      setDraftTo(draftFrom);
      setDraftFrom(day);
    } else {
      setDraftTo(day);
    }
  };

  const applyPreset = (p) => {
    onChange(presetIso(p));
    setOpen(false);
  };

  const apply = () => {
    if (!draftFrom || !draftTo) return;
    onChange({ from: toIso(draftFrom), to: toIso(draftTo) });
    setOpen(false);
  };

  const allPresets = presets();
  const matchedPreset = allPresets.find((p) => {
    const iso = presetIso(p);
    return iso.from === (from || '') && iso.to === (to || '');
  });
  const label = matchedPreset ? matchedPreset.label : from && to ? `${fmtDate(from)} – ${fmtDate(to)}` : 'All time';
  const months = [viewMonth, addMonths(viewMonth, 1)];

  return (
    <div className="daterange" ref={ref}>
      <button type="button" className="btn daterange-trigger" onClick={() => (open ? setOpen(false) : openPicker())}>
        {label}
      </button>
      {open && (
        <div className="daterange-pop">
          <div className="daterange-presets">
            {allPresets.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`daterange-preset ${matchedPreset?.label === p.label ? 'active' : ''}`}
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="daterange-cal">
            <div className="daterange-cal-head">
              <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setViewMonth(addMonths(viewMonth, -1))}>&#8249;</button>
              <div className="daterange-months-label">
                <span>{MONTHS[months[0].getMonth()]} {months[0].getFullYear()}</span>
                <span>{MONTHS[months[1].getMonth()]} {months[1].getFullYear()}</span>
              </div>
              <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setViewMonth(addMonths(viewMonth, 1))}>&#8250;</button>
            </div>
            <div className="daterange-months">
              {months.map((m) => (
                <MonthGrid
                  key={`${m.getFullYear()}-${m.getMonth()}`}
                  month={m}
                  draftFrom={draftFrom}
                  draftTo={draftTo}
                  hover={hover}
                  onHover={setHover}
                  onPick={pick}
                />
              ))}
            </div>
            <div className="daterange-actions">
              <button type="button" className="btn ghost small" onClick={() => { setDraftFrom(null); setDraftTo(null); }}>Clear</button>
              <div className="row">
                <button type="button" className="btn small" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" className="btn primary small" disabled={!draftFrom || !draftTo} onClick={apply}>Apply</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthGrid({ month, draftFrom, draftTo, hover, onHover, onPick }) {
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const weeks = buildWeeks(month);
  const rangeEnd = draftTo || hover;
  const inRange = (d) => {
    if (!draftFrom || !rangeEnd) return false;
    const lo = Math.min(draftFrom.getTime(), rangeEnd.getTime());
    const hi = Math.max(draftFrom.getTime(), rangeEnd.getTime());
    const t = d.getTime();
    return t > lo && t < hi;
  };

  return (
    <div className="daterange-month" onMouseLeave={() => onHover(null)}>
      <div className="daterange-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="daterange-grid">
        {weeks.flat().map((d) => {
          const outside = d.getMonth() !== month.getMonth();
          const selected = sameDay(d, draftFrom) || sameDay(d, draftTo);
          return (
            <button
              type="button"
              key={d.getTime()}
              className={[
                'daterange-day',
                outside && 'outside',
                selected && 'selected',
                !selected && inRange(d) && 'in-range',
                sameDay(d, today) && 'today',
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => onHover(d)}
              onClick={() => onPick(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
