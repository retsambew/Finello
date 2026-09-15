# Finello — agent context

Personal, local-only monthly finance tracker for a single user. Not a
multi-tenant SaaS despite the original ask using that word — no auth, no
cloud, single SQLite file. Runs on Windows via `npm run dev` from the repo
root (Express API on :5174, Vite React dev server on :5173 proxying `/api`
to it). **Read this whole file before starting a new feature** — the parsing
and dedup logic especially has non-obvious gotchas documented below that cost
real debugging time; don't rediscover them.

## Why this exists

Every month the user drops 3–4 bank/card statement files
into `sample-statements/` (git-ignored — never part of the repo) and wants
them turned into rows matching the `Entries` sheet of their existing
hand-maintained `Expense Tracker.xlsx`, with known merchants (Swiggy,
Instamart, HungerBox, ...) auto-categorized and everything else editable
before it's saved. Real statement files and a real `Expense Tracker.xlsx`
live in `sample-statements/` when present locally — they're sample/reference
data _and_ the user's actual working files, not throwaway fixtures. Don't
delete or rewrite them; the app only ever _reads_ `Expense Tracker.xlsx`
(once, from `sample-statements/Expense Tracker.xlsx`, to seed the database
on first run) and never writes to it.

## Stack & why

- **Server**: Node/Express, CommonJS. **`node:sqlite`** (Node's built-in
  module, stable enough at the pinned Node version) instead of
  `better-sqlite3` — this machine has no Visual Studio build tools, so
  anything requiring native compilation (`node-gyp`) fails to install. Don't
  reintroduce a native-module dependency without checking the environment
  can build it.
- **`xlsx` (SheetJS)**: installed from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`,
  **not** the npm registry version. The npm-published `xlsx` package is
  frozen on an old release with known prototype-pollution/ReDoS CVEs with no
  fix on npm; SheetJS ships fixed builds only from their own CDN. Keep
  installing it this way — `npm audit` should stay at 0 vulnerabilities.
- **`pdf-parse`**: for the SBI Card PDF. Text-based statement, not scanned —
  extraction is reliable, but see the ordering gotcha below.
- **Client**: React 19 + Vite, no router library (just tab state in `App.jsx`),
  no component library — plain CSS in `client/src/styles.css` with
  light/dark tokens. No state management library; each page fetches its own
  data via `client/src/api.js`.
- **No ORM**: raw SQL via `node:sqlite`'s `db.prepare(...).run/get/all()`.

## Repo layout

```
server/src/
  db.js          schema (CREATE TABLE ...) + seeds on first run
  seed.js        seeds categories/accounts/descriptions from Expense Tracker.xlsx,
                 falls back to hardcoded defaults if that file is missing
  rules.js       merchant-narration -> {type, category, description, details} matching engine
  imports.js     turns uploaded files into a staged "batch" of transactions
  parsers/       one file per statement format, plus ledgerXlsx.js (see below)
  index.js       all Express routes (flat file, no router split — it's ~400 lines, fine)
client/src/
  api.js         tiny fetch wrapper + inr()/fmtDate() formatters
  App.jsx        tab switcher (Import / Review / Ledger / Settings), owns `meta` + `batchId`
  pages/         one component per tab
  components/    ComboInput (input+datalist "pick or add new"), TxnTable (shared editable
                 grid used by both Review and Ledger), LedgerActions (bulk import/reset
                 buttons, used from both Ledger and Settings pages), Toast
server/data/finello.db   the actual database, gitignored (see .gitignore at repo root,
                         which also ignores sample-statements/ — the local drop folder
                         for statement files and an optional Expense Tracker.xlsx)
```

## Data model (`server/src/db.js`)

### Gotcha: UI labels for `description`/`details` no longer match the column names

The `transactions` and `rules` tables still have columns literally named
`description` and `details` — those were **not** renamed (renaming would've
meant migrating the user's real, populated `finello.db`, for a purely
cosmetic change). But every user-facing label was flipped: the column
`description` (merchant name, e.g. "Swiggy" — backed by the `descriptions`
table/dropdown) is now shown as **"Sub category"**, and the column `details`
(freeform extra text, formerly "More details", previously only ever
populated by ledger import / manual entry) is now shown as **"Description"**.
So when reading or writing code, `row.description` means sub category and
`row.details` means description — grep for `Sub category`/`>Description<` in
`client/src/` if a UI string looks stale, don't assume the column name tells
you the label.

- `accounts (id, name UNIQUE, identifier UNIQUE)` — `identifier` is how a
  parsed file's account hint gets matched to an account without asking the
  user every time (e.g. `hdfc_savings`, `card:1234`, `sbi_card:XX99`).
  `identifier` is `NULL` for manually-created accounts (e.g. "Cash").
- `categories (id, type, name, tag, UNIQUE(type, name))` — `type` is the
  broad bucket (Income/Expense/Investment/CC Bill/Exchange — matches the
  user's own `Settings` sheet "Type" column when one is present), `name` is
  what the user's sheet calls "Category" (Food, Transport, Bills &
  Utilities, ...), `tag` is Need/Want, only meaningful for Expense. The
  `description` column on `transactions`/`rules` (shown in the UI as
  **"Sub category"**) is the one genuine level beneath `category` — don't
  add a further, third level without being asked.
- `descriptions (name)` — flat list of merchant/sub-category strings ever
  used, for the "Sub category" dropdown. Seeded from every distinct
  `Description` value in the user's existing `Entries` sheet if one is
  present, otherwise from `DEFAULT_CATEGORY_GROUPS`'s subcategory lists in
  `seed.js`.
- `rules (id, pattern, direction, type, category, description, details,
ignore, priority)` — the auto-mapping engine's source of truth. `pattern` is
  matched as a case-insensitive substring against the transaction narration.
  `direction` (`debit`/`credit`/`NULL`) optionally restricts which side a
  rule applies to. `description` and `details` map onto the transaction's
  "Sub category" and "Description" fields respectively (see naming gotcha
  above) — both are optional per rule, and either can hold whatever's
  useful. `DEFAULT_RULES` in `seed.js` only ever sets `description`
  (`details` stays unset there), but that's just how the seed data happens
  to be written, not a rule about the column itself.
  `ignore=1` means matching rows default to excluded (used for card-bill
  payment lines that would double-count money already tracked on the bank
  side — see "CC bill payment" gotcha below). Higher `priority` wins; ties
  broken by longer pattern. Seeded once from `DEFAULT_RULES` in `seed.js` —
  a deliberately generic starter set (see `DEFAULT_CATEGORY_GROUPS` for the
  Expense category/subcategory taxonomy and the comment above
  `DEFAULT_RULES` for the merchant patterns), not modeled on any one
  person's real spending — and grows over time from "remember this mapping"
  in the Review UI, or from editing the Settings page's rules table
  directly. Installs that predate the `details` column get it added via an `ALTER TABLE` migration
  guarded by a `PRAGMA table_info(rules)` check in `db.js` — this is the
  only migration in the codebase; follow the same guarded-`ALTER TABLE`
  pattern (never a bare `CREATE TABLE IF NOT EXISTS` column change, which
  silently no-ops on an existing table) for any future additive schema
  change, since the user's real `finello.db` already has data in it.
- `batches (id, files JSON, status)` — one row per import; `status` is
  `staged` until commit, then `committed`.
- `transactions` — both staged (unconfirmed, `batch_id` set, `status =
'staged'`) and committed (`status = 'committed'`, in the real ledger) rows
  live in the **same table**. `status = 'ignored'` is used for rows the user
  excluded at commit time (kept for audit/dedup purposes, never shown in the
  ledger). `fingerprint` has **two distinct shapes that never collide**:
  statement-imported rows use `account_identifier|date|amount.toFixed(2)|
direction|normalized_narration` (see dedup below); bulk ledger-imported
  rows (from `/api/ledger/import`) use `ledger-import|account|date|amount|
type|category|description` instead, since a historical ledger row has no
  raw narration or account-identifier to key on. Manual entries (`POST
/api/transactions`) get a throwaway `manual|<timestamp>|<random>`
  fingerprint — they're never meant to dedup against anything.
  `auto_mapped` = 1 once a rule (or the user) has set type+category+description;
  drives the "Needs review" highlighting in the Review table.

Seeding only runs once (`seedDatabase` in `seed.js` no-ops if `categories`
already has rows). To re-seed from scratch during development: stop the
server and delete `server/data/` entirely (also removes all transaction
history — only do this on a throwaway/test DB, never on the user's real one
without asking).

## Parsers (`server/src/parsers/`)

Each parser exports `detect(rows|buffer)` and `parse(buffer, {filename})` ->
array of `{ date (ISO), narration, amount (+ve), direction: 'debit'|'credit',
accountHint: {...}, sourceFile }`. `parsers/index.js` dispatches by file
extension then tries `detect()` on each known format.

- **`hdfcSavings.js`** — HDFC savings/current account `.xls` export.
  Finds the header row by locating `Narration` + `Withdrawal Amt` + `Deposit
Amt` cells (position varies), not a fixed row index.
- **`hdfcCard.js`** — handles **both** HDFC card statement layouts in this
  repo (the "Neu Card" one has an extra "Base NeuCoins" column shifting
  later columns right; the "Swiggy Card" one doesn't) via the same
  header-label search rather than fixed column indices. Card's last-4 comes
  from a `Card No: XXXX XXXX XXXX NNNN` cell found by regex anywhere in the
  sheet.
- **`sbiCardPdf.js`** — see the pdf-parse ordering gotcha immediately below
  before touching this file.
- **`ledgerXlsx.js`** — different from the others: it doesn't parse a _bank_
  statement, it parses the app's **own** `Entries`-shaped export layout
  (Account/Date/Month/Category/Type/Amount/Description/More Details), so a
  user's existing full history (e.g. their real `Expense Tracker.xlsx`,
  ~1500+ rows) can be bulk-loaded as a one-time starting point. Reads with
  `cellDates: false` deliberately and converts Excel's numeric date serials
  via `XLSX.SSF.parse_date_code` instead of `new Date(...)` — a plain JS
  `Date` on a whole-day Excel serial shifts by the local timezone offset and
  silently produces the wrong calendar day. Don't "simplify" this back to
  `cellDates: true` + `Date` without checking a date at the timezone
  boundary.

### Gotcha: `pdf-parse` does not preserve visual reading order

SBI's PDF statement visually shows two blocks per page — a "Payments /
Credits" list and a "Purchases / Debits" list — laid out as if in separate
columns. `pdf-parse`'s extracted text does **not** follow that visual order;
naively slicing the text after the `"TRANSACTIONS FOR"` marker (which looks
like it should be the start of the debit list) silently **drops the entire
credit block** — cashback, refunds, bill payments — because that block's
text actually appears at a different position in extraction order than the
page layout suggests. Confirmed by the fact that the sum of one block
exactly matched the statement's printed "Additions, Payments, Reversals &
other Credits" total once captured correctly. **The fix**: don't try to
locate the credit vs. debit sections separately — run one regex pass across
the _entire_ transactional region (from document start to the
`"SAVINGS AND BENEFITS SECTION"` footer marker) and let the per-line regex
(which requires a trailing `D`/`C` suffix) do the filtering. Also:
`pdf-parse` sometimes drops the space between the year and the next word
(`"03 Jul 26UPI-HungerBox40.00D"`), so the line regex can't assume
whitespace-delimited tokens — see `TXN_LINE` in `sbiCardPdf.js`.

### Gotcha: SheetJS column indices are relative to the sheet's `!ref`, not column A

`XLSX.utils.sheet_to_json(sheet, {header:1})` returns arrays indexed from
wherever the sheet's actual used-range starts — `Expense Tracker.xlsx`'s
`Settings` and `Entries` sheets both start at column **B**, not A. Assuming
`row[0]` is column A when the sheet was authored starting at B silently
shifts every field over by one and corrupts data with no error (this
actually happened during development — a row's Type came out as `"Category"`
and Category as `"Tag"`, i.e. the header row's own labels, because the
destructure was off by one column). **Whenever reading a sheet with
`header:1`**, print `sheet['!ref']` and a few raw rows first and count
columns explicitly — don't assume column A is index 0. `seed.js`'s
`readTrackerSeed()` has comments at each destructure explaining the actual
column mapping for this specific file; if the user's `Expense Tracker.xlsx`
layout ever changes, this needs re-deriving the same way (dump raw rows,
count from the sheet's real start column).

### Gotcha: CC bill payments would double-count if not filtered

When money moves _from_ the bank account _to_ pay off a credit card
(narrations like `TELE TRANSFER CREDIT` or `PAYMENT RECEIVED` appearing as
**credit**/positive entries on the card's own statement), that's not real
income — it's the same rupee already being counted as an `Expense` (or
`CC Bill`) elsewhere. Two seeded rules (`PAYMENT RECEIVED`, `TELE TRANSFER
CREDIT`) have `ignore=1` so these default to excluded (`include_row = 0`) at
import time. If asked to parse a new bank/card that has similar
self-payment narrations, add an `ignore` rule for it rather than letting it
count as Income.

## Import → Review → Commit flow (`imports.js` + `index.js` + `ReviewPage.jsx`)

1. `POST /api/imports` (multipart) — parses every uploaded file, applies
   `rules.js` to each transaction, inserts everything as `status='staged'`
   rows under a new `batches` row, then runs `markDuplicates()`.
2. **Duplicate detection** (`markDuplicates` in `imports.js`) is
   count-aware, not just "does this fingerprint exist": if the _same_
   fingerprint appears twice in one uploaded file (two genuine ₹18 HungerBox
   charges same day), that's not a duplicate; if it _also_ already exists
   among `committed`/`ignored` rows (or repeats across files in the same
   upload beyond how many times the max single file has it), the excess is
   flagged `is_duplicate=1`. Read this function before changing dedup logic
   — it's easy to accidentally flag legitimate repeat small transactions.
3. If any transaction's `accountIdentifier` doesn't match a known account,
   `getBatch()` returns it under `unmappedAccounts` and the Review page
   blocks on a modal asking the user to name/pick the account
   (`POST /api/imports/:id/accounts`) before anything else.
4. Then, if `duplicateCount > 0`, a modal offers "skip duplicates" (bulk
   delete via `POST /api/imports/:id/duplicates {action:'delete'}`) or
   "keep and review" (just filters the table to `dup`).
5. User edits rows inline (`PATCH /api/transactions/:id`). If they change
   type/category/description (i.e. Sub category — see naming gotcha above)
   on a row and "Remember my mappings" is checked, `rememberMapping()` in
   `index.js` both upserts a `rules` row keyed on a normalized merchant key
   (derived from the narration — strips `UPI-` prefixes, `PAYU*`/`RAZORPAY*`
   prefixes, trailing city names — see `merchantKey()` in `rules.js`) **and**
   immediately reapplies it (type/category/description/details) to *every*
   other staged row in the same batch that matches the same pattern —
   including rows already marked `auto_mapped=1`, not just untouched ones.
   This means fixing one row's mapping corrects all its siblings still in
   review, even ones the user (or a rule) had already set differently.
6. `POST /api/imports/:id/commit` refuses (400) if any _included_ row is
   missing account/type/category — this is the only real validation gate.
   Included rows flip to `status='committed'`; excluded ones flip to
   `status='ignored'` (kept for future dedup matching, hidden from the
   ledger).

## Bulk ledger import (`/api/ledger/import`, `LedgerActions.jsx`)

Separate from the monthly statement flow above — this is how the user
bootstraps (or rebuilds) their full transaction history in one shot:

- `POST /api/ledger/import` (single file, `ledgerXlsx.js`) — parses an
  `Entries`-shaped workbook (their real `Expense Tracker.xlsx` is the
  intended input, but any file this app exported also round-trips) and
  inserts every row **directly as `status='committed'`**, skipping staged
  review entirely — bulk history is trusted as already-categorized. Missing
  accounts/categories are auto-created rather than blocking. Dedups against
  existing rows by the `ledger-import|...` fingerprint (see above), so
  re-running the import with an updated export is safe and only adds new
  rows. Surfaced as an "Import ledger (.xlsx)" button in both the empty-
  ledger state and the Ledger toolbar (`ImportLedgerButton` in
  `LedgerActions.jsx`) — Settings no longer has its own copy of this button;
  see the Danger zone section below for Settings' own destructive actions.

## Danger zone (`/api/settings/reset`, `/api/factory-reset`, `DangerZoneActions.jsx`)

Settings > Accounts & data has a "Danger zone" section with two destructive,
typed-confirmation actions (both replaced the old "Reset ledger" button,
which no longer exists on either the Ledger or Settings page):

- `POST /api/settings/reset` (**"Delete settings"**, type `DELETE` to
  confirm) — deletes every `category`, `description` (sub category),
  `rule`, and `account` row. Transactions/batches are left untouched, so
  historical ledger rows keep whatever category/account text they already
  had even though it no longer appears in any picker.
- `POST /api/factory-reset` (**"Delete all data (factory reset)"**, type
  `RESET` to confirm) — deletes everything above **plus** all
  `transactions` and `batches`, i.e. a full wipe.

Both accept `{ reseed: boolean }` in the body, driven by a `Switch` toggle
(`components/Switch.jsx` — a real `role="switch"` control, not a styled
checkbox; use it for any future boolean toggle instead of a checkbox) in
each confirmation modal: when true, `seedDatabase(db)` (`seed.js`) is called
immediately afterward to repopulate `DEFAULT_CATEGORIES`/`DEFAULT_ACCOUNTS`/
`DEFAULT_RULES` (or re-read `Expense Tracker.xlsx` if present); when false,
the tables are left empty. Note `seedDatabase` also runs automatically at
server startup whenever `categories` is empty (`db.js`), so leaving seed
data disabled only stays empty until the next server restart — that's
existing seed-on-empty behavior, not something these two routes override.

## Ledger & export

`GET /api/transactions` (and the Ledger page) only ever query
`status='committed'` rows. `GET /api/export.xlsx` regenerates a fresh
workbook with a single `Entries`-shaped sheet (same 8 columns, same header
text including the trailing space in `"Description "` — that trailing space
matches the real file, don't "fix" it) from whatever the current filter
matches — it does **not** touch the user's real `Expense Tracker.xlsx`. The
exported `"Description "` column is fed from `transactions.description`
(the app's own "Sub category" field) and `"More Details"` from
`transactions.details` (the app's own "Description" field) — the real
workbook's column headers are a fixed external contract and were never part
of the app's own in-UI rename, so don't "fix" this mapping to match the
app's current labels. The
Ledger page's "Copy rows for Excel" button is the other export path — copies
tab-separated rows to the clipboard formatted so pasting into the real
Entries sheet works directly.

## Conventions to keep following

- **Never write to `Expense Tracker.xlsx`.** It's read-only, seed-time-only
  input. If a future feature wants to sync back into it, that's a real
  product decision to raise with the user first (it was explicitly decided
  against once already — see "Local database, export to Excel" in the
  project history) — don't silently add write access.
- **New statement format** → add `server/src/parsers/<name>.js` exporting
  `detect`/`parse`, register it in `parsers/index.js`. Verify by testing
  the parsed debit/credit totals against the numbers printed on the actual
  statement (its "Account Summary"/totals section) — this caught the two
  bugs above and should be the standard check for any new parser.
- **New merchant mapping** → don't hardcode it in `rules.js`'s
  `DEFAULT_RULES` unless it's a one-time seed decision; prefer letting the
  "remember this mapping" flow create it, or add it via the Settings page's
  rules table (`POST /api/rules`) so it's visible/editable to the user.
- **Category vs. subcategory**: there are two levels beneath `type` —
  `category` and, one level further, the `description` column shown in the
  UI as "Sub category" (see naming gotcha at the top of "Data model"). If
  the user asks for a genuine third level, that's a schema change (new
  column + UI), not something to fake with string concatenation.
- Money is always stored as a plain positive `REAL`; sign/direction lives in
  `direction` (`debit`/`credit`) or is inferred from `type === 'Income'`.
  Don't introduce negative amounts.
- `ComboInput` (client) is the "pick existing or type a new one" pattern
  used everywhere (account/type/category/description). Reuse it for any new
  editable dropdown-like field instead of a plain `<select>`, to keep the
  "always allow adding new" requirement consistent.
- `ImportLedgerButton` (`LedgerActions.jsx`) is used from both the empty-
  ledger state and the Ledger toolbar on purpose (same bulk action, two
  entry points). If it needs to change, change it once there — don't fork a
  second copy into a page. `DeleteSettingsButton`/`FactoryResetButton`
  (`DangerZoneActions.jsx`) are Settings-only and live in the Danger zone
  section of Accounts & data.

## Running / dev loop

```
npm run setup   # once: installs root + server + client deps
npm run dev     # runs API (:5174, node --watch) and Vite (:5173) together
```

No test suite exists. Verify backend changes by hitting the API directly with
`curl` against real sample statement files in `sample-statements/` (e.g. `curl
-F "files=@sample-statements/Acct_Statement_XXXXXXXX1234_31012026.xls" ... http://127.0.0.1:5174/api/imports`),
and verify parser changes by comparing totals against the statement's own
printed summary numbers, not just "it ran without throwing." If you touch
seeding logic, test against a scratch copy of `server/data/`, not the user's
real one — it likely has real committed history in it by now.
