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
 *     → child margins, `color-mix()` → a resolved rgba). Grid `gap` stays.
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
const SUPER_TACO_APPROVAL =
  "Greg, 2026-09-22: the Super Taco wall Codex built on GPT-6 Sol is the bar the AI Designer must meet (\"learn from this and make our AI generation this good\") — docs/research/2026-09-22-ai-designer-rework/README.md";
const GYM_WELCOME_APPROVAL =
  "APPROVED 2026-07-02 by Greg (\"i like them all, keep them\") — docs/design/approved/2026-07-02-gym-welcome/README.md";
const MORNING_NEWS_APPROVAL =
  "APPROVED 2026-08-18 — marker in the board: user requested all three Morning News boards (\"do them all\")";

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
const SOURCES = [
  {
    status: 'reference',
    id: 'super-taco-hero-cards',
    file: 'apps/web/public/templates/signage/qsr/24-super-taco-flagship.html',
    title: 'Super Taco · Flagship Menu',
    brand: 'Super Taco',
    brandTokens: ['super taco', 'supertaco'],
    vertical: 'qsr',
    purposes: ['menu'],
    structure: 'hero-cards',
    canvas: { w: 3840, h: 2160 },
    stage: '.stage',
    portrait: { canvas: { w: 2160, h: 3840 }, prefixes: ['body.portrait'], flag: { on: 'body', className: 'portrait' } },
    rows: { selector: 'article.dish' },
    dropMarkup: ['#empty'],
    dropCss: [/^\.empty$/, /\.soldout/],
    approval: SUPER_TACO_APPROVAL,
  },
  {
    status: 'reference',
    id: 'super-taco-rail-cards',
    file: 'apps/web/public/templates/signage/qsr/26-super-taco-burritos.html',
    title: 'Super Taco · Burritos & More (menu wall 2 of 3)',
    brand: 'Super Taco',
    brandTokens: ['super taco', 'supertaco'],
    vertical: 'qsr',
    purposes: ['menu'],
    structure: 'rail-cards',
    canvas: { w: 3840, h: 2160 },
    stage: '.stage',
    portrait: { canvas: { w: 2160, h: 3840 }, prefixes: ['.portrait'], flag: { on: 'html', className: 'portrait' } },
    rows: { selector: 'article.dish' },
    dropMarkup: ['#empty'],
    dropCss: [/^\.empty$/, /^\.theme-data$/, /\.combo-/, /^\.mode-(tacos|combos)/],
    approval: SUPER_TACO_APPROVAL,
  },
  {
    status: 'reference',
    id: 'super-taco-split-offer',
    file: 'apps/web/public/templates/signage/qsr/27-super-taco-combos.html',
    title: 'Super Taco · Combination Plates (menu wall 3 of 3)',
    brand: 'Super Taco',
    brandTokens: ['super taco', 'supertaco'],
    vertical: 'qsr',
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
    approval: SUPER_TACO_APPROVAL,
  },
  // ── Considered, NOT compiled ────────────────────────────────────────────
  {
    status: 'candidate',
    id: 'super-taco-rail-cards-tacos',
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
  const finalCss = serialize(stmts);

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
  const itemGroups = new Set();
  for (const m of bodyHtml.matchAll(/data-field="(?:item|combo|event)\.(\d+)\./g)) itemGroups.add(m[1]);
  const canvas = orientation === 'portrait' ? src.portrait.canvas : src.canvas;
  return { html, itemCount: itemGroups.size, canvas, scriptMarkers: [...new Set(scriptMarkers)].sort(), notes };
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
        source: src.file,
        sourceSha256: sha(raw).slice(0, 16),
        approval: src.approval,
        brand: src.brand,
        brandTokens: src.brandTokens,
        vertical: src.vertical,
        purposes: src.purposes,
        structure: src.structure,
        orientation,
        width: v.canvas.w,
        height: v.canvas.h,
        itemCount: v.itemCount,
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
  lines.push(' * to their hand-written CSS + markup (no scripts, fonts on DESIGNER_FONTS, LED-safe CSS).');
  lines.push(' */');
  lines.push("import type { DesignerExemplar } from './designer-exemplars';");
  lines.push('');
  lines.push('export const DESIGNER_EXEMPLARS: readonly DesignerExemplar[] = [');
  for (const e of entries) {
    lines.push('  {');
    for (const key of ['id', 'title', 'source', 'sourceSha256', 'approval', 'brand', 'brandTokens', 'vertical', 'purposes', 'structure', 'orientation', 'width', 'height', 'itemCount', 'strippedRuntimes', 'html']) {
      lines.push(`    ${key}: ${JSON.stringify(e[key])},`);
    }
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

module.exports = { render, buildAll, SOURCES, colorMix, splitStatements, splitDecls, mapFamilyList };

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
