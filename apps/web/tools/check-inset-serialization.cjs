#!/usr/bin/env node
/*
 * Inset-serialization regression guard — Rule #10, THIRD variant (2026-07-03).
 *
 * Background (see CLAUDE.md rule #10 for variants 1 & 2): NovaStar Taurus LED
 * controllers ship Chromium 83, which doesn't understand the CSS `inset`
 * shorthand (added in Chrome 87). `position: absolute` with no top/right/
 * bottom/left collapses a box to 0×0 — invisible content.
 *
 * Variant 1 (2026-05-13) was authoring `inset: 0` directly. Variant 2
 * (2026-05-19) was the Tailwind `inset-0` utility class compiling to the same
 * thing. Both are covered by `check-taurus-safety.cjs`.
 *
 * Variant 3 (this guard, 2026-07-03) is subtler: NOBODY wrote the word
 * `inset` anywhere. A React inline `style={{ position:'absolute', top:0,
 * right:0, bottom:0, left:560 }}` object supplies all four physical sides —
 * and the BROWSER's own CSSOM re-serializes those four longhands back into
 * the `inset` SHORTHAND when it writes the element's `style` ATTRIBUTE
 * string. A non-uniform set of values (not all four identical) serializes to
 * the 4-value form, e.g. `inset: 0px 0px 0px 560px`.
 *
 * The existing Chromium-83 polyfill in apps/web/src/app/player/layout.tsx
 * uses the attribute-substring selector `[style*="inset: 0"]` to force
 * top/right/bottom/left to 0 for genuinely-uniform `inset:0` widgets (whose
 * ONLY correct fix on Chromium 83 is "all sides 0"). But that substring also
 * matches the non-uniform 4-value form (`inset: 0px 0px 0px 560px` STARTS
 * WITH "inset: 0"), so the polyfill wrongly zeroes every side of a widget
 * that intentionally offset one edge — destroying the layout on Taurus AND
 * (because the polyfill CSS has no browser-version gate) on modern Chromium
 * dev/preview browsers wherever the `!important` file order applies it.
 *
 * This is INVISIBLE to `grep` — no file contains the string "inset" at all.
 * It can only be caught by parsing the JSX/TSX AST and asking: does this
 * style object literal supply all four of top/right/bottom/left as static
 * keys, and are the four values NOT all identical? That's a CANDIDATE.
 * (A uniform `{top:0,right:0,bottom:0,left:0}` is SAFE — it serializes to
 * the 1-value `inset: 0px` form, which is exactly what the polyfill exists
 * to fix, and forcing all sides to 0 is a correct no-op.)
 *
 * ── The PRECISE trigger condition (empirically verified in a real browser,
 * 2026-07-03) ──────────────────────────────────────────────────────────────
 * The CSS `inset` shorthand always serializes in `top right bottom left`
 * order, so the polyfill's `[style*="inset: 0"]` / `[style*="inset:0"]`
 * substring match can ONLY ever fire when the FIRST value in that shorthand
 * — i.e. `top` — itself serializes to `0` (or `0px`). A non-uniform object
 * whose `top` is non-zero (e.g. `{top:150,right:0,bottom:0,left:0}` →
 * `inset: 150px 0px 0px;`) is non-uniform but NEVER matches the polyfill
 * selector — it is not actually broken by this bug. Verified matrix:
 *   {0,0,0,0}              → "inset: 0px"              → MATCHES (safe: correct no-op)
 *   {0,'8%','10%','8%'}    → "inset: 0px 8% 10%"        → MATCHES (LANDMINE)
 *   {'12%',0,'10%','8%'}   → "inset: 12% 0px 10% 8%"    → NO MATCH (non-uniform but harmless)
 *   {0,'auto','auto',0}    → "inset: 0px auto auto 0px" → MATCHES (LANDMINE)
 * So this guard flags a CONFIRMED landmine only when: all 4 sides present,
 * not all identical, AND `top`'s literal value is `0` / `'0'` / `'0px'`.
 * Non-uniform objects with a non-zero `top` are reported SEPARATELY as
 * "non-uniform but top≠0" — informational only, not a regression, because
 * they provably never match the polyfill's substring selector.
 *
 * Uses the TypeScript compiler API (already a repo devDependency — no new
 * dependency) to parse real ASTs, not regex. This avoids both:
 *   - false positives: unrelated top:/right:/bottom:/left: keys that happen
 *     to appear near each other across DIFFERENT object literals / elements.
 *   - false negatives: multi-line object literals that a single-line regex
 *     like `top:\s*0,` would never match across line breaks.
 *
 * Run:
 *   node apps/web/tools/check-inset-serialization.cjs
 *
 * Exits 1 and prints file:line + the four values for every non-uniform
 * 4-side inline style object found under the player/widget scan paths.
 * Exits 0 (clean) otherwise. This guard has NO baseline — the codebase
 * should be at zero landmines after the 2026-07-03 sweep; any new hit is
 * a genuine regression, not "existing debt."
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..'); // repo root
const SCAN_DIRS = [
  path.join('apps', 'web', 'src', 'components', 'widgets'),
  path.join('apps', 'web', 'src', 'app', 'player'),
  path.join('apps', 'web', 'src', 'components', 'player'),
];

const FILE_RE = /\.(tsx|jsx|ts|js)$/;
const SIDES = ['top', 'right', 'bottom', 'left'];

function walk(absDir, out) {
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(abs, out);
    } else if (entry.isFile() && FILE_RE.test(entry.name)) {
      out.push(abs);
    }
  }
}

/** Render a numeric-literal-ish AST node to a plain string for reporting, or
 * null if it's not a value we can compare for uniformity (identifiers,
 * template strings with expressions, etc. — those get flagged conservatively
 * as "non-literal", see below). */
function literalValueKey(node) {
  if (ts.isNumericLiteral(node)) return node.text; // e.g. "0", "560"
  if (ts.isStringLiteralLike(node)) return JSON.stringify(node.text); // e.g. '"0px"'
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken
      && ts.isNumericLiteral(node.operand)) {
    return '-' + node.operand.text;
  }
  return null; // non-literal (identifier/expression) — value unknown at static-analysis time
}

function displayValue(node, sourceFile) {
  return node.getText(sourceFile).trim();
}

/** True when a literal-value key (as returned by literalValueKey) would
 * serialize as a CSS value that STARTS WITH THE DIGIT "0" — the exact
 * condition that makes the player/layout.tsx polyfill's naive attribute
 * substring `[style*="inset: 0"]` match, because the `inset` shorthand
 * always serializes `top right bottom left` and the substring test only
 * inspects the first (top) value's leading characters.
 *
 * Empirically verified (2026-07-03, real browser via preview_eval) this is
 * broader than plain `0`/`'0px'` — ANY numeric-or-percent string starting
 * with the digit 0 collides, including `'0%'` and even `'0.5%'`:
 *   top:0        → "inset: 0px …"   → MATCHES
 *   top:'0px'    → "inset: 0px …"   → MATCHES
 *   top:'0%'     → "inset: 0% …"    → MATCHES  (looked "safe" at first glance — it's not)
 *   top:'0.5%'   → "inset: 0.5% …"  → MATCHES  (leading digit is what matters, not "is it exactly zero")
 *   top:'05%'    → "inset: 5% …"    → NO MATCH (browser normalizes away the leading zero)
 *   top:'12%'    → "inset: 12% …"   → NO MATCH
 *   top:150      → "inset: 150px …"→ NO MATCH
 * So the true test is "does the serialized top value start with the
 * character '0'" — checked here as: numeric 0, or a string literal whose
 * first character (after any unary minus) is '0'. A leading-zero-but-not-
 * actually-zero author typo like "05%" is excluded because the CSSOM
 * normalizes it away before serialization (confirmed above) — not a
 * realistic authoring pattern in this codebase regardless. */
function isZeroLeadingKey(key) {
  // Bare numeric literal, e.g. "0" or "0.5" (literalValueKey returns
  // node.text verbatim for ts.isNumericLiteral, unquoted). React appends
  // 'px' to bare numbers for top/right/bottom/left, so "0.5" -> "0.5px" —
  // still leading-zero.
  if (/^\d/.test(key) && key[0] === '0') return true;
  if (key.startsWith('"0')) {
    // key is a JSON.stringify'd string, e.g. '"0px"', '"0%"', '"0"'. Guard
    // against a string that merely CONTAINS "0" elsewhere by checking the
    // character right after the opening quote.
    return key[1] === '0';
  }
  return false;
}

/**
 * Given an ObjectLiteralExpression, find direct properties named
 * top/right/bottom/left (in any order, any position among other keys like
 * `position: 'absolute'`). Returns null if not all four are present as
 * simple `key: value` PropertyAssignments (shorthand `{top}` etc. also
 * counts). Spread elements or computed keys abstain (return null) — we only
 * flag what we can prove statically.
 */
function extractFourSides(objLiteral) {
  const found = {};
  for (const prop of objLiteral.properties) {
    if (ts.isSpreadAssignment(prop)) {
      // Spread makes static analysis unsound (spread could supply/override a
      // side) — abstain entirely on this object to avoid a false positive/negative.
      return { abstain: true };
    }
    let key = null;
    if (ts.isPropertyAssignment(prop) && !prop.name.getSourceFile) {
      // unreachable guard, keep for safety
    }
    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
      const nameNode = prop.name;
      if (ts.isIdentifier(nameNode)) key = nameNode.text;
      else if (ts.isStringLiteral(nameNode)) key = nameNode.text;
    }
    if (key && SIDES.includes(key)) {
      const valueNode = ts.isPropertyAssignment(prop) ? prop.initializer : prop.name;
      found[key] = valueNode;
    }
  }
  if (SIDES.every((s) => found[s])) return { sides: found };
  return null;
}

const hits = [];

function scanFile(absPath) {
  const text = fs.readFileSync(absPath, 'utf8');
  const scriptKind = absPath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : absPath.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : absPath.endsWith('.ts')
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, scriptKind);

  function visit(node) {
    // Look for JSX attribute `style={{ ... }}` specifically — this guard is
    // about inline styles that ship into the DOM `style` attribute (the
    // thing the browser CSSOM re-serializes). Object literals elsewhere
    // (e.g. a plain JS config object never assigned to `style`) are out of
    // scope; walk from JsxAttribute so we only ever look at real style props.
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === 'style' && node.initializer) {
      let objLiteral = null;
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const expr = node.initializer.expression;
        if (ts.isObjectLiteralExpression(expr)) {
          objLiteral = expr;
        } else if (ts.isParenthesizedExpression(expr) && ts.isObjectLiteralExpression(expr.expression)) {
          objLiteral = expr.expression;
        }
        // Conditional/spread/ternary style objects (e.g. `style={cond ? {...} : {...}}`,
        // `style={{...base, ...override}}`) are NOT statically resolvable here —
        // intentionally out of scope for this guard (see extractFourSides abstain
        // path for the spread-inside-object case).
      }
      if (objLiteral) {
        const extracted = extractFourSides(objLiteral);
        if (extracted && !extracted.abstain) {
          const { sides } = extracted;
          const values = SIDES.map((s) => literalValueKey(sides[s]));
          const displays = SIDES.map((s) => displayValue(sides[s], sourceFile));
          const topValue = values[0]; // SIDES[0] === 'top'
          const topIsLiteral = topValue !== null;
          const allLiteral = values.every((v) => v !== null);
          const allIdentical = allLiteral && values.every((v) => v === values[0]);
          const { line } = sourceFile.getLineAndCharacterOfPosition(objLiteral.getStart(sourceFile));
          const base = {
            file: path.relative(REPO_ROOT, absPath),
            line: line + 1,
            values: SIDES.map((s, i) => `${s}:${displays[i]}`).join(', '),
          };

          // Only `top` (always first in the serialized `inset` shorthand)
          // decides whether the player/layout.tsx polyfill's substring
          // selector matches — the other three sides are irrelevant to that
          // question. So classify primarily on topValue, independent of
          // whether right/bottom/left happen to be non-literal too.
          if (topIsLiteral && !isZeroLeadingKey(topValue)) {
            // top is statically known and does NOT start with '0' -> this
            // object can NEVER match the polyfill selector, regardless of
            // whether it's uniform or whether the other 3 sides are
            // non-literal. Uniform-with-nonzero-top is impossible (uniform
            // by definition means all 4 equal; if top isn't a leading-zero
            // value, this is inherently a non-uniform-looking case OR a
            // uniform non-zero-everything object, both equally harmless).
            if (!allIdentical) hits.push({ ...base, tier: 'nonuniform-safe' });
            // allIdentical && non-zero (e.g. all sides "10%") is also safe
            // and not worth reporting in any tier — it can't collide and
            // isn't the "many identical safe" case operators need visibility into.
          } else if (topIsLiteral && isZeroLeadingKey(topValue)) {
            // top starts with '0'. Confirmed landmine only if the four
            // sides are NOT all identical (uniform all-zero is the correct,
            // intentional polyfill target — a no-op fix, not a bug).
            if (allLiteral && !allIdentical) {
              hits.push({ ...base, tier: 'confirmed' });
            } else if (!allLiteral) {
              // top is zero-leading but another side is non-literal, so we
              // can't PROVE non-uniformity — but top alone already satisfies
              // the polyfill's match condition, so if the object turns out
              // non-uniform at runtime it WILL collide. Flag conservatively.
              hits.push({ ...base, tier: 'conservative' });
            }
            // allLiteral && allIdentical (uniform all-zero) -> no report, safe no-op.
          } else {
            // top itself is non-literal (identifier/expression/ternary) —
            // genuinely can't prove the match condition either way.
            hits.push({ ...base, tier: 'conservative' });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function main() {
  const files = [];
  for (const d of SCAN_DIRS) walk(path.join(REPO_ROOT, d), files);
  for (const f of files) scanFile(f);

  const confirmed = hits.filter((h) => h.tier === 'confirmed');
  const nonUniformSafe = hits.filter((h) => h.tier === 'nonuniform-safe');
  const conservative = hits.filter((h) => h.tier === 'conservative');

  if (confirmed.length) {
    console.error('CONFIRMED inset-serialization landmines (Rule #10 variant 3) —');
    console.error('non-uniform 4-side inline style object whose `top` starts with "0",');
    console.error('which DOES match the player/layout.tsx polyfill\'s [style*="inset: 0"] selector:');
    for (const h of confirmed) {
      console.error(`  ${h.file}:${h.line}  { ${h.values} }`);
    }
  }
  if (nonUniformSafe.length) {
    console.error('');
    console.error(`Non-uniform 4-side objects with top!=0 (${nonUniformSafe.length}) — NOT flagged as`);
    console.error('regressions: provably never matched by the polyfill\'s substring selector');
    console.error('(inset shorthand serializes top first, so only a leading-zero top can collide).');
    console.error('Listed for visibility only — no action required:');
    for (const h of nonUniformSafe) {
      console.error(`  ${h.file}:${h.line}  { ${h.values} }`);
    }
  }
  if (conservative.length) {
    console.error('');
    console.error('Non-literal 4-side style objects (values not statically provable — manual review):');
    for (const h of conservative) {
      console.error(`  ${h.file}:${h.line}  { ${h.values} }`);
    }
  }

  if (confirmed.length) {
    console.error('');
    console.error('Fix: drop to 3 physical sides + an explicit width/height matching the');
    console.error('intended geometry, e.g. { top:0, bottom:0, left:560, width: "calc(100% - 560px)" }.');
    console.error('A 3-side object can never serialize to the `inset` shorthand (which requires');
    console.error('all four sides), so it is immune to the player/layout.tsx polyfill AND correct');
    console.error('on Chromium 83. See CLAUDE.md rule #10 (2026-07-03 entry).');
    process.exit(1);
  }

  console.log(`OK — inset-serialization guard clean (${files.length} files scanned, 0 confirmed landmines, ${nonUniformSafe.length} non-uniform-but-safe, ${conservative.length} conservative flags for manual review).`);
}

main();
