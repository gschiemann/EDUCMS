#!/usr/bin/env node
/**
 * Scene-CSS boost guard.
 *
 * WHY (2026-08-09): `apps/web/postcss.config.mjs` runs
 * @csstools/postcss-cascade-layers — the Chromium-95 kiosk hotfix. It flattens
 * Tailwind's @layer blocks and preserves layer order by boosting specificity
 * with `:not(#\#)` hacks, so preflight ships as `h1:not(#\#):not(#\#)` (2,0,1)
 * and `:not(#\#):not(#\#){padding:0;margin:0}` (2,0,0).
 *
 * Scene widgets ship their design system as a CSS string in a runtime <style>
 * tag. That CSS is UNLAYERED and never passes through PostCSS, so boosted
 * preflight outranks every plain class selector in it — zeroing every
 * padding/margin and resetting heading sizes across the whole scene. That is
 * how the flagship Animated Rainbow ended up rendering its 110px title at 16px
 * and collapsing the Teacher-of-the-Week photo box to 2px tall.
 *
 * The fix is `sceneCss()` (apps/web/src/components/widgets/scene-css.ts), which
 * lifts scene selectors above preflight while staying below Tailwind utilities.
 * It only works if EVERY widget <style> actually routes through it — a single
 * new widget that injects raw CSS silently reintroduces the bug on that board,
 * and nothing else in CI would notice, because the output still type-checks,
 * still renders, and only looks subtly wrong on a screen in a school.
 *
 * This guard fails on any widget <style> whose CSS does not go through
 * sceneCss(). Dependency-free (no TypeScript API, no postcss) so it can run as
 * the first step of a workflow.
 *
 * Run: node apps/web/tools/check-scene-css.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src', 'components', 'widgets');
const HELPER = 'scene-css';

/** Index of the character matching the bracket at s[i]. */
function findMatching(s, i) {
  const open = s[i];
  const close = open === '{' ? '}' : ')';
  let depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '`') {
      i++;
      while (i < s.length && s[i] !== '`') {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === '$' && s[i + 1] === '{') { i = findMatching(s, i + 1) + 1; continue; }
        i++;
      }
      i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e === -1 ? s.length : e + 2; continue; }
    if (c === '/' && s[i + 1] === '/') { const e = s.indexOf('\n', i); i = e === -1 ? s.length : e + 1; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

/** Index of the '>' that closes the open tag starting at i ('<style'). */
function tagEnd(s, i) {
  while (i < s.length) {
    const c = s[i];
    if (c === '{') { i = findMatching(s, i) + 1; continue; }
    if (c === '"' || c === "'") { const q = c; i++; while (i < s.length && s[i] !== q) i++; i++; continue; }
    if (c === '>') return i;
    i++;
  }
  return -1;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') walk(p, out); }
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const violations = [];
let styleTags = 0;
let files = 0;

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('<style')) continue;
  files++;
  const rel = path.relative(path.join(__dirname, '..', '..', '..'), file);
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;

  let pos = 0;
  for (;;) {
    const start = src.indexOf('<style', pos);
    if (start === -1) break;
    const te = tagEnd(src, start);
    if (te === -1) break;
    const openTag = src.slice(start, te + 1);
    styleTags++;

    const dm = /dangerouslySetInnerHTML\s*=\s*\{/.exec(openTag);
    if (dm) {
      const outer = start + dm.index + dm[0].length - 1;
      const inner = src.indexOf('{', outer + 1);
      const innerClose = findMatching(src, inner);
      const body = src.slice(inner, innerClose);
      const hm = /__html\s*:/.exec(body);
      if (hm && !body.slice(hm.index + hm[0].length).trim().startsWith('sceneCss(')) {
        violations.push(`${rel}:${lineOf(start)}  <style dangerouslySetInnerHTML> __html is not wrapped in sceneCss()`);
      }
      pos = te + 1;
      continue;
    }

    let j = te + 1;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] === '{') {
      const close = findMatching(src, j);
      const expr = src.slice(j + 1, close).trim();
      if (expr && !expr.startsWith('sceneCss(')) {
        violations.push(`${rel}:${lineOf(start)}  <style> CSS is not wrapped in sceneCss()  →  {${expr.slice(0, 48)}…}`);
      }
    }
    pos = te + 1;
  }

  if (src.includes('sceneCss(') && !new RegExp(`import\\s*\\{[^}]*\\bsceneCss\\b[^}]*\\}\\s*from\\s*'[^']*${HELPER}'`).test(src)) {
    violations.push(`${rel}  calls sceneCss() but does not import it`);
  }

  // `!important` on an operator-editable property inside BOOSTED scene CSS.
  //
  // Boosting lifts a scene rule to (3,x,y). When that rule is also
  // `!important` it outranks the operator's own `!important` override —
  // BuilderZone's `[data-zone-id] [data-widget-content] *:not(svg)` and the
  // player's `[data-zone-id] [data-field="…"]`, both (0,2,y) — because among
  // competing !important AUTHOR declarations specificity decides the winner.
  // Net effect: the operator edits the text style, nothing happens, and it
  // fails that way on the live screen too. Caught in review on
  // FitnessRecessWidget `.fr-ksched-h { font-size: 74px !important }`.
  //
  // Only properties the style editor can actually write are flagged; an
  // `!important` on something `_styles` cannot set (e.g. width/height on an
  // svg) is harmless and stays allowed.
  const OVERRIDABLE = ['font-size', 'font-family', 'color', 'font-weight', 'line-height', 'text-align', 'font-style', 'text-decoration'];
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const prop of OVERRIDABLE) {
    const re = new RegExp(`(^|[;{\\n])\\s*${prop}\\s*:[^;{}]*!\\s*important`, 'gi');
    let m;
    while ((m = re.exec(noComments))) {
      violations.push(
        `${rel}  scene CSS declares \`${prop}: … !important\` — boosted, that outranks the operator's own !important style override, so their edit silently does nothing (on screens too). Drop the !important; source order already wins.`,
      );
    }
  }
}

if (violations.length) {
  console.error('\nFAIL — widget <style> blocks must route their CSS through sceneCss().\n');
  console.error('Flattened Tailwind preflight outranks unboosted scene CSS (2,0,0), which zeroes');
  console.error('every padding/margin and resets heading sizes on that board. See');
  console.error('apps/web/src/components/widgets/scene-css.ts for the full explanation.\n');
  console.error('Fix: import { sceneCss } from \'./scene-css\'  (adjust the relative path) and');
  console.error('wrap the CSS expression:  <style>{sceneCss(CSS)}</style>\n');
  for (const v of violations) console.error('  ' + v);
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}

console.log(`OK — scene-css guard clean (${styleTags} <style> tags across ${files} widget files all route through sceneCss()).`);
