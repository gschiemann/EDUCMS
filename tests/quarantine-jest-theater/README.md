# Quarantined: Jest/Supertest theater tests

Moved out of `tests/e2e/` on 2026-07-13 (audit W0-06, 2026-07-12 world-class
audit — Part II.A finding #3).

## Why these are quarantined

These five files are **not runnable tests in any collector this repo has**:

- They use Jest globals (`describe`/`it`/`expect`) and Supertest, but they sat
  inside the **Playwright** `testDir`. Playwright has no `describe` global, so
  collection died with `ReferenceError: describe is not defined` and the root
  E2E gate reported **`Total: 0 tests in 0 files`** — green CI proved nothing.
- They authenticate with literal mock strings (`Bearer MOCK_ADMIN`,
  `MOCK_SUPER_ADMIN_TOKEN`, `MOCK_DEVICE`) that no API build has ever
  accepted, and hit endpoints (`/api/v1/device/sync`) and response shapes
  (`STANDARD_PLAYBACK`) that do not exist in the API.
- No Jest project is configured at the repo root either — even under Jest
  they would fail on the first request.

They are kept only as scenario notes (they reference `CHAOS_TEST_PLAN.md` /
`E2E_SCENARIOS.md`). **Do not move them back into `tests/e2e/`.** If a
scenario here is worth covering, write a real Playwright spec against seeded
fixtures instead (see REL-002 in the audit brief).

The Playwright config now also enforces `testMatch: '**/*.spec.ts'`, so a
stray `*.test.ts` can never poison collection again.
