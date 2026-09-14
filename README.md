# Finello

A local finance tracker for your monthly statement import. Upload your HDFC
bank/card `.xls` files and SBI card PDF, review the auto-categorized
transactions, and export them in the same column layout as `Expense
Tracker.xlsx`.

## Run it

First time only:

```
npm run setup
```

Every time you want to use it:

```
npm run dev
```

Then open **http://localhost:5173**. Leave the terminal running while you use
the app; close it (Ctrl+C) when you're done. Your data lives in
`server/data/finello.db` and persists between runs.

## Monthly workflow

1. **Import** — drop the month's statement files (HDFC savings `.xls`, the two
   HDFC card `.xls` files, SBI card PDF, or any new one).
2. If a file is from a card Finello hasn't seen before, you'll be asked to
   name the account once.
3. If any rows look like duplicates of something already imported, you'll be
   asked whether to skip them or review individually.
4. **Review** — rows Finello recognized (Swiggy, HungerBox, Instamart, Amazon,
   etc.) are already categorized. For anything new, pick a Type/Category from
   the dropdown or type a new one; check "Remember my mappings" (on by
   default) so the same merchant auto-categorizes next month.
5. **Save to ledger** once every included row has an account, type and
   category.
6. **Ledger** — browse/filter/edit everything you've saved, add manual cash
   entries, and either download a `.xlsx` in the Entries column layout or
   "Copy rows for Excel" to paste straight into your existing tracker file.
7. **Settings** — manage the merchant auto-mapping rules, categories, and
   accounts directly.

## Notes

- Nothing is written to your `Expense Tracker.xlsx` automatically — Finello
  keeps its own database and only exports/copies rows on your request, so
  your original file is never at risk.
- The parsers are tuned to the exact statement formats in this folder (HDFC
  savings/card `.xls` exports, SBI Card PDF). A differently formatted
  statement may fail to parse — if so, share a sample and the parser can be
  extended.
