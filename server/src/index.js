const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');
const { db, transaction } = require('./db');
const { createBatch, getBatch, monthName } = require('./imports');
const { merchantKey, findRule } = require('./rules');
const { parseLedgerXlsx } = require('./parsers/ledgerXlsx');
const { seedDatabase } = require('./seed');

const PORT = process.env.PORT || 5174;
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message });
  });
};

// ---------- Meta: dropdown sources ----------
function getMeta() {
  const categories = db.prepare('SELECT * FROM categories ORDER BY type, name').all();
  return {
    accounts: db.prepare('SELECT * FROM accounts ORDER BY name').all(),
    categories,
    types: [...new Set(categories.map((c) => c.type))],
    descriptions: db
      .prepare(`SELECT name FROM descriptions UNION SELECT DISTINCT description FROM transactions
                WHERE description IS NOT NULL AND description != '' ORDER BY 1`)
      .all()
      .map((r) => r.name),
  };
}

app.get('/api/meta', (req, res) => res.json(getMeta()));

app.post('/api/categories', (req, res) => {
  const { type, name, tag } = req.body;
  if (!type?.trim() || !name?.trim()) return res.status(400).json({ error: 'Type and name are required' });
  db.prepare('INSERT OR IGNORE INTO categories (type, name, tag) VALUES (?, ?, ?)').run(type.trim(), name.trim(), tag || null);
  res.json(getMeta());
});

app.put('/api/categories/:id', (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Not found' });
  const tag = 'tag' in req.body ? req.body.tag || null : cat.tag;
  const name = req.body.name?.trim() || cat.name;
  try {
    transaction(() => {
      db.prepare('UPDATE categories SET tag = ?, name = ? WHERE id = ?').run(tag, name, cat.id);
      if (name !== cat.name) {
        db.prepare('UPDATE transactions SET category = ? WHERE type = ? AND category = ?').run(name, cat.type, cat.name);
        db.prepare('UPDATE rules SET category = ? WHERE type = ? AND category = ?').run(name, cat.type, cat.name);
      }
    });
  } catch {
    return res.status(400).json({ error: `A category named "${name}" already exists for ${cat.type}` });
  }
  res.json(getMeta());
});

app.delete('/api/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json(getMeta());
});

// Usage counts (committed transactions + rules) per "type|category", for the Settings UI —
// lets the user see what's actually in use before renaming/removing a category.
app.get('/api/categories/usage', (req, res) => {
  const key = (t, c) => `${t}|${c}`;
  const usage = {};
  for (const r of db.prepare(`SELECT type, category, COUNT(*) n FROM transactions
      WHERE status = 'committed' AND category IS NOT NULL AND category != '' GROUP BY type, category`).all()) {
    usage[key(r.type, r.category)] = { ...usage[key(r.type, r.category)], transactions: r.n };
  }
  for (const r of db.prepare(`SELECT type, category, COUNT(*) n FROM rules
      WHERE category IS NOT NULL AND category != '' GROUP BY type, category`).all()) {
    usage[key(r.type, r.category)] = { ...usage[key(r.type, r.category)], rules: r.n };
  }
  res.json(usage);
});

app.post('/api/accounts', (req, res) => {
  const { name, identifier } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  // `identifier` is accepted (not just set by the statement-matching flow) so a deleted
  // account can be recreated by Undo with its statement link intact, not just its name.
  db.prepare('INSERT OR IGNORE INTO accounts (name, identifier) VALUES (?, ?)').run(name.trim(), identifier || null);
  res.json(getMeta());
});

app.put('/api/accounts/:id', (req, res) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!acc) return res.status(404).json({ error: 'Not found' });
  const name = req.body.name?.trim() || acc.name;
  transaction(() => {
    db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(name, acc.id);
    db.prepare('UPDATE transactions SET account = ? WHERE account = ?').run(name, acc.name);
  });
  res.json(getMeta());
});

app.delete('/api/accounts/:id', (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  res.json(getMeta());
});

app.post('/api/descriptions', (req, res) => {
  if (req.body.name?.trim()) db.prepare('INSERT OR IGNORE INTO descriptions (name) VALUES (?)').run(req.body.name.trim());
  res.json(getMeta());
});

// Rename a sub category everywhere it's used (the picker list, existing transactions, and
// rules). Body-based (not /:name in the URL) so slashes/odd characters in a merchant name
// don't get mangled by route decoding.
app.put('/api/descriptions', (req, res) => {
  const oldName = String(req.body.oldName || '').trim();
  const name = String(req.body.name || '').trim();
  if (!oldName || !name) return res.status(400).json({ error: 'Name is required' });
  transaction(() => {
    db.prepare('DELETE FROM descriptions WHERE name = ?').run(oldName);
    db.prepare('INSERT OR IGNORE INTO descriptions (name) VALUES (?)').run(name);
    db.prepare('UPDATE transactions SET description = ? WHERE description = ?').run(name, oldName);
    db.prepare('UPDATE rules SET description = ? WHERE description = ?').run(name, oldName);
  });
  res.json(getMeta());
});

app.delete('/api/descriptions', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name) db.prepare('DELETE FROM descriptions WHERE name = ?').run(name);
  res.json(getMeta());
});

// Every sub category name in use anywhere (picker list ∪ transactions ∪ rules) with usage
// counts, for the Settings UI's "Sub categories" manager.
app.get('/api/descriptions/detail', (req, res) => {
  const listed = db.prepare('SELECT name FROM descriptions').all().map((r) => r.name);
  const txnRows = db.prepare(`SELECT description name, COUNT(*) n FROM transactions
      WHERE status = 'committed' AND description IS NOT NULL AND description != '' GROUP BY description`).all();
  const ruleRows = db.prepare(`SELECT description name, COUNT(*) n FROM rules
      WHERE description IS NOT NULL AND description != '' GROUP BY description`).all();
  const txnMap = Object.fromEntries(txnRows.map((r) => [r.name, r.n]));
  const ruleMap = Object.fromEntries(ruleRows.map((r) => [r.name, r.n]));
  const names = new Set([...listed, ...txnRows.map((r) => r.name), ...ruleRows.map((r) => r.name)]);
  const result = [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({
    name,
    transactions: txnMap[name] || 0,
    rules: ruleMap[name] || 0,
  }));
  res.json(result);
});

// ---------- Rules ----------
const RULE_FIELDS = ['pattern', 'direction', 'type', 'category', 'description', 'details', 'ignore', 'priority'];

function cleanRule(body) {
  return {
    pattern: String(body.pattern || '').trim().toUpperCase(),
    direction: body.direction || null,
    type: body.type || null,
    category: body.category || null,
    description: body.description || null,
    details: body.details || null,
    ignore: body.ignore ? 1 : 0,
    priority: Number.isFinite(+body.priority) ? +body.priority : 70,
  };
}

app.get('/api/rules', (req, res) => {
  res.json(db.prepare('SELECT * FROM rules ORDER BY priority DESC, pattern').all());
});

app.post('/api/rules', (req, res) => {
  const r = cleanRule(req.body);
  if (!r.pattern) return res.status(400).json({ error: 'Pattern is required' });
  db.prepare(`INSERT INTO rules (${RULE_FIELDS.join(',')}) VALUES (${RULE_FIELDS.map(() => '?').join(', ')})`).run(...RULE_FIELDS.map((f) => r[f]));
  res.json(db.prepare('SELECT * FROM rules ORDER BY priority DESC, pattern').all());
});

app.put('/api/rules/:id', (req, res) => {
  const r = cleanRule(req.body);
  if (!r.pattern) return res.status(400).json({ error: 'Pattern is required' });
  db.prepare(`UPDATE rules SET ${RULE_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(
    ...RULE_FIELDS.map((f) => r[f]), req.params.id
  );
  res.json(db.prepare('SELECT * FROM rules ORDER BY priority DESC, pattern').all());
});

app.delete('/api/rules/:id', (req, res) => {
  db.prepare('DELETE FROM rules WHERE id = ?').run(req.params.id);
  res.json(db.prepare('SELECT * FROM rules ORDER BY priority DESC, pattern').all());
});

// ---------- Imports ----------
app.post('/api/imports', upload.array('files', 10), wrap(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
  const { batchId, errors } = await createBatch(req.files);
  if (!batchId) return res.status(400).json({ error: 'None of the files could be parsed', errors });
  res.json({ batch: getBatch(batchId), errors });
}));

app.get('/api/imports', (req, res) => {
  const batches = db.prepare(`
    SELECT b.*, COUNT(t.id) AS row_count FROM batches b LEFT JOIN transactions t ON t.batch_id = b.id
    WHERE b.status = 'staged' GROUP BY b.id ORDER BY b.id DESC`).all();
  res.json(batches.map((b) => ({ ...b, files: JSON.parse(b.files) })));
});

app.get('/api/imports/:id', (req, res) => {
  const batch = getBatch(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Import not found' });
  res.json(batch);
});

app.delete('/api/imports/:id', (req, res) => {
  transaction(() => {
    db.prepare("DELETE FROM transactions WHERE batch_id = ? AND status = 'staged'").run(req.params.id);
    db.prepare("DELETE FROM batches WHERE id = ? AND status = 'staged'").run(req.params.id);
  });
  res.json({ ok: true });
});

app.post('/api/imports/:id/accounts', (req, res) => {
  const { identifier, name } = req.body;
  if (!identifier || !name?.trim()) return res.status(400).json({ error: 'identifier and name are required' });
  transaction(() => {
    db.prepare('INSERT OR IGNORE INTO accounts (name) VALUES (?)').run(name.trim());
    db.prepare('UPDATE accounts SET identifier = NULL WHERE identifier = ?').run(identifier);
    db.prepare('UPDATE accounts SET identifier = ? WHERE name = ?').run(identifier, name.trim());
    db.prepare("UPDATE transactions SET account = ? WHERE batch_id = ? AND account_identifier = ? AND status = 'staged'")
      .run(name.trim(), req.params.id, identifier);
  });
  res.json(getBatch(req.params.id));
});

app.post('/api/imports/:id/duplicates', (req, res) => {
  if (req.body.action === 'delete') {
    db.prepare("DELETE FROM transactions WHERE batch_id = ? AND is_duplicate = 1 AND status = 'staged'").run(req.params.id);
  }
  res.json(getBatch(req.params.id));
});

app.post('/api/imports/:id/commit', (req, res) => {
  const id = req.params.id;
  const incomplete = db.prepare(`
    SELECT COUNT(*) AS n FROM transactions WHERE batch_id = ? AND status = 'staged' AND include_row = 1
    AND (account IS NULL OR type IS NULL OR type = '' OR category IS NULL OR category = '')`).get(id).n;
  if (incomplete > 0) {
    return res.status(400).json({ error: `${incomplete} included row(s) still need an account, type and category.` });
  }
  const result = transaction(() => {
    const committed = db.prepare("UPDATE transactions SET status = 'committed' WHERE batch_id = ? AND status = 'staged' AND include_row = 1").run(id).changes;
    db.prepare("UPDATE transactions SET status = 'ignored' WHERE batch_id = ? AND status = 'staged' AND include_row = 0").run(id);
    db.prepare(`INSERT OR IGNORE INTO descriptions (name) SELECT DISTINCT description FROM transactions
                WHERE batch_id = ? AND description IS NOT NULL AND description != ''`).run(id);
    db.prepare("UPDATE batches SET status = 'committed' WHERE id = ?").run(id);
    return committed;
  });
  res.json({ committed: result });
});

// ---------- Ledger-wide import / reset ----------
// Takes a full ledger export (the app's own "Entries" layout, e.g. an existing
// expense-tracker workbook) and commits every row straight to the ledger,
// bypassing the staged-review flow used for raw bank/card statements.
app.post('/api/ledger/import', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { rows, sheetName, incompleteRows } = parseLedgerXlsx(req.file.buffer);
  if (!rows.length) {
    return res.status(400).json({
      error: 'No entries found. Expected a sheet with Account, Date, Type, Category and Amount columns (like this app\'s own "Entries" export).',
    });
  }

  const result = transaction(() => {
    const existingFp = new Set(db.prepare('SELECT fingerprint FROM transactions').all().map((r) => r.fingerprint));
    const accounts = new Set(db.prepare('SELECT name FROM accounts').all().map((r) => r.name));
    const categories = new Set(db.prepare("SELECT type || '|' || name AS k FROM categories").all().map((r) => r.k));
    const insertAccount = db.prepare('INSERT OR IGNORE INTO accounts (name) VALUES (?)');
    const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (type, name) VALUES (?, ?)');
    const insertDescription = db.prepare('INSERT OR IGNORE INTO descriptions (name) VALUES (?)');
    const insertTxn = db.prepare(`
      INSERT INTO transactions (status, account, date, month, type, category, amount, description, details,
        narration, direction, source_file, fingerprint, include_row, auto_mapped)
      VALUES ('committed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`);

    let inserted = 0;
    let skipped = 0;
    for (const r of rows) {
      if (!accounts.has(r.account)) {
        insertAccount.run(r.account);
        accounts.add(r.account);
      }
      if (r.category && !categories.has(`${r.type}|${r.category}`)) {
        insertCategory.run(r.type, r.category);
        categories.add(`${r.type}|${r.category}`);
      }
      // Keyed on file name + source row (not the row's content) so genuinely
      // identical transactions on the same day are never mistaken for duplicates —
      // re-importing the same unmodified file is still a no-op.
      const fingerprint = ['ledger-import', req.file.originalname, r.row].join('|');
      if (existingFp.has(fingerprint)) {
        skipped++;
        continue;
      }
      existingFp.add(fingerprint);
      const direction = r.type === 'Income' ? 'credit' : 'debit';
      insertTxn.run(
        r.account, r.date, monthName(r.date), r.type, r.category, r.amount, r.description, r.details,
        r.description, direction, req.file.originalname, fingerprint
      );
      if (r.description) insertDescription.run(r.description);
      inserted++;
    }
    return { inserted, skipped, total: rows.length, sheetName };
  });
  res.json({ ...result, incompleteRows });
}));

// ---------- Danger zone ----------

// Deletes Categories, Sub categories, Auto-mapping rules and Accounts — everything
// on the Settings tabs — but leaves transactions/batches untouched, so historical
// ledger rows survive with whatever category/account text they already had, even
// though those no longer appear in any picker.
app.post('/api/settings/reset', (req, res) => {
  transaction(() => {
    db.prepare('DELETE FROM rules').run();
    db.prepare('DELETE FROM categories').run();
    db.prepare('DELETE FROM descriptions').run();
    db.prepare('DELETE FROM accounts').run();
  });
  if (req.body?.reseed) seedDatabase(db);
  res.json({ ok: true });
});

// Wipes everything — transactions, batches, and all Settings data — for a true
// from-scratch start.
app.post('/api/factory-reset', (req, res) => {
  const result = transaction(() => {
    const removed = db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM batches').run();
    db.prepare('DELETE FROM rules').run();
    db.prepare('DELETE FROM categories').run();
    db.prepare('DELETE FROM descriptions').run();
    db.prepare('DELETE FROM accounts').run();
    return { removed };
  });
  if (req.body?.reseed) seedDatabase(db);
  res.json({ ok: true, ...result });
});

// ---------- Transactions ----------
const EDITABLE = ['account', 'date', 'type', 'category', 'amount', 'description', 'details', 'include_row'];

function applyPatch(id, patch) {
  const fields = EDITABLE.filter((f) => f in patch);
  if (!fields.length) return;
  const values = fields.map((f) => (f === 'amount' ? +patch[f] : f === 'include_row' ? (patch[f] ? 1 : 0) : patch[f]));
  let sql = `UPDATE transactions SET ${fields.map((f) => `${f} = ?`).join(', ')}`;
  if ('date' in patch) {
    sql += ', month = ?';
    values.push(monthName(patch.date));
  }
  db.prepare(`${sql} WHERE id = ?`).run(...values, id);
}

// Saves (or updates) a user rule keyed on the merchant name, then applies it to
// every other staged row in the same import that matches the same pattern —
// including rows already marked auto_mapped, so fixing one row's mapping
// corrects all its siblings still in review, not just the untouched ones.
function rememberMapping(row) {
  const pattern = merchantKey(row.narration);
  if (!pattern || pattern.length < 3) return 0;
  const existing = db.prepare('SELECT * FROM rules WHERE pattern = ? AND direction IS ?').get(pattern, row.direction);
  if (existing) {
    db.prepare('UPDATE rules SET type = ?, category = ?, description = ?, details = ?, ignore = 0 WHERE id = ?')
      .run(row.type, row.category, row.description, row.details, existing.id);
  } else {
    db.prepare('INSERT INTO rules (pattern, direction, type, category, description, details, priority) VALUES (?, ?, ?, ?, ?, ?, 70)')
      .run(pattern, row.direction, row.type, row.category, row.description, row.details);
  }
  const rules = db.prepare('SELECT * FROM rules').all();
  const candidates = db.prepare(
    "SELECT * FROM transactions WHERE batch_id = ? AND status = 'staged' AND id != ?"
  ).all(row.batch_id, row.id);
  const update = db.prepare('UPDATE transactions SET type = ?, category = ?, description = ?, details = ?, auto_mapped = 1 WHERE id = ?');
  let applied = 0;
  for (const c of candidates) {
    const rule = findRule(rules, c.narration, c.direction);
    if (rule && rule.pattern === pattern) {
      update.run(row.type, row.category, row.description, row.details, c.id);
      applied++;
    }
  }
  return applied;
}

app.patch('/api/transactions/:id', (req, res) => {
  const { remember, ...patch } = req.body;
  const result = transaction(() => {
    applyPatch(req.params.id, patch);
    const mappingChanged = ['type', 'category', 'description', 'details'].some((f) => f in patch);
    if (mappingChanged) db.prepare('UPDATE transactions SET auto_mapped = 1 WHERE id = ?').run(req.params.id);
    const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
    if (patch.description) db.prepare('INSERT OR IGNORE INTO descriptions (name) VALUES (?)').run(patch.description);
    let appliedTo = 0;
    if (remember && mappingChanged && row.type && row.category && row.narration) appliedTo = rememberMapping(row);
    return { row, appliedTo };
  });
  if (!result.row) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.post('/api/transactions/bulk', (req, res) => {
  const { ids, action, patch } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No rows selected' });
  const n = transaction(() => {
    if (action === 'delete') {
      const del = db.prepare('DELETE FROM transactions WHERE id = ?');
      return ids.reduce((sum, id) => sum + del.run(id).changes, 0);
    }
    for (const id of ids) {
      applyPatch(id, patch || {});
      if (patch && ['type', 'category', 'description', 'details'].some((f) => f in patch)) {
        db.prepare('UPDATE transactions SET auto_mapped = 1 WHERE id = ?').run(id);
      }
    }
    return ids.length;
  });
  res.json({ affected: n });
});

app.post('/api/transactions', (req, res) => {
  const t = req.body;
  if (!t.date || !t.account || !t.type || !t.category || !(+t.amount > 0)) {
    return res.status(400).json({ error: 'Date, account, type, category and a positive amount are required' });
  }
  const direction = t.type === 'Income' ? 'credit' : 'debit';
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO transactions (status, account, date, month, type, category, amount, description, details, direction, fingerprint, auto_mapped)
    VALUES ('committed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
    t.account, t.date, monthName(t.date), t.type, t.category, +t.amount, t.description || '', t.details || '',
    direction, `manual|${Date.now()}|${Math.random()}`
  );
  if (t.description) db.prepare('INSERT OR IGNORE INTO descriptions (name) VALUES (?)').run(t.description);
  res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(lastInsertRowid));
});

function ledgerQuery(q) {
  const where = ["status = 'committed'"];
  const params = [];
  if (q.from) { where.push('date >= ?'); params.push(q.from); }
  if (q.to) { where.push('date <= ?'); params.push(q.to); }
  for (const f of ['account', 'type', 'category']) {
    if (q[f]) { where.push(`${f} = ?`); params.push(q[f]); }
  }
  if (q.q) {
    where.push('(description LIKE ? OR narration LIKE ? OR details LIKE ?)');
    params.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
  }
  return db.prepare(`SELECT * FROM transactions WHERE ${where.join(' AND ')} ORDER BY date, id`).all(...params);
}

app.get('/api/transactions', (req, res) => res.json(ledgerQuery(req.query)));

app.get('/api/months', (req, res) => {
  res.json(db.prepare("SELECT DISTINCT substr(date, 1, 7) AS ym FROM transactions WHERE status = 'committed' ORDER BY ym DESC").all().map((r) => r.ym));
});

app.delete('/api/transactions/:id', (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Export (Expense Tracker "Entries" column layout) ----------
app.get('/api/export.xlsx', (req, res) => {
  const rows = ledgerQuery(req.query);
  const header = ['Account', 'Date', 'Month', 'Category', 'Type', 'Amount', 'Description ', 'More Details'];
  const data = rows.map((r) => [
    r.account, new Date(`${r.date}T00:00:00`), r.month, r.category, r.type, r.amount, r.description || '', r.details || '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...data], { cellDates: true, dateNF: 'dd-mmm-yy' });
  ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 11 }, { wch: 14 }, { wch: 11 }, { wch: 10 }, { wch: 28 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Entries');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const label = [req.query.from, req.query.to].filter(Boolean).join('_to_') || 'all';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Finello_Entries_${label}.xlsx"`);
  res.send(buf);
});

// ---------- Static client (production build) ----------
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Finello API running at http://localhost:${PORT}`);
});
