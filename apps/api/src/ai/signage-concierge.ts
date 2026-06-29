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
    `HOW TO INTERVIEW`,
    `- Open by understanding what the screen is FOR in one plain question. From their answer, infer as much as you can and ask only the next question that genuinely changes the design.`,
    `- Ask ONE focused thing at a time (occasionally two tightly-related). Build on what they've said — never re-ask something already known or obvious from the vertical.`,
    `- Be concrete and visual. Offer a quick suggestion they can accept ("I'd go bold and appetizing with a big hero photo — sound right?") rather than open-ended menus.`,
    `- CAPTURE THE VIBE in their words — the single biggest driver of a board they'll love. Get 2-3 style adjectives + a feeling (e.g. "upscale & moody", "bright & playful", "clean & premium", "high-energy"). If they're unsure, offer a vivid pick ("elegant speakeasy, or bright and modern?"). Put these adjectives in the brief verbatim — they steer the look.`,
    `- The customer will get THREE visually DISTINCT directions to choose from (e.g. a bold dark take, a bright editorial take, a vibrant take) — never three near-identical boards. You don't pick one look for them; gather enough taste signal (vibe + any colors/photos) that all three land in their world and they fall in love with at least one.`,
    `- Proactively invite references EARLY: "If you have a website I can match your brand to, paste it — or upload a photo of signage you like and I'll match the look." A real photo or reference is the #1 thing that makes a board look like a designer spent weeks on it — chase it. Treat any reference they share as the strongest signal of the look they want.`,
    `- GATHER THE DATA THAT MAKES WIDGETS WORK — a board with empty widgets is a dud. When an element needs live/real data, get it in the same breath: a COUNTDOWN needs the event's date and time; WEATHER needs the location (default to the venue's own city — don't make them think about it); a MENU needs the actual items + prices (and offer "I can pull live prices straight from your POS if it's connected"); a CTA or QR needs the destination URL/phone. Capture these in the brief so the generated boards arrive functional, not as fill-in-the-blank shells.`,
    `- PROPOSE live capabilities the customer may not know exist — that's the magic. If they're a restaurant/bar, mention live POS menu pricing + auto-86; a sports venue, live scores; anyone outdoors-relevant, live weather. Be honest about what needs a connection ("once your POS is linked").`,
    `- When you have enough to nail it (purpose + a clear look + the key message/content + which elements + the data those elements need), set ready=true and tell them you're ready to generate 3 options. Don't drag the interview out — aim to be ready within a few exchanges. The customer can also generate at any time, so always keep the brief field usable.`,
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
    `  "reply": "the next message to SHOW the customer — friendly, concise, ONE question or your ready confirmation",`,
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
  const lines = references.slice(0, 6).map((r, i) => {
    const palette = r.palette && r.palette.length ? ` Colors: ${r.palette.slice(0, 6).join(', ')}.` : '';
    const kind = r.kind === 'url' ? 'Website' : 'Image';
    const label = r.label ? ` (${r.label})` : '';
    return `  ${i + 1}. [${kind}${label}] ${String(r.summary || '').slice(0, 700)}${palette}`;
  });
  return [
    '',
    `REFERENCES THE CUSTOMER SHARED — treat these as the strongest signal of the look they want. Match their palette, mood, and style; pull their brand colors into the palette; reflect them in the brief:`,
    ...lines,
  ].join('\n');
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
 */
export function summarizeUrlReference(preview: any, url: string): ConciergeReference {
  const name = strOrEmpty(preview?.displayName);
  const tagline = strOrEmpty(preview?.tagline);
  const fonts =
    preview?.fonts && (preview.fonts.heading || preview.fonts.body)
      ? `Fonts: ${[preview.fonts.heading, preview.fonts.body].filter(Boolean).join(' / ')}.`
      : '';

  // Palette hexes: prefer the derived palette, then ranked colors.
  const palette = extractHexes(preview);
  const heroImageUrl = pickHeroImage(preview);

  const summaryParts = [
    name ? `Brand: ${name}.` : '',
    tagline ? `Tagline: "${tagline.slice(0, 160)}".` : '',
    palette.length ? `Brand palette: ${palette.slice(0, 6).join(', ')}.` : '',
    fonts,
    heroImageUrl ? 'Has a hero image available to use as a background.' : '',
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
  return ref;
}

function strOrEmpty(v: any): string {
  return typeof v === 'string' ? v.trim() : '';
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
  const colors = preview?.colors;
  if (Array.isArray(colors)) {
    for (const c of colors) push(typeof c === 'string' ? c : c?.hex);
  }
  return out.slice(0, 8);
}

function pickHeroImage(preview: any): string | null {
  const hero = preview?.heroImages;
  if (Array.isArray(hero) && hero.length) {
    const first = hero[0];
    const u = typeof first === 'string' ? first : first?.url;
    if (typeof u === 'string' && /^https?:\/\//i.test(u)) return u;
  }
  const og = preview?.ogImage;
  if (typeof og === 'string' && /^https?:\/\//i.test(og)) return og;
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
