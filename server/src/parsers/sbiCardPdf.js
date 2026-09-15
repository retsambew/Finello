const pdfParse = require('pdf-parse');

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// Matches lines like: "03 Jul 26 UPI-HungerBox 40.00 D" or the no-space
// variant pdf-parse sometimes emits: "03 Jul 26UPI-HungerBox40.00D"
const TXN_LINE = /(\d{2})\s+([A-Za-z]{3})\s+(\d{2,4})\s*(.+?)\s*([\d,]+\.\d{2})\s*([DC])\s*$/;

function toIsoDate(dd, mon, yy) {
  const mm = MONTHS[mon.toLowerCase()];
  if (!mm) return null;
  const year = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10);
  return `${year}-${mm}-${dd}`;
}

async function detect(buffer) {
  try {
    const data = await pdfParse(buffer);
    return /SBI Card/i.test(data.text) && /TRANSACTIONS FOR/i.test(data.text);
  } catch {
    return false;
  }
}

// The "ACCOUNT SUMMARY" box's labels (Minimum Amount Due, Total Amount Due,
// Cash Limit, Credit Limit, Available Credit Limit, Available Cash Limit,
// Previous Balance, Total Outstanding, Payments/Reversals/Credits,
// Additions, Purchases & Other Debits, Fee/Taxes/Interest) and its values
// are NOT adjacent in pdf-parse's extraction order — same non-visual-order
// issue as the transaction blocks (see module comment). But the 9 values
// that DO render as one contiguous run of decimal-amount lines — right after
// the CKYC number and right before the statement-date/due-date lines —
// reliably line up 7th/8th in that run with "Payments, Reversals & other
// Credits" and "Purchases & Other Debits" respectively; confirmed against a
// real statement where those two values matched the parsed credit/debit sums
// exactly. If a future statement's layout shifts this, we can no longer
// trust the mapping, so we refuse to guess and fail loudly instead.
function findAccountSummaryTotals(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const ckycIdx = lines.findIndex((l) => /^\d{10,20}$/.test(l));
  if (ckycIdx < 0) return null;

  const amounts = [];
  let i = ckycIdx + 1;
  while (amounts.length < 9 && i < lines.length) {
    const line = lines[i];
    if (line === '') { i++; continue; }
    if (!/^[\d,]+\.\d{2}$/.test(line)) break;
    amounts.push(parseFloat(line.replace(/,/g, '')));
    i++;
  }
  if (amounts.length !== 9) return null;
  return { paymentsReversalsCredits: amounts[6], purchasesOtherDebits: amounts[7] };
}

async function parse(buffer, { filename } = {}) {
  const data = await pdfParse(buffer);
  const text = data.text;

  // Credits and debits are listed in separate blocks, and pdf-parse doesn't keep
  // visual order, so scan everything before the footer section for txn-shaped lines.
  const endMarkerIdx = text.search(/SAVINGS AND BENEFITS SECTION/i);
  const body = endMarkerIdx > 0 ? text.slice(0, endMarkerIdx) : text;

  // Extract full card number tail e.g. "XXXX XXXX XXXX XX02"
  const cardMatch = text.match(/XXXX\s*XXXX\s*XXXX\s*XX(\d{2})/i);
  const last4 = cardMatch ? `XX${cardMatch[1]}` : 'UNKNOWN';

  const lines = body.split('\n');
  const transactions = [];
  for (const line of lines) {
    const m = line.match(TXN_LINE);
    if (!m) continue;
    const [, dd, mon, yy, narration, amountStr, drCr] = m;
    const date = toIsoDate(dd, mon, yy);
    if (!date) continue;
    const amount = parseFloat(amountStr.replace(/,/g, ''));
    if (isNaN(amount)) continue;

    transactions.push({
      date,
      narration: narration.trim(),
      amount,
      direction: drCr === 'C' ? 'credit' : 'debit',
      sourceFile: filename,
      accountHint: { kind: 'credit_card', last4, holder: null, bank: 'SBI' },
    });
  }

  const totals = findAccountSummaryTotals(text);
  if (!totals) {
    throw new Error('Could not find the Account Summary totals (Payments/Reversals/Credits, Purchases & Other Debits) to verify against — refusing to import, statement format may have changed');
  }
  const debitSum = transactions.filter((t) => t.direction === 'debit').reduce((a, t) => a + t.amount, 0);
  const creditSum = transactions.filter((t) => t.direction === 'credit').reduce((a, t) => a + t.amount, 0);
  if (Math.abs(creditSum - totals.paymentsReversalsCredits) > 0.01) {
    throw new Error(`Parsed credit total (₹${creditSum.toFixed(2)}) doesn't match the statement's Payments/Reversals/Credits total (₹${totals.paymentsReversalsCredits.toFixed(2)}) — a transaction may have been missed or misread, refusing to import`);
  }
  if (Math.abs(debitSum - totals.purchasesOtherDebits) > 0.01) {
    throw new Error(`Parsed debit total (₹${debitSum.toFixed(2)}) doesn't match the statement's Purchases & Other Debits total (₹${totals.purchasesOtherDebits.toFixed(2)}) — a transaction may have been missed or misread, refusing to import`);
  }

  return transactions;
}

module.exports = { detect, parse };
