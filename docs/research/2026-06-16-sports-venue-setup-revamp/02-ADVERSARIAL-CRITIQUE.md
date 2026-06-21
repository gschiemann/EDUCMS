# Adversarial Review — VenueOS Sports Setup Redesign Spec

> Code-verified critique of [01-REDESIGN-SPEC.md](01-REDESIGN-SPEC.md), 2026-06-16.
> These are claims checked **against the code, not taken on faith** — they relocate
> the scroll-speed bug, rescope item L, and flag the hidden costs. Read before
> implementing any phase.

## Verification notes (checked against code)
- **E1 root-cause is mislocated in the punch-list framing.** The main ticker crawl (`ribbon/[gameId]/page.tsx:1685`) *already* applies speed: `pxPerSec = (vp.w / NORMAL_CROSS_SEC) * speedMult`. The path that ignores speed is the **sponsor-marquee look at line 2234**: `scrollSecs = Math.max(8, (cardW * copies) / 120)` — hardcoded `120`, no `speedMult`. So the Slow/Normal/Fast control likely *does* write `ribbonSpeed` and *does* work on the main ticker; the operator only sees "nothing happens" on the sponsor-marquee look. **Fix line 2234, verify by screenshotting the sponsor-marquee look specifically.**
- **`useScaleToFit` is duplicated, not shared.** Two independent definitions: `MainScoreboardWidget.tsx:116` and `RibbonScorebugWidgets.tsx:67` (+ `SportsScoreboardWidgets.tsx` as a third consumer). Both already compute `Math.min(w/natW, h/natH)` against `offsetWidth/Height`. So L2's "measure both axes" is **already done at the scene layer**; the real gap is the per-field text layer. **De-dupe the hook before threading a `w,h` prop or you fix the board and silently leave the ribbon scorebug on the old copy.**
- **`shortName`/`abbrev` fields do not exist** in `schema.prisma`. L1's 4-stage fallback (Full→Short→Abbrev→logo) + the three-name-fields UI require a **schema migration + create/edit form + manifest plumbing** — the biggest hidden cost in the doc. Ship shrink+condense (stages 1–2) now; defer abbrev (stages 3–4).
- **Taurus surfaces are currently clean** (0 `inset`/`gap` hits in `ribbon`/`board`/`widgets/sports`). The Taurus warning is correct but forward-looking — no existing debt to clean.

## P0 — First increment (functional, verifiable, ships alone)
**P0-1 — Auto-fit clipping (item L), rescoped.** Ship per-field shrink-to-fit (≥50px readability floor, but never-clip wins over floor) wrapping team/player/sponsor name fields. Defer the Short/Abbrev schema fields + 3-name UI. Extract ONE `useScaleToFit` before threading any prop. Edge cases that are P0 *because they're the reported surface*:
- **CJK / no-space strings** — letter-spacing condense does nothing, no word boundary to break; shrink-font is the only lever. Need an explicit "CJK → shrink-only, allow below-floor with a Setup warning" branch.
- **Measure-then-scale ordering** — the fit wrapper must measure *after* the scene's `transform:scale()` settles (double-`requestAnimationFrame`); a naive measure-on-first-paint reads pre-scale geometry. **Single most likely thing to ship broken-and-green.**
- **`scale(0)` flash** — `useScaleToFit` inits `scale = useState(0)` → first frame renders at 0; a fit measuring then divides by zero / picks max font. **Gate on `scale > 0`.**

**P0-2 — Scroll-speed bug (E1), corrected target.** Apply `speedMult` at line **2234**, not "find which field the control writes." Confirm the main-ticker path (1685) is already correct so you don't regress it. Map Slow/Normal/Fast/VeryFast → `{0.6,1,1.5,2.2}`. **Verification gate screenshots the sponsor-marquee look specifically.**

**P0-3 — Verification surface is non-negotiable:** standalone `/board/[gameId]` + `/ribbon/[gameId]` at real 4K, with a deliberately long name ("Academy of the Sacred Heart") and a CJK name. (Operator tests standalone routes, not the in-app preview — memory note.)

## P1 — Second increment
**P1-1 — `<SetupCard>` shell + dead-stepper removal (0, A).** Low-risk, high-clarity. **But** "Ready — Go Live" performing Scheduled→Live from Setup is a **state mutation on a new surface** — route it through the existing single mutation path (T1-1) + durable undo (T1-2), not a fresh handler. Flag per state-change discipline.

**P1-2 — Per-target real-resolution preview (D).** The `?w=&h=` query feeding `useScaleToFit`'s container is sound *only if* the forced-size iframe lays out at that pixel size (an iframe scaled down in a card still reports its *attribute* size to `offsetWidth` — what you want — but verify the route doesn't re-clamp to `window.innerWidth`). **Portrait ribbon (320×1080) is the edge case to test here.**

**P1-3 — Sponsor model relabel (G).** Mostly relabeling existing fields → lower-risk than it reads. Gaps:
- "Star sponsor 2×" toggle + Every-loop/other/3rd radio + stored integer weight = **three representations of one value.** Make the radio the single source of truth; derive weight; don't let toggle + radio both write it (or "5/2/10" returns in new clothes).
- **`creatives[]` (up to 4 ads/sponsor) is net-new data + rotation logic**, not a relabel. Cut from the first sponsor increment.
- **Proof-of-play "est. impressions" — where does the count come from?** T2-9 logs plays, not eyeballs. "Est. impressions" implies a crowd multiplier that doesn't exist → a fabricated number on a billing-adjacent, *paid* surface. **Drop the estimate (show plays + airtime only).** P0-to-not-ship.

**Promote to P1 from M:** logo fuzzy-pairing (the actual gate for the 30s happy path) and `SHOTCLOCK_DEFAULTS_BY_SPORT` (card #1's "set-and-forget" rests on it; J admits the defaults are unverified).

## P2 — Later increments
B, C, F, H, J, K — UX-clarity wins, none load-bearing. **I (MP3 upload):** the 3 mime caps must agree (adding `audio/mpeg`/`audio/wav` to only one silently fails upload — known repeat-bug). **E3 (launchable crowd messages):** crosses into Run-mode trigger surface — sequence after the IA spine (P1-1).

## 30-second-test failures still latent
- **Logo auto-pairing** buried as a one-liner in M but it's the happy-path gate — without fuzzy match the "confirm two teams → Go Live" path is a manual two-logo upload every time.
- **"Game rules auto-applied by sport"** (card #1) assumes per-sport defaults exist and are correct; J admits shot-clock defaults are unverified. A wrong default on Go Live breaks the 30s trust.
- **"Names fit ✓ / abbreviation used ⚠" indicator** needs the deferred abbrev pipeline — until then add an interim "name shrunk to fit — consider a shorter name" hint keyed off the computed scale so P0 still self-explains.

## Riskiest implementation steps (ranked)
1. A fit wrapper measuring before scene scale settles → ships green, broken on real 4K. *Mitigate:* measure inside the existing rAF chain; gate on `scale > 0`.
2. Threading `w,h` through *one* `useScaleToFit` while a second copy exists → ribbon scorebug silently unfixed. *Mitigate:* de-dupe the hook first.
3. CJK / unbreakable strings vs the 50px floor → unsolvable by condense; needs explicit shrink-only branch.
4. Three competing representations of sponsor frequency → reintroduces "5/2/10".
5. "Est. impressions" on a billing report with no count source → fabricated number on a paid surface.

**Recommended first increment:** P0-1 (per-field fit stages 1–2, de-duped hook, CJK branch, scale>0 gate) + P0-2 (line-2234 fix) + the standalone-route screenshot gate. **Out of increment 1:** schema name-fields, `creatives[]`, crowd-message cues, anything that mutates game state from Setup.
