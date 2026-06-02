# Multi-Location Guide — running many stores on VenueOS

*Plain-English admin guide for operators with more than one location (a 5-store
coffee chain or a 50-store QSR — same workflow). No IT person or paid setup
required.*

> **Status (2026-06-02 — read this first).** The building blocks are live:
> self-serve **POS connect** (Square, Clover, Lightspeed, Shopify), the
> **fleet map** with clustering, and the **per-location price engine** (a
> store's screens can show that store's own POS prices, and a manual price
> edit always wins). The streamlined **"Location" object** described below —
> one-click add, drop-a-pin, CSV bulk-add, and auto-matching a Location to its
> POS store — is the design we're building toward and the reason this guide
> exists. Where a step isn't fully wired yet it's marked **(building)**.
> Nothing here requires professional services — that's the whole point.

---

## The big idea

You have **one VenueOS account** for your whole brand. Inside it you add a
**Location** for each store. Each Location has an address (so it shows on the
map) and is linked to that store's POS. Screens belong to a Location.

You design a **menu/template once**. Every store's screens show that same
design — but the **prices, specials, and sold-out items come from each store's
own POS**. Change a price in your POS at the Dallas store and only the Dallas
screens update. You never build 50 menus; you build one and the data fills in
per store.

```
Your brand (one account)
└─ Location: "Dallas — Mockingbird"   (address + map pin + POS store link)
   └─ Screens: drive-thru, lobby, counter
└─ Location: "Austin — South Congress"
   └─ Screens: …
└─ … up to 50 locations, 150 screens
```

> You do **not** create a separate login/account per store. One account, many
> Locations. (Separate accounts are only for genuinely separate businesses or
> franchisees who must not see each other's content.)

---

## Setup in five minutes

**1. Add your locations.** Settings → Locations → **Add location**. Type the
store name and address — we drop it on the map for you. Have a lot of stores?
Use **Import** and paste a simple spreadsheet (`name, address, POS store`) to
add all 50 at once. **(building — single add + map pin are first; CSV next.)**

**2. Pair your screens to a location.** When you set up a screen (or on an
existing screen's settings), pick its Location from a dropdown. A store with
three screens just picks the same Location three times. Within a Location you
can still group screens (drive-thru vs. lobby) for scheduling.

**3. Connect your POS — once, for the whole brand.** Settings → POS → **Sign in
with Square** (or Clover / Lightspeed / Shopify). One connection covers all
your stores. *(Live today.)*

**4. Match each Location to its POS store.** After connecting, VenueOS lists
the stores it found in your POS. Pick which VenueOS Location each one is — or
let us **auto-match by name/address**. This is the one link that lets the POS
drive each store's prices. **(building — auto-match; manual match is wired.)**

**5. Put your menu on the screens.** Drop the menu board template on a Location's
screens. Prices, availability, and 86'd items now flow live from each store's
POS. Done.

---

## How prices work per location

- **The POS is the source of truth.** Set a price (or 86 an item) at a store in
  Square/Toast/Clover/Shopify and that store's screens update automatically —
  usually within a minute, plus an hourly safety re-sync.
- **Your manual edit always wins.** If you override a price for one Location in
  VenueOS, the next POS sync will **not** stomp it. (So you can run a
  location-specific promo the POS doesn't know about.)
- **No master price that breaks everything.** There is no single price applied
  to all 50 stores. Each store carries its own — exactly because, as you put it,
  "one overall mapping won't work."
- **Markets/regions** (e.g. "all Texas stores") — **(building)** a region tier
  above Location for rolling a price or special across a group of stores at once.

---

## Seeing everything — the map

Settings → Screens → **Map**. All your screens appear, clustered by location, so
50 stores show as 50 pins and you can zoom into the 150 individual screens.
Color shows status (online / offline / emergency). Filter and search by name or
address. **(Live today;** drop-a-pin add-a-location writes straight to a
Location — **building.)**

---

## Who can do what

- **Brand admin** (you) — add Locations, connect the POS, design templates,
  set prices.
- **Location manager** — **(building)** can be scoped to just their store(s):
  edit their prices/specials, nothing else. (Today, scoping is per sub-account;
  the per-Location manager role comes with the Location object.)

---

## FAQ

**Do I need a separate account/login for each store?** No. One account, many
Locations. Separate accounts are only for separate businesses/franchisees.

**Will connecting the POS overwrite the menu I designed?** No — the POS fills in
prices/availability into your design. Your template and layout stay yours.

**I changed a price in my POS — do I have to do anything in VenueOS?** No. The
matched store's screens pick it up automatically.

**Can two stores show different specials on the same template?** Yes — that's
the point. One template, per-store data.

**What if a store isn't in my POS yet?** Add the Location anyway and set prices
manually; link the POS store later.

---

*See also: `docs/research/2026-06-02-pos-scale-mapping/` for the competitor
research and the data-model decision behind this workflow.*
