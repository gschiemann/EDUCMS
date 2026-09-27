/**
 * Fan Cam titles where students are on screen (K-12 sports launch, lane B3,
 * leftover b — 2026-09-27).
 *
 * The Fan Cam frame shipped as a "Kiss Cam". A kiss cam puts two people from
 * the stands on the big screen and asks them to kiss; at a school game the
 * people in the stands are mostly students, many of them minors. So wherever
 * the student-privacy policy applies — a K-12 school, or a location that says
 * its athletes include minors (`StudentPrivacySettings.applies`) — the Fan
 * Cam's words may not ask for a kiss or anything like it. Everywhere else the
 * operator's words stand, unchanged.
 *
 * One definition, two enforcers: the API refuses such a title when a template
 * is saved (`FAN_CAM_TITLE_NOT_SCHOOL_SAFE`), and the builder refuses it as it
 * is typed and offers school-safe titles instead.
 */

/** The Fan Cam frame's variant id in a zone's saved config. */
export const FAN_CAM_VARIANT_ID = 'kiss-cam';

/** The Fan Cam config keys that put words on the frame. */
export const FAN_CAM_TEXT_KEYS = ['kind', 'sponsor'] as const;

/** The error code the API answers when such a title is saved at a school. */
export const FAN_CAM_TITLE_NOT_SCHOOL_SAFE = 'FAN_CAM_TITLE_NOT_SCHOOL_SAFE';

/**
 * The one-tap titles the builder offers a school. The words themselves are
 * translated in the dashboard catalogs (`sportsTemplates.venue.camPreset_*`);
 * every translation is checked against the rule below by a test.
 */
export const SCHOOL_SAFE_FAN_CAM_PRESETS = ['fan', 'spirit', 'dance', 'flex', 'smile', 'wave'] as const;
export type SchoolSafeFanCamPreset = (typeof SCHOOL_SAFE_FAN_CAM_PRESETS)[number];

/** Words that ask for a kiss (English and Spanish, the dashboard's languages). */
const UNSAFE_WORDS: ReadonlySet<string> = new Set([
  'KISS', 'KISSES', 'KISSED', 'KISSING', 'KISSY', 'KISSIE', 'KISSER', 'KISSABLE',
  'SMOOCH', 'SMOOCHES', 'SMOOCHING', 'SMOOCHY', 'SMOOCHIE',
  'SNOG', 'SNOGS', 'SNOGGING',
  'MAKEOUT', 'MAKEOUTS', 'LIPLOCK',
  'ROMANCE', 'ROMANTIC',
  'XOXO',
  'BESO', 'BESOS', 'BESAR', 'BESITO', 'BESITOS', 'BESANDO', 'BESUQUEO', 'BESAME',
]);

/** Two-word phrases ("MAKE OUT", "LIP LOCK", "PUCKER UP"). */
const UNSAFE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['MAKE', 'OUT'],
  ['MAKING', 'OUT'],
  ['LIP', 'LOCK'],
  ['PUCKER', 'UP'],
];

/** A "<word> CAM" that names a romantic camera ("LOVE CAM", "COUPLES CAM"). */
const UNSAFE_CAM_PREFIXES: ReadonlySet<string> = new Set([
  'KISS', 'KISSY', 'KISSIE', 'SMOOCH', 'SNOG', 'LOVE', 'LOVER', 'LOVERS', 'COUPLE', 'COUPLES',
  'DATE', 'SWEETHEART', 'SWEETHEARTS', 'VALENTINE', 'VALENTINES', 'CRUSH', 'CUDDLE', 'CUDDLES',
  'BESO', 'BESOS', 'AMOR', 'NOVIOS', 'PAREJA', 'PAREJAS', 'ENAMORADOS',
]);

/** What a camera-first title films ("CÁMARA DE LOS BESOS", "CAM OF LOVE"). */
const UNSAFE_CAM_SUBJECTS: ReadonlySet<string> = new Set([
  'KISS', 'KISSES', 'SMOOCH', 'SMOOCHES', 'LOVE', 'LOVERS', 'COUPLE', 'COUPLES', 'SWEETHEART', 'SWEETHEARTS',
  'BESO', 'BESOS', 'AMOR', 'NOVIOS', 'PAREJA', 'PAREJAS', 'ENAMORADOS',
]);

/** Small words between "CAM" and what it films. */
const LINKERS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'OF', 'THE', 'FOR']);

/** Kiss in Chinese, and the kiss / couple emoji. */
const UNSAFE_MARKS = /吻|亲亲|親親|啵啵|\u{1F48B}|\u{1F618}|\u{1F617}|\u{1F619}|\u{1F61A}|\u{1F48F}|\u{1F491}|\u{1F63D}/u;

const LEET: Record<string, string> = { '0': 'O', '1': 'I', '3': 'E', '4': 'A', '5': 'S', '7': 'T', '@': 'A', $: 'S', '!': 'I', '|': 'I' };

/** Upper-case letter words, accents removed, "K I S S" joined, "KISSSS" → "KISS". */
function words(text: string, leet: boolean): string[] {
  let s = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (leet) s = s.replace(/[013457@$!|]/g, (ch) => LEET[ch] ?? ch);
  const raw = s
    .replace(/[^A-Z]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.replace(/(.)\1{2,}/g, '$1$1'));
  // Spaced-out letters ("K I S S CAM") read as one word.
  const out: string[] = [];
  let run = '';
  for (const w of raw) {
    if (w.length === 1) {
      run += w;
      continue;
    }
    if (run) out.push(run);
    run = '';
    out.push(w);
  }
  if (run) out.push(run);
  return out;
}

function unsafeWords(ws: readonly string[]): boolean {
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    if (UNSAFE_WORDS.has(w)) return true;
    if (w.endsWith('CAM') && UNSAFE_CAM_PREFIXES.has(w.slice(0, -3))) return true;
    const next = ws[i + 1];
    if (next === 'CAM' || next === 'CAMERA' || next === 'CAMARA') {
      if (UNSAFE_CAM_PREFIXES.has(w)) return true;
    }
    // Camera first ("CÁMARA DE LOS BESOS", "CAM OF LOVE").
    if (w === 'CAMARA' || w === 'CAMERA' || w === 'CAM') {
      let j = i + 1;
      while (j < ws.length && LINKERS.has(ws[j]!)) j++;
      const after = ws[j];
      if (after && UNSAFE_CAM_SUBJECTS.has(after)) return true;
    }
    for (const [a, b] of UNSAFE_PAIRS) if (w === a && next === b) return true;
  }
  return false;
}

/**
 * Whether a Fan Cam's words are fine where students are on screen. Anything
 * that is not text is fine (there is nothing to show).
 */
export function fanCamTextIsSchoolSafe(text: unknown): boolean {
  if (typeof text !== 'string' || !text.trim()) return true;
  if (UNSAFE_MARKS.test(text)) return false;
  return !unsafeWords(words(text, false)) && !unsafeWords(words(text, true));
}

/** A template zone as the API receives it, or as a version snapshot stores it. */
export interface FanCamZoneLike {
  defaultConfig?: unknown;
}

/**
 * The words on Fan Cam zones that a school may not show — empty when there
 * are none. Reads a zone's config as an object or as the JSON string a
 * version snapshot stores.
 */
export function unsafeFanCamTexts(zones: ReadonlyArray<FanCamZoneLike> | null | undefined): string[] {
  const out: string[] = [];
  for (const z of zones ?? []) {
    let cfg: unknown = z?.defaultConfig;
    if (typeof cfg === 'string') {
      try {
        cfg = JSON.parse(cfg);
      } catch {
        continue;
      }
    }
    if (!cfg || typeof cfg !== 'object') continue;
    const c = cfg as Record<string, unknown>;
    if (c.variant !== FAN_CAM_VARIANT_ID) continue;
    for (const k of FAN_CAM_TEXT_KEYS) {
      const v = c[k];
      if (typeof v === 'string' && !fanCamTextIsSchoolSafe(v)) out.push(v);
    }
  }
  return out;
}
