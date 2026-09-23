#!/usr/bin/env node
/**
 * build-designer-exemplars.cjs — compile the AI Designer's reference boards
 * (2026-09-22, AI Designer rework).
 *
 * WHY. GPT-6 Sol made the Super Taco menu wall Greg praised
 * (apps/web/public/templates/signage/qsr/24–27) when Codex drove it — with the
 * repo's real boards in front of it — and made sparse, price-less posters when
 * our AI Designer drove it with a 50k-char rulebook and ONE 1080p cafe poster as
 * its only example (docs/research/2026-09-22-ai-designer-rework/01-*.md, cause
 * #5). This script turns the boards Greg has APPROVED into the examples the
 * Designer shows the model, so the model sees the bar instead of reading about it.
 *
 * WHY A GENERATED MODULE. The API image does not ship apps/web/public (the
 * Dockerfile copies the API + packages only), so the boards are compiled into
 * apps/api/src/ai/designer-exemplars.generated.ts at build time and committed.
 * `designer-exemplars.spec.ts` fails when that file is stale — re-run:
 *
 *     node apps/api/scripts/build-designer-exemplars.cjs            # write
 *     node apps/api/scripts/build-designer-exemplars.cjs --check    # CI: exit 1 if stale
 *
 * WHAT AN EXEMPLAR IS. The board's HAND-WRITTEN CSS + markup and nothing else:
 *   - every <script> goes (the injected EDUCMS-SHIM-V* editing runtime, a
 *     kiosk `_edit-shim.js` reference, and the board's own menu/clock script —
 *     the Designer may not write scripts, so an example must not show any);
 *   - hidden config blocks, theme-token blocks, live-binder-only elements, and
 *     every asset path that only resolves inside apps/web/public are removed;
 *   - fonts are mapped onto the Designer's loaded list (DESIGNER_FONTS) — the
 *     Codex boards use Impact/Arial/Georgia, which Android signage players do
 *     not have;
 *   - the stage is normalised to the Designer contract (first child of <body>,
 *     fixed px size, position:relative, no self-scaling), and the few CSS
 *     features the Chromium-83 LED players lack are compiled out (flex `gap`
 *     → child margins, `color-mix()` → a resolved rgba). Grid `gap` stays;
 *   - every word, price and photo becomes a neutral placeholder of about the
 *     same length (NEUTRALIZE) — a reference teaches layout, never content, so
 *     no dish crosses to another venue and every venue can be shown every
 *     board, the one it was made for included;
 *   - no type under the Designer's size floor (The type floor) — lifted in the
 *     compiled copy only; the source boards are never edited.
 *
 * WHICH BOARDS. Only boards with a documented approval — see `approval` on each
 * entry. Purposes with no approved board get none (listed in the research
 * report for Greg to approve), never a stand-in.
 *
 * Deterministic: same sources in → byte-identical module out.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cheerio = require('cheerio');

const REPO = path.resolve(__dirname, '..', '..', '..');
// DESIGNER_EXEMPLARS_OUT lets the freshness test point --check at a scratch copy
// (its negative control: a tampered copy must fail).
const OUT = process.env.DESIGNER_EXEMPLARS_OUT
  ? path.resolve(process.env.DESIGNER_EXEMPLARS_OUT)
  : path.join(REPO, 'apps/api/src/ai/designer-exemplars.generated.ts');

// ─── Approvals ──────────────────────────────────────────────────────────────
// Emitted into the generated module, so written brand-free (see NEUTRALIZE).
const QSR_WALL_APPROVAL =
  "Greg, 2026-09-22: the qsr 24-27 menu wall Codex built on GPT-6 Sol is the bar the AI Designer must meet (\"learn from this and make our AI generation this good\") — docs/research/2026-09-22-ai-designer-rework/README.md";
const GYM_WELCOME_APPROVAL =
  "APPROVED 2026-07-02 by Greg (\"i like them all, keep them\") — docs/design/approved/2026-07-02-gym-welcome/README.md";
const MORNING_NEWS_APPROVAL =
  "APPROVED 2026-08-18 — marker in the board: user requested all three Morning News boards (\"do them all\")";
const RETAIL_STOREFRONT_APPROVAL =
  'APPROVED 2026-07-23 — marker in the board: local HTML concept approved by the user';
const SCHOOL_BACKLOG_APPROVAL =
  "APPROVED 2026-08-21 — marker in the board: user requested the full Codex backlog (\"ship everything that codex left\")";
const HALL_WAYFINDER_APPROVAL =
  "APPROVED 2026-08-21 — marker in the board: user requested all three Hall Wayfinder boards (\"do them all\")";
const ELEM_LUNCH_APPROVAL =
  'APPROVED 2026-08-16 — marker in the board: user requested all three elementary choice boards';

// ─── The boards ─────────────────────────────────────────────────────────────
// status: 'reference' is compiled and shown to the model; 'candidate' is NOT —
//         it is here so the next person can see what was considered and why.
// purposes: which board purposes this is a reference for (menu | offer | event
//           | announcement | welcome). structure: the layout family, matched to
//           the per-purpose structures in designer-prompt.ts DESIGNER_STRUCTURES.
// portrait: how the board flips to portrait — the flag the board's own runtime
//           sets (we set it statically) and the portrait canvas.
// rows: the item containers, rewritten to the Designer's row contract
//       (data-menu-row="N" around item.N.* fields — the same slot keys Codex's
//       posItemBindings use). `rename` maps the board's own field prefix/leaves
//       onto the standard item.N.{category,name,desc,price,image} keys.
// brandTokens: how the business is written on the board, so NEUTRALIZE can
//       find every line that names it. Build-time only — never emitted.
// renameClasses: class names that carry the business's content ("burritos"),
//       renamed in markup and CSS alike.
// adjust: compiled-only declaration overrides (per orientation) that give the
//       type-floor lift room — the source boards are never edited.
const SOURCES = [
  {
    status: 'reference',
    id: 'menu-hero-cards',
    file: 'apps/web/public/templates/signage/qsr/24-super-taco-flagship.html',
    title: 'Menu board — hero panel + dish cards',
    brandTokens: ['super taco', 'supertaco'],
    vertical: 'qsr',
    verticals: ['food'],
    purposes: ['menu'],
    structure: 'hero-cards',
    canvas: { w: 3840, h: 2160 },
    stage: '.stage',
    portrait: { canvas: { w: 2160, h: 3840 }, prefixes: ['body.portrait'], flag: { on: 'body', className: 'portrait' } },
    rows: { selector: 'article.dish' },
    dropMarkup: ['#empty'],
    dropCss: [/^\.empty$/, /\.soldout/],
    approval: QSR_WALL_APPROVAL,
  },
  {
    status: 'reference',
    id: 'menu-rail-cards',
    file: 'apps/web/public/templates/signage/qsr/26-super-taco-burritos.html',
    title: 'Menu board — photo rail + dish cards (one screen of a three-screen wall)',
    brandTokens: ['super taco', 'supertaco'],
    vertical: 'qsr',
    verticals: ['food'],
    purposes: ['menu'],
    structure: 'rail-cards',
    canvas: { w: 3840, h: 2160 },
    stage: '.stage',
    portrait: { canvas: { w: 2160, h: 3840 }, prefixes: ['.portrait'], flag: { on: 'html', className: 'portrait' } },
    rows: { selector: 'article.dish' },
    dropMarkup: ['#empty'],
    dropCss: [/^\.empty$/, /^\.theme-data$/, /\.combo-/, /^\.mode-(tacos|combos)/],
    renameClasses: { 'mode-burritos': 'mode-menu' },
    // Portrait sets its card labels at 42-46 px; lifted to the 52 px floor they
    // need a taller label row (52 × 1.1 line) and a wider aside (it wrapped to
    // four lines and ran into the first card even at 44 px).
    adjust: {
      portrait: [
        { selector: '.portrait .dish-top', set: { height: '58px', 'flex-basis': '58px' } },
        { selector: '.portrait .menu-heading .aside', set: { 'max-width': '820px' } },
      ],
    },
    approval: QSR_WALL_APPROVAL,
  },
  {
    status: 'reference',
    id: 'offer-split',
    file: 'apps/web/public/templates/signage/qsr/27-super-taco-combos.html',
    title: 'Offer board — photo + one featured offer (one screen of a three-screen wall)',
    brandTokens: ['super taco', 'supertaco'],
    vertical: 'qsr',
    verticals: ['food'],
    purposes: ['offer', 'menu'],
    structure: 'split-offer',
    canvas: { w: 3840, h: 2160 },
    stage: '.stage',
    portrait: { canvas: { w: 2160, h: 3840 }, prefixes: ['.portrait'], flag: { on: 'html', className: 'portrait' } },
    // The source is a JS carousel of three combination plates; an AI board has
    // no script, so the reference is its first slide as a still offer board.
    dropMarkup: ['.combo-slide:not(:first-of-type)', '#combo-empty', '#combo-progress'],
    dropCss: [/^\.combo-slide\.active$/, /^\.combo-progress/, /^\.combo-empty$/, /^\.theme-data$/],
    dropAtRules: [/prefers-reduced-motion/],
    dropDeclarations: [{ selector: /^\.combo-slide$/, props: ['opacity', 'visibility', 'transition'] }],
    removeClasses: { '.combo-slide': ['active'] },
    rows: { selector: 'section.combo-slide', rename: { prefix: 'combo', leaves: { kicker: 'category' } } },
    approval: QSR_WALL_APPROVAL,
  },
  // ── Welcome (2026-09-23) ─────────────────────────────────────────────────
  // status 'wip' = compiled by nothing yet (buildAll takes 'reference' only):
  // they build clean (--print) but have NOT passed the render gate — flip to
  // 'reference' once rendercheck shows no clipping/overlap worse than the source
  // (docs/research/2026-09-23-codex-parity-wave/04-exemplars.md, "Resume here").
  // v2 boards (`neutralizer: 2`): many more field roles than a menu — see
  // NEUTRALIZE v2. `verticals` are designerVerticalFamily() families; the
  // selector prefers a board made for the request's own venue type.
  {
    status: 'wip',
    id: 'welcome-name-hero',
    file: 'apps/web/public/templates/signage/gym/03-welcome-poster.html',
    title: 'Welcome board — giant two-line greeting + a column of working cards',
    neutralizer: 2,
    brandTokens: ['ironworks'],
    vertical: 'fitness',
    verticals: ['fitness'],
    purposes: ['welcome'],
    structure: 'name-hero',
    canvas: { w: 3840, h: 2160 },
    stage: '.stage',
    // The board's runtime sets data-orient on the stage and sizes it inline.
    portrait: { canvas: { w: 2160, h: 3840 }, prefixes: ['.stage[data-orient="portrait"]'], flag: { on: '.stage', attr: ['data-orient', 'portrait'] } },
    stripAttrs: ['data-widget', 'data-source'],
    adjust: { portrait: [{ selector: '.stage', set: { width: '2160px', height: '3840px' } }] },
    approval: GYM_WELCOME_APPROVAL,
  },
  {
    status: 'wip',
    id: 'welcome-split',
    file: 'apps/web/public/templates/signage/gym/04-welcome-split-duo.html',
    title: 'Welcome board — two halves across a diagonal seam',
    neutralizer: 2,
    brandTokens: ['ironworks'],
    vertical: 'fitness',
    verticals: ['fitness'],
    purposes: ['welcome'],
    structure: 'split-welcome',
    canvas: { w: 3840, h: 2160 },
    stage: '.stage',
    portrait: { canvas: { w: 2160, h: 3840 }, prefixes: ['.stage[data-orient="portrait"]'], flag: { on: '.stage', attr: ['data-orient', 'portrait'] } },
    stripAttrs: ['data-widget', 'data-source'],
    adjust: { portrait: [{ selector: '.stage', set: { width: '2160px', height: '3840px' } }] },
    approval: GYM_WELCOME_APPROVAL,
  },
  {
    status: 'wip',
    id: 'welcome-scene',
    file: 'apps/web/public/templates/signage/retail/02-storefront-aperture.html',
    title: 'Welcome board — a photo scene, the welcome on a solid panel over it, and an info footer band',
    neutralizer: 2,
    brandTokens: ['field / form', 'field form', 'fieldform'],
    vertical: 'retail',
    verticals: ['retail'],
    purposes: ['welcome'],
    structure: 'scene',
    canvas: { w: 1920, h: 1080 },
    stage: '#scene-wrap',
    portrait: { canvas: { w: 1080, h: 1920 }, prefixes: ['.is-portrait'], flag: { on: 'html', className: 'is-portrait' } },
    // The two-part display headline ("COME / closer.") is a headline, not two labels.
    roles: [[/^campaign\.line1$/, 'headline'], [/^campaign\.line2$/, 'headline']],
    approval: RETAIL_STOREFRONT_APPROVAL,
  },
  // ── Considered, NOT compiled ────────────────────────────────────────────
  {
    status: 'candidate',
    id: 'menu-rail-cards (wall screen 1)',
    file: 'apps/web/public/templates/signage/qsr/25-super-taco-tacos.html',
    why: 'Approved (same wall), but the same rail + cards structure as 26 — a second copy adds tokens, not range.',
  },
  {
    status: 'candidate',
    id: 'gym-welcome-poster / -split-duo / -locker-room',
    file: 'apps/web/public/templates/signage/gym/0{3,4,5}-welcome-*.html',
    purposes: ['welcome'],
    why: `${GYM_WELCOME_APPROVAL}. Held back: ported x2 from 1080p mockups, their labels run 26-48px on a 3840x2160 stage (the Designer floor is 52px), and our own fit engine enlarges them into overflow (measured). Needs a legibility pass, then Greg's OK.`,
  },
  {
    status: 'candidate',
    id: 'news-headline-split / -daily-cut / -rundown',
    file: 'apps/web/public/templates/hs/morning-news{,-daily-cut,-rundown-desk}.html',
    purposes: ['announcement', 'event'],
    why: `${MORNING_NEWS_APPROVAL}. Held back: 12-25px text on a 1920x1080 stage (floor 26px), so as a reference it teaches type the Designer then has to enlarge. Needs a legibility pass, then Greg's OK.`,
  },
];

// ─── Fonts ──────────────────────────────────────────────────────────────────
// Every family must land on apps/api/src/ai/designer-prompt.ts DESIGNER_FONTS.
// `weight` pins the weight a rule may use with the mapped face: Anton ships one
// weight (400), so an Impact rule's `font:900 …` would render as a synthetic
// smear; Archivo Black IS Archivo at 900.
const FONT_MAP = {
  impact: { family: 'Anton', weight: 400 },
  'arial narrow': null,
  georgia: { family: 'Fraunces' },
  'times new roman': null,
  arial: { family: 'Archivo' },
  helvetica: null,
  'archivo black': { family: 'Archivo', weight: 900 },
  'dm sans': { family: 'Inter' },
  manrope: { family: 'Inter' },
  'roboto mono': { family: 'Space Grotesk' },
  'space mono': { family: 'Space Grotesk' },
  'ibm plex mono': { family: 'Space Grotesk' },
  'jetbrains mono': { family: 'Space Grotesk' },
  anton: { family: 'Anton', weight: 400 },
  inter: { family: 'Inter' },
  caveat: { family: 'Caveat' },
  'barlow condensed': { family: 'Barlow Condensed' },
  // 2026-09-23 — the welcome / announcement / information boards' families.
  'instrument serif': { family: 'Playfair Display' },
  'dm mono': { family: 'Space Grotesk' },
  'playfair display': { family: 'Playfair Display' },
  'cormorant garamond': { family: 'Cormorant Garamond' },
  oswald: { family: 'Oswald' },
  'bebas neue': { family: 'Oswald' },
  fredoka: { family: 'Fredoka' },
  'baloo 2': { family: 'Fredoka' },
  chewy: { family: 'Fredoka' },
  nunito: { family: 'Nunito Sans' },
  'nunito sans': { family: 'Nunito Sans' },
  'libre franklin': { family: 'Archivo' },
  'archivo narrow': { family: 'Barlow Condensed' },
  'atkinson hyperlegible': { family: 'Inter' },
  'permanent marker': { family: 'Patrick Hand', weight: 400 },
  'patrick hand': { family: 'Patrick Hand', weight: 400 },
  'bowlby one': { family: 'Anton', weight: 400 },
  barlow: { family: 'Barlow' },
  archivo: { family: 'Archivo' },
  fraunces: { family: 'Fraunces' },
  'space grotesk': { family: 'Space Grotesk' },
};
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
const FONT_LINK_SPEC = {
  Anton: 'Anton',
  Archivo: 'Archivo:wght@400;500;600;700;800;900',
  Inter: 'Inter:wght@400;500;600;700;800;900',
  Fraunces: 'Fraunces:opsz,wght@9..144,400;9..144,600;9..144,800;9..144,900',
  'Space Grotesk': 'Space+Grotesk:wght@400;500;700',
  'Barlow Condensed': 'Barlow+Condensed:wght@500;600;700;800;900',
  Caveat: 'Caveat:wght@700',
  'Playfair Display': 'Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700',
  'Cormorant Garamond': 'Cormorant+Garamond:ital,wght@0,500;0,700;1,500;1,700',
  Oswald: 'Oswald:wght@400;500;600;700',
  Fredoka: 'Fredoka:wght@400;500;600;700',
  'Nunito Sans': 'Nunito+Sans:wght@400;600;700;800;900',
  'Patrick Hand': 'Patrick+Hand',
  Barlow: 'Barlow:wght@400;500;600;700;800',
};

// ─── Small CSS toolkit (flat rules + @-blocks; comments already stripped) ───
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Split CSS into top-level statements, respecting quotes, parens and braces. */
function splitStatements(css) {
  const out = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;
    let j = i;
    let quote = null;
    let paren = 0;
    while (j < n) {
      const c = css[j];
      if (quote) { if (c === '\\') { j += 2; continue; } if (c === quote) quote = null; j++; continue; }
      if (c === '"' || c === "'") { quote = c; j++; continue; }
      if (c === '(') paren++;
      else if (c === ')') paren--;
      else if (paren === 0 && (c === '{' || c === ';')) break;
      j++;
    }
    if (j >= n) break;
    if (css[j] === ';') { out.push({ kind: 'at-simple', text: css.slice(i, j + 1).trim() }); i = j + 1; continue; }
    const prelude = css.slice(i, j).trim();
    let depth = 1;
    let k = j + 1;
    quote = null;
    while (k < n && depth > 0) {
      const c = css[k];
      if (quote) { if (c === '\\') { k += 2; continue; } if (c === quote) quote = null; k++; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      k++;
    }
    const body = css.slice(j + 1, k - 1);
    if (prelude.startsWith('@')) out.push({ kind: 'at', prelude, body });
    else out.push({ kind: 'rule', selector: prelude, body });
    i = k;
  }
  return out;
}

/** Split a declaration block on top-level semicolons. */
function splitDecls(body) {
  const out = [];
  let cur = '';
  let quote = null;
  let paren = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(') paren++;
    if (c === ')') paren--;
    if (c === ';' && paren === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((d) => {
    const at = d.indexOf(':');
    return { prop: d.slice(0, at).trim().toLowerCase(), value: d.slice(at + 1).trim() };
  });
}
function joinDecls(decls) {
  return decls.map((d) => `${d.prop}:${d.value}`).join(';');
}
function splitSelectors(sel) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (const c of sel) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function serialize(stmts) {
  return stmts
    .map((s) => {
      if (s.kind === 'rule') return `${s.selector}{${s.body}}`;
      if (s.kind === 'at') return `${s.prelude}{${s.body}}`;
      return s.text;
    })
    .join('\n');
}

// ─── Colors (for compiling color-mix() out) ─────────────────────────────────
function parseColor(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s === 'white') return [255, 255, 255, 1];
  if (s === 'black') return [0, 0, 0, 1];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
  }
  m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length >= 4 ? p[3] : 1];
  }
  return null;
}
function fmtNum(x) {
  return String(Math.round(x * 1000) / 1000);
}
/** CSS Color 5 color-mix in srgb: premultiplied interpolation. */
function colorMix(expr, vars) {
  const inner = expr.slice(expr.indexOf('(') + 1, expr.lastIndexOf(')'));
  const parts = splitSelectors(inner);
  if (!/^in\s+srgb$/i.test(parts[0] || '')) throw new Error(`unsupported color-mix space: ${expr}`);
  const arg = (p) => {
    const m = /^(.*?)(?:\s+(\d+(?:\.\d+)?)%)?$/.exec(p.trim());
    let c = m[1].trim();
    const vm = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(c);
    if (vm) c = vars[vm[1]] || (vm[2] ? vm[2].trim() : '');
    const col = parseColor(c);
    if (!col) throw new Error(`cannot resolve color "${p}" in ${expr}`);
    return { col, pct: m[2] != null ? Number(m[2]) : null };
  };
  const a = arg(parts[1]);
  const b = arg(parts[2]);
  let pa = a.pct;
  let pb = b.pct;
  if (pa == null && pb == null) { pa = 50; pb = 50; }
  else if (pa == null) pa = 100 - pb;
  else if (pb == null) pb = 100 - pa;
  const wa = pa / (pa + pb);
  const wb = pb / (pa + pb);
  const alpha = a.col[3] * wa + b.col[3] * wb;
  if (alpha <= 0) return 'rgba(0,0,0,0)';
  const ch = (k) => Math.round((a.col[k] * a.col[3] * wa + b.col[k] * b.col[3] * wb) / alpha);
  return `rgba(${ch(0)},${ch(1)},${ch(2)},${fmtNum(alpha)})`;
}
function compileColorMix(value, vars) {
  let out = value;
  let guard = 0;
  while (/color-mix\(/i.test(out) && guard++ < 50) {
    const start = out.search(/color-mix\(/i);
    let depth = 0;
    let end = start;
    for (let i = start; i < out.length; i++) {
      if (out[i] === '(') depth++;
      if (out[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    out = out.slice(0, start) + colorMix(out.slice(start, end + 1), vars) + out.slice(end + 1);
  }
  return out;
}

// ─── Fonts in CSS ───────────────────────────────────────────────────────────
function mapFamilyList(list) {
  const fams = splitSelectors(list).map((f) => f.trim().replace(/^['"]|['"]$/g, ''));
  let mapped = null;
  let weight = null;
  const generic = [];
  for (const f of fams) {
    const key = f.toLowerCase();
    if (GENERIC_FAMILIES.has(key)) { generic.push(key); continue; }
    if (/^var\(/.test(f)) return { value: list, family: null, weight: null };
    if (!(key in FONT_MAP)) throw new Error(`unmapped font family "${f}" — add it to FONT_MAP`);
    const m = FONT_MAP[key];
    if (m && !mapped) { mapped = m.family; weight = m.weight || null; }
  }
  if (!mapped) return { value: list, family: null, weight: null };
  const generic2 = mapped === 'Fraunces' ? 'serif' : mapped === 'Caveat' ? 'cursive' : 'sans-serif';
  return { value: `'${mapped}',${generic2}`, family: mapped, weight };
}

/** Split on top-level whitespace (parens + quotes respected). */
function topLevelTokens(v) {
  const out = [];
  let cur = '';
  let depth = 0;
  let q = null;
  for (const c of v) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (/\s/.test(c) && depth === 0) { if (cur) out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** `font:` shorthand → { pre (style/variant/weight), size[/line-height], families }. */
function splitFontShorthand(value) {
  const t = topLevelTokens(value);
  const isSize = (x) =>
    /^(calc\(|clamp\(|min\(|max\(|var\(|[\d.]+(px|em|rem|%|pt|vw|vh|vmin|vmax|ch|ex|cqi|cqh|cqw)\b)/i.test(x) ||
    /^(xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)(\/|$)/i.test(x);
  const idx = t.findIndex(isSize);
  if (idx < 0 || idx === t.length - 1) return null;
  return { pre: t.slice(0, idx), size: t[idx], families: t.slice(idx + 1).join(' ') };
}

// ─── NEUTRALIZE: content → placeholders ─────────────────────────────────────
// A reference teaches layout, type scale and structure — never content. With a
// real business's words on it the model copied dish names onto other venues'
// boards, and the business itself could not be shown its own wall. So every
// word that belongs to the business (name, taglines, dishes, descriptions,
// prices, address, website) becomes a neutral placeholder of about the same
// length and line count — the layout still shows how long a name it holds — and
// the board's own furniture (01, 02 / 03, #1, ✹) stays. Photos are already
// empty frames (their files only resolve inside apps/web/public).
const ORDINALS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
// Each role: one bank per line (the last bank serves every later line). The
// entry closest in length to the original wins; ties go to the shorter one.
const BANKS = {
  name: [
    ['Item {n}', 'Menu Item {n}', 'Menu Item {n} Name', 'Featured Menu Item {n}', 'Menu Item {n} With A Long Name', 'Menu Item {n} With A Longer Name'],
    ['Name', 'Line Two', 'Second Line', 'Name Line Two', 'Second Name Line'],
  ],
  desc: [[
    'Short description.',
    'A short item description.',
    'A short description of this item.',
    'A short description of this menu item.',
    'A short description of this menu item goes here.',
    'A short description of this menu item, on one or two lines.',
  ]],
  category: [['Category', 'Category Name', 'Category Label', 'Menu Category Label', 'Featured Menu Category', 'Featured Menu Category Label']],
  label: [
    ['Label', 'Label Text', 'Short Label', 'Short Label Text', 'A Short Label Line'],
    ['Name', 'Line Two', 'Second Line', 'Name Line Two', 'Second Name Line'],
  ],
  listWord: [['Items', 'Category', 'Categories', 'Menu Items', 'More Categories']],
  headline: [
    ['Headline', 'Big Headline', 'Headline Here', 'Main Headline', 'Headline Goes Here'],
    ['Line Two', 'Second Line', 'Headline Line Two'],
  ],
  section: [
    ['Section', 'Menu Title', 'Section Title', 'Menu Section Title'],
    ['Title', '& Title', 'Line Two', 'Second Line'],
  ],
  brand: [['Venue Name', 'Venue Name Here', 'Venue Name and Tagline', 'Venue Name and Short Tagline']],
  tagline: [
    [
      'Tagline.',
      'Tagline here.',
      'Tagline goes here.',
      'Your tagline goes here.',
      'A short tagline goes here.',
      'A short tagline for the venue.',
      'A short tagline for the venue goes here.',
      'A longer tagline for the venue goes on this line.',
    ],
    ['Line Two', 'Second Line', 'Tagline Line Two', 'Second Tagline Line'],
  ],
};
const URL_RE = /(^|\s)(https?:\/\/|www\.)|[a-z0-9-]\.(com|net|org|co|us|io|biz|info|menu|restaurant|app)(\/|\s|$)/i;
const PHONE_RE = /\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const PRICE_RE = /[$€£¥]\s?\d/;
const HAS_LETTER = /\p{L}/u;
// Fields whose text is a list of short items split by a separator (the aside
// "Tacos · Burritos", the series "Menu Wall · 02 / 03", the origin line).
const LIST_LEAVES = new Set(['aside', 'series', 'origin']);

function normWords(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function namesBrand(text, tokens) {
  const hay = ` ${normWords(text)} `;
  const joined = hay.replace(/ /g, '');
  return (tokens || []).some((t) => {
    const nt = normWords(t);
    return !!nt && (hay.includes(` ${nt} `) || joined.includes(nt.replace(/ /g, '')));
  });
}
/** The bank entry closest in length to `text` (its trailing period set aside). */
function pick(text, bank, n) {
  const period = /\.$/.test(text);
  const target = (period ? text.slice(0, -1) : text).length;
  let best = null;
  for (const raw of bank) {
    const cand = raw.replace('{n}', n || 'One').replace(/\.$/, '');
    if (!best || Math.abs(cand.length - target) < Math.abs(best.length - target)) best = cand;
  }
  return period ? `${best}.` : best;
}
function matchCase(original, placeholder) {
  const letters = original.replace(/[^\p{L}]/gu, '');
  return letters.length > 1 && letters === letters.toUpperCase() ? placeholder.toUpperCase() : placeholder;
}
/** One line of one field → its placeholder. */
function placeholderFor(text, key, line, src) {
  if (PRICE_RE.test(text)) return text.replace(/\d/g, '0');
  if (!HAS_LETTER.test(text)) return text; // 01 · 02 / 03 · #1 · ✹ — the board's own furniture
  if (URL_RE.test(text)) return text.length >= 14 ? 'www.example.com' : 'example.com';
  if (PHONE_RE.test(text)) return '(555) 010-0000';
  const parts = String(key || '').split('.');
  const leaf = parts[parts.length - 1];
  const item = /^item\.(\d+)\./.exec(key || '');
  const bank = (role) => BANKS[role][Math.min(line, BANKS[role].length - 1)];
  const say = (role) => matchCase(text, pick(text, bank(role), item ? ORDINALS[Number(item[1])] : null));
  if (item && ['name', 'desc', 'category', 'label'].includes(leaf)) return say(leaf);
  if (namesBrand(text, src.brandTokens)) {
    // The wordmark alone ("SUPER TACO") is the venue's name, nothing more.
    const rest = normWords(text).replace(new RegExp(src.brandTokens.map((t) => normWords(t)).join('|'), 'g'), '').trim();
    return rest ? say('brand') : matchCase(text, 'Venue Name');
  }
  if (leaf === 'title') return say(parts[0] === 'hero' ? 'headline' : 'section');
  if (LIST_LEAVES.has(leaf)) {
    return text
      .split(/(\s+[·•|]\s+)/)
      .map((p, i) => (i % 2 === 1 || !HAS_LETTER.test(p) ? p : matchCase(p, pick(p, BANKS[leaf === 'aside' ? 'listWord' : 'label'][0]))))
      .join('');
  }
  return say('tagline');
}

// ─── NEUTRALIZE v2: welcome, announcement and information boards ───────────
// (2026-09-23) The menu boards' fields are a handful of roles (item name,
// description, price, venue). The welcome / news / bell-schedule / wayfinder
// boards carry many more: a school or venue name, a person, a coach, times,
// dates, rooms, destinations, periods, events, notices. Same rule as above —
// every word becomes a neutral placeholder of about the same length, in the
// same case, and the board's own furniture (01, 02 / 03, arrows, ●) stays —
// but the placeholder is chosen for the field's ROLE (from its data-field key,
// or a per-board `roles` override), and anything carrying a number keeps its
// SHAPE with every digit zeroed, the way a price becomes $00.00: "8:29 AM" →
// "0:00 AM", "7:50–8:42" → "0:00–0:00", "Room 118" → "Label 000".
// Opt-in per source (`neutralizer: 2`), so the six menu/offer references stay
// byte-identical.
const BANKS_V2 = {
  headline: [
    'Big',
    'Bold',
    'Title',
    'Headline',
    'Big Headline',
    'Headline Here',
    'Main Headline',
    'Headline Goes Here',
    'The Headline Goes Here',
    'The Main Headline Goes Here',
    'The Main Headline Goes Right Here',
    'The Main Headline Goes Here In Big Type',
    'The Main Headline Goes Here, Set In Big Type',
    'The Main Headline Goes Here, Set Large Across The Board',
  ],
  headline2: ['Two', 'Line Two', 'Second Line', 'Headline Line Two', 'The Headline Line Two'],
  title: ['Title', 'Section', 'Section Title', 'The Section Title', 'Section Title Goes Here', 'The Section Title Goes Here', 'The Section Title Goes Right Here'],
  copy: [
    'Short copy.',
    'A short line of copy.',
    'A short line of supporting copy.',
    'A short line of supporting copy goes here.',
    'A short line of supporting copy goes here, with detail.',
    'A short line of supporting copy goes here, with a little more detail.',
    'A short line of supporting copy goes here, with a little more detail for the reader.',
    'A short line of supporting copy goes here, with a little more detail for the reader on two lines.',
    'A short line of supporting copy goes here, with a little more detail for the reader, set on two or three lines.',
  ],
  label: ['Tag', 'Label', 'Label Text', 'Short Label', 'Short Label Text', 'A Short Label Line', 'A Short Label Line Here', 'A Longer Label Line Goes Here', 'A Longer Label Line Goes Right Here'],
  venue: ['Venue', 'Venue Name', 'The Venue Name', 'Venue Name Here', 'The Venue Name Here', 'Venue Name Goes Here', 'The Venue Name Goes Here'],
  person: ['Guest', 'Guest Name', 'Guest Name Here'],
  staff: ['Staff', 'Staff Name', 'Staff Member', 'Staff Member Name'],
  event: ['Event', 'Event Name', 'The Event Name', 'Event Name Here', 'Event Name Goes Here', 'The Event Name Goes Here', 'The Event Name Goes Right Here'],
  place: ['Place', 'Place Name', 'Location Name', 'Place Name Here', 'Location Name Here', 'Place Name Goes Here', 'Location Name Goes Here', 'The Location Name Goes Here'],
  class: ['Class', 'Class Name', 'Class Name Here', 'Class Name Goes Here', 'The Class Name Goes Here'],
  dish: ['Dish', 'Dish Name', 'Menu Item', 'Menu Item Name', 'Menu Item Name Here', 'Menu Item Name Goes Here', 'The Menu Item Name Goes Here'],
  initials: ['A', 'AB', 'ABC', 'ABCD'],
  // One word, for a run of words inside a numbered line ("Room 118", "Week 1 of 12").
  word: ['Tag', 'Info', 'Label', 'Detail', 'Details', 'Location', 'Information'],
};
// Words that stay inside a line with a number: they are how a time, a count or
// a range READS, not what the business wrote.
const KEEP_IN_NUMBERED = new Set(['am', 'pm', 'a.m.', 'p.m.', 'a', 'an', 'the', 'of', 'at', 'in', 'on', 'to', 'by', 'for', 'and', 'or', 'vs', 'x']);
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const WEEKDAYS_SHORT = ['mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];
/** A date word → its neutral stand-in ("Tuesday" → "Weekday", "Aug" → "Mth"), or null. */
function dateWord(word) {
  const w = word.toLowerCase().replace(/[.,]$/, '');
  const tail = word.slice(word.replace(/[.,]$/, '').length);
  if (WEEKDAYS.includes(w)) return matchCaseV2(word, 'Weekday') + tail;
  if (WEEKDAYS_SHORT.includes(w)) return matchCaseV2(word, 'Day') + tail;
  if (MONTHS.includes(w)) return matchCaseV2(word, 'Month') + tail;
  if (MONTHS_SHORT.includes(w)) return matchCaseV2(word, 'Mth') + tail;
  return null;
}
/**
 * Case like the original: ALL CAPS stays all caps, all lower stays lower, and a
 * sentence-cased line ("Reading buddies team up today") gets a sentence-cased
 * placeholder; Title Case keeps the bank's Title Case.
 */
function matchCaseV2(original, placeholder) {
  const letters = original.replace(/[^\p{L}]/gu, '');
  if (!letters) return placeholder;
  if (letters.length > 1 && letters === letters.toUpperCase()) return placeholder.toUpperCase();
  if (letters === letters.toLowerCase() || letters[0] !== letters[0].toUpperCase()) return placeholder.toLowerCase();
  const words = original.split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, '')).filter((w) => w.length > 3);
  const lowerLater = words.slice(1).filter((w) => w[0] === w[0].toLowerCase()).length;
  if (words.length > 1 && lowerLater * 2 >= words.length - 1) {
    const s = placeholder.toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return placeholder;
}
/** The bank entry closest in length; the original's closing punctuation ("Welcome," / "closer.") is kept. */
function fitV2(text, bank) {
  const close = (/[.,!?:;]$/.exec(text) || [''])[0];
  const target = text.length - close.length;
  let best = null;
  for (const raw of bank) {
    const cand = raw.replace(/[.,!?:;]$/, '');
    if (best === null || Math.abs(cand.length - target) < Math.abs(best.length - target)) best = cand;
  }
  return matchCaseV2(text, best + close);
}
const VENUE_HEADS = new Set(['school', 'brand', 'store', 'venue', 'business', 'site']);
const PERSON_HEADS = new Set(['member', 'guest', 'hero', 'student']);
const STAFF_HEADS = new Set(['trainer', 'coach', 'teacher', 'staff', 'host']);
const GROUP_ROLES = [
  [/^(event|events|rundown|cue|cues)$/, 'event'],
  [/^(route|routes|dest|destination|destinations|landmark|landmarks|location|map|directory|access)$/, 'place'],
  [/^(period|periods|block|blocks|class|classes|current|next|timeline|ledger|course)$/, 'class'],
  [/^(choice|choices|entree|side|sides|alternate|dish|item)$/, 'dish'],
];
/** The placeholder role of a field, from its key (a per-board `roles` override first). */
function roleOfKey(key, src, text) {
  for (const [re, role] of src.roles || []) if (re.test(key)) return role;
  const parts = String(key || '').toLowerCase().split('.');
  const head = parts[0];
  const leaf = parts[parts.length - 1];
  if (leaf === 'initials') return 'initials';
  if (leaf === 'name') {
    if (VENUE_HEADS.has(head)) return 'venue';
    if (PERSON_HEADS.has(head)) return 'person';
    if (STAFF_HEADS.has(head)) return 'staff';
    for (const [re, role] of GROUP_ROLES) if (re.test(head)) return role;
  }
  if (/^(headline|hello|greeting)$/.test(leaf)) return 'headline';
  if (/^(title|heading|program|edition)$/.test(leaf)) return 'title';
  if (/^(summary|description|desc|detail|details|bio\d*|message|note|motto\d*|legend|copy|body|text|blurb|subtitle|tagline|help)$/.test(leaf)) return 'copy';
  if (/^(kicker|eyebrow|label|tag|status|badge|mode|chapter|medialabel|systemname|q|cta)$/.test(leaf)) return 'label';
  for (const [re, role] of GROUP_ROLES) if (re.test(head) && /^(name|value|course|t)$/.test(leaf)) return role;
  return String(text || '').length > 28 ? 'copy' : 'label';
}
/** A digit-only string that is a time or a range ("9:42", "14:32", "10—8") is content; an index ("01", "02 / 03") is furniture. */
const TIME_OR_RANGE_RE = /\d:\d\d|\d\s*[–—-]\s*\d/;
/**
 * A line segment that carries a number: every digit becomes 0, a.m./p.m. and
 * small words stay, a date word becomes its stand-in, and every other run of
 * words becomes the role's placeholder fitted to the run.
 */
const NAME_ROLES = new Set(['venue', 'person', 'staff', 'event', 'place', 'class', 'dish']);
function numberedV2(seg, role) {
  const tokens = seg.split(/(\s+)/);
  // A sentence that happens to hold a number ("Book with your coach, 30 min")
  // reads as words: it takes the role's placeholder whole. Only a number-shaped
  // line (at most two words besides a.m./p.m., small words and dates) keeps its
  // shape.
  const wordy = tokens.filter((t) => HAS_LETTER.test(t) && !/\d/.test(t) && !KEEP_IN_NUMBERED.has(t.toLowerCase().replace(/[^a-z.]/g, '')) && !dateWord(t));
  if (wordy.length > 2) return fitV2(seg.trim(), BANKS_V2[NAME_ROLES.has(role) ? role : 'label']);
  const out = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const words = run.join('');
    const multi = words.trim().split(/\s+/).length > 1;
    const bank = NAME_ROLES.has(role) ? BANKS_V2[role] : multi ? BANKS_V2.label : BANKS_V2.word;
    out.push(fitV2(words.trim(), bank) + (/\s$/.test(words) ? ' ' : ''));
    run = [];
  };
  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      if (run.length) run.push(tok);
      else out.push(tok);
      continue;
    }
    const bare = tok.toLowerCase().replace(/[^a-z.]/g, '');
    const date = HAS_LETTER.test(tok) && !/\d/.test(tok) ? dateWord(tok) : null;
    if (/\d/.test(tok) || !HAS_LETTER.test(tok) || KEEP_IN_NUMBERED.has(bare) || date) {
      flush();
      // A token mixing letters and digits ("B-201", "#114", "1F"): zero the digits, and a
      // lone letter becomes A (a wing / building code is content too).
      let t = tok.replace(/\d/g, '0');
      if (/\d/.test(tok)) t = t.replace(/\b\p{L}\b/gu, (c) => (c === c.toUpperCase() ? 'A' : 'a'));
      out.push(date || t);
      continue;
    }
    run.push(tok);
  }
  flush();
  return out.join('').replace(/\s+$/, (m) => (/\s$/.test(seg) ? m : ''));
}
const SEGMENT_SPLIT_RE = /(\s+[·•|—–]\s+)/;
/** One line of one field → its placeholder (v2). */
function placeholderV2(text, key, line, src) {
  if (PRICE_RE.test(text)) return text.replace(/\d/g, '0');
  if (!HAS_LETTER.test(text)) return TIME_OR_RANGE_RE.test(text) ? text.replace(/\d/g, '0') : text;
  if (URL_RE.test(text)) return text.length >= 14 ? 'www.example.com' : 'example.com';
  if (PHONE_RE.test(text)) return '(555) 010-0000';
  // Menu rows keep the menu placeholders ("Menu Item One"), so a K-12 lunch
  // board and a restaurant board teach the same row vocabulary.
  if (/^item\.\d+\.(name|desc|category|label)$/.test(key || '')) return placeholderFor(text, key, line, src);
  const role = roleOfKey(key, src, text);
  if (role === 'keep') return text;
  const bankFor = (r) => (r === 'headline' && line > 0 ? BANKS_V2.headline2 : BANKS_V2[r]);
  // A headline or a sentence of copy is one unit: its dashes and dots are
  // punctuation, its numbers are words.
  if (role === 'headline' || role === 'copy') return fitV2(text, bankFor(role));
  return text
    .split(SEGMENT_SPLIT_RE)
    .map((seg, i) => {
      if (i % 2 === 1 || !seg.trim()) return seg;
      if (!HAS_LETTER.test(seg)) return /\d/.test(seg) ? seg.replace(/\d/g, '0') : seg;
      if (/\d/.test(seg)) return numberedV2(seg, role);
      const word = seg.trim();
      if (!/\s/.test(word) && dateWord(word)) return seg.replace(word, dateWord(word));
      const segRole = namesBrand(seg, src.brandTokens) ? 'venue' : role;
      return seg.replace(word, fitV2(word, bankFor(segRole)));
    })
    .join('');
}

/**
 * Replace every content text node under <body> with its placeholder, keeping
 * whitespace, <br> line structure and every element. Line N of a field is its
 * Nth text node with letters, so "3 Birria Tacos<br>with Consomé" becomes
 * "Menu Item One<br>Second Line".
 */
function neutralizeContent($, $body, src) {
  const placeholder = src.neutralizer === 2 ? placeholderV2 : placeholderFor;
  const lineOf = new Map();
  const walk = (node) => {
    for (const child of node.children || []) {
      if (child.type === 'text') {
        const raw = child.data;
        const text = raw.trim();
        if (!text) continue;
        const $field = $(child.parent).closest('[data-field]');
        const fieldEl = $field.get(0) || null;
        const key = fieldEl ? $field.attr('data-field') : '';
        let line = 0;
        if (fieldEl && HAS_LETTER.test(text)) {
          line = lineOf.get(fieldEl) || 0;
          lineOf.set(fieldEl, line + 1);
        }
        const lead = raw.slice(0, raw.indexOf(text));
        const tail = raw.slice(raw.indexOf(text) + text.length);
        child.data = lead + placeholder(text, key, line, src) + tail;
      } else if (child.type === 'tag') {
        walk(child);
      }
    }
  };
  walk($body.get(0));
  // Text carried in attributes is content too.
  $body.find('[title],[aria-label],[alt]').each((_i, el) => {
    for (const attr of ['title', 'aria-label', 'alt']) {
      const v = $(el).attr(attr);
      if (v && HAS_LETTER.test(v)) $(el).attr(attr, attr === 'alt' ? '' : 'Label');
    }
  });
}

// ─── The type floor ─────────────────────────────────────────────────────────
// The Designer's size floor is clamp(round(0.024 × short side), 24, 60) — 52 px
// on these 4K canvases (designer-prompt.ts designerSizeFloor; the fit engine's
// MINPX). A reference must not teach type below it: the model copies the
// scale, and the fit engine would then enlarge the copy into its own boxes. So
// every font size under the floor is lifted to it here, in the COMPILED
// exemplar only; `adjust` on the source entry gives the few fixed boxes that
// need it the extra room.
function typeFloor(w, h) {
  return Math.min(60, Math.max(24, Math.round(0.024 * Math.min(w, h))));
}
/** Index of the `/` that separates size from line-height (outside parens), or -1. */
function topLevelSlash(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === '/' && depth === 0) return i;
  }
  return -1;
}
/** `42px` / `calc(42px * var(--type-scale))` under the floor → the floor; else unchanged. */
function liftSize(size, floor) {
  const m = /^(calc\(\s*)?(\d+(?:\.\d+)?)px(\s*\*\s*var\(--type-scale\)\s*\))?$/.exec(size);
  if (!m || Boolean(m[1]) !== Boolean(m[3])) return size;
  if (Number(m[2]) >= floor) return size;
  return `${m[1] || ''}${floor}px${m[3] || ''}`;
}
function liftDecls(decls, floor, notes, selector) {
  return decls.map((d) => {
    if (d.prop === 'font-size') {
      const v = liftSize(d.value, floor);
      if (v !== d.value) notes.push(`type floor: ${selector} font-size ${d.value} → ${v}`);
      return { prop: d.prop, value: v };
    }
    if (d.prop === 'font') {
      const parts = splitFontShorthand(d.value);
      if (!parts) return d;
      const slash = topLevelSlash(parts.size);
      const size = slash < 0 ? parts.size : parts.size.slice(0, slash);
      const lh = slash < 0 ? '' : parts.size.slice(slash + 1);
      const v = liftSize(size, floor);
      if (v === size) return d;
      notes.push(`type floor: ${selector} font ${size} → ${v}`);
      return { prop: d.prop, value: [...parts.pre, lh ? `${v}/${lh}` : v, parts.families].join(' ') };
    }
    return d;
  });
}

// ─── The build ──────────────────────────────────────────────────────────────
function sha(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function buildVariant(src, rawHtml, orientation) {
  const notes = [];
  const $ = cheerio.load(rawHtml);

  // 1. SCRIPTS — every one: injected shims, kiosk shim refs, the board's own.
  const scriptMarkers = [];
  $('script').each((_i, el) => {
    const s = $(el).html() || '';
    const m = /^\s*\/\*(EDUCMS-[A-Z0-9-]+|VOS-[A-Z-]+)\*\//.exec(s);
    if (m) scriptMarkers.push(m[1]);
    if (/_edit-shim/.test($(el).attr('src') || '')) scriptMarkers.push('_edit-shim.js');
  });
  $('script, noscript, template').remove();

  // 2. CSS — every <style>, in order.
  let css = $('style')
    .map((_i, el) => $(el).html() || '')
    .get()
    .join('\n');
  css = stripCssComments(css);

  // 3. MARKUP — the body, minus what an AI board can never have.
  const $body = $('body');
  $body.find('video, audio, iframe, object, embed').remove();
  $body.find('[hidden]').remove();
  $body.find('.theme-data, [data-widget="theme"]').remove();
  for (const sel of src.dropMarkup || []) $body.find(sel).remove();
  for (const [sel, classes] of Object.entries(src.removeClasses || {})) {
    $body.find(sel).each((_i, el) => { for (const c of classes) $(el).removeClass(c); });
  }
  // Row contract: one container per menu item carrying data-menu-row="N",
  // standard item.N.* keys inside. data-seed is the live binder's stamp (the
  // server writes it after generation) — a reference must not teach the model
  // to write it.
  if (src.rows) {
    const rename = src.rows.rename;
    $body.find(src.rows.selector).each((_i, el) => {
      const $row = $(el);
      $row.removeAttr('data-seed');
      if (rename) {
        $row.find('[data-field],[data-imgslot]').each((_j, f) => {
          for (const attr of ['data-field', 'data-imgslot']) {
            const v = $(f).attr(attr);
            if (!v) continue;
            const m = new RegExp('^' + rename.prefix + '\\.(\\d+)\\.(.+)$').exec(v);
            if (m) $(f).attr(attr, `item.${m[1]}.${(rename.leaves || {})[m[2]] || m[2]}`);
          }
        });
      }
      const first = $row.find('[data-field^="item."]').first().attr('data-field') || '';
      const n = /^item\.(\d+)\./.exec(first);
      if (!n) throw new Error(`${src.id}: row without item.N.* fields`);
      $row.attr('data-menu-row', n[1]);
    });
  }
  $body.find('[data-img]').removeAttr('data-img');
  $body.find('[data-has-image]').removeAttr('data-has-image');
  $body.find('[data-menu-mode]').removeAttr('data-menu-mode');
  $body.find('[data-videoslot]').removeAttr('data-videoslot');
  $body.find('[data-posterslot]').removeAttr('data-posterslot');
  // Attributes only the board's OWN runtime reads (the shim's style targets,
  // widget groupings, live-clock / carousel config): inert once its scripts are
  // gone, and not part of the Designer's contract — so not taught.
  for (const attr of src.stripAttrs || []) $body.find(`[${attr}]`).removeAttr(attr);
  // Scaffolding a wrapper only its own scaling script needed ("the viewport"):
  // its children take its place, so the stage is the first child of <body>.
  for (const sel of src.unwrap || []) {
    const hits = $body.find(sel);
    if (!hits.length) throw new Error(`${src.id}: unwrap — no ${sel} in the markup`);
    hits.each((_i, el) => { $(el).replaceWith($(el).contents()); });
  }
  // Images that only resolve inside apps/web/public: drop the source, keep the slot.
  $body.find('img').each((_i, el) => {
    const s = $(el).attr('src') || '';
    if (s && !/^https:\/\//i.test(s)) $(el).removeAttr('src');
    if (!$(el).attr('src')) $(el).attr('alt', '');
    $(el).removeAttr('srcset');
  });
  $body.find('[style]').each((_i, el) => {
    const style = $(el).attr('style') || '';
    const kept = splitDecls(style).filter((d) => !(/^background(-image)?$/.test(d.prop) && /url\(/i.test(d.value) && !/url\(\s*['"]?https:/i.test(d.value)));
    if (kept.length) $(el).attr('style', joinDecls(kept) + ';');
    else $(el).removeAttr('style');
  });
  // Content → placeholders (see NEUTRALIZE), and class names that carry content.
  neutralizeContent($, $body, src);
  for (const [from, to] of Object.entries(src.renameClasses || {})) {
    const hits = $body.find(`.${from}`);
    if (!hits.length) throw new Error(`${src.id}: renameClasses — no .${from} in the markup`);
    hits.each((_i, el) => { $(el).removeClass(from).addClass(to); });
  }
  // What the model may see on a v2 board: the Designer's own attributes only
  // (a board carrying another runtime's config would teach the model to write
  // it). A new one fails the build here rather than slipping into a prompt.
  if (src.neutralizer === 2) {
    const allowed = new Set(['data-field', 'data-imgslot', 'data-menu-row', 'data-fit', 'data-fit-min', 'data-fit-max', 'data-fit-col', 'data-action']);
    $body.find('*').each((_i, el) => {
      for (const a of Object.keys(el.attribs || {})) {
        if (a.startsWith('data-') && !allowed.has(a)) throw new Error(`${src.id}: ${a} is not a Designer attribute — add it to stripAttrs`);
      }
    });
  }

  // Portrait: set the flag the board's own runtime would set.
  let bodyClass = '';
  let htmlClass = '';
  if (orientation === 'portrait') {
    const flag = src.portrait.flag;
    if (flag.on === 'html') htmlClass = flag.className;
    else if (flag.on === 'body') bodyClass = flag.className;
    else {
      const target = $body.find(flag.on).first();
      if (!target.length) throw new Error(`${src.id}: portrait flag target ${flag.on} not found`);
      if (flag.className) target.addClass(flag.className);
      if (flag.attr) target.attr(flag.attr[0], flag.attr[1]);
    }
  }

  // The stage must be the first element child of <body>.
  const first = $body.children().first();
  if (!first.is(src.stage)) throw new Error(`${src.id}: first element of <body> is not the stage ${src.stage}`);

  // 4. CSS transforms.
  let stmts = splitStatements(css);
  // Root custom properties (for color-mix + font var resolution).
  const vars = {};
  for (const s of stmts) {
    if (s.kind === 'rule' && /(^|,)\s*:root\s*(,|$)/.test(s.selector)) {
      for (const d of splitDecls(s.body)) if (d.prop.startsWith('--')) vars[d.prop] = d.value;
    }
  }
  // Fonts in custom properties first (so `var(--font-display)` resolves).
  const varFont = {};
  for (const s of stmts) {
    if (s.kind !== 'rule' || !/(^|,)\s*:root\s*(,|$)/.test(s.selector)) continue;
    const decls = splitDecls(s.body).map((d) => {
      // Font custom properties only (`--font-display`, `--f-body`) — never `--fg`.
      if (!/^--(font-|font$|f-)[\w-]*$/.test(d.prop) || /^(#|rgb|hsl|\d)/i.test(d.value)) return d;
      const fam = mapFamilyList(d.value);
      if (fam.family) varFont[d.prop] = fam;
      return { prop: d.prop, value: fam.value };
    });
    s.body = joinDecls(decls);
  }
  // A selector is portrait-only when it opens with one of the board's portrait
  // flags followed by a boundary (so `.portrait` never matches `.portrait-only`).
  const prefixes = src.portrait ? src.portrait.prefixes : [];
  const prefixOf = (sel) => prefixes.find((p) => sel === p || (sel.startsWith(p) && /[\s>+~.:#[]/.test(sel[p.length]))) || null;
  const isPortraitSel = (sel) => !!prefixOf(sel);
  const stripPrefix = (x) => {
    const p = prefixOf(x);
    return p ? x.slice(p.length).trim() || x : x;
  };

  const extra = [];
  const kept = [];
  for (const s of stmts) {
    if (s.kind === 'at') {
      if ((src.dropAtRules || []).some((re) => re.test(s.prelude))) continue;
      if (/^@media/i.test(s.prelude) && /orientation\s*:\s*portrait/i.test(s.prelude)) {
        if (orientation !== 'portrait') continue;
      }
      if (/^@(media|supports)/i.test(s.prelude)) {
        const inner = splitStatements(s.body).map((r) => (r.kind === 'rule' ? { ...r, body: joinDecls(splitDecls(r.body).map((d) => ({ prop: d.prop, value: compileColorMix(d.value, vars) }))) } : r));
        s.body = serialize(inner);
      }
      kept.push(s);
      continue;
    }
    if (s.kind !== 'rule') { kept.push(s); continue; }
    // Orientation: landscape drops portrait-only selectors; portrait keeps them.
    let sels = splitSelectors(s.selector);
    if (orientation !== 'portrait') sels = sels.filter((x) => !isPortraitSel(x));
    sels = sels.filter((x) => !(src.dropCss || []).some((re) => re.test(stripPrefix(x))));
    if (!sels.length) continue;
    s.selector = sels.join(',');
    let decls = splitDecls(s.body);
    for (const dd of src.dropDeclarations || []) {
      if (dd.selector.test(s.selector)) decls = decls.filter((d) => !dd.props.includes(d.prop));
    }
    // Asset URLs that only resolve inside apps/web/public.
    decls = decls.filter((d) => !(/^background-image$/.test(d.prop) && /url\(/i.test(d.value) && !/url\(\s*['"]?(https:|data:)/i.test(d.value)));
    decls = decls.map((d) => {
      if (d.prop === 'background' && /url\(\s*['"]?\//i.test(d.value)) {
        return { prop: d.prop, value: d.value.replace(/url\(\s*['"]?\/[^)]*\)\s*/gi, '').trim() || 'transparent' };
      }
      return d;
    });
    // color-mix() → resolved rgba (Chromium 83 has no color-mix).
    decls = decls.map((d) => ({ prop: d.prop, value: compileColorMix(d.value, vars) }));
    // Fonts.
    let forcedWeight = null;
    decls = decls.map((d) => {
      if (d.prop === 'font-family') {
        const fam = mapFamilyList(d.value);
        const vm = /^var\((--[\w-]+)\)/.exec(d.value.trim());
        if (vm && varFont[vm[1]]) forcedWeight = varFont[vm[1]].weight;
        else if (fam.family) forcedWeight = fam.weight;
        return { prop: d.prop, value: fam.value };
      }
      if (d.prop === 'font') {
        const parts = splitFontShorthand(d.value);
        if (!parts) return d;
        let families = parts.families;
        let weight = null;
        const vm = /^var\((--[\w-]+)\)/.exec(families.trim());
        if (vm && varFont[vm[1]]) weight = varFont[vm[1]].weight;
        else {
          const fam = mapFamilyList(families);
          families = fam.value;
          weight = fam.weight;
        }
        let pre = parts.pre.slice();
        if (weight) {
          const wi = pre.findIndex((x) => /^(\d00|bold|bolder|lighter)$/i.test(x));
          if (wi >= 0) pre[wi] = String(weight);
          else pre = [String(weight), ...pre];
        }
        return { prop: d.prop, value: [...pre, parts.size, families].join(' ') };
      }
      return d;
    });
    if (forcedWeight) {
      const idx = decls.findIndex((d) => d.prop === 'font-weight');
      if (idx >= 0) decls[idx] = { prop: 'font-weight', value: String(forcedWeight) };
      else decls.push({ prop: 'font-weight', value: String(forcedWeight) });
    }
    // The stage: the Designer contract (first child, fixed px, no self-scaling).
    const isStage = sels.some((x) => x === src.stage);
    if (isStage && sels.length === 1) {
      decls = decls.filter((d) => !['position', 'top', 'left', 'right', 'bottom', 'transform', 'transform-origin', 'margin'].includes(d.prop));
      decls.unshift({ prop: 'position', value: 'relative' });
    }
    s.body = joinDecls(decls);
    kept.push(s);
  }
  stmts = kept;

  // Flex `gap` → child margins (Chromium 83 has no flex gap; grid gap is fine).
  const displayOf = {};
  const dirOf = {};
  const wrapOf = {};
  for (const s of stmts) {
    if (s.kind !== 'rule') continue;
    const decls = splitDecls(s.body);
    for (const sel of splitSelectors(s.selector)) {
      for (const d of decls) {
        if (d.prop === 'display') displayOf[sel] = d.value;
        if (d.prop === 'flex-direction') dirOf[sel] = d.value;
        if (d.prop === 'flex-wrap') wrapOf[sel] = d.value;
        if (d.prop === 'flex-flow') { dirOf[sel] = /column/.test(d.value) ? 'column' : 'row'; if (/wrap/.test(d.value)) wrapOf[sel] = 'wrap'; }
      }
    }
  }
  const out = [];
  for (const s of stmts) {
    if (s.kind !== 'rule') { out.push(s); continue; }
    let decls = splitDecls(s.body);
    const gaps = decls.filter((d) => d.prop === 'gap' || d.prop === 'row-gap' || d.prop === 'column-gap');
    if (!gaps.length) { out.push(s); continue; }
    const sels = splitSelectors(s.selector);
    const baseSel = stripPrefix;
    const display = decls.find((d) => d.prop === 'display')?.value || displayOf[sels[0]] || displayOf[baseSel(sels[0])];
    if (!display) throw new Error(`${src.id}: gap on "${s.selector}" with no known display`);
    if (/grid/.test(display)) { out.push(s); continue; }
    if (!/flex/.test(display)) throw new Error(`${src.id}: gap on non-flex/grid "${s.selector}" (${display})`);
    const dir = decls.find((d) => d.prop === 'flex-direction')?.value || dirOf[sels[0]] || dirOf[baseSel(sels[0])] || 'row';
    const wrap = decls.find((d) => d.prop === 'flex-wrap')?.value || wrapOf[sels[0]] || wrapOf[baseSel(sels[0])] || 'nowrap';
    if (/^wrap/.test(wrap)) throw new Error(`${src.id}: flex-wrap + gap on "${s.selector}" needs a hand conversion`);
    let rowGap = null;
    let colGap = null;
    for (const g of gaps) {
      const v = g.value.split(/\s+/);
      if (g.prop === 'gap') { rowGap = v[0]; colGap = v[1] || v[0]; }
      if (g.prop === 'row-gap') rowGap = v[0];
      if (g.prop === 'column-gap') colGap = v[0];
    }
    const vertical = /column/.test(dir);
    const amount = vertical ? rowGap : colGap;
    decls = decls.filter((d) => !(d.prop === 'gap' || d.prop === 'row-gap' || d.prop === 'column-gap'));
    s.body = joinDecls(decls);
    out.push(s);
    if (amount && amount !== '0' && amount !== '0px') {
      const childSel = sels.map((x) => `${x}>*+*`).join(',');
      out.push({ kind: 'rule', selector: childSel, body: `${vertical ? 'margin-top' : 'margin-left'}:${amount}` });
      notes.push(`flex gap ${amount} on ${s.selector} → ${vertical ? 'margin-top' : 'margin-left'}`);
    }
  }
  stmts = out;

  // The type floor, then the compiled-only room it needs (see The type floor).
  const canvas = orientation === 'portrait' ? src.portrait.canvas : src.canvas;
  const floor = typeFloor(canvas.w, canvas.h);
  const liftRules = (list) =>
    list.map((s) => {
      if (s.kind === 'rule') return { ...s, body: joinDecls(liftDecls(splitDecls(s.body), floor, notes, s.selector)) };
      if (s.kind === 'at' && /^@(media|supports)/i.test(s.prelude)) return { ...s, body: serialize(liftRules(splitStatements(s.body))) };
      return s;
    });
  stmts = liftRules(stmts);
  for (const a of (src.adjust || {})[orientation] || []) {
    const rule = stmts.find((s) => s.kind === 'rule' && s.selector === a.selector);
    if (!rule) throw new Error(`${src.id}: adjust — no rule "${a.selector}" in the ${orientation} CSS`);
    const decls = splitDecls(rule.body);
    for (const [prop, value] of Object.entries(a.set)) {
      const at = decls.findIndex((d) => d.prop === prop);
      if (at >= 0) decls[at] = { prop, value };
      else decls.push({ prop, value });
    }
    rule.body = joinDecls(decls);
    notes.push(`adjust (${orientation}): ${a.selector} ${JSON.stringify(a.set)}`);
  }

  let finalCss = serialize(stmts);
  for (const [from, to] of Object.entries(src.renameClasses || {})) {
    finalCss = finalCss.replace(new RegExp(`\\.${from}(?![\\w-])`, 'g'), `.${to}`);
  }

  // 5. Fonts used → the one Google Fonts <link> this board needs.
  const families = new Set();
  for (const m of finalCss.matchAll(/'([A-Z][A-Za-z0-9 ]+)'/g)) if (FONT_LINK_SPEC[m[1]]) families.add(m[1]);
  const link = families.size
    ? `<link href="https://fonts.googleapis.com/css2?${[...families].sort().map((f) => `family=${FONT_LINK_SPEC[f]}`).join('&')}&display=swap" rel="stylesheet">`
    : '';

  // 6. Assemble.
  const bodyHtml = ($body.html() || '')
    // cheerio writes boolean attributes as `data-fit=""`; write them the way a
    // person does (and the way the Designer prompt shows them).
    .replace(/ (data-[\w-]+)=""/g, ' $1')
    .replace(/>\s+</g, '><')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  const html = [
    `<!doctype html><html lang="en"${htmlClass ? ` class="${htmlClass}"` : ''}><head><meta charset="utf-8">`,
    link,
    `<style>\n${finalCss}\n</style></head><body${bodyClass ? ` class="${bodyClass}"` : ''}>`,
    bodyHtml,
    '</body></html>',
  ].join('');

  // 7. Facts about the result, for selection + the prompt label.
  // itemCount: the repeated rows the board shows (menu items, offers, events —
  // a v2 board may name its own row prefix: periods, routes). priced: it has a
  // price per item (the POS binder and the price guard's tests read this).
  const itemGroups = new Set();
  const itemRe = new RegExp(`data-field="(?:${(src.itemPrefixes || ['item', 'combo', 'event']).join('|')})\\.(\\d+)\\.`, 'g');
  for (const m of bodyHtml.matchAll(itemRe)) itemGroups.add(m[1]);
  const priced = /data-field="item\.\d+\.price"/.test(bodyHtml);
  return { html, itemCount: itemGroups.size, priced, canvas, scriptMarkers: [...new Set(scriptMarkers)].sort(), notes };
}

function buildAll() {
  const entries = [];
  for (const src of SOURCES.filter((x) => x.status === 'reference')) {
    const abs = path.join(REPO, src.file);
    const raw = fs.readFileSync(abs, 'utf8');
    const variants = src.portrait ? ['landscape', 'portrait'] : ['landscape'];
    for (const orientation of variants) {
      const v = buildVariant(src, raw, orientation);
      entries.push({
        id: orientation === 'portrait' ? `${src.id}-portrait` : src.id,
        title: src.title,
        sourceSha256: sha(raw).slice(0, 16),
        approval: src.approval,
        vertical: src.vertical,
        verticals: src.verticals,
        verticalOnly: !!src.verticalOnly,
        purposes: src.purposes,
        structure: src.structure,
        orientation,
        width: v.canvas.w,
        height: v.canvas.h,
        itemCount: v.itemCount,
        priced: v.priced,
        strippedRuntimes: v.scriptMarkers,
        html: v.html,
      });
    }
  }
  return entries;
}

function render() {
  const entries = buildAll();
  const lines = [];
  lines.push('/* eslint-disable */');
  lines.push('/**');
  lines.push(' * AUTO-GENERATED by apps/api/scripts/build-designer-exemplars.cjs — DO NOT EDIT.');
  lines.push(' * Re-run `node apps/api/scripts/build-designer-exemplars.cjs` after changing a source board');
  lines.push(' * or the script; designer-exemplars.spec.ts fails while this file is stale.');
  lines.push(' *');
  lines.push(' * The AI Designer\'s reference boards: approved boards from apps/web/public/templates, reduced');
  lines.push(' * to their hand-written CSS + markup (no scripts, fonts on DESIGNER_FONTS, LED-safe CSS, no type');
  lines.push(' * under the size floor). Every word, price and photo is a neutral placeholder (VENUE NAME,');
  lines.push(' * Menu Item One, $0.00, empty photo frames): a reference teaches layout, type scale and');
  lines.push(' * structure, never content. Which board each one came from: SOURCES in the builder.');
  lines.push(' */');
  lines.push("import type { DesignerExemplar } from './designer-exemplars';");
  lines.push('');
  lines.push('export const DESIGNER_EXEMPLARS: readonly DesignerExemplar[] = [');
  for (const e of entries) {
    lines.push('  {');
    for (const key of ['id', 'title', 'sourceSha256', 'approval', 'vertical', 'verticals', 'verticalOnly', 'purposes', 'structure', 'orientation', 'width', 'height', 'itemCount', 'priced', 'strippedRuntimes', 'html']) {
      lines.push(`    ${key}: ${JSON.stringify(e[key])},`);
    }
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

module.exports = { render, buildAll, buildVariant, SOURCES, colorMix, splitStatements, splitDecls, mapFamilyList, placeholderFor, placeholderV2, liftSize, typeFloor };

if (require.main === module) {
  const text = render();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== text) {
      console.error('designer-exemplars.generated.ts is STALE — run: node apps/api/scripts/build-designer-exemplars.cjs');
      process.exit(1);
    }
    console.log('designer-exemplars.generated.ts is up to date');
  } else if (process.argv.includes('--print')) {
    process.stdout.write(text);
  } else {
    fs.writeFileSync(OUT, text);
    const entries = buildAll();
    for (const e of entries) {
      console.log(`${e.id.padEnd(40)} ${e.orientation.padEnd(9)} ${String(e.width)}x${e.height}  items=${e.itemCount}  ${e.html.length} chars  (stripped: ${e.strippedRuntimes.join(', ') || 'none'})`);
    }
    console.log(`wrote ${path.relative(REPO, OUT)} (${text.length} chars, ${entries.length} exemplars)`);
  }
}
