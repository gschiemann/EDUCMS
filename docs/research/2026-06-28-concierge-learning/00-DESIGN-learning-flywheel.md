The reports converge cleanly and the load-bearing claims check out: the candidate fan-out has no `batchId` today, `create-from-candidate`'s schema is `.passthrough()` (so additive optional fields are free), and cron infra already exists (`@Cron` in `clever-sync.cron.ts`, `license-reconcile.cron.ts`, `proof-of-play.sampler.ts`). Here is the canonical design.

---

# VenueOS AI Signage Concierge — Customer-Learning Flywheel

**The canonical design. Status: ready to build. Constraint-checked against the live-prod-pilot rules (additive-only, no model training, BYOK-aware, privacy-safe, Taurus-unaffected).**

## North star, in one paragraph

We never train a model. The Concierge gets smarter because every generation is an A/B/C choice experiment and every "keep + publish-to-screen" is a human-graded label. We capture those labels into one append-only event table, roll them up nightly in Postgres into a smoothed/bandit win-rate per `(vertical, purpose, canvasClass)` and an exemplar pool of winning specs, and inject both back at the exact three prompt seams the LLM already uses. **Structure (archetype/theme/question prefs) is learned GLOBALLY across all tenants; verbatim copy + brand stays PER-TENANT.** When the tables are empty the system emits *exactly today's output* — zero cold-start regression. The whole loop is Postgres + a nightly cron + ~300 tokens of prompt; no new infra, no model touch, Taurus rendering untouched (this is all generate-time, server-side).

---

## 1. SIGNAL SCHEMA

### 1.1 Why a new table (not AuditLog, not a Template column)

`audit_logs` has a **DB-level immutability trigger** (migrations `20260526010000`, `20260531000000`, `20260609000000` — UPDATE/DELETE blocked). Outcomes *mature over time* (`keptAt` → `publishedAt` → `wentLiveAt` → `editChurn` → `rating` arrive minutes-to-days apart), so the row must be UPDATE-able. AuditLog is therefore structurally wrong, and its `details` is a stringified JSON blob that can't be `GROUP BY archetype`-ed. We follow the in-repo precedent the codebase already chose for exactly this shape: `TouchEvent`/`PlaybackSample` — **append-mostly analytics, no FK to mutable content (so it survives a template delete), tenant-scoped, `(tenantId, createdAt)` indexed.**

Two models: an append-only **event log** (the substrate, never updated after insert) + a nightly **rollup** (counts only, cheap to recompute, idempotent). This split keeps the hot write path INSERT-only (multi-replica safe — no read-modify-write counter contention, satisfies CLAUDE.md §17).

### 1.2 The Prisma models (additive only — two new tables, zero alters)

```prisma
// ───────────────────────────────────────────────────────────────────────
// Append-only learning substrate. One row per signal. NEVER updated after
// insert EXCEPT the outcome-maturation columns on the KEPT row (publishedAt,
// wentLiveAt, deletedAt, editChurn, editCount, rating) — those are the only
// mutable fields, and they only ever transition null→value. Mirrors the
// TouchEvent/PlaybackSample precedent: analytics not audit; opaque templateId
// with NO FK so the row survives a template edit/delete; tenant-scoped.
//   schema.prisma — add after PlaybackSample (~line 1367)
// ───────────────────────────────────────────────────────────────────────
model SignageGenEvent {
  id           String   @id @default(uuid())
  tenantId     String   @map("tenant_id")
  userId       String?  @map("user_id")
  batchId      String   @map("batch_id")        // ties the N OFFERED rows to the one KEPT row
  eventType    String   @map("event_type")      // OFFERED | KEPT | PUBLISHED | WENT_LIVE | EDITED | DELETED | RATED

  // ── context (the "what was asked") — denormalized for fast GROUP BY ──
  vertical     String                            // Tenant.vertical at gen time
  purpose      String?                           // welcome|menu|promo|event|announcement|feature|photo-hero
  canvasClass  String   @map("canvas_class")    // landscape-16-9|portrait-9-16|ultrawide-ribbon|square
  surface      String                            // candidates|single|set|refine

  // ── the arm (the "what came back") ──
  archetype    String                            // ARCHETYPE_IDS member
  theme        String                            // THEMES member (or 'brand')
  candidateIdx Int?     @map("candidate_idx")   // which of N in the batch this row is
  chosen       Boolean  @default(false)          // true on the KEPT arm

  // ── maturing outcome (only set on the KEPT row, by the reconciler/edit hook) ──
  templateId   String?  @map("template_id")     // opaque, NO FK — survives delete
  publishedAt  DateTime? @map("published_at")   // first Schedule(via Playlist) targets a screen
  wentLiveAt   DateTime? @map("went_live_at")   // first PlaybackSample references it (STRONGEST +)
  deletedAt    DateTime? @map("deleted_at")     // template removed (negative)
  editChurn    Float?    @map("edit_churn")     // refine-count + zone-edit-distance after keep
  editCount    Int       @default(0) @map("edit_count")
  rating       Int?                              // -1 | +1 (thumbs) — explicit, optional UI

  // ── PER-TENANT-ONLY content (never read into a GLOBAL exemplar) ──
  specShape    Json?    @map("spec_shape")      // ABSTRACTED spec: archetype, theme, copy LENGTHS,
                                                // kicker PATTERN ('TODAY ONLY'-class), item shape — NO verbatim copy
  specVerbatim Json?    @map("spec_verbatim")   // full ArtDirectorSpec incl. copy — TENANT-PRIVATE, never cross-tenant

  createdAt    DateTime @default(now()) @map("created_at")

  @@index([vertical, purpose, canvasClass, eventType])  // GLOBAL rollup hot path
  @@index([tenantId, vertical, purpose])                // per-tenant blend + exemplars
  @@index([batchId])                                    // OFFERED↔KEPT join
  @@index([templateId])                                 // reconciler reverse-lookup
  @@map("signage_gen_events")
}

// ───────────────────────────────────────────────────────────────────────
// Nightly rollup. Counts only — fully recomputable from SignageGenEvent, so
// it is safe to TRUNCATE+rebuild every night (idempotent). scope = 'GLOBAL'
// for cross-tenant structural learning, or a tenantId for per-tenant blend.
// ───────────────────────────────────────────────────────────────────────
model SignageArmStat {
  id           String   @id @default(uuid())
  scope        String                            // 'GLOBAL' | <tenantId>
  vertical     String
  purpose      String?
  canvasClass  String   @map("canvas_class")
  archetype    String
  theme        String
  offered      Int      @default(0)
  kept         Int      @default(0)
  published    Int      @default(0)
  wentLive     Int      @default(0) @map("went_live")
  weightedWins Float    @default(0) @map("weighted_wins")  // churn-discounted, recency-decayed wins
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@unique([scope, vertical, purpose, canvasClass, archetype, theme])
  @@index([scope, vertical, purpose, canvasClass])
  @@map("signage_arm_stats")
}
```

A separate exemplar table is **not** needed: the exemplar pool is a query over `SignageGenEvent WHERE chosen AND wentLiveAt IS NOT NULL AND editChurn < τ`, ordering by win-quality, reading `specShape` (global) or `specVerbatim` (same-tenant).

### 1.3 The EXACT capture hooks (file:function — each signal, weakest→strongest)

| Signal | Hook (file:function) | What's written | Notes |
|---|---|---|---|
| **OFFERED** (the N candidates shown — *the pairwise denominator*) | `AiService.generateSignageBoardCandidates` — `apps/api/src/ai/ai.service.ts:2281`, at candidate assembly (`~:2412`) | mint `batchId = randomUUID()` (already imported `:30`); `createMany` N rows `{eventType:'OFFERED', batchId, candidateIdx, archetype, theme, vertical, purpose, canvasClass, surface:'candidates'}` + `specShape` per candidate | Also stamp `batchId` into the existing `AI_SIGNAGE_BOARD_CANDIDATES` audit (`:2393`) and **return `batchId` on each candidate** in the HTTP response. **Non-negotiable: without OFFERED you only get a keep *count*, never a win-*rate*.** Single-shot (`generateSignageBoard :1930`) and set (`generateSignageBoardSet :2439`) write one OFFERED row each (degenerate batch of 1). |
| **KEPT** (survived the picker) | `TemplatesController.createFromCandidate` — `apps/api/src/templates/templates.controller.ts:1106`, beside the existing audit at `:1186` | one row `{eventType:'KEPT', batchId, candidateIdx, chosen:true, templateId: created.id, keptAt: now}` + `specVerbatim` (tenant-private) | Requires adding `batchId` + `candidateIdx` to `TemplateCreateFromCandidateSchema` (`packages/api-types/src/index.ts:774`). The schema is already `.passthrough()` — these are additive `.optional()` fields, **no migration, no breakage**. Echo `archetype`/`theme` into the existing `TEMPLATE_CREATED` audit detail too. |
| **EDITED** (post-keep churn — *soft negative*) | `TemplatesController.replaceZones` — `templates.controller.ts:1933` (zone saves) and `update` — `:1871` (metadata); also `AiService.refineSignageBoard` — `ai.service.ts:2588` (chat refine) | `UPDATE SignageGenEvent SET editCount = editCount+1, editChurn = …, firstEditedAt ?? now WHERE templateId = :id AND chosen` | Churn = (#refine calls) + coarse zone-text-edit count. "AI board, headline rewritten 90s after keep" becomes queryable. To attribute edits, set the existing-proposed `Template.createdVia` so a non-AI edit is ignored. |
| **PUBLISHED** (a Schedule via Playlist targets a real screen) | New reconciler cron — see §2. Joins `SignageGenEvent.templateId → Playlist.templateId → Schedule` | `UPDATE … SET publishedAt = now() WHERE templateId IN (…) AND publishedAt IS NULL AND chosen` | Reconciler (not the hot schedule path) so we never touch the load-bearing manifest/schedule code. |
| **WENT_LIVE** (actually composited on an online screen — *the strongest positive*) | Same reconciler; joins `templateId → Playlist → PlaybackSample` (written by `ProofOfPlaySampler` `apps/api/src/analytics/proof-of-play.sampler.ts`) | `UPDATE … SET wentLiveAt = now() WHERE … AND wentLiveAt IS NULL AND chosen` | This is the one a competitor can't fake — a human put it on a wall and it played. |
| **DELETED / DISCARDED** (negative) | `TemplatesController.remove` — `templates.controller.ts:2026`, beside audit at `:2039` | `UPDATE … SET deletedAt = now() WHERE templateId = :id AND chosen` | Survives the cascade because there's no FK. A batch with KEPT=null (all candidates dismissed) is captured as the *absence* of a KEPT row for that `batchId`. |
| **RATED** (explicit, optional thumbs — Phase 3+) | New `PATCH /templates/:id/ai-feedback` (when a thumbs UI ships) | `UPDATE … SET rating = ±1, ratedAt = now() WHERE templateId = :id AND chosen` | Lowest priority — implicit signals (kept/published/churn) are richer and need no UI. |

**One additive column on Template** to make edits/deletes attributable: `Template.createdVia String?` (`schema.prisma:1139`), set in `persistGeneratedTemplate` (`templates.controller.ts:1303`) and the other create sites. Nullable, additive, pilot-safe. Without it, "operator rewrote the AI headline" is indistinguishable from any other edit.

---

## 2. LEARNING JOB

**Where it runs:** a new `SignageLearningCron` in `apps/api/src/analytics/` (or `ai/`), registered exactly like the existing `@Cron` services — `clever-sync.cron.ts`, `license-reconcile.cron.ts`, and `proof-of-play.sampler.ts` already prove `@nestjs/schedule` + `@Cron(CronExpression.EVERY_…)` is wired in this app. **No new infra.** Run nightly (`CronExpression.EVERY_DAY_AT_3AM`) for the rollup; run the reconciler more often (every ~15 min, piggybacking the ProofOfPlay cadence) so `publishedAt`/`wentLiveAt` mature quickly.

**Two jobs:**

### Job A — Outcome reconciler (~every 15 min, idempotent)
For all `SignageGenEvent WHERE chosen AND (publishedAt IS NULL OR wentLiveAt IS NULL)`:
- `publishedAt`: set where `templateId` appears in any `Playlist.templateId` that has an active `Schedule`.
- `wentLiveAt`: set where that playlist appears in any `PlaybackSample`.
All UPDATEs are `WHERE … IS NULL` so re-runs are no-ops (idempotent, multi-replica safe).

### Job B — Nightly rollup → `SignageArmStat` (idempotent rebuild)
Per `(scope, vertical, purpose, canvasClass, archetype, theme)`, compute from the event log:
- **offered / kept / published / wentLive** = simple counts.
- **keep-rate** = `kept / offered`. **publish-rate** = `published / kept`. **live-rate** = `wentLive / kept`. **edit-churn** = `avg(editChurn) on kept rows`.
- **weightedWins** (the bandit score's numerator) = `Σ over kept rows of  recencyDecay(age) × churnDiscount(editChurn) × outcomeWeight`, where `outcomeWeight = 1.0 if wentLive, 0.6 if published, 0.3 if only kept`, `churnDiscount = max(0.3, 1 − editChurn/κ)`, `recencyDecay = exp(−age/τ)` (half-life ~60d so a stale winner doesn't ossify the look).
- **scope rows:** one pass with `scope='GLOBAL'` (all tenants — structural only), one pass `GROUP BY tenantId` for per-tenant rows.

The **smoothed win-rate** read at generate time = `(weightedWins + α) / (offered_decayed + α + β)` with a **minimum-exposure floor**: any arm with `offered < K` is force-eligible for one candidate slot so under-explored arms gather data instead of starving (prevents rich-get-richer lock-in). Priors `α,β` are **seeded from the hand-authored `VERTICAL_DESIGN_AFFINITY` rank** (`packages/api-types/src/verticals.ts:717`) so an empty cell scores *exactly* today's order.

**Exemplar pool** (also computed here, materialized as a small `scope/vertical/purpose/canvasClass → top-3 specShape[]` cache, or queried live): `WHERE chosen AND wentLiveAt IS NOT NULL AND editChurn < τ` ORDER BY `weightedWins DESC` LIMIT 3.

---

## 3. RETRIEVAL + FEW-SHOT (generate-time injection)

Three seams, in **highest-leverage / lowest-cost order**. All ride the *variable* (user-prompt / per-turn) side — `ART_DIRECTOR_SYSTEM_PROMPT` (`ai.service.ts:3455`) and the capability/integration blocks stay byte-stable so Anthropic ephemeral prompt-caching keeps working.

### (b) Learned archetype×theme BIAS — **do this first; zero token cost**
`VERTICAL_DESIGN_AFFINITY` is *already* the exact learned shape (`{archetypes[], themes[]}`, ordered, [0]=default) and is *already* consumed at four seams: the soft `affinityHint` (`ai.service.ts:2152`), the deterministic parse fallback (`:2181`), `signageCandidateDirectives` (`:4099`), and SET mode (`:2501`,`:2640`). **Re-rank inside `getVerticalDesignAffinity`** (`packages/api-types/src/verticals.ts:744`) and every seam benefits for free.

- Wiring: add an optional overload `getVerticalDesignAffinity(vertical, learned?)` — `api-types` stays Prisma-free (its design constraint, comment `verticals.ts:708`); the service fetches the learned re-rank (purpose from `opts.intake?.purpose`, already threaded via `coreOpts :2357`) and passes it in.
- Blend: `rank = α·learnedScore + (1−α)·curatedRank`, `α = samples/(samples+K)`. At `samples=0`, `α=0` → today's order **exactly**.
- Guards: (1) confidence gate — below min samples, return curated unchanged; (2) require a strong margin to move slot [0] (it drives the deterministic fallback); (3) **top-3 must stay 3 distinct archetypes** so the fan-out doesn't collapse to clones.
- **Token cost: ZERO** — it only re-orders strings already interpolated into `affinityHint`.

### (a) Few-shot exemplars — "boards customers loved like this"
Inject in `buildSignageBoardCore`'s `userPrompt` array, **after `affinityHint` (`ai.service.ts:2161`)**, before the per-candidate `directive` (`:2162`). Express exemplars in the **ArtDirectorSpec vocabulary the model already emits** (`{archetype, theme, copy:{kicker,headline length,...}, accentSlot}`) — never zone geometry/hex (engine owns those).

```
PROVEN BOARDS — these {vertical}/{purpose} boards were kept AND put on real screens
by operators. Match their STRUCTURE and COPY RHYTHM (archetype, headline length,
kicker style, item shape). Do NOT copy wording — write fresh copy for THIS operator.
  1. archetype=poster-promo theme=bold-retail · kicker="TODAY ONLY" · headline 4 words · cta "Shop the sale"
  2. archetype=hero-fullbleed theme=minimal-luxury · kicker="NEW IN" · headline 3 words · no cta
```

- **Token budget: cap at 1–2 exemplars (~150–300 input tokens)** against the 900-token *output* budget — negligible on input.
- **Scope rule (privacy):** GLOBAL exemplars inject `specShape` only (abstracted lengths/patterns, no verbatim). Same-tenant exemplars may inject `specVerbatim` (it's the operator's own copy).
- **Cold-start:** below the win-quality threshold, omit the block → falls back to the hand-written `GOLD:` lines in `VERTICAL_VOICE` (`ai.service.ts:195`), which are already strong.
- **Diversity guard:** inject as *inspiration*, not a template — keep each candidate's archetype driven by its per-take directive, or all 3 candidates become the same loved board and "pick your favorite" dies.

### Injection at the candidate level
`signageCandidateDirectives(vertical, count)` (`:4099`) reads `aff.archetypes[0..2]` for the 3 takes — once (b) re-ranks the affinity, the fan-out *automatically* leads with learned winners while preserving the balanced/bold/info-forward diversity.

---

## 4. CONCIERGE QUESTION-LEARNING

**Goal:** ask fewer, better questions — learn which intake fields, when filled, correlate with a kept-and-published board, and prioritize those questions.

- **Capture:** `AI_CONCIERGE_CHAT` (`ai.service.ts:1359`) already logs `ready` + `turns`. Add the **derived `intake` field-set** (which slots were filled — `purpose/theme/menu/eventDate/cta/...`, NOT verbatim values → PII-safe) and a `conciergeBatchId` that threads through to the generated candidates' `batchId`. That join — "which fields were filled before `ready=true`" ↔ "board kept+published with low churn" — is the learning signal. (This thread is the only new linkage; everything else reuses existing rows.)
- **Rollup:** a per-`(vertical[,purpose])` **field-lift** score = correlation of "field was asked/filled" with the cheap-keep outcome. High-lift fields = the questions worth asking; low-lift = questions to drop.
- **Inject:** in `buildConciergeSystemPrompt` (`apps/api/src/ai/signage-concierge.ts:74`), add a `LEARNED QUESTION PLAYBOOK` block right after `HOW TO INTERVIEW` (`:117`), via a helper that returns `''` when thin (mirrors `buildReferenceContext :151`). Caller change at `ai.service.ts:1316`.
- **Token budget — tightest of the three:** concierge runs the *cheapest* model at `CONCIERGE_MAX_TOKENS=1100` total (reply + re-derived intake + brief). **Cap at 3–5 one-line items (~60–100 input tokens).** Express as "operators in {vertical} most need to be asked: …" — bias *which* question, not add turns. Never push exemplar boards here (that's the generate surface).
- **Cold-start:** thin → helper returns `''`; the existing generic interviewer (`:110`) carries it. Key **vertical-first** (purpose unknown on turn 1), refine by purpose once `intake.purpose` is set. A brand-new vertical inherits nothing → clean no-op.

---

## 5. METRICS — the dashboard that PROVES it's getting smarter

A SUPER_ADMIN query set (cross-tenant uses GLOBAL/abstracted data only). The thesis to prove: **for a fixed `(vertical, purpose)`, keep-rate ↑, publish-rate ↑, edit-churn ↓, time-to-keep ↓ over successive weekly cohorts.**

```sql
-- M1 — THE headline: weekly keep-rate & publish-rate trend per vertical×purpose.
-- If learning works, these lines slope UP over time.
SELECT date_trunc('week', o.created_at) AS wk, e.vertical, e.purpose,
       count(*) FILTER (WHERE e.event_type='OFFERED')/3.0          AS batches,
       count(*) FILTER (WHERE e.chosen)::float
         / NULLIF(count(DISTINCT e.batch_id),0)                    AS keep_rate,
       count(*) FILTER (WHERE e.published_at IS NOT NULL)::float
         / NULLIF(count(*) FILTER (WHERE e.chosen),0)              AS publish_rate,
       count(*) FILTER (WHERE e.went_live_at IS NOT NULL)::float
         / NULLIF(count(*) FILTER (WHERE e.chosen),0)              AS live_rate
FROM signage_gen_events e JOIN signage_gen_events o USING (batch_id)
GROUP BY 1,2,3 ORDER BY 1;

-- M2 — Edit-churn after keep, weekly. Should slope DOWN (boards need less rework).
SELECT date_trunc('week', created_at) AS wk, vertical, purpose,
       avg(edit_churn) AS avg_churn, percentile_cont(0.5) WITHIN GROUP (ORDER BY edit_churn) AS median_churn
FROM signage_gen_events WHERE chosen GROUP BY 1,2,3 ORDER BY 1;

-- M3 — Bandit convergence: is the win-rate spread widening (the model is finding
-- clear winners) or flat (no signal)? Top arm's weightedWins / mean, per context.
SELECT vertical, purpose, canvas_class,
       max(weighted_wins) / NULLIF(avg(weighted_wins),0) AS top_arm_lift, count(*) AS arms
FROM signage_arm_stats WHERE scope='GLOBAL' GROUP BY 1,2,3 ORDER BY top_arm_lift DESC;

-- M4 — Cold-start guard: % of generations where learned data was actually used
-- vs fell back to curated affinity. Proves the loop is live, not a costume.
-- (requires logging an 'usedLearned' boolean on OFFERED rows — additive)

-- M5 — Per-tenant lift: do high-volume tenants' own win-rates beat the global
-- baseline (proof the per-tenant blend earns its keep)?
SELECT scope, vertical, purpose, sum(kept)::float/NULLIF(sum(offered),0) AS keep_rate
FROM signage_arm_stats WHERE scope!='GLOBAL' GROUP BY 1,2,3;
```

Surface M1+M2 as two trend lines on an internal `/admin/ai-quality` page. **The product is "smarter" iff M1 slopes up and M2 slopes down for the same context over weeks** — and M4 proves those gains came from learned data, not noise.

---

## 6. PHASED PLAN

### Phase 0 — **"Log OFFERED + KEPT"** (shippable THIS session; additive; dark)

The single highest-leverage slice. No behavior change, no LLM change, no infra — it just starts the data flowing, which is the prerequisite for everything. Files to touch:

**Implementation checklist:**
1. `packages/database/prisma/schema.prisma` — add `model SignageGenEvent` (§1.2) after `PlaybackSample` (~:1367). Add `createdVia String?` to `Template` (:1139). *(Defer `SignageArmStat` to Phase 1.)* Run `pnpm db:generate`. **Additive only — additive nullable columns + new table; no migration risk on the pilot.**
2. `packages/api-types/src/index.ts:774` — add `batchId: z.string().optional()` and `candidateIdx: z.number().optional()` to `TemplateCreateFromCandidateSchema` (already `.passthrough()`, so additive).
3. `apps/api/src/ai/ai.service.ts:2281` (`generateSignageBoardCandidates`) — mint `batchId = randomUUID()` (import present `:30`); at candidate assembly (~:2412) `prisma.signageGenEvent.createMany` N OFFERED rows + attach `batchId` to each returned candidate. Compute `canvasClass` via the existing `classifyCanvas`. Wrap in `.catch(()=>{})` (best-effort, never block a generation — matches the codebase's audit-write discipline).
4. `apps/api/src/templates/templates.controller.ts:1106` (`createFromCandidate`) — read `body.batchId`/`body.candidateIdx`; write one KEPT row with `templateId: created.id`, `chosen:true`, `specVerbatim`. Set `created.createdVia='ai-candidate'`. Best-effort.
5. Single-shot/set paths (`ai.service.ts:1930`/`2439`) — write a degenerate OFFERED+KEPT pair so those surfaces aren't blind.
6. **Verify:** generate 3 candidates in the live builder, keep one, then `SELECT event_type, batch_id, archetype, theme, chosen FROM signage_gen_events ORDER BY created_at DESC LIMIT 8;` — confirm 3 OFFERED + 1 KEPT sharing a `batch_id`. (Use the `mcp__postgres__query` tool against the pilot DB, read-only.)
7. Preflight (`pnpm preflight`), push, **watch CI to green** (the standing rule), do NOT claim done before green.

After Phase 0, data accrues for days while you build Phase 1 — by the time the bandit reads it, there's signal.

### Phase 1 — **Learned affinity re-rank** (the first *visible* win; zero token cost)
Add `SignageArmStat` + `SignageLearningCron` (nightly rollup, §2 Job B, GLOBAL scope). Re-rank in `getVerticalDesignAffinity` (§3b). Now the 3-candidate order is what customers keep, per vertical×purpose, not a hand-guess. Add the reconciler (Job A) so `publishedAt`/`wentLiveAt` mature.

### Phase 2 — **Few-shot exemplars** (§3a). Gate on KEPT∧WENT_LIVE∧low-churn; inject 1–2 abstracted shapes. Add EDITED churn capture (hook §1.3).

### Phase 3 — **Per-tenant blend** (§4 Pillar). Tenant-scoped `SignageArmStat` rows + empirical-Bayes shrinkage `w_tenant = n/(n+K)`; same-tenant exemplars use `specVerbatim`.

### Phase 4 — **Concierge question-learning** (§4) + **Thompson sampling** upgrade of the selection (Beta-Bernoulli draws, top-3 for the fan-out) + pairwise Bradley-Terry for rarely-head-to-head arms.

### Phase 5 (optional) — **Semantic retrieval** via `pgvector` (already in Supabase): embed the brief, ANN within the `(vertical)` partition. Captures the last ~20% — do not build first.

---

## 7. COSTUME RISKS — things that LOOK like learning but don't feed back

| # | The costume | Why it's fake | How this design kills it |
|---|---|---|---|
| 1 | **Logging to AuditLog and calling it learning** | Audit rows exist (`AI_SIGNAGE_BOARD_CANDIDATES`, `TEMPLATE_CREATED`) but **nothing reads them back into a prompt or selection.** A dashboard is analytics, not learning. | The rollup *must* feed §3's injection seams. The acceptance test for "learning is live" is M4: a measurable % of generations where learned data changed the output. |
| 2 | **KEPT without OFFERED** (no `batchId` linking the slate) | You'd have a keep *count*, never a win-*rate*, and zero pairwise preference (kept ≻ rejected). | OFFERED writes N rows with a shared `batchId` *before* the keep; the keep references it. Phase 0 makes this the very first thing built. |
| 3 | **Counting raw KEPT as success** | A board kept then heavily rewritten, or kept-but-never-scheduled, is a *weak/negative* signal. Reinforcing raw keeps trains the loop to please the picker, not the wall. | `weightedWins` gates on PUBLISHED/WENT_LIVE and discounts by `editChurn`. The strongest weight (1.0) requires a `PlaybackSample` — a human put it on a screen. |
| 4 | **"Personalization" that's just the brand kit** | Injecting `tenantBrandColors`/`tenantBrandVoice` is *theming*, not learning *what wins*. Easy to mistake for a feedback loop. | Brand injection stays where it is; the flywheel is a *separate* archetype/theme/copy-rhythm signal sourced from outcomes, measured by M1–M3. |
| 5 | **Static `VERTICAL_DESIGN_AFFINITY` that looks adaptive** | Hand-authored, never changes. The system *appears* vertical-aware but learns nothing. | §3b turns it into a *learned prior* via `getVerticalDesignAffinity` re-rank; M3 (top-arm lift) proves the order is moving off the seed. |
| 6 | **Cross-tenant verbatim leakage disguised as "community learning"** | Injecting another tenant's actual headline/brand/price into a competitor's board is a privacy breach in a learning costume. | The hard line: GLOBAL reads `specShape` (abstracted lengths/patterns only); `specVerbatim` is tenant-private and only ever read for same-tenant exemplars. Enforced at the query layer (scope='GLOBAL' never selects `specVerbatim`). |
| 7 | **Greedy win-rate → rich-get-richer lock-in** | Pure greedy keeps showing the early winner; a genuinely-better late archetype never gets data, so the loop *looks* optimized while stuck. | Minimum-exposure floor (Phase 1) / Thompson's built-in exploration (Phase 4) force under-explored arms into a slot. M3 detects a frozen distribution. |
| 8 | **Cold-start regression** (the worst footgun) | A half-built loop could degrade day-1 output vs today's strong curated affinity. | Every layer degrades to *exactly today's output* when empty: `α=0` at `samples=0` (affinity unchanged); exemplar block omitted below threshold (GOLD lines carry it); concierge playbook returns `''`. The acceptance gate: with all tables empty, generation is byte-identical to current. |
| 9 | **Edits invisible because the board isn't flagged AI-born** | Post-keep churn lands in generic `TEMPLATE_UPDATED` — indistinguishable from any edit, so the strongest negative-quality signal is lost. | `Template.createdVia` (Phase 0) makes AI boards attributable; the EDITED hook only fires for `createdVia LIKE 'ai-%'`. |

---

### Key file references (all absolute)
- Generation + injection seams: `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/ai/ai.service.ts` — `buildSignageBoardCore:2132`, `generateSignageBoardCandidates:2281`, `signageCandidateDirectives:4099`, `userPrompt:2156`, `affinityHint:2152`, parse-fallback `:2181`, `VERTICAL_VOICE`/GOLD `:193`, concierge `conciergeChatInner:1259`/audit `:1359`/`buildConciergeSystemPrompt` call `:1316`.
- Keep/persist + edit/delete hooks: `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/templates/templates.controller.ts` — `createFromCandidate:1106`, `persistGeneratedTemplate:1303`, `replaceZones:1933`, `update:1871`, `remove:2026`.
- Concierge prompt: `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/ai/signage-concierge.ts` — `buildConciergeSystemPrompt:74`, `HOW TO INTERVIEW:110`, `PURPOSES:51`.
- Learned-affinity home: `/Users/gschiemann/Desktop/EDU CMS/packages/api-types/src/verticals.ts` — `VERTICAL_DESIGN_AFFINITY:717`, `getVerticalDesignAffinity:744`.
- Schema additions + precedents: `/Users/gschiemann/Desktop/EDU CMS/packages/database/prisma/schema.prisma` — `TouchEvent:1325`, `PlaybackSample:1354`, `Template:1139`, `Schedule:1062`, `AuditLog:1098` (immutable — do NOT reuse).
- Request schema: `/Users/gschiemann/Desktop/EDU CMS/packages/api-types/src/index.ts:774` (`TemplateCreateFromCandidateSchema`, `.passthrough()`).
- Cron precedents (no new infra): `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/billing/license-reconcile.cron.ts`, `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/integrations/clever/clever-sync.cron.ts`, `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/analytics/proof-of-play.sampler.ts`.
- "Went live" gold signal: `PlaybackSample` written by `proof-of-play.sampler.ts`; join `templateId → Playlist.templateId → Schedule/PlaybackSample`.

**Single highest-leverage move, restated:** Phase 0 — add `SignageGenEvent` + `Template.createdVia`, log OFFERED at `ai.service.ts:2412` (with a shared `batchId` returned to the FE) and KEPT at `templates.controller.ts:1186`. Additive-only, no LLM change, no infra, degrades to today's exact output when empty. It is the prerequisite that converts every later phase from "plausible" to "fed by real labels."
