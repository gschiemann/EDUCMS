# AI Flagship — Beta-QA Team Findings (2026-06-27, wf_a3789308-8e9, 22 agents / 2.69M tokens)

Adversarial beta-test of the 4 new features (per-vertical, build-a-set, chat-to-edit, translate) + render/Taurus. Trust boundary (refine spec re-sanitized server-side), per-vertical affinity ids, credit accounting, tenant scoping, and the multi-scene sceneRef→sceneId round-trip all verified SOUND. Confirmed reachable defects:

## P1 — fix now  ✅ ALL FIXED
1. ✅ **"Use this" drops the board background.** `pickCandidate` never forwarded `candidate.background` to `createFromCandidate`, so every engine/Display/set board persisted WITHOUT its theme gradient/photo → renders flat on the live screen. The controller create-from-candidate already accepts `background`; pure FE omission. (Reported by build-a-set + FE-picker + translate lanes.) → **FIXED `2be574df`** (FE one-liner — `background: candidate.background`).
2. ✅ **Build-a-set always yields exactly 3 boards.** FE hardcoded `count:3` and the Zod cap was `max(3)`, so the single-prompt "welcome→offer→hours→event→quote" loop never reached 4-6. → **FIXED `2be574df`** (FE omits count for sets → backend 4-board default).
3. ✅ **20-zone GLOBAL cap truncated multi-scene sets.** `artDirectorSpecToTemplate` (and `sanitizeTouchTemplate` slice(0,20)) capped total zones at 20 across ALL scenes, so a 5-6 board set starved its last scene(s) to partial/zero zones; the player then auto-advanced onto a BLANK board for 8s. → **Mitigated `2be574df`** (player skips zero-zone scenes) → **ROOT-CAUSE FIXED `507f9437`**: scene-aware ceiling — `MAX_ZONES_PER_SCENE` (20, per-scene) + `MAX_GENERATED_TEMPLATE_ZONES` (96 = 8 scenes × 12, global), shared across mapper + sanitizer so they can't drift; single-board unchanged; regression test added (dense 6-board set keeps every scene's zones, >20 total).

## P2 — follow-ups
4. **Candidate thumbnail misrenders engine boards** — `ScaledTemplateThumbnail` piles all scenes' zones on one canvas + hardcodes white bg (ignores the gradient → invisible light text). Operator can't trust the preview. → pass background + render only the default scene in the thumbnail.
5. **Translate fonts Latin-only** — CJK/Arabic translations fall back to an OS font (defeats measured sizing) and Arabic has no RTL. → load CJK/Arabic webfonts in `useSignageFonts` + `dir`-aware render.
6. **Refine that drops the scenes array** silently collapses a set to one board (LLM-dependent, no guard). → guard: if the pre-refine spec had scenes and the new one doesn't, keep scenes.
7. Minor: dead-code VENUE fallback branch in prependVoices (benign); regenerate/back stale-state leak (P2).

Full transcript: tasks/web2ywt75.output.
