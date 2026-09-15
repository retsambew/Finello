const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// `sample-statements/` is the git-ignored drop folder for your own local files (statements
// to test against, and optionally your existing tracker workbook) — never part of the repo.
const TRACKER_PATH = path.join(__dirname, '..', '..', 'sample-statements', 'Expense Tracker.xlsx');

// Deliberately minimal — one category per type so no dropdown starts empty, and only
// the broadest, near-universal Expense buckets. Finer distinctions (groceries vs. food
// delivery, recharge vs. electricity) belong one level down, in the "Sub category"
// field via DEFAULT_RULES below — that's the level meant to grow, not this one. This
// is a starting point to edit in Settings, not a template to fill out; a long list of
// someone else's personal categories (their gym, their hobby, their specific bills) is
// never right for a new install. The three-level hierarchy is: `category` (broad
// bucket, e.g. "Utilities"), then the "Sub category" field (medium, e.g. "Recharge"),
// then the free-text "Description" field (specific, e.g. "Airtel").
const DEFAULT_CATEGORIES = [
  ['Income', 'Salary', null], ['Income', 'Other Income', null],
  ['Expense', 'Food', 'Need'], ['Expense', 'Utilities', 'Need'], ['Expense', 'Transport', 'Need'],
  ['Expense', 'Shopping', 'Want'], ['Expense', 'Health', 'Need'], ['Expense', 'Housing', 'Need'],
  ['Expense', 'Other', null],
  ['Investment', 'Investments', null],
  ['CC Bill', 'CC Bill', null], ['Exchange', 'Exchange', null],
];

// Accounts tied to a specific bank or card (identifier `hdfc_savings`, `card:XXXX`, ...)
// aren't seeded here — that identifier only matches if it happens to equal the hint
// parsed from someone's real statement, so a hardcoded one is never right for a new
// install. The Review page already prompts to name a new account the first time its
// identifier shows up in an import, which is the only place that naming can actually
// be correct. "Cash" has no identifier since it never comes from a parsed statement.
const DEFAULT_ACCOUNTS = [
  ['Savings', 'hdfc_savings'],
  ['Cash', null],
];

// [pattern, direction, type, category, description, ignore, priority]
// `description` here is the "Sub category" field — a medium-specificity bucket
// (e.g. "Recharge", "Food Delivery"), not the merchant name itself. The merchant name
// belongs in the transaction's "Description" field (the `details` column), which is
// left blank here since it's specific to each transaction, not to the merchant pattern
// — see the Category vs. subcategory gotcha in CLAUDE.md. These patterns are widely
// recognizable (major Indian food/grocery-delivery, e-commerce, and telecom brands) so
// they're useful out of the box without encoding any one person's habits.
const DEFAULT_RULES = [
  ['PAYMENT RECEIVED', 'credit', null, null, 'Card bill payment', 1, 100],
  ['TELE TRANSFER CREDIT', 'credit', null, null, 'Card bill payment', 1, 100],
  ['CASHBACK', 'credit', 'Income', 'Other Income', 'Cashback', 0, 90],
  ['REFUND', 'credit', 'Income', 'Other Income', 'Refund', 0, 80],
  ['SWIGGY', 'debit', 'Expense', 'Food', 'Food Delivery', 0, 30],
  ['ZOMATO', 'debit', 'Expense', 'Food', 'Food Delivery', 0, 30],
  ['INSTAMART', null, 'Expense', 'Food', 'Groceries', 0, 30],
  ['BLINKIT', null, 'Expense', 'Food', 'Groceries', 0, 30],
  ['ZEPTO', null, 'Expense', 'Food', 'Groceries', 0, 30],
  ['BIGBASKET', null, 'Expense', 'Food', 'Groceries', 0, 30],
  ['AMAZON', 'debit', 'Expense', 'Shopping', 'Online Shopping', 0, 30],
  ['FLIPKART', 'debit', 'Expense', 'Shopping', 'Online Shopping', 0, 30],
  ['AIRTEL', 'debit', 'Expense', 'Utilities', 'Recharge', 0, 30],
  ['JIO', 'debit', 'Expense', 'Utilities', 'Recharge', 0, 30],
  ['VODAFONE IDEA', 'debit', 'Expense', 'Utilities', 'Recharge', 0, 30],
  ['IRCTC', 'debit', 'Expense', 'Transport', 'Train', 0, 30],
  ['UBER', 'debit', 'Expense', 'Transport', 'Cab', 0, 30],
  ['OLA', 'debit', 'Expense', 'Transport', 'Cab', 0, 30],
  ['PETROL', 'debit', 'Expense', 'Transport', 'Fuel', 0, 20],
  ['PHARMACY', 'debit', 'Expense', 'Health', 'Pharmacy', 0, 20],
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
