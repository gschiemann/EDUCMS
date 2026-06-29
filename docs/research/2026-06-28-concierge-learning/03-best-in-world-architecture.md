I have everything I need. Let me write the comprehensive report. I have code-verified the entire generation pipeline, the exact injection points, the data model (additive-only constraints), and the competitive landscape.

---

# Continuous-Learning Architecture for the VenueOS AI Signage Builder
**No-model-training design — in-context learning + preference-ranked exemplars + a Postgres-computable bandit**

Research agent, 2026-06-28. Read-only, code-verified. Live pilot in prod — all schema proposals below are **additive only** (new tables/columns, no alters/drops).

---

## 0. TL;DR — the recommendation in three sentences

We never train a model. We make every generation better by (a) **retrieving a handful of proven, kept-and-published boards** for the operator's `(vertical, purpose)` and pasting their *structure + copy patterns* into the art-director prompt as few-shot exemplars, and (b) **biasing the archetype×theme pick** with a smoothed/Thompson win-rate computed entirely in Postgres from a new append-only `signage_generation_event` table. The single privacy line: **structure/archetype/theme preferences are learned GLOBALLY across all tenants; verbatim copy and brand stay PER-TENANT.**

**The highest-leverage first slice, shippable now:** add the `signage_generation_event` event table + log a row at the two existing decision points (`generateSignageBoardCandidates` = "offered", `create-from-candidate` = "kept"), then feed a **smoothed per-`(vertical, purpose)` archetype×theme win-rate** into the existing `signageCandidateDirectives` / affinity-fallback at `ai.service.ts:2356`. This requires no new LLM call, no ML infra, and immediately replaces the *static, hand-guessed* `VERTICAL_DESIGN_AFFINITY` order (`packages/api-types/src/verticals.ts:717`) with the order customers actually keep.

---

## 1. What exists today (code-verified) — the substrate we build on

The whole AI-signage pipeline is unusually well-suited to this because the LLM is already constrained to a *tiny, structured vocabulary* — the "art director" emits an `ArtDirectorSpec` (archetype name + theme name + copy + image plan), never geometry/hex/sizes. That spec is the perfect unit to learn over.

### 1.1 The generation flow and its two natural decision points

| Step | Code location | What happens | Signal it implies |
|---|---|---|---|
| Operator describes a board (chat or wizard) | `signage-concierge.ts` `buildConciergeSystemPrompt`, `ai.service.ts:1240 conciergeChat` | Intake → `purpose`, `theme`, `palette`, `background`, `widgets`, `brief` | the **request** (vertical, purpose) |
| Fan out 3 candidates | `ai.service.ts:2281 generateSignageBoardCandidates` → `:2356 signageCandidateDirectives(vertical,count)` → `:2132 buildSignageBoardCore` per take | Each take biased to a different archetype family from `VERTICAL_DESIGN_AFFINITY` | **OFFERED** — N candidates, each with `{archetype, theme}` |
| LLM picks archetype+theme | `buildSignageBoardCore` `ai.service.ts:2167 dispatchRawOrThrow` → `parseArtDirectorSpec` with affinity fallback (`:2181`) | Model returns a spec; garbled picks fall back to `affinity.archetypes[0]` | the model's pick |
| Operator picks a winner & saves | `templates.controller.ts:1106 create-from-candidate` → `persistGeneratedTemplate` | One candidate becomes a `Template` row | **KEPT** (this is the gold "winning board" signal) |
| Operator edits via chat | `ai.service.ts:2588 refineSignageBoard` (audit `AI_CHAT_EDIT` / `AI_SIGNAGE_BOARD_REFINED`) | Delta-prompt patches the spec | **post-keep churn** (low churn = strong win) |
| Board goes on a screen | `Schedule` model (`schema.prisma:1062`), links `playlistId`→`templateId`→`screenId`/`screenGroupId` | Template actually plays on glass | **PUBLISHED** (the strongest signal of all) |

### 1.2 The exact injection points (this is what makes the build small)

- **Prompt assembly** is centralized in `buildSignageBoardCore` (`ai.service.ts:2156–2165`). Today the user prompt is: operator description + vertical + canvas + `affinityHint` + `directive`. **There are ZERO data-driven exemplars** — the only "examples" are the *hand-written* `GOLD:` strings in `VERTICAL_VOICE` (`ai.service.ts:193–220`). That single `userPrompt` array is where a retrieved-exemplar block drops in.
- **Archetype/theme selection** has TWO bias surfaces that already exist:
  1. `signageCandidateDirectives(vertical, count)` (`ai.service.ts:2356`) — picks which archetype family each of the 3 takes leans toward.
  2. The deterministic fallback `parseArtDirectorSpec(parsedJson, { archetype: affinity.archetypes[0], theme: affinity.themes[0] })` (`ai.service.ts:2181`).
  Both read from the **static, hand-authored** `VERTICAL_DESIGN_AFFINITY` map. **Replacing the *order* of that list with a learned win-rate is the cheapest possible learning hook** — no prompt change, no new call.

### 1.3 What is NOT there yet (the greenfield)

Grep confirms: **no exemplar pool, no retrieval, no preference store, no bandit, no win-rate** anywhere in `apps/api/src` or `packages` (only an unrelated mention of "exemplars" in a code comment at `ai.service.ts:189`). `AuditLog` rows exist for `AI_SIGNAGE_BOARD_CANDIDATES`, `..._GENERATED`, `..._REFINED`, `TEMPLATE_CREATED via:'ai-candidate'` — but AuditLog is **explicitly the wrong store** for this (the codebase already made this exact call for `TouchEvent` at `schema.prisma:1302–1336`: audit rows are immutable/legally-significant and indexed for "what did user X do," not for "group by archetype over a date range"). We follow that precedent and add a dedicated analytics table.

### 1.4 Fixed inventory we learn *over* (small = tractable)

- **9 archetypes** (`archetypes.ts:836 ARCHETYPES`): `hero-fullbleed, split-50, lower-third-banner, stat-spotlight, three-up-grid, menu-list, poster-promo, quote-spotlight, title-cta`.
- **~14 themes** (`themes.ts`, e.g. `warm-school, neon-sports, qsr-appetite, minimal-luxury, bold-retail, clean-corporate, calm-clinic, …`).
- **12 verticals** (`verticals.ts:40 VERTICALS`).
- **7 purposes** (`signage-concierge.ts:51 PURPOSES`): `welcome, menu, promo, event, announcement, feature, photo-hero`.

The learnable cell space is `vertical × purpose × archetype × theme` ≈ `12 × 7 × 9 × 14 ≈ 10,584` cells — but the *useful* unit is the `(vertical, purpose)` arm-set of `archetype × theme` ≈ `9 × 14 = 126` arms per context, and most `(vertical,purpose)` will only ever exercise the ~4–6 archetypes their affinity allows. **This is small enough for exact Postgres aggregation forever — no ML infra, no vector DB strictly required (see §3.4).**

---

## 2. The four pillars (concrete)

### Pillar 1 — In-context learning / RAG: a pool of "winning" boards + few-shot retrieval

**Definition of a "winning" board (the quality gate for the exemplar pool).** A persisted `Template` born from `create-from-candidate` (or `generate-signage`) qualifies as an exemplar when ALL hold:
1. **Kept** — it was saved (already true for every row that path produces).
2. **Low post-edit churn** — measured as the count of `refineSignageBoard` calls + the manual-edit-distance on the spec within, say, 24h of creation, below a threshold. Low churn ⇒ the generation nailed it first try. (Churn data starts flowing once we log refine events — Pillar 2.)
3. **Published** — there exists a `Schedule` (or playlist membership) pointing a `Template` at a real `Screen`/`ScreenGroup`. This is the strongest filter and the one competitors can't fake (it means a human put it on a wall).
4. Optional positive: **dwell/survival** — still scheduled N days later (not deleted/replaced).

**What we store as the exemplar (additive table, see §6).** NOT the rendered pixels — we store the **`ArtDirectorSpec`** (the candidate already carries `spec` back to the client per `ai.service.ts:2300–2302` and `create-from-candidate` receives `candidate.spec`), plus `{vertical, purpose, archetype, theme, canvasClass, churnScore, published, keptAt}`. The spec is ~1KB of JSON, captures archetype+theme+copy-shape, and re-runs through the deterministic engine identically.

**Retrieval at generate time.** In `buildSignageBoardCore`, before building `userPrompt`, fetch the top **2–3 exemplar specs** for the request's `(vertical, purpose, canvasClass)` ranked by win-quality, and inject a block:

```
PROVEN BOARDS — these {vertical}/{purpose} boards were kept AND put on real screens by operators. 
Match their STRUCTURE and COPY RHYTHM (archetype choice, headline length, kicker style, item shape). 
Do NOT copy their wording — write fresh copy for THIS operator.
  1. archetype=poster-promo theme=bold-retail · kicker="TODAY ONLY" · headline 4 words · cta "Shop the sale"
  2. archetype=hero-fullbleed theme=minimal-luxury · kicker="NEW IN" · headline 3 words · no cta
```

This replaces the *hand-guessed* `GOLD:` lines in `VERTICAL_VOICE` with **patterns drawn from boards that actually survived** — the GOLD lines become the cold-start seed (§5), retrieval overrides them as data arrives.

**Privacy-safe abstraction (critical — see Pillar 4):** for **global** exemplars (cross-tenant), inject only the **abstracted shape** — archetype, theme, copy *lengths/structure*, kicker *pattern* (e.g. "TODAY ONLY"-style), item *shape* — **never the verbatim headline/brand of another tenant**. For **same-tenant** exemplars, the operator's own past winners *can* include verbatim copy (it's their own).

**Why this is the right "learning" and not a costume:** the exemplar pool is filtered by KEPT∧PUBLISHED∧low-churn, which is a real downstream signal a human produced; and it actually changes the next prompt. A costume version (the trap) would be "retrieve any saved template" — that includes abandoned junk and learns nothing.

### Pillar 2 — Preference signals: kept vs rejected as pairwise preference, *without* RLHF

Every `generateSignageBoardCandidates` call is a **natural A/B/C choice experiment**: 3 candidates offered, 1 kept (or 0 if all dismissed). That yields, for free:
- **Pointwise:** each `(archetype, theme)` gets an `offered++` and the winner gets `kept++`. (This drives the bandit, Pillar 3.)
- **Pairwise preference:** kept-candidate ≻ each-rejected-candidate, all within the *same context and same prompt* — the cleanest possible preference data because the only thing that varied is archetype/theme/copy. This is exactly the data RLHF *uses*, but we never train: we just **aggregate it into a Bradley-Terry-style or smoothed win-rate** and use it to *rank/select*, not to update weights.

**How to use pairwise without RLHF:** maintain per-`(vertical, purpose)` a win/loss tally per `archetype×theme` arm. The kept arm gets a win vs each shown-but-rejected arm. Convert to a strength score via either (a) simple smoothed win-rate `(wins+α)/(wins+losses+α+β)` or (b) a periodic batch Bradley-Terry solve over the pairwise matrix (a few dozen lines of SQL + a tiny iterative fit run in a cron — still no ML infra). Option (a) is enough for v1; (b) is a later refinement when one arm is rarely shown head-to-head.

**Edit-as-negative-signal.** A heavy `refineSignageBoard` / manual-edit immediately after keep is a *soft negative* on the generated spec — "kept but had to fix it." Fold it into `churnScore` (Pillar 1 gate) and *discount* the win in the bandit (a kept-but-heavily-edited board counts as e.g. 0.3 of a win). The specific thing the operator edited (e.g. always shortens the headline) is a future per-vertical prompt-tuning signal but out of scope for v1.

**The costume risk here (flag):** logging the kept candidate but NOT recording which candidates were *rejected* destroys the pairwise signal — you'd only know what won, never against what. The "offered" event MUST capture all N candidates' `{archetype, theme}` with a shared `batchId`, and the "kept" event MUST reference that `batchId` + the chosen index.

### Pillar 3 — A simple, robust bandit/ranking to pick archetype×theme — Postgres-computable, no ML infra

**Context = `(vertical, purpose, canvasClass)`. Arms = `archetype × theme` (restricted to the vertical's affinity-allowed set so we never explore nonsense like `menu-list` for worship).**

**Recommended: Thompson Sampling with a Beta-Bernoulli posterior per arm**, because it's the most robust to the cold-start + low-volume regime a launching product lives in, and it's trivially Postgres-computable:
- Each arm keeps `(wins, losses)` → posterior `Beta(α₀+wins, β₀+losses)`.
- At selection, draw one sample per arm, pick the top — or for the **3-candidate fan-out**, pick the **top-3 sampled arms** (built-in exploration: the operator sees 3 different bets, and the ones that get kept feed back). This maps *perfectly* onto the existing 3-up `signageCandidateDirectives` shape.
- Priors `α₀, β₀` are seeded from the **hand-authored `VERTICAL_DESIGN_AFFINITY` order** (rank 1 gets a higher prior) — so day-1 behavior == today's behavior, then data takes over smoothly. This is the cold-start bridge (§5).

**Where Thompson runs:** the Beta draw is `n` cheap `random()`-based draws — doable in a SQL function or a 20-line service method reading a materialized `signage_arm_stats` view. **No Redis, no Python, no model.** A `gamma`/`beta` draw can be approximated with `-ln(random())`-style transforms in SQL, or just done in Node from the `(wins, losses)` the view returns.

**Simpler fallback if you want zero randomness in v1:** a **smoothed win-rate** `score = (wins + α) / (offered + α + β)` with a small **recency half-life** (weight events by `exp(-age/τ)`) and a **minimum-exposure floor** (force any arm under K offers to the top of one candidate slot, so new archetypes get explored). This is deterministic, fully SQL, and 90% as good. **UCB1** (`winrate + c·sqrt(ln(N)/n_arm)`) is the middle option — also pure SQL — but Thompson handles the "many low-count arms" reality better. **Recommendation: ship smoothed-win-rate-with-exposure-floor first (it's the highest-leverage slice, §0), upgrade the *selection* to Thompson in phase 2 once volume justifies exploration.**

**Guardrails the bandit must respect (all already in the code):**
- Stay within `getVerticalDesignAffinity(vertical).archetypes` (so a low-data arm can't surface an off-vertical layout).
- Honor **hard guided-intake directives** — if the operator explicitly chose an archetype/theme/purpose via the concierge (`applyGuidedIntakeToSpec`, `ai.service.ts:2200`), the bandit does NOT override it (it only fills the *unspecified* dimension). The bandit informs the *default/exploration*, never the explicit user choice.
- Per-canvasClass split (landscape/portrait/ribbon/square from `classifyCanvas`) because a ribbon strip's best archetype differs.

### Pillar 4 — Per-tenant personalization vs GLOBAL learning, and the privacy line

This is the heart of the design. **Three scopes, learned in parallel, combined at read time:**

| Scope | What it learns | Stored | Used for | Privacy |
|---|---|---|---|---|
| **GLOBAL** (all tenants, per vertical×purpose) | Which **archetype×theme structure** wins | Aggregated win/loss counts; abstracted exemplar shapes (no verbatim copy/brand) | The bandit priors + cross-tenant exemplar shapes | Safe — only structural prefs cross the tenant boundary |
| **PER-TENANT** | This venue's own kept boards (incl. verbatim copy), brand palette/voice, their archetype lean | Tenant's own `signage_generation_event` rows + their own winning specs | Strongest exemplars for *this* tenant; their own copy can be reused verbatim | Stays in-tenant; never exposed to others |
| **PER-OPERATOR (optional, later)** | Individual editor's taste within a tenant | `userId` already on events | Minor re-rank | In-tenant |

**The privacy line, stated precisely (this is the rule to put in CLAUDE.md if adopted):**
> **Learn STRUCTURE globally; keep CONTENT and BRAND per-tenant.** Archetype choice, theme family, copy *length/rhythm*, kicker *pattern category*, item *shape*, and win/loss *counts* are non-identifying structural facts and may aggregate across all tenants. A tenant's verbatim headline/body/CTA text, their brand palette/logo/voice, their business name, prices, event details, and any PII never leave the tenant. Cross-tenant exemplars are injected as **abstracted shapes only**.

**Combination at read time (a simple hierarchical/empirical-Bayes shrinkage):** the per-`(vertical,purpose,arm)` score = a **blend of the tenant's own win-rate and the global win-rate, weighted by the tenant's sample size** (`w_tenant = n_tenant / (n_tenant + K)`). New tenants ride the global prior; high-volume tenants increasingly ride their own data. This is the textbook "borrow strength from the population" move and is pure SQL. It also elegantly solves cold-start per-tenant (§5).

**Why global learning is the moat:** Domino's franchise #312 benefits on day one from what franchises #1–311 (and every other QSR tenant) kept — *that* is the "they don't know how they worked without VenueOS" magic the Concierge vision (CLAUDE.md "AI Integration Concierge") is reaching for. Competitors that only personalize per-account (Canva's brand-kit injection, §4) can't do this.

---

## 3. Recommended architecture (end-to-end)

```
                         ┌──────────────────────────────────────────────────┐
   Operator describes →  │ Concierge / wizard intake (purpose, brief)        │
                         └──────────────────────────────────────────────────┘
                                          │ vertical, purpose, canvas
                                          ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │ SELECTION (Pillar 3)  signage_arm_stats view  →  Thompson/smoothed pick │
   │   arms = affinity archetypes × themes, scoped (global ⊕ tenant blend)   │
   │   → top-3 (archetype,theme) directives for the fan-out                  │
   └───────────────────────────────────────────────────────────────────────┘
                                          │ per-take directive
                                          ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │ RETRIEVAL (Pillar 1)  top 2-3 exemplar SPECS for (vertical,purpose,     │
   │   canvasClass), KEPT∧PUBLISHED∧low-churn, abstracted if cross-tenant    │
   └───────────────────────────────────────────────────────────────────────┘
                                          │ exemplar block + affinity hint
                                          ▼
   buildSignageBoardCore  →  LLM (cheap model)  →  ArtDirectorSpec  →  engine  →  candidates
                                          │
                       ┌──────────────────┴───────────────────┐
                       ▼ log OFFERED (batchId, N×{arch,theme}) │
   ┌───────────────────────────────────────────────────────────────────────┐
   │ FEEDBACK (Pillar 2)  signage_generation_event (append-only)            │
   │   OFFERED → KEPT(batchId,index) → PUBLISHED(scheduleId) → EDITED(churn)│
   └───────────────────────────────────────────────────────────────────────┘
                       ▲ nightly cron rolls events → arm_stats + exemplar gate
```

### 3.1 No new infra
- **Storage:** Postgres (Supabase) only. One append-only event table + one or two materialized/rollup views (or a small nightly cron that updates a `signage_arm_stats` summary table). Mirrors the existing `TouchEvent`/`PlaybackSample` analytics precedent (`schema.prisma:1325, 1354`) and the existing `license-reconcile.cron.ts` pattern for the rollup job.
- **Compute:** smoothed win-rate / Beta draws in SQL or a few lines of Node. No vector DB needed at this scale (§3.4).
- **LLM:** unchanged providers (BYOK + platform key); the only change is a larger prompt (+~300–600 tokens for the exemplar block; cheap on Haiku, and Anthropic ephemeral prompt-caching already noted in CLAUDE.md §3 keeps the static system block cached).

### 3.2 Multi-replica safety
Win/loss aggregation is an `INSERT`-only event log + a periodic rollup, so concurrent API replicas never contend (no read-modify-write on a counter). This satisfies CLAUDE.md §17 "in-memory caches → Redis/DB when load-bearing" — the source of truth is the DB table, not process memory.

### 3.3 Where exactly the code changes (small surface)
1. **New Prisma model** `SignageGenerationEvent` (additive) + nightly rollup to `SignageArmStat` (additive) — §6.
2. **Log OFFERED** inside `generateSignageBoardCandidates` (`ai.service.ts:2412`, where candidates are assembled) — one `createMany` of N rows sharing a `batchId`.
3. **Log KEPT** inside `create-from-candidate` (`templates.controller.ts:1186`, next to the existing `audit(...)`) — one row referencing `batchId` + chosen archetype/theme + new `templateId`.
4. **Log PUBLISHED** wherever a `Schedule` is created for an AI-born template (schedules controller) — set `published=true` on a follow-up event, or a nightly cron that joins `Template(via:'ai-candidate') ⋈ Schedule`.
5. **Bias selection** in `signageCandidateDirectives`/`buildSignageBoardCore` to read `SignageArmStat` (blend global⊕tenant) instead of static affinity order.
6. **Inject exemplars** in `buildSignageBoardCore` `userPrompt` array (`ai.service.ts:2156`).

### 3.4 On vector retrieval (deliberately deferred)
For v1, retrieval is a **structured filter + ORDER BY win-quality** on `(vertical, purpose, canvasClass)` — no embeddings needed, because the retrieval key is categorical, not semantic. A vector/embedding step only earns its keep later, to retrieve by *prompt similarity* ("operator describing a Friday fish-fry" → nearest kept boards regardless of declared purpose). Supabase has `pgvector` available, so it's an additive upgrade (embed the brief, store the vector, ANN within the `(vertical)` partition) — but **do not build it first; the categorical version captures ~80% of the value at ~10% of the cost.**

---

## 4. Competitive scan — how the leaders personalize/learn

| Product | How it "personalizes / learns" | What we can copy | Their ceiling |
|---|---|---|---|
| **Canva Magic Design / Canva AI 2.0** | Injects your **Brand Kit + your previous design history into the context window** at request time; "applies your Brand Kit automatically"; markets "learns how you create." It's **in-context personalization per account**, not model retraining. | This validates our exact Pillar-1 approach (context injection of brand + history). | **Per-account only** — no cross-customer structural learning. A new Canva user starts cold. |
| **Microsoft Designer** | "Learns from users' customizations to provide more relevant suggestions over time"; ML models trained on millions of designs; personalized recommendations. (Azure has a separate **Personalizer**, a contextual-bandit service — same family as our Pillar 3.) | Confirms a **contextual bandit** is the industry-standard mechanism for "which layout to suggest." | Mostly per-user; the cross-user learning is baked into a foundation model we can't and won't train. |
| **OptiSigns AI Designer / OptiDev.ai** | Text-to-design: "describe your vision → multiple professional designs in <30s," opens in editor to tweak. Launched **OptiDev.ai** (AI app builder) Jan-2026 and **AI Audience Intelligence**. | The <30s describe-to-design flow is exactly our Concierge target. | **No visible feedback loop** — it generates, you edit; nothing indicates kept-boards feed back into future generations. This is our wedge. |
| **Yodeck / ScreenCloud** | Large template libraries + apps; **no first-party AI-learns-from-usage** feature surfaced (they integrate Canva rather than build it). | — | They don't personalize generation at all. |

**Net competitive insight:** the leaders do **in-context per-account personalization + a contextual bandit for suggestions** — which is precisely Pillars 1 and 3. **None of them visibly does cross-customer structural learning with a verbatim-content privacy boundary.** That GLOBAL-structure / PER-TENANT-content split (Pillar 4) is the defensible, novel-for-this-category move, and it's the one that makes VenueOS get *better the more customers it has* — a real network effect on a $0 marginal AI bill.

Sources: [Canva Magic Design](https://www.canva.com/magic-design/), [Canva AI 2.0](https://www.canva.com/canva-ai/), [Canva Brand Templates + Brand Kits help](https://www.canva.com/help/create-on-brand-designs/), [Microsoft Designer (Inclusion Cloud)](https://inclusioncloud.com/insights/blog/microsoft-designer-ai/), [Azure AI Personalizer](https://learn.microsoft.com/en-us/azure/ai-services/personalizer/what-is-personalizer), [OptiSigns AI Designer](https://www.optisigns.com/post/optisigns-ai-designer-idea-design-seconds), [OptiDev.ai launch (invidis)](https://invidis.com/sixteen-nine/2026/01/14/optisigns-launches-optidev-ai-an-ai-powered-app-builder-for-digital-signage/), [Yodeck/OptiSigns/ScreenCloud comparison](https://www.softwaretestinghelp.com/yodeck-optisigns-screencloud-connectedsign-alternatives/).

---

## 5. Cold-start (the day-1 problem, solved at every layer)

| Layer | Cold-start strategy |
|---|---|
| **Bandit priors** | Seed `Beta(α₀,β₀)` per arm from the **existing hand-authored `VERTICAL_DESIGN_AFFINITY` rank** (`verticals.ts:717`). Day-1 selection == today's behavior; data only *shifts* it. Never a cold corporate-navy fallback (already a stated invariant in `buildSignageBoardCore`). |
| **Exemplar pool empty** | Fall back to the curated `VERTICAL_VOICE` `GOLD:` lines (`ai.service.ts:195–219`) as the few-shot — they're *already* hand-written exemplars. Replace one-by-one as real winners arrive (per `(vertical,purpose)`). |
| **New tenant, no own history** | Empirical-Bayes shrinkage (Pillar 4): `w_tenant=0` → rides the GLOBAL win-rate + global abstracted exemplars. They benefit from every other tenant's keeps immediately. |
| **New `(vertical,purpose)` cell with no global data** | Min-exposure floor forces under-explored arms into a candidate slot so the cell *gathers* data instead of starving; until then, affinity order. |
| **Brand-new vertical added to the product** | `NEUTRAL_DESIGN_AFFINITY` (`verticals.ts:736`) + global cross-vertical structural priors (a `poster-promo` that wins for RETAIL is a reasonable prior for a new "events" vertical). |

The whole design degrades gracefully to **exactly today's output** when every table is empty — zero regression, which matches the codebase's pervasive "best-effort, never throw, zero-regression" discipline (e.g. stock-image, brand-derive fallbacks).

---

## 6. Additive schema (Prisma sketch — new tables only, no alters)

```prisma
// Append-only. The learning substrate. Mirrors TouchEvent's "analytics, not
// audit; no FKs to Template so it survives template delete" precedent.
model SignageGenerationEvent {
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  userId        String?  @map("user_id")
  batchId       String   @map("batch_id")        // ties OFFERED rows to the KEPT row
  eventType     String   @map("event_type")      // OFFERED | KEPT | PUBLISHED | EDITED | DELETED
  vertical      String                            // denormalized for fast group-by
  purpose       String?                           // welcome|menu|promo|event|announcement|feature|photo-hero
  archetype     String
  theme         String
  canvasClass   String   @map("canvas_class")    // landscape-16-9|portrait-9-16|ultrawide-ribbon|square
  candidateIdx  Int?     @map("candidate_idx")   // which of the N in the batch
  chosen        Boolean  @default(false)          // true on the KEPT arm
  churnScore    Float?   @map("churn_score")      // refine count / edit-distance after keep
  templateId    String?  @map("template_id")     // opaque, no FK
  specShape     Json?    @map("spec_shape")       // ABSTRACTED spec (lengths/patterns), NO verbatim copy if cross-tenant exposed
  createdAt     DateTime @default(now()) @map("created_at")

  @@index([vertical, purpose, canvasClass, eventType])  // the bandit/rollup hot path
  @@index([tenantId, vertical, purpose])                // per-tenant blend
  @@index([batchId])
  @@map("signage_generation_events")
}

// Nightly rollup (cron, like license-reconcile.cron.ts). Optional: a plain
// materialized view works too. Counts only — cheap to recompute.
model SignageArmStat {
  id          String   @id @default(uuid())
  scope       String                              // 'GLOBAL' | tenantId
  vertical    String
  purpose     String?
  canvasClass String   @map("canvas_class")
  archetype   String
  theme       String
  offered     Int      @default(0)
  kept        Int      @default(0)
  published   Int      @default(0)
  weightedWins Float   @default(0)                // churn-discounted keeps
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at")

  @@unique([scope, vertical, purpose, canvasClass, archetype, theme])
  @@index([scope, vertical, purpose, canvasClass])
  @@map("signage_arm_stats")
}
```

A separate **exemplar pool** can be a view over `SignageGenerationEvent WHERE eventType='PUBLISHED' AND churnScore < threshold` joined to the stored `specShape` — no third table needed for v1.

---

## 7. Phased rollout

**Phase 0 — Instrument (1 small PR, no behavior change).** Add `SignageGenerationEvent`; log OFFERED (in `generateSignageBoardCandidates`) and KEPT (in `create-from-candidate`). Ship dark. *Outcome: data starts accumulating; nothing changes for the operator. This is the prerequisite for everything.*

**Phase 1 — THE FIRST SLICE (see §0).** Add the nightly rollup → `SignageArmStat` (GLOBAL scope), and feed a **smoothed win-rate + exposure floor** into `signageCandidateDirectives`/affinity-fallback. *Outcome: the 3-candidate archetype×theme order is now the order customers actually keep, per vertical×purpose, instead of a hand-guess. Immediately better generations, zero new LLM cost, zero new infra.*

**Phase 2 — Few-shot retrieval (Pillar 1).** Add PUBLISHED logging + churn scoring; gate the exemplar pool on KEPT∧PUBLISHED∧low-churn; inject top-2–3 abstracted exemplar shapes into `buildSignageBoardCore`'s prompt. *Outcome: copy rhythm + structure match proven winners, not the static GOLD lines.*

**Phase 3 — Per-tenant blend (Pillar 4).** Add tenant-scoped `SignageArmStat` rows + empirical-Bayes shrinkage at read time; same-tenant exemplars may use verbatim copy. *Outcome: high-volume tenants (Domino's at 50 locations) ride their own taste; everyone else borrows strength from global.*

**Phase 4 — Thompson Sampling + pairwise.** Upgrade selection from smoothed-win-rate to Beta-Bernoulli Thompson draws (top-3 for the fan-out); add the pairwise/Bradley-Terry refinement for rarely-head-to-head arms. *Outcome: principled exploration so new archetypes/themes get fair trials.*

**Phase 5 (optional) — Semantic retrieval.** `pgvector` embed the brief, ANN within the `(vertical)` partition for prompt-similar exemplars. *Outcome: retrieval by meaning, not just declared purpose.*

---

## 8. Costume risks to flag (things that LOOK like learning but don't feed back)

1. **Logging to `AuditLog` and calling it "learning."** Audit rows exist (`AI_SIGNAGE_BOARD_CANDIDATES`, `TEMPLATE_CREATED`) but nothing reads them back into generation. The codebase already drew this line for taps (`TouchEvent` comment, `schema.prisma:1308`). A dashboard that *shows* keep-rates is analytics, not learning — learning requires the rollup to *change the next prompt/selection*.
2. **Recording KEPT without recording the REJECTED candidates** (no `batchId` linking OFFERED→KEPT). You'd lose all pairwise preference and couldn't compute a true win-*rate* (only a keep count). The OFFERED event with N rows + shared `batchId` is non-negotiable.
3. **"Personalization" that's just the brand kit.** Canva-style brand-kit injection already partly exists (`tenantBrandColors`, `tenantBrandVoice`, `brandVoiceClause`). That's *theming*, not *learning what wins* — don't let it masquerade as a feedback loop.
4. **Counting KEPT as success while ignoring churn/publish.** A board kept then heavily edited, or kept-but-never-scheduled, is a *weak/negative* signal. If the win-rate counts raw keeps, the bandit will reinforce boards people saved but never used. Gate on PUBLISHED + discount by churn.
5. **The static `VERTICAL_DESIGN_AFFINITY` looking like it adapts.** It's hand-authored and never changes. If left as the sole driver, the system *appears* vertical-aware but learns nothing — Phase 1 exists precisely to make this list a *learned prior*, not a frozen guess.
6. **Cross-tenant verbatim leakage disguised as "learning from the community."** Injecting another tenant's actual headline/brand into a competitor's generation is a privacy breach wearing a learning costume. The abstraction layer (Pillar 4) is what makes global learning legitimate.
7. **Exploration with no floor → rich-get-richer lock-in.** Pure greedy win-rate will keep showing the early winner and never trial alternatives, so a genuinely-better archetype that launched late never gets data. The min-exposure floor (or Thompson's built-in exploration) is what prevents the loop from *looking* optimized while being stuck.

---

## 9. Key files (all absolute paths)

- Generation orchestration + injection points: `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/ai/ai.service.ts` (`buildSignageBoardCore` :2132, `generateSignageBoardCandidates` :2281, `signageCandidateDirectives` ref :2356, `userPrompt` assembly :2156, `VERTICAL_VOICE`/GOLD :193, `SYSTEM_PROMPTS` :156)
- Keep/persist signal: `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/templates/templates.controller.ts` (`create-from-candidate` :1106, candidate fan-out endpoint :928, `generate-signage` :1204)
- Concierge intake (purpose/theme/brief vocab): `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/ai/signage-concierge.ts` (`PURPOSES` :51, `buildConciergeSystemPrompt` :74)
- The learnable inventory: `/Users/gschiemann/Desktop/EDU CMS/packages/signage-design/src/archetypes.ts` (9 archetypes, `ARCHETYPES` :836), `/Users/gschiemann/Desktop/EDU CMS/packages/signage-design/src/themes.ts` (themes)
- Static affinity to be replaced by a learned prior: `/Users/gschiemann/Desktop/EDU CMS/packages/api-types/src/verticals.ts` (`VERTICAL_DESIGN_AFFINITY` :717, `NEUTRAL_DESIGN_AFFINITY` :736, `getVerticalDesignAffinity` :744)
- Spec→template mapper (where exemplar specs re-run identically): `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/ai/art-director.ts` (`artDirectorSpecToTemplate` :1095)
- Analytics-table precedent (NOT-audit): `/Users/gschiemann/Desktop/EDU CMS/packages/database/prisma/schema.prisma` (`TouchEvent` :1325, `PlaybackSample` :1354, `Template` :1139, `Schedule` :1062 = publish link)
- Cron precedent for the rollup job: `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/billing/license-reconcile.cron.ts`

**Single highest-leverage first slice (restated):** Phase 0 + Phase 1 — log OFFERED/KEPT to a new `signage_generation_event` table at `ai.service.ts:2412` and `templates.controller.ts:1186`, roll it nightly into a per-`(vertical, purpose, canvasClass)` smoothed win-rate, and read that to order the archetype×theme picks in `signageCandidateDirectives`/the affinity fallback (`ai.service.ts:2356`/`:2181`). It is additive-only, needs no LLM change and no ML infra, degrades to today's exact output when empty, and immediately replaces the hand-guessed affinity order with what customers actually keep.
