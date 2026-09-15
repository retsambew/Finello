const path = require('path');
const hdfcSavings = require('./hdfcSavings');
const hdfcCard = require('./hdfcCard');
const hdfcCardPdf = require('./hdfcCardPdf');
const sbiCardPdf = require('./sbiCardPdf');
const { loadSheetAsRows } = require('./xlsUtils');

async function parseFile(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.pdf') {
    if (await sbiCardPdf.detect(buffer)) {
      return { type: 'sbi_card_pdf', transactions: await sbiCardPdf.parse(buffer, { filename }) };
    }
    if (await hdfcCardPdf.detect(buffer)) {
      return { type: 'hdfc_card_pdf', transactions: await hdfcCardPdf.parse(buffer, { filename }) };
    }
    throw new Error(`Unrecognized PDF format: ${filename}`);
  }

  if (ext === '.xls' || ext === '.xlsx') {
    const rows = loadSheetAsRows(buffer);
    if (hdfcSavings.detect(rows)) {
      return { type: 'hdfc_savings', transactions: hdfcSavings.parse(buffer, { filename }) };
    }
    if (hdfcCard.detect(rows)) {
      return { type: 'hdfc_card', transactions: hdfcCard.parse(buffer, { filename }) };
    }
    throw new Error(`Unrecognized spreadsheet format: ${filename}`);
  }

  throw new Error(`Unsupported file type: ${filename}`);
}

module.exports = { parseFile };
