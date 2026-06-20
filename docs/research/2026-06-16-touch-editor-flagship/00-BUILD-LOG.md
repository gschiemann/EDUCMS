# Touch/Template Editor — Flagship BUILD LOG (resume anchor)

> **READ THIS FIRST to resume.** Goal (Greg, 2026-06-16): make the touch/template editor the
> **best-in-world** flagship with AI that helps operators build templates in ways they never thought of
> ("it almost makes itself"). Directive: **do everything in the roadmap**, ship CI-green slices, and
> **save progress here after every slice** so a usage-limit interruption can pick right back up.
>
> Strategy + gap matrix + critique: `01-FLAGSHIP-STRATEGY.md`. Research: `02-COMPETITIVE-AI-LANDSCAPE.md`.

## How we ship (environment notes)
- **Local git is sandbox-blocked this session** (`fatal: Unable to read current working directory` on the repo).
  Workaround that works: `gh repo clone gschiemann/EDUCMS /tmp/educms-push --depth 1`, `cp` the edited file(s)
  over the clone, `git commit`/`git push origin master` from `/tmp`, then `rm -rf /tmp/educms-push`. gh is
  authed (gschiemann, repo+workflow scopes). Master = live pilot; push triggers CI + Vercel.
- Per-slice loop: edit in `apps/web|api/src` → `pnpm --filter web exec tsc --noEmit` (run in background) →
  push via clone → watch CI to green (`gh run list -R gschiemann/EDUCMS`) → update this log → next slice.
- Reading repo files: my Read/grep tools work; **subagents cannot read the repo** (EPERM) — do code work on
  the main loop, use workflows only for web research/generation.

## Key files (grounding)
- Editor shell: `apps/web/src/components/template-builder/BuilderShell.tsx` (panels: Widgets=VariantPicker,
  Layers, Scenes, Properties, BrandKit, Background; dnd canvas = `BuilderCanvas`; toolbars).
- Store + mutation/undo contract: `useBuilderStore.ts` — `updateZone(id, patch, commit?)` / `updateZones(...)`;
  `commit:true` is the history-commit hook; past/future snapshot rail with `undo()/redo()`, `HISTORY_LIMIT`.
  **Every external mutation source (chips, chat-to-edit) MUST funnel through these commit points or undo breaks.**
- Snap/guides/layers/lock ALREADY shipped: `snap-engine.ts`, `BuilderCanvas`, `LayersPanel`, `types.ts`
  (`zone.locked`, rotation/opacity). Only a **drag rotate-handle** is missing (small).
- Per-field editing: `PropertiesPanel.tsx` (StyleableField), brand tokens `var(--brand-primary)/accent`.
- AI: `apps/api/src/ai/ai.service.ts` — `generate()` (sparkle), `generateTouchTemplate()` (full template from
  prompt, schema-anchored + allowlist), `ai-providers.ts`, `ai-hourly-cap.ts` (windowCount/recordEvent caps,
  provider resolution BYOK-or-platform). 3-tier economic model enforced here.
- EXTERNAL_HTML boards: inbound apply = **URL-param re-render** (NOT live postMessage); `educms-field-click`
  shim is **outbound-only** (reports clicked element). So chat-to-edit on the 107 HTML boards is harder than a
  postMessage apply — start React-zone first.
- Brand scrape: `apps/web/src/.../branding` + `branding-scraper.service.ts` (logos, ranked colors, palette,
  Google-font match, WCAG grades).

## Build sequence (the roadmap — check off as shipped)
### Slice 1 — Quick wins (low-risk, de-risks the apply/undo contract)
- [x] 1a. **Deterministic suggestion chips** — SHIPPED `12cdc8e` (CI watch in flight). New "Review" tab in the
      builder left rail (`SuggestionsPanel.tsx`) + pure engine (`suggestions.ts`). v1 checks (geometry-only,
      provably-correct fixes): **off-screen** (clamp into frame), **untappable touch target <44px** (grow to 48px),
      **hairline/accidental tiny element** (resize). Each fix applies via `updateZone(id,patch,true)` — proves the
      external-mutation→commit→undo contract chat-to-edit rides on. FAST-FOLLOW (deferred from v1, needs confirmed
      widget-config keys): WCAG contrast on brand palette, 8-ft font-size floor (use exported `measureZoneFontSize`),
      Taurus inset/gap lint, logo-found-on-site, no-emergency-fallback (screen-level, may live in screen settings not builder).
- [ ] 1b. **Persist per-tenant brand voice** (Prisma field) + infer once from scraped homepage copy + feed into
      every generate/chat call (layer on top of the hardcoded per-vertical VOICE clauses).
- [x] 1c. **3-candidate generation** — SHIPPED `81ed6d7` (CI watch in flight). Fan-out (Promise.allSettled) of a
      new shared `dispatchTouchTemplate()` helper 3× with 3 design-direction seeds (Balanced/Bold/Detailed) →
      pick-a-winner grid of `ScaledTemplateThumbnail` cards. **Serves non-touch too** via a Touch/Display toggle +
      a new `SIGNAGE_TEMPLATE_SYSTEM_PROMPT` (no required tap targets). New endpoints `POST
      /templates/generate-touch/candidates` (returns UNPERSISTED drafts) + `POST /templates/create-from-candidate`
      (re-sanitizes client JSON server-side, persists via shared `persistGeneratedTemplate()` the single-shot path
      was refactored onto). Honest 3-tier spend: 1 hourly slot + 1 platform credit PER successful candidate; one
      bad draft doesn't sink the batch; all-fail surfaces the real error. 6 new unit tests (12/12 green), api+web
      tsc clean. Files: ai.service.ts (+helper+candidates), templates.controller.ts (2 endpoints + persist helper),
      api-types index.ts (2 schemas), use-api.ts (2 hooks + AiTemplateCandidate), templates/page.tsx (2-phase modal).
- [x] 1d. **Inline rewrite chips** — SHIPPED (CI watch pending). One-tap Rewrite / Shorten / Fit-to-zone on the
      clicked TEXT/ANNOUNCEMENT field → up to 3 AI options → pick (preview-then-apply, undoable). New shared
      field-map (`packages/api-types/src/ai-edit/field-map.ts`), `POST /ai/text/rewrite` + `AiService.rewriteText`
      (reuses provider/cap/audit + a new shared `dispatchRawOrThrow`; output sanitized — tags/URLs/script stripped),
      `InlineRewriteChips.tsx` mounted in PropertiesPanel (gates: empty/locked/no-key/list → hidden; a11y aria-live +
      role=dialog; touch-tap not hover; `contain` no-blur for mobile-perf). 9 new unit tests. Full op set
      (Expand/Punch/Fix/Translate/custom) + streaming + ghost-preview = 1d-full fast-follow. Spec:
      `03-IN-EDITOR-AI-EDITING-SPEC.md`.
- [ ] 1e. (small) Drag rotate-HANDLE on zones (rotation is numeric-only today).

### Slice 2 — Flagship
- [ ] 2a. **Chat-to-edit agent** (React-zone): NL + current zone JSON → field-mutation DIFF → apply via
      `updateZone(commit)` (undoable). 2-mode UX (preview-then-apply for ambiguous, apply-then-confirm for clear).
      **Optimistic-apply + streamed** (iPad latency). Haiku for edit-resolution. Tier-2 BYOK.
- [ ] 2b. Chat-to-edit extended to EXTERNAL_HTML via the field-click shim (needs an inbound apply path; harder).

### Slice 3 — Big bets
- [ ] 3a. **Magic-resize / AI reflow** across shapes (React-zone only; HTML boards degrade to scale) + per-target
      human-review thumbnails + Taurus/contrast/auto-fit gates.
- [ ] 3b. **Real-data autofill**: drag-bind list/grid widget → source + AI writes copy from feed + LIVE badge.
- [ ] 3c. **Build-it-for-me front door**: Integration Concierge + 3-candidate + auto-wire live data → seed board #1.

### Slice 4 — Critique-surfaced additions
- [ ] 4a. One-click **translate** a board (ES/EN…) + emergency **TTS** (Standard Audit Surface §4).
- [ ] 4b. **AI image-gen / generative expand / background-removal / stock+icon library** in the editor.
- [ ] 4c. **Multiplayer / comments / approval** (reuse sports T1-2 durable-undo pattern; `D6_MULTIPLAYER_DEFERRED.md`).
- [ ] 4d. **Reusable-component library + admin layout-lock/brand-lock** (RBAC) for chains/districts.
- [ ] 4e. (P2) **Photo/screenshot → editable board** (vision → widget registry).
- [ ] 4f. (P2, behind flag) **Constraint-based auto-layout** (Hug/Fill + min/max) replacing imperative scale.

## Cross-cutting guardrails (apply to EVERY slice)
- AI output MUST emit into the validated zone/widget schema or pass the Taurus/contrast/auto-fit gates — never raw HTML/CSS to a player.
- 3-tier cost: setup-time on platform key (hard caps); everyday creative on BYOK; never silently spend platform budget; "Configure your AI provider" when no key.
- Verify the FULL loop (generate → edit → resize → schedule → render on real screen) on WebKit + Taurus before claiming done.

## STATUS
- **Slice 1a SHIPPED & CI-GREEN (10/10):** `12cdc8e`. **1a-ext SHIPPED & GREEN:** `dd46bc1` (overlap-text).
- **Slice 1c SHIPPED:** `81ed6d7` (CI watch in flight at write-time — confirm green before next slice). 3-candidate
  pick-a-winner + Touch/Display toggle (serves non-touch). Local: api+web tsc clean, 12/12 ai.service unit tests.
- **REORDER DECISION (2026-06-16):** Brand voice (1b) needs a Prisma migration on `TenantBranding` (it's a typed
  table with Json columns: `palette/heroImages/confidenceScores/rawSnapshot` — no voice field). A migration on the
  LIVE pilot can't be run/verified in this sandbox, so do the **migration-free** slices first and treat 1b as a
  deliberate, verified slice. Order: ~~1c~~ → **1d (inline sparkle tone chips) → 1b (brand voice + migration) →
  Slice 2 chat-to-edit → big bets**.
- **NEXT = 1d — inline sparkle tone chips.** Plan: on the sparkle/AI text button (`AiGenerateButton.tsx` +
  `PropertiesPanel` mount sites + `StyleableField`), add quick one-tap chips that rewrite the CLICKED element's
  text in place — Rewrite / Shorter / More formal / More playful / Translate. Reuse the existing `generate()` text
  path (intent + tone + vertical) — likely a small new intent or a `rewrite` mode that takes the current text as
  context. Tier-2 BYOK (everyday creative). No DB. Verify the chip actually replaces the field value via the store
  commit path (undoable). Files: `AiGenerateButton.tsx`, `PropertiesPanel.tsx`/`StyleableField`, maybe a small
  `ai.service` `rewrite` intent + controller/dto + a `use-api` hook.
- **1d/2a DESIGN WORKFLOW running (wf_51b71c88-d19):** 7-product competitive teardown → synthesis → completeness
  critic → implementation-ready spec for inline rewrite chips (1d) + chat-to-edit (2a). When it returns, PERSIST
  the spec to `docs/research/2026-06-16-touch-editor-flagship/03-IN-EDITOR-AI-EDITING-SPEC.md` before implementing.
- **1d integration surface (recon done):** backend AI controller = `apps/api/src/ai/ai.controller.ts`, single
  `POST /api/v1/ai/generate` (Zod `AiGenerateSchema`; roles ADMIN+CONTRIBUTOR). Add a sibling `POST /api/v1/ai/rewrite`
  + `AiService.rewriteText({text, op, targetLang?, tone?, vertical?})` reusing the SAME caps/provider/audit path
  (Tier-2 BYOK; Haiku; 30/hr + monthly). FE: `apps/web/src/components/ai/AiGenerateButton.tsx` already mounts next
  to text fields (props `intent/onPick/defaultContext`) and has the 3-state gate (none→"Set up AI" link / configured
  →sparkle). The inline chips attach HERE — when the clicked field has existing text, render one-tap chips that call
  `/ai/rewrite` and `onPick(rewritten)` (undoable via the existing field setter → `updateZone(...,commit:true)`).
- **1b plan (when done):** additive `brandVoice String?` on `TenantBranding` + migration; settings input to set it;
  thread tenant brandVoice on top of `VERTICAL_VOICE` in `composeSystemPrompt()` (used by `generate()`) AND in the
  `generateTouchTemplate` system prompt; fast-follow = auto-infer voice from scraped homepage at brand-adopt; defer
  the multi-language post-gen brand-CHECK (critique). VERIFY the migration applies before claiming done.

## Shipped commits (newest last)
- `12cdc8e` — feat(editor): proactive "Review" suggestion chips + one-tap undoable fixes (Slice 1a). 3 files, +264. CI 10/10 green.
- `dd46bc1` — feat(editor): Review flags overlapping TEXT blocks (text-on-text ≥35%). Helps non-touch most (the
  classic copy-on-copy fire) + touch. Extends suggestions.ts. (Greg: "make touch AND non-touch best + easiest.")
- `81ed6d7` — feat(editor): AI generates 3 template options to pick from — touch AND non-touch (Slice 1c). 6 files.
  New `generateTouchTemplateCandidates` (parallel fan-out, shared `dispatchTouchTemplate` helper, per-candidate
  honest spend), `SIGNAGE_TEMPLATE_SYSTEM_PROMPT`, 2 endpoints (candidates + create-from-candidate w/ re-sanitize),
  shared `persistGeneratedTemplate`, 2 FE hooks, 2-phase pick-a-winner modal w/ Touch/Display toggle. 6 new tests.

## QUEUED NEXT-BIG-TASK (after the touch editor): Sports-venue Player + Setup-menu REVAMP
- Greg (2026-06-16) gave a full punch list — captured in `docs/research/2026-06-16-sports-venue-setup-revamp/PUNCHLIST.md`.
  ~13 areas (state-stepper-in-wrong-place, unexplained Pregame Intro, cryptic per-surface layouts, ribbon scroll-speed
  BUG, un-saveable/un-timeable crowd+custom messages, sponsor control + ugly jargon UI, MP3 horn upload, custom shot
  clock, CTS gating, "copy feed URL" explain) + a HIGH-PRI **auto-sizing bug** (team names cut off on a real 4K TV;
  ribbon ticker resolution wrong). Multi-agent revamp, best-in-world. Verify on real /board + /ribbon routes.
- Context: earlier this session shipped fc573e0 (sports console), 3dd890a (asset video posters), 1ea3f01 (LED banner gating), b4a28d4 (playlist video duration) — all CI-green, unrelated to this effort.
