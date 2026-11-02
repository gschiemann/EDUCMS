# Weekly reviews — Article 44

The engine of the self-improvement loop: every Monday a fresh Claude Code session runs `WEEKLY-REVIEW-PROMPT.md` (the versioned prompt — the only copy), gathers the week's real signals with `../tools/weekly-review-signals.mjs` and `scripts/ops-sweep.mjs`, writes `<YYYY>-W<ww>.md` here, and opens one PR for the owner. ≤ 10 bullets, ≤ 3 amendment proposals, each tied to an incident or a number. The routine is **L1** in the autonomy register: it prepares, it never merges, it reads only GitHub and the public health endpoint — no database, no secret, no change to the application.

Approved by the owner on 2026-10-31 ("Yes, build it"), during the launch freeze, as a zero-runtime item.

| | |
|---|---|
| Schedule | Mondays 08:30 Pacific, local scheduled task in the owner's Claude Code app (runs on next launch if the app was closed) |
| Prompt | `WEEKLY-REVIEW-PROMPT.md` — change it by PR like any rule |
| Signals | `node docs/governance/tools/weekly-review-signals.mjs [--json out.json] [--days 7]` — run it by hand any time |
| Records | `<YYYY>-W<ww>.md`, one per week, merged by the lead after the owner reads them |
| Not visible to the routine (Phase 1) | capacity samples, alert shadow sends, bug rows, Vercel/Railway/Supabase/AI spend — until a read-only SUPER_ADMIN source or a cost ledger exists |
