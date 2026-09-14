const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const TRACKER_PATH = path.join(__dirname, '..', '..', 'Expense Tracker.xlsx');

const DEFAULT_CATEGORIES = [
  ['Income', 'Salary', null], ['Income', 'Tax Returns', null], ['Income', 'Cashback', null],
  ['Income', 'Credit', null], ['Income', 'Dividend', null], ['Income', 'Interest', null],
  ['Expense', 'Rent', 'Need'], ['Expense', 'Groceries', 'Need'], ['Expense', 'Utilities', 'Need'],
  ['Expense', 'Clothes', 'Want'], ['Expense', 'Recharge', 'Want'], ['Expense', 'Gift', 'Need'],
  ['Expense', 'Cash Withdraw', 'Need'], ['Expense', 'Charity', 'Need'], ['Expense', 'Transport', 'Need'],
  ['Expense', 'Food', 'Need'], ['Expense', 'Dine Out', 'Want'], ['Expense', 'Shopping', 'Want'],
  ['Expense', 'Travel', 'Want'], ['Expense', 'Drinks', 'Want'], ['Expense', 'Games', 'Want'],
  ['Expense', 'Home', 'Need'], ['Expense', 'Panda', 'Need'], ['Expense', 'Medical', 'Need'],
  ['Expense', 'Wedding', 'Need'], ['Expense', 'Activities', 'Want'], ['Expense', 'Fee', 'Need'],
  ['Investment', 'Mutual Fund', null], ['Investment', 'Equity', null], ['Investment', 'SGB', null],
  ['CC Bill', 'CC Bill', null], ['Exchange', 'Ex Credit', null], ['Exchange', 'Ex Debit', null],
];

const DEFAULT_ACCOUNTS = [
  ['Savings', 'hdfc_savings'],
  ['Neu Card', 'card:3657'],
  ['Swiggy Card', 'card:7439'],
  ['Cash', null],
];

// [pattern, direction, type, category, description, ignore, priority]
const DEFAULT_RULES = [
  ['PAYMENT RECEIVED', 'credit', null, null, 'Card bill payment', 1, 100],
  ['TELE TRANSFER CREDIT', 'credit', null, null, 'Card bill payment', 1, 100],
  ['CASHBACK', 'credit', 'Income', 'Cashback', 'Cashback', 0, 90],
  ['REWARD POINT REDEMPTION', 'credit', 'Income', 'Cashback', 'Reward Points', 0, 90],
  ['FUEL SURCHARGE WAIVER', 'credit', 'Income', 'Cashback', 'Fuel Surcharge Waiver', 0, 90],
  ['UPIRET', 'credit', 'Income', 'Credit', 'UPI Refund', 0, 80],
  ['INSTAMART', null, 'Expense', 'Groceries', 'Instamart', 0, 50],
  ['HUNGERBOX', null, 'Expense', 'Food', 'HungerBox', 0, 50],
  ['BLINKIT', null, 'Expense', 'Groceries', 'Blinkit', 0, 50],
  ['ZEPTO', null, 'Expense', 'Groceries', 'Zepto', 0, 50],
  ['BIGBASKET', null, 'Expense', 'Groceries', 'BigBasket', 0, 50],
  ['ZOMATO', 'debit', 'Expense', 'Food', 'Zomato', 0, 40],
  ['SWIGGY', 'debit', 'Expense', 'Food', 'Swiggy', 0, 30],
  ['AMAZON', 'debit', 'Expense', 'Shopping', 'Amazon', 0, 30],
  ['MAKEMYTRIP', 'debit', 'Expense', 'Travel', 'MakeMyTrip', 0, 30],
  ['REDBUS', 'debit', 'Expense', 'Travel', 'Bus', 0, 30],
  ['CONFIRM TICKET', 'debit', 'Expense', 'Travel', 'Train', 0, 30],
  ['IRCTC', 'debit', 'Expense', 'Travel', 'IRCTC', 0, 30],
  ['AIRBNB', 'debit', 'Expense', 'Travel', 'Airbnb', 0, 30],
  ['AIRTEL', 'debit', 'Expense', 'Recharge', 'Airtel Recharge', 0, 30],
  ['VODAFONE IDEA', 'debit', 'Expense', 'Recharge', 'Vi Recharge', 0, 30],
  ['GPAYRECHARGE', 'debit', 'Expense', 'Recharge', 'Mobile Recharge', 0, 30],
  ['CRED CLUB', 'debit', 'CC Bill', 'CC Bill', 'CRED', 0, 60],
  ['ZERODHA', 'debit', 'Investment', 'Equity', 'Zerodha', 0, 30],
  ['INDIAN CLEARING CORP', 'debit', 'Investment', 'Mutual Fund', 'Mutual Fund SIP', 0, 30],
  ['ANNUAL FEE', 'debit', 'Expense', 'Fee', 'Debit Card Annual Charge', 0, 30],
  ['INSTAALERTCHG', 'debit', 'Expense', 'Fee', 'SMS Alert Charges', 0, 30],
  ['PHARMACY', 'debit', 'Expense', 'Medical', 'Pharmacy', 0, 20],
  ['MEDICAL', 'debit', 'Expense', 'Medical', 'Medical Store', 0, 20],
  ['PETROL PUMP', 'debit', 'Expense', 'Transport', 'Petrol', 0, 20],
  ['SERVICE STATION', 'debit', 'Expense', 'Transport', 'Petrol', 0, 20],
  ['VALVE CORPORATION', 'debit', 'Expense', 'Games', 'Steam', 0, 20],
];

function readTrackerSeed() {
  if (!fs.existsSync(TRACKER_PATH)) return null;
  try {
    const wb = XLSX.read(fs.readFileSync(TRACKER_PATH), { type: 'buffer' });
    const settings = wb.Sheets['Settings'];
    const entries = wb.Sheets['Entries'];
    const out = { categories: [], accounts: [], descriptions: new Set() };
    if (settings) {
      // sheet_to_json indexes arrays from the sheet's own !ref start column (here "B"),
      // not column A, so row[0] is column B (Type), row[1] is C (Category), etc.
      const rows = XLSX.utils.sheet_to_json(settings, { header: 1, defval: null });
      for (const [type, category, tag, , account] of rows) {
        if (type && category && type !== 'Type') out.categories.push([type, category, tag || null]);
        if (account && account !== 'Account') out.accounts.push(account);
      }
    }
    if (entries) {
      // Entries !ref starts at column B, so row[6] is column H (Description).
      const rows = XLSX.utils.sheet_to_json(entries, { header: 1, defval: null });
      for (const row of rows) {
        const desc = row[6];
        if (typeof desc === 'string' && desc.trim() && desc.trim() !== 'Description') {
          out.descriptions.add(desc.trim());
        }
      }
    }
    return out;
  } catch (e) {
    console.warn('Could not read Expense Tracker.xlsx for seeding:', e.message);
    return null;
  }
}

function seedDatabase(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM categories').get();
  if (n > 0) return;

  const tracker = readTrackerSeed();
  const insertCat = db.prepare('INSERT OR IGNORE INTO categories (type, name, tag) VALUES (?, ?, ?)');
  const insertAcc = db.prepare('INSERT OR IGNORE INTO accounts (name, identifier) VALUES (?, ?)');
  const insertDesc = db.prepare('INSERT OR IGNORE INTO descriptions (name) VALUES (?)');
  const insertRule = db.prepare(
    'INSERT INTO rules (pattern, direction, type, category, description, ignore, priority) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  db.exec('BEGIN');
  for (const c of tracker?.categories?.length ? tracker.categories : DEFAULT_CATEGORIES) insertCat.run(...c);
  for (const [name, identifier] of DEFAULT_ACCOUNTS) insertAcc.run(name, identifier);
  for (const name of tracker?.accounts || []) insertAcc.run(name, null);
  for (const d of tracker?.descriptions || []) insertDesc.run(d);
  for (const r of DEFAULT_RULES) {
    insertRule.run(...r);
    if (r[4]) insertDesc.run(r[4]);
  }
  db.exec('COMMIT');
  console.log(`Seeded database${tracker ? ' from Expense Tracker.xlsx' : ' with defaults'}.`);
}

module.exports = { seedDatabase };
