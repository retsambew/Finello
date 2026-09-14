const { loadSheetAsRows, parseAmount } = require('./xlsUtils');

// Parses an HDFC credit card statement (.xls export). Handles both the
// "Neu Card" layout (has a Base NeuCoins column) and the "Swiggy Card"
// layout (no NeuCoins column) since column positions differ between them.

function findHeaderRowIndex(rows) {
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map((c) => String(c || '').trim().toLowerCase());
    if (cells.includes('date') && cells.some((c) => c.includes('description'))) {
      return r;
    }
  }
  return -1;
}

function colIndexExact(header, label) {
  return header.findIndex((c) => c.trim().toLowerCase() === label.toLowerCase());
}

function colIndexIncludes(header, label) {
  return header.findIndex((c) => c.trim().toLowerCase().includes(label.toLowerCase()));
}

function parseCardDate(raw) {
  const s = String(raw).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function findCardLast4(rows) {
  for (const row of rows) {
    for (const cell of row) {
      const s = String(cell || '');
      const m = s.match(/Card No:\s*[\dX ]*?(\d{4})\s*$/i);
      if (m) return m[1];
    }
  }
  return null;
}

function findCardHolderName(rows) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r].map((c) => String(c || '').trim());
    const idx = row.findIndex((c) => c.toLowerCase() === 'name');
    if (idx >= 0) {
      const rest = row.slice(idx + 1).find((c) => c);
      if (rest) return rest.trim();
    }
  }
  return null;
}

function detect(rows) {
  return findHeaderRowIndex(rows) >= 0 && !!findCardLast4(rows);
}

function parse(buffer, { filename } = {}) {
  const rows = loadSheetAsRows(buffer);
  const headerIdx = findHeaderRowIndex(rows);
  if (headerIdx < 0) throw new Error('Not an HDFC credit card statement');

  const header = rows[headerIdx].map((c) => String(c || '').trim());
  const dateCol = colIndexExact(header, 'date');
  const descCol = colIndexIncludes(header, 'description');
  const amtCol = colIndexExact(header, 'amt') >= 0 ? colIndexExact(header, 'amt') : colIndexIncludes(header, 'amt');
  const drCrCol = colIndexIncludes(header, 'debit');

  const cardLast4 = findCardLast4(rows);
  const cardHolder = findCardHolderName(rows);

  const transactions = [];
  let consecutiveMisses = 0;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const date = parseCardDate(row[dateCol]);
    if (!date) {
      consecutiveMisses += 1;
      if (consecutiveMisses >= 3) break;
      continue;
    }
    consecutiveMisses = 0;
    const amount = parseAmount(row[amtCol]);
    if (amount === null) continue;
    const narration = String(row[descCol] || '').trim();
    const isCredit = String(row[drCrCol] || '').trim().toLowerCase() === 'cr';

    transactions.push({
      date,
      narration,
      amount,
      direction: isCredit ? 'credit' : 'debit',
      sourceFile: filename,
      accountHint: { kind: 'credit_card', last4: cardLast4, holder: cardHolder },
    });
  }
  return transactions;
}

module.exports = { detect, parse };
