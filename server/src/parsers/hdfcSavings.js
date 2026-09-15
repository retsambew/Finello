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
    if (!dateParts) continue; // skip separators / footer rows (they have no date at all)
    const narration = String(row[narrationCol] || '').trim();
    const withdrawal = parseAmount(row[withdrawCol]);
    const deposit = parseAmount(row[depositCol]);
    const balance = parseAmount(row[balanceCol]);
    // A row with a real date but no parseable amount/balance is not a normal
    // separator row (those have no date either) — it's a transaction we
    // failed to read correctly. Never drop it silently.
    if (withdrawal === null && deposit === null) {
      throw new Error(`Row ${r + 1}: found a dated transaction ("${narration}") but couldn't read an amount from it — refusing to import, statement format may have changed`);
    }
    if (balance === null) {
      throw new Error(`Row ${r + 1}: found a dated transaction ("${narration}") but couldn't read its Closing Balance — refusing to import, statement format may have changed`);
    }

    const isCredit = deposit !== null;
    transactions.push({
      date: `${dateParts.year}-${String(dateParts.month).padStart(2, '0')}-${String(dateParts.day).padStart(2, '0')}`,
      narration,
      amount: isCredit ? deposit : withdrawal,
      direction: isCredit ? 'credit' : 'debit',
      balanceAfter: balance,
      sourceFile: filename,
      accountHint: { kind: 'bank', label: 'Savings' },
      _row: r + 1,
    });
  }

  verifyBalanceChain(transactions);
  return transactions;
}

// Every row carries the bank's own running Closing Balance, so unlike a
// credit-card statement (which only prints an aggregate total), we can check
// EVERY transaction, not just the sum: if any row was missed, duplicated, or
// misparsed (wrong amount/direction), the chain breaks at that exact row.
function verifyBalanceChain(transactions) {
  for (let i = 1; i < transactions.length; i++) {
    const prev = transactions[i - 1];
    const cur = transactions[i];
    const signedAmount = cur.direction === 'credit' ? cur.amount : -cur.amount;
    const expected = prev.balanceAfter + signedAmount;
    if (Math.abs(expected - cur.balanceAfter) > 0.01) {
      throw new Error(
        `Row ${cur._row}: running balance doesn't add up (expected ₹${expected.toFixed(2)} after "${cur.narration}" on ${cur.date}, statement shows ₹${cur.balanceAfter.toFixed(2)}) — a transaction may have been missed or misread, refusing to import`
      );
    }
  }
}

module.exports = { detect, parse };
