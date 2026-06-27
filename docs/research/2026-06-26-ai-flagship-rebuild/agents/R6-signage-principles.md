# R6 — Digital Signage Design Principles → The Design Rulebook Our AI Must Follow

**Scope:** Research the principles that make digital signage genuinely *beautiful AND effective* — read at 8–30 ft, glanceable in seconds, on LED walls / tall portrait screens — and translate them into concrete, enforceable RULES for VenueOS's AI template generator. Signage is NOT web/poster design: the viewer is far away, moving, and gives the screen ~1–3 seconds.

**Date:** 2026-06-26. All claims cited; anything I could not confirm is marked **UNVERIFIED**.

---

## 1. The viewing-distance law (the single most load-bearing rule)

Signage legibility is governed by one well-established industry standard from the **United States Sign Council (USSC)**: **1 inch of capital-letter height per 10 feet of viewing distance** for minimum readability under ideal conditions; **1.5×–2× that** for *comfortable / high-impact* reading. Source: [Signworks](https://www.signworksmonterey.com/sign-letter-height-visibility-guide), [Pannier Graphics letter-height chart](https://www.panniergraphics.com/blog/letter-height-visibility-chart-for-outdoor-sign-readability), [House of Signs — "Science of Sign Size"](https://houseofsignsco.com/2024/10/17/the-science-of-sign-size-understanding-viewing-distance-and-legibility/).

Critical distinction: **"readable" ≠ "visible."** A sign can be *visible* (you can tell it exists) at far greater distance than it is *readable* (you can parse the words). A visible-but-not-readable sign "is just a blur." ([Signworks](https://www.signworksmonterey.com/sign-letter-height-visibility-guide))

### Translated to point sizes (digitalsignage.com / MediaSignage formula)
The vendor-published formula ([MediaSignage typography & viewing-distance guide](https://digitalsignage.com/digital_signage/docs/guides/typography-viewing-distance/)):

- `Text Height (inches) = Viewing Distance (feet) × 0.007` (minimum)
- Comfortable: `Viewing Distance (feet) × 0.010 to 0.014`
- `Point Size = Text Height (inches) × 72`

**Published quick-reference table** (body / headline), cross-confirmed by [Yodeck's 2026 guide](https://www.yodeck.com/use-cases/digital-signage-design/):

| Viewing distance | Body text | Headline |
|---|---|---|
| 3 ft (1 m) | 18 pt | 36 pt |
| 6 ft (2 m) | 24 pt | 48 pt |
| 10 ft (3 m) | 36 pt | 72 pt |
| 15 ft (4.5 m) | 48 pt | 96 pt |
| 20 ft (6 m) | 60 pt | 120 pt |
| 30 ft (9 m) | 84 pt+ | 168 pt+ |

**Converting pt → px for our renderer:** 1 pt ≈ 1.333 px at 96 dpi. BUT signage is authored at *native panel resolution* (1080p/4K), not 96-dpi web. The robust, resolution-independent way for our AI to enforce this is **as a % of canvas height** (see §10 rule set), because a "60 pt" target only means something once you know the physical screen size and the panel's pixel density. The pt table above is the *intent*; the %-of-canvas rule is the *enforceable implementation*.

---

## 2. The 3-second rule + glanceability (why signage ≠ posters)

- Viewers absorb a sign in **3–5 seconds**, and "most viewers give your screen one to two seconds." **Design for a glance, not a read.** ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/), [MediaSignage content-design guide](https://digitalsignage.com/digital_signage/docs/guides/content-design-best-practices/))
- **3×5 rule:** max **3 lines × ~5 words**, *or* 5 lines × 3 words. One idea per screen. ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/), [AIScreen 11 rules](https://www.aiscreen.io/digital-signage/design-guide/))
- **80/20 screen real-estate:** ~80% of the visible area carries the *primary* message; ~20% is branding/secondary. ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/))
- "Visual hierarchy and contrast matter more than copy length." ([COSE — Conquering the first glance](https://cose.org/blog/cose-news/conquering-the-first-glance-the-3-second-rule/))

### Visual hierarchy levers (in priority order)
1. **Size** — headline **2–3× larger** than body so the eye lands on it first. ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/))
2. **Position** — top-left is read first (Western reading pattern); center commands attention; **bottom is overlooked in quick glances**. ([Evontech — 3-second rule / visual hierarchy](https://evontech.com/component/easyblog/the-3-second-rule-how-visual-hierarchy-cures-information-overload-in-ui-ux-design.html))
3. **Color/contrast** — bright high-contrast draws the eye; reserve an accent color for the ONE key element / CTA.
4. **White space** — an isolated element with space around it reads as *more important*.

---

## 3. Contrast & legibility floors (WCAG + signage-specific)

Signage must clear WCAG *and then some*, because it's read at distance, off-axis, in glare/sunlight, on low-PPI LED.

- **WCAG AA:** 4.5:1 normal text, 3:1 large text. **AAA:** 7:1 normal, 4.5:1 large. "Large" = ≥18 pt (24 px) or ≥14 pt bold (≈19 px). ([W3C SC 1.4.3](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html), [WebAIM contrast](https://webaim.org/articles/contrast/))
- **Signage practice raises the floor to 7:1+** for body and recommends bold for headlines, because of distance + ambient light. ([digitalsignage.com best-practices summary], [MediaSignage typography guide](https://digitalsignage.com/digital_signage/docs/guides/typography-viewing-distance/) — body 4.5:1 min / **7:1 recommended**; large text 3:1 min / 4.5:1 recommended).
- **Black-on-white = 21:1** (the ceiling). Light-on-dark *or* dark-on-light both work; **avoid mid-tone-on-mid-tone**. ([WebAIM](https://webaim.org/articles/contrast/), [AllAccessible WCAG guide](https://www.allaccessible.org/blog/color-contrast-accessibility-wcag-guide-2025))
- Poor contrast is the **#1 accessibility failure on the web (83.6% of sites, WebAIM 2024)** — our AI must never ship a sub-floor pairing. ([AllAccessible](https://www.allaccessible.org/blog/color-contrast-accessibility-wcag-guide-2025))
- Sunlight/glare: text must survive bright ambient light — test the pairing as if outdoors. ([AllAccessible](https://www.allaccessible.org/blog/color-contrast-accessibility-wcag-guide-2025))

---

## 4. Typography for distance (font choice, case, spacing, weight)

- **Sans-serif only.** Larger x-heights and cleaner letterforms hold up at distance and at low LED resolution; serif/decorative lose detail when scaled and slow recognition. Recommended faces: **Arial, Helvetica, Inter, Roboto, Open Sans, Lato.** ([MediaSignage typography](https://digitalsignage.com/digital_signage/docs/guides/typography-viewing-distance/), [Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/))
- **Max 2 typefaces** per design; create hierarchy with *weight* within one family, not by adding fonts. ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/))
- **Weights:** Headlines **700/800** (Bold/ExtraBold); body **400/500**. **Avoid weights <400, condensed, extended, italic** — all reduce distance legibility. ([MediaSignage](https://digitalsignage.com/digital_signage/docs/guides/typography-viewing-distance/), [Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/))
- **Maximize x-height; never condense.** Increasing x-height and avoiding condensed fonts *extends* effective viewing distance. ([US Access Board VMS legibility](https://www.access-board.gov/research/communication/variable-message-signing/vms-legibility/))
- **Case:** Mixed/sentence case beats ALL-CAPS for word recognition — highway-sign research shows lowercase is **12–15% more legible** for word recognition; using all-caps requires **~15% more letter height** for equal legibility. Use ALL-CAPS only for 1–2 word labels/headlines, never for phrases. ([US Access Board](https://www.access-board.gov/research/communication/variable-message-signing/vms-legibility/), [PMC — letter case & legibility](https://pmc.ncbi.nlm.nih.gov/articles/PMC2016788/), [Pannier](https://www.panniergraphics.com/blog/letter-height-visibility-chart-for-outdoor-sign-readability))
- **Spacing (from Access Board VMS research):** inter-character spacing **25–50% of cap height**; inter-word spacing **75–100% of letter height**. Crowded letters are harder to parse at distance. ([US Access Board](https://www.access-board.gov/research/communication/variable-message-signing/vms-legibility/), [Rise Vision](https://www.risevision.com/blog/digital-signage-best-practices))
- **Line length / leading:** keep lines short (the 3×5 rule does most of this); generous leading prevents lines from merging at distance.

---

## 5. Layout grids, safe margins, focal points

- **Safe area:** keep critical content inside the central region — leave **~5% margin all around** as a safe area; keep critical content within the **central 60%**; avoid dead-center placement (use a rule-of-thirds grid). ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/))
- **Broadcast title-safe / action-safe** (matters because much signage is shown on consumer TVs/LED with overscan, and our scorebugs/lower-thirds *are* broadcast graphics): modern standard = **action-safe 93% (3.5% margins), title-safe 90% (5% margins)**; ~4% overscan still common on consumer TVs. Put all text and the network "bug"/logo inside title-safe. ([Wikipedia — Safe area (TV)](https://en.wikipedia.org/wiki/Safe_area_(television)), [Venera Tech — title safe](https://www.veneratech.com/what-is-title-safe-and-why-it-still-matters-in-modern-video-production))
- **Rule of thirds:** divide into 9 zones; place key elements on the lines / at the 4 intersection "sweet spots" for energy and balance. ([IxDF — rule of thirds](https://ixdf.org/literature/article/the-rule-of-thirds-know-your-layout-sweet-spots))
- **Golden ratio (1.618:1)** for *zone proportioning* on multi-zone boards — a primary content zone and a secondary strip in φ proportion reads as balanced; combine with rule-of-thirds for placement. ([Rise Vision — golden-ratio layout](https://www.risevision.com/blog/digital-signage-layout-golden-ratio), [Figma golden ratio](https://www.figma.com/resource-library/golden-ratio/))
- **Number of zones scales with dwell** (see §7): passing-by = 1 full-screen zone; waiting = ≤2; lounging = ≤3. More zones than the audience has time for = clutter. ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/))

---

## 6. Motion & transitions (tasteful, purposeful, never distracting)

- **Transition duration:** **0.3–0.5 s** ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/)); broader acceptable band **300–2000 ms**, with **0.5–1.5 s** per switch a good default. ([MediaSignage motion graphics](https://digitalsignage.com/digital_signage/docs/content/motion-graphics/)). **Faster is usually better** — quick transitions keep focus on the message.
- **Easing:** `ease-out` for entering elements (fast→slow), `ease-in` for exiting, `ease-in-out` for general motion. **Never `linear`** (looks robotic). ([MediaSignage motion graphics](https://digitalsignage.com/digital_signage/docs/content/motion-graphics/))
- **One prominent animated element per screen at a time.** ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/))
- **Motion belongs on the periphery, not next to text.** Animation in the center pulls the eye off the message; a subtle animation on the border exaggerates the natural left-to-right eye sweep. ([MediaSignage motion graphics](https://digitalsignage.com/digital_signage/docs/content/motion-graphics/))
- **Transitions should feel invisible, not performative** — the goal is *flow*, not showing off the animation. ([MediaSignage](https://digitalsignage.com/digital_signage/docs/content/motion-graphics/))
- **Accessibility/safety:** never flash **>3×/sec** (seizure risk + WCAG 2.3.1). Mute auto-play video by default. ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/))

---

## 7. Dwell time / dayparting (right content, right moment, right duration)

**Three audience modes** drive item duration AND word count AND zone count ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/)):

| Mode | Dwell | Item duration | Word budget | Zones |
|---|---|---|---|---|
| Passing-by | 1–2 s glance | 8–12 s | 5–7 words | 1 |
| Waiting | 30 s–2 min | 12–20 s | 15–25 words | ≤2 |
| Lounging | 2 min+ | 15–30 s | 40–60 words | ≤3 |

General loop rule: **8–12 s per item** is the workhorse default. ([MediaSignage motion graphics](https://digitalsignage.com/digital_signage/docs/content/motion-graphics/))

**Dayparting** = swap content by time window. Three attributes: schedule window, playlist assignment, rule priority. Restaurant example: 6:00–10:30 breakfast, 10:30–14:00 lunch, 14:00–17:00 snack/happy-hour teaser, 17:00–21:00 dinner. Corporate: news AM, cafeteria specials noon, traffic PM. ([MediaSignage content-scheduling](https://digitalsignage.com/digital_signage/docs/software/content-scheduling/), [Navori dayparting](https://navori.com/digital-menu-boards/day-parting/)). Our AI should *propose* daypart variants of a generated board (breakfast/lunch/dinner skins) rather than one static board.

---

## 8. Orientation & resolution (portrait/landscape, LED native)

- Standard resolutions: **1280×720**, **1920×1080** (workhorse), **3840×2160 (4K)**. Author at *native* resolution, never below. ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/))
- **16:9 landscape** = general; **9:16 portrait** = menu boards, wayfinding, hallway/lobby pillars. Portrait changes the whole grid — primary message stacks vertically, eye travels top→bottom. ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/))
- LED walls / ribbon boards have non-standard ultra-wide ratios (e.g., VenueOS's 320×1080 panels, 960×1080 posters) and low pixel pitch (P4–P16) — **pixel pitch must be matched to viewing distance**; the further the viewer, the coarser the panel can be. ([Nevco ribbon boards](https://www.nevco.com/products/ribbon-boards-and-led-fascia/), [YUCHIP stadium LED](https://www.yuchip-led.com/products/stadium-perimeter-led-display-screen/)). **Implication for our AI:** type and stroke weight must be heavier on coarse-pitch LED; thin 1-px rules and small text disappear on a P10 wall.

---

## 9. Per-industry visual language

Each vertical has a learned visual grammar. The AI must switch palette, density, type personality, and motion energy by vertical.

### QSR / fast-food menu boards
- **Function over beauty:** "Beautiful design the customer can't read is failed design." ([SeenLabs — QSR legibility](https://seenlabs.com/blog/digital-menu-legibility-typography-contrast-standards-for-qsr-signage))
- 1"/10 ft applies: at a 12-ft queue, item names + prices need **≥1.2" cap height**. Sans-serif, **white/light text on dark** works best. ([SeenLabs](https://seenlabs.com/blog/digital-menu-legibility-typography-contrast-standards-for-qsr-signage))
- **Price in the SAME position every row** so customers know where to look; align names/descriptions/prices uniformly for fast scanning; limit items per panel; short or no descriptions. ([SeenLabs](https://seenlabs.com/blog/digital-menu-legibility-typography-contrast-standards-for-qsr-signage), [Samsung VXT menu tips](https://vxt.samsung.com/blog/restaurant/restaurants-digital-menu-board-design-tips), [Altametrics menu design](https://altametrics.com/menu/menu-design.html))
- **Whitespace = breathing room**, not waste — lets each item be processed individually. ([Samsung VXT](https://vxt.samsung.com/blog/restaurant/restaurants-digital-menu-board-design-tips))
- **Slow, predictable motion** so customers don't miss items mid-read. Daypart breakfast/lunch/dinner. ([SeenLabs](https://seenlabs.com/blog/digital-menu-legibility-typography-contrast-standards-for-qsr-signage), [Navori](https://navori.com/digital-menu-boards/day-parting/))
- Palette: warm, appetizing, brand-saturated (reds/oranges/yellows drive appetite). Big food photography.

### Luxury retail
- **Understated elegance: minimalism, ample negative space, restraint.** White/negative space is the *defining* element and signals confidence + quality. ([BlinkSigns luxury retail](https://blinksigns.com/luxury-retail-storefront-signage-guide/), [BlinkSigns minimalist signage](https://blinksigns.com/the-rise-of-minimalist-signage/), [The Global Display Solution](https://www.theglobaldisplaysolution.com/blog/embracing-minimalist-sign-designs-in-your-retail-store/))
- Clean lines, subtle/small logo, **bespoke or refined typography** (type "speaks the brand's personality"). ([Tupp Signs — luxury signage](https://tuppsigns.com/luxury-brand-signage-how-high-end-businesses-can-use-subtle-yet-powerful-signage/))
- Materials/lighting cues: brushed metal, soft halo glow — translate to **muted/monochrome palettes, soft gradients, slow elegant motion, generous margins**. Fewer words, larger empty field. ([Tupp Signs](https://tuppsigns.com/luxury-brand-signage-how-high-end-businesses-can-use-subtle-yet-powerful-signage/))

### Healthcare
- **Calm, reassuring cool palette:** light blue, teal, soft green; earth tones. Blue = calm/trust/tranquility; green = healing/freshness; whites = hygiene/order. **Avoid harsh reds and bright yellows.** ([HealthcareSigns — color psychology](https://blog.healthcaresigns.com/2025/08/05/the-art-of-healing-hues-how-color-psychology-in-signage-creates-a-calming-healthcare-environment/), [ThinkPod — medical colors](https://thinkpodagency.com/the-art-of-medical-colors-in-healthcare-branding-in-2025/), [media.io medical palette](https://www.media.io/color-palette/medical-color-palette.html))
- **One message / visual at a time**, lots of whitespace, readable at distance, low cognitive load (patients are stressed). Color-coded wayfinding reduces stress and supports healing. ([Modulex healthcare wayfinding](https://modulex.com/blog/designing-healthcare-wayfinding-that-works-for-staff-patients-and-visitors/), [RSM Design healthcare](https://rsmdesign.com/markets/healthcare))

### Stadium / sports
- **High energy, broadcast-grade, flicker-free on camera.** Bold team-color palettes, big numerals, fast cuts, full-color video/animation. Ribbon boards wrap the venue with scores/stats/sponsors. ([Nevco ribbon boards](https://www.nevco.com/products/ribbon-boards-and-led-fascia/), [Daktronics ribbon displays](https://www.daktronics.com/en-us/markets/sports/integrated-systems/ribbon-displays), [ViboLED arena scoreboard](https://viboled.com/arena-scoreboard/))
- **Broadcast compatibility:** high refresh (≥3840 Hz on premium panels) for flicker-free camera capture; calibrated color/brightness synced across all venue screens. ([UNIT LED scoreboard](https://www.unit-led.com/led-video-scoreboard), [CHAINZONE sports LED](https://www.chainzone.com/solutions/sports/))
- Scorebugs/lower-thirds obey **title-safe** rules (§5). Numerals must be the dominant element; team logos and sponsor logos get fixed slots.

### Worship
- **Warm, welcoming first impression** — "We're glad you're here," rotating welcome/visitor slides. ([Ministry Boost church signage](https://ministryboost.org/church-digital-signage/), [Skykit church signage](https://www.skykit.com/blog/8-ways-digital-signage-in-churches-elevates-worship-and-community))
- **Lower thirds for lyrics/scripture/speaker names:** clean readable fonts, **high contrast vs. motion background, semi-transparent box behind text** so it survives a busy background; keep it simple/uncluttered. Works in **dim sanctuary lighting** → high-contrast, vibrant. ([Church Motion Graphics — lower thirds](https://www.churchmotiongraphics.com/blog/a-guide-to-lower-thirds-enhancing-the-worship-experience-with-seamless-on-screen-text/), [LOOK DS church](https://www.lookdigitalsignage.com/church))
- Seasonal dayparting (Advent/Easter skins), rotating ministry announcements. ([Juuno church signage](https://juuno.co/digital-signage/church-digital-signs))

---

## 10. THE DESIGN RULEBOOK OUR AI MUST FOLLOW

Concrete, machine-checkable rules. **Default the canvas to a `viewingDistance` (ft) and `vertical` input; every rule below derives from those two.**

### A. Type sizing (resolution-independent, enforceable)
1. **Headline cap-height ≥ 6.5% of canvas height** for a ~15 ft default board; **body cap-height ≥ 3.5% of canvas height.** (These map to the 48 pt/96 pt @ 15 ft row when the 1080p canvas is shown at typical lobby scale; use %-of-height so it survives 1080p↔4K↔ultra-wide LED.)
2. **Scale with distance:** multiply the % floors by `viewingDistance / 15`. (10 ft board → ~0.67×; 30 ft → 2×.) Never go below the 15-ft floor for *any* board labeled "passing-by."
3. **Headline is 2–3× body size.** Reject layouts where the largest text < 2× the body text. ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/))
4. **Smallest legible text on a passing-by board ≥ 3.5% of canvas height.** Anything smaller (fine print, legal) is forbidden on glance boards.

### B. Typeface
5. **Sans-serif only** from the allow-list (Inter, Roboto, Helvetica/Arial, Open Sans, Lato, + brand font if sans). Block serif/script/decorative for primary text.
6. **Max 2 font families.** Build hierarchy via weight.
7. **Headlines 700–800; body 400–500.** No weight <400, no condensed/extended/italic for primary content.
8. **Sentence case for phrases; ALL-CAPS only for ≤2-word labels.** If all-caps is used, bump its size ~15%.
9. **Letter-spacing 0–0.05em** body; tighten large headlines slightly; never crowd. Word spacing normal-to-generous.

### C. Contrast & color
10. **Hard floor: 7:1** for body text, **4.5:1** for large/headline text (signage floor, above WCAG AA). Auto-reject any text/background pairing below floor and auto-correct (darken/lighten one side or drop a scrim/box behind text). ([MediaSignage typography](https://digitalsignage.com/digital_signage/docs/guides/typography-viewing-distance/), [W3C](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html))
11. **Text over image/video → mandatory scrim or solid text box** (worship lower-third rule generalized) to guarantee the floor. ([Church Motion Graphics](https://www.churchmotiongraphics.com/blog/a-guide-to-lower-thirds-enhancing-the-worship-experience-with-seamless-on-screen-text/))
12. **3–5 colors total** in the palette; one accent reserved for the single most important element. ([Yodeck](https://www.yodeck.com/use-cases/digital-signage-design/))
13. **Honor brand tokens:** map every color field to `var(--brand-primary)` / `var(--brand-accent)` first; only fall back to a vertical palette if no brand kit. (Ties into VenueOS BrandKit.)

### D. Content density / hierarchy
14. **3×5 rule:** ≤3 lines × ~5 words (or 5×3). One idea per screen. Reject boards exceeding the word budget for the chosen audience mode (§7 table).
15. **80/20:** primary message ≥ ~80% of visual weight; branding/secondary ≤ ~20%.
16. **Zone count capped by dwell:** passing-by 1, waiting ≤2, lounging ≤3.
17. **Hierarchy order:** exactly one focal element (largest, highest-contrast, on a rule-of-thirds sweet spot or top-left); everything else demoted.

### E. Layout & safe margins
18. **≥5% safe margin** on all sides; keep all critical text/logos inside **title-safe 90%** (broadcast surfaces) and within the **central 60%** for glance boards.
19. **Rule-of-thirds placement** for the focal element; **golden-ratio (≈1.618)** proportioning for primary vs. secondary zones. Avoid dead-center unless it's a single hero element.
20. **Grid-align** names/values/prices into consistent columns (menu boards, scoreboards, schedules) so the eye scans predictably; price/value in a fixed position every row.

### F. Motion
21. **Transitions 300–500 ms** default (band 300–2000 ms). **No `linear` easing** — `ease-out` in, `ease-in` out, `ease-in-out` general.
22. **One animated element per screen.** Motion on the periphery, never adjacent to body text.
23. **Never flash >3×/sec** (seizure safety / WCAG 2.3.1). Auto-play video muted.
24. **Item duration by mode:** 8–12 s passing-by, 12–20 s waiting, 15–30 s lounging.

### G. Orientation / target
25. **Author at native resolution** (1080p/4K/native LED). Generate **portrait vs. landscape variants** with re-stacked grids, not a stretched copy.
26. **Coarse-pitch LED (ribbon/wall):** heavier strokes, larger minimum type, no hairline rules; bump contrast and weight.

### H. Per-vertical preset palettes & personality (AI selects by `vertical`)
27. **QSR:** warm saturated palette (reds/oranges/yellows), big food imagery, fixed price column, white-on-dark menu rows, slow motion, breakfast/lunch/dinner dayparts. ([SeenLabs](https://seenlabs.com/blog/digital-menu-legibility-typography-contrast-standards-for-qsr-signage))
28. **Luxury retail:** monochrome/muted palette, maximal negative space, small refined logo, minimal words, slow elegant fades, generous margins. ([BlinkSigns](https://blinksigns.com/luxury-retail-storefront-signage-guide/))
29. **Healthcare:** cool calm palette (light blue / teal / soft green / white), one message at a time, low density, no harsh red/yellow, color-coded wayfinding. ([HealthcareSigns](https://blog.healthcaresigns.com/2025/08/05/the-art-of-healing-hues-how-color-psychology-in-signage-creates-a-calming-healthcare-environment/))
30. **Stadium/sports:** bold team-color palette, dominant numerals, fast energetic cuts, full-color motion, broadcast title-safe scorebugs, fixed logo/sponsor slots, high refresh. ([Nevco](https://www.nevco.com/products/ribbon-boards-and-led-fascia/), [UNIT LED](https://www.unit-led.com/led-video-scoreboard))
31. **Worship:** warm welcoming palette, scripture/lyric lower-thirds with mandatory scrim, high contrast for dim rooms, seasonal dayparts. ([Church Motion Graphics](https://www.churchmotiongraphics.com/blog/a-guide-to-lower-thirds-enhancing-the-worship-experience-with-seamless-on-screen-text/))

### I. Daypart awareness
32. When a board is content-dynamic (menu/announcements/specials), the AI should **offer daypart variants** rather than one static skin, with rule-priority for overlaps. ([MediaSignage content-scheduling](https://digitalsignage.com/digital_signage/docs/software/content-scheduling/))

---

## 11. Notes, caveats, UNVERIFIED items
- The pt→%-of-canvas mapping in Rule A is **my engineering translation** of the cited pt tables to make them resolution-independent; the exact % thresholds (6.5% / 3.5%) are a *defensible starting calibration*, not a published industry constant — tune against VenueOS's real 1080p/4K/ribbon renders. **UNVERIFIED as a citable constant.**
- The 0.3–0.5 s transition figure (Yodeck) and the 300–2000 ms band (MediaSignage) are both vendor guidance, broadly consistent but not a formal standard.
- Several sources are signage *vendors* (Yodeck, Rise Vision, MediaSignage/digitalsignage.com, Navori, Samsung VXT, Nevco, Daktronics) — directionally authoritative for practice, but commercially motivated. The *legibility* numbers (USSC 1"/10 ft, WCAG, Access Board VMS case/spacing research, broadcast title-safe %) come from standards bodies / research and are the firmest.

## Key sources
- USSC 1"/10 ft + readable-vs-visible: [Signworks](https://www.signworksmonterey.com/sign-letter-height-visibility-guide), [Pannier](https://www.panniergraphics.com/blog/letter-height-visibility-chart-for-outdoor-sign-readability), [House of Signs](https://houseofsignsco.com/2024/10/17/the-science-of-sign-size-understanding-viewing-distance-and-legibility/)
- Typography/viewing-distance tables + contrast floors: [MediaSignage](https://digitalsignage.com/digital_signage/docs/guides/typography-viewing-distance/)
- Comprehensive rules (fonts, zones, motion, dwell, resolution): [Yodeck 2026 guide](https://www.yodeck.com/use-cases/digital-signage-design/)
- 3-second rule / hierarchy: [COSE](https://cose.org/blog/cose-news/conquering-the-first-glance-the-3-second-rule/), [Evontech](https://evontech.com/component/easyblog/the-3-second-rule-how-visual-hierarchy-cures-information-overload-in-ui-ux-design.html), [MediaSignage content-design](https://digitalsignage.com/digital_signage/docs/guides/content-design-best-practices/)
- WCAG contrast: [W3C 1.4.3](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html), [WebAIM](https://webaim.org/articles/contrast/), [AllAccessible](https://www.allaccessible.org/blog/color-contrast-accessibility-wcag-guide-2025)
- Case/spacing/x-height research: [US Access Board VMS](https://www.access-board.gov/research/communication/variable-message-signing/vms-legibility/), [PMC letter case](https://pmc.ncbi.nlm.nih.gov/articles/PMC2016788/)
- Title-safe/action-safe: [Wikipedia](https://en.wikipedia.org/wiki/Safe_area_(television)), [Venera](https://www.veneratech.com/what-is-title-safe-and-why-it-still-matters-in-modern-video-production)
- Grids: [Rise Vision golden ratio](https://www.risevision.com/blog/digital-signage-layout-golden-ratio), [IxDF rule of thirds](https://ixdf.org/literature/article/the-rule-of-thirds-know-your-layout-sweet-spots)
- Motion: [MediaSignage motion graphics](https://digitalsignage.com/digital_signage/docs/content/motion-graphics/)
- Dayparting: [MediaSignage scheduling](https://digitalsignage.com/digital_signage/docs/software/content-scheduling/), [Navori](https://navori.com/digital-menu-boards/day-parting/)
- Industry: QSR [SeenLabs](https://seenlabs.com/blog/digital-menu-legibility-typography-contrast-standards-for-qsr-signage) / [Samsung VXT](https://vxt.samsung.com/blog/restaurant/restaurants-digital-menu-board-design-tips); luxury [BlinkSigns](https://blinksigns.com/luxury-retail-storefront-signage-guide/) / [Tupp](https://tuppsigns.com/luxury-brand-signage-how-high-end-businesses-can-use-subtle-yet-powerful-signage/); healthcare [HealthcareSigns](https://blog.healthcaresigns.com/2025/08/05/the-art-of-healing-hues-how-color-psychology-in-signage-creates-a-calming-healthcare-environment/) / [Modulex](https://modulex.com/blog/designing-healthcare-wayfinding-that-works-for-staff-patients-and-visitors/); stadium [Nevco](https://www.nevco.com/products/ribbon-boards-and-led-fascia/) / [Daktronics](https://www.daktronics.com/en-us/markets/sports/integrated-systems/ribbon-displays) / [UNIT LED](https://www.unit-led.com/led-video-scoreboard); worship [Church Motion Graphics](https://www.churchmotiongraphics.com/blog/a-guide-to-lower-thirds-enhancing-the-worship-experience-with-seamless-on-screen-text/) / [Ministry Boost](https://ministryboost.org/church-digital-signage/)
