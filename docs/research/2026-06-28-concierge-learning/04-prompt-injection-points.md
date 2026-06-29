I now have a complete picture of every injection seam. I have all the code-verified detail needed. Let me write the report.

---

# Where to Inject Learned Signals to Make the Signage Agent Smarter

## Architecture recap (the three prompt-assembly seams)

There are exactly **three** places an LLM is invoked in the signage flow, each with a different model tier and token budget:

| Surface | Function (file:line) | Model | Token budget |
|---|---|---|---|
| **Concierge chat** (intake) | `AiService.conciergeChatInner` — `apps/api/src/ai/ai.service.ts:1259` | **cheapest Standard** model via `defaultModelFor(resolved.provider)` (`:1335`), NOT the configured premium one | `CONCIERGE_MAX_TOKENS = 1100` (`signage-concierge.ts:36`) |
| **Single board generate** | `AiService.buildSignageBoardCore` — `:2132` | tenant-**configured** model (`resolved.model`) | `maxTokens ?? 900` (`:2167`) |
| **3-candidate fan-out** | `AiService.generateSignageBoardCandidates` → calls `buildSignageBoardCore` 3× (`:2367-2368`) | configured model ×3 | 900 each |

The system prompt for generation is assembled at `buildSignageBoardCore:2140` via `prependVoices(ART_DIRECTOR_SYSTEM_PROMPT, vertical, brandVoice)` (`prependVoices` at `:247`). The user prompt is assembled at `:2156-2165` and **already contains the affinity hint** at `:2152-2155`. The concierge system prompt is built fresh per turn by `buildConciergeSystemPrompt` (`signage-concierge.ts:74`), assembled at `conciergeChatInner:1316`.

The "vertical-affinity" data the task names lives in `packages/api-types/src/verticals.ts:717` (`VERTICAL_DESIGN_AFFINITY`), resolved through `getVerticalDesignAffinity` (`:744`). The standalone `vertical-affinity.ts` file does **not** exist — only `vertical-affinity.spec.ts`; the map is in `api-types`. **This is the natural home for the learned bias (signal b)** — see section (b).

---

## (a) Few-shot exemplars: "here are boards customers loved like this" — at GENERATE time

### Exact injection point
The user prompt array in `buildSignageBoardCore`, **`apps/api/src/ai/ai.service.ts:2156-2165`**. Insert an `exemplarBlock` line right after the `affinityHint` (`:2161`) and before the per-candidate `directive` (`:2162`):

```
2156  const userPrompt = [
2157    `Operator description: ${opts.prompt}`,
2158    `Vertical: ${opts.vertical || 'venue'}`,
2159    `Canvas: ${sw} × ${sh} px (...)`,
2160    '',
2161    affinityHint,
        // ← INSERT exemplarBlock HERE (user-prompt side, NOT the cached system prompt)
2162    ...(directive ? ['', directive] : []),
...
```

Put it in the **user prompt, not the system prompt** (`ART_DIRECTOR_SYSTEM_PROMPT` at `:3455`). The system prompt is shared/cacheable across every call and every tenant; exemplars are tenant- and vertical-specific and change as you learn, so they belong on the variable side. (Anthropic prompt-caching, if used, breaks on a changing system prefix — keep the system block stable.)

The exemplars must be expressed in the **ArtDirectorSpec vocabulary** the model already emits (`:3463-3479`) — i.e. show `{archetype, theme, copy:{kicker,headline,body,cta,items}, accentSlot}`, NOT zone geometry/hex (the engine owns those; the model never sees them). This keeps the few-shot "in-distribution" with the output contract.

### Data shape it needs
A learned exemplar store keyed by `(vertical, purpose)`:

```ts
interface LearnedExemplar {
  vertical: string;       // canonical VERTICALS key
  purpose: string;        // 'menu'|'promo'|'event'|... (the concierge intake purpose)
  archetype: string;      // one of ARCHETYPE_IDS
  theme: string;          // one of THEMES ids (or 'brand')
  copy: { kicker?; headline; body?; cta?; items?: {label,value?,detail?}[] };
  accentSlot: string;
  signal: number;         // why it's "loved": accept-rate / edits-to-accept (fewer = better) / kept-live duration
}
```

Source the `signal` from existing telemetry — the generate path already writes `AuditLog` rows (`AI_SIGNAGE_BOARD_CANDIDATES` at `:2393`, recording `archetypes` per candidate) and a candidate carries its full `spec` back to the FE (`:2420`), so "which candidate was accepted" + "how much it was edited before publish" are observable without new instrumentation on the AI path. **Additive schema only** (live pilot): a new `LearnedExemplar` table (or a JSON column on `Tenant`/a `signage_learned_exemplar` table), never altering existing tables.

### Token budget impact
Generation runs on the configured (possibly premium/slow) model at a **900-token output budget**; input budget is generous. Each exemplar in ArtDirectorSpec form is ~80-150 tokens. **Cap at 1-2 exemplars** (~150-300 input tokens) — that's negligible against input cost and doesn't crowd the 900-token *output*. Do NOT add exemplars to the concierge turn (section c handles that surface with a much tighter budget).

### Cold-start / thin-data guardrail
- **Threshold gate**: only inject an exemplar if its `signal` clears a minimum (e.g. ≥N accepts, or an accept-rate floor). Below threshold → omit the block entirely; the prompt falls back to today's behavior (affinity hint + voice playbook), which is already strong.
- **Never let one exemplar dominate the fan-out**: the 3 candidates are deliberately diversified by `signageCandidateDirectives` (`:4099`) into balanced/bold/info-forward. If you inject the same loved exemplar into all 3, you collapse the diversity that makes "Pick your favorite" work. Inject the exemplar as **inspiration ("here is a board this vertical loved; match the QUALITY and voice, not the exact layout")**, and keep each candidate's archetype driven by the per-take directive.
- **Recency/decay** on `signal` so a stale winner doesn't ossify the look.

---

## (b) Learned archetype/theme BIAS per (vertical, purpose) → fed to the art-director

### Exact injection points (two, mirrored — both must change together)
The affinity is consumed **twice** in `buildSignageBoardCore`:
1. **Soft prompt hint** — `affinityHint` string at **`ai.service.ts:2152-2155`** (`affinity.archetypes` / `affinity.themes`).
2. **Deterministic parse fallback** — `parseArtDirectorSpec(parsedJson, { archetype: affinity.archetypes[0], theme: affinity.themes[0] })` at **`:2181-2184`** — used when the model omits/garbles its pick.

It is also consumed in the candidate-directive builder `signageCandidateDirectives` (`:4099-4120`, reads `aff.archetypes[i]` and `aff.themes`) and twice more for SET mode (`:2501`, `:2640`).

**Yes — `VERTICAL_DESIGN_AFFINITY` is the natural home for the learned bias.** It is *already* the exact data shape you want to learn (`{archetypes: string[], themes: string[]}`, ordered by preference, element [0] = default — `verticals.ts:710-714`), and it is *already* wired into both the soft-hint and the hard-fallback seams. The clean design is to NOT touch any callsite, and instead make `getVerticalDesignAffinity` (`verticals.ts:744`) return a **blended** affinity: the static curated order **re-ranked** by learned `(vertical, purpose)` signal.

### How to wire it without touching callsites
The blocker today: `getVerticalDesignAffinity(vertical)` takes only the vertical — it has no `purpose` and no learned store, and `api-types` is dependency-light by design (no Prisma — see the comment at `verticals.ts:708`). Two clean options:

- **Option 1 (recommended):** add an *optional* overload, e.g. `getVerticalDesignAffinity(vertical, learned?: LearnedAffinity)`, where the caller (`buildSignageBoardCore`, which DOES have Prisma) fetches the learned re-rank and passes it in. `api-types` stays pure; the merge function lives there but the data is injected by the service. The purpose comes from `opts.intake?.purpose` (already threaded into `buildSignageBoardCore` via `coreOpts` at `:2357-2364`).
- **Option 2:** keep `getVerticalDesignAffinity` as-is and apply the learned re-rank in the service right after `:2151`, before building `affinityHint` and the fallback.

Either way the merge is just a **stable re-ordering** of the existing curated arrays — never introduce an archetype/theme id that isn't in `ARCHETYPE_IDS` / `THEMES` (the spec test asserts every affinity id resolves — `verticals.ts:709`).

### Data shape it needs

```ts
interface LearnedAffinity {
  // per (vertical, purpose): how often each archetype/theme was accepted & kept
  archetypeScore: Record<string /*archetypeId*/, number>;
  themeScore: Record<string /*themeId*/, number>;
  samples: number;   // total observations → confidence gate
}
```

Keyed `(vertical, purpose)`. Scores from the same accept/edit/keep telemetry as (a). Stored additively (new table/JSON column).

### Token budget impact
**Zero net change.** The bias only **re-orders** the existing `affinity.archetypes` / `affinity.themes` arrays that are *already* interpolated into `affinityHint` (`:2154`). The string length is unchanged. This is the cheapest, highest-leverage signal of the three — it costs no tokens on either the cheap or premium model, and it improves both the soft hint AND the deterministic fallback (`:2182-2183`) AND the candidate diversity (`:4113`).

### Cold-start / thin-data guardrail
- **Confidence gate on `samples`**: below a minimum, return the static `VERTICAL_DESIGN_AFFINITY[vertical]` unchanged. The curated order is hand-tuned and good — never let 1-2 data points reorder it.
- **Blend, don't replace**: rank = `α·learnedScore + (1-α)·curatedRank`, with `α` scaling up as `samples` grows (a confidence-weighted blend). At `samples=0`, `α=0` → today's behavior exactly.
- **Keep [0] sane for the fallback**: the deterministic fallback uses `archetypes[0]`/`themes[0]` (`:2182-2183`). Guard that the learned re-rank never promotes a low-confidence outlier into slot 0 — require a strong margin to move the default.
- **Preserve diversity**: `signageCandidateDirectives` reads `aff.archetypes[0..2]` for the 3 distinct takes (`:4113`). If learning collapses the top-3 to near-ties on one archetype, the takes become clones. Enforce "top-3 must be 3 distinct archetypes" after the re-rank.

---

## (c) Learned "best questions to ask" — for the concierge chat

### Exact injection point
`buildConciergeSystemPrompt` in **`apps/api/src/ai/signage-concierge.ts:74`**, assembled at `conciergeChatInner:1316`. The interview guidance is the `HOW TO INTERVIEW` block (`signage-concierge.ts:110-117`). Add a new optional field to the args object and a new prompt section — the cleanest spot is a `LEARNED QUESTION PLAYBOOK` block inserted right after the `HOW TO INTERVIEW` list (after `:117`), before `WHAT YOU ARE GATHERING` (`:119`). Mirror the existing `buildReferenceContext` pattern (`:151-164`) — a small helper that returns `''` when there's no learned data, joined via the existing `.filter(Boolean).join('\n')` at `:145-146`.

The caller change is at **`ai.service.ts:1316-1323`** (the `buildConciergeSystemPrompt({...})` call) — add a `learnedQuestions` arg fed from a `(vertical, purpose?)` lookup. Note the concierge doesn't yet know the purpose on turn 1, so key learned questions on **vertical first**, refining by purpose once the model has set `intake.purpose` (the cumulative intake is re-derived every turn — `:138, :233`).

### Data shape it needs
Learn which questions, when asked, led to a **ready intake that produced an accepted board with few edits**:

```ts
interface LearnedQuestion {
  vertical: string;
  purpose?: string;          // optional refinement once known
  field: string;             // the intake slot the question fills: 'eventDate'|'menu items'|'location'|'ctaHref'|'theme'...
  prompt: string;            // a short exemplar question in this vertical's voice
  lift: number;              // correlation with ready=true → accepted-with-few-edits
}
```

Source: the concierge already audits `ready` per turn and `turns` count (`AI_CONCIERGE_CHAT` at `:1359-1377`), and the generate path records accept/edit signals. Join "which fields were filled before ready" ↔ "board accepted cheaply" to learn the high-lift questions per vertical. Additive schema only.

### Token budget impact — this is the tight one
The concierge runs on the **cheapest** model (`defaultModelFor` at `:1335`) with a **1100-token total budget** (`CONCIERGE_MAX_TOKENS`) that must cover the reply + the *cumulative re-derived intake JSON* + the design brief every turn (see the budget note at `signage-concierge.ts:34-36`). The system prompt is **rebuilt fresh every turn** (`:71-72`, `:1313-1314`) and already carries `WIDGET_CAPABILITY_BLOCK` + `INTEGRATION_VOCABULARY_BLOCK` + the reference block — it's the largest input on the cheapest model. So:
- **Cap learned questions to 3-5 one-line items** (~10-20 tokens each, ~60-100 tokens total). This is an *input*-side add (cheap on the Standard-tier model), but keep it tight so it doesn't dilute the existing interview instructions.
- Express them as *examples to draw from*, not a script: "For a {vertical}, operators most need to be asked: …" — the model already asks one question at a time (`:112`); you're biasing *which* question, not adding turns.
- Do **not** also push exemplar boards (signal a) into the concierge — that's the generate surface's job and would blow the 1100-token budget.

### Cold-start / thin-data guardrail
- **Omit when thin**: the helper returns `''` below a `lift`/sample threshold; the `HOW TO INTERVIEW` block (`:110-117`) is already a strong generic interviewer, so the fallback is graceful.
- **Bias, never script**: keep the existing "infer aggressively, ask only the next question that changes the design" rule (`:111`) as the dominant instruction. Learned questions are *candidates to prioritize*, so a thin/cold dataset can't force an irrelevant question.
- **Vertical-first keying** so a brand-new (vertical, purpose) pair with no data still inherits the vertical's learned questions, and a brand-new vertical inherits nothing (clean no-op).

---

## Cross-cutting notes

1. **Single shared telemetry source.** All three signals derive from the same observable: *which candidate was accepted, how heavily it was edited before publish, how long it stayed live*. The audit rows already capture the AI-side dimensions (`AI_SIGNAGE_BOARD_CANDIDATES` carries per-candidate `archetypes` and the spec round-trips to the FE; `AI_CONCIERGE_CHAT` carries `ready`/`turns`). The missing piece is a **join key from candidate→accepted board→edit-delta**, which is an additive instrumentation task, not a schema change to existing tables.

2. **Schema must be additive (live pilot).** New table(s) (`signage_learned_exemplar`, `signage_learned_affinity`, `signage_learned_question`) or JSON columns. Never alter/drop `VERTICAL_DESIGN_AFFINITY`'s *consumers* — re-rank inside `getVerticalDesignAffinity` so every existing callsite (`:2151, :2501, :2640, :4100`) gets the benefit for free.

3. **Highest leverage → lowest cost ordering:** (b) the affinity re-rank is the best first move — zero token cost, improves 4 callsites + the deterministic fallback + candidate diversity, and lands in a data structure (`VERTICAL_DESIGN_AFFINITY`) that is *already exactly the learned shape*. (a) few-shot exemplars are the biggest quality lever but cost input tokens and risk diversity collapse, so gate hard and cap at 1-2. (c) learned questions are valuable but constrained by the 1100-token concierge budget on the cheap model — cap tightest.

4. **Files to touch (for the eventual build):**
   - `packages/api-types/src/verticals.ts` (`getVerticalDesignAffinity:744`, `VerticalDesignAffinity:712`) — learned-affinity merge (signal b).
   - `apps/api/src/ai/ai.service.ts` — user-prompt exemplar block at `:2161` (signal a); learned-affinity fetch + pass-through near `:2151`; concierge `learnedQuestions` arg at `:1316` (signal c).
   - `apps/api/src/ai/signage-concierge.ts` (`buildConciergeSystemPrompt:74`) — new `learnedQuestions` arg + `LEARNED QUESTION PLAYBOOK` block after `:117` (signal c).
   - Keep `ART_DIRECTOR_SYSTEM_PROMPT` (`:3455`) and `WIDGET_CAPABILITY_BLOCK` / `INTEGRATION_VOCABULARY_BLOCK` (`venueos-capability-map.ts`) **untouched** — they are the stable, cacheable system spine; all learned signals ride the variable (user-prompt / per-turn-rebuilt) side.
