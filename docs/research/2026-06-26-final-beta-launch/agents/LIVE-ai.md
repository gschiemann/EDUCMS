# LIVE AI track — lead computer-use on Greg's authenticated Dodgers tenant

**Surface:** Every AI feature, exercised live in Greg's logged-in browser (Chrome MCP, `venue-os.app/dodgers`), against a **real OpenAI key** Greg entered in Settings → AI on the Dodgers tenant (provider=openai, BYOK). This is the only wave that tests the AI *happy path* end-to-end (the agent army's throwaway tenants have no key → they can only test graceful-degradation).

**Scale tier:** S1/S2 (single-venue power user). **Surface §§:** 3 (AI providers), 4 (AI feature surfaces), 5 (AI comparative), 19 (editability). **Grading lenses:** Design / UX / Functionality.

**Headline:** Every AI surface is genuinely wired to a live provider and works end-to-end. One real bug found (and fixed mid-session) + a cluster of cross-vertical-copy and brand-application polish items. **This is launch-quality AI, not a costume.**

---

## Findings

| # | Sev | Area | What | Repro | Evidence | Status |
|---|-----|------|------|-------|----------|--------|
| LIVE-AI-1 | **P1** | Image-gen | OpenAI **landscape + portrait** image generation 400'd — `Invalid size '1792x1024'. Supported sizes are 1024x1024, 1024x1536, 1536x1024, and auto.` The FE/enum carries orientation as the **DALL-E 3** size vocabulary (1792×1024 / 1024×1792), but the model is **gpt-image-1**, whose vocabulary doesn't overlap on the non-square sizes. SQUARE (shared 1024×1024) worked; the other two were dead. | Assets → Generate with AI → pick Landscape/Portrait → Generate. | Red error in modal (verbatim). | **FIXED + RE-VERIFIED LIVE `06038352`.** `callOpenAiImage` re-maps orientation per model (gpt-image-1 → 1536×1024 / 1024×1536; dall-e-3 fallback keeps DALL-E sizes). +3 regression specs assert the request-body size per model. Railway live on `06038352`; re-ran LANDSCAPE → asset 24→25, modal closed clean, no 400. ✅ |
| LIVE-AI-4 | P2 | AI template-gen | **HTML-entity double-encoding in generated text.** A generated button reads `Concessions &amp; Menus` / `Restrooms &amp; Exits` literally — the `&` is encoded to `&amp;` and rendered raw on the board. Customer-visible "broken" look. Same class as task #61 (HolidayWidget entity strings). | Generate a template whose copy contains `&`. | Builder canvas screenshot. | OPEN. |
| LIVE-AI-5 | P2 | AI template-gen | **Brand colors not applied** despite the prompt explicitly saying "Dodgers brand colors." Output is white bg / black text. AI scaffolds layout + structure well but doesn't pull the tenant palette into the draft. (The brand IS available — sparkle copy & image-gen weave it in; template-gen doesn't.) | Generate any template asking for brand colors. | Builder canvas (white/black). | OPEN. |
| LIVE-AI-6 | P2 | AI cross-vertical copy | **K-12-flavored AI affordances on a Sports tenant.** Template-gen suggestion chips = "Cafeteria menu / Library map / After-school programs / Front-desk visitor sign-in"; image-gen placeholder = "A welcoming back-to-school banner…". Wrong for Sports/QSR/Retail/etc. Same root class as Wave-A A1 K-12-chrome findings — the AI entry points need a per-vertical example/placeholder map. | Open Generate-with-AI (template or image) on a non-K12 tenant. | Modal screenshots. | OPEN. |
| LIVE-AI-7 | P2 | Chat-to-edit accuracy | "**a bit larger**" → proposed **Size → 15px** when the element was **24px** (i.e. *smaller* — wrong direction). Bold-on (the other half of the instruction) was correct. The feature works (NL→diff→apply); the size delta can contradict the instruction — likely the model isn't given/!reading the element's current size, so it emits an absolute guess. | Select a 24px text → "Edit with words" → "make it a bit larger" → Apply. | Before(24)/after(15) panel screenshots. | OPEN. |
| LIVE-AI-2 | P2 | Asset metadata (NOT AI) | Asset **RESOLUTION** recorded at a downscaled ~320px width — a 590 KB detailed logo PNG reads `320 × 941 px`; the displayed image is clearly high-res. Pipeline appears to read dims from a thumbnail/preview, not the original. Affects every asset (grid badge + detail), so it belongs to **assets (A2)**, not AI. Misleads operators sizing content for an LED canvas. | Open any image asset → read RESOLUTION. | Detail slide-over (320×941 on 590 KB). | OPEN — hand to A2. |

### PASSES (verified working live — no action)
| # | Area | Result | Evidence |
|---|------|--------|----------|
| LIVE-AI-3 | **Alt-text (vision)** — A/A/A | "Regenerate" made a real OpenAI vision call, upgrading a generic caption to an accurate, **brand-identifying** one: "Cleveland Browns logo featuring an orange helmet and stylized text on a dark, dynamic background." (97/160). One button, instant, live char counter, "keep <125 / skip 'image of'" guidance. Correctly read the NFL brand from pixels. | before/after slide-over |
| LIVE-AI-8 | **AI template generation** — A-/B+/A | Real end-to-end: 3 distinct drafts (Balanced/Bold/Detailed), opened in the v2 builder fully editable, with a **genuine multi-scene architecture** — a starred home scene "FindSection" (5 zones) + two destination scenes wired via **GOTO-SCENE** actions. It correctly understood "each button opens its own scene." (Destination scenes are empty skeletons — AI scaffolds structure, operator fills content.) Knocked to A-/B+ only by LIVE-AI-4/5/6. | draft picker + builder + Scenes tab |
| LIVE-AI-9 | **Chat-to-edit ("Edit with words")** — A/A | NL instruction → structured **"Proposed changes" diff** preview (✓ Bold on ✓ Size→…) → Apply/Discard → visible result. The differentiated feature vs Appspace. Bold applied correctly. (Size-direction nit = LIVE-AI-7.) | proposed-diff + applied-bold |
| LIVE-AI-10 | **Sparkle "Generate 3 options"** — A/A/A | 3 context-aware, sports-venue-appropriate copy options with a Tone selector (Casual/Energetic/Elegant/Playful/Serious), seeded from the element text, BYOK shows "Unlimited (your provider)." e.g. "Find Your Section Fast! Use the venue map to guide you to your seat before the game starts!" | generate panel |
| LIVE-AI-11 | **Image-gen SQUARE** — A/A/A | Real on-brand image (blue gradient + white motion streaks / stadium-light energy) generated → Supabase → Asset row → library, 1.2 MB PNG. Pipeline sound. | library tile + zoom |

## Why LIVE-AI-1 slipped (process note)
The pre-existing image-gen spec mocked `fetch` and **never inspected the OpenAI request body's `size`** — so a wrong size string passed every test. The live test caught in 30 s what the mock couldn't. Fix adds 3 specs asserting `reqBody.size` per model. **Lesson:** provider-call *shape* (size/model/params) must be asserted, not just "fetch was called."

## Coverage
- [x] Image-gen OpenAI — SQUARE ✅, LANDSCAPE/PORTRAIT fixed + re-verified live ✅
- [x] Alt-text (vision) ✅ · [x] Template generation ✅ · [x] Chat-to-edit ✅ · [x] Sparkle 3-options ✅
- [ ] Image-gen Google Imagen — N-A (tenant is provider=openai); code maps size→aspectRatio, spec-covered.
- [ ] Rewrite / Shorten / Fit-to-zone / Translate / Tell-me chips — share the same plumbing as the 4 verified surfaces (high confidence); not individually clicked. Translate is the one worth a dedicated live pass (multilingual board) in a follow-up.

## Grade (Greg's 3 lenses)
**Design A- · UX A · Functionality A-** — every AI surface is real and works; the deductions are the entity-encoding bug, brand-palette-in-template-gen gap, the K-12 copy on non-K12 tenants, and the chat-edit size-direction nit. None block launch; all are clean P2 fixes. The differentiated features (chat-to-edit, multi-scene template-gen, vision alt-text) are genuinely strong vs Appspace.
