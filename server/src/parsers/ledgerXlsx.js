const XLSX = require('xlsx');
const { colIndexOf, parseAmount } = require('./xlsUtils');

// Parses a full ledger export in the app's own "Entries" layout (see
// index.js's /api/export.xlsx), so a user's existing expense-tracker workbook
// can be dropped straight in as their starting ledger.
// Columns: Account | Date | Month | Category | Type | Amount | Description | More Details
const REQUIRED = ['account', 'date', 'type', 'category', 'amount'];

function excelSerialToISO(serial) {
  const d = XLSX.SSF.parse_date_code(serial);
  if (!d) return null;
  return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
}

// Dates come back as plain numbers (cellDates: false) so we convert with
// Excel's own date math instead of JS Date, which would shift by the local
// timezone offset for whole-day values.
function parseCellDate(val) {
  if (val === '' || val === null || val === undefined) return null;
  if (typeof val === 'number') return excelSerialToISO(val);
  const s = String(val).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const [, mm, dd, yy] = m;
    const year = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10);
    return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  return null;
}

function findEntriesSheet(wb) {
  const byName = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'entries');
  const candidates = byName ? [byName] : wb.SheetNames;
  for (const name of candidates) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const cells = rows[r].map((c) => String(c || '').trim().toLowerCase());
      if (REQUIRED.every((w) => cells.some((c) => c === w || c.startsWith(w)))) {
        return { name, rows, headerIdx: r };
      }
    }
  }
  return null;
}

function parseLedgerXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const found = findEntriesSheet(wb);
  if (!found) return { rows: [], sheetName: null };
  const { name, rows, headerIdx } = found;
  const header = rows[headerIdx].map((c) => String(c || '').trim());
  const col = {
    account: colIndexOf(header, 'Account'),
    date: colIndexOf(header, 'Date'),
    category: colIndexOf(header, 'Category'),
    type: colIndexOf(header, 'Type'),
    amount: colIndexOf(header, 'Amount'),
    description: header.findIndex((c) => c.toLowerCase().startsWith('description')),
    details: header.findIndex((c) => c.toLowerCase().startsWith('more details') || c.toLowerCase() === 'details'),
  };

  const out = [];
  // A hand-maintained sheet legitimately has fully blank rows between months/
  // sections — those are silently skipped. But a row with SOME fields filled
  // that still fails the required-field check is more likely a typo than a
  // deliberate spacer, so those are surfaced (not blocked — bulk history
  // import stays permissive — just made visible instead of vanishing).
  const incompleteRows = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const account = String(row[col.account] || '').trim();
    const type = String(row[col.type] || '').trim();
    const category = String(row[col.category] || '').trim();
    const date = parseCellDate(row[col.date]);
    const amount = parseAmount(row[col.amount]);
    if (!account || !type || !date || amount === null || amount <= 0) {
      const anyFilled = account || type || category || row[col.date] !== '' || row[col.amount] !== '';
      if (anyFilled) incompleteRows.push({ row: r + 1, account, type, category });
      continue;
    }
    out.push({
      row: r,
      account,
      type,
      category,
      date,
      amount,
      description: col.description >= 0 ? String(row[col.description] || '').trim() : '',
      details: col.details >= 0 ? String(row[col.details] || '').trim() : '',
    });
  }
  return { rows: out, sheetName: name, incompleteRows };
}

module.exports = { parseLedgerXlsx };
