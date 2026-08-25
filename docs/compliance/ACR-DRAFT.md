# Accessibility Conformance Report — WCAG Edition

## ⚠️ DRAFT — NOT FOR ISSUANCE TO CUSTOMERS OR PROCUREMENT OFFICES ⚠️

**This document is a working draft.** It was assembled by an AI coding agent
from three evidence sources: (1) the repository's own automated accessibility
gates and their committed results, (2) direct reading of the application
source code, and (3) `git log`/commit-message evidence for changes that
already shipped. **No human has run a screen reader against this product for
this report.** No live user testing, no assistive-technology (AT) session, no
disability-community review has occurred. Every conformance level below is a
**code-review judgment**, not a verified end-user outcome. See
[**"Criteria requiring a human AT pass before issuance"**](#8-criteria-requiring-a-human-at-pass-before-issuance)
for the specific list of what must still happen before this can go to a
district's procurement office as a real ACR/VPAT response.

Where the evidence did not support a confident rating, the level is marked
**Not Evaluated** rather than guessed. **Not Evaluated is not a pass** — it
means "a human needs to look at this," and every such row must be resolved to
one of the four standard conformance levels before issuance (see
[Terms](#4-terms-used-in-this-report)).

---

## Document status

| | |
|---|---|
| **Status** | DRAFT — evidence-based, not yet human-verified |
| **Report date** | 2026-08-25 |
| **Prepared by** | Automated tooling + AI code-review pass (Claude, on behalf of VenueOS engineering). No named human evaluator yet — see [docs/compliance/README.md](./README.md). |
| **Based on template structure** | VPAT® 2.5 – WCAG Edition (structure only; this is not the ITI-published template document) |
| **Standard evaluated** | WCAG 2.1, Level A and Level AA (50 success criteria) |
| **Why WCAG 2.1 A/AA specifically** | This is the technical standard the DOJ's Title II rule (28 CFR §35.200/§35.201) designates for state/local government web content and mobile apps. **Deadline update, verified via web search 2026-08-25 (this was NOT known at task assignment and corrects the "already passed" framing this task started with):** the rule's *original* compliance dates — April 24, 2026 for public entities with population ≥50,000, April 26, 2027 for smaller entities and special district governments — were each extended by one year via a DOJ Interim Final Rule signed April 16, 2026 and published in the Federal Register April 20, 2026 (revising 28 CFR §35.200(b)). **Current dates: April 26, 2027 for ≥50,000-population districts; April 26, 2028 for smaller districts and special districts.** Neither deadline has passed as of this report's date. This does not reduce the value of having a real ACR ready — districts already ask for one today, on their own timeline, independent of the federal floor — but a customer-facing version of this document must state the *current* deadline, not the superseded one. Source: [Federal Register, "Extension of Compliance Dates…"](https://www.federalregister.gov/documents/2026/04/20/2026-07663/extension-of-compliance-dates-for-nondiscrimination-on-the-basis-of-disability-accessibility-of-web), verified 2026-08-25. |

---

## 1. Product information

| Field | Value |
|---|---|
| **Product name** | VenueOS |
| **Product description** | Multi-tenant signage, digital-display, and life-safety emergency-alert CMS. Two evaluated surfaces: (a) the **web dashboard** (`apps/web`) — the authenticated Next.js application district/school staff log into to manage screens, playlists, templates, and trigger/clear emergency alerts, plus its public marketing, login, and mobile emergency-trigger (`/panic`) pages; (b) the **player** (`apps/web/src/app/player`, plus the native Android player app) — the unattended kiosk/LED-wall display surface that renders published content to bystanders. See [§3 Scope](#3-scope-and-applicability-notes) for how each is evaluated. |
| **Product version evaluated** | Git ref `3329a1e4` (`git describe`: `player-v1.1.4-22-g3329a1e4`), branch `master`, dated 2026-08-24. Web app `package.json` version `0.1.0`; API `package.json` version `0.0.1`; native player release tag `v1.1.4`. |
| **Report date** | 2026-08-25 |
| **Contact for accessibility feedback** | *[VENDOR TO FILL IN — no public accessibility-feedback address exists in the product today. Grepped `apps/web/src`, `apps/api/src`, and the public site for an "accessibility@" contact or a published accessibility-statement page; found none.]* |

---

## 2. Evaluation methods used

This is a **code-review + automated-tooling** evaluation, not a manual
assistive-technology audit. Specifically:

1. **Automated browser testing (Playwright + axe-core).** `apps/web/scripts/a11y-audit.ts`
   boots a headless Chromium, authenticates as the seeded SUPER_ADMIN, and runs
   `@axe-core/playwright` (tags `wcag2a wcag2aa wcag21a wcag21aa`) against 10
   authenticated + public routes: `/login`, `/dashboard`, `/screens`,
   `/{tenant}/templates`, `/{tenant}/templates/builder/{id}`, `/player`,
   `/panic`, `/{tenant}/emergency/broadcast`, `/{tenant}/reviews`,
   `/onboarding/branding`, `/{tenant}/screens?view=map`. This runs in CI
   (`.github/workflows/a11y.yml`) on every pull request and nightly against
   master, with a **down-only ratchet** against a committed baseline
   (`apps/web/scripts/a11y-warning-baseline.json`): currently 10 known
   error-level violations and 2 known warnings, each individually itemized
   with file/line and a stated reason it wasn't fixed in the wave that
   created the baseline. `DISABLED_RULES` (rules the harness is told to
   ignore) is currently **empty** — no axe rule is being silenced.
2. **Static analysis (ESLint `jsx-a11y`).** 25 `jsx-a11y` rules run as
   `"error"` on every `.tsx`/`.jsx`/`.ts`/`.js` file
   (`apps/web/eslint.config.mjs`), enforced in CI
   (`.github/workflows/ci.yml`, job `accessibility`) against a committed,
   down-only-ratcheted baseline count (`.a11y-baseline` = **93**, down from
   189 as of the 2026-08-24 burndown — see commit `511c5fd2`). New
   violations fail the build; the existing 93 do not, and are not itemized
   by rule anywhere in the repo (see [§7.2](#72-known-gaps-honestly-stated)).
3. **A dev-only runtime overlay** (`@axe-core/react`, wired in
   `apps/web/src/app/layout.tsx`, gated to `NODE_ENV === 'development'`) logs
   violations to the browser console while developing. Not part of any CI
   gate; developer-visibility only.
4. **Direct source-code reading** by the report author for specific,
   named implementation claims (focus traps, live regions, keyboard
   handlers, contrast math, i18n wiring, etc.) — every such claim below cites
   the file(s) read. This is the bulk of the evidence in this report.
5. **Git history** (`git log`, specific commit messages) as evidence for
   *when* and *why* a fix landed, used only to corroborate what the current
   code on disk shows — never as a substitute for reading the code itself.

**Explicitly NOT done for this report:** a screen reader (NVDA, JAWS, or
VoiceOver) was not run against any page. No keyboard-only user walked
through any flow end-to-end. No user with a disability reviewed the product.
Lighthouse's accessibility category runs in CI
(`.github/workflows/lighthouse.yml`) but with `continue-on-error: true` —
its score is informational and does not gate merges.

---

## 3. Scope and applicability notes

VenueOS ships two very different experiences, and several success criteria
apply differently to each:

- **The web dashboard** is an ordinary authenticated web application —
  forms, tables, dialogs, drag-and-drop, keyboard shortcuts. The full WCAG
  2.1 A/AA table applies to it in the normal way, and it's where the large
  majority of the evidence in this report was gathered.
- **The player / kiosk / LED-wall surface** (`/player`, and the equivalent
  native Android player) is a **passive output display**. Once content is
  published, nobody "operates" the player screen — it's viewed by
  bystanders, the same way a television or a physical bulletin board is.
  For success criteria about *operating* content (keyboard access, focus
  order, input modalities, forms), the playback loop itself is marked
  **Not Applicable** for the same reason a digital billboard's ACR would
  mark them N/A — there is no operable interface for a viewer to use. The
  player's own limited interactive chrome (the pairing/splash screen, an
  on-device settings gear) is evaluated separately where relevant. For
  criteria about *perceiving* displayed content — contrast, seizure-safety
  (flashing), motion, audio control, captions — the player **is** in scope,
  because a bystander with a disability does view and hear it.
- **Operator-authored / operator-uploaded content** (a video file a school
  uploads to a playlist, custom text typed into a template, a PDF imported
  as a playlist) is the tenant's content, not VenueOS's. Consistent with how
  a CMS, DAM, or authoring-tool vendor's ACR is normally scoped, this report
  evaluates VenueOS's own chrome, editing tools, and default/system
  templates — not the accessibility of what a customer chooses to upload.
  Where VenueOS is missing a *tool* that would help operators author more
  accessible content (e.g., no built-in captioning workflow for uploaded
  video), that's noted as a product gap, not scored as a WCAG failure of
  VenueOS's own interface.
- **Third-party embedded content** (an embedded YouTube Live stream, an
  Atmosphere TV feed, a Stripe-hosted checkout page) is the third party's
  responsibility. Stripe Checkout/Customer Portal specifically are
  Stripe-hosted pages VenueOS never renders directly (PCI-SAQ-A per
  `CLAUDE.md`) — not independently evaluated here.

---

## 4. Terms used in this report

| Term | Meaning |
|---|---|
| **Supports** | Verified evidence (code + at least one automated or manual check) that the product meets the criterion, with no known exceptions found. |
| **Partially Supports** | Some parts of the product meet the criterion and specific, named parts do not — the remark states exactly which. |
| **Does Not Support** | Verified evidence that the majority of relevant product surfaces fail the criterion, or a single-surface criterion (e.g. a specific control) fails outright. |
| **Not Applicable** | The criterion's subject matter (e.g. prerecorded audio-only media) does not exist as vendor-authored content in this product. |
| **Not Evaluated** *(non-standard — draft-only)* | The report author found no reliable evidence either way. **This is not a conformance level** and must not appear in a final, issued ACR — every row must resolve to one of the four levels above before this document is sent to a customer. |

---

## 5. Summary of conformance levels (this draft)

| Level | Table 1 (A) | Table 2 (AA) | Total | % of 50 |
|---|---|---|---|---|
| Supports | 7 | 3 | 10 | 20% |
| Partially Supports | 13 | 9 | 22 | 44% |
| Does Not Support | 0 | 0 | 0 | 0% |
| Not Applicable | 4 | 2 | 6 | 12% |
| Not Evaluated | 6 | 6 | 12 | 24% |
| **Total criteria** | **30** | **20** | **50** | **100%** |

No criterion is currently rated **Does Not Support** outright — every
criterion where real gaps were found also has real, verified, working
implementation for at least part of the product, which is why they land in
**Partially Supports** rather than a flat failure. That is a statement about
the evidence, not a claim of good news: **Partially Supports is not a passing
grade**, and 44% of all criteria carry a known, named gap. Read the remarks,
not just the level.

---

## 6. WCAG 2.1 Report

### Table 1: Success Criteria, Level A

| # | Criterion | Level | Remarks |
|---|---|---|---|
| 1.1.1 | Non-text Content | **Partially Supports** | `jsx-a11y/alt-text` runs as a CI error-level rule on every file (`apps/web/eslint.config.mjs`), part of the 93-error down-only-ratcheted baseline — presence of `alt` is gated. Fleet-map status pins additionally carry `role="img"` + a descriptive `aria-label` per status (`ScreenMap.tsx`, commit `16a2dd49`). **Not evaluated:** whether existing `alt` text values are *meaningful* rather than merely present — static analysis checks the attribute exists, not its content quality. |
| 1.2.1 | Audio-only and Video-only (Prerecorded) | **Not Applicable** | No vendor-authored prerecorded audio-only or video-only media found bundled in the product (no onboarding/marketing video with narration). Operator-uploaded video/audio playlist assets are tenant content — see [§3](#3-scope-and-applicability-notes). |
| 1.2.2 | Captions (Prerecorded) | **Not Applicable** | Same reasoning as 1.2.1. Note as a product gap, not a conformance failure: VenueOS has no built-in captioning/transcription tool for operator-uploaded video today. |
| 1.2.3 | Audio Description or Media Alternative (Prerecorded) | **Not Applicable** | Same reasoning as 1.2.1. |
| 1.3.1 | Info and Relationships | **Partially Supports** | `label-has-associated-control` is an error-level CI rule; the 2026-08-24 burndown fixed two shared `PropertiesPanel` components (`SelectField`, `FontFamilyField`) that had **no** label association at all, affecting every widget type rendered through them (commit `511c5fd2`). Known, unfixed structural gap: axe's `nested-interactive` rule flags `BuilderZone.tsx`'s zone-selection wrapper (`role="button"`) containing the widget's own focusable contentEditable text as a descendant, and ~100 template-gallery cards on `/{tenant}/templates` with the same pattern (`a11y-warning-baseline.json` items 3 & 5). A spot-check of `/screens` also found the heading order jumping `<h1>` → `<h3>` with no `<h2>` (see 2.4.6). |
| 1.3.2 | Meaningful Sequence | **Not Evaluated** | Requires a DOM-order-vs-reading-order comparison per page; not checked at scale in this pass. |
| 1.3.3 | Sensory Characteristics | **Not Evaluated** | Not systematically checked. The surfaces read for other criteria (hold-to-trigger buttons, fleet-map legend) all pair color with shape/icon/text rather than relying on color/position/shape alone, which is a positive signal but not a full sweep. |
| 1.4.1 | Use of Color | **Partially Supports** | Fleet-map status pins were rebuilt specifically for this criterion: distinct Lucide icon shapes per status (not just color), `role="img"` + `aria-label`, white-stroke icon for contrast, and the legend mirrors the map so a color-vision-deficient operator can match by shape (`ScreenMap.tsx`, commit `16a2dd49`, which cites the original bug: STALE/OFFLINE/ONLINE_NO_CACHE all sat in a red-orange band ~8% of male users can't reliably distinguish). Not verified for every other status/badge indicator in the app. |
| 1.4.2 | Audio Control | **Partially Supports** | Player video playback defaults to muted (`isMuted = muted !== false` in `apps/web/src/app/player/page.tsx`) — the safe default. But an operator can set a playlist video asset's `muted` config to `false`, which then autoplays with sound on an unattended kiosk display with **no viewer-facing pause/mute control** (the player has no interactive chrome for bystanders). Real, verified, opt-in gap. |
| 2.1.1 | Keyboard | **Partially Supports** | Strong positive evidence: `/panic`'s hold-to-trigger buttons route Space/Enter through the identical `startHold()` code path as pointer input, with repeat-key squelching (`apps/web/src/app/panic/page.tsx`); `AppDialogHost` is fully keyboard-operable (Tab trap, D-pad/arrow toggle, Escape); the template builder and sports console keyboard shortcuts both guard against firing while a text field has focus. **Confirmed, uncorrected failure:** the indoor floor-plan screen-placement control (`apps/web/src/components/floor-plans/EmbeddedFloorPlanView.tsx`, `DraggableScreenCard`) is `role="button" tabIndex={0}` — focusable — but has **no `onKeyDown` handler at all**; its own `aria-label` reads "*click and hold to drag onto the plan*", i.e. the only way to place a screen on a floor plan is a pointer drag gesture. This is the exact gap named in the task brief and it is still present. Separately, the template-builder canvas's `DndContext` (`BuilderShell.tsx`) has no `KeyboardSensor` registered, though `PropertiesPanel`'s numeric x/y/width/height fields provide a keyboard-operable equivalent path for the same repositioning result. |
| 2.1.2 | No Keyboard Trap | **Supports** | `AppDialogHost` (`apps/web/src/components/ui/app-dialog.tsx`): Escape always resolves and dismisses across all three dialog kinds (confirm/alert/prompt); Tab is trapped *within* alert/prompt dialogs (added in the 2026-08-24 wave, commit `511c5fd2`) but never traps the whole page; confirm dialogs' existing D-pad/Tab two-way toggle between Cancel/Confirm also never escapes. Verified by direct code read. |
| 2.1.4 | Character Key Shortcuts | **Supports** | Both single-character shortcuts found (`?` to open the keyboard-shortcuts sheet, in `BuilderShell.tsx` and `apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx`) are guarded by an `inInput`/target-tag check that disables the shortcut whenever an `INPUT`/`TEXTAREA`/`SELECT`/contentEditable element has focus, and both toggle open/closed rather than being a one-way trap. |
| 2.2.1 | Timing Adjustable | **Partially Supports** | The JWT session defaults to a **1-hour** lifetime (`apps/api/src/auth/auth.module.ts`, `signOptions: { expiresIn: '1h' }`). A proactive silent-refresh mechanism (`apps/web/src/lib/api-client.ts`, "Trust-wave D") transparently renews the token on any successful API call made in the token's last 15 minutes, so an *actively working* user is unlikely to ever see the cliff — but the refresh is capped: "plain sessions stop sliding 12h after login" per that file's own comment, past which the user is logged out with **no warning and no way to extend**. A genuinely idle session (no requests for over an hour) simply expires; the next interaction 401s and `AuthExpirationGuard.tsx` performs an immediate, unwarned hard redirect to `/login` that also clears the React Query cache — any unsaved template-builder edit is at risk. 12 hours does not meet WCAG's 20-hour exemption floor, and no warn-and-extend UI exists anywhere in the codebase. |
| 2.2.2 | Pause, Stop, Hide | **Partially Supports** | `apps/web/src/app/globals.css` has a global `@media (prefers-reduced-motion: reduce)` block that clamps *every* animation and transition duration to ~instant app-wide (added specifically because "full-screen pulsing-red EmergencyOverlay raises a photosensitive concern" per its own comment) — a strong, correctly-implemented, OS-preference-driven mechanism. **Not found:** an in-UI pause/stop control (independent of the OS setting) for any auto-updating content; not exhaustively checked across all widget themes. |
| 2.3.1 | Three Flashes or Below Threshold | **Supports** *(spot-checked, not exhaustive)* | The player's full-screen emergency-alert border (`apps/web/src/components/player/EmergencyOverlay.tsx`) uses Tailwind's default `animate-pulse` (2-second cycle = 0.5 Hz), far under the 3-flashes/second seizure threshold; no custom override of that animation's timing was found in `globals.css`. This was **not** checked across the full widget/theme catalog (164+ files per prior internal audits) for other animated effects (e.g. sports-celebration widgets) — flagged for the human-verification list given the real stakes on an LED signage product. |
| 2.4.1 | Bypass Blocks | **Supports** | A visually-hidden "Skip to main content" link (`href="#main-content"`) is the first focusable element rendered by `apps/web/src/components/layout/DashboardLayout.tsx`, targeting `<main id="main-content" tabIndex={-1}>`; it becomes visible on focus. Verified by direct code read. |
| 2.4.2 | Page Titled | **Partially Supports** | The root layout sets a static title (`"Venue OS"`), and `BrandStyleInjector.tsx` appends the active tenant's display name client-side (`${base} · ${tenantName}`), so each tenant's session is at least distinguishable from another tenant's. **Verified gap:** zero of the 37 `page.tsx` files under the authenticated `[schoolId]` route tree set any per-route title — `/screens`, `/playlists`, `/templates`, every `/settings/*` page, every `/sports/*` page, etc. all render the exact same document title. (Public/marketing pages fare better: 52 files across the app export Next.js `metadata`/`generateMetadata`.) |
| 2.4.3 | Focus Order | **Partially Supports** | `AppDialogHost` deliberately sets initial focus to the Confirm button on open and restores focus to the element that invoked it once the dialog queue drains (`previousFocusRef`) — a correctly-implemented, verified pattern. Not exhaustively swept for DOM-order-vs-visual-order mismatches elsewhere in the app. |
| 2.4.4 | Link Purpose (In Context) | **Not Evaluated** | No systemic "click here"-style anti-pattern was noticed in the files read for other criteria, but this was not a targeted, site-wide sweep. |
| 2.5.1 | Pointer Gestures | **Supports** | The hold-to-trigger gesture is a single-point sustained press, not a path-based or multipoint gesture, so 2.5.1 doesn't restrict it. No pinch/swipe-only interaction gating unique functionality was found in the surfaces reviewed. |
| 2.5.2 | Pointer Cancellation | **Supports** *(spot-checked)* | `/panic`'s hold-to-trigger only commits (fires the emergency) after the full 3-second hold elapses via a timer; `pointerup`/`pointercancel`/`onBlur` before that aborts cleanly (`clearHold()`, verified in `apps/web/src/app/panic/page.tsx`). The down-event itself never completes the action. Not exhaustively checked for every click handler app-wide. |
| 2.5.3 | Label in Name | **Partially Supports** | Of the six `/panic` hold-to-trigger buttons, five have an accessible name (built from the emergency type's internal `id`) that matches their visible on-screen label (built from the type's `name`) case-insensitively — `hold`/"Hold", `secure`/"Secure", `lockdown`/"Lockdown", `evacuate`/"Evacuate", `medical`/"Medical". **The sixth does not:** `{ id: 'weather', name: 'Shelter' }` renders visible text "SHELTER" but its `aria-label` reads "*Trigger weather emergency…*" — the word "Shelter" never appears in the accessible name. A speech-input user who says "click Shelter" would fail to activate this control. Verified directly in `apps/web/src/app/panic/page.tsx`'s `TYPES` array. |
| 2.5.4 | Motion Actuation | **Not Applicable** | No device-motion-actuated (shake/tilt) functionality was found in the surfaces reviewed. |
| 3.1.1 | Language of Page | **Supports** | `<html lang="en">` is the static default (`apps/web/src/app/layout.tsx`), and `document.documentElement.lang` is kept in sync with the active locale after a client-side language switch (`apps/web/src/i18n/I18nProvider.tsx`, `document.documentElement.lang = LOCALE_HTML_LANG[l]`). Verified by direct code read. |
| 3.2.1 | On Focus | **Not Evaluated** | No context-change-on-focus anti-pattern was noticed in the surfaces reviewed; not a targeted sweep. |
| 3.2.2 | On Input | **Not Evaluated** | Same caveat as 3.2.1. The one relevant pattern found (the language switcher) changes state only on an explicit user selection, not on mere focus or an incidental input event — the correct pattern where checked. |
| 3.3.1 | Error Identification | **Partially Supports** | The login page (`apps/web/src/app/login/page.tsx`) — the single most universal form in the product — renders authentication errors as plain, styled `<p>` text with no `role="alert"` and no `aria-invalid` on the associated field. The error text is present in the DOM (satisfying the literal "described to the user in text" requirement) but is not programmatically flagged as an error region. Contrast with 4.1.3, where the emergency-trigger flow does this correctly. |
| 3.3.2 | Labels or Instructions | **Partially Supports** | `jsx-a11y/label-has-associated-control` is an error-level CI rule, and the 2026-08-24 burndown specifically fixed two widely-shared components with no label association at all (`SelectField`, `FontFamilyField` in `PropertiesPanel.tsx`, affecting every widget type). The same commit's message states `apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx` (42 remaining `jsx-a11y` errors, described as "same backdrop/label patterns already fixed elsewhere") was **not reached** in that pass. Note also: only 1 file in the whole web app uses React Hook Form + Zod (`useForm(`/`zodResolver`), despite `CLAUDE.md` stating that as the intended form convention — most forms are hand-rolled with `useState`, so label/instruction quality is not standardized by a shared pattern. |
| 4.1.1 | Parsing | **Not Evaluated** | No DOM validator was run directly. Axe-core (which includes duplicate-id and related structural checks) runs against 10 authenticated routes in CI, and none of the 10 currently-documented baseline errors are in that rule family — a light positive signal, not a parsing-specific validation pass. |
| 4.1.2 | Name, Role, Value | **Partially Supports** | Strong positive evidence: `AppDialogHost` uses `role="dialog" aria-modal="true" aria-labelledby="app-dialog-title"`; icon-only buttons in `LayersPanel.tsx` correctly pair a descriptive, per-item `aria-label` with a redundant native `title`; fleet-map pins carry `role="img"` + `aria-label`. **Two verified, specific gaps:** (1) `AppDialogHost`'s `aria-labelledby` points at an element (`<h2 id="app-dialog-title">`) that only renders when the dialog was given a `title` prop — a dialog opened without one has no accessible name via that relationship. (2) The documented, unfixed axe baseline includes an "auto-refresh-interval" number input on `/{tenant}/emergency/broadcast` with no accessible name at all (`a11y-warning-baseline.json` item 9), plus the two `nested-interactive` violations already described under 1.3.1. |

### Table 2: Success Criteria, Level AA

| # | Criterion | Level | Remarks |
|---|---|---|---|
| 1.2.4 | Captions (Live) | **Not Applicable** | No vendor-provided live audio/video conferencing exists. Third-party live-stream integrations (embedded YouTube Live, Atmosphere TV, NFHS Network overlay) surface someone else's live video; captioning that stream is the source provider's responsibility, not VenueOS's own interface. |
| 1.2.5 | Audio Description (Prerecorded) | **Not Applicable** | Consistent with 1.2.3. |
| 1.3.4 | Orientation | **Supports** | System templates explicitly support both orientations — `apps/api/src/templates/system-presets.ts` has real `orientation: 'LANDSCAPE'` and `orientation: 'PORTRAIT'` presets (e.g. "Hallway Portrait Display"). The one orientation *lock* found in the codebase (`apps/web/src/app/player/page.tsx`, "per-screen orientation lock") only applies to the player/kiosk route and is driven by a per-screen config value (`LANDSCAPE` / `PORTRAIT` / `AUTO`) that mirrors how the physical display is actually mounted — the "essential" exception WCAG 1.3.4 itself carves out for a fixed-orientation installed display, analogous to a wall-mounted sign. No orientation lock was found on the dashboard. |
| 1.3.5 | Identify Input Purpose | **Partially Supports** | The login/MFA form — the single highest-value surface for this criterion — correctly uses `autoComplete="email"`, `autoComplete="current-password"`, `autoComplete="one-time-code"`, and `autoComplete="organization"` (`apps/web/src/app/login/page.tsx`, verified). Only 14 files in the whole web app use `autoComplete` at all; other common-input forms (e.g. account/profile fields) were not individually checked. |
| 1.4.3 | Contrast (Minimum) | **Partially Supports** | `apps/web/tools/check-brand-contrast.cjs` is a real, CI-wired gate (`.github/workflows/deploy-reliability.yml`) that transpiles and executes the actual `apps/web/src/lib/brand-contrast.ts` module and asserts its math against the literal palette that caused a real production incident (a tenant's cream-colored `#fcf9e2` brand primary was silently serving as an indigo-600 text/button color, "making half the Settings chrome invisible"). The contrast formula itself is the correct WCAG relative-luminance calculation (verified by reading the code), and it force-derives a ≥4.5:1-passing shade from any tenant brand color before it's used as the "workhorse" text/button color. **But** the axe baseline documents 6 of its current 10 baseline errors as unrelated, un-fixed color-contrast violations, including on two life-safety surfaces: `/panic`'s four hold-to-trigger button labels (measured **~1:1**) and `/{tenant}/emergency/broadcast`'s orange "Warn" button (**2.88:1**) — both explicitly deferred pending "lead sign-off" per `CLAUDE.md`'s emergency-system change policy, not yet fixed. |
| 1.4.4 | Resize Text | **Partially Supports** | The dashboard's root viewport config explicitly *allows* pinch-zoom, with an accessibility-motivated comment in the source: `apps/web/src/app/layout.tsx` — "Allow user-scale on the dashboard so an admin with vision needs can pinch-zoom forms." Both `/player` and `/panic`, however, explicitly set `user-scalable=no` (verified in `player/layout.tsx`, `player/page.tsx`, and `panic/page.tsx`'s meta-viewport axe finding). The player's lock is reasonably justified as a passive-display surface (see [§3](#3-scope-and-applicability-notes)), but `/panic` is an **interactive tool an operator uses**, and the zoom lock there is a real, already-self-documented tension (`a11y-warning-baseline.json` item 7 flags it explicitly as "a real WCAG 1.4.4/1.4.10 concern for low-vision users," unresolved). |
| 1.4.5 | Images of Text | **Not Evaluated** | No systemic images-of-text pattern was found in the vendor's own dashboard chrome (real text via Tailwind/React throughout the surfaces read). The ~107 self-contained EXTERNAL_HTML signage board templates are an operator content-authoring surface where text-in-image is possible depending on what an operator designs — out of vendor scope per [§3](#3-scope-and-applicability-notes), not swept. |
| 1.4.10 | Reflow | **Not Evaluated** | Requires a 320px-width visual sweep across dozens of routes; not performed this pass. The existence of a dedicated mobile-responsive layer (`Sidebar.tsx` slide-in drawer, `MobileTabBar`, and a CI-enforced `mobile-perf-guard` gate) is suggestive of real investment in narrow-viewport support but was not independently verified against the 1.4.10 reflow definition. |
| 1.4.11 | Non-text Contrast | **Not Evaluated** | No dedicated automated gate comparable to `check-brand-contrast.cjs` was found for UI-component borders or focus indicators specifically. The shared `Button` component's default focus ring (`focus-visible:ring-ring/50` — 50% opacity) was not independently measured against the 3:1 floor. |
| 1.4.12 | Text Spacing | **Not Evaluated** | No dedicated test or gate found; not manually verified with the standard text-spacing override technique. |
| 1.4.13 | Content on Hover or Focus | **Partially Supports** | A proper, accessible Tooltip component exists (`apps/web/src/components/ui/tooltip.tsx`, built on Base UI's `Tooltip` primitive, globally available via `TooltipProvider` mounted in the root layout) — but it is used in only **1 file** app-wide. 80 files use the native HTML `title` attribute instead. Spot-checking a sample: `LayersPanel.tsx`'s icon buttons correctly pair `aria-label` (the real, persistent accessible name) with a redundant `title` — not a 1.4.13 problem, since no *new* information is hidden behind the non-dismissible native tooltip. But `BuilderToolbar.tsx`'s "Version history" icon button has **only** a `title` attribute — no visible text, no `aria-label` — meaning its one and only accessible-name/hover-content channel is a native, non-dismissible, non-hoverable, browser-controlled tooltip with inconsistent screen-reader support. This is the exact "title=-only tooltip" pattern the task brief asked to verify, and it is real, though not universal. |
| 2.4.5 | Multiple Ways | **Supports** *(light)* | A single, persistent, comprehensive `Sidebar` (rendered once by `DashboardLayout.tsx` for every authenticated route) lists every major section; no secondary search/command-palette was found, but none appears necessary — most pages are steps in an operational workflow rather than a large content corpus a user needs multiple ways to locate, which is the case WCAG's own SC text exempts. |
| 2.4.6 | Headings and Labels | **Partially Supports** | `jsx-a11y/label-has-associated-control` is enforced (see 3.3.2). A direct spot-check of `/{tenant}/screens` found its heading structure jumps `<h1>` straight to `<h3>` with **no `<h2>` anywhere on the page** (`apps/web/src/app/[schoolId]/screens/page.tsx`) — a real, verified structural gap in the moderate/minor class axe itself would flag as `heading-order`. Not swept page-by-page for every route, or for the descriptiveness of every heading/label. |
| 2.4.7 | Focus Visible | **Partially Supports** | The shared `Button` component (`apps/web/src/components/ui/button.tsx`) ships a real default focus-visible ring (`focus-visible:ring-3 focus-visible:ring-ring/50` + `focus-visible:border-ring`), and of the 86 files using `outline-none` app-wide, 79 pair it with a `focus-visible`/`focus:ring` replacement somewhere in the same file. **7 files pair `outline-none` with zero focus-visible replacement anywhere in the file**, verified by grep + spot-read: `apps/web/src/app/panic/page.tsx` (the life-safety hold-to-trigger buttons — confirmed no `focus-visible`/`focus:ring`/`focus:outline` anywhere in the file), `LanePadSection.tsx`, `sync-calibrate/page.tsx`, `PublishToLocationsModal.tsx`, `ScreenLocationModal.tsx`, `FleetRollup.tsx`, `DistrictCommandCenter.tsx`. A keyboard user tabbing to the `/panic` trigger buttons — which are independently verified to be keyboard-**operable** (2.1.1) — gets no visible indication of which button is currently focused. |
| 3.1.2 | Language of Parts | **Partially Supports** | For the roughly 9% of the web app's component files (45 of 508 `.tsx` files under `src/app`+`src/components`) that call `useTranslations()`, `document.documentElement.lang` is correctly kept in sync with the selected locale (`I18nProvider.tsx`). For the other ~91%, UI text remains hardcoded English with no per-fragment `lang="en"` override. That's not a problem while the page's own `lang` is `"en"` (the default) — but the moment an operator or district staffer switches to Spanish or Chinese (both fully built out: `es.json`/`zh.json` are each 1,459 lines, matching `en.json` line-for-line), the ~91% of still-hardcoded English text renders under `document.documentElement.lang="es"` (or `"zh"`) with no `lang="en"` marking those specific fragments — a genuine, measured 3.1.2 gap that only manifests once a non-English locale is selected. |
| 3.2.3 | Consistent Navigation | **Supports** *(reasonable inference, not exhaustively clicked through)* | Every authenticated route renders through the single shared `DashboardLayout.tsx`, which owns the `Sidebar`/`TopToolbar`/`MobileTabBar` — there is exactly one implementation of the navigation chrome, not per-page copies, which structurally guarantees the same relative order and labeling across routes. |
| 3.2.4 | Consistent Identification | **Not Evaluated** | Would require a full icon/label audit for consistent reuse of the same icon+label pairing for the same function across the whole app. No contradicting evidence was found in the files read (e.g. the `Trash2` icon consistently paired with "Delete"/"Discard" wording), but this was not a targeted sweep. |
| 3.3.3 | Error Suggestion | **Not Evaluated** | Only 1 file in the app uses React Hook Form + Zod; the rest of the app's forms are hand-rolled, so there is no single standardized error-message pattern to evaluate against this criterion at scale. Flagged as an area needing dedicated review. |
| 3.3.4 | Error Prevention (Legal, Financial, Data) | **Partially Supports** | Stripe Checkout/Customer Portal are Stripe-hosted pages outside VenueOS's own rendering — reasonable to assume conformant given Stripe's maturity, but not independently verified by this report (out of scope per [§3](#3-scope-and-applicability-notes)). `AppDialogHost`'s `appConfirm()` gives a real, reusable confirm-before-destructive-action pattern used for delete-style flows elsewhere in the app. The emergency-trigger flow (arguably the highest-stakes "submission" in the product) deliberately uses a 3-second hold instead of a reversible confirm/undo step — an appropriate, documented departure from the usual pattern given that speed matters more than reversibility in a live emergency, but worth naming explicitly as a considered exception rather than an oversight. |
| 4.1.3 | Status Messages | **Partially Supports** | `EmergencyLiveRegion`/`useEmergencyAnnouncer` (`apps/web/src/components/emergency/EmergencyLiveRegion.tsx`) is a `role="status" aria-live="assertive" aria-atomic="true"` region plus a best-effort Web Speech utterance, and it is genuinely wired into all three emergency-trigger surfaces — the mobile `/panic` page's own local implementation of the identical pattern, the desktop `/{tenant}/emergency/broadcast` console, and `EmergencyTriggerModal` — firing `announce()` on every real lifecycle transition (holding → triggering → success/failure). This is a strong, verified, best-in-class implementation for the one surface where it matters most. **But** it is a life-safety-specific pattern, not a shared, app-wide one: the login page's authentication-error text (see 3.3.1) has no `role="alert"`/`aria-live` at all, so a screen-reader user is not proactively notified when an ordinary form error appears elsewhere in the app. |

---

## 7. Detailed findings appendix

This section expands on a few cross-cutting themes referenced repeatedly
above, with the full evidence trail, for a human reviewer who wants to go
straight to the code.

### 7.1 What's genuinely strong

- **The emergency-trigger flow is the best-audited, best-implemented
  accessibility surface in the product**, which is the right place for that
  investment to be concentrated given what it's for. Keyboard-operable
  hold-to-trigger (2.1.1), pointer-cancellation-safe (2.5.2), a dedicated
  live-region announcer wired into all three trigger surfaces (4.1.3), and a
  seizure-safe emergency-overlay flash rate (2.3.1) are all independently
  verified in code, not just documented as intent.
- **The brand-contrast gate** (`apps/web/tools/check-brand-contrast.cjs` +
  `apps/web/src/lib/brand-contrast.ts`) is a genuinely well-built piece of
  infrastructure: it re-derives the actual WCAG contrast formula, is pinned
  against the literal palette from a real production incident, and runs in
  CI. It's the single best piece of automated *prevention* infrastructure
  found in the repo for any WCAG criterion.
- **`AppDialogHost`** is a carefully built, keyboard-first modal
  implementation — Tab trap, focus restore, D-pad support for TV/kiosk
  remotes, Escape handling that's consistent across all three dialog kinds.
- **The `prefers-reduced-motion` global CSS clamp** is a rare thing to find
  done well and app-wide rather than per-component; it was added
  specifically because of a named photosensitivity concern (the emergency
  overlay), which is exactly the right reason to add it.

### 7.2 Known gaps, honestly stated

- **The jsx-a11y baseline (93 errors) has no committed itemized breakdown.**
  Unlike the axe baseline (`a11y-warning-baseline.json`, which names every
  one of its 10+2 violations by file and reason), `.a11y-baseline` is a bare
  integer. The 2026-08-24 burndown commit message (`511c5fd2`) names the
  *excluded* areas (dashboard/screens/playlists/templates page.tsx,
  `super/**`, `components/ai/**` — other in-flight ownership;
  `components/widgets/**`, `app/player/**`, `components/player/**` — the
  Taurus/widget-render-tree rule; `emergency/broadcast/page.tsx` and
  `PanicContentEditor.tsx` — emergency sign-off boundary) and the *not-yet-
  reached* remainder (`sports/[gameId]/page.tsx` at 42 errors — the single
  biggest file — plus `AssetPicker`, `reset-password`, `accept-invite`,
  `AddressAutocomplete`), but does not enumerate what rule each of the 93
  errors actually violates. A future pass should run `pnpm --filter web
  lint` locally (this session could not — `apps/web/node_modules` is not
  installed in this worktree) and commit an itemized breakdown the way the
  axe baseline already does.
- **`docs/ACCESSIBILITY.md` documents a component-level testing pattern
  that does not exist.** It instructs developers to `import { render } from
  '@testing-library/react'; import { expectNoA11yViolations } from
  '@/test-utils/axe';` — but `apps/web/src/test-utils/axe.ts` (or any file
  by that name) does not exist anywhere in the repository, and
  `expectNoA11yViolations` has **zero** call sites. `jest-axe` is a listed
  `devDependency` (`apps/web/package.json`) with **zero** imports anywhere
  in `apps/web/src`. This documentation is stale and should be corrected or
  the tooling should be built — right now there is no component-level
  automated a11y test coverage at all; the real, active, CI-enforced
  automated coverage is the Playwright/axe route scan (10 routes) and the
  jsx-a11y lint ratchet, not unit tests.
- **The Lighthouse accessibility category does not gate CI.**
  `.github/workflows/lighthouse.yml` runs with `continue-on-error: true` on
  the relevant step — exactly the item `docs/ACCESSIBILITY.md`'s own
  "Tightening the gate" section lists as still outstanding.
- **Session timeout has no warn-and-extend UX** (2.2.1) — see the Table 1
  remark. This is worth calling out again here because it's an easy fix
  relative to its impact: a "your session is about to expire — stay signed
  in?" prompt before the silent-refresh window closes would resolve it.
- **Floor-plan screen placement is pointer-only** (2.1.1) — see the Table 1
  remark. This was explicitly named in the task brief as something to
  verify, and it is confirmed still true as of this commit.

### 7.3 Internationalization coverage, precisely

`apps/web/src/i18n/` is a real, working, client-side `next-intl`
integration (not a stub): three complete message catalogs
(`en.json`/`es.json`/`zh.json`, each 1,459 lines), device-language
auto-detection with an explicit-choice override that persists via cookie,
and correct `document.documentElement.lang` synchronization on switch. The
gap is coverage, not infrastructure: `grep -rl "useTranslations(" apps/web/src
--include="*.tsx" | wc -l` returns **45**, against **508** total `.tsx`
files under `apps/web/src/app` + `apps/web/src/components`. Most of the
product is not yet wired through the translation layer.

---

## 8. Criteria requiring a human AT pass before issuance

Every rating in this document is a code-review judgment. The list below is
not "everything" (technically all 50 criteria deserve a real AT pass before
this goes to a customer) — it prioritizes the criteria and surfaces where a
human tester (NVDA + Chrome/Edge, JAWS + Chrome/Edge, VoiceOver + Safari, and
a keyboard-only pass with no mouse at all) is most likely to find something
the code-review pass could not, either because the stakes are highest
(life-safety) or because the rating above is closest to a coin flip:

1. **The entire `/panic` mobile emergency-trigger flow**, keyboard-only and
   with a screen reader — 2.1.1, 2.4.7, 2.5.3, 4.1.3, 1.4.3 all have a named,
   specific finding on this one page; it is the single highest-priority
   surface to verify by hand given it's a life-safety control.
2. **`/{tenant}/emergency/broadcast`**, same reasoning, desktop screen reader
   + keyboard.
3. **`AppDialogHost`** (confirm/alert/prompt) with NVDA/VoiceOver — verify
   the dialog title/accessible-name gap (4.1.2) and the Tab-trap behavior
   are actually announced and experienced the way the code implies.
4. **The template builder** (`/{tenant}/templates/builder/{id}`) — the
   single most complex authenticated surface in the app (drag/drop canvas,
   `PropertiesPanel` forms, `BuilderZone` nested-interactive pattern) —
   keyboard-only, end to end, including actually trying to reposition a
   widget without a mouse.
5. **The floor-plan screen-placement UI** — confirm there is truly no
   keyboard path (this report says there is none) and scope what a fix
   would need to cover.
6. **Login + MFA enrollment**, screen reader — verify the un-announced error
   text (3.3.1/4.1.3 finding) is actually a problem in practice with a real
   screen reader, not just in the DOM.
7. **A full keyboard-only pass with no mouse, no trackpad** across the core
   operator journey: log in → create a screen → build/edit a template →
   create a playlist → schedule it → view the fleet map.
8. **Color-vision-deficiency simulation** (not just contrast-ratio math) on
   the fleet map, dashboard status badges, and sports-console UI.
9. **A full sweep of animated widget themes** for the 3-flashes threshold
   (2.3.1) — this report only checked the emergency overlay, not the wider
   widget/theme catalog (164+ files).
10. **Text-spacing override test** (1.4.12) and **320px reflow test**
    (1.4.10) — neither was performed at all this pass.
11. **Non-text contrast measurement** (1.4.11) on focus rings, form-control
    borders, and icon-only buttons against their backgrounds.
12. **Spanish and Chinese locale sessions**, screen reader — confirm the
    3.1.2 finding (hardcoded English under a non-English `lang`) is audible
    as a real problem (e.g. an English word read with a Spanish TTS voice).

---

## 9. Revision history

| Date | Change |
|---|---|
| 2026-08-25 | Initial draft assembled from automated tooling + code review. No human evaluator assigned yet. |

---

*This report does not constitute a legal determination of ADA, Section 504,
Section 508, or DOJ Title II compliance for VenueOS or for any customer's
use of it. It is a good-faith technical conformance report intended to
support a customer's own accessibility review. See
[docs/compliance/README.md](./README.md) for how to regenerate and extend
the evidence behind this document.*
