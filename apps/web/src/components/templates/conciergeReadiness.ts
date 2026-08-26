/**
 * conciergeReadiness — the pure logic behind the Signage Concierge's
 * "what's still missing / are we ready / can this generator even do that"
 * surface. No React, no network, so it unit-tests on its own.
 *
 * WHY (2026-08-25, operator session):
 *
 * 1. "the flow was off, i didnt know when to stop chatting and actually
 *    generate the images...it should lead you to clicking that button".
 *    The component already received a `missing` array from every chat turn and
 *    used it only to gate one grey one-liner. The operator could not see what
 *    was still needed, and `ready` showed up as nothing but a faint ring.
 *
 * 2. The same brief asked for "a touch-friendly menu with our services tied to
 *    links with URLs" and came back as a passive poster with zero tap targets —
 *    silently. The board generator had never been taught the word "tap": its
 *    prompt asked for data-field/data-imgslot and nothing else. It now emits
 *    [data-action] hot zones when the brief asks for them (see designer-prompt.ts
 *    TAP TARGETS + the educms-action emit in designer-edit-shim.ts), so the
 *    request is honored — but the DESTINATIONS are the operator's to pick (the
 *    player resolves every key against their own saved wiring and ignores
 *    anything the board claims). A hot zone with nothing behind it is the same
 *    silent failure wearing a different hat, so this module makes the panel say
 *    both halves out loud.
 */

/** What the concierge still needs, in the operator's language. */
const MISSING_PHRASEBOOK: Array<[RegExp, string]> = [
  // Order matters — the first match wins, so put the specific ones first.
  [/\b(menu|item|price|pricing|dish|drink)/i, 'your items and prices'],
  [/\b(event\s*)?(date|time|when|schedule|day)s?\b/i, 'the date and time'],
  [/\b(url|link|website|address to|destination)/i, 'the link it should point to'],
  [/\b(cta|call[-\s]?to[-\s]?action|action)s?\b/i, 'what you want people to do'],
  [/\b(headline|copy|message|wording|text)s?\b/i, 'the headline you want'],
  [/\b(palette|colou?rs?|brand)\b/i, 'your colors (or paste your website)'],
  [/\b(vibe|tone|mood|style|look|theme)s?\b/i, 'the vibe you want'],
  [/\b(photo|image|picture|background)s?\b/i, 'a photo, or a plain background'],
  [/\b(widget|element|component|section)s?\b/i, 'which elements to show'],
  [/\b(purpose|goal|what.*for|audience)\b/i, 'what the screen is for'],
  [/\b(logo)s?\b/i, 'your logo'],
  [/\b(location|city|weather)\b/i, 'your city (for weather)'],
  [/\b(hours|open)\b/i, 'your hours'],
];

/** Max checklist rows — a checklist longer than this is noise, not guidance. */
export const MAX_MISSING_SHOWN = 4;

/**
 * Turn the model's `missing` labels into a short, plain checklist. The model is
 * told to emit "short labels", but it drifts toward schema words ("palette",
 * "widgets", "cta") that mean nothing to a restaurant owner. Anything the
 * phrasebook doesn't recognise passes through lightly cleaned, so a genuinely
 * plain label ("how many people it seats") is never mangled.
 */
export function humanizeMissing(missing: unknown): string[] {
  if (!Array.isArray(missing)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of missing) {
    const s = String(raw ?? '').trim().replace(/\s+/g, ' ').replace(/[.;:]+$/, '');
    if (!s) continue;
    let label = s;
    for (const [re, phrase] of MISSING_PHRASEBOOK) {
      if (re.test(s)) { label = phrase; break; }
    }
    // Lower-case a leading capital on an ordinary word so the row reads as part
    // of the sentence above it — but leave acronyms and proper nouns alone.
    if (/^[A-Z][a-z]/.test(label)) label = label[0].toLowerCase() + label.slice(1);
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= MAX_MISSING_SHOWN) break;
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// TOUCH / LINK INTENT — "can the generator you're pointed at even do that?"
// ───────────────────────────────────────────────────────────────────────────

/**
 * Phrases that mean "people will TOUCH this screen" or "these need to be
 * LINKS". Deliberately narrow: each one is unambiguous about interactivity, so
 * a passive board brief ("a menu board for the counter") never trips it.
 * Matched ONLY against the operator's own turns — never the assistant's reply,
 * which talks about touch capabilities unprompted.
 */
const TOUCH_INTENT: Array<[RegExp, string]> = [
  [/\btouch[-\s]?(screen|friendly|enabled)?\b/i, 'touch'],
  [/\btaps?\b|\btapp(able|ing|ed)\b/i, 'tap'],
  [/\bclick(able|s|ing)?\b/i, 'click'],
  [/\bkiosk\b/i, 'kiosk'],
  [/\binteractive\b/i, 'interactive'],
  [/\b(button|buttons)\b/i, 'buttons'],
  [/\b(links?|linked|hyperlinks?)\b/i, 'links'],
  [/\burls?\b/i, 'URLs'],
  [/\bqr\s*code/i, 'a QR code'],
  [/\bscan (to|for)\b/i, 'scan-to'],
  [/\bbrowse\b/i, 'browse'],
  [/\bnavigate\b/i, 'navigate'],
];

export interface TouchIntent {
  /** True when the operator asked for something only a Touch board can do. */
  wants: boolean;
  /** The words that triggered it — shown back so the notice is never mystifying. */
  matched: string[];
}

/** Detect a touch/link request in the operator's own words. */
export function detectTouchIntent(operatorText: string): TouchIntent {
  const s = String(operatorText || '');
  if (!s.trim()) return { wants: false, matched: [] };
  const matched: string[] = [];
  for (const [re, label] of TOUCH_INTENT) {
    if (re.test(s) && !matched.includes(label)) matched.push(label);
  }
  return { wants: matched.length > 0, matched: matched.slice(0, 3) };
}

// ───────────────────────────────────────────────────────────────────────────
// THE COMPOSED STATE the panel renders.
// ───────────────────────────────────────────────────────────────────────────

export type ConciergeStage = 'start' | 'gathering' | 'ready';

export interface ConciergeGuidance {
  stage: ConciergeStage;
  /** Plain-language checklist of what is still unknown (empty when ready). */
  checklist: string[];
  /** Headline for the guidance card. */
  title: string;
  /** One supporting line. Always makes clear generating now is allowed. */
  hint: string;
  /**
   * Set when the operator asked for taps / links / buttons. The generated boards
   * WILL carry real tap targets; what the operator still has to do is pick where
   * each one goes, because we refuse to invent a destination. Null if they never
   * asked for interactivity.
   */
  touchNotice: { matched: string[]; title: string; body: string } | null;
}

export function conciergeGuidance(args: {
  hasUserTurn: boolean;
  ready: boolean;
  missing: unknown;
  operatorText: string;
}): ConciergeGuidance {
  const checklist = humanizeMissing(args.missing);
  const touch = detectTouchIntent(args.operatorText);
  const stage: ConciergeStage = !args.hasUserTurn ? 'start' : args.ready ? 'ready' : 'gathering';

  // A generated board CAN carry real tap targets — the player dispatches a tap
  // on a [data-action] hot zone through the same security-gated dispatcher the
  // Touch Kiosks pack uses. What it CANNOT do is choose the destination: the
  // player resolves every key against the operator's own saved wiring and
  // ignores anything the board claims. Say both halves out loud, or a board that
  // looks tappable but opens nothing becomes the next silent failure.
  const touchNotice = touch.wants
    ? {
        matched: touch.matched,
        title: 'I’ll make these boards tappable',
        body:
          'You asked for taps and links, so each one gets a real tap target. ' +
          'I won’t guess where they go — once you keep a board, tap each button in the editor and pick its link.',
      }
    : null;

  if (stage === 'ready') {
    return {
      stage,
      checklist: [],
      title: 'I’ve got what I need',
      hint: 'Hit Generate and I’ll design 3 options for you to pick from.',
      touchNotice,
    };
  }

  if (stage === 'start') {
    return {
      stage,
      checklist: [],
      title: 'Tell me about the screen',
      hint: 'One line is enough to start — I’ll ask for the rest.',
      touchNotice,
    };
  }

  return {
    stage,
    checklist,
    title: checklist.length ? 'Still to nail down' : 'Getting there',
    hint: checklist.length
      ? 'Answer any of these for a sharper board — or generate now and tweak after.'
      : 'Keep going, or generate now and tweak after.',
    touchNotice,
  };
}
