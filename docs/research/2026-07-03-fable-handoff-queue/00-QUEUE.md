# Fable Handoff Queue — 2026-07-03

## Opening

While waiting on your return, the lead stayed EXECUTOR-ONLY per the fence and shipped the mechanical, already-approved work: three stadium swim-meet boards landed tonight (v1 broadcast, v2 duel, v3 chase), setting a new visual bar for meet surfaces. The verified bug backlog was also worked down — version-restore staleness guard (#293), the lane-pad PATCH race (#292), the meet-results stale-closure (#294), and snapshotVersion atomicity. Everything below is GATED: it needs either your design/architecture insight or an owner decision from Greg, and none of it was touched unattended. This document is the priority-ordered queue for tomorrow's session plus Greg's morning to-do.

## Tomorrow's Fable session — priority-ordered agenda

Ordered by (unblocks-the-most-work × risk-of-getting-it-wrong). Make these first:

1. **AI output-format contract: FREEZE vs evolve (ai-format, Decision 3).** *Why this first:* it is the highest-risk, most load-bearing surface — the srcdoc/`data-*`/shim/fit-engine contract spans generation, sanitize, render, edit, refine, export, and the house-style distiller. Ruling "freeze for launch, additive-only" instantly bounds D2/D3/D4 and prevents any regression-prone unattended change. Cheap to decide, unblocks the most.
2. **CRUSH E5 strategic convergence ruling (wave-e).** *Why this first:* the plan explicitly reserves this for Greg/Fable, and it changes the *meaning* of E1's badge copy and E2/E6's target architecture. No code depends on it landing, but E1 copy does — deciding it early frames the whole Wave E surface.
3. **Sports D1 — reuse stadium language vs design fresh, incl. D1a token-module fork (sports-depth).** *Why this first:* D1a (shared stadium token module vs per-file copy) is called out as "the single biggest architectural fork" and gates whether the lane port is EXECUTOR-SAFE. Confirming D1=reuse + D1b color-flood policy unblocks the highest-ROI crowd-facing surface (track lanes).
4. **Designer-board photo model, DECISION 1 (ai-format), covering D2 + D4.** *Why this first:* one decision resolves two deferred items (persist-time vs override-time photo fill) and removes a visible dead button (D4 no-op on designer boards). Option B unifies them via the existing shim contract with no HTML mutation.
5. **E2 field-map handshake contract (wave-e).** *Why this first:* unlocks chat-to-edit on 107 packaged EXTERNAL_HTML boards (a P0 moat), but requires designing a net-new API shape + validation semantics — pure Fable judgment, self-contained once specified.
6. **Telemetry-first ordering for #268, DECISION 4 (ai-format).** *Why this first:* the cheapest, lowest-risk item and a read-only build the lead can start immediately; it must precede any D2/D3 output-quality change so every change is measurable. Decide where it lives and the launch baseline threshold.
7. **E1 badge taxonomy/copy + E4 moat-chrome placement (wave-e).** *Why this:* both are splittable — plumbing can go tonight — but the user-facing copy, panel suppression, pill placement, and auto-suggest moment are reserved UX judgment.
8. **Sports D4 crowd-visibility ranking + D2/D3/D5 mockup-first sign-off (sports-depth).** *Why this:* ranks the sprint (recommended: track lanes → leaderboard → ribbon → scorebug) and confirms which undefined surfaces (leaderboard replacements, meet ribbon, meet scorebug) enter the mockup-first loop.

---

## Brief 1 — CRUSH Wave E readiness (#283)

**Wave E is the last, strategic wave of the editor-vs-Canva CRUSH plan (A–D shipped).** 4 items promote our two real moats (live-data, publish-to-fleet) and kill the "silent 3-way capability lottery." Source of record: `docs/research/2026-07-01-launch-sprint/06-CRUSH-CANVA-PLAN.md` §Wave E + grounded lens findings in `05-EDITOR-CRUSH-LENSES.md`.

**Green-light summary:** **E3 and E6 are EXECUTOR-SAFE** (lift-and-reuse of shipped handlers/shim keys). **E1, E2, E4, E5 are NEEDS-FABLE** — each carries genuine UX/architecture judgment.

### The six items

| # | Item | Sev | Classification | One-line reason |
|---|------|-----|----------------|-----------------|
| **E1** | Capability badges per template kind (gallery + editor chip) | P0 | **NEEDS-FABLE** | Kind *derivation* is a one-expression lift, but the badge **taxonomy + copy** ("Live-data canvas" / "Designed board" / "AI board") and which no-op panels to suppress/repurpose are UX-judgment calls. |
| **E2** | Chat-to-edit on the 107 packaged EXTERNAL_HTML boards (MOAT) | P0 | **NEEDS-FABLE** | Requires designing a **new field-map handshake contract** (send discovered `data-field` map to `/ai/edit/resolve`, server emits a validated `textOverrides/_styles/imageOverrides` patch) — a new API shape + validation semantics. |
| **E3** | Publish-to-screen from inside the editor (MOAT) | P1 | **EXECUTOR-SAFE** | The `putOnScreen` handler is **fully self-contained and shipped** (create one-item playlist → `window.location.href` to the publish sheet). Lift into the toolbar and reuse verbatim; SaveStatusChip→"Put on a screen →" morph spec'd at `05-EDITOR-CRUSH-LENSES.md:353`. |
| **E4** | Promote live-data binding into editor chrome (LIVE pill + per-zone badges) (MOAT) | P1 | **NEEDS-FABLE** | "Pure display of existing state" per the plan, but **where the pill lives, badge visual language, and the auto-suggest "Connect your POS" trigger UX** are net-new moat-chrome design decisions. |
| **E5** | STRATEGIC: converge new static content on AI-designer HTML; React zones = live-data engine; de-leak "Designer (HTML)" wording | P1 | **NEEDS-FABLE** | The plan **explicitly** marks this a Greg/Fable decision (`06-CRUSH-CANVA-PLAN.md:70,78`; lens §283, §310). Positioning/convergence call gated on pending Phase-5 sign-off — not code. |
| **E6** | Element delete/blank on HTML boards (clearing a field currently resurrects default copy) | P1 | **EXECUTOR-SAFE** | Mechanical: add one `hidden`/`display:none` key to the shim's existing per-field style map + an eye/hide toggle per discovered field row. Shim already owns the DOM; ~30 lines, zero board-file edits (lens §290–293). |

> E1's *kind-derivation logic* and E4's *state-reading* are individually trivial. They're tagged NEEDS-FABLE because the **user-facing surface each produces** (badge copy, panel suppression, pill placement, badge design, auto-suggest moment) is the design judgment the fence reserves for you. Both can be **split**: green-light derivation/plumbing tonight, reserve visible chrome for tomorrow.

### Exact files each item touches

**E1 — Capability badges**
- Kind derivation (cheap, from zones): `apps/web/src/components/template-builder/BuilderShell.tsx` (single full-bleed `EXTERNAL_HTML` + `cfg.html` → AI board; `+ cfg.url` → packaged board; else widget canvas — see BuilderShell.tsx:1277)
- Editor chip render: `BuilderShell.tsx` (8-panel chrome at :555–573) + `BuilderToolbar.tsx`
- Gallery/preview badges: `apps/web/src/app/[schoolId]/templates/page.tsx` (`GalleryCard` :3175+, PRESET badge :2967, Branded badge :2871; `TemplatePreviewModal` actions :2560)
- Backend marker (optional, already recorded): `apps/api/src/templates/templates.controller.ts:1336` (`via: 'ai-designer'`)

**E2 — Chat-to-edit on packaged boards**
- Client routing (today only routes AI-html boards to refine-designer; packaged `url` boards fall through): `apps/web/src/components/ai/ChatToEditBox.tsx:107–130`
- Discovered field map source (already extracts `data-field` client-side): `apps/web/src/components/template-builder/PropertiesPanel.tsx` (`ExternalHtmlTextEditor`, ~:6775–6790; field discovery :600–636)
- Server resolve + validation: `apps/api/src/ai/ai.controller.ts:147` (`edit/resolve`), `apps/api/src/ai/ai.service.ts` (`resolveChatEdit`, `validateChatEditDiff` :1760, :5195; the "I couldn't turn that into an edit" dead-end :1771)
- Field-map schema (zero EXTERNAL_HTML entries today): `packages/api-types/src/ai-edit/field-map.ts:28` (`TEXT_FIELDS`)

**E3 — Publish from editor** (EXECUTOR-SAFE)
- Reuse source (self-contained handler): `apps/web/src/app/[schoolId]/templates/page.tsx:1052–1078` (`putOnScreen`)
- Add CTA: `apps/web/src/components/template-builder/BuilderToolbar.tsx` (:38 props, :142 SaveStatusChip cluster) + `BuilderShell.tsx:905` (`<BuilderToolbar … onSave={handleSave}>`)
- Publish sheet target already exists: `/playlists?publishPlaylist=` handler (no change needed)

**E4 — Live-data chrome**
- State (already present): `apps/web/src/components/template-builder/useBuilderStore.ts:25–27` (`meta.dataSource` NONE/CTS/POS/CUSTOM)
- Existing buried UI + POS-detection logic to reuse: `PropertiesPanel.tsx` (`TemplateProperties` :955, dataSource UI :976–1211, POS auto-detect :925–936)
- New pill/badge chrome: `BuilderShell.tsx` / `BuilderToolbar.tsx` (top bar) + per-zone badge on the canvas (`BuilderCanvas.tsx`)

**E5 — Strategic convergence** (decision, not code)
- 4-way type toggle to de-leak: `apps/web/src/app/[schoolId]/templates/page.tsx:1711–1749`
- Convergence context: `apps/api/src/ai/designer-edit-shim.ts` (V6 one-runtime), `create-designer` at `templates.controller.ts:1276`. Blocked on Phase-5 sign-off.

**E6 — Delete/blank on HTML boards** (EXECUTOR-SAFE)
- Reset-on-empty behavior to change: `PropertiesPanel.tsx:7024–7031` (`setOverride`: empty or default REMOVES override → default resurfaces)
- Shim style-map to extend with a `hidden` key: `apps/api/src/ai/designer-edit-shim.ts` (`applyTextAndStyles` / `DESIGNER_EDIT_SHIM`)
- Chat-edit parity (honor "remove the tagline"): `apps/api/src/ai/ai.service.ts:1770–1771`

### Dependency ordering

Per plan (`06-CRUSH-CANVA-PLAN.md:93`), Wave E runs after A–D. Within E:

1. **E5 first (decision gate).** Strategic ruling that changes the *meaning* of E1's badges and E2/E6's target architecture. No code depends on it landing — but E1 copy does.
2. **E1 (kind derivation) is the shared primitive.** Both E1's badges and E4's kind-aware chrome read the same derived kind. Derive once in `BuilderShell`; do the derivation early even if badge copy waits.
3. **E3 and E6 are independent leaves — ship anytime, no cross-deps.** The two the lead can start tonight.
4. **E2 depends on the field-map handshake contract** (your call) but is otherwise self-contained on the AI side; shares no files with E3.
5. **E4 depends on E1's derivation** for "is this board live?" context but is otherwise display-only.

**Suggested green-light tonight:** E3 + E6 (both EXECUTOR-SAFE, zero cross-deps) + the E1 *kind-derivation function* (plumbing only, no visible copy). Reserve E1-badges, E2, E4, E5 for tomorrow.

---

## Brief 2 — Sports default-surface visual depth (#270)

*Read-only recon. No designs proposed — decisions surfaced.*

### TL;DR context (what's true right now)
- Tonight's **StadiumMeetBoardWidget.tsx** (broadcast/duel/chase) set a new bar and is wired ONLY as a **builder/template widget** (`WidgetRenderer` case `'STADIUM_MEET_BOARD'`). It is **NOT** in the per-sport DEFAULT render path.
- The **default** board (zero template selection) is `DefaultBoardScene` in `apps/web/src/app/board/[gameId]/page.tsx`, routing to OLD-language surfaces: `SwimLaneGridWidget` / `DiveLeaderboardWidget` (SwimDiveWidgets.tsx) and `LeaderboardScene`. Those are exactly the #270 surfaces.
- The stadium proposal README is explicit: *"Port target: SwimLaneGridWidget + DefaultBoardScene visual language, NOT EXTERNAL_HTML."* So #270 = bring the stadium language INTO the defaults. #269 (parity gate, shipped) enumerates gaps as `PARITY-DEBT(<sport>)` comments — `grep -n PARITY-DEBT` in `sport-board-parity.test.tsx` is the machine-checkable backlog.

### (a) GAP LIST — NOW vs the stadium bar

**Stadium bar (from the 3 shipped scenes + mockups):** Anton display + Inter body + JetBrains Mono times; angled blue header banner; per-team **color floods/washes** on rows; medal-rank cells (gold/silver/bronze gradients); times 64–150px scaling with row height; DQ-with-dignity; record-chase footer + sponsor moment; giant watermark numeral.

| Surface | Where it lives NOW | Current look | Gap vs stadium bar |
|---|---|---|---|
| **Track lanes** | `SwimLaneGridWidget` reused via `athleteLabel:'ATHLETE / TEAM' / iconEmoji:'🏃'` config (page.tsx ~L4548) | **Fredoka** display font (SwimDiveWidgets.tsx L40), muted `#0c1830` panel rows, **8px team-color sliver** (L412), fixed 30px names, 32px mono time. | This IS the "banned muted-panel look" the README calls out. No Anton, no per-lane color flood, no medal ranks, no angled header. Track has **no lane-numbered lane-line motif**. |
| **Swim scorebug** | `ScorebugWidget` (RibbonScorebugWidgets.tsx L187) — generic broadcast bug; **no swim-specific scorebug**. | 760×150 abbr\|score / clock / score bar, Inter, flat slabs. Head-to-head team bug; **no event name, no heat, no leader/time**. | Not meet-aware at all. Decision needed on whether a *meet scorebug* is even a distinct surface. |
| **Meet ribbon tiles** | `RibbonScoreboardWidget` (generic, L90) + `CtsRibbonWidgets.tsx` (CTS fascia tiles, meet cinematics L1342+). | Generic ribbon: score-follow anchor + marquee reel, Inter. CTS tiles are their own styled set. **No meet-native ribbon.** | Nothing meet-shaped to show. "Meet ribbon tiles" is the least-defined surface — needs Fable to define what it even displays. |
| **Leaderboard (generic meet board)** | `LeaderboardScene` (page.tsx L1980) — default for XC, golf, gymnastics, cheer (`def.mode === 'LEADERBOARD'`). | Inter, indigo eyebrow, one big `#fbbf24` headline, two team-points panels. A **label-swap shell** (`meetContext()`). | `PARITY-DEBT(cross_country/golf/gymnastics/competitive_cheer)`: each "would need" its own board (finish-order ticker / hole-by-hole scorecard / per-apparatus rotation / judged-panel scores). Zero stadium language. |

**Cross-cutting gap:** default meet files use **non-stadium fonts** — SwimDiveWidgets.tsx = Fredoka; RibbonScorebugWidgets.tsx = Fredoka; StadiumMeetBoardWidget.tsx = Anton/Inter/JetBrains via `injectStadiumFonts()`. There is no shared stadium font/token module; the injector is private to that one file.

### (b) DESIGN DECISIONS FABLE MUST MAKE (before any build)

**D1 — Reuse stadium language vs design fresh per surface.** README asserts "port the stadium visual language into SwimLaneGridWidget + DefaultBoardScene." Confirm/deny as the governing rule.
- **D1a:** Extract a shared stadium token module (Anton/Inter/Mono constants + `injectStadiumFonts` + medal-rank + color-flood row helper) so lanes/leaderboard/ribbon/bug all pull from one place — or copy per-file (current convention)? **The single biggest architectural fork.**
- **D1b:** Per-team **color floods** on the default board — stadium mockups flood lanes with 5 decorative colors, but StadiumMeetBoardWidget.tsx **deliberately rejected** that as "fabricated signal" and floods only by real home/away color (L58–62). Which rule governs the defaults?

**D2 — Is "swim scorebug" a NEW distinct surface or a variant?** Today there is no meet scorebug. Decide: (i) add a meet-mode to `ScorebugWidget`, (ii) new `MeetScorebugWidget`, or (iii) declare the stadium *broadcast* scene the meet's broadcast surface and drop "swim scorebug" from #270.

**D3 — Define "meet ribbon tiles."** No agreed content. Decide what a perimeter ribbon shows during a meet (rotating event→lane→name→time→place? current-event + record chase?) before anyone can build or mock it.

**D4 — Crowd-visibility priority order.** Candidate ranking by "eyes on it during a live meet": **1) Track lanes** (highest ROI, mockups already target it) → **2) Leaderboard scene** (default for 4 sports) → **3) Meet ribbon tiles** → **4) Swim scorebug** (livestream/OBS only). Fable to confirm/reorder.

**D5 — Which surfaces need NEW HTML mockups first** (CLAUDE.md mockup-first workflow).
- **Already mocked/approved** (Greg picked 2026-07-03): the 3 stadium lane scenes → these define the track/swim lane language, so lanes may NOT need a fresh mockup (it's a port).
- **No mockup exists → need mockup-first** before build: the generic Leaderboard replacements (XC finish-ticker, golf scorecard, gymnastics rotation, cheer judged-panel), the meet ribbon, and any meet scorebug. Fable to confirm each gets the 3–5 variation loop.

### (c) EXECUTOR-SAFE vs NEEDS-FABLE

**EXECUTOR-SAFE (mechanical parity — applying an already-approved pattern):**
- Porting the **track/swim lane grid** to the stadium language IS a port of an *approved* mockup — **IF** Fable rules D1=reuse and confirms the lane grid inherits the StadiumBroadcastScene row treatment. Same "byte-faithful port" StadiumMeetBoardWidget.tsx already did.
- Swapping **Fredoka → Anton/Inter/Mono** font constants in SwimDiveWidgets.tsx / RibbonScorebugWidgets.tsx (pure token change).
- Wiring `DefaultBoardScene` to route swim/dive/track through the stadium-language grid (routing change, gated by existing parity test).

**NEEDS-FABLE (net-new visual design — mockup-first, not executor work tonight):**
- The **4 generic-leaderboard replacements** (XC/golf/gymnastics/cheer) — each a genuinely new board, flagged `PARITY-DEBT`, no mockup.
- The **meet ribbon tiles** content + look (undefined surface).
- The **meet/swim scorebug** (undefined whether it exists).
- Any decision to introduce **decorative per-lane color floods** (contradicts the shipped no-fabricated-signal rule — a design-policy call).

**Executor trap to flag:** applying stadium colors to the lane grid must NOT reintroduce fabricated per-swimmer colors — StadiumMeetBoardWidget.tsx explicitly floods only by real home/away color. Any port must inherit that constraint or it regresses a shipped decision.

### (d) EXACT FILES

Default-surface render + routing:
- `apps/web/src/app/board/[gameId]/page.tsx` — `DefaultBoardScene` (routing ~L4441–4602), `LeaderboardScene` (L1980); `meetContext()` label-swap L1568–1610.
- `apps/web/src/components/widgets/sports/SwimDiveWidgets.tsx` — `SwimLaneGridWidget` (L302), `DiveLeaderboardWidget` (L472); Fredoka `DISPLAY_FONT` L40. (Header warns "DO NOT EDIT, another agent owns this file right now" — Fable must resolve ownership before assigning.)
- `apps/web/src/components/widgets/sports/RibbonScorebugWidgets.tsx` — `RibbonScoreboardWidget` (L90), `ScorebugWidget` (L187); Fredoka `DISPLAY_FONT` L79.

The bar to match + the parity backlog:
- `apps/web/src/components/widgets/sports/StadiumMeetBoardWidget.tsx` — stadium language of record (Anton/Inter/Mono L108–129, angled header ~L383, medal/flood rows, footer). Registered builder-only: `WidgetRenderer.tsx` L679, `variants-register.ts` L1050, `PropertiesPanel.tsx` L5442.
- `apps/web/src/app/board/[gameId]/__tests__/sport-board-parity.test.tsx` — the #269 gate; `grep -n PARITY-DEBT` = the exact per-sport gap list any #270 build must satisfy.

Approved mockups (source of truth for the lane port):
- `docs/design/proposals/2026-07-02-stadium-lane/README.md` + `stadium-lane-v{1,2,3}-*.html/.png` (also in `scratch/design/`).

Secondary (meet ribbon/CTS context): `apps/web/src/components/widgets/sports/CtsRibbonWidgets.tsx` (meet cinematics L1342+).

---

## Brief 3 — AI-generation format + first-try (#282 D2-D4 / #268)

**This is the highest-risk area to touch unattended. Everything below is a DECISION surface, not a proposal to execute. Nothing in the generation-format contract, sanitizer, shim protocol, or fit-engine should be changed tonight.**

### (a) Current AI board-generation format & pipeline

There are **two** AI generation paths. The one under discussion is the **AI Designer** path (premium); the older **art-director/touch** path is the cheap/instant fallback.

**AI Designer path — what the model outputs:** the top model (BYOK GPT-5 / Claude Opus, tiered) authors a **COMPLETE, self-contained HTML document** — the entire board. System prompt = `DESIGNER_SYSTEM_PROMPT` + a worked exemplar (`DESIGNER_EXEMPLAR`). Strict contract: Taurus-83-safe CSS (longhand only, **no `inset`/`gap`**), fonts via `<link>` only, no redaction bars, contrast floors, `data-field="<key>"` on every editable text node, `data-imgslot="<key>"` + `data-photo-query="<subject>"` on every photo region, decoration layers `aria-hidden`. Generation fans out **3 candidates over 3 fixed art directions** (`DESIGNER_ART_DIRECTIONS`: full-bleed editorial / clean premium / vibrant graphic), each with a distinct `contentEmphasis` (#268 hedging).

**Persist + render:** server **sanitizes** (`sanitizeDesignerHtml` — strips guessed stock-photo URLs, Taurus audit), then **injects two runtimes**: `injectDesignerLayoutEngine` (VOS-FIT-ENGINE: deterministic auto-fit/no-overlap/no-overflow, bakes `__VOS_CW/__VOS_CH`) and `injectDesignerEditShim` (EDUCMS-SHIM-V6). Persisted as **ONE full-bleed `EXTERNAL_HTML` zone** (x:0,y:0,w:100,h:100) with HTML in `defaultConfig.html`. Rendered by `ExternalHtmlWidget` as `<iframe srcdoc={html} sandbox="allow-scripts">` — null-origin. Edits arrive via `postMessage {type:'educms-overrides', …}`; the shim applies them. Refine loop (`refine-designer`) strips runtime, asks for surgical revision, re-sanitizes + re-injects.

**Telemetry present today:** `AI_DESIGNER_CANDIDATES` audit row carries `batchId, requested, returned, provider, model, source, briefExtracted, briefUsed, briefSource, autoGrounded`. The keep (`TEMPLATE_CREATED`, via=`ai-designer`) echoes `batchId, candidateIndex, artDirection`. So the **join for first-try keep-rate already exists in the schema** (#268 item 2 landed).

### (b) What Wave D2–D4 proposes, and why it was deferred

Wave D1 (Tweak/Translate) **shipped** (`ec6434c2`). D2–D4 were deferred as "need reviewed session" — they change the generation-format contract or the photo/brand data model, exactly the fenced-off class.

| Item | Proposed change | Current reality (the gap) | Why deferred |
|---|---|---|---|
| **D2 — designer photos** | Extend `attachKeptBoardPhoto` to fill designer HTML `data-photo-query` slots with real photos. | `attachKeptBoardPhoto` only mutates **touch-engine zones + `Template.bgImage`**. The **designer create path never calls it**. Designer boards ship on gradients unless the operator uses in-editor Pexels search. `data-photo-query` is emitted but **never server-resolved**. | New persist-time image step inside the srcdoc/shim model + rehost/durability + which slots. Touches the format's image contract. |
| **D3 — brand vars in AI HTML** | Make the model emit `var(--brand-*)` so Apply-brand recolors AI boards. | AI boards use **literal hex**, so `applyBrand` is a **silent no-op**. Text/image/style edits work; **brand recolor does not**. | A **prompt-contract change** — alters every board and risks regressing fit-engine / contrast laws. Can't be A/B'd without telemetry. |
| **D4 — "Make it an AI photo" reachable on designer boards** | Make the one-tap button work on V2/designer builder. | Button calls `POST :id/regenerate-image` → writes **`Template.bgImage`** — **fully occluded** by the full-bleed EXTERNAL_HTML iframe. **No-op on designer boards.** | Fixing means routing the photo into a **`data-imgslot` override via the shim**, not `bgImage` — same image-contract decision as D2. |

**Common root:** D2 and D4 are the same decision viewed from generation-time vs edit-time: *how does a real photo get INTO a designer board's `data-imgslot`?* D3 is a separate prompt-contract decision.

### (c) OPEN decisions that genuinely need Fable

**DECISION 1 — Designer-board photo-attachment model (covers D2 + D4).** *How do real photos reach `data-imgslot` slots in a srcdoc board?*
- **Option A — Persist-time fill (server):** in `create-designer`, resolve each `data-photo-query` and bake `background-image` into the HTML. *Pros:* photo-rich instantly, durable, SW-cacheable. *Cons:* mutates authored HTML server-side (regex risk vs fit-engine markers); per-slot cost; must respect "empty slot still looks complete."
- **Option B — Override-time fill (config):** write `config.imageOverrides` keyed by slot; shim applies via `applyImages`. *Pros:* zero HTML mutation, reversible, identical to operator-edit flow; makes D4 a natural `imageOverrides` write. *Cons:* must confirm override survives export/import + player SW-cache; slot-key discovery needed server-side.
- **Option C — Defer:** keep gradients + in-editor Pexels only. *Pros:* zero format risk. *Cons:* leaves D4 a visible dead button (honesty/costume risk).
- **Recommendation:** **Option B**, and re-point D4's `regenerate-image` result into `imageOverrides[slot]` for designer boards. Reuses the shim contract, no HTML mutation, unifies D2+D4. If B can't ship cleanly, **Option C for launch** and make the D4 button *hidden* on designer boards rather than a no-op.

**DECISION 2 — Brand-variable substitution model (D3).** *Should AI boards define+use `--brand-*`?*
- **Option A — Prompt-contract change:** instruct the model to declare `:root{--brand-primary:…}` and use `var(--brand-*)`. *Pros:* Apply-brand "just works." *Cons:* changes every board; model may half-apply → **partial recolor worse than none**; interacts with contrast + fit-engine; unverifiable without telemetry.
- **Option B — Post-process normalization:** keep literal-hex authoring; server rewrites dominant palette hexes → `var(--brand-*, #fallback)` after sanitize. *Pros:* deterministic, testable, no prompt-quality regression; fallback keeps board correct. *Cons:* hex→var mapping is heuristic (which hex is "primary"?); risk of recoloring an unintended hue.
- **Option C — Defer:** Apply-brand stays scoped to non-designer boards + labeled. *Pros:* no format risk. *Cons:* silent no-op (Wave E1 badge partially covers the honesty gap).
- **Recommendation:** **Option B (post-process)** as the lower-risk path, but genuinely Fable's call — a format-contract change either way, and should land **after** Decision 4 telemetry so recolor quality is measurable. Do **not** touch `DESIGNER_SYSTEM_PROMPT` unattended.

**DECISION 3 — Output-format contract stability (the guardrail).** The contract (single EXTERNAL_HTML zone, `data-field`/`data-imgslot`, VOS-FIT-ENGINE markers, EDUCMS-SHIM-V6 protocol) is load-bearing across generate/sanitize/render/edit/refine/export and the house-style distiller (greps kept boards for `VOS-FIT-ENGINE`). **Recommendation: FREEZE for launch.** Any D2/D3 work must be additive and must not change the shim message protocol or fit-engine markers.

**DECISION 4 — Telemetry-first ordering for #268.** The `batchId` join exists but **no dashboard/query reads it yet**. Build the read-only first-try-keep-rate query BEFORE any D2/D3 output-quality change, so every change is measurable A/B-style.

### (d) The telemetry question for #268 — measure BEFORE changing anything

Everything needed is already written; nothing reads it. Before D2/D3 or any prompt change, stand up the **read-only** query/rollup:
- **First-try keep rate** = `TEMPLATE_CREATED(via='ai-designer')` where the keep's `batchId` matches an `AI_DESIGNER_CANDIDATES` batch **with zero `AI_DESIGNER_REFINE` rows between generate and keep** — segmented by `vertical`, `artDirection`, `candidateIndex`.
- **Refine-count-to-keep** distribution (0 refines = true first-try).
- **Art-direction win rate** (which of the 3 slots gets kept) — feeds #268 item 6 (adaptive slots).
- **Brief influence:** keep rate for `briefUsed:true` vs `false`, and `briefSource: client|extracted|none`.
- **Auto-ground influence:** keep rate for `autoGrounded:true` vs `false`.
- **Abandonment:** batches generated with **no** matching keep (silent misses).

Decision for Fable: **where this lives** (read-only admin query vs persisted rollup) and **what the launch baseline threshold is**. Cheapest, lowest-risk item; unblocks measuring D2/D3.

### (e) Exact code touchpoints

**Generation format / prompt contract (FREEZE — do not edit unattended):**
- `apps/api/src/ai/designer-prompt.ts` — `DESIGNER_SYSTEM_PROMPT` (:206), `DESIGNER_EXEMPLAR` (:100), `DESIGNER_ART_DIRECTIONS` (:461), `buildDesignerUserPrompt` (:286), `sanitizeDesignerHtml` (:510), `stripGuessedStockPhotos` (:481), `STOCK_PHOTO_HOST` regex (:473). **D3 lives here.**
- `apps/api/src/ai/ai.service.ts` — `generateDesignerBoardCandidates` (:2763), `refineDesignerBoard` (:2986), `deriveTenantHouseStyle` (:2545), `extractDesignerBrief` (:2617), `autoGroundContent` (:2707), `attachKeptBoardPhoto` (:3485), `resolveStockBackground` (:3441). **D2 image reuse lives here.**

**Persist / render / shim (contract surface — additive only):**
- `apps/api/src/templates/templates.controller.ts` — `create-designer` (:1276, the missing photo step for D2), `refine-designer` (:1350), `regenerate-image` (:1881, the D4 `bgImage` no-op to re-point), `attachKeptBoardPhoto` caller in create-from-candidate (:1536).
- `apps/api/src/ai/designer-edit-shim.ts` — `DESIGNER_EDIT_SHIM` / `injectDesignerEditShim` (do not change protocol).
- `apps/web/scripts/inject-shim-v2.cjs` — `applyImages` (:129, keys by `data-imgslot`), `applyBrand` (`--brand-*` — the D3 target), message handler (:135).
- `apps/web/src/components/widgets/WidgetRenderer.tsx` — `ExternalHtmlWidget` srcdoc branch (~3623), `postDesignerOverrides` forwarding.

**FE picker / editor (D1 done here; D4 button here):**
- `apps/web/src/app/[schoolId]/templates/page.tsx` — `makeAiPhoto` (:3549) + "Make it an AI photo" button (:3980) [D4], designer candidate mapping / `_designerHtml` refine dispatch [D1 shipped].
- `apps/web/src/hooks/use-api.ts` — `useRegenerateBoardImage`, `useCreateDesigner`, `useRefineDesignerBoard`.

**Telemetry read (#268 — safe first build):**
- Read-only over `AuditLog` rows `AI_DESIGNER_CANDIDATES` (details.batchId) ↔ `TEMPLATE_CREATED` (details.batchId/candidateIndex/artDirection) ↔ `AI_DESIGNER_REFINE`. No schema change needed.

### MUST NOT be changed unattended (explicit)
1. `DESIGNER_SYSTEM_PROMPT` / `DESIGNER_EXEMPLAR` / `DESIGNER_ART_DIRECTIONS` — any edit changes every board's output and can't be A/B'd without telemetry (D3 is entirely here).
2. `sanitizeDesignerHtml` + `stripGuessedStockPhotos` + Taurus audit — the security/containment boundary for AI-authored HTML in an `allow-scripts` iframe.
3. The **shim message protocol** (`educms-overrides`/`educms-field-click`/`educms-edit-mode`) and **VOS-FIT-ENGINE markers** (`__VOS_CW/CH`) — load-bearing across generate/render/edit/refine/export **and** the house-style distiller's grep.
4. The single-full-bleed-`EXTERNAL_HTML`-zone persistence shape.

**Safe to do tonight without Fable:** the **read-only #268 telemetry query** (no code-path change, no format change).

---

## Brief 4 — Greg decisions + config/secrets + a verify item

*For Fable to route fast tomorrow. Prepared overnight, read-only. Everything here is blocked on **Greg** — not on Fable's design review. Total hands-on ≈ 30–40 min, except the two VERIFY items which need a lead code-check first.*

### A · DECISIONS (product calls only Greg can make)

**D1 — #273: What happens to a CANCELLED tenant's live screens?** `[BLOCKER for Day-4 build]`
- **Blocked:** no defined behavior; the cancelled-tenant player path is unbuilt pending Greg's call. Lead can't build Day 4 without one sentence.
- **Impact:** Medium-high. Wrong default = a cancelled venue's LED either goes **blank** (violates "nothing blanks") or shows content for free. Emergency/life-safety alerts must keep working regardless.
- **Greg decides:** grace window + end-state. Lead's recommendation: **30-day grace → polite "subscription ended" board (never blank) → emergency alerts work forever.** Reply *"yes 30"* or give a number.

### B · CONFIG / SECRETS (Railway env — only Greg has the accounts)

Source: `docs/research/2026-07-01-launch-sprint/02-GREG-CONFIG-CHECKLIST.md` + `CLAUDE.md` lines 88–131. All degrade gracefully today, so these gate *going live*, not the build.

- **C1 — Rotate the 4 boot secrets (~5 min).** `[SEV-1 if skipped]` Prod runs weak human-readable secrets (`super_secure_beta_jwt_secret_2026_xYz` seen in live-test evidence). Rotate `JWT_SECRET`, `SESSION_SECRET`, `DEVICE_SECRET_KEY`, `DEVICE_JWT_SECRET` (gen: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), redeploy API at a quiet hour. Logs everyone out once (expected); screens re-pair automatically.
- **C2 — Stripe live billing (~10 min).** Two Prices ($15/screen/mo, $150/screen/yr) + LIVE secret key + webhook (`…/api/v1/billing/webhook`, events `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`) → set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `STRIPE_WEBHOOK_SECRET`. Note: a **test key is currently live in NODE_ENV=production**.
- **C3 — Email sending domain (~5 min).** `[silent-drop risk]` Verify a domain in Resend (SPF/DKIM) → set `EMAIL_FROM=VenueOS <noreply@venue-os.app>`. Until then Resend delivers **only to Greg's own inbox** — every invite, password-reset, and bug email to anyone else is silently dropped.
- **C4 — Platform AI key (~2 min).** Set a real funded `ANTHROPIC_API_KEY`. Powers only the setup-time Tier-1 Concierge (hard-capped ~50 calls/lifetime + 100/day/tenant; customer creative AI stays BYOK). Without it the sparkle/Concierge degrades to "AI not configured."
- **C5 — `PILOT_SEAT_LIMIT` (~1 min).** Set to whatever the pilot contract says.
- **C6 — (OPTIONAL, launch-week) Google OAuth (~10 min).** Only if "Connect Google" ships (#259). Create OAuth client → redirect `…/api/v1/integrations/google/callback` → send Client ID/Secret for `GOOGLE_OAUTH_*`.

*Secret-rotation cadence:* no automated rotation exists. One-time C1 covers launch; a recurring policy is a post-launch decision.

### C · VERIFY (do NOT act until a lead confirms — two traps)

**V1 — #200 & #199 are likely ALREADY DONE in code — confirm before treating as open.** `[avoid re-building fixed work]`
- **#199 passport-saml CVE-2025-54419:** Package is **fully uninstalled** — `grep passport-saml pnpm-lock.yaml` = **0 hits**, absent from every `package.json`. SAML calls fall through to a 503 stub; enable is SUPER_ADMIN-gated; **0 SAML-enabled tenants** in prod. The CVE is **not reachable today**. Now a *feature* task (migrate to `@node-saml/passport-saml@5`), NOT a launch blocker. **Greg decides:** does launch need SAML SSO at all? If no → close #199 as "gated, deferred." If yes → Fable-scoped build, not config.
- **#200 private floor-plan bucket:** Code fix is **merged** (`70caeb45`). Uploads route to a **private** `floor-plans` bucket; reads re-sign short-TTL. What remains is **operational, needs Greg's prod hands**: (1) deploy so the private bucket auto-creates on boot, (2) run the one-time migration `pnpm --filter api exec ts-node scripts/migrate-floorplans-to-private.ts` (has `--dry`; safe to re-run) to move legacy objects out of the public `assets` bucket, (3) after verifying, delete the orphaned public copies. **Greg's ask:** approve running the migration against prod (a few MB egress).
- *Recommendation:* update the task list to reflect reality so Fable doesn't re-dispatch closed work.

**V2 — UNVERIFIED single-agent claim (task_87f88b97): inset re-serialization sweep. DO NOT SWEEP YET.** `[needs lead check before any change]`
- **The claim (one background agent tonight, not reproduced):** React may serialize four *equal* physical longhands (`top/right/bottom/left: 0`) into an `inset: 0` **shorthand string in the DOM `style` attribute**. If true, the player's Chromium-83 polyfill selector `[style*="inset: 0"]` (`apps/web/src/app/player/layout.tsx:227`) would **match and force-zero all four sides** on those elements — mis-zeroing ~20+ widgets on Taurus.
- **Why plausible:** ~44 widget files write exactly those four equal-zero longhands inside inline `style={{…}}` objects (the DOM-attribute surface the selector reads). The named examples in the polyfill comment (AnimatedWelcomePortrait, StorybookCafeteria) are in that set.
- **Why NOT yet actionable (counter-evidence):** the widget authors *deliberately* chose longhands and documented it — the exact string **"longhand sides, not the inset shorthand"** appears in 8+ widget files (e.g. `AnimatedWelcomeHighWidget.tsx:712`) as a known Taurus-safety measure. That means the team's working assumption is browsers do **NOT** re-serialize longhands to the shorthand in the attribute string. The claim contradicts that without proof.
- **What the lead must verify BEFORE any sweep (2 questions, ~15 min):**
  1. Does **modern Chromium** actually re-serialize four equal longhands into `inset: 0` *in the `style` attribute string* (what an attribute selector reads) — or only in the resolved CSSOM (`getComputedStyle`), which the selector does **not** read?
  2. Does **Taurus Chromium-83** specifically do this? (Chromium 83 predates the `inset` shorthand — it may not serialize *to* a property it doesn't support, making the claim moot on the target device.)
- **Recommended check method:** load one affected widget in the player route on a Chromium-83 build (or the Taurus emulator) and inspect the literal rendered `style` attribute string; confirm whether `inset: 0` appears. If it does NOT on the real target, the claim is false and no sweep is warranted. Do not touch ~20 widget files on one unreproduced report.
- **Greg's role:** none directly — flag to Fable/lead as a VERIFY-first item so no one runs a 20-file sweep tonight on an unverified claim.

---

## Greg's morning to-do

**DECISIONS**
- [ ] **D1 (#273):** One sentence on cancelled-tenant screens. Recommended: reply *"yes 30"* (30-day grace → "subscription ended" board, never blank → emergency alerts forever). `[BLOCKER for Day-4 build]`
- [ ] **V1 / #199:** Decide — does launch need SAML SSO at all? If no → close #199 "gated, deferred." If yes → hand to Fable as a build (not config).

**CONFIG / SECRETS (Railway env)**
- [ ] **C1** — Rotate the 4 boot secrets (`JWT_SECRET`, `SESSION_SECRET`, `DEVICE_SECRET_KEY`, `DEVICE_JWT_SECRET`), redeploy at a quiet hour. `[SEV-1 if skipped]`
- [ ] **C2** — Stripe live billing: 2 Prices + LIVE key + webhook → `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `STRIPE_WEBHOOK_SECRET` (a test key is currently live in production).
- [ ] **C3** — Verify a Resend domain (SPF/DKIM) → `EMAIL_FROM=VenueOS <noreply@venue-os.app>` (else all mail to non-Greg addresses is silently dropped).
- [ ] **C4** — Set a funded `ANTHROPIC_API_KEY` (setup-time Concierge only).
- [ ] **C5** — Set `PILOT_SEAT_LIMIT` to the pilot contract number.
- [ ] **C6** — (Optional, launch-week) Google OAuth client + `GOOGLE_OAUTH_*`, only if #259 "Connect Google" ships.

**VERIFY (Greg's prod hands / approval)**
- [ ] **V1 / #200:** Approve running the floor-plan migration against prod (`scripts/migrate-floorplans-to-private.ts`, a few MB egress): deploy → run migration (`--dry` first) → delete orphaned public copies after verifying.
- [ ] **V2:** No direct Greg action — ensure the lead runs the Chromium-83 `inset: 0` verification BEFORE anyone sweeps the ~20 widget files; do not authorize the sweep on the unverified claim.
