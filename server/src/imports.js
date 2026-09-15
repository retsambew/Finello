const { db, transaction } = require('./db');
const { parseFile } = require('./parsers');
const { applyRules, normalize } = require('./rules');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthName(isoDate) {
  return MONTH_NAMES[parseInt(isoDate.slice(5, 7), 10) - 1];
}

function accountIdentifier(hint, parserType) {
  if (hint.kind === 'bank') return parserType;
  const bank = hint.bank ? `${hint.bank.toLowerCase()}_` : '';
  return `${bank}card:${hint.last4}`;
}

function fingerprint(identifier, t) {
  return [identifier, t.date, t.amount.toFixed(2), t.direction, normalize(t.narration)].join('|');
}

async function createBatch(files) {
  const parsed = [];
  const errors = [];
  for (const f of files) {
    try {
      const result = await parseFile(f.buffer, f.originalname);
      parsed.push({ file: f.originalname, ...result });
    } catch (e) {
      errors.push({ file: f.originalname, error: e.message });
    }
  }
  if (!parsed.length) return { errors };

  const rules = db.prepare('SELECT * FROM rules').all();
  const accounts = db.prepare('SELECT * FROM accounts WHERE identifier IS NOT NULL').all();
  const accountByIdentifier = Object.fromEntries(accounts.map((a) => [a.identifier, a.name]));

  const batchId = transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO batches (files) VALUES (?)')
      .run(JSON.stringify(parsed.map((p) => ({ file: p.file, type: p.type, count: p.transactions.length }))));

    const insert = db.prepare(`
      INSERT INTO transactions (batch_id, account, account_identifier, date, month, type, category, amount,
        description, details, narration, direction, source_file, file_seq, fingerprint, include_row, auto_mapped)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    // file_seq (this file's position among the files in this upload) is the
    // "same physical file" key for dedup purposes — not source_file, which
    // would collapse two identically-named files attached to one upload into
    // a single bucket and hide real duplicates (see markDuplicates below).
    parsed.forEach((p, fileSeq) => {
      for (const t of p.transactions) {
        const identifier = accountIdentifier(t.accountHint, p.type);
        const mapped = applyRules(rules, t);
        insert.run(
          lastInsertRowid, accountByIdentifier[identifier] || null, identifier, t.date, monthName(t.date),
          mapped.type, mapped.category, t.amount, mapped.description, mapped.details, t.narration, t.direction, p.file,
          fileSeq, fingerprint(identifier, t), mapped.include_row, mapped.auto_mapped
        );
      }
    });
    return Number(lastInsertRowid);
  });

  return { batchId, errors };
}

// Count-aware duplicate detection: two identical HungerBox ₹18 charges on the
// same day in one statement are real, but the same row appearing again from an
// earlier import (or a second copy of the file in this upload) is a duplicate.
// Re-run on every getBatch() call (not just once at upload time) so that two
// statements imported back-to-back, before either is committed, still catch
// each other — and so a batch's flags stay current if other batches are
// committed/discarded/edited while this one sits in review.
function markDuplicates(batchId) {
  const rows = db.prepare("SELECT id, fingerprint, file_seq FROM transactions WHERE batch_id = ? AND status = 'staged' ORDER BY id").all(batchId);
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.fingerprint)) groups.set(r.fingerprint, []);
    groups.get(r.fingerprint).push(r);
  }
  // Any row with the same fingerprint outside this batch counts as "already
  // accounted for" — whether it's committed, ignored, or simply staged in a
  // different (not-yet-committed) import.
  const countElsewhere = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE fingerprint = ? AND (batch_id IS NULL OR batch_id != ?)');
  const reset = db.prepare("UPDATE transactions SET is_duplicate = 0, duplicate_reason = NULL WHERE batch_id = ? AND status = 'staged'");
  const mark = db.prepare('UPDATE transactions SET is_duplicate = 1, duplicate_reason = ? WHERE id = ?');

  transaction(() => {
    reset.run(batchId);
    for (const [fp, group] of groups) {
      const perFile = {};
      for (const r of group) perFile[r.file_seq] = (perFile[r.file_seq] || 0) + 1;
      const maxPerFile = Math.max(...Object.values(perFile));
      const elsewhere = countElsewhere.get(fp, batchId).n;
      const genuine = Math.max(maxPerFile - elsewhere, 0);
      const dupCount = group.length - genuine;
      if (dupCount <= 0) continue;
      const reason = elsewhere > 0 ? 'Already imported earlier' : 'Also present in another uploaded file';
      for (const r of group.slice(group.length - dupCount)) mark.run(reason, r.id);
    }
  });
}

function getBatch(batchId) {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  if (!batch) return null;
  if (batch.status === 'staged') markDuplicates(batchId);
  const rows = db.prepare('SELECT * FROM transactions WHERE batch_id = ? ORDER BY date, id').all(batchId);
  const unmapped = db.prepare(`
    SELECT account_identifier AS identifier, COUNT(*) AS count, MIN(source_file) AS file
    FROM transactions WHERE batch_id = ? AND account IS NULL GROUP BY account_identifier`).all(batchId);
  return {
    ...batch,
    files: JSON.parse(batch.files),
    rows,
    unmappedAccounts: unmapped.map((u) => ({ ...u, suggestedName: suggestNameFromIdentifier(u.identifier) })),
    duplicateCount: rows.filter((r) => r.is_duplicate).length,
  };
}

function suggestNameFromIdentifier(identifier) {
  const m = identifier.match(/^(?:(\w+)_)?card:(.+)$/);
  if (!m) return 'Savings';
  return `${m[1] ? m[1].toUpperCase() : 'HDFC'} Card`;
}

module.exports = { createBatch, getBatch, markDuplicates, monthName };
