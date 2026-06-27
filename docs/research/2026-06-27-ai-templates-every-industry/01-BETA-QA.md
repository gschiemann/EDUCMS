# AI Flagship — Beta-QA Team Findings (2026-06-27, wf_a3789308-8e9, 22 agents / 2.69M tokens)

Adversarial beta-test of the 4 new features (per-vertical, build-a-set, chat-to-edit, translate) + render/Taurus. Trust boundary (refine spec re-sanitized server-side), per-vertical affinity ids, credit accounting, tenant scoping, and the multi-scene sceneRef→sceneId round-trip all verified SOUND. Confirmed reachable defects:

## P1 — fix now
1. **"Use this" drops the board background.** `pickCandidate` never forwards `candidate.background` to `createFromCandidate`, so every engine/Display/set board persists WITHOUT its theme gradient/photo → renders flat on the live screen. The controller create-from-candidate already accepts `background`; pure FE omission. (Reported by build-a-set + FE-picker + translate lanes.) → FE one-liner.
2. **Build-a-set always yields exactly 3 boards.** FE hardcodes `count:3` and the Zod cap is `max(3)`, so the single-prompt "welcome→offer→hours→event→quote" loop never reaches 4-6. → FE: omit count for sets (backend defaults to 4, safe under the zone cap).
3. **20-zone GLOBAL cap truncates multi-scene sets.** `artDirectorSpecToTemplate` (and `sanitizeTouchTemplate` slice(0,20)) cap total zones at 20 across ALL scenes, so a 5-6 board set starves its last scene(s) to partial/zero zones; the player then auto-advances onto a BLANK board for 8s (the empty-section fallback is gated to touch). → mitigate now (player skips zero-zone scenes + keep set ≤4 boards); proper fix = per-scene zone budget (raise both caps for the multi-scene path).

## P2 — follow-ups
4. **Candidate thumbnail misrenders engine boards** — `ScaledTemplateThumbnail` piles all scenes' zones on one canvas + hardcodes white bg (ignores the gradient → invisible light text). Operator can't trust the preview. → pass background + render only the default scene in the thumbnail.
5. **Translate fonts Latin-only** — CJK/Arabic translations fall back to an OS font (defeats measured sizing) and Arabic has no RTL. → load CJK/Arabic webfonts in `useSignageFonts` + `dir`-aware render.
6. **Refine that drops the scenes array** silently collapses a set to one board (LLM-dependent, no guard). → guard: if the pre-refine spec had scenes and the new one doesn't, keep scenes.
7. Minor: dead-code VENUE fallback branch in prependVoices (benign); regenerate/back stale-state leak (P2).

Full transcript: tasks/web2ywt75.output.
