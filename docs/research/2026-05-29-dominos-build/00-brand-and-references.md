# Domino's Pizza — Brand, References & Menu-Layout Pack (for the menu-board mockup)

> Opus 4.8, read-only research, 2026-05-29. Visual brand pack to drive the
> Domino's menu-board HTML mockup (Step 1 of the CLAUDE.md Template Design
> Workflow). Pairs with `docs/research/2026-05-28-opus48-audit/36-dominos-pilot-research.md`
> (integration/scope — NOT re-done here).
>
> **Verification status:** Palette hexes and the typeface lineage are
> **verified** against multiple independent sources + the official Domino's
> press releases. The Oct-2025 "Mmm" refresh **sharpened** the red/blue but
> **published no new hex values** — flagged inline. One real 1920×1080
> in-store menu-board reference image was downloaded to
> `scratch/dominos-refs/`; the others are described from sources (image
> hosts hotlink-block direct download).

---

## 1. Verified brand palette

Domino's has run the **same red + blue + white** palette since 2012 (founder
Tom Monaghan modeled it on the US flag). The Oct-2025 refresh kept these two
colors and "evolved them into the **hottest version of each**, as a nod to
the melty heat of a pizza pulled fresh from the oven" (official press
release) — but **did not publish replacement hex codes**. Every brand-guide
aggregator still lists the 2012 values, and those map cleanly to the
documented Pantone matches, so **use these as canonical** and treat the
"hotter" wording as a saturation/vibrance nudge (see ramp note below).

| Role | HEX | RGB | CMYK | Pantone | Source confidence |
|---|---|---|---|---|---|
| **Domino's Blue** (primary) | `#006491` | 0, 100, 145 | 93, 58, 23, 4 | PMS 647 C | ✅ verified, 5+ sources |
| **Domino's Red** (accent) | `#E31837` | 227, 24, 55 | 5, 100, 83, 1 | PMS 199 C | ✅ verified, 5+ sources |
| **White** | `#FFFFFF` | 255,255,255 | 0,0,0,0 | — | ✅ verified |

**⚠️ Minor discrepancy, resolved:** `chromacreator.com` lists the primary
blue as `#0B648F` and `#006491` as "secondary." Every other source (and the
PMS 647 C match) uses `#006491`. **Go with `#006491`**; `#0B648F` is a
near-identical scrape artifact (ΔE ~3), not an official second blue.

**⚠️ Premium-tier accent (real, but niche):** the Oct-2025 refresh introduced
an **exclusive black + metallic gold** logo treatment used **only** on
Handmade Pan and Parmesan Stuffed Crust packaging. Not the everyday signage
palette — but a legitimate, on-brand option if we ever build a "premium /
indulgent" LTO board. Approx `#0A0A0A` ink + `#C9A227`→`#E8C766` gold
gradient. Flag as *premium-only*, don't use it as the base theme.

### Derived shade ramp (for VenueOS `var(--brand-*)`)

Hand-tuned from the two canonical hexes (HSL-stepped; blue is the UI primary,
red is the price/CTA accent — this matches how real Domino's signage uses
them: blue for structure/headlines, red for prices/badges). The "hotter"
2025 direction is reflected by keeping the accent at full saturation and
giving the primary a slightly brighter hover.

```
--brand-primary       #006491   /* Domino's Blue — headers, structure, size badges */
--brand-primaryHover  #00557C   /* darker blue for pressed/hover */
--brand-primaryBright  #0A78AD  /* the "hotter" lifted blue — hero fills, glow */
--brand-accent        #E31837   /* Domino's Red — prices, CTAs, deal discs */
--brand-accentHover   #C5142F   /* darker red */
--brand-accentBright  #FF1E40   /* the "hotter" red — LTO starbursts, "NEW" flags */
--brand-ink           #0E1A24   /* near-black blue-tinted text on white */
--brand-surface       #FFFFFF   /* card / panel base */
--brand-surfaceAlt     #F2F5F7  /* faint cool-grey panel (matches the concrete bg below) */
--brand-surfaceConcrete #DfE3E6 /* the slate/concrete texture base real boards use */
--brand-success       #2E8B57
--brand-warn          #E8A100
--brand-danger        #E31837   /* reuse brand red */
```

> Note: VenueOS already wires `dominos.com` as the auto-branding scraper's
> example (`branding-scraper.service.ts:278`), so the live theme can also be
> pulled at runtime — but ship these as the **hard-coded fallback palette**
> so the board is correct even before a scrape. **Our existing QSR templates
> use cream/caramel `#e8b94a` — that is OFF-BRAND for Domino's and must be
> re-skinned to the above.**

---

## 2. Brand typeface + the Google Font substitute

### The real font (verified lineage)

- Current brand face = **Domino's Sans** (Display + Text), introduced in the
  **Oct-2025 "Mmm" refresh**.
- It is a **customization of TT Commons™ Pro** (TypeType foundry, 2018),
  reworked by type designer **Terrance Weinzierl** in partnership with agency
  **WorkInProgress**.
- Official description: *"thicker and doughier, with **perfect circles and
  semi-circles in a nod to pizza**, with lots of personality baked right
  in."* TT Commons Pro itself is a **geometric sans, low stroke contrast,
  tight apertures, large x-height**. (The older logo wordmark was loosely
  Futura-derived; that's now superseded.)
- Net character to match: **geometric, rounded, friendly, heavy display
  weights, big round bowls (the o's read like pizzas).**

### Chosen free substitute we can actually load via `<link>`

There is **no exact free clone** of TT Commons Pro / Domino's Sans. The best
free pairing — verified live on the Google Fonts CSS2 API (all returned HTTP
200 and serve the listed weights) is:

**PRIMARY (use this):** **Hanken Grotesk** — display + body, one family.
The "bouba"/soft geometric grotesk; ships **400→900**, so we get a genuinely
heavy 800/900 for the doughy headlines and a clean 400/500 for body. Closest
free face to the TT-Commons-Pro feel (geometric + warm + low contrast) while
being one self-consistent family for the whole board.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
/* CSS: font-family: 'Hanken Grotesk', system-ui, sans-serif; headlines @ 800/900 */
```
*(verified: HTTP 200, serves 400/500/600/700/800/900)*

**ALT A — push the "doughy" metaphor harder:** **Baloo 2** for the big
display headline ONLY (it's an overtly rounded, chunky display face — reads
very "doughy/pizza"), paired with Hanken Grotesk for everything smaller.
Risk: Baloo can feel more "kids' menu" than "premium QSR" at large size —
A/B it in the mockup.

```html
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```
*(verified: HTTP 200, serves 400→800)*

**ALT B — colder/cleaner geometric:** **Sora** (geometric, large x-height,
tech-forward, 400→800). Less warm than Domino's Sans but very legible at
8-foot viewing distance. Good if Hanken reads too soft.

```html
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap" rel="stylesheet">
```
*(verified: HTTP 200, serves 400/600/700/800)*

> **Recommendation:** mock up **Hanken Grotesk 900 headline / 500 body** as
> the default, and build **one variant with Baloo 2 headlines** so the user
> can pick which "doughiness" reads as premium vs playful. **Fredoka** (also
> verified, 400→700) is a third rounded option but caps at 700 — too light
> for an 8-foot headline; keep it in reserve only.

### Logo / mark usage rules (verified)

- The mark is the **two-color split domino tile** ("the domino"): a square
  divided diagonally, **blue half + red half**, with **pips** — historically
  three dots (one per the "3 stores in 1965" origin story). The Oct-2025
  refresh made **the tile clearer/cleaner** and is the **"cravemark"** — an
  audio-*and*-visual expression of the name (the stretched "Mmm" in
  "Dommmino's"), voiced in ads by Shaboozey. The cravemark is the *brand
  signature motif*, not a tagline.
- **Do not** recolor the tile, add a stroke/shadow, rotate it, or place it on
  a busy photo without clear space. On dark/premium boards the tile may use
  the **black + metallic gold** treatment (premium SKUs only).
- We almost certainly **cannot ship the real Domino's logo asset** in a
  pilot mockup without permission — for the mockup, **render an on-brand
  domino-tile placeholder** (blue/red diagonal split + 3 pips) and label it
  "operator uploads official logo." This sidesteps trademark risk and proves
  the layout.

---

## 3. Reference images — the visual quality bar

> Real Domino's in-store digital signage we're matching. **Reference #1 was
> downloaded** to `scratch/dominos-refs/ommasign-dominos-menuboard.jpg`
> (1920×1080, verified JPEG) — open it in `scratch/` to eyeball. #2/#3 are
> described from primary sources (hosts hotlink-block direct save).

### Reference #1 — Single-item promo / menu panel (DOWNLOADED, eyeballed)
**Source:** OmmaSign Domino's case study —
`https://ommasign.com/wp-content/uploads/2024/01/image1.jpg`
(case study: https://ommasign.com/dominos-case-study/)
**Local copy:** `scratch/dominos-refs/ommasign-dominos-menuboard.jpg`

This is the gold-standard Domino's signage language in one frame:
- **Background:** a **light slate / concrete-grey texture** — NOT white, not
  blue. Subtle, premium, lets the food pop. (This is why our `--brand-surfaceConcrete`
  exists.)
- **Hero:** a **top-down ("flat-lay") whole pizza**, edge-bleeding off-center,
  shot hot and glossy — pepperoni, peppers, olives, corn, mushrooms. Food
  photography is the star; it occupies ~55% of the canvas.
- **Headline:** **bold blue all-caps** ("BOL MALZEMOS") across the top, heavy
  rounded geometric weight — exactly the Hanken-900 / Baloo look.
- **Size badge:** a **solid blue circle** ("ORTA BOY"), white text, top-left,
  overlapping the pizza — circular, not a rounded rectangle.
- **Price disc:** a **red target of concentric rings** (3 nested reds, lightest
  outer → hottest inner), big white price ("125 ₺") — bottom-right,
  overlapping the pizza. **This concentric-ring price disc is the single most
  copyable Domino's signage device.**
- **Takeaway:** blue = structure/headline/size, red = price/CTA, concrete-grey
  = canvas, food photo = hero. **Zero rounded-rectangle cards.**

### Reference #2 — Pickup / "Pie Pass" lobby welcome screen
**Source:** Sixteen:Nine / invidis —
`https://invidis.com/sixteen-nine/2020/02/17/dominos-starts-using-digital-signage-to-improve-mobile-order-pickup/`
(image `dominos-jim.jpeg` on page; hotlink-blocked from direct save)

- Part of the 2012+ **"Pizza Theater"** store design: an **open lobby screen
  that tracks carryout orders** and, with **Pie Pass**, **greets the
  arriving customer by name** ("Welcome, Jim") to trigger a fast handoff.
- Layout = a clean **name list / status board**: large legible names, a
  status word per name, Domino's blue header bar, white/light body, red
  accents for "Ready." Big type for across-the-lobby reading.
- **⚠️ Integration reality (from the prior report):** the *live* version of
  this needs order data from Pulse/Pie Pass that **we have no path to**. We
  can build the **layout** beautifully as a **static/demo or manual** board,
  but a *live* pickup board is a costume without a Domino's-corporate feed.
  Build it; **label it Phase-2 / demo**.

### Reference #3 — Pizza Tracker (consumer UI the lobby screen mirrors)
**Source:** official —
`https://ir.dominos.com/news-releases/news-release-details/dominosr-updates-its-iconic-industry-first-tracker-even-better`
+ https://www.restaurantbusinessonline.com/technology/dominos-upgrades-pizza-tracker-more-play-play
+ https://www.dominos.com/en/tracker

- The **2026 refreshed tracker** (biggest update since 2008) simplifies to
  **four stages: `Placed → Make → Deliver / Pickup → Mmm!`** with detail
  text under each, a **car-shaped GPS progress bar** for delivery, and iOS
  Live-Activities lock-screen support. Powered by **DomOS** AI for ready-time
  estimates.
- Visual: **horizontal stepper**, blue active/red highlight, big stage labels,
  rounded geometric type, lots of white space.
- **⚠️ Same integration caveat as #2:** no third-party data path to live
  store/order status. A tracker **layout** is buildable as static/demo;
  **don't pitch it as live.**

> Reference quality summary: Domino's signage is **photo-forward, high-
> contrast, big-type, circle/disc-driven, on a cool concrete-grey canvas.**
> Our mockup has to clear *that* bar — glossy real food photo + the
> concentric-ring price disc + heavy blue headline, never a flat card grid.

---

## 4. Menu-layout conventions (what a real Domino's board emphasizes)

How Domino's organizes the menu (from dominos.com menu structure + signage
case studies). A menu **board** does NOT list everything — it **sells deals
and impulse adds** to a mostly-pickup crowd (~80% carryout), since people
already ordered on the app:

**Category order on a full menu (for the "everything" board):**
1. **Deals / Mix & Match** — *the hero.* "2+ items $6.99 each" (Mix & Match
   is the flagship deal construct), bundle/combo deals, current LTO. Top slot,
   biggest, red price discs.
2. **Pizzas** — split into:
   - **Build-your-own** by **size** (Small 10" / Medium 12" / Large 14" /
     X-Large 16" Brooklyn) × **crust** (Hand Tossed / Handmade Pan / Crunchy
     Thin / NY-style Brooklyn / Gluten-Free). Show the size×price grid.
   - **Specialty pizzas** (named recipes): ExtravaganZZa, MeatZZa,
     Ultimate Pepperoni, Pacific Veggie, Memphis BBQ Chicken, Buffalo
     Chicken, Philly Cheese Steak, Honolulu Hawaiian, Deluxe, Cali Chicken
     Bacon Ranch. Each = food photo + name + 1-line topping list.
3. **Sides** — Bread Twists (Garlic / Parmesan / Cinnamon), Stuffed Cheesy
   Bread, Boneless/Bone-in Chicken & wings, Loaded Tots, Bread Bowl Pasta,
   Chicken Carbonara / Pasta Primavera.
4. **Desserts** — Cinnamon Bread Twists, Chocolate Lava Crunch Cake,
   Marbled Cookie Brownie.
5. **Drinks** — Coca-Cola 20oz / 2-liter line.
6. **Dips / add-ons** — Garlic, Ranch, Marinara, Blue Cheese, Icing.

**What the board actually emphasizes (priority for our template):**
- **Mix & Match / current deal** — single biggest element, always.
- **A hero specialty pizza** with glossy top-down photo + the **red
  concentric-ring price disc.**
- **Size/price clarity** — the size badge (blue circle) + price disc combo.
- **LTO / "NEW" flag** — a red starburst / "hot" badge; seasonal items rotate.
- **App / loyalty nudge** — "Order on the app, earn points" (Domino's Rewards),
  often a QR or bottom ticker.

**Deal / LTO patterns to template:**
- **"Mix & Match — pick any 2+ for $X.99 each"** (the staple — make this a
  reusable layout block).
- **Bundle** ("$19.99 — 2 medium 2-topping + breadsticks + dip").
- **Carryout-only special** (price-point hero).
- **Limited-time** seasonal hero (rotate the photo + name + price disc).
- Prices are the loudest element after the photo — **always in the red disc.**

---

## 5. Themed-shape directions (the anti-"rounded-rectangle" rule)

Per CLAUDE.md: every widget must be a **shape/metaphor**, never a card with a
shadow. Five concrete directions for a Domino's menu board, each pushing the
brand metaphor. (Recommend mocking **Direction A first** — it's the most
directly "Domino's" and reuses the real reference's price disc.)

**A. "Pizza-box panels" + concentric-ring price discs.** *(lead with this)*
- The board is built from **open-pizza-box lid shapes** (the brand's most
  iconic object): each menu section sits inside a stylized box-lid form —
  blue or red corrugated edge, the domino tile printed top-left like a real
  box. Inside each: a **top-down flat-lay pizza photo** + name.
- Every **price is a red concentric-ring disc** (the OmmaSign reference's
  signature device) overlapping the food. Sizes are **blue circle badges**.
- Background = **cool concrete-grey texture** (matches real boards). The
  metaphor reads instantly: "this is a Domino's box."

**B. "Domino-tile dividers + pip grid."**
- The **domino tile itself** is the structural motif: section dividers are
  rendered as **dominoes laid end-to-end** (blue/red diagonal split, white
  pips), and the **deal callout sits on a giant single domino** — e.g. the
  "$6.99" deal printed on a tile whose pip-dots double as bullet points for
  the "pick 2+" rules. The pip-dots become a **visual counting device**
  ("2 for $6.99" → two pips lit). Cravemark-adjacent and unmistakably
  Domino's.

**C. "Pizza-slice callouts (wedge cards)."**
- Replace rectangular item cards with **triangular pizza-slice wedges** fanned
  out from a center point (like slices pulled from a pie). Each wedge = one
  specialty pizza: crust-edge along the outer arc, photo as the "topping"
  fill, name on the crust. The deal hero sits in the **center hub** where the
  slices meet. Dynamic, food-shaped, zero rectangles. (Hardest to make
  legible at 8ft — prototype carefully.)

**D. "Cravemark / Mmm motif as the hero device."**
- Lean into the **2025 cravemark**: the stretched **"Mmm"** becomes a giant
  blue typographic element the food photo nests inside (pizza framed by the
  rounded "m" bowls), or a **steam-wisp / heat-shimmer** motif rising off the
  hero pizza (callback to "the hottest version of red/blue = melty oven
  heat"). Modern, ties straight to the current campaign. Pair with Baloo-2
  doughy type.

**E. "Pizza Theater conveyor ticker."**
- For the deal/LTO strip: a **horizontal conveyor-belt** (the open-kitchen
  "Pizza Theater" metaphor) where deal cards ride past on a stylized
  make-line belt — slices/boxes moving left-to-right. Reuses our TICKER
  widget mechanic but skins it as the make-line conveyor instead of a flat
  scrolling bar.

> **Shape inventory to hand the mockup:** open pizza-box lid, domino tile
> (blue/red split + 3 pips), concentric-ring price disc, blue size circle,
> pizza-slice wedge, red "NEW/hot" starburst, steam/heat wisp, make-line
> conveyor. **None of these are rounded rectangles.**

---

## Sources

- Domino's brand palette: https://brandpalettes.com/dominos-color-codes/ ·
  https://www.brandcolorcode.com/dominos · https://chromacreator.com/brands/dominos
- 2025 "Mmm" refresh (official): https://ir.dominos.com/news-releases/news-release-details/dominosr-new-craveable-brand-refresh-makes-you-say-mmm ·
  https://www.prnewswire.com/news-releases/dominos-new-craveable-brand-refresh-makes-you-say-mmm-302577234.html
- Refresh analysis (cravemark, typeface, agency, "hottest color"): https://www.marketingdive.com/news/inside-dominos-first-refresh-in-a-decade-including-its-cravemark/801945/ ·
  https://news.designrush.com/dominos-brand-refresh-rebranding-shaboozey-logo-design
- Typeface lineage (TT Commons Pro → Domino's Sans, Terrance Weinzierl):
  https://typetype.org/font-in-use/domino-s-pizza/ · http://typeterrance.com/custom-fonts-for-dominos2 ·
  https://www.typewolf.com/tt-commons · https://typetype.org/fonts/tt-commons-pro/
- Google Font substitutes (verified live HTTP 200): Hanken Grotesk
  https://fonts.google.com/specimen/Hanken+Grotesk · Sora
  https://fonts.google.com/specimen/Sora · Baloo 2
  https://fonts.google.com/specimen/Baloo+2
- Reference #1 (downloaded): https://ommasign.com/dominos-case-study/ (image https://ommasign.com/wp-content/uploads/2024/01/image1.jpg)
- Reference #2 (Pie Pass pickup): https://www.sixteen-nine.net/2020/02/17/dominos-starts-using-digital-signage-to-improve-mobile-order-pickup/ → https://invidis.com/sixteen-nine/2020/02/17/dominos-starts-using-digital-signage-to-improve-mobile-order-pickup/
- Reference #3 (2026 Pizza Tracker stages): https://ir.dominos.com/news-releases/news-release-details/dominosr-updates-its-iconic-industry-first-tracker-even-better ·
  https://www.restaurantbusinessonline.com/technology/dominos-upgrades-pizza-tracker-more-play-play · https://www.dominos.com/en/tracker
- Menu structure: https://www.dominos.com/en/ (menu nav) + signage case studies (Yodeck https://www.yodeck.com/case-studies/dominos-pizza-digital-menu-boards/ )
- Store/signage context: https://biz.dominos.com/about-us/innovations/

**Unverified / flagged:** exact "hottest" 2025 hex values (none published —
using documented 2012 PMS-matched values + a derived "bright" step); the
`#0B648F` blue (single-source scrape artifact, superseded by `#006491`);
premium black+gold accent hexes (eyeballed approximations, premium-SKU only).
