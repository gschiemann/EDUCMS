# Domino's Pizza Signage Pilot — Real Images + Current Pricing

**Date:** 2026-05-29
**Purpose:** Source REAL Domino's pizza photos + CONFIRM current national pricing for the VenueOS menu-board mockup (internal pilot showing design intent for the POS-feed-driven menu board).
**Scope:** Read-only research + reference asset download. No app code modified.

---

## 1. Real pizza images (downloaded locally)

All images below are **genuine official Domino's product photography** pulled from Domino's own corporate media library (`media.dominos.com/multimedia/menu-items/` → `media.dominos.com/content/images/`). This is the authoritative source — the same shots Domino's distributes to press. They are full-resolution JPEGs (1500×2100 to 2376×1584), verified as valid image files locally.

**Important characterization:** Domino's brand photography is intentionally *"real food on a real table"* — lifestyle scenes with hands, boxes, drinks, and natural light, shot at 3/4 or near-overhead angles. Domino's does **NOT** publish clean studio top-down hero shots or transparent-background PNG cutouts of pizzas in its public media library (their well-documented "no food stylists / untouched photography" stance is why). So none of these are isolated-on-white or transparent. The closest to a clean single-pizza "hero" are the two overhead-in-an-open-box shots below. If the mockup needs a pure transparent cutout, that has to be cut out manually in an editor OR sourced from a stock/licensed library (see licensing caveat §3).

Local directory: `/Users/gschiemann/Desktop/EDU CMS/scratch/dominos-refs/`

| Local file (absolute path) | Source URL | Description |
|---|---|---|
| `/Users/gschiemann/Desktop/EDU CMS/scratch/dominos-refs/dominos-hero-pepperoni-jalapeno-overhead.jpg` | https://media.dominos.com/content/images/menu_hand-tossed-pizza_2024_04.jpg | **BEST single-pizza hero.** Near-top-down whole pepperoni + jalapeño hand-tossed pizza in an open Domino's box on a dark table, one slice being lifted (light cheese-pull). Minimal clutter. Portrait 1500×2100. |
| `/Users/gschiemann/Desktop/EDU CMS/scratch/dominos-refs/dominos-specialty-spread-overhead.jpg` | https://media.dominos.com/content/images/specialty-pizzas.jpg | **BEST for a multi-item specialty board.** Full overhead spread of 5 whole specialty pizzas (pepperoni, veggie/supreme variants) on a dark wood table with boxes. Landscape 2313×1542. EXIF caption: "Speciality - 3/4 - L HT - Family Casual". |
| `/Users/gschiemann/Desktop/EDU CMS/scratch/dominos-refs/dominos-extravaganzza-cheesepull.jpg` | https://media.dominos.com/content/images/menu_specialty-pizza_2024_01.jpg | **BEST featured-specialty hero.** Close 3/4 of a loaded supreme-style specialty (sausage, peppers, black olives, mushroom — reads as ExtravaganZZa/Deluxe) with a dramatic cheese-pull slice held up. Portrait 1500×2100. |
| `/Users/gschiemann/Desktop/EDU CMS/scratch/dominos-refs/dominos-pepperoni-table-wide.jpg` | https://media.dominos.com/content/images/menu_hand-tossed-pizza_2024_02.jpg | Wide overhead pepperoni + jalapeño pizza, daylight table scene with hands + a slice lift. Landscape 2100×1500 — good as a wide banner / background strip. |
| `/Users/gschiemann/Desktop/EDU CMS/scratch/dominos-refs/dominos-veggie-table-vertical.jpg` | https://media.dominos.com/content/images/menu_hand-tossed-pizza_2024_01.jpg | Veggie pizza (green pepper, onion, mushroom) on a table, slice lift with cheese-pull, daylight. Portrait 1500×2100. Secondary option. |
| `/Users/gschiemann/Desktop/EDU CMS/scratch/dominos-refs/dominos-spicy-chicken-bacon-ranch-overhead.jpg` | https://media.dominos.com/content/images/spicy-chicken-bacon-ranch_01.jpg | Overhead Spicy Chicken Bacon Ranch specialty, warm "game night" lighting, slice lift. 2376×1584. Secondary option. EXIF caption: "Specialty - 3/4 - L HT SCBR - NIGHT". |

**Recommendation for the mockup:** use `dominos-hero-pepperoni-jalapeno-overhead.jpg` as the main featured-item photo and `dominos-specialty-spread-overhead.jpg` for the specialty section. Both are overhead, both read clean at signage distance.

> Note: a pre-existing file `ommasign-dominos-menuboard.jpg` (1920×1080) was already present in `scratch/dominos-refs/` when this task ran (timestamped earlier today) and was left untouched — not sourced by this research.

### How these were sourced (reproducible)
1. Domino's corporate newsroom: https://media.dominos.com/ → "Menu Items" gallery → https://media.dominos.com/multimedia/menu-items/
2. Sub-galleries: `/multimedia/menu-items/hand-tossed-pizza/` and `/multimedia/menu-items/specialty-pizzas/`
3. Full-res files live at `https://media.dominos.com/content/images/<name>.jpg` (thumbnails are the same path with `_thumb` before `.jpg`).
4. Downloaded with curl + a Safari User-Agent and a `media.dominos.com` referer (so a local copy survives any hotlink/referer checks at render time).

---

## 2. Current Domino's pricing (national / typical)

> **The whole point of the POS feed:** every number below is a *typical national / corporate-menu* figure. Domino's is franchised and **each store sets its own prices** — NYC and other high-cost metros run $2+ higher per pizza; rural Midwest stores run below these. A live POS integration (Square/Toast-style, per the VenueOS Concierge vision) is what makes a real franchisee's board show *their* exact prices. Treat these as the realistic placeholder set for the mockup.

### Mix & Match deal — CONFIRMED

- **$6.99 each, minimum 2 items.** Still the current national Mix & Match price as of May 2026.
- **What qualifies (pick any 2+):** medium 2-topping pizzas, Stuffed Cheesy Bread, Bread Twists / Parmesan Bread Bites, boneless chicken, pasta in a dish, Chocolate Lava Crunch Cakes, marbled cookie brownie, and (typically) wings.
- **Upcharges that break the flat $6.99:** premium crusts (Parmesan Stuffed Crust, Handmade Pan), bone-in wings, and some premium toppings add cost. Delivery fees / local store charges also apply.
- **Important nuance — carryout vs delivery:** Domino's *raised the carryout-only* Mix & Match tier above $6.99 in some markets (reporting on a carryout price bump), but the **headline $6.99 Mix & Match (the one to put on the board) remains current**. There is also a parallel promo: **2+ Parmesan Stuffed Crust 2-topping pizzas at $10.99 each** (with a free Slice Sauce) — a premium tier, not a replacement for $6.99.
- Sources: dominosnutritioncalculator.us (Mix & Match guide, updated 21 May 2026); dominos.com/en/deals; eatthis.com (carryout increase). See Sources.

> **Use `$6.99 each (2 or more)` on the mockup.** That is the live, supportable number.

### Specialty pizzas — by size

Domino's prices specialties on a **flat tier** (all specialties the same price at a given size), not per-recipe:

| Size | Price (typical national) |
|---|---|
| Small (10″) | **$11.99** |
| Medium (12″) | **$13.99** |
| Large (14″) | **$15.99** |

This flat tier applies to **ExtravaganZZa, MeatZZa, Pacific Veggie, Buffalo Chicken**, plus Deluxe, Ultimate Pepperoni, Philly Cheese Steak, Honolulu Hawaiian, Memphis BBQ Chicken, Wisconsin 6 Cheese, Cali Chicken Bacon Ranch, Spinach & Feta, etc.

- ✅ Best-supported figures (fastfoodmenuprices.com, May 2026 update — gives clean $11.99 / $13.99 / $15.99 across the whole specialty line).
- ⚠️ **Flag — conflicting higher numbers exist:** some aggregator pages list per-recipe specialty prices well above this (e.g. Medium ExtravaganZZa ~$15.46, Large ~$18.26; Medium MeatZZa ~$15.09, Large ~$18.33 from mealsprices.com). Those almost certainly reflect a **specific higher-cost franchise location**, not the national base. For a believable mockup, **use the flat $11.99 / $13.99 / $15.99 tier**; if the Lead wants the "big city" look, the higher per-recipe numbers above are the supported alternative. Either way this divergence is exactly what the POS feed resolves.

### Sides

| Item | Price (typical national) | Confidence |
|---|---|---|
| Stuffed Cheesy Bread (8 pc) | **$5.99** | ✅ Confirmed (fastfoodmenuprices, multiple aggregators) |
| Boneless Chicken (8 pc) | **$5.99** | ✅ Confirmed |
| Bone-in / Hot Wings (8 pc) | **$6.49** menu price (often **$7.99** as a carryout deal line) | ✅ Confirmed; the $7.99 is a promo, the $6.49 is the standalone menu price |
| Parmesan Bread Bites (16 pc) | **$2.99** | ✅ Confirmed |
| Bread Twists / Parmesan Bread Twists (8 pc) | **$5.99** (Parmesan Bread Twists cited at $5.99) | ⚠️ Best-supported estimate — Domino's mainly lists "Parmesan Bread Bites" (16pc, $2.99) now; the 8-pc Twists SKU + price varies by market |
| Cinnamon Bread Twists / Cinnamon Twists (8 pc) | **~$5.99** | ⚠️ Estimate — same SKU caveat as above; appears in the Perfect Combo bundle, not always priced standalone on aggregators |

> Note on Twists: Domino's menu has largely shifted to **Parmesan Bread Bites** and **Stuffed Cheesy Bread** as the headline bread sides; the classic 8-piece "Bread Twists / Cinnamon Bread Twists" still exist but their standalone price is inconsistently published (commonly ~$5.99). Use **Stuffed Cheesy Bread $5.99** and **Parmesan Bread Bites $2.99** as your safe, confirmed bread-side rows.

### Drinks

| Item | Price (typical national) | Confidence |
|---|---|---|
| 20 oz bottle (Coke / Sprite / etc.) | **$1.79** | ✅ Confirmed (fastfoodmenuprices) |
| 2-liter bottle (Coke / Sprite / etc.) | **$2.99** | ✅ Confirmed (fastfoodmenuprices; also appears as the drink in the $19.99 Perfect Combo) |

---

## 3. Licensing caveat (state this plainly in the pilot)

**The real Domino's pizza photos AND the Domino's logo/wordmark are Domino's IP — copyrighted photography and registered trademarks.**

- ✅ **Fine for an INTERNAL pilot / design-intent mockup** shown to the VenueOS team and to a prospective franchisee to demonstrate *what their board could look like*. This is non-commercial, internal, illustrative use.
- ❌ **A SHIPPED / production template that goes on real screens MUST NOT use these assets as-is.** A live customer board must use **the franchisee's own photography, Domino's-corporate-approved brand assets the franchisee is licensed to use, or properly licensed stock images.** Domino's corporate controls brand/photo usage for franchisees through its brand standards; pulling press-library shots onto a commercial signage product without that authorization is a trademark/copyright exposure.
- The cleanest production path: the franchisee uploads their own pizza photos (VenueOS already supports asset upload), OR VenueOS pulls Domino's-approved imagery through whatever brand-asset feed the franchise agreement provides. The POS integration supplies the *prices*; the franchisee/brand supplies the *images*.

**Bottom line for the mockup:** label it clearly as an internal design mockup using Domino's reference imagery for illustration only — not a shippable asset.

---

## Sources

Pricing:
- [Domino's Mix & Match Deal guide — updated 21 May 2026](https://dominosnutritioncalculator.us/dominos-mix-match-deal/)
- [Domino's official Deals page](https://www.dominos.com/en/deals)
- [Domino's Raises the Price of Mix and Match Deal for Carryout — Eat This, Not That](https://www.eatthis.com/dominos-carryout-mix-and-match-price-increase/)
- [Domino's Menu Prices — Fast Food Menu Prices, updated May 2026](https://fastfoodmenuprices.com/dominos-prices/) (primary pricing source for specialty tier, sides, drinks)
- [Domino's Menu Prices 2026 — mealsprices.com](https://mealsprices.com/menu-prices/dominos) (source of the higher per-recipe specialty figures, flagged as location-specific)
- [Domino's ExtravaganZZa product page](https://www.dominos.com/en/menu/specialty/S_ZZ/extravaganzza)
- [Domino's MeatZZa product page](https://www.dominos.com/en/menu/specialty/S_MX/meatzza)
- [Domino's bread/sides menu](https://www.dominos.com/en/menu/bread)

Images:
- [Domino's corporate media library (root)](https://media.dominos.com/)
- [Domino's Menu Items photo gallery](https://media.dominos.com/multimedia/menu-items/)
- [Hand Tossed Pizza gallery](https://media.dominos.com/multimedia/menu-items/hand-tossed-pizza/)
- [Specialty Pizzas gallery](https://media.dominos.com/multimedia/menu-items/specialty-pizzas/)
- [Domino's "transparency through photography" statement (PR Newswire)](https://www.prnewswire.com/news-releases/dominos-pizza-continuing-transparency-this-time-through-photography-97790229.html) (basis for the "real food, no stylists" note)
