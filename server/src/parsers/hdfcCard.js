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

// Every HDFC card statement carries an "Account Summary" block ahead of the
// transaction table: a label row ("Opening Bal | Payment / Credit |
// Purchases / Debits | Finance Charges | Total Dues") followed immediately
// by a value row, each value sitting in the SAME column as its label — a
// spreadsheet cell reference, not text-extraction order, so unlike the PDF
// statements this mapping is exact rather than a best-effort heuristic.
function findAccountSummaryTotals(rows) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r].map((c) => String(c || '').trim().toLowerCase());
    const creditCol = row.findIndex((c) => c === 'payment / credit');
    const debitCol = row.findIndex((c) => c === 'purchases / debits');
    if (creditCol >= 0 && debitCol >= 0 && rows[r + 1]) {
      const paymentsCredits = parseAmount(rows[r + 1][creditCol]);
      const purchasesDebits = parseAmount(rows[r + 1][debitCol]);
      if (paymentsCredits !== null && purchasesDebits !== null) {
        return { paymentsCredits, purchasesDebits };
      }
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
  // Scan every remaining row rather than bailing after a few blank/footer
  // rows — the footer (NeuCoins/GST/loan summaries) never has anything in
  // the date column, so it's always safely skipped without a fixed cutoff
  // that risks truncating real transactions after an odd blank row.
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const date = parseCardDate(row[dateCol]);
    if (!date) continue;
    const amount = parseAmount(row[amtCol]);
    const narration = String(row[descCol] || '').trim();
    if (amount === null) {
      throw new Error(`Row ${r + 1}: found a dated transaction ("${narration}") but couldn't read its amount — refusing to import, statement format may have changed`);
    }
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

  const totals = findAccountSummaryTotals(rows);
  if (!totals) {
    throw new Error('Could not find the Account Summary totals (Payment / Credit, Purchases / Debits) to verify against — refusing to import, statement format may have changed');
  }
  const debitSum = transactions.filter((t) => t.direction === 'debit').reduce((a, t) => a + t.amount, 0);
  const creditSum = transactions.filter((t) => t.direction === 'credit').reduce((a, t) => a + t.amount, 0);
  if (Math.abs(debitSum - totals.purchasesDebits) > 0.01) {
    throw new Error(`Parsed debit total (₹${debitSum.toFixed(2)}) doesn't match the statement's Purchases / Debits total (₹${totals.purchasesDebits.toFixed(2)}) — a transaction may have been missed or misread, refusing to import`);
  }
  if (Math.abs(creditSum - totals.paymentsCredits) > 0.01) {
    throw new Error(`Parsed credit total (₹${creditSum.toFixed(2)}) doesn't match the statement's Payment / Credit total (₹${totals.paymentsCredits.toFixed(2)}) — a transaction may have been missed or misread, refusing to import`);
  }

  return transactions;
}

module.exports = { detect, parse };
