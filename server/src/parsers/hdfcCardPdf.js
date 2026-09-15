const pdfParse = require('pdf-parse');

// Parses an HDFC credit card statement PDF (the "Emailed statement" PDF, as
// opposed to the .xls netbanking export handled by hdfcCard.js). Handles
// both the Swiggy card and Tata Neu Plus card layouts — the latter has an
// extra "Base NeuCoins" figure glued onto the line between the description
// and the amount (e.g. "Tata Unistore Limit+ 17 C 1,737.98" for a debit
// earning 17 NeuCoins, or "Tata Unistore Limit- 8+  C 839.76" for a refund
// that claws back 8 NeuCoins — note the second "+" right before "C" is the
// actual credit indicator, not part of the NeuCoins figure). The `C` is the
// rupee glyph pdf-parse can't render as ₹.
//
// A transaction's date/description/amount can be split across multiple
// source lines when the description wraps (e.g. a UPI ref number on its own
// line), so lines are joined into one string before matching rather than
// matching line-by-line like sbiCardPdf.js does.
const TXN_LINE = /(\d{2})\/(\d{2})\/(\d{4})\|\s*\d{2}:\d{2}\s*(.+?)\s*(?:[+-]\s*\d+\s*)?(\+)?\s*C\s*([\d,]+\.\d{2})/g;

function detect(buffer) {
  return pdfParse(buffer).then((data) => {
    const text = data.text;
    return /HDFC Bank Credit Card/i.test(text) && /Credit Card No\./i.test(text) && /\d{6}XXXXXX\d{4}/.test(text);
  }).catch(() => false);
}

// The statement always prints "PREVIOUS STATEMENT DUES / PAYMENTS/CREDITS
// RECEIVED / PURCHASES/DEBIT (Current Billing Cycle) / FINANCE CHARGES"
// followed immediately by those four figures concatenated on one line, e.g.
// "C5,819.12C6,041.45C3,828.25C0.00" (the `C` is the mangled ₹ glyph). Unlike
// the SBI PDF's summary box, this block is a single contiguous line in
// extraction order (not split into separately-ordered visual columns), so
// the left-to-right label order is reliable.
function findBillingCycleTotals(text) {
  const idx = text.search(/FINANCE CHARGES/i);
  if (idx < 0) return null;
  const after = text.slice(idx, idx + 400);
  const amounts = [...after.matchAll(/C\s*([\d,]+\.\d{2})/g)].map((m) => parseFloat(m[1].replace(/,/g, '')));
  if (amounts.length < 4) return null;
  const [, paymentsCreditsReceived, purchasesDebit, financeCharges] = amounts;
  return { paymentsCreditsReceived, purchasesDebit, financeCharges };
}

async function parse(buffer, { filename } = {}) {
  const data = await pdfParse(buffer);
  const text = data.text;

  const cardMatch = text.match(/\d{6}XXXXXX(\d{4})/);
  const last4 = cardMatch ? cardMatch[1] : 'UNKNOWN';
  const holderMatch = text.match(/^([A-Z][A-Z .]+?)\s*\[CKYC ID/m);
  const holder = holderMatch ? holderMatch[1].trim() : null;

  const joined = text.replace(/\s*\n\s*/g, ' ');
  const transactions = [];
  TXN_LINE.lastIndex = 0;
  let m;
  while ((m = TXN_LINE.exec(joined))) {
    const [, dd, mm, yyyy, narration, creditSign, amountStr] = m;
    const amount = parseFloat(amountStr.replace(/,/g, ''));
    if (isNaN(amount)) continue;

    transactions.push({
      date: `${yyyy}-${mm}-${dd}`,
      narration: narration.trim(),
      amount,
      direction: creditSign ? 'credit' : 'debit',
      sourceFile: filename,
      // Same shape as hdfcCard.js's accountHint (no `bank` field) so this
      // maps to the same `card:<last4>` account identifier as the .xls
      // importer instead of creating a duplicate account.
      accountHint: { kind: 'credit_card', last4, holder },
    });
  }

  const totals = findBillingCycleTotals(text);
  if (!totals) {
    throw new Error('Could not find the billing-cycle totals (Payments/Credits Received, Purchases/Debit) to verify against — refusing to import, statement format may have changed');
  }
  const debitSum = transactions.filter((t) => t.direction === 'debit').reduce((a, t) => a + t.amount, 0);
  const creditSum = transactions.filter((t) => t.direction === 'credit').reduce((a, t) => a + t.amount, 0);
  if (Math.abs(creditSum - totals.paymentsCreditsReceived) > 0.01) {
    throw new Error(`Parsed credit total (₹${creditSum.toFixed(2)}) doesn't match the statement's Payments/Credits Received total (₹${totals.paymentsCreditsReceived.toFixed(2)}) — a transaction may have been missed or misread, refusing to import`);
  }
  // Finance charges may or may not also appear as their own dated
  // transaction line depending on the statement, so allow the parsed debit
  // total to land anywhere between the bare purchases figure and that figure
  // plus the finance charge, rather than guessing which is true.
  const debitLow = totals.purchasesDebit;
  const debitHigh = totals.purchasesDebit + totals.financeCharges;
  if (debitSum < debitLow - 0.01 || debitSum > debitHigh + 0.01) {
    throw new Error(`Parsed debit total (₹${debitSum.toFixed(2)}) doesn't match the statement's Purchases/Debit total (₹${totals.purchasesDebit.toFixed(2)}) — a transaction may have been missed or misread, refusing to import`);
  }

  return transactions;
}

module.exports = { detect, parse };
