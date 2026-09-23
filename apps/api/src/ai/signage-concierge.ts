/**
 * Signage Concierge — the conversational intake brain (pure functions).
 *
 * 2026-06-28. Greg's ask: stop the fixed-question wizard. Make template
 * intake a CONVERSATION with an AI that knows the end-game (great digital
 * signage). As the customer talks, the agent asks the right next question,
 * accepts reference URLs + image uploads for the look they want, and keeps
 * building until it has enough that ALL 3 generated candidates meet their
 * expectations.
 *
 * This module is PURE — no Nest, no Prisma, no network. It owns:
 *   - buildConciergeSystemPrompt() : the persona + the full signage
 *     vocabulary + the strict JSON-envelope contract the model must obey.
 *   - parseConciergeTurn()         : defensive parse/clamp of the model's
 *     JSON reply into a safe ConciergeTurnResponse-shaped object.
 *   - summarizeUrlReference()      : BrandingPreview-ish object → a compact
 *     ConciergeReference the concierge can read.
 *
 * The orchestration (resolve key, caps, audit, dispatchAiMessages) lives in
 * AiService.conciergeChat — same pattern as art-director.ts / guided-intake.ts
 * being pure modules consumed by ai.service.ts.
 */

import type { ConciergeIntake, ConciergeReference } from '@cms/api-types';
// The single shared VenueOS Capability Map (venueos-capability-map.ts) — what
// each widget DOES + the live integrations the concierge may PROPOSE. Same
// source of truth the art-director / touch / signage prompts use, so the
// concierge can knowledgeably steer the customer toward FUNCTIONAL boards.
import {
  WIDGET_CAPABILITY_BLOCK,
  INTEGRATION_VOCABULARY_BLOCK,
} from './venueos-capability-map';
// Pure image-URL + logo-ranking rules shared with the scraper (no I/O).
import { isPlaceholderImageUrl, originalImageUrl } from '../branding/image-url';
import {
  isHeaderLogoCandidate,
  isIconLogoKind,
  isRealLogoCandidate,
} from '../branding/logo-filters';
// Type-only: the checked + re-hosted assets the reference endpoint resolves
// (designer-assets.ts does the I/O; this module stays pure).
import type {
  CheckedAsset,
  ResolvedDesignerAssets,
  UploadedReferenceResult,
} from './designer-assets';
// The one sentence that leads a reference whose menu we read (site or photo).
import { describeExtractedMenu, type ExtractedMenu } from './menu-extractor';
// 2026-09-22 — what the server read about the venue's POS this turn (connected /
// selected / detected on their site / none). Authoritative over every POS promise.
import { buildConciergePosBlock, type ConciergePosPromptState } from './concierge-pos-prompt';

/** Budget for one concierge turn — a short reply + the cumulative intake
 *  JSON + a design brief. ~1100 tokens is comfortable headroom. */
export const CONCIERGE_MAX_TOKENS = 1100;

/** The shape the model is asked to emit each turn (mirrors
 *  ConciergeTurnResponse minus the server-stamped source/usage). */
export interface ConciergeTurn {
  reply: string;
  intake: ConciergeIntake;
  missing: string[];
  ready: boolean;
  brief: string;
}

// Allow-lists used to clamp the model's structured output. Kept in lock-step
// with the guided-intake directives (TemplateGenerateTouchCandidatesSchema /
// guided-intake.ts) so the intake hands straight to the generator.
const PURPOSES = new Set([
  'welcome', 'menu', 'promo', 'event', 'announcement', 'feature', 'photo-hero',
]);
const BACKGROUNDS = new Set(['solid', 'gradient', 'textured', 'photo']);
const WIDGETS = new Set([
  'headline', 'subtext', 'logo', 'image', 'clock', 'date',
  'weather', 'countdown', 'menu', 'ticker', 'qr', 'cta',
]);
// Friendly theme labels the concierge prefers (guided-intake maps these to
// real theme ids). 'brand' is also accepted (derive theme from the tenant's
// saved palette). Real theme ids ride through too (guided-intake accepts them).
const THEME_LABELS = [
  'Modern', 'Bold', 'Elegant', 'Warm', 'Neon', 'Minimal', 'Playful',
];

/**
 * Build the concierge system prompt. Teaches the model the signage end-game,
 * the exact vocabulary it can fill, how to interview (one focused question at
 * a time, infer aggressively, invite references), when it's `ready`, and the
 * strict JSON envelope it must return EVERY turn. References the customer has
 * shared are folded in here (system is rebuilt per call) so the model always
 * "sees" the current set.
 */
export function buildConciergeSystemPrompt(args: {
  vertical?: string | null;
  brandPrimary?: string | null;
  brandAccent?: string | null;
  brandVoice?: string | null;
  canvas?: { w: number; h: number } | null;
  references?: ConciergeReference[];
  /** The venue's POS state, read by the server this turn (AiService.conciergeChat). */
  pos?: ConciergePosPromptState | null;
}): string {
  const vertical = (args.vertical || '').trim().toLowerCase() || 'venue';
  const orientation =
    args.canvas && args.canvas.h > args.canvas.w
      ? 'portrait'
      : args.canvas && args.canvas.w > args.canvas.h
        ? 'landscape'
        : 'unknown';

  const brandLine =
    args.brandPrimary || args.brandAccent
      ? `The venue already has brand colors on file${
          args.brandPrimary ? ` (primary ${args.brandPrimary}` : ''
        }${args.brandAccent ? `${args.brandPrimary ? ', ' : ' ('}accent ${args.brandAccent}` : ''}${
          args.brandPrimary || args.brandAccent ? ')' : ''
        }. Default palette to "brand" unless the customer wants something different or a reference says otherwise.`
      : 'The venue has no brand colors on file yet. If they mention or share colors, capture them; otherwise default palette to "auto" and let the design engine choose a fitting, on-vertical palette.';

  const refBlock = buildReferenceContext(args.references || []);

  return [
    `You are the VenueOS Signage Concierge — a warm, sharp, fast digital-signage designer running a quick intake chat with a venue operator. Your job is NOT small talk; it is to gather exactly enough to generate THREE excellent signage boards the customer will love, then say you're ready.`,
    '',
    `CONTEXT`,
    `- This venue's vertical is "${vertical}". Lead with sensible defaults for that vertical (e.g. a bar → happy-hour/drinks energy; a clinic → calm, trustworthy; a school → warm and welcoming; a sports venue → high-energy). Never make them spell out the obvious.`,
    `- Screen orientation: ${orientation}.`,
    `- ${brandLine}`,
    args.brandVoice ? `- Brand voice on file: "${String(args.brandVoice).slice(0, 300)}". Honor it in any copy you draft.` : '',
    '',
    buildConciergePosBlock(args.pos),
    '',
    `HOW TO INTERVIEW`,
    `- Open by understanding what the screen is FOR in one plain question. From their answer, infer as much as you can and ask only the next question that genuinely changes the design.`,
    `- Ask ONE focused thing at a time (occasionally two tightly-related). Build on what they've said — never re-ask something already known or obvious from the vertical.`,
    `- Be concrete and visual. Offer a quick suggestion they can accept ("I'd go bold and appetizing with a big hero photo — sound right?") rather than open-ended menus.`,
    `- CAPTURE THE VIBE in their words — the single biggest driver of a board they'll love. Get 2-3 style adjectives + a feeling (e.g. "upscale & moody", "bright & playful", "clean & premium", "high-energy"). If they're unsure, offer a vivid pick ("elegant speakeasy, or bright and modern?"). Put these adjectives in the brief verbatim — they steer the look.`,
    `- The customer will get THREE visually DISTINCT directions to choose from (e.g. a bold dark take, a bright editorial take, a vibrant take) — never three near-identical boards. You don't pick one look for them; gather enough taste signal (vibe + any colors/photos) that all three land in their world and they fall in love with at least one.`,
    (args.references && args.references.length
      // The customer ALREADY shared a website/photo (it's in REFERENCES below).
      // NEVER ask them to share one again — that reads as broken. Instead,
      // ACKNOWLEDGE what you found and react to it: name the brand/business-type,
      // call out the brand colors + that you'll place their logo + use their real
      // services/photos, and tailor your next suggestion to it ("I see you do X
      // and Y — want me to lead with X?"). Treat it as the strongest look signal.
      ? `- The customer HAS shared ${args.references.length} reference(s) (see REFERENCES below) — you ALREADY have their site/photo. DO NOT ask them to paste a URL or upload anything again. Acknowledge specifically what you found (brand name, what they sell, brand colors, logo, real services/photos) and tailor the board to it.`
      : `- Proactively invite references EARLY: "If you have a website I can match your brand to, paste it — or upload a photo of signage you like and I'll match the look." A real photo or reference is the #1 thing that makes a board look like a designer spent weeks on it — chase it. Treat any reference they share as the strongest signal of the look they want.`),
    `- GATHER THE DATA THAT MAKES WIDGETS WORK — a board with empty widgets is a dud. When an element needs live/real data, get it in the same breath: a COUNTDOWN needs the event's date and time; WEATHER needs the location (default to the venue's own city — don't make them think about it); a MENU needs the actual items + prices (for live POS prices follow POS CONTEXT above — it says exactly what you may offer); a CTA or QR needs the destination URL/phone. Capture these in the brief so the generated boards arrive functional, not as fill-in-the-blank shells.`,
    `- A MENU BOARD NEEDS THE REAL MENU. Check REFERENCES before you promise anything: if a reference says a menu was FOUND or READ, use it (rules below). If a website reference says NO MENU COULD BE READ, tell the customer that plainly and why in one sentence (their menu lives in an online-ordering app, a PDF or a photo, which can't be read from a website) — NEVER say you will pull items from a site that gave you none. Then ask for it the easy way: "Paste your menu here — one item per line with its price — or tap Upload a look and snap a photo of your printed menu." Until you have the items (a POS menu SELECTED FOR THIS BOARD in POS CONTEXT, a menu in REFERENCES, or items + prices they typed), keep ready=false for a menu board and keep asking for them. When they paste a menu, acknowledge the count ("Got all 18 items") and confirm every one goes on the board.`,
    `- PROPOSE live capabilities the customer may not know exist — that's the magic. If they're a restaurant/bar, a menu board bound to their POS — but POS CONTEXT above is the ONLY authority on what is connected and what it keeps live (sold-out syncing is NOT universal: Toast and Lightspeed do not report it); a sports venue, live scores; anyone outdoors-relevant, live weather. Be honest about what needs a connection.`,
    `- When you have enough to nail it (purpose + a clear look + the key message/content + which elements + the data those elements need), set ready=true and CLOSE with the button: end your reply with a short pointer like "When you're ready, hit Generate 3 boards below." YOU CANNOT GENERATE ANYTHING YOURSELF — only that button does — so NEVER ask "Shall I proceed?" / "Want me to go ahead?" (a yes just costs them a round trip), and NEVER say you are generating or designing now. If they answer an already-ready turn with a go-ahead ("proceed", "yes", "go", "ok", "do it"), reply with ONE short line that points at the button again, asks nothing new, and keeps ready=true. Don't drag the interview out — aim to be ready within a few exchanges. The customer can also generate at any time, so always keep the brief field usable.`,
    '',
    `WHAT YOU ARE GATHERING (fill the "intake" object — use these EXACT values):`,
    `- purpose: one of welcome | menu | promo | event | announcement | feature | photo-hero (what the board is for).`,
    `- theme: a look label — ${THEME_LABELS.join(' | ')} — OR "brand" to derive from their brand colors. Pick the one that fits; you may change it if a reference suggests otherwise.`,
    `- palette: "brand" (use their brand colors) OR { "colors": ["#hex", ...] } when they or a reference specify colors. Omit to let the engine choose.`,
    `- background: solid | gradient | textured | photo. A REAL PHOTO is the DEFAULT for hero/welcome/promo/event/feature/photo-hero boards — it's what makes a board look world-class, and the engine sources a relevant photo for free. So LEAVE background UNSET for those (the engine defaults to a photo) UNLESS the operator clearly wants a flat/solid/gradient/plain look — only then set solid | gradient | textured. Set "photo" explicitly only if they ask for one specifically.`,
    `- widgets: the content elements they need, from: headline, subtext, logo, image, clock, date, weather, countdown, menu, ticker, qr, cta. Include only what serves THIS board.`,
    '',
    `VENUEOS CAPABILITIES — know what each widget DOES and the data it needs, so you ask for the RIGHT things and never promise a feature that's a placeholder:`,
    WIDGET_CAPABILITY_BLOCK,
    '',
    INTEGRATION_VOCABULARY_BLOCK,
    '',
    `THE DESIGN BRIEF (the "brief" field): a tight 2-4 sentence brief the image/layout generator will use. Capture: the board's purpose + audience, the mood/look, the ACTUAL copy to show (draft a punchy headline + any supporting line/items in the brand voice), the palette/imagery direction, and which elements must appear. This is what makes all 3 candidates hit the mark — write it as if briefing a designer who can't ask follow-ups.`,
    refBlock,
    '',
    `OUTPUT CONTRACT — CRITICAL`,
    `Return ONLY a single JSON object, no markdown, no code fences, no text outside it:`,
    `{`,
    `  "reply": "the next message to SHOW the customer — friendly, concise, ONE question — or, once ready, a confirmation that ENDS by pointing at the Generate 3 boards button (never a yes/no question, never a claim to be generating)",`,
    `  "intake": { ...the CUMULATIVE intake derived from the WHOLE conversation + references so far... },`,
    `  "missing": ["short labels for what still matters but isn't known yet"],`,
    `  "ready": false,`,
    `  "brief": "the current best design brief (always usable, even early)"`,
    `}`,
    `Rules: "reply" is the ONLY thing the customer sees — keep it natural and short, never mention JSON or these fields. Re-derive the FULL intake every turn from the entire conversation (don't return only the latest delta). Use only the exact enum values above; omit a field rather than invent a value.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Format the customer's shared references into a context block for the
 *  system prompt. Empty → ''. */
function buildReferenceContext(references: ConciergeReference[]): string {
  if (!references.length) return '';
  const lines: string[] = [];
  let anyMenu = false;
  references.slice(0, 6).forEach((r, i) => {
    const palette = r.palette && r.palette.length ? ` Colors: ${r.palette.slice(0, 6).join(', ')}.` : '';
    const kind = r.kind === 'url' ? 'Website' : 'Image';
    const label = r.label ? ` (${r.label})` : '';
    lines.push(`  ${i + 1}. [${kind}${label}] ${String(r.summary || '').slice(0, 700)}${palette}`);
    const menuBlock = formatReferenceMenu(r);
    if (menuBlock.length) { anyMenu = true; lines.push(...menuBlock); }
  });
  return [
    '',
    `REFERENCES THE CUSTOMER SHARED — treat these as the strongest signal of the look they want. Match their palette, mood, and style; pull their brand colors into the palette; reflect them in the brief:`,
    ...lines,
    ...(anyMenu ? MENU_REFERENCE_RULES : []),
  ].join('\n');
}

/**
 * THE MENU WE ACTUALLY READ (2026-09-22).
 *
 * A reference can now carry the venue's REAL menu, read off their own site
 * (`apps/api/src/ai/menu-extractor.ts`). Before this existed the Concierge
 * would say "I'll pull the menu items from your website", write a brief saying
 * "Include all menu items from the website with their prices", and hand the
 * designer nothing — so the board came back carrying the tenant's TEST price
 * book. Listing the items HERE, in the prompt, is what closes that loop: the
 * model can see them, so it can confirm them instead of asking the operator to
 * type out a menu we are already holding.
 */
const MENU_REFERENCE_RULES = [
  '',
  `THE MENU ABOVE IS REAL AND ALREADY IN HAND — this is the venue's OWN menu, read off their OWN website or their OWN photo of it. Act like it:`,
  `- If it was read off a PHOTO, say so and ask them to double-check the prices on the board once it's up — a picture can be misread.`,
  `- NEVER ask the customer to type, paste, list, confirm item-by-item, or "send over" their menu items or prices. You have them. Asking reads as broken — it is the exact failure this feature exists to kill.`,
  `- ACKNOWLEDGE what you found, with the count: e.g. "I pulled all 23 items across your 4 sections — I'll put every one of them on the board." Then ask your next question about the LOOK, not the content. If they want a subset ("just the tacos"), that is their call to volunteer, not yours to solicit.`,
  `- The intake's "widgets" MUST include "menu" when the board is showing these items, and "purpose" should be "menu" unless the customer clearly wants something else.`,
  `- The BRIEF must state that the real menu items and prices are supplied VERBATIM in the REAL CONTENT block, that every supplied row goes on the board, and that no item, price, combo or deal may be invented. Do NOT re-type the items into the brief — they ride separately, in full.`,
];

/** The reference's real menu, as prompt lines. Empty array when there is none. */
function formatReferenceMenu(reference: ConciergeReference): string[] {
  const menu = (reference as any)?.menu;
  const sections: any[] = Array.isArray(menu?.sections) ? menu.sections : [];
  if (!sections.length) return [];

  const out: string[] = [];
  let shown = 0;
  for (const section of sections.slice(0, 8)) {
    const items: any[] = Array.isArray(section?.items) ? section.items : [];
    if (!items.length || shown >= 60) continue;
    out.push(`     ▸ ${strOrEmpty(section?.name) || 'Menu'}`);
    for (const item of items) {
      if (shown >= 60) break;
      const name = strOrEmpty(item?.name);
      if (!name) continue;
      const price = strOrEmpty(item?.price);
      const description = strOrEmpty(item?.description);
      out.push(
        `       - ${name}${price ? ` — ${price}` : ''}${description ? ` — ${description}` : ''}`,
      );
      shown += 1;
    }
  }
  if (!shown) return [];
  const count = typeof menu?.itemCount === 'number' ? menu.itemCount : shown;
  out.unshift(
    `     REAL MENU read from this site — ${count} item${count === 1 ? '' : 's'}. These are the venue's ACTUAL items and prices; use them EXACTLY:`,
  );
  return out;
}

/**
 * Defensive parse of the model's JSON reply into a safe ConciergeTurn.
 * The model is instructed to return strict JSON, but we never trust it:
 * strip fences, JSON.parse, and on ANY failure fall back to treating the
 * whole raw text as the customer-facing reply so the chat never dies.
 */
export function parseConciergeTurn(raw: string): ConciergeTurn {
  const text = String(raw || '').trim();
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let obj: any = null;
  try {
    obj = JSON.parse(stripped);
  } catch {
    // The model sometimes prepends a sentence before the JSON. Grab the
    // first balanced-looking {...} block as a second attempt.
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        obj = JSON.parse(stripped.slice(start, end + 1));
      } catch {
        obj = null;
      }
    }
  }

  if (!obj || typeof obj !== 'object') {
    // Total parse failure — degrade gracefully: show whatever the model
    // said as the reply, keep the conversation alive, nothing structured.
    return {
      reply: text.slice(0, 2000) || "Tell me a bit about the screen you're making and I'll help design it.",
      intake: {},
      missing: [],
      ready: false,
      brief: '',
    };
  }

  // DOUBLE-ENCODE UNWRAP (2026-06-28) — GPT-5 sometimes nests the whole
  // envelope: `reply` is itself a JSON string that parses to ANOTHER
  // {reply, intake, missing, ready, brief} object. Without unwrapping, the
  // customer would SEE raw JSON in the chat and the intake/brief would be
  // lost. If `reply` parses to an object that carries a `reply` key, use the
  // INNER envelope instead.
  if (typeof obj.reply === 'string') {
    const innerText = obj.reply.trim();
    if (innerText.startsWith('{') && innerText.endsWith('}')) {
      try {
        const inner = JSON.parse(innerText);
        if (inner && typeof inner === 'object' && typeof inner.reply === 'string') {
          obj = inner;
        }
      } catch {
        // Not actually nested JSON — leave the reply as the literal string.
      }
    }
  }

  const reply =
    typeof obj.reply === 'string' && obj.reply.trim()
      ? obj.reply.trim().slice(0, 2000)
      : "Got it — what else should this board show?";

  const intake = clampConciergeIntake(obj.intake);

  const missing = Array.isArray(obj.missing)
    ? obj.missing
        .map((m: any) => String(m || '').trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const ready = obj.ready === true;
  const brief =
    typeof obj.brief === 'string' ? obj.brief.trim().slice(0, 4000) : '';

  return { reply, intake, missing, ready, brief };
}

/** Clamp a loose intake object to the allowed enums; drop anything invalid. */
export function clampConciergeIntake(raw: any): ConciergeIntake {
  const out: ConciergeIntake = {};
  if (!raw || typeof raw !== 'object') return out;

  if (typeof raw.purpose === 'string' && PURPOSES.has(raw.purpose)) {
    out.purpose = raw.purpose as ConciergeIntake['purpose'];
  }
  if (typeof raw.theme === 'string' && raw.theme.trim()) {
    // Accept friendly label / real id / 'brand' — guided-intake re-resolves.
    out.theme = raw.theme.trim().slice(0, 40);
  }
  // palette: 'brand' | { colors: [...] }
  if (raw.palette === 'brand') {
    out.palette = 'brand';
  } else if (raw.palette && typeof raw.palette === 'object' && Array.isArray(raw.palette.colors)) {
    const colors = raw.palette.colors
      .map((c: any) => String(c || '').trim())
      .filter((c: string) => /^#?[0-9a-fA-F]{3,8}$/.test(c))
      .map((c: string) => (c.startsWith('#') ? c : `#${c}`))
      .slice(0, 6);
    if (colors.length) out.palette = { colors };
  }
  if (typeof raw.background === 'string' && BACKGROUNDS.has(raw.background)) {
    out.background = raw.background as ConciergeIntake['background'];
  }
  if (Array.isArray(raw.widgets)) {
    const widgets = Array.from(
      new Set(
        raw.widgets
          .map((w: any) => String(w || '').trim())
          .filter((w: string) => WIDGETS.has(w)),
      ),
    ).slice(0, 12) as ConciergeIntake['widgets'];
    if (widgets && widgets.length) out.widgets = widgets;
  }
  return out;
}

/**
 * Turn a BrandingPreview-shaped object (from BrandingScraperService.scrape)
 * into a compact ConciergeReference the concierge can read. Defensive reads —
 * the scraper's shape can vary and partial scrapes are common.
 *
 * `assets` (2026-09-22) is what the reference endpoint actually CHECKED and
 * copied to our storage (designer-assets.ts): the logo, the photo and the
 * logo-derived palette. With it, `logoUrl` / `imageUrl` are OUR urls and the
 * summary says exactly what was checked. Without it (tests, any caller that has
 * not resolved assets) the picks are the ranked but UNCHECKED third-party URLs —
 * production callers must resolve assets first so a board never hotlinks.
 */
export function summarizeUrlReference(
  preview: any,
  url: string,
  assets?: ResolvedDesignerAssets | null,
): ConciergeReference {
  const name = strOrEmpty(preview?.displayName);
  const tagline = strOrEmpty(preview?.tagline);
  // Business descriptor — "what they sell" — the SINGLE most important signal
  // for content generation. Without it the model invents the wrong cuisine
  // (the 2026-06-29 "Domino's -> burger menu" failure: it had the name + colors
  // but never "pizza"). Lead with it so the generated board is on-subject.
  const businessType = strOrEmpty(preview?.description);
  // The brand's REAL on-page headlines/positioning — so the board echoes the
  // actual voice + the services/industries the site names, instead of inventing
  // generic copy (the 2026-06-29 riotcolor.com case: a premium experiential-
  // graphics brand came out as a generic "24-48hr banners" print shop).
  const keyMessages: string[] = Array.isArray(preview?.keyMessages)
    ? preview.keyMessages.filter((m: any) => typeof m === 'string' && m.trim()).slice(0, 12)
    : [];
  // The scraper hands back RankedFont OBJECTS ({ family, googleFont, … });
  // interpolating them printed "Fonts: [object Object] / [object Object]"
  // into every reference (2026-09-22). Older callers pass plain strings.
  const fontNames = [
    fontName(preview?.fonts?.heading),
    fontName(preview?.fonts?.body),
  ].filter(Boolean);
  const fonts = fontNames.length
    ? `Fonts: ${[...new Set(fontNames)].join(' / ')}.`
    : '';

  // Palette hexes: the resolved (logo-first) palette when assets were
  // checked, else the scrape's derived palette, then its ranked colors.
  const palette = assets
    ? assets.palette.filter((h) => /^#[0-9a-f]{6}$/i.test(h))
    : previewPaletteHexes(preview);
  const logoUrl = assets
    ? (assets.logo?.url ?? null)
    : (pickLogo(preview)?.url ?? null);
  const heroImageUrl = assets
    ? (assets.photo?.url ?? null)
    : pickHeroImage(preview);

  const paletteLine = !palette.length
    ? ''
    : assets &&
        (assets.paletteSource === 'logo' ||
          assets.paletteSource === 'logo+page')
      ? `Brand palette (from their logo): ${palette.slice(0, 6).join(', ')}.`
      : assets
        ? `Brand palette (from the site's colors — the logo gave none): ${palette.slice(0, 6).join(', ')}.`
        : `Brand palette: ${palette.slice(0, 6).join(', ')}.`;

  const summaryParts = [
    name ? `Brand: ${name}.` : '',
    businessType ? `What they are / sell (use this to pick the RIGHT content — never invent a different cuisine/industry): "${businessType.slice(0, 240)}".` : '',
    keyMessages.length
      ? `The brand's REAL on-site messaging — ECHO this actual voice + the services/industries it names; do NOT invent generic copy: ${keyMessages.map((m) => `"${m}"`).join(' · ')}.`
      : '',
    tagline && tagline !== businessType ? `Tagline: "${tagline.slice(0, 160)}".` : '',
    paletteLine,
    fonts,
    ...assetSummaryLines(assets, logoUrl, heroImageUrl),
  ].filter(Boolean);

  const summary =
    (summaryParts.join(' ') || `Website ${url} (limited brand info could be read).`).slice(0, 4000);

  const ref: ConciergeReference = {
    kind: 'url',
    label: hostOf(url) || url.slice(0, 200),
    summary,
  };
  if (palette.length) ref.palette = palette.slice(0, 8);
  if (heroImageUrl) ref.imageUrl = heroImageUrl.slice(0, 2048);
  if (logoUrl) ref.logoUrl = logoUrl.slice(0, 2048);
  // Where the logo and photo came from, so nothing downstream has to guess
  // whether they are the venue's own — the web ranks an upload above the site
  // and the site above stock, and the Designer is told which it got.
  if (heroImageUrl && assets?.photo) ref.imageSource = assets.photo.source;
  if (logoUrl && assets?.logo) ref.logoSource = 'site';
  return ref;
}

/** What AiAltTextService.analyzeDesignReference returns, structurally. */
export interface ImageReferenceAnalysis {
  summary: string;
  palette: string[];
  /** What the image IS; absent (an older reply) reads as 'design'. */
  role?: 'logo' | 'photo' | 'design';
  menu?: ExtractedMenu;
}

/**
 * An uploaded image → the ConciergeReference the chat and the Designer read
 * (2026-09-23). The fields AiService.analyzeDesignReferenceImage always
 * produced — the style summary, the image's colors, and a menu read off a
 * photo of one (leading the summary) — plus what the upload IS:
 *   • logo  — checked + copied (designer-assets.rehostUploadedReferenceImage):
 *             `logoUrl` + `logoSource: 'upload'`, and the palette comes from
 *             the logo's own pixels when it has any color;
 *   • photo — checked + copied: `imageUrl` + `imageSource: 'upload'`;
 *   • design — text only, as every upload was before. So is a logo or photo
 *             that could not be used, and the summary says why, so neither
 *             the Concierge nor the Designer looks for an image that is not there.
 */
export function referenceFromImageAnalysis(
  analysis: ImageReferenceAnalysis,
  opts: { filename?: string; upload?: UploadedReferenceResult | null } = {},
): ConciergeReference {
  const role =
    analysis?.role === 'logo' || analysis?.role === 'photo'
      ? analysis.role
      : 'design';
  const asset = role === 'design' ? null : (opts.upload?.asset ?? null);
  const menu =
    analysis?.menu && analysis.menu.itemCount > 0 ? analysis.menu : null;
  const ref: ConciergeReference = { kind: 'image', summary: '' };
  if (opts.filename) ref.label = opts.filename.slice(0, 200);
  let palette = Array.isArray(analysis?.palette) ? analysis.palette : [];
  if (role === 'logo' && asset) {
    ref.logoUrl = asset.url.slice(0, 2048);
    ref.logoSource = 'upload';
    if (opts.upload?.palette?.length) palette = opts.upload.palette;
  } else if (role === 'photo' && asset) {
    ref.imageUrl = asset.url.slice(0, 2048);
    ref.imageSource = 'upload';
  }
  if (palette.length) ref.palette = palette.slice(0, 8);
  const summary = [
    menu ? describeExtractedMenu(menu) : '',
    strOrEmpty(analysis?.summary),
    uploadRoleLine(role, asset, opts.upload?.reason, !!menu),
  ]
    .filter(Boolean)
    .join(' ');
  ref.summary = summary.slice(0, 4000);
  if (menu) ref.menu = menu;
  return ref;
}

/** The sentence that tells the chat and the Designer what an upload is for. */
function uploadRoleLine(
  role: 'logo' | 'photo' | 'design',
  asset: CheckedAsset | null,
  reason: string | undefined,
  hasMenu: boolean,
): string {
  const why = reason ? ` (${reason})` : '';
  if (role === 'logo') {
    return asset
      ? `Logo: this upload is the venue's own logo, uploaded by the operator and checked (${asset.width}×${asset.height} ${asset.format.toUpperCase()}${
          asset.lowRes
            ? ' — only a small version exists, so keep it modest in size'
            : ''
        }) — place this image on the board rather than typesetting the name.`
      : `Logo: this upload looks like the venue's logo, but it could not be used${why} — set the brand name in type.`;
  }
  if (role === 'photo') {
    return asset
      ? `Photo: this upload is one of the venue's own photos, uploaded by the operator and checked (${asset.width}×${asset.height}) — use it where a photo fits.`
      : `Photo: this upload looks like one of the venue's photos, but it could not be used${why} — use none rather than invent one.`;
  }
  return hasMenu
    ? 'The picture itself is not placed on the board.'
    : 'This image is inspiration for the look — not an asset to place on the board.';
}

/**
 * What the reference says about its logo and photo. Plain statements of what
 * was CHECKED — never "verified", never a styling instruction (a scrim or a
 * duotone is the designer's call, and it used to be forced on every photo).
 */
function assetSummaryLines(
  assets: ResolvedDesignerAssets | null | undefined,
  logoUrl: string | null,
  heroImageUrl: string | null,
): string[] {
  const lines: string[] = [];
  if (!assets) {
    if (logoUrl)
      lines.push(
        'Logo: a logo image was found on the site (not yet checked) — place it on the board rather than typesetting the name.',
      );
    if (heroImageUrl)
      lines.push('Photo: a photo was found on the site (not yet checked).');
    return lines;
  }
  const logo = assets.logo;
  if (logo) {
    lines.push(
      `Logo: the venue's own logo, read from their site and checked (${logo.width}×${logo.height} ${logo.format.toUpperCase()}${
        logo.lowRes
          ? ' — only a small version exists, so keep it modest in size'
          : ''
      }) — place this image on the board rather than typesetting the name.`,
    );
  } else {
    lines.push(
      'Logo: no usable logo image could be prepared from the site — set the brand name in type.',
    );
  }
  const photo = assets.photo;
  if (!photo) {
    lines.push(
      'Photo: no usable photo could be prepared from the site (too small, a loading placeholder, or it could not be copied) — use none rather than invent one.',
    );
  } else if (photo.source === 'stock') {
    lines.push(
      `Photo: the site had no usable photo, so this is a STOCK photo${photo.stockQuery ? ` ("${photo.stockQuery}")` : ''} — not the venue's own; never caption it as theirs.`,
    );
  } else if (photo.source === 'pos') {
    lines.push(
      `Photo: a menu-item photo from their point-of-sale system, checked (${photo.width}×${photo.height}).`,
    );
  } else if (photo.source === 'upload') {
    lines.push(
      `Photo: a photo the operator uploaded, checked (${photo.width}×${photo.height}).`,
    );
  } else {
    lines.push(
      `Photo: one of the venue's own photos from their site, checked (${photo.width}×${photo.height}) — use it where a photo fits.`,
    );
  }
  return lines;
}

function fontName(f: any): string {
  if (typeof f === 'string') return f.trim().slice(0, 60);
  if (f && typeof f === 'object') {
    const n =
      typeof f.googleFont === 'string' && f.googleFont.trim()
        ? f.googleFont
        : f.family;
    return typeof n === 'string' ? n.trim().slice(0, 60) : '';
  }
  return '';
}

// ── Logo + photo ranking (2026-09-22) ────────────────────────────────────
//
// The Super Taco boards: the "logo" was the site's apple-touch-icon (a
// 180×180 crop of a food PHOTO) that out-scored the real header wordmark, and
// the "photo" was a Wix blurred 151×101 loading placeholder the page labelled
// 1805×670. These rankers only ORDER candidates and point at the CDN original;
// designer-assets.ts fetches and decodes each one before anything is used.

/** A logo candidate, most plausible first. */
export interface RankedLogoCandidate {
  /** The CDN ORIGINAL of the mark (absent for an inline SVG). */
  url?: string;
  /** The as-found rendition — tried if the original cannot be fetched. */
  fallbackUrls: string[];
  svgInline?: string;
  kind?: string;
  score: number;
  isSvg: boolean;
  /**
   * 'real' — the site's own header mark (in the header / nav, linked home, or
   * named after the brand). 'fallback' — a site icon, a share card, or a
   * logo-named image elsewhere on the page: used only when no real one works.
   */
  tier: 'real' | 'fallback';
}

/** Filenames that are site icons whatever `rel` they were found under. */
const ICON_FILE_RE =
  /(?:^|[/_.-])(?:favicon|apple-touch-icon|android-chrome|mstile|safari-pinned-tab|site-?icon)[^/]*$/i;

/** A scraped logo candidate as it arrives — every field unverified. */
interface LooseLogo {
  url?: unknown;
  svgInline?: unknown;
  kind?: unknown;
  score?: unknown;
  isSvg?: unknown;
  photographic?: unknown;
  headerMark?: unknown;
  filterReasons?: string[];
}

/**
 * Order the scrape's logo candidates: every REAL header mark (score order)
 * before the fallbacks — site icons, share cards and logo-named images outside
 * the header, which compete on score and are used only when no real mark
 * works. A candidate whose pixels read as a photograph, and one a filter
 * demoted (social / badge / photo-shaped), is never offered.
 */
export function rankLogoCandidates(preview: any): RankedLogoCandidate[] {
  const logos: unknown[] = Array.isArray(preview?.logos)
    ? (preview.logos as unknown[])
    : [];
  // [candidate, page-order index] — the index breaks score ties in page order.
  const real: Array<[RankedLogoCandidate, number]> = [];
  const fallbacks: Array<[RankedLogoCandidate, number]> = [];
  logos.forEach((l, idx) => {
    if (!l) return;
    const obj: LooseLogo | null =
      typeof l === 'object' ? (l as LooseLogo) : null;
    if (obj?.photographic) return;
    const asFound =
      typeof l === 'string' ? l : typeof obj?.url === 'string' ? obj.url : '';
    const hasUrl = /^https?:\/\//i.test(asFound);
    const svgInline =
      typeof obj?.svgInline === 'string' && /<svg[\s>]/i.test(obj.svgInline)
        ? obj.svgInline
        : undefined;
    if (!hasUrl && !svgInline) return;
    const kind = typeof obj?.kind === 'string' ? obj.kind : undefined;
    const url = hasUrl ? originalImageUrl(asFound) : undefined;
    const iconish =
      isIconLogoKind(kind) || (hasUrl && ICON_FILE_RE.test(pathOf(asFound)));
    const mark = {
      kind,
      filterReasons: obj?.filterReasons,
      headerMark: obj?.headerMark === true,
    };
    // A demoted mark (social / badge / photo-shaped) is never offered.
    if (!iconish && kind && !isRealLogoCandidate(mark)) return;
    // An older / hand-built preview carries no kind: a plain URL that is not a
    // site icon counts as a real mark. A scraped one must be a header mark.
    const isReal = !iconish && (kind ? isHeaderLogoCandidate(mark) : true);
    const tier: RankedLogoCandidate['tier'] = isReal ? 'real' : 'fallback';
    const score =
      typeof obj?.score === 'number' && Number.isFinite(obj.score)
        ? obj.score
        : 0;
    const cand: RankedLogoCandidate = {
      ...(url ? { url } : {}),
      fallbackUrls: hasUrl && url !== asFound ? [asFound] : [],
      ...(svgInline && !hasUrl ? { svgInline } : {}),
      ...(kind ? { kind } : {}),
      score,
      isSvg:
        !!svgInline ||
        obj?.isSvg === true ||
        (hasUrl && /\.svg(?:[?#]|$)/i.test(asFound)),
      tier,
    };
    (isReal ? real : fallbacks).push([cand, idx]);
  });
  const byScore = (
    a: [RankedLogoCandidate, number],
    b: [RankedLogoCandidate, number],
  ) => b[0].score - a[0].score || a[1] - b[1];
  return [...real.sort(byScore), ...fallbacks.sort(byScore)].map(([c]) => c);
}

/** The best logo pick WITHOUT fetching — the top-ranked candidate (URL or inline SVG). */
export function pickLogo(preview: any): RankedLogoCandidate | null {
  return rankLogoCandidates(preview)[0] ?? null;
}

/** A photo candidate, most plausible first. */
export interface RankedPhotoCandidate {
  /** The CDN ORIGINAL to fetch first. */
  url: string;
  /** The same image at other addresses (the as-found rendition). */
  fallbackUrls: string[];
  kind: string;
  /** Best-known pixel size — the page's `data-image-info`, else srcset, else the attributes. 0 = unknown. */
  width: number;
  height: number;
  /** Named like an icon / logo / map / share card. */
  weak: boolean;
}

const WEAK_PHOTO_RE =
  /favicon|sprite|icon|logo|map-location|placeholder|cropped|[-_](og|share|social|card)[-_.]/i;

/**
 * Order the scrape's photo candidates: big CONTENT photos first (largest
 * known size first), then any other non-weak image, then the weak ones. A
 * loading placeholder is replaced by its CDN original, or dropped when the CDN
 * cannot give one back.
 */
/** A scraped photo candidate as it arrives — every field unverified. */
interface LoosePhoto {
  url?: unknown;
  kind?: unknown;
  width?: unknown;
  height?: unknown;
  naturalWidth?: unknown;
  naturalHeight?: unknown;
  srcsetWidth?: unknown;
}

export function rankPhotoCandidates(preview: any): RankedPhotoCandidate[] {
  const out: RankedPhotoCandidate[] = [];
  const seen = new Set<string>();
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  const add = (raw: unknown, fallbackKind: string) => {
    const obj: LoosePhoto =
      raw && typeof raw === 'object' ? (raw as LoosePhoto) : {};
    const asFound = typeof raw === 'string' ? raw : obj.url;
    if (typeof asFound !== 'string' || !/^https?:\/\//i.test(asFound)) return;
    const url = originalImageUrl(asFound);
    if (isPlaceholderImageUrl(url) || seen.has(url)) return;
    seen.add(url);
    const nw = num(obj.naturalWidth);
    const nh = num(obj.naturalHeight);
    const sw = num(obj.srcsetWidth);
    const dw = num(obj.width);
    const dh = num(obj.height);
    const width = nw || sw || dw;
    const height = nh || (sw && dw && dh ? Math.round((sw * dh) / dw) : dh);
    out.push({
      url,
      fallbackUrls:
        asFound !== url && !isPlaceholderImageUrl(asFound) ? [asFound] : [],
      kind: typeof obj.kind === 'string' ? obj.kind : fallbackKind,
      width,
      height,
      weak: WEAK_PHOTO_RE.test(asFound) || WEAK_PHOTO_RE.test(url),
    });
  };
  const hero: unknown = preview?.heroImages;
  if (Array.isArray(hero))
    for (const h of hero as unknown[]) add(h, 'large-img');
  const og: unknown = preview?.ogImage;
  if (typeof og === 'string') add({ url: og, kind: 'og' }, 'og');
  // Prefer a REAL large work photo over the og:image — many sites set og:image
  // to an icon/map/social card, which makes a weak hero (the 2026-06-30
  // riotcolor case: og:image was a service-area MAP, not their mural work).
  const tier = (c: RankedPhotoCandidate) =>
    c.kind === 'large-img' && !c.weak && Math.max(c.width, c.height) >= 800
      ? 0
      : !c.weak
        ? 1
        : 2;
  // Decorate with the page-order index so ties keep page order.
  return out
    .map((c, idx): [RankedPhotoCandidate, number] => [c, idx])
    .sort(
      ([a, ia], [b, ib]) =>
        tier(a) - tier(b) ||
        (tier(a) === 0 ? b.width * b.height - a.width * a.height : 0) ||
        ia - ib,
    )
    .map(([c]) => c);
}

/** The best photo pick WITHOUT fetching — the CDN original of the top-ranked candidate. */
function pickHeroImage(preview: any): string | null {
  return rankPhotoCandidates(preview)[0]?.url ?? null;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function strOrEmpty(v: any): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** The scrape's own palette: derived primary / accent / secondary, then ranked page colors. */
export function previewPaletteHexes(preview: any): string[] {
  return extractHexes(preview);
}

function extractHexes(preview: any): string[] {
  const out: string[] = [];
  const push = (v: any) => {
    const s = String(v || '').trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(s)) {
      const hex = s.startsWith('#') ? s : `#${s}`;
      if (!out.includes(hex.toLowerCase())) out.push(hex.toLowerCase());
    }
  };
  const pal = preview?.palette;
  if (pal && typeof pal === 'object') {
    push(pal.primary);
    push(pal.accent);
    push(pal.secondary);
  }
  // When the scrape built primary/accent from the LOGO, those ARE the brand
  // colors — the page's ranked CSS colors after them are site chrome (on
  // supertacomex.com: Wix's own blue #116dff and purple #5f5bcd), and the
  // designer is told to use every color it is given boldly (2026-09-22).
  const fromLogo =
    preview?.paletteSource === 'logo' || preview?.paletteSource === 'logo+page';
  const colors = preview?.colors;
  if (Array.isArray(colors) && (!fromLogo || !out.length)) {
    for (const c of colors) push(typeof c === 'string' ? c : c?.hex);
  }
  return out.slice(0, 8);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
