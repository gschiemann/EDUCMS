# AI Flagship — QA Sign-off (2026-06-27, workflow wf_ad7b4dc1-703, 13 agents / 1.95M tokens)

Adversarial QA of the signage-design engine + generator (Waves 1–3). Full per-agent transcript: session `tasks/wui5pensl.output`.

## Verdict: GO-WITH-FOLLOWUPS
Engine math, renderer fidelity/Taurus, end-to-end contract + controller + security, and the mapper-output validation sweep all **PASS**. Three confirmed defects (adversarially verified, with the over-claims corrected) — none are crashes/build-breaks on the common path; 2 majors + 1 minor on reachable paths.

| Dimension | Verdict |
|---|---|
| Engine correctness (type-scale/contrast/themes/hct/validator/archetypes) | ✅ pass |
| Renderer fidelity + Taurus/cross-browser | ✅ pass |
| End-to-end contract + controller + security | ✅ pass |
| Mapper-output validation sweep | ✅ pass |
| Mapper correctness | ⚠ concerns (finding #1) |
| Prompt + parser robustness | ⚠ concerns (finding #2) |
| Render-harness visual grade | ⚠ concerns (finding #3) |

## Confirmed findings (verified real)
1. **MAJOR — stat-spotlight accent stat illegible on dark curated themes.** The focal giant number uses the accent as TEXT color. On bold-retail (#be185d/#18181b = 2.93:1) and midnight-tech (#6d28d9/#0a0a14 = 2.77:1) it's below the 4.5:1 large-text floor. The validator computes a compensating scrim but the mapper drops it for accent zones (the `overImage && !isAccent` guard + `resolveTextHex` isAccent short-circuit), and TEXT zones have no scrim render path. Brand-derived themes are safe (high-tone accent). FIX: for accent text on a flat board that fails the floor, fall back to a legible token (ink) or paint a scrim.
2. **MAJOR — `generateSignageBoard` theme:'brand' can throw an unhandled 500.** `deriveThemeFromBrand`→`argbFromHex` throws on a 4/5/7/8-digit stored brand hex; `resolveTheme('brand')` + `generateSignageBoardInner` have no try/catch → 500, no graceful degrade. Trigger needs a non-6-digit stored brand color (the `/branding/adopt` path can persist one). FIX: normalize the hex + try/catch fallback to a curated theme.
3. **MINOR — CTA pill overflows its zone.** `paddingMode:'button'` pill ≈165px tall (72px title × 1.1 + 0.6em×2 pad) vs an ~86px CTA zone on hero/lower-third/split → overflow/clip. FIX: smaller CTA font + tighter padding so the pill fits its zone.

## Note
The authoritative live authed-UI visual check is the lead's (agents can't drive the authed dashboard). Lead render-harness review separately confirmed the 9 archetypes + orientations look premium; the three-up mid-word-break nit was fixed (aaf6fd3a).
