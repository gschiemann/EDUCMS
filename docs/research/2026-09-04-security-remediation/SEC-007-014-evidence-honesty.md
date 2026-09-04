# SEC-007 + SEC-014 — proof-of-play evidence honesty, and a seed that printed a secret

**Branch:** `worktree-agent-a529545b7fab409b7` (branched from master `f22bc8e0`)
**Date:** 2026-09-04
**Status:** implemented, tsc + full Jest green on both apps, NOT pushed, NOT
live-verified in a browser (see *What I did not verify*).

> `docs/research/` is in `.gitignore`. This file was committed with `git add -f`
> so it survives worktree removal and reaches the lead's diff. Drop it from the
> merge if the ignore rule is meant to be absolute.

---

## 1. What was actually wrong

### SEC-007 (P1) — the API told the truth; the operator-facing artifact did not

Master already had a good backend: a 30-minute HMAC capability binding game ·
scope · screen · credential epoch · nonce · expiry, a Redis `SET NX` replay
claim, a real `SponsorImpression.verified` column, and a `gameReport()` that
split verified from unverified and attached an `evidence` note.

None of that reached the operator. `SponsorPanel.tsx` **omitted `verified`,
`unverified` and `evidence` from its TypeScript interfaces entirely**. Because
the fields were not in the type, they were not read, and the panel:

- summed a single `total` and put it in the collapsed header as
  *"— this game, measured (N impressions)"*;
- described the table as *"real airings per surface — the numbers you hand a
  sponsor"*;
- exported `Sponsor, Board, Ribbon, Total, Within cap` to a file literally named
  `proof-of-play-<gameId>.csv`.

An impression beacon is a public unauthenticated HTTP POST. Every row written
before the capability shipped, and every row from an OBS overlay or an
HDMI-driven board, is anonymous. The panel was presenting those to an operator
as billable proof. That is the whole finding: the number an invoice is argued
from was a claim the system could not support.

Three narrower defects sat behind it:

1. **Replay fallback lied about itself.** When Redis was unreachable,
   `claimBeaconSequence` fell back to a per-process `Map` and returned
   `shared: false` — but `resolveBeaconAttestation` still wrote
   `verified: true`. Across replicas a captured beacon can be re-fired at
   another pod, so "single-use" — the property that makes the count evidence —
   had not been established.
2. **Beacon-time verification was pure crypto.** Minting runs the real
   `verifyDeviceForScreen`, so a revoked screen cannot mint. But the capability
   then lives 30 minutes and nothing re-read the screen. Revoking a screen did
   *not* kill its beacons; it killed its ability to mint new ones. The module's
   own comment ("so revoking the screen kills its beacons too") was true at mint
   and false everywhere else.
3. **`UNATTESTED` and the attestation shape carried no reason**, so a collapsed
   verified count was indistinguishable from "the boards stopped reporting".

### SEC-014 (P2) — seed tooling printed a secret

`packages/database/prisma/seed.ts:154-155`:

```ts
console.log(`  Admin: admin@springfield.edu / ${SEED_PASSWORD} (preserved if already set)`);
console.log(`  Teacher: teacher@springfield.edu / ${SEED_PASSWORD} (preserved if already set)`);
```

Locally that only echoed the public `admin123` default. On a production or CI
seed run — where `SEED_PASSWORD` is required and is the operator's own chosen
secret — it wrote that secret to stdout, which is captured by CI logs, Railway
deploy logs, terminal scrollback and shell history.

---

## 2. What I changed

### (a) Split verified vs unverified in the panel and the CSV

`apps/web/src/app/[schoolId]/sports/[gameId]/SponsorPanel.tsx`

- `GameReportSponsorRow` gains `verified` / `unverified`; a new
  `GameReportEvidence` type carries `verified / unverified / total / basis /
  requireVerifiedIngest / note`, and `GameReportData` carries `evidence`. A
  comment at the type says an omitted field here is a false claim on screen.
- `splitRow()` is the only place a row is split, and an older payload with no
  provenance fields grades **`verified: 0`** — the honest reading. Verification
  is never inferred from `total`.
- **Collapsed header** now reads `— 60 verified impressions this game · 214
  unverified` (verified in indigo, unverified in amber). The one number an
  operator reads at a glance is the one that is defensible.
- **Expanded card** leads with a two-tile evidence block: *Verified — "Reported
  by a screen that proved its credential. Bill from this."* and *Unverified —
  "Counted, but nothing proves which screen reported it. Not proof of play."*
  followed by the server's own `evidence.note`, rendered rather than
  paraphrased.
- **Table columns** are now `Sponsor · Board · Ribbon · Verified · Unverified`.
  The bare `Total` column is gone as a headline number; the total is stated once,
  in the sentence explaining that the frequency-cap flag grades every reported
  airing.
- **CSV** header is `Sponsor, Board, Ribbon, Verified impressions, Unverified
  impressions, Total reported, Within cap`, plus a `#` footer block giving the
  two totals separately and a plain-English definition of each lane, including
  the sentence "those counts are real, but they are not proof". Formula-injection
  neutralisation (`sanitizeCsvCell`) is untouched; `#` is not a trigger character.
- Copy audit under player-reliability rule 10: *"measured"*, *"the numbers you
  hand a sponsor"* and *"the numbers you show a sponsor at renewal"* (the
  lifetime-estimate card) are all gone. The estimate card now says outright that
  nothing in it is counted or attested.

### (b) The contractual surface requires verified beacons

**This one involved a judgement call — flagging it explicitly for the lead.**

The audit's pass condition says *"Production requires verified beacons for
contractual surfaces."* There are two readings, and they conflict:

- *ingest* — refuse unverified beacons in production. This directly contradicts
  the documented `SPORTS_BEACON_REQUIRE_VERIFIED` default in CLAUDE.md ("an OBS
  browser source or an HDMI-driven board has no device credential and cannot get
  one — refusing those re-creates the gap this feature closed") and would zero a
  venue's reporting.
- *artifact* — the proof-of-play report and CSV, the thing a sponsor is billed
  from, must be composed of verified beacons only.

I implemented the **artifact** reading and did not change the ingest default.
`gameReport().evidence` now declares `basis: 'verified'`, and the panel and the
CSV are built from that lane: the headline number, the "bill from this" tile and
the CSV's proof line are the verified count; unverified is shown beside it,
labelled, never added in. Deliberately **not** gated on `NODE_ENV` — that is the
P1-4 lesson already written into `security/revocation-posture.ts` (a rule wrapped
in a production check is a silent no-op everywhere else). Production is the case
that matters; every other environment now shows the same truth.

`evidence.requireVerifiedIngest` is also returned so an operator can see which
ingest posture produced the numbers.

If the lead reads the pass condition the other way, the ingest change is one
line (default `requireVerifiedBeacons()` to true under `NODE_ENV=production`) —
but it would break the OBS/HDMI lane that CLAUDE.md says must keep reporting, so
I did not make that call unilaterally.

### (c) Redis-outage provenance is downgraded, not claimed

`apps/api/src/sports/beacon-capability.ts`

New `BeaconProvenance` union — `device-verified` / `anonymous` /
`replay-memory-only` / `screen-state-unknown` — on `BeaconAttestation`.
`verified` is now true **only** for `device-verified`.

When `claimBeaconSequence` reports `shared: false` (no Redis, Redis not ready,
or Redis threw mid-flight), a device-bound beacon is still **accepted and
recorded** — losing the count is worse than recording it honestly — but it
grades `replay-memory-only`, i.e. `verified: false`. Under
`SPORTS_BEACON_REQUIRE_VERIFIED` it is refused with `503
BEACON_REPLAY_STATE_UNSHARED` instead.

I chose downgrade-and-record over persist-durably (the pass condition allows
either). Persisting the claim in Postgres during a Redis outage would put a
write on the hot public beacon path exactly when the infrastructure is already
degraded, and it still would not make the *earlier* seconds of the outage
single-use. Downgrading states what is true.

Both downgrade paths log a throttled `[beacon] … DOWNGRADED to unverified` line
(one per game per minute on the impression path, which runs at up to 80/10s),
and the beacon response now returns `provenance` so a support engineer reading a
HAR can see why. Without that, the only visible symptom of a Redis outage is a
verified count silently collapsing to zero, which reads as "the boards stopped
reporting".

### (d) The screen's live status/epoch is re-checked at beacon time

New `apps/api/src/sports/beacon-screen-liveness.ts`.
`resolveBeaconAttestation` takes an optional injected
`screenCheck(screenId, epoch) => 'live' | 'revoked' | 'unknown'`; both beacon
endpoints supply the real one. It runs **before** the replay claim, so a refused
beacon does not consume a sequence number, and only for a device-bound
capability.

- `revoked` — a definite negative: row deleted, `status === 'REVOKED'`,
  **unpaired** (`tenantId === null`), or the credential epoch has moved past the
  capability's. The beacon is refused, `401 BEACON_SCREEN_REVOKED`. Nothing is
  written, not even an unverified row.
- `unknown` — the row could not be read (pool exhausted, Postgres down). Refusing
  would zero a venue's reporting during a database blip, so the beacon is
  recorded and downgraded to `screen-state-unknown`. Under strict mode it is
  refused with `503 BEACON_SCREEN_STATE_UNKNOWN`.

The unpaired case is not cosmetic: unpairing rotates the epoch by exactly one,
so the one-back rotation grace (24 h) would otherwise keep honouring a disowned
screen's capability. Mint refuses unpaired via `allowUnpaired: false`; the
beacon-time check now matches it.

Epoch handling reuses `isEpochAcceptable`, including the rotation grace, so a
screen re-pairing mid-game does not have its beacons refused. I checked all
three `credentialEpoch: { increment: 1 }` sites in `screens.controller.ts` —
pair, unpair, restore-trust. All are deliberate operator actions; the routine
10-minute proactive re-register explicitly does **not** rotate (the code says
rotating a healthy credential would retire the token the device holds right
now). So this check does not fire on the normal renewal cycle.

Cost: one indexed point-read per device-bound beacon, behind the existing 5 s
`loadDeviceCredentialState` cache that every device-authenticated route already
shares.

I read `apps/api/src/security/revocation-posture.ts` before writing any of this,
as instructed, and followed its shape rather than adding a second posture: a
definite negative refuses, an indeterminate one is never allowed to answer
"fine", and nothing is environment-gated.

### SEC-014 — the seed no longer prints the password

`packages/database/prisma/seed.ts` now prints the *source*, never the value:

```
  Admin:   admin@springfield.edu   (password: the SEED_PASSWORD environment variable)
  Teacher: teacher@springfield.edu (password: the SEED_PASSWORD environment variable)
  Existing users keep the password they already have — seed never resets one.
```

(or `the public dev default (see packages/database/prisma/seed.ts)` when
`SEED_PASSWORD` is unset). That preserves the only thing an operator actually
needed from the line — "did my env var take effect?" — without writing the
secret anywhere.

**Rest of the seed/provisioning surface — swept, clean.** I grepped every
`console.*` in `scripts/`, `packages/`, `apps/api/src` and `apps/web/scripts`
for password/secret/token/passcode interpolation, and separately for
`tempPassword` / `initialPassword` / `generatedPassword` / `plainPassword` /
`credentials.csv` patterns. `seed.ts:154-155` was the only real hit.
`seed-multilocation-demo.mjs` hashes a hard-coded demo `admin123` and prints
nothing. `scripts/check-tracked-keystores.cjs` mentions "signing password" only
in guard messages, no values. `provision-kiosk.sh` / `provision-panel.sh` print
no credentials. The RIOT bulk-provisioning script referenced in session memory
is deliberately not in this repo, so I could not review it — **if it prints the
40 location passwords it generates, it has the same defect.**

> **⚠️ For the operator, not for me to decide:** any `SEED_PASSWORD` that has
> already been used against a production database or in CI should be treated as
> **exposed and rotated**. This fix stops future leakage; it cannot retract a
> value already written to a log, and CI logs, Railway deploy logs and terminal
> scrollback all persist. Whether to rotate, and which accounts, is the
> operator's call.

---

## 3. Files touched

| File | Change |
|---|---|
| `apps/api/src/sports/beacon-capability.ts` | `BeaconProvenance`; `verified` derived from provenance; `BeaconScreenCheck` / `BeaconScreenLiveness` types; live re-check + both downgrades in `resolveBeaconAttestation`; strict-mode `503`s |
| `apps/api/src/sports/beacon-screen-liveness.ts` | **new** — the Prisma-backed live screen check (deleted / REVOKED / unpaired / stale epoch ⇒ `revoked`; unreadable ⇒ `unknown`) |
| `apps/api/src/sports/sponsors.controller.ts` | injects `PrismaService`, supplies the screen check, throttled downgrade log, returns `provenance` |
| `apps/api/src/sports/sports-board.controller.ts` | same for the cue beacon |
| `apps/api/src/sports/sponsors.service.ts` | `evidence.basis: 'verified'`, `evidence.requireVerifiedIngest`, rewritten note incl. the new causes and a zero-impressions case |
| `apps/web/src/app/[schoolId]/sports/[gameId]/SponsorPanel.tsx` | provenance in the types, `splitRow`, evidence tiles, split columns, split CSV, copy rewrite |
| `packages/database/prisma/seed.ts` | SEC-014 |
| `CLAUDE.md` | `SPORTS_BEACON_SECRET` / `SPORTS_BEACON_REQUIRE_VERIFIED` rows describe the new semantics |
| `apps/api/src/sports/beacon-capability.spec.ts` | +14 regressions; existing cases carry `provenance` and a live screen row |
| `apps/api/src/sports/sponsor-impression.spec.ts` | `PrismaService` provider for the Nest test module; `provenance` in response assertions |
| `apps/web/.../__tests__/SponsorPanel.test.tsx` | +5 tests covering the split UI, the header, the CSV, and the no-provenance fallback |

---

## 4. Verification

| Check | Result |
|---|---|
| `pnpm --filter api exec tsc --noEmit -p tsconfig.build.json` | clean |
| `pnpm --filter web exec tsc --noEmit` | clean |
| `apps/api` full Jest | **244 suites / 4112 tests pass** |
| `apps/web` full Jest | **222 suites / 3247 tests pass** |
| `apps/api/src/sports/` | 14 suites / 433 tests pass (was 419 — +14) |
| `SponsorPanel.test.tsx` | 8 tests pass (was 3) |
| `pnpm mobile-perf-guard` | clean |
| `packages/database/prisma/seed.ts` standalone tsc | clean |
| `pnpm db:generate` | run before building (the `verified` column types resolve) |

New API regressions, each one asserting a specific claim:

- refuses a beacon whose screen was **REVOKED** after minting (and writes nothing);
- refuses one whose screen **rotated its epoch past** the capability;
- **accepts** the immediately-previous epoch inside the rotation grace window
  (a mid-game re-pair must not become a self-inflicted reporting outage);
- refuses one whose screen was **UNPAIRED** mid-capability;
- refuses one whose screen **row was deleted**;
- **downgrades** (does not refuse, does not claim) when the screen row cannot be read;
- **downgrades** when replay could only be claimed in process memory;
- the same capability grades `device-verified` once shared replay state exists —
  proving the downgrade is about the store, not the capability;
- a Redis that **throws mid-flight** downgrades rather than claiming verified;
- strict mode refuses both downgrade situations with `503` and writes nothing;
- a downgraded beacon is counted `unverified` by `gameReport`, with `basis: 'verified'`;
- the **cue** endpoint runs the same live re-check;
- a caller that injects **no** screen check keeps the pre-re-audit behaviour —
  a wiring gap can never *upgrade* a beacon's grade;
- an anonymous capability never reaches the screen checker.

New web tests: the two lanes render as separate labelled figures; the collapsed
header leads with verified; the old "measured" / "the numbers you hand a sponsor"
strings are asserted **absent**; the CSV carries both columns, the per-row split
and the two footer totals; and a report with no provenance fields grades
entirely unverified.

### What I did not verify

- **No browser run.** I did not load the panel in Playwright or against a
  deployed build. The evidence I have is jsdom rendering plus tsc. The layout of
  the two-tile evidence block and the five-column row at real widths is
  **unverified on glass** — the row is now `flex-1 name + 10 + 10 + 14 + 14 + 5`
  which is wider than the old `flex-1 + 12 + 12 + 12 + 5`, and this panel sits in
  the sports game view which the operator uses from a phone. Worth one look
  before merge.
- **No live API run.** The beacon endpoints were exercised through their real
  controllers with Prisma test doubles, not against Postgres/Redis.
- **No CI run** (not pushed, per instructions).
- I did not touch `apps/web/src/lib/sports-beacon.ts` (the client). See the open
  item below.

---

## 5. Open items / residual risk — stated plainly

1. **The beacon client does not react to a `401 BEACON_SCREEN_REVOKED`.**
   `sports-beacon.ts` mints one capability per game and renews at 25 minutes.
   If a screen is revoked or unpaired mid-lease, every subsequent beacon 401s
   until the lease renews — those impressions are lost rather than recorded as
   unverified. For a genuinely revoked screen that is arguably correct (it
   should not be reporting). For an unpair-then-re-pair it costs up to ~25
   minutes of counts. A one-line fix (drop the lease on a 401 so the next beacon
   re-mints) would close it; I left the client alone because the audit scoped
   this finding to the server and the report, and changing the client's
   do-no-harm path deserves its own review.
2. **Cross-tenant re-pair inside the rotation grace.** A screen re-paired to a
   *different* tenant bumps its epoch by one, so the old capability stays inside
   the one-back grace for up to 24 h and could still attest for the original
   tenant's game. Impact is narrow — `recordImpression` still enforces
   `sponsor.tenant === game.tenant`, and the capability is bound to that one
   game, so no count crosses tenants; only the *attributed screen id* on those
   rows would name a screen that has since moved. Closing it properly needs the
   game's tenantId at beacon time, which is an extra read on a hot public path.
   Documented rather than silently fixed.
3. **`capCompliant` still grades on every reported airing**, verified or not.
   That is deliberate — "did this logo run more often than the contract allows"
   is a question about airings, not about evidence — and the panel now says so
   in one sentence. Flagging it because a reviewer could reasonably want the cap
   to grade the verified lane instead.
4. **The lifetime-estimate card** (`SponsorReport`) is arithmetic from rotation
   weight; it counts nothing. I retitled its copy so it cannot be read as proof,
   but it is a different surface from the per-game report and I did not
   restructure it.
5. **`/[schoolId]/sports/sponsors/page.tsx`** shows only "est. spots" / "est.
   exposure" from the same estimate endpoint. Already labelled as estimates; no
   beacon counts are presented there, so it needed no change. Checked, not
   changed.
6. **`SPORTS_BEACON_SECRET` must be set** for the verified lane to exist at all.
   Nothing here changes that, and a deploy without it will show every impression
   as unverified — which is now *visible* in the UI rather than hidden behind a
   single "measured" total. That is the intended outcome, but it will look like
   a regression to anyone who does not know why.
