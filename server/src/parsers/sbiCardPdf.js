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
  return transactions;
}

module.exports = { detect, parse };
