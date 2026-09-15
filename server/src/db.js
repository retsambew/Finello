const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { seedDatabase } = require('./seed');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'finello.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  identifier TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  tag TEXT,
  UNIQUE(type, name)
);

CREATE TABLE IF NOT EXISTS descriptions (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  direction TEXT,
  type TEXT,
  category TEXT,
  description TEXT,
  details TEXT,
  ignore INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  files TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'staged'
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'staged',
  account TEXT,
  account_identifier TEXT,
  date TEXT NOT NULL,
  month TEXT NOT NULL,
  type TEXT,
  category TEXT,
  amount REAL NOT NULL,
  description TEXT,
  details TEXT,
  narration TEXT,
  direction TEXT NOT NULL,
  source_file TEXT,
  file_seq INTEGER NOT NULL DEFAULT 0,
  fingerprint TEXT NOT NULL,
  include_row INTEGER NOT NULL DEFAULT 1,
  is_duplicate INTEGER NOT NULL DEFAULT 0,
  duplicate_reason TEXT,
  auto_mapped INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_txn_fingerprint ON transactions(fingerprint, status);
CREATE INDEX IF NOT EXISTS idx_txn_batch ON transactions(batch_id);
CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date);
`);

// Additive migration for databases created before `rules.details` existed —
// CREATE TABLE IF NOT EXISTS above only applies to brand-new installs.
const ruleColumns = db.prepare('PRAGMA table_info(rules)').all().map((c) => c.name);
if (!ruleColumns.includes('details')) {
  db.exec('ALTER TABLE rules ADD COLUMN details TEXT');
}

// Additive migration for databases created before `transactions.file_seq`
// existed (disambiguates multiple same-named files uploaded in one batch —
// see markDuplicates in imports.js).
const txnColumns = db.prepare('PRAGMA table_info(transactions)').all().map((c) => c.name);
if (!txnColumns.includes('file_seq')) {
  db.exec('ALTER TABLE transactions ADD COLUMN file_seq INTEGER NOT NULL DEFAULT 0');
}

seedDatabase(db);

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, transaction };
