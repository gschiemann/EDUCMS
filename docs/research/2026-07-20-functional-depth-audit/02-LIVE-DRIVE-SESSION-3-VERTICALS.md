# Functional Depth Audit — Session 3: Vertical Coverage (overnight autonomous run)

**Greg's directive: "test every company type — schools, restaurants and gyms will be key."
Method: provisioned two disposable child tenants through his authenticated admin session
(product API, no account creation, token never left his browser), drove each vertical's
experience via the app's own flows, then deleted them — and the deletion attempt itself
caught a shipped bug.**

## Verticals — witnessed results (D / UX / F)

| Vertical | Tenant driven | Verdict |
|---|---|---|
| **Schools (K12)** | Springfield (session 1) + gym-tenant default state | A / A / A- — age filters, school categories, honest fleet dashboard |
| **Sports** | Dodgers (session 2) | A / A / A- — scoreboard/ribbon/sponsor categories, swim boards, live engine editing |
| **Restaurants (QSR)** | Audit QSR Cafe (disposable) | **A / A / A-** — Menu boards / Promo & combos / Loyalty categories; designed 4K presets (Fine Dining Wine List, Brunch Spot w/ daypart split, Bakery/Patisserie) |
| **Gyms (GYM)** | Audit Gym Club (disposable) | **A / A / A-** — Class & training / Welcome / Promo; designed presets (Locker Room welcome kit, coach Split-Duo, Welcome Poster) |

**Industry-switch flow (Settings → "Industry: Switch") — A.** Plain-language picker
(School/Gym/Store/Office/Restaurant/Boutique/Bar/Practice/Property), applies instantly,
and — the standout detail — **per-vertical safety defaults follow it: Emergency alerts
flipped ON→OFF when the tenant went School→Gym** (K12 defaults armed; commercial calm).
The whole templates surface reseeds to the new vertical.

## False finding AVOIDED (two-method discipline)

My first look at the QSR tenant showed SPORTS categories + Dodgers branding — logged-worthy
at first glance. Root cause: my own programmatic tenant switch stored a pre-patch user blob
and stale JWT claim. **The app's real switcher does everything correctly** (clean VenueOS
brand, right categories, Sports nav correctly absent). No product bug; footnote only:
vertical rides a JWT claim, so any future vertical-write path must refresh the token the
way the switcher/VerticalSwitcherCard do.

## BUG FOUND + FIXED (shipped `cdd8ed30`): location deletion NEVER worked

Deleting the disposable tenants 409'd `TENANT_DELETE_ACTIVE_EMERGENCY` — on tenants
created minutes earlier. DB ground truth: their `emergency_status` = **'INACTIVE'** (the
fleet's at-rest value; the parent Dodgers tenant carries it too). The guard only accepted
'NORMAL'/'' as calm → **every tenant in the system was undeletable since the guard
shipped, with a false, alarming "active emergency" message.** Fix: calm set is now
''/NORMAL/INACTIVE; real trigger-written severities (e.g. CRITICAL) still block. 3 spec
cases added (incl. the exact false-409 repro). Live verification = the audit cleanup
deletes after deploy.

## Smaller findings

- **Test-tenant clutter in prod**: dozens of automated-test tenants (A2/A3/A4/Beta
  Test/Masonry/Modal…) fill the SUPER_ADMIN switcher. Pre-launch cleanup task; also
  consider tagging harness tenants for auto-purge.
- Switcher design itself is good: PRIMARY-only top level with child expanders + counts.
- Cross-tenant login redirect drops to home tenant (defensible; footnote).
- Session token lives in sessionStorage when "Keep me signed in" is unchecked —
  correct behavior; recorded for future tooling.

## Carried forward (next session)

**Top: the Edit-with-words P1 fix** (proposal must name its target element; compound →
multiple ops; size changes clamp through the auto-fit floor) — precisely scoped in
`01-LIVE-DRIVE-SESSION-2.md`. Then: imports drive, POS/streaming/social boundaries,
mobile-viewport pass, player pairing, screens-module isolation tranche (27), coverage
table finalization.
