**Scope:** the AI Integration Concierge vision, the three-tier AI economic model, and "Design Imports = Template Feature". Product direction, not a gate. Moved verbatim from the old single-file `CLAUDE.md` on 2026-11-01 (move map: `docs/governance/decisions/2026-11-01-rulebook-restructure-map.md`); `/CLAUDE.md` §12 is the always-loaded summary of the AI rules.

# Concierge, AI economics and design imports

## AI Integration Concierge — vision

Operator vision (2026-05-26): *"make shit not so overwhelming for people that they don't need to get an IT guy or consultants that cost so much money to just configure an integration with their POS, or streaming service for a gym, or template creation, make the path so automated that they don't know how they worked without VenueOS in the past."*

The Integration Concierge is the AI-driven discovery + setup layer that sits between the operator and the integration surface. Goal: an operator pastes their website URL OR describes their business in one sentence, and the Concierge proposes the integration stack, wires up the connectors, and auto-seeds the first templates.

### Workstreams

1. **`POST /api/v1/integrations/discover`** — pasted URL → scraped homepage + meta → classifier returns a ranked list of provider candidates per category. (POS, reservations, payments, streaming, calendar, email, fitness, identity, SIS, social, music, sponsorship.) Provider rules carry regex signals + weighted score + plain-English blurb the Concierge UI shows.

2. **`POST /api/v1/integrations/describe`** — free-text description → keyword extraction → ranked provider candidates. Catches operators who don't have a public URL yet (new venues, planned openings).

3. **Concierge UI**: after onboarding's branding step, a "Recommended integrations" wizard step. Each suggestion has: badge ("we found Toast on your site"), confidence, blurb, "Connect" / "Skip" buttons. Connect launches the provider's OAuth or guided setup. Skip remembers and won't re-suggest.

4. **Auto-seeded templates per vertical**: when an integration connects (e.g., Toast POS), the Concierge offers to drop a Menu Board template pre-wired to that integration's live data. One click → operator has a working board on screen.

5. **AI as the explainer**: if the operator hovers an unfamiliar integration ("what's Square Catalog?") the Concierge calls the platform AI (see Economic Model below) for a 1-sentence plain-English explanation. Metered like every other AI call on our key, against the included allowance (see the Economic Model below).

6. **Diagnostic concierge**: if an integration goes RED, the AI assistant explains the likely cause + a 3-step fix in plain English instead of dumping a stack trace.

7. **Build-it-for-me**: an operator describes a template in one sentence ("a soccer scoreboard with our sponsors rotating on the bottom strip and a fan-cam upper-right") and the Concierge proposes a Template draft with widgets + zones + brand-palette applied, ready for the operator to tweak. Underlying call: the existing AI touch-template service, exposed in a guided wizard instead of a free-text modal.

### Economic Model (3 tiers)

Operator's intent (2026-05-26): *"we would have to use our own AI integration that our setup agent would use but use would be minimal and then the customer pays for their areas that we can call more creative AI...we will evolve that piece of the app further to where they can do a subscription and then we set them up with AI so they don't need their own API keys."*

| Tier | AI provider | Who pays | Usage cap |
|---|---|---|---|
| **Platform Concierge** (setup-time) | VenueOS's `ANTHROPIC_API_KEY` | VenueOS | The included allowance, in dollars: `max($5 floor, paired screens × $2.50)` per organisation per UTC month (`AI_INCLUDED_USD_FLOOR` / `AI_INCLUDED_USD_PER_SCREEN`) is the hard ceiling, plus counted boards and images per paired screen (10 / 20; a free trial 2 / 2); beyond it, 402 `AI_CAP_REACHED` |
| **Customer BYOK Creative** (everyday) | Tenant's own Anthropic/OpenAI/Google key | Tenant pays their provider | Subject to their provider's rate limits + our 120/hr/tenant abuse cap (`AI_HOURLY_CAP`, default 120) |
| **Managed-AI Subscription** (shipped 2026-10-12 as the VenueOS + AI plan: $25/screen/month or $250/screen/year) | VenueOS's keys, pooled per organisation | Tenant pays VenueOS (`STRIPE_PRICE_MONTHLY_AI` / `STRIPE_PRICE_ANNUAL_AI`) | The counted boards and images per paired screen per UTC month, under the same dollar ceiling |

The Concierge calls live on Tier 1. Sparkle button on widgets + Touch Template Generator + AI alt-text live on Tier 2. Tier 3 shipped (2026-10-12) as the VenueOS + AI plan — see the Stripe price rows in the environment table.

The platform must NEVER silently spend Tier-1 budget on Tier-2 actions. A tenant with no key of its own and no AI plan or free trial gets a 402 `AI_PLAN_REQUIRED` ("Add VenueOS AI for $5/screen/month … or connect your own AI key for free", `byokAvailable: true`) — never a silent fall-back to the platform key.

## Design Imports = Template Feature (not a Setting)

Operator demand (2026-05-26): *"design imports... this entire settings page should not be under settings, it should be under the template section itself, it's not a setting it's a feature."*

Imports live at `/[schoolId]/templates/imports`, not `/[schoolId]/settings/imports`. The old path stays as a permanent redirect for muscle memory. The Templates page has a primary "Import design" button next to "New template."

The UX is upload → preview every page → choose "Create as Template" or "Create as Playlist" → confirm. After confirm, the operator lands on the Templates index with the new template selected, OR the Playlists index with the new playlist selected. No more "I uploaded something, where did it go?"

The page renders inside the brand shell — same chrome, same palette, same fonts as the rest of `/templates`. Not a stranded slate-colored sub-page.
