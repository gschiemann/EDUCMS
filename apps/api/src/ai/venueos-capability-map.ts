/**
 * venueos-capability-map.ts — THE single source of truth for what VenueOS
 * widgets DO and what data makes each one FUNCTIONAL.
 *
 * 2026-06-28. Born from docs/research/2026-06-28-signage-concierge/
 * 01-CAPABILITY-MAP.md (code-verified). The problem it fixes: every AI prompt
 * (concierge, art-director, touch, signage) taught the model only widget NAMES —
 * never what a widget does, what config makes it live, or which "widgets" are
 * costumes (RSS_FEED / SOCIAL_FEED). So generated boards came out as pretty
 * shells: WEATHER with no location, COUNTDOWN with no date, LUNCH_MENU with no
 * lines, QR pointing at example.com.
 *
 * This module exports:
 *   - VENUEOS_WIDGET_CAPABILITIES : the structured functional catalog (the
 *     ~40 data/binding-bearing primitives an AI must drive — NOT the ~100
 *     themed full-canvas scene widgets, which are override-only).
 *   - WIDGET_CAPABILITY_BLOCK     : a tight prompt string BUILT from the
 *     catalog. Rides in every template-generation system prompt so the model
 *     knows what each widget DOES + which are live vs static vs costume.
 *   - INTEGRATION_VOCABULARY      : the live-data integrations the Concierge
 *     may PROPOSE (POS menus, weather auto-fetch, sponsors, scores/CTS) — honest
 *     about what needs a connected integration.
 *   - INTEGRATION_VOCABULARY_BLOCK: the rendered prompt string for the above.
 *
 * KEEP IN LOCK-STEP: the widget `key`s here are the renderer's real widgetTypes
 * (WidgetRenderer.tsx). The art-director's REQUIRED_WIDGET_TYPE map, the
 * sanitizer's TOUCH_GEN_ALLOWED_WIDGETS allow-list, and the concierge's WIDGETS
 * clamp set are NARROWER (intentionally — the generator only emits a subset).
 * The clamp/allowlist sets and this map currently DIVERGE by design (the
 * concierge talks in friendly element names like "headline"/"subtext"/"cta"
 * that fold to TEXT; the allow-list is the safety ceiling). This file is
 * internally consistent and is the place to teach capability honestly; it does
 * NOT widen the allow-list (that is a separate, deliberate, reviewed act).
 */

/** How the widget gets its content — drives how the AI must treat it. */
export type WidgetKind =
  /** Self-fetches / self-ticks live; needs no asset, just (sometimes) a config hint. */
  | 'live'
  /** Needs an asset / URL / feed bound to it to function. */
  | 'binding'
  /** Operator/AI text or arrays; functional the moment copy is filled. */
  | 'static'
  /** Does nothing until a tap action / QR target is wired. */
  | 'interactive'
  /** NOT functional yet — a placeholder. The AI must NEVER propose it as live. */
  | 'costume';

export interface WidgetCapability {
  /** The renderer's real widgetType (or a small group label). */
  key: string;
  kind: WidgetKind;
  /** One line: what it DOES on screen. */
  does: string;
  /** The config/data that makes it FUNCTIONAL (the keys the AI must fill). */
  needs: string;
}

/**
 * THE FUNCTIONAL CATALOG. Ordered by how often a generated board needs it.
 * Sourced field-by-field from the code-verified capability map doc.
 */
export const VENUEOS_WIDGET_CAPABILITIES: WidgetCapability[] = [
  // ── Text & copy (the strong static core) ──────────────────────────────
  {
    key: 'TEXT / RICH_TEXT',
    kind: 'static',
    does: 'Renders a block of copy (headline, body, kicker, label).',
    needs: 'config.content = the ACTUAL words. Never ship the literal "Your text here" / "Add your supporting text here" placeholder — write real copy or drop the zone.',
  },
  {
    key: 'ANNOUNCEMENT',
    kind: 'static',
    does: 'A titled notice card with priority color + optional icon/CTA.',
    needs: 'config.message (or body), title, priority (low|normal|high|urgent), optional badgeLabel/icon/cta.',
  },
  {
    key: 'QUOTE',
    kind: 'static',
    does: 'A large centered quote with attribution (verse, testimonial, value).',
    needs: 'config.quote + config.author — real words, not a placeholder.',
  },
  {
    key: 'TICKER',
    kind: 'static',
    does: 'A scrolling marquee of one-line messages.',
    needs: 'config.messages = string[] of REAL lines you wrote. Never "Add your scrolling message here". (A live-feed variant exists via customSync+customUrl but needs a connected feed.)',
  },
  // ── Live, self-running (functional out of the box) ────────────────────
  {
    key: 'CLOCK',
    kind: 'live',
    does: 'Live ticking time + date. Self-contained — works immediately.',
    needs: 'Nothing required. Optional config.timezone (IANA), format (24h), dateFormat. mode:"date" shows the date instead of the time.',
  },
  {
    key: 'WEATHER',
    kind: 'live',
    does: 'Live local weather (Open-Meteo, free, no key). Auto-fetches.',
    needs: 'config.location = the venue\'s city, US ZIP, or "lat,lng". WITHOUT it the widget shows the placeholder city "Springfield". Always seed the venue\'s location.',
  },
  {
    key: 'COUNTDOWN',
    kind: 'live',
    does: 'Live countdown to a target date/time (or a recurring window).',
    needs: 'config.targetDate = an ISO date/time of the REAL event. WITHOUT it the widget invents a meaningless "~30 days from now" counter. Gather the event date.',
  },
  // ── Binding (need an asset / URL) ─────────────────────────────────────
  {
    key: 'IMAGE',
    kind: 'binding',
    does: 'Shows a photo/graphic (or a live-generated QR when qrText is set).',
    needs: 'config.assetUrl (an uploaded asset / pasted URL). WITHOUT it = "Add Image" placeholder. For a QR: config.qrText = the real destination URL → a scannable code.',
  },
  {
    key: 'IMAGE_CAROUSEL',
    kind: 'binding',
    does: 'Rotates through several photos on a timer.',
    needs: 'config.urls (or assetUrls) = string[] of image URLs. Empty = "Add Photos".',
  },
  {
    key: 'VIDEO',
    kind: 'binding',
    does: 'Plays a video (autoplay, muted, looped on the player).',
    needs: 'config.assetUrl = a video asset URL. Empty = "Add Video".',
  },
  {
    key: 'LOGO',
    kind: 'binding',
    does: 'The venue\'s logo mark.',
    needs: 'config.assetUrl = the tenant\'s logo URL. WITHOUT it = an empty "Add Logo" shield. Seed it from the tenant brand kit when a logo is requested.',
  },
  {
    key: 'WEBPAGE',
    kind: 'binding',
    does: 'Embeds a live web page (server-proxied, SSRF-guarded). Live-only.',
    needs: 'config.url = a public https URL. Optional staticMode / refreshIntervalMs.',
  },
  // ── Static content widgets (operator/AI arrays — NO external feed) ─────
  {
    key: 'LUNCH_MENU',
    kind: 'static',
    does: 'A day-keyed menu list that highlights today\'s row.',
    needs: 'config.menu = a NEWLINE-joined string, one line per row as "Label: items" (e.g. "Monday: Pizza, Salad\\nTuesday: Tacos"). WITHOUT it = the hardcoded cafeteria sample. (Live POS pricing is a SEPARATE, POS-bound menu board — see integrations.)',
  },
  {
    key: 'BELL_SCHEDULE',
    kind: 'static',
    does: 'A period/time schedule, highlights the current period.',
    needs: 'config.schedule = array of {label,start,end} OR a newline "Period 1: 8:00-8:50" string. Operator-entered (no live SIS feed).',
  },
  {
    key: 'CALENDAR',
    kind: 'static',
    does: 'An upcoming-events list.',
    needs: 'config.events = array of {title,date,color}. Operator/AI-entered (no live ICS/Google feed).',
  },
  {
    key: 'STAFF_SPOTLIGHT',
    kind: 'static',
    does: 'A featured person card.',
    needs: 'config.staffName, role, optional bio + photoUrl.',
  },
  {
    key: 'DECORATION',
    kind: 'static',
    does: 'A purely decorative shape/accent element.',
    needs: 'Style config only — no data.',
  },
  // ── Interactive (DEAD until a tap action / target is wired) ───────────
  {
    key: 'Touch zones / CTA / QR',
    kind: 'interactive',
    does: 'A tappable zone on a kiosk (a CTA, a "Scan to join", a nav button).',
    needs: 'zone.touchAction = {type, target} — types: open-url, goto-scene, goto-template, play-video, show-overlay, webhook, request-help. WITHOUT an action a CTA does NOTHING when tapped. A QR (IMAGE with config.qrText) needs the destination URL.',
  },
  // ── Costumes — NOT live yet. NEVER propose as functional. ─────────────
  {
    key: 'RSS_FEED',
    kind: 'costume',
    does: 'COSTUME: shows hardcoded demo headlines only.',
    needs: 'No real feed binding exists. Do NOT propose it for "live news". Use a TICKER with copy you wrote instead.',
  },
  {
    key: 'SOCIAL_FEED',
    kind: 'costume',
    does: 'COSTUME: shows a static "Social Feed" label/icon only.',
    needs: 'No real embed exists. Do NOT propose it as a live social feed.',
  },
  {
    key: 'PLAYLIST (widget)',
    kind: 'costume',
    does: 'COSTUME: a placeholder tile; does NOT render the referenced playlist.',
    needs: 'Real playback is the player\'s playlist engine, not this widget.',
  },
];

/**
 * Build the prompt block from the catalog so the prose can NEVER drift from the
 * structured map. Grouped by kind so the model learns the categories. Kept
 * tight — it rides in the system prompt on every template-generation call.
 */
function buildWidgetCapabilityBlock(): string {
  const byKind: Record<WidgetKind, WidgetCapability[]> = {
    live: [], static: [], binding: [], interactive: [], costume: [],
  };
  for (const c of VENUEOS_WIDGET_CAPABILITIES) byKind[c.kind].push(c);

  const section = (title: string, kind: WidgetKind) =>
    byKind[kind].length
      ? [title, ...byKind[kind].map((c) => `  - ${c.key} — ${c.does} NEEDS: ${c.needs}`)]
      : [];

  return [
    'VENUEOS WIDGET CAPABILITIES — what each widget DOES and the data that makes',
    'it FUNCTIONAL (not a pretty empty shell). A generated board is only good if',
    'every widget has the data it needs to actually work.',
    '',
    'LIVE (self-updating — fill the one hint they need):',
    ...section('', 'live').slice(1),
    '',
    'STATIC (functional the moment you write the real copy/items):',
    ...section('', 'static').slice(1),
    '',
    'BINDING (need an asset URL / link to show anything):',
    ...section('', 'binding').slice(1),
    '',
    'INTERACTIVE (do NOTHING until a tap action / QR target is wired):',
    ...section('', 'interactive').slice(1),
    '',
    'COSTUMES — NOT functional yet. NEVER propose these as live data:',
    ...section('', 'costume').slice(1),
    '',
    'RULE: never emit a widget with placeholder content. WEATHER without a',
    'location, COUNTDOWN without a date, a menu without items, a QR pointing at',
    'example.com, or TEXT reading "Add your supporting text here" are all BROKEN',
    'boards. Fill real data, or omit the element.',
  ].join('\n');
}

/** The rendered widget-capability prompt block (built from the catalog). */
export const WIDGET_CAPABILITY_BLOCK: string = buildWidgetCapabilityBlock();

// ───────────────────────────────────────────────────────────────────────
// INTEGRATION VOCABULARY — the LIVE-DATA capabilities the Concierge may
// PROPOSE. Honest about what needs a connected integration vs what works
// out of the box. This is how the concierge can say "I can pull live prices
// from your POS" instead of only collecting "menu" as a static widget.
// ───────────────────────────────────────────────────────────────────────

export interface IntegrationCapability {
  name: string;
  /** What it makes possible on a board. */
  does: string;
  /** What the operator must have connected for it to be live. */
  requires: string;
}

export const INTEGRATION_VOCABULARY: IntegrationCapability[] = [
  {
    // 2026-09-22 — this used to promise auto-86 for Toast and Lightspeed, which
    // report no sold-out state at all (providers/toast.ts, lightspeed.ts). What
    // each POS really keeps live is POS_LIVE_FACTS in @cms/api-types.
    name: 'Live POS menu',
    does: 'A menu board BOUND to the venue\'s POS, per location: item names and prices come from the POS (Toast about 5 minutes after a menu publish; Square and a custom webhook as they change; Clover, Lightspeed and Shopify hourly). Sold-out items update on their own ONLY with Square or a custom webhook — Toast and Lightspeed do not report sold-out.',
    requires: 'a connected POS picked for THIS board — the POS CONTEXT block says whether one is. Without one, the board shows the items it was given, as a snapshot.',
  },
  {
    name: 'Live weather',
    does: 'A WEATHER widget auto-fetches the local forecast (free, no key) once it knows the venue\'s location.',
    requires: 'just the venue city/ZIP — works out of the box. Confirm the location (default to the venue\'s city).',
  },
  {
    name: 'Sponsors',
    does: 'A rotating sponsor strip with weighting, flight windows, and proof-of-impression counts (sports boards / ribbons).',
    requires: 'sponsor rows configured. Sports-vertical only.',
  },
  {
    name: 'Live scores / clock (CTS)',
    does: 'A live scoreboard — score, game clock, period — driven by a Daktronics/CTS console or operator phone.',
    requires: 'a connected score feed on a /board or /ribbon surface. Sports-vertical only.',
  },
  {
    name: 'Live stream',
    does: 'An HLS / YouTube / Twitch / Vimeo live video tile.',
    requires: 'a stream URL / configured channel.',
  },
];

/** The rendered integration-vocabulary prompt block (built from the catalog). */
export const INTEGRATION_VOCABULARY_BLOCK: string = [
  'LIVE INTEGRATIONS YOU CAN PROPOSE — be honest about what needs a connection:',
  ...INTEGRATION_VOCABULARY.map((i) => `  - ${i.name}: ${i.does} Requires ${i.requires}`),
].join('\n');
