# Beta-Testing Operation — State

**This file is the source of truth for resuming the autonomous beta-testing
operation between Claude sessions.** Read this first when a new session starts.

## Current cycle

- **Cycle**: 1 ✅ DONE · 2 ✅ DONE · 3 ✅ DONE · 4 ✅ DONE. Cycle 5 = P2 polish wave.
- **Status**: `CYCLE_DONE` after cycle 4.
- **Last commit**: `3501bc0` (Cycle 4 P1 wave)
- **Open after cycle 4**: ~30 P2 polish bugs across 6 areas

## ✅ Cycles 1-4 — what closed

| Cycle | Outcome |
|---|---|
| 1 | 13 P0 closed (security + life-safety + demo-breakers) |
| 2 | 16 P1 closed + 9 new widget editors |
| 3 | 22 cycle-1+2 fixes verified, 4 P0 regressions fixed, 6 RETAIL editors added |
| 4 | 14 P1 fixed (auth role-guard, schedule playlistId, oauth2 backend symmetry, SW signed-URL key, ALL_CLEAR, pairing collision, BAR editors, dropzone a11y, etc.) |

**Total bugs fixed across 4 cycles: 13 P0 + 30 P1 + 15 widget editors added = 58 issues closed.**

## 🟡 Cycle 5 — P2 polish wave (~30 bugs)

The P2 list is mostly cosmetic / edge-case bugs that don't block ship:
- AI rate-limit slot consumption on failed Anthropic calls (still leaks counter)
- AI rate-limit Map leaks tenants forever (no eviction)
- AI docstring promises Billing log that doesn't exist
- Re-importing same file creates duplicate Playlists
- Imports leaks Supabase error text to client
- non-numeric `count` field produces "Generate NaN options" prompt
- Streaming channel picker has no `.catch` for query errors — infinite "Loading…"
- POS category picker swallows ALL errors as empty result
- Ad-network ConnectModal doesn't gate on `salesLedOnly`
- iframeOnly connections stuck in PENDING forever
- Sample-data restaurant + retail mutually exclusive per tenant (unique constraint)
- Capability data collected at boot but typed body drops it
- player BUG-014 (DUMMY_HASH_PROMISE no error path)
- editor SECTION_LABELS missing ~30 fitness-scene prefixes
- v2 admin Ops Console widgets disappear for non-K12 (admin→OFFICE in K12_ONLY)
- AssetPickerField uses uncontrolled defaultValue
- emergency BUG-014 spec file may still assert old 'global_clear' literal
- Unicode NFC + RTL/zero-width chars not stripped by sanitizeOriginalName
- ...etc.

See full lists in `BUG_REPORTS/CYCLE-1-*.md` (P2 sections) and
`BUG_REPORTS/CYCLE-3-*.md` (NEW bugs sections).

## How to resume cycle 5

```
Agent({
  description: "Cycle 5 — P2 polish batch 1 of 3",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: "Fix the P2 bugs from cycle-1+3 reports listed in this batch [list 8-10 bugs with file:line]. Use safe-parse / silent-skip / display-only patterns where appropriate. GROUND RULES + write to FIX_LOG/CYCLE-5-fixes.md."
})
```

3 P2 batch agents in parallel (10 bugs each) covers everything.

## Token-budget note

Each cycle uses roughly half a session's tokens. We've now done 4
cycles. The user signalled tokens would run out and we should resume
across sessions — STATE.md makes that survivable. Cycle 5 (P2 polish)
is a smaller scope and could be a single short batch.

## Commit ledger

```
a4546fa  BETA_TESTING infrastructure
fb287f6  4 cycle-1 reports mid-cycle save
d1e8ff7  4 cycle-1 P0 fixes
1494766  TRIAGE doc + STATE
3c0b0f1  fix-wave-2 dispatch state
0898a8d  8 cycle-1 P0 fixes (full)
11cf4f1  STATE for cycle 2
7b30bb1  16 cycle-2 P1 fixes + 9 editors
ff4df07  STATE for cycle 3
49c513c  Cycle 3 dispatch state
b0aa3a8  Cycle 3 retests + 6 RETAIL editors
642c2b4  4 cycle-3 P0 regression fixes
bab1e55  STATE for cycle 4
bc29eef  Cycle 4 dispatch state
3501bc0  14 cycle-4 P1 fixes  ← current
(this commit)  STATE for cycle 5
```

## Resume phrase

User pastes "resume beta testing" → Claude reads STATE.md → sees cycle
4 done → dispatches cycle 5 P2 polish wave. Three batches of ~10 P2
bugs each, parallel.
