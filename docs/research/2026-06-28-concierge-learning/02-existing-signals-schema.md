I now have full code-verified coverage. The key constraint for schema design: `audit_logs` has a DB-level immutability trigger (UPDATE/DELETE blocked), so AuditLog cannot be used for an outcome row that needs later updates (publishedAt, deletedAt, rating, editDistanceAfterKeep arrive over time). That mandates a new mutable table. I have all the facts needed for the report.

---

# Signal Inventory & Additive Schema Proposal — "Was the generated board GOOD?"

## (a) Does anything today record candidate selection, ratings, thumbs, or post-generation edit-distance?

**No. None of these signals are captured anywhere in the codebase.** Code-verified:

- **Candidate selection (`chosenIndex`): NOT captured.** The 3-candidate fan-out (`generateSignageBoardCandidates`, `ai.service.ts:2300+`) returns N candidates to the browser. When the operator picks one, the browser POSTs **only that one candidate's JSON** back to `POST /templates/create-from-candidate`. The request schema (`TemplateCreateFromCandidateSchema`, `packages/api-types/src/index.ts:774-792`) carries `candidate`, `screenWidth`, `screenHeight`, `interactive`, `background` — and has **no field for which index was chosen, how many were shown, or any id tying it back to the generation event.** The link between "I generated 3" and "I kept #2" is severed at the browser boundary.
- **Ratings / thumbs: NOT captured.** Grep for `rating|thumbs|feedback|score` across `schema.prisma` and `apps/api/src` returns nothing of the kind. There is no rating UI, endpoint, or column.
- **Post-generation edit-distance: NOT captured.** Grep for `editDistance|levenshtein|diffZones|trackEdit` returns zero hits. The only edit signal that exists is `Template.updatedAt` (`schema.prisma:1194`, `@updatedAt`) — a coarse "was it touched after creation" timestamp, with no record of *what* or *how much* changed. `TEMPLATE_UPDATED` audit rows (`templates.controller.ts:47`) fire on every save but do not diff against the generated baseline.
- **No per-generation durable row at all.** Every generation writes (1) an AuditLog row (immutable, best-effort, `.catch(() => {})`) and (2) increments `Tenant.aiPlatformUsageCount` (`schema.prisma:170`). There is no `Generation` / `AiUsage` / `LlmCall` table.

## (b) Full list of AuditLog `action` values around templates / playlists / schedules / AI

`AuditLog` (`schema.prisma:1098-1117`) is an immutable, append-only table (`action` is a free String; `details` is a JSON-encoded String). Actions found in the relevant controllers/services:

**AI generation (`apps/api/src/ai/ai.service.ts`):**
| Action | Line | `details` payload (the richest existing GOOD-signal source) |
|---|---|---|
| `AI_GENERATE` | 862 | sparkle text-field generation |
| `AI_TEMPLATE_GENERATED` | 1026 | single-shot touch template |
| `AI_TEMPLATE_CANDIDATES` | 1894 | `{vertical, interactive, requested, returned, provider, model, source}` |
| `AI_SIGNAGE_BOARD_GENERATED` | 2052 | `{vertical, screenWidth, screenHeight, archetype, theme, scenes, provider, model, source, zoneCount}` |
| `AI_SIGNAGE_BOARD_CANDIDATES` | 2395 | `{vertical, requested, returned, archetypes[], provider, model, source}` |
| `AI_SIGNAGE_BOARD_SET` | 2543 | `{vertical, requested, scenes, theme, provider, model, source}` |
| `AI_SIGNAGE_BOARD_REFINED` | 2727 | chat-to-edit refine |
| `AI_IMAGE_GENERATED` | 3162 | background photo gen |
| `AI_CONCIERGE_CHAT` | 1361 | conversational intake turn |
| `AI_TEXT_REWRITE` | 1586 ; `AI_CHAT_EDIT` 1726 | |

**AI key/admin (`ai-key.controller.ts`):** `AI_KEY_SET` (267), `AI_KEY_TEST_FAILED` (238,354), `AI_KEY_MODEL_CHANGED` (370), `AI_KEY_CLEARED` (400).
**AI alt-text (`ai-alt-text.service.ts`):** `AI_ALT_TEXT_GENERATED/SKIPPED/FAILED`, `AI_DESIGN_REFERENCE_ANALYZED/SKIPPED/FAILED`.

**Templates (`templates.controller.ts:73`):** `TEMPLATE_CREATED` | `TEMPLATE_UPDATED` | `TEMPLATE_DELETED` | `TEMPLATE_IMPORTED`. The create-from-candidate path stamps `TEMPLATE_CREATED` with `details: {name, zoneCount, via:'ai-candidate', interactive, engine}` (`templates.controller.ts:1186`); generate-signage with `{via:'ai-signage', engine, withImage, archetype}` (1249).

**Playlists:** `PLAYLIST_DELETED` (`playlists.controller.ts:400`), `PLAYLIST_FLEET_PUBLISHED` (`playlist-distribution.service.ts:260`).
**Schedules (`schedules.controller.ts`):** `SUBMISSION_CREATED` (300), `SCHEDULE_AUTO_REACTIVATED` (416), `SCHEDULE_TOGGLED` (524,581), `SCHEDULE_DELETED` (629).

**Key gap:** the generation audit rows (`AI_SIGNAGE_BOARD_*`) and the persistence audit row (`TEMPLATE_CREATED via:ai-candidate`) are **two disconnected events with no shared correlation id** — you cannot reliably join "this generation" to "this template id," and you cannot reconstruct chosenIndex.

## (c) Is there a "this template went LIVE on a screen" signal? — YES, and it is the strongest positive outcome we can read today.

The chain exists and is fully traceable (no new code needed to read it):

1. **Template → Playlist:** `Playlist.templateId` (`schema.prisma:1003`). A playlist optionally renders a template.
2. **Playlist → Schedule:** `Schedule.playlistId` (`schema.prisma:1065`).
3. **Schedule → Screen:** `Schedule.screenId` or `Schedule.screenGroupId` (`schema.prisma:1066-1067`), `isActive`, `priority`, date window.
4. **Confirmed actually-playing (the gold signal):** `ProofOfPlaySampler` (`apps/api/src/analytics/proof-of-play.sampler.ts`) runs every ~10 min, finds every **online** screen (`lastPingAt` within 6 min, `pairedAt != null`), resolves its highest-priority active schedule, and writes a `PlaybackSample{tenantId, screenId, playlistId, sampledAt}` row (`schema.prisma:1354-1367`).

So a generated template that reaches glass leaves an evidence trail: a `Schedule` row pointing (via Playlist) at the template, and one `PlaybackSample` row per 10-min interval it was live on an online screen. **Strength tiers of outcome, in ascending order of "GOOD"**, all derivable today by id-joins:
- **Kept** = a `Template` row exists from `create-from-candidate` (weakest — survived the picker).
- **Used** = a `Playlist.templateId` points at it.
- **Scheduled** = a `Schedule` (via that playlist) is active and screen/group-targeted.
- **WENT LIVE (strongest)** = ≥1 `PlaybackSample` rows reference a playlist whose `templateId` = this template, i.e. it was actually composited on an online screen.
- **Negative signal**: `Template.status` flips / `TEMPLATE_DELETED` audit row, or it was generated and never used. (Note `Template` has no `deletedAt` — delete is hard or status-flip; `Schedule`/`PlaybackSample` have no FK to Template, by design, so they survive a template delete and the historical join still works on the opaque id.)

**Caveats to the join:** ProofOfPlay v1 ignores day-of-week/time-of-day windows (sampler header, lines 31-34); and the Template↔Playlist↔Schedule↔PlaybackSample joins are id-string joins (PlaybackSample/Schedule intentionally have no Template FK). Both are workable for an outcome rollup but mean "went live" is interval-grained, not exact.

## (d) Shape of the bug / telemetry table(s)

**`Bug`** (`schema.prisma:2339-2371`, table `bugs`) is the only telemetry table:
- `id`, `tenantId?`, `userId?`, `status` (default `NEW`), `description? @db.Text`, `screenshotUrl?`
- **`capturedContext Json`** (`@map("captured_context")`, NOT NULL) — the operator's session snapshot written by `apps/web/src/lib/bug-capture.ts`, consumed by `apps/api/src/bugs/bugs.controller.ts` + `bug-analyzer.service.ts`. Per CLAUDE.md it holds `browser.userAgent`, page, console entries, network failures, React Query state.
- `serverContext Json?`, `aiAnalysis Json?`, `aiAnalyzedAt?`, `aiProvider?`, `aiModel?`, `aiCostUsd Float?`
- Fix-tracking: `approvedById?`, `approvedAt?`, `fixBranchName?`, `fixPrNumber Int?`, `fixCommitSha?`, `shippedAt?`, `rejectedReason? @db.Text`
- `createdAt`, `updatedAt`; indices `(tenantId, createdAt desc)`, `(status, createdAt desc)`, `(userId, createdAt desc)`.

Related telemetry/analytics tables (not "bug"): **`TouchEvent`** (`schema.prisma:1325`, tap analytics, no FK to Template/Zone, opaque string ids), **`PlaybackSample`** (above), **`SponsorImpression`**, **`AdImpression`**. The `Bug.capturedContext` / `TouchEvent` / `PlaybackSample` patterns are the precedents to follow: **append-only, JSON-flexible blobs, no FK to mutable content, tenant-scoped with a `(tenantId, createdAt)` index.**

## (e) Proposed ADDITIVE Prisma model(s) to capture a generation outcome

The blocker: a generation outcome is a **slowly-maturing record** — `chosenIndex` is known at keep-time, but `publishedAt`, `editDistanceAfterKeep`, `deletedAt`, and `rating` arrive minutes-to-days later. `AuditLog` **cannot** serve this: it has a DB-level immutability trigger (migrations `20260526010000_audit_log_immutability`, `20260531000000_audit_logs_immutable`, `20260609000000_dedupe_audit_immutability_triggers`) that blocks UPDATE/DELETE. So this needs a **new mutable table** (it can still be append-mostly with targeted UPDATEs to the outcome columns).

Two-model design (parent generation event + the outcome that matures on it). Both purely additive — new tables only, no existing model altered, all FKs `onDelete: SetNull`/no-FK so they survive content deletion.

```prisma
/// One row per AI board-generation EVENT (the moment N candidates were produced).
/// Written at generate time by the candidate / single-shot / set paths in
/// ai.service.ts. Append-only at creation; the linked outcome carries everything
/// that matures later. No FK to Tenant on a hot path is required, but a scoped
/// SetNull keeps it deletable. Mirrors the AI_SIGNAGE_BOARD_* audit `details`
/// shape so it is a strict superset of what we log today — plus the join key.
model AiGeneration {
  id              String   @id @default(uuid())
  tenantId        String   @map("tenant_id")
  userId          String?  @map("user_id")              // null = API-key/machine actor
  // ── Intake / request shape (the "what was asked") ──
  surface         String                                 // 'candidates' | 'single' | 'set' | 'refine' | 'concierge'
  intakeText      String?  @map("intake_text") @db.Text  // the operator's prompt (PII-bearing — see privacy note)
  vertical        String?                                // K12 | GYM | … (Tenant.vertical at gen time)
  purpose         String?                                // GuidedPurpose: welcome|menu|promo|…  (null = derived)
  paletteSource   String?  @map("palette_source")        // 'brand' | 'auto' | 'custom'
  backgroundMode  String?  @map("background_mode")        // GuidedBackground: solid|gradient|textured|photo|auto
  // ── What the engine produced (the "what came back") ──
  archetype       String?                                // ArchetypeId of the *primary* candidate (9-value space)
  theme           String?                                // ThemeBundle id (12-value space)
  candidateCount  Int      @map("candidate_count")        // how many shown (requested→returned)
  archetypes      Json?                                   // string[] of per-candidate archetypes (the full fan-out)
  screenWidth     Int      @map("screen_width")
  screenHeight    Int      @map("screen_height")
  hadPhoto        Boolean  @default(false) @map("had_photo") // a real bg image was attached
  // ── Provider / spend (mirrors today's audit details) ──
  provider        String?                                // anthropic | openai | google
  model           String?
  source          String?                                // 'tenant' (BYOK) | 'platform' (Tier-1)
  createdAt       DateTime @default(now()) @map("created_at")

  outcome AiGenerationOutcome?

  // Hot paths: per-tenant feed; "all kept boards of archetype X"; vertical rollups.
  @@index([tenantId, createdAt])
  @@index([tenantId, vertical, archetype])
  @@index([tenantId, theme])
  @@map("ai_generations")
}

/// The maturing OUTCOME of one generation — what the operator did with it.
/// Created at keep-time (create-from-candidate) and UPDATED as the board is
/// published / edited / deleted / rated. Separate from AiGeneration so the
/// parent stays append-only and the mutable surface is small + auditable.
/// No FK to Template (templates can be hard-deleted; we keep templateId opaque
/// so the historical outcome survives — same rationale as PlaybackSample/TouchEvent).
model AiGenerationOutcome {
  id                   String    @id @default(uuid())
  generationId         String    @unique @map("generation_id")
  tenantId             String    @map("tenant_id")        // denormalized for fast tenant rollups
  // ── Selection (the chosenIndex we lose today) ──
  chosenIndex          Int?      @map("chosen_index")      // which of candidateCount was kept; null = discarded all
  templateId           String?   @map("template_id")       // opaque — the persisted Template (no FK)
  keptAt               DateTime? @map("kept_at")
  // ── Downstream lifecycle (the GOOD/BAD ladder from §c) ──
  publishedAt          DateTime? @map("published_at")      // first time a Schedule (via Playlist) targeted a screen
  wentLiveAt           DateTime? @map("went_live_at")      // first PlaybackSample referencing it (STRONGEST positive)
  deletedAt            DateTime? @map("deleted_at")        // template deleted / status-archived (negative)
  // ── Edit distance after keep (how much rework the operator had to do) ──
  editDistanceAfterKeep Int?     @map("edit_distance_after_keep") // chars/zones changed vs the generated baseline
  editCount             Int      @default(0) @map("edit_count")   // # of TEMPLATE_UPDATED saves after keep
  firstEditedAt        DateTime? @map("first_edited_at")
  // ── Explicit feedback (when/if a thumbs/stars UI is added) ──
  rating               Int?                                 // -1 | +1 (thumbs) OR 1..5 (stars) — interpret by convention
  ratedAt              DateTime? @map("rated_at")
  createdAt            DateTime  @default(now()) @map("created_at")
  updatedAt            DateTime  @updatedAt @map("updated_at")

  generation AiGeneration @relation(fields: [generationId], references: [id], onDelete: Cascade)

  // Rollups: "of kept boards, how many went live, by tenant"; reverse lookup by template.
  @@index([tenantId, wentLiveAt])
  @@index([tenantId, deletedAt])
  @@index([templateId])
  @@map("ai_generation_outcomes")
}
```

**Wiring required to populate (out of scope for this read-only task, but noted):**
- `chosenIndex` + `generationId` must be **added to `TemplateCreateFromCandidateSchema`** (`packages/api-types/src/index.ts:774`) and the candidate-generation response must return the `generationId` to the browser so it can round-trip it. This is the single most valuable change — it's the only way to recover candidate selection.
- `publishedAt` / `wentLiveAt` are best filled by a **periodic reconciler** (cron, same pattern as `ProofOfPlaySampler`) joining `AiGenerationOutcome.templateId` → `Playlist.templateId` → `Schedule` / `PlaybackSample`. This avoids touching the load-bearing schedule/manifest hot paths.
- `editDistanceAfterKeep` / `editCount` filled in the `PUT /templates/:id` handler (`templates.controller.ts:1871`) when the template id matches an outcome row.

**Multi-tenant & privacy concerns:**
1. **Tenant isolation:** `tenantId` is on **both** tables and every index leads with it (matches every other tenant-scoped model). Every read MUST filter by `tenantId` from the JWT — never trust a body-supplied id (same rule as `auth-BUG-004` in `playlists.controller.ts:146`). Denormalizing `tenantId` onto the outcome avoids a join just to enforce scope.
2. **PII in `intakeText`:** the operator's free-text prompt can contain student/customer names, event details, addresses. Treat it as PII: it must be tenant-scoped, never cross-tenant-aggregated in raw form, excluded from any SUPER_ADMIN cross-tenant analytics unless hashed/redacted, and covered by the same retention/erasure policy as `Bug.capturedContext` and `TouchEvent`. Consider making `intakeText` nullable + opt-in, or storing only derived metadata (`purpose`, `vertical`, length) for cross-tenant model-quality analysis, keeping raw text per-tenant only.
3. **No FK to mutable content** (`templateId` opaque, like `PlaybackSample`/`TouchEvent`) so outcome history survives a template delete — but that means orphan rows are possible; the `deletedAt` column is how you record that intentionally rather than losing the row.
4. **Additive-only / pilot-safe:** two new tables, zero existing columns altered, every FK is `Cascade` within the new pair or no-FK to old tables — satisfies the "additive only, never alter/drop" pilot constraint.
5. **Don't reuse `AuditLog`:** its immutability trigger blocks the UPDATEs this record needs; and audit `details` is a stringified JSON blob (un-indexable for the `(tenantId, vertical, archetype)` rollups that make this data useful).

### Key file references
- Schema: `/Users/gschiemann/Desktop/EDU CMS/packages/database/prisma/schema.prisma` — `AuditLog` 1098, `Template` 1139, `Playlist` 1003, `Schedule` 1062, `PlaybackSample` 1354, `Bug` 2339, `TouchEvent` 1325, `Tenant.aiPlatformUsage*` 169-170.
- Generation + audit writes: `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/ai/ai.service.ts` (candidates 1892, signage 2050/2393/2541; usage helpers `windowCount`/`readPlatformUsage`/`bumpPlatformUsage` 335-460).
- Keep path (where chosenIndex is lost): `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/templates/templates.controller.ts:1106` (`createFromCandidate`); request schema `/Users/gschiemann/Desktop/EDU CMS/packages/api-types/src/index.ts:774`.
- "Went live" signal: `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/analytics/proof-of-play.sampler.ts`.
- Value spaces: 9 archetypes `/Users/gschiemann/Desktop/EDU CMS/packages/signage-design/src/archetypes.ts:836-848`; 12 themes `/Users/gschiemann/Desktop/EDU CMS/packages/signage-design/src/themes.ts:89+` (`clean-corporate, warm-school, neon-sports, qsr-appetite, minimal-luxury, calm-clinic, fresh-fitness, worship-warm, bold-retail, sky-civic, forest-campus, midnight-tech`); guided-intake enums `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/ai/guided-intake.ts:42-83`.
- AuditLog immutability (why a new mutable table is required): migrations `20260526010000_audit_log_immutability`, `20260531000000_audit_logs_immutable`, `20260609000000_dedupe_audit_immutability_triggers`.
