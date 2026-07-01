# App Library → World-Class: Ranked Build Plan (lead synthesis)

Date: 2026-07-01. Synthesized by the lead from the 7-lens critique
([10-WORLDCLASS-CRITIQUE.md](10-WORLDCLASS-CRITIQUE.md), 52 findings). The workflow's
own synthesis step returned a stub; this is the real plan.

**North star (Greg):** the App Library must be *amazing* and the add-to-template flow so
easy *anyone* can use it — usability is our differentiator. **Every change REMOVES
friction; NONE adds a setting** (his standing "don't over-engineer" rule).

Findings clustered into 7 themes; deduped across lenses (Concierge, live-preview,
RSS/Calendar silent-break, placement, paste-first each recurred in 3-4 lenses).

---

## TIER 1 — build now (the effortless core; all S/M, no new knobs, front-end only)

**1. Paste-first / auto-detect (the headline "wow").** Invert pick-then-paste → paste-anything.
- `detectApp(input): {appId, prefill} | null` pure helper in url-transforms.ts, reusing the
  matchers that ALREADY exist (youtubeVideoId, toVimeo/Twitch/Slides/Sheets/Canva/Maps). (S)
- "Paste any link" input as the FIRST element in AppLibraryPanel → on match, open that app's
  config form PREFILLED + a green "We recognized this — YouTube" strip; no match → grid as-is. (M)
- `initialValues?` prop on AppConfigForm, merged over defaults (unblocks the handoff; required
  URL prefilled → "Add to canvas" instantly live). (S)
- Existing search box recognizes a pasted URL instead of "No apps match". (S)

**2. Live preview truthfulness.** Today the preview is a FAKE browser mockup for all 7 WEBPAGE
apps (Slides/Sheets/Canva/Maps/PowerPoint/Web-URL) — `live={false}` → "Web content will load here".
- Pass `live={true}` to WidgetPreview for WEBPAGE (proxy is SSRF-guarded), debounced ~600ms on a
  valid https URL, so the operator sees their ACTUAL deck/map before adding. (S)
- Add explicit empty / loading / error states to the preview box. (S)

**3. Smart placement + post-add.** Today every app lands at the same 40%×30% box; QR (TOUCH_POINT)
misses the small-tile shrink; post-add fires two competing panel intents.
- `defaultSize?: {w,h}` per app + widgetType-keyed fallback in addZone: video 16:9-fills, docs
  ~half-canvas, weather/clock/countdown compact, QR small corner. Orientation-aware. (M)
- After add: keep selection on the new zone, scroll-into-view + brief highlight, one coherent
  outcome (hand to Properties). (S)

**4. Config-form ease (copy + micro-UX).**
- Plain-English labels/placeholders — kill "embed URL", "iCal (.ics)", "lat,lng", "pubhtml". (S, copy)
- Numbered `setupSteps?: string[]` (+ optional deep-link button) instead of one amber prose blob. (M)
- Native date picker: add `'date'` field type; Countdown stops demanding "YYYY-MM-DD". (S)
- Disabled "Add to canvas" states its ask ("Paste your Google Slides link to continue"). (S)
- Public-exposure line for publish-to-web apps ("this makes it viewable by anyone with the link"). (S)

**5. Cheap Concierge seed (zero-typing).** Prefill Weather `location` + Maps `query` from the
tenant's onboarding address/lat-lng if available in builder context (verify it's reachable; skip if not). (S)

**6. Discovery / mobile / a11y / icons.**
- **Mobile-perf FIX (CI violation):** BuilderShell sidebar has always-mounted `backdrop-blur-2xl`
  + ungated `blur-[120px]/[100px]` blobs → breakpoint-gate them (`md:`), `hidden md:block`. (S)
- Responsive sidebar: `w-full max-w-[92vw] md:w-[420px]` so Apps doesn't overflow an iPhone. (S/M)
- Real brand-icon SVG map (local, ~15 marks, no npm dep) → grid instantly scannable
  (Instagram is currently a ThumbsUp). (M)
- Empty-search recovery (Clear + fallback to Web-Page/URL), drop the dead "login" friction tier,
  a11y: chip `aria-pressed`, result `aria-live`, focus mgmt on form open/close. (S)

**7. Honesty (no silent-break tiles).** RSS + Calendar are wired to widgets that render fiction.
- **Calendar → route through WEBPAGE** using Google Calendar's public embed HTML (works TODAY, real content).
- **News/RSS → `comingSoon: true`** (honest) until the real SSRF-guarded fetch lands (Phase 2).
- Remove team-facing "Phase 1 note for the team" copy from the operator's view.

---

## TIER 2 — tee up next (higher value but L-effort / backend / bigger surface)

- **Finished-board-per-app** (competitive P0): clicking an app offers 2-3 AI-Designer-generated
  finished boards with the data already placed, not a bare zone. THE way we beat OptiSigns/Yodeck's
  template libraries — we generate instead of curate. (L, depends on AI Designer wiring)
- **Full Concierge "Suggested for you" row**: wire /integrations/discover into the Apps panel +
  extend discovery to capture the operator's OWN links (detectedValue) so tiles arrive pre-filled
  ("We found your Instagram"); + /describe intake for no-website operators. (M-L, backend)
- **Sign-in-with-Google OAuth** for private Slides/Sheets/Calendar (kills the publish-to-web chore). (L)
- **Real RSS fetch + real ICS parse** (SSRF-guarded backend endpoint). (M-L)
- **Embeddability preflight** (X-Frame/CSP HEAD via safeFetch / reuse streaming/validate) with inline
  "publish it first" fix before Add. (M — partly covered by Tier-1 live-preview revealing the wall)
- **Add-app-to-a-screen without a template** (first-class app instance/asset → schedule directly). (M)
- **Snapshot-to-Asset + per-app Taurus/LED badge** for Chromium-83 walls. (M)
- **Paste/drop a URL directly onto the canvas.** (M)
- AI one-line explainer on hover + AI diagnostic on blank render (reuse bug-analyzer Tier-1 plumbing). (M)

---

## Execution
Tier-1 is one interconnected front-end cluster (AppLibraryPanel, AppConfigForm, app-registry,
url-transforms, useBuilderStore, BuilderShell, small WidgetRenderer preview routing) — NOT
parallelizable across agents (same files). One Sonnet build agent in a worktree implements the
precise Tier-1 spec; lead (Opus) reviews every diff, upgrades for taste/correctness, verifies
(tsc + render-tree per rule #9 + mobile-perf-guard), and owns the merge. Tier-2 is separate follow-on work.
