const XLSX = require('xlsx');

function loadSheetAsRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  return rows;
}

// Find the index of the first row containing all of `mustContain` strings (case-insensitive, trimmed)
function findHeaderRowIndex(rows, mustContain) {
  const wanted = mustContain.map((s) => s.toLowerCase());
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map((c) => String(c || '').trim().toLowerCase());
    const found = wanted.every((w) => cells.some((c) => c === w || c.includes(w)));
    if (found) return r;
  }
  return -1;
}

function colIndexOf(headerRow, label) {
  const target = label.toLowerCase();
  return headerRow.findIndex((c) => String(c || '').trim().toLowerCase() === target);
}

function parseAmount(val) {
  if (val === '' || val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[,\s]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

module.exports = { loadSheetAsRows, findHeaderRowIndex, colIndexOf, parseAmount };
