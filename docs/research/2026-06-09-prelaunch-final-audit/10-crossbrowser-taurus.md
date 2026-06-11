# §15 Cross-browser + Chromium-83 — Pre-launch Final Audit

**Auditor:** frontier-model deep pass · **Date:** 2026-06-10 · **Scope:** Standard Audit Surface §15 (all 6 bullets)
**Method:** traced every documented safeguard to its real callers; re-ran CLAUDE.md rule-#10 greps; spec-parsed all 190 board HTML files (492 inline scripts) with acorn (`ecmaVersion: latest` = WebKit-fatal class, `ecmaVersion: 2020` = Chromium-83 syntax floor); curled the live deploy; traced taurus baseline git history.

## Coverage table (§15 bullets)

| Bullet | Coverage | Verdict |
|---|---|---|
| Safari (WebKit) — every customer-facing surface | **covered** | CI canaries real + wired; breadth gap = F1 |
| Chromium 83 — every player-shipped surface | **covered** | Gate + greps clean; frozen debt = F4 |
| Tailwind class sweep (gap/inset/backdrop/has/oklch/color-mix/aspect-ratio/text-wrap/container) | **covered** | Re-swept incl. NEW logical-property class (`inset-inline/block`: zero hits) |
| Cross-browser CI baseline ratchet (only DOWN, never UP) | **covered** | Mechanism gap + one historical UP-bump = F2 |
| Per-template WebKit smoke (not just 18 holiday) | **covered (as gap)** | React widgets yes; boards no; holiday list froze at 18/49 = F1 |
| Older Android System WebView for kiosk APKs | **deferred** | No WebView-version emulation in CI; static patterns gated (backdropFilter <88 noted in gate); hardware verify outstanding |

**Grades:** DESIGN **A-** (gate architecture is genuinely sophisticated: comment-stripping scanner, HTML-board scan, runtime inset polyfill) · UX **B** (dev-facing; failure messages carry fix instructions; rebaseline path is one command — which is also the weakness) · FUNCTIONALITY **B+** (every safeguard traced to a real caller and verified working; breadth + ratchet gaps below).

---

## Verified SOLID (traced to real callers / live surfaces)

1. **taurus-safety workflow runs the right script.** `.github/workflows/taurus-safety.yml:27` → `node apps/web/tools/check-taurus-safety.cjs` on push+PR. SCAN_DIRS covers widgets, app/player, components/player, **app/board, app/ribbon, app/scorebug** (script lines 28-36). 12 pattern classes including `insetTw` arbitrary-value form (line 111, the P0-8 class).
2. **cf5772ae HTML-board scan is real and correct.** `HTML_SCAN_DIRS = public/templates + public/holiday-templates` (script lines 50-53), inset-only by documented design (boards target LCD; rule-#10 SCOPE), with a dedicated HTML-comment stripper (lines 142-144) that avoids the `//`-to-EOL false-negative on `https://` URLs. Local run: green, 171 files, gap=1196 cq=1037. Baseline contains **zero** `public/templates` entries → any inset re-entering ANY board fails CI (allowed=0 for unlisted files).
3. **Board inset sweep is deployed.** `curl https://venue-os.app/templates/hs/ath-gameday.html` → 24 KB, carries `EDUCMS-SHIM-V6` + `educms-field-click`, **zero `inset:`**. Repo-wide: `grep -rE '\binset:' public/templates public/holiday-templates` → 0 hits.
4. **Rule-#10 grep re-run over widgets/player/board/ribbon/scorebug: clean.** Every remaining `inset` occurrence is one of: (a) the documented shorthand+longhand **paired** pattern (`KioskSplash.tsx:1055,1125,1134,1159,1272` — `inset: 0; top: 0; right: 0; bottom: 0; left: 0;` on one line; `player/page.tsx:7678` — `inset: 0, top: 0, left: 0, right: 0, bottom: 0` object literal, longhand keys written after shorthand so CSSOM order favors longhand); (b) the **Chromium-83 inset POLYFILL** in `player/layout.tsx:199-215` — `[style*="inset: 0"], [style*="inset:0"] { top/right/bottom/left: 0 !important }` force-applies longhand to any themed widget that inlines `inset:0` (verified a fix, not a violation — this is why the 17 `insetCss` baseline counts are safe); (c) comments.
5. **Class-sweep extension: CSS logical properties.** `inset-inline:`/`inset-block:` (also Chromium 87+, NOT matched by the gate's `insetCss` regex) — swept all player paths + all boards: **zero hits**. No regression vector today (see F5 for the gate blind spot).
6. **EmergencyOverlay Taurus-safe (P0-5 held).** The player route mounts `components/player/EmergencyOverlay` (`app/player/page.tsx:15`) — **0** forbidden-pattern hits. The 7-hit `components/layout/EmergencyOverlay.tsx` is mounted only by `DashboardLayout.tsx:13` (LCD dashboard — exempt per rule-#10 SCOPE). No cross-wiring.
7. **The 2026-05-09 WebKit-fatal class (literal LF in regex / minified-JS SyntaxError) is dead today.** Spec-compliant acorn parse of **190 HTML files / 492 inline scripts** across `templates/{hs,signage(+qsr/menus-pos/bar),fitness,school,kiosk}` + all 50 `holiday-templates` + `kiosk/_edit-shim.js` + `holiday-templates/_style-bridge.js` + `_hs-audit.html`: **0 failures at `ecmaVersion: latest`** (WebKit strictness) and **0 at `ecmaVersion: 2020`** (no post-ES2020 syntax — e.g. `||=` is Chrome 85+ — can reach a Taurus kiosk board).
8. **Shim census — redesign invariant holds.** CLAUDE.md sweep: **0 boards missing click-to-edit** across hs/signage/fitness/school/kiosk. Versions: 31 × SHIM-V5, 90 × SHIM-V6, 19/19 kiosks reference `_edit-shim.js`. No V4/V3 stragglers (the "none of the templates can be edited" trap).
9. **CI wiring verified end-to-end.** `cross-browser.yml` job 1: `test:cross-browser` → `tests/cross-browser/holiday-bridge.cjs`, + `test:celebrations` (auto-discovers via `readdirSync`, NAV_PAGES excluded), + `test:kiosk-shim` (entity-decode + XSS canary on kiosk shim). Job 2 `webkit-widget-render`: `test:e2e:widget-render` in **chromium+webkit matrix** on the real `/player` route (P1-12 closure held). `prod-smoke.yml` `webkit-nav` job (line 97) runs `test:webkit-nav` → `webkit-nav-smoke.cjs` on push-to-master + daily 06:00 UTC cron + dispatch — the favicon-crash/removeChild canary against the live deploy.
10. **New-class check, player React paths:** `aspectRatio=0, oklch=0, textWrapBalance=0` current (165a6335 §15 fix held). `colorMix`/`hasSelector` exist only as phantom baseline — the named files scan to zero today (`FitnessStickLauncherWidget` replaced `color-mix()` with an author-time `mixHex` blend, 769400b2; comments document it).

---

## Findings

### F1 — P1 — KNOWN-OPEN (refined with NEW evidence): WebKit canary breadth froze while the catalog tripled
Prior audit P1-9 said "EXTERNAL_HTML boards have no per-board WebKit canary" — **still open**, and worse than reported:
- `holiday-bridge.cjs:45-49` **hardcodes 18 template names**; `public/holiday-templates/` now has **49 customer boards** (every `-v2` ×18, `-portrait` ×10, `-flagship` ×3 are unguarded). The workflow's "18 × 5 = 90" comment is the frozen number from before the v2/portrait/flagship waves. These carry the same inline-bridge JS pattern that was Safari-fatal for 2 months in 2026-05.
- `kiosk-edit-shim.cjs:78` tests **1 of 19 kiosks** (`food.html` only) — fine for the shared `_edit-shim.js`, but per-board inline engine scripts are unguarded.
- `external-html-clickedit.spec.ts` + `holiday-hotzone.spec.ts` (the chromium+webkit board tests CLAUDE.md mandates after every shim re-injection) appear in **NO workflow** — grep of `.github/workflows/` confirms. ~140 baked V5/V6 shims have zero CI WebKit guard; enforcement is "remember to run it locally."
**Fix:** (1) derive `TEMPLATES` from `readdirSync` exactly like `celebrations-bridge.cjs` does (boards lacking the bridge protocol get parse+paint assertions only); (2) add a cheap **parse-only canary step** to taurus-safety or cross-browser CI — the acorn sweep used in this audit (spec + ES2020 parse of all inline scripts) runs in ~2s with no browser and kills the whole LF-in-regex class at the gate; (3) wire `external-html-clickedit.spec.ts` into cross-browser.yml.

### F2 — P2 — NEW: the "DOWN-only" baseline ratchet is convention, not mechanism — and has already gone UP once
- **Check mode never flags `current < baseline`**, so phantom headroom persists indefinitely. Verified live: `monetize-music-tiles.tsx` baseline grants `insetTw:1` but scans **0** today (the count is a JSDoc backtick artifact from a pre-hardening scan); `FitnessStickLauncherWidget.tsx` grants `colorMix:2` (real code removed 769400b2); `RetailWidgets.tsx` grants `hasSelector:1`; plus ~3 `gap` / ~4 `cqUnits` repo-wide (1199/1041 baseline vs 1196/1037 current). Concretely: someone can add a REAL Tailwind `inset-0` to `monetize-music-tiles.tsx` — a tile registered in `variants-register.ts:108` and player-rendered — and CI passes. That is the exact class that shipped the P0-8 live Taurus regression.
- **No CI guard that a baseline diff only decreases.** The workflow runs check mode against whatever baseline is committed; a PR that bumps baseline + adds violations merges green (control is "must be reviewed in the PR"). History shows the policy already bent: `3f3df641` (2026-05-26) "**rebaseline KioskSplash gap floor 14 → 21**" — an in-band UP-ratchet (transparent, but mechanical enforcement would have forced the conversation; KioskSplash rewrite is still pending, task #129).
**Fix:** (a) in check mode, when `current < baseline` print and **auto-rewrite** (or fail with "ratchet down") so headroom can't linger; (b) add a CI step: `git diff origin/master -- taurus-safety-baseline.json` and fail if any count increased without a `taurus-rebaseline-approved` label.

### F3 — P2 — KNOWN-OPEN (verified still open): school/holiday boards' `color-mix()` has zero fallback
Full-audit P1-6's second half (solid-color fallback before each `color-mix()` in the 9 school boards) was NOT part of cf5772ae — the HTML gate is inset-only by documented design. Verified: 7+ `templates/school/*.html` use `color-mix()`, **0** have `@supports`; 39 holiday boards likewise (known P2-2). Chromium 83/87 drops the whole declaration. Degraded-not-fatal, and boards primarily target LCD — but nothing stops an operator scheduling a school board on a Taurus wall.

### F4 — P2 — KNOWN-OPEN (verified, quantified): frozen Chromium-83 debt in player-shipped React paths
Baseline totals: `gap=1199` (+93 Tailwind), `cqUnits=1041`, `backdropFilter=31` (+9 Tailwind). Notably **the player shell itself**: `app/player/page.tsx` carries `gapTw=54` + 6 `backdrop-blur`, and `KioskSplash.tsx` (the Taurus 320×1080 surface with a 3-incident history) has 21 `gap:` against 10 `display: flex` blocks — task #129 (Taurus-safe KioskSplash rewrite) still pending. Gate blocks NEW additions only; existing render degraded (missing spacing / transparent panels) on real Chromium-83 hardware. No hardware/emulated-83 verification exists in CI.

### F5 — P3 — NEW: gate blind spots worth one line each
(a) `insetCss` regex misses the logical longhands `inset-inline:` / `inset-block:` (also Chromium 87+; Tailwind `inset-x/y-*` IS caught but the raw CSS properties are not — zero current usage, cheap to add to PATTERNS). (b) The HTML scan's `HTML_FILE_RE` excludes `.js`, so `kiosk/_edit-shim.js` itself is outside the inset gate (currently clean). (c) `_thumbs/` HTML + `_hs-audit.html` are dashboard-only surfaces — parsed clean, no action.

---

## Dedup notes
- Already fixed + verified here (in *solid*): cf5772ae board-inset sweep + taurus HTML scan; P0-8 `insetTw` pattern; P0-5 EmergencyOverlay strip; P1-12 React-widget WebKit smoke; 165a6335 aspect-ratio/oklch/text-wrap React sweep; webkit-nav job.
- Re-verified still open (titled KNOWN-OPEN above): full-audit P1-9 (board canary, now with 18/49 holiday-drift evidence), P1-6 second half (school color-mix fallback), P2-1 (frozen gap/cq debt incl. KioskSplash #129), P2-2 (39 holiday color-mix).

## Repro commands
```bash
node apps/web/tools/check-taurus-safety.cjs                  # green, 171 files
grep -rE '\binset:' apps/web/public/templates apps/web/public/holiday-templates   # 0
grep -rnE 'inset-(inline|block)\s*:' apps/web/src/components/widgets apps/web/src/app/player apps/web/src/components/player apps/web/src/app/{board,ribbon,scorebug}  # 0
# acorn spec+ES2020 parse of all 190 boards/492 scripts — method in this audit (scratch script, removed after run)
curl -s https://venue-os.app/templates/hs/ath-gameday.html | grep -cE 'EDUCMS-SHIM-V6|educms-field-click'  # present; inset: 0 hits
```
