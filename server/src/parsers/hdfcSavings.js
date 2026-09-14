const { loadSheetAsRows, findHeaderRowIndex, colIndexOf, parseAmount } = require('./xlsUtils');

// Parses an HDFC savings/current account statement (.xls export).
// Columns: Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance
function parseDDMMYY(str) {
  const m = String(str).trim().match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, dd, mm, yy] = m;
  let year = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10);
  return { year, month: parseInt(mm, 10), day: parseInt(dd, 10) };
}

function detect(rows) {
  const headerIdx = findHeaderRowIndex(rows, ['narration', 'withdrawal amt', 'deposit amt']);
  return headerIdx >= 0;
}

function parse(buffer, { filename } = {}) {
  const rows = loadSheetAsRows(buffer);
  const headerIdx = findHeaderRowIndex(rows, ['narration', 'withdrawal amt', 'deposit amt']);
  if (headerIdx < 0) throw new Error('Not an HDFC savings account statement');

  const header = rows[headerIdx].map((c) => String(c || '').trim());
  const dateCol = colIndexOf(header, 'Date');
  const narrationCol = colIndexOf(header, 'Narration');
  const withdrawCol = header.findIndex((c) => c.toLowerCase().startsWith('withdrawal'));
  const depositCol = header.findIndex((c) => c.toLowerCase().startsWith('deposit'));
  const balanceCol = header.findIndex((c) => c.toLowerCase().includes('closing balance'));

  const transactions = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const dateRaw = row[dateCol];
    const dateParts = parseDDMMYY(dateRaw);
    if (!dateParts) continue; // skip separators / footer rows
    const narration = String(row[narrationCol] || '').trim();
    const withdrawal = parseAmount(row[withdrawCol]);
    const deposit = parseAmount(row[depositCol]);
    const balance = parseAmount(row[balanceCol]);
    if (withdrawal === null && deposit === null) continue;

    const isCredit = deposit !== null;
    transactions.push({
      date: `${dateParts.year}-${String(dateParts.month).padStart(2, '0')}-${String(dateParts.day).padStart(2, '0')}`,
      narration,
      amount: isCredit ? deposit : withdrawal,
      direction: isCredit ? 'credit' : 'debit',
      balanceAfter: balance,
      sourceFile: filename,
      accountHint: { kind: 'bank', label: 'Savings' },
    });
  }
  return transactions;
}

module.exports = { detect, parse };
