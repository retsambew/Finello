# Finello

A local-first personal finance tracker. Drop in your bank/card statements,
let it auto-categorize what it recognizes, review the rest, and keep a
running ledger — all in a single SQLite file on your own machine. No account,
no cloud, no server to trust with your transactions.

Finello grew out of one person's monthly ritual of turning statement exports
into a hand-maintained expense spreadsheet. It's not a SaaS product and isn't
trying to be — it's a small, self-hosted tool for anyone who wants the same
workflow without doing it by hand every month.

> ### ⭐ Like it? That's all the thanks I need.
>
> Finello is free, and it's staying that way — I'm not asking for money,
> sponsorship, or anything like that. If it's useful to you, saved you some
> spreadsheet tedium, or you just think it's neat, the nicest (and easiest!)
> thing you could do is hit the **★ Star** button at the top of this page.
> Costs nothing, takes two seconds, makes my day, and helps someone else
> stumble onto this repo who might find it useful too. That's genuinely it
> — that's the whole ask. 🙂

## Features

- **Import** bank/card statements and get them parsed into transactions
  automatically (see [supported formats](#supported-statement-formats) below)
- **Auto-categorize** via editable merchant-pattern rules — teach it once
  ("Swiggy → Food") and it applies everywhere, going forward
- **Duplicate detection** across re-imports and multiple files in one upload
- **Review before it counts** — nothing hits your ledger until you confirm it
- **Ledger** with filtering, inline editing, manual entries, and export to
  `.xlsx` or clipboard (tab-separated, ready to paste into a spreadsheet)
- **Bulk-import** an existing "Entries"-style spreadsheet as your starting
  history, if you're migrating from a hand-kept tracker
- **Settings** to manage categories, sub categories, auto-mapping rules and
  accounts — with rename, usage counts, confirm-to-delete, and Undo
- Everything lives in one local SQLite file. Nothing is sent anywhere.

## Getting started

### Requirements

- [Node.js](https://nodejs.org) 22.5 or newer (24.x recommended). Finello
  uses Node's built-in `node:sqlite` module instead of a native database
  driver, so there's nothing to compile and no build toolchain required.
- Windows, macOS, or Linux.

On Windows, `start-finello.bat` (at the repo root) is a convenience launcher
— it just `cd`s into the project and runs `npm run dev` for you. It's meant
to be turned into a shortcut so you never have to open a terminal by hand:
right-click it → **Send to** → **Desktop (create shortcut)**, then pin that
shortcut to your taskbar or Start menu. Double-click it whenever you want to
open Finello, and close the console window it opens when you're done. On
macOS/Linux, just use the commands below directly.

### Install & run

```sh
git clone https://github.com/retsambew/Finello.git
cd Finello
npm run setup   # first time only — installs root + server + client deps
npm run dev     # starts the API (:5174) and the web app (:5173)
```

Open **http://localhost:5173**. Leave the terminal running while you use the
app; `Ctrl+C` to stop. Your data lives in `server/data/finello.db`, created
on first run and persisted between runs — it's git-ignored, so it never
leaves your machine and never gets committed.

### Run it standalone (single port, no dev server)

```sh
npm run build
npm start
```

This builds the client and serves it together with the API from one port,
`http://localhost:5174`.

## Data & privacy

- Finello is single-user with **no login or authentication**. It's built to
  run on your own machine, for your own eyes.
- The server binds to `127.0.0.1` (localhost) only, so it isn't reachable
  from your network by default — keep it that way. **Don't expose this to
  the open internet or a shared machine** without putting your own
  authentication in front of it (e.g. a reverse proxy with basic auth);
  there's none built in.
- All data lives in one local SQLite file. Nothing is uploaded, logged, or
  phoned home anywhere.
- If you already keep an "Entries"-style spreadsheet (Account / Date / Type
  / Category / Amount / Description columns), Finello can read a file named
  `sample-statements/Expense Tracker.xlsx` once to seed your categories and
  accounts, or you can bulk-import its rows as starting history from the
  Settings page. Either way, Finello only ever _reads_ that file — it's
  never written to automatically. `sample-statements/` is git-ignored: drop
  your own statement files and, optionally, that spreadsheet there, and
  none of it ever becomes part of this repository.

## Monthly workflow

1. **Import** — drop the month's statement files onto the Import page.
2. If a file is from an account Finello hasn't seen before, you'll be asked
   to name it once.
3. If any rows look like duplicates of something already imported, you'll be
   asked whether to skip them or review them individually.
4. **Review** — rows Finello recognized are already categorized. For
   anything new, pick a Type/Category from the dropdown or type a new one;
   check "Remember my mappings" (on by default) so the same merchant
   auto-categorizes next time.
5. **Save to ledger** once every included row has an account, type and
   category.
6. **Ledger** — browse/filter/edit everything you've saved, add manual
   entries (e.g. cash), and export to `.xlsx` or copy rows for pasting into
   a spreadsheet.
7. **Settings** — manage auto-mapping rules, categories, sub categories, and
   accounts. Deletions require a confirm click and can be undone from the
   toast that follows.

## Supported statement formats

- HDFC Bank savings/current account `.xls` export
- HDFC Credit Card `.xls` statement (both the "Neu Card" and "Swiggy Card"
  column layouts)
- SBI Card PDF statement

The default categories and auto-mapping rules are intentionally minimal —
a few common Expense/Income buckets and a handful of widely-recognizable
merchant patterns (food/grocery delivery, e-commerce, telecom), not a
finished setup. They're a starting example, not a requirement: everything
under Settings (categories, sub categories, rules, accounts) is fully
editable, and an unrecognized merchant just means one extra click to
categorize it the first time.

Each transaction has three levels of detail, from broad to specific:
**Category** (e.g. "Utilities") → **Sub category** (e.g. "Recharge") →
**Description** (e.g. "Airtel").

Have a different bank or a statement format that doesn't parse? Open an
issue with a sample (redact account numbers and personal details first) —
see `server/src/parsers/` for the pattern a new parser follows; each one
just needs to export `detect()` and `parse()`.

## Tech stack

- **Server**: Node.js + Express, using the built-in `node:sqlite` module (no
  native compilation needed) and [SheetJS](https://sheetjs.com) for reading
  and writing `.xlsx` files.
- **Client**: React + Vite, no router or component library — plain CSS with
  light/dark theming.
- No ORM — raw SQL via `node:sqlite`'s prepared statements.

## Contributing

Issues and pull requests are welcome — bug reports, new statement parsers,
or UX suggestions. There's no test suite yet; verify a change by running the
app against real (or sample) statement files and checking totals against
the numbers printed on the statement itself.

## License

[MIT](LICENSE) — do whatever you'd like with it.
