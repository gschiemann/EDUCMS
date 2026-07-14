# Wave-0 Execution Status — 2026-07-13/14

Progress log for the Wave-0 (0–3 day "containment and truth") items from
`VENUEOS-WORLD-CLASS-AI-DEVELOPER-BRIEF.md`. Updated as items land on `master`.
Constraint for this session: **no paid AI/provider calls** (Greg: "we not
spending money"), so every "canary" step is code + docs verification, never a
live billed call.

## Landed on master

| Item | Commit(s) | Status | Notes |
|---|---|---|---|
| **W0-03** replace dead AI models | `6cb4230f` | ✅ COMPLETE (code) | See below. Live provider canaries deferred (paid). |
| **W0-05** real lint/a11y gate | `ea42326e` | ✅ COMPLETE | Config crash now fails CI; honest baselines. |
| **W0-06** repair E2E gate | `ea42326e`, `14d51f2b`, `9abc3de6`, (+fix pending) | ✅ COMPLETE (gate real) | Collection floor + ephemeral-pg job + workspace build. Full seeded life-safety journey = REL-002 (Wave 1). |
| **W0-02** contain raw AI Designer HTML | (pending commit) | ✅ COMPLETE (code) | Feature kept alive; scripts stripped + CSP + source-bound actions + kill switch. |

## Still OPEN (not started this session)

- **W0-01** sports signing-secret rotation — PARTIAL from the audit (literal
  removed, `58363762`); rotation/revocation/`DEVICE_SECRET_KEY` blast-radius
  migration need Railway/prod access + a security decision. Greg-gated.
- **W0-04** USB export/ingest — divergent API↔Android bundle contract + no
  operator PIN. Needs the JSON-Schema-shared-contract decision.
- **W0-07 / PLAN-001A** product-truth correction — needs Greg's pricing/trial/
  seat decision first (which numbers are real).
- **W0-08** quarantine unapproved/licensing-risk templates — needs the
  interim allowlist + design-system sign-off.
- **W0-09** contain unbounded AI fan-out spend — atomic USD-reservation model;
  large, and interacts with the AI-003A ledger design (Wave 2).

## W0-03 detail (dead AI models)

Three shipped model ids were ALREADY shut down by their providers — every call
was a customer-facing 404, and green CI never noticed:

- `claude-3-5-haiku-20241022` — RETIRED 2026-02-19, and it was the Anthropic
  catalog DEFAULT + pinned twice in the alt-text vision path → **the entire
  Standard-tier Anthropic leg was dead**. → `claude-haiku-4-5`.
- `gemini-2.0-flash` — SHUT DOWN 2026-06-01 (catalog Balanced) → `gemini-3.5-flash`.
- `imagen-3.0-generate-002` — SHUT DOWN 2025-11-10; the Google image path had
  been dead ~8 months → `imagen-4.0-generate-001` (same `:predict` shape).

Plus: `claude-opus-4-1` (retires 2026-08-05) → `claude-opus-4-6` (a price drop);
`claude-sonnet-4-5` → `claude-sonnet-4-6`; OpenAI image chain `gpt-image-1`/
`dall-e-3` → `gpt-image-2` primary + `gpt-image-1` access fallback; Gemini
catalog **prices corrected** against the live pricing page.

New safety nets:
- `healLegacyModelId()` in `ai-providers.ts` — a tenant with a SAVED retired id
  is healed to the successor at resolution time (both `resolveProviderKey`
  sites), so a provider retirement can never again strand saved settings on a
  permanent 404.
- `apps/api/tools/check-model-retirements.cjs` (wired into CI `build-and-test`)
  — fails CI when a shipped model is past its provider shutdown date, warns 60
  days out. **Already warning:** `imagen-4.0-generate-001` dies 2026-08-17 and
  its successor `gemini-3.1-flash-image` uses a DIFFERENT API shape
  (generateContent, not `:predict`) — that one is a real code change, tracked.

Verified: 10 AI suites / 292 tests green; full API suite 111 suites / 1565
green; clean tsc api+web.

## W0-05 detail (lint/a11y gate)

Root cause of the false-green: the jsx-a11y rules object had no `files` scope,
so it applied to `.cjs` scripts where `eslint-config-next` never registers the
plugin → ESLint exit 2 (config crash); `|| true` + a grep over the crash text
printed success. Fixes:
- rules object scoped to `**/*.{js,jsx,mjs,ts,tsx,mts,cts}` (matches the plugin
  registration) → lint runs clean.
- CI step: `set -o pipefail`; exit ≥2 (crash) fails before counting; exit 1
  without a problem summary fails; baseline **ratchets down only**.
- Honest baselines: `.a11y-baseline` 99→**221** (the real count once lint
  actually ran — it had grown unchecked while the gate was dead);
  new `.hooks-baseline`=**10** for `react-hooks/rules-of-hooks`.
- 14 conditional-hook violations had shipped while the gate was dead. Fixed 4
  (deleted the dead `_StatField` sports-console component; hoisted a
  `useParams` called inside post-early-return JSX in emergency settings). The
  10 survivors are `WidgetRenderer.tsx` per-widget-case hooks — stable per
  mount but real #310 landmines; extracting those cases is a tracked refactor.

## W0-06 detail (E2E gate)

The gate was doubly dead: 5 Jest/Supertest theater files (mock tokens,
nonexistent endpoints) poisoned Playwright collection → `Total: 0 tests`, AND
the job ran PR-only while the repo ships by direct push, so it **never ran**.
Fixes:
- theater files quarantined to `tests/quarantine-jest-theater/` (+README);
  `playwright.config` enforces `testMatch '**/*.spec.ts'`.
- job runs on **push + PR** against an **ephemeral postgres** service (`db:push`)
  — no test can touch prod data.
- **collection floor**: `playwright test --list` must discover ≥30 tests or the
  job fails — a zero-test collection can never be green again.
- webServer timeout 120s→300s + piped server logs; e2e job now builds the
  `@cms/*` workspace packages before booting (the API dev server imports them by
  package name — the round-2 boot failure).
- fixed the specs that had never actually run: the `networkidle` trap (never
  settles behind background fetches) + strict-`pageerror` on pages that
  legitimately 401 unpaired (`login`, `player-manifest`), and the
  `__pairFromQrData` mount race (`mobile-pair-qr`).

**Scope boundary:** this closes the FALSE-GREEN (the gate is now real — it
caught 2 broken specs that were previously invisible). The full **seeded
life-safety journey** (login → pair → publish → emergency trigger → player
receipt → all-clear, blocking) is **REL-002, a Wave-1 item** — it needs seeded
tenant/admin/device fixtures, which is a larger build.

## W0-02 detail (AI Designer HTML containment)

The flagship AI Designer is **kept fully alive** — this is containment, not
removal. The P0 was: model-authored (or prompt-injected) JS ran in
`sandbox="allow-scripts"` iframes and the player executed any `educms-action`
message from any window carrying its own action object → a generated board
could drive real player actions (URL overlays, navigation, webhooks) with zero
taps.

Closed on three fronts:

1. **Scripts never survive.** `sanitizeDesignerHtml` (API, at the source) now
   strips EVERY `<script>` (inline included), `on*` handler attr, `javascript:`
   URL, meta-refresh, `<base>`, and nested frame. The jobs those scripts did
   (stage self-scale, column auto-fit) move to TRUSTED platform runtimes: the
   baked `EDUCMS-SHIM-V6` + `VOS-FIT-ENGINE` at persist, and a new
   `VOS-STAGE-SCALE` injected at render.
2. **Render-side wrapper + CSP** (`apps/web/src/lib/designer-safe-srcdoc.ts`) —
   every srcdoc render (player, candidate picker, full-screen preview) passes
   through: strips again (contains LEGACY persisted boards), injects a strict
   per-render **nonce CSP** (`default-src 'none'`; no fetch/XHR/forms/frames;
   scripts by nonce only; fonts.googleapis + https images only), and nonce-tags
   only the trusted runtimes. A script that slipped both strips still cannot
   execute.
3. **Action channel bound** (`kiosk-frame-registry.ts` + player handler) —
   `educms-action` is accepted ONLY from a board iframe WE mounted (`event.source`
   check) and the tapped `key` is resolved against the OPERATOR-SAVED action
   map; the message's own `action` object is **ignored**. Lossless — the shim
   only fires for keys already in that map.

Plus an operational **kill switch**: `AI_DESIGNER_DISABLED=1` blocks new
Designer generation / refine / publish (all 3 gated) without a deploy; existing
boards keep rendering through the render-side sanitizer + CSP.

The Designer prompt + exemplar were updated to stop teaching the model to write
scripts (it now emits a `data-fit-col` attribute + a first-child stage; the
platform runtime does all scaling). Adversarial-corpus + all-scripts-stripped
tests added.

Verified: full API suite 111 suites / 1565 green; clean tsc api+web; a
bundled behavioral run of the sanitizer against a malicious corpus (action
script, on* handlers, svg onload, javascript:, meta-refresh, nested iframe) —
all stripped, trusted runtimes survive with nonce, CSP present.
