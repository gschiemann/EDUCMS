#!/usr/bin/env node
/*
 * WIDGET TRUTH guard — CLAUDE.md §19, the half no gate has ever covered.
 *
 * ── THE BUG (2026-09-11) ─────────────────────────────────────────────────
 * The operator added his first widget to a gym tenant — FITNESS_AD_BANNER —
 * and the canvas showed a finished ad: "YOUR GYM", "New Member Special · 50%
 * off first month", "PRESENTED BY Your Gym". He could not edit a word of it,
 * because none of it was his: it was `DEMO_CREATIVES`, a hardcoded array the
 * widget rendered precisely BECAUSE he had no creatives yet. The Properties
 * panel truthfully said "No creatives yet — add your first below" while the
 * canvas showed a finished-looking ad. His words: "added the first widget and
 * i cant edit anything on it, wtf are we doing here bro".
 *
 * The widget LIED ABOUT ITS STATE. Empty looked populated, so the operator
 * reasonably tried to edit text that has no field. That is the same lie that
 * produced this product's loudest complaint ever ("none of the fucking
 * templates are even editable, you can't edit a single word"), and it was not
 * one widget: 22 widget files carried a fabricated fallback of this shape.
 *
 * ── WHY A GATE, AND WHY THIS ONE ─────────────────────────────────────────
 * §19 has been a written standard since 2026-05-26 and has never had a gate.
 * `check-board-editability.cjs` guards the EXTERNAL_HTML boards and says so
 * in its own header ("per-widget field coverage is the Standard Audit Surface
 * §19 job" — i.e. explicitly NOT its job). This is that job, for the React
 * widget pack.
 *
 * `sports/` already solved its half of this in 2026-07-02 (RenderSurfaceContext
 * + the nofake-sweep suite) — and solved it in the opposite direction, keeping
 * the SAMPLE on the builder canvas deliberately. That is why sports widgets are
 * BASELINED here rather than "fixed": changing them would break a guard that is
 * working. See the baseline file for the per-file reasoning.
 *
 * ── CHECK 1 — FABRICATED FALLBACK (structural, rename-proof) ─────────────
 * Flags an expression that renders INVENTED CONTENT when config is empty:
 *
 *     const items = (c.items && c.items.length) ? c.items : DEMO_ITEMS;
 *     const name  = c.equipmentName || 'LEG PRESS';        // see LIMITS
 *     const hours = { ...DEMO_HOURS, ...(c.openHours||{}) };
 *
 * It is STRUCTURAL, not name-based: the fallback operand is resolved through
 * consts at ANY scope (any name — renaming DEMO_ITEMS to STARTER_ITEMS, or moving
 * it inside the component, does not evade it) and graded on its CONTENT, not its
 * identifier. A value is FABRICATED when it is
 *   (a) an array holding >=1 object literal that carries a prose string, or
 *   (b) an array holding >=2 prose strings, or
 *   (c) an object literal carrying >=2 prose strings (a fabricated record:
 *       name + role + quote), or spreading a fabricated const, or
 *   (d) a string literal of >=12 words (a fabricated paragraph).
 *
 * "Prose" is a string with at least two words, at least one of them a real
 * word, that is not CSS, a URL, a class name, a font stack or a unit.
 *
 * ── CHECK 2 — ORPHAN CONFIG KEY (does every rendered field have an editor?) ─
 * For the vertical packs (fitness / restaurant / retail / bar), cross-reference
 * the config keys a widget READS against the keys `PropertiesPanel` EXPOSES for
 * the widget type that renders it (resolved through WidgetRenderer's switch).
 * A key the widget reads and the panel never writes is a field the operator
 * cannot edit — §19's actual criterion.
 *
 * ── WHAT THIS GATE CANNOT CATCH (read this before trusting it) ───────────
 * 1. A SINGLE fabricated label. `c.equipmentName || 'LEG PRESS'` is
 *    structurally identical to `c.title || "TODAY'S CLASSES"` — one invents a
 *    piece of equipment, the other names the board. No static rule separates
 *    them, so CHECK 1 deliberately requires a LIST or a RECORD or a paragraph
 *    and lets single labels through. Those are a human review item.
 * 2. Fabricated content that is NOT in a fallback position — e.g. a widget
 *    that always renders a hardcoded string regardless of config.
 * 3. Content fabricated at RUNTIME (computed, fetched, or assembled from
 *    fragments) rather than written as a literal.
 * 4. Whether the empty state it falls back to is any GOOD — that it names the
 *    next action, reads as unfinished, and is legible on a 4K wall is a design
 *    review, not a parse.
 * 5. CHECK 2 only covers the four vertical packs and only widget types reached
 *    by WidgetRenderer's `case` switch; variant-only widgets, the v2 pack and
 *    the sports pack are out of its scope (`report` prints what it skipped).
 * 6. Neither check knows what the PLAYER shows. Builder-vs-player is enforced
 *    by tests (`widget-truth.test.tsx`), not by this parse.
 *
 * ── RATCHET ──────────────────────────────────────────────────────────────
 * Same shape as taurus-safety and board-editability: a finding already in
 * `widget-truth-baseline.json` may keep failing; a NEW one fails CI; a
 * baselined finding that has been fixed is REMOVED by the run that notices, so
 * the baseline can only tighten. The baseline is NOT empty and is not pretending
 * to be — every entry names the file, the reason, and the date.
 *
 * Run:
 *   node apps/web/tools/check-widget-truth.cjs           # check (CI mode)
 *   node apps/web/tools/check-widget-truth.cjs report     # full census
 *   node apps/web/tools/check-widget-truth.cjs baseline   # rewrite baseline
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const WEB_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(WEB_ROOT, 'src');
const WIDGETS_ROOT = path.join(SRC, 'components', 'widgets');
const RENDERER = path.join(WIDGETS_ROOT, 'WidgetRenderer.tsx');
const PANEL = path.join(SRC, 'components', 'template-builder', 'PropertiesPanel.tsx');
const BASELINE_FILE = path.join(__dirname, 'widget-truth-baseline.json');

// CHECK 2 scope. Deliberately narrow: these are the packs whose truthfulness
// was audited by hand on 2026-09-11, so a violation here is a real finding
// rather than an unreviewed guess.
const CHECK2_DIRS = ['fitness', 'restaurant', 'retail', 'bar'];

// Config keys every widget may read without its own editor, because something
// else in the panel owns them: the universal text-style block, the v2 style
// section, the POS/game binding cards, and the renderer's own plumbing.
const UNIVERSAL_KEYS = new Set([
  'variant', 'theme', 'style', 'gameId', 'sportKey',
  'fontFamily', 'fontSize', 'color', 'textColor', 'bold', 'italic', 'underline',
  'strike', 'align', 'textAlign', 'lineHeight', 'letterSpacing', 'fontWeight',
  'bgColor', 'bgGradient', 'bgImage', 'opacity', 'padding', 'borderRadius',
  'posSync', 'posCategory', 'locationId',
]);

/**
 * Why a still-failing file is in the baseline. Grouped by path because the
 * reason is per-PACK, not per-line — a hundred one-line "TODO" strings would
 * be a fake baseline, which is worse than an honest big one.
 *
 * Every group below is a REAL, UNFIXED §19 violation unless it says otherwise.
 * Ordered most-specific first.
 */
const BASELINE_REASONS = [
  ['components/widgets/sports/', [
    'NOT A LIE ON A REAL SCREEN, and deliberately left alone. The sports pack solved',
    'this on 2026-07-02 in the opposite direction: RenderSurfaceContext makes every',
    'useGameState()-driven widget render its neutral/unbound state on the PLAYER, while',
    'the builder canvas keeps the SAMPLE on purpose ("the tile is never blank on the',
    'canvas"). That behaviour is locked by sports/__tests__/nofake-sweep-render-surface',
    '.test.tsx, which asserts BOTH directions. Converting these to WidgetEmptyState would',
    'break a guard that is working. Revisit only together with that suite.',
  ].join(' ')],
  ['components/widgets/fitness/FitnessMotivationalQuoteWidget.tsx', [
    'JUDGEMENT CALL, 2026-09-11: not fabricated. These are REAL quotations by real',
    'people, correctly attributed (Goggins, Schwarzenegger, Rocky). A quote-of-the-day',
    'widget shipping a curated, attributed library is the same class as a stock-photo',
    'library, not invented operator data — nothing here claims the gym said it. The',
    'panel\'s Quotes list + AI generator replace the library wholesale. Flag it again if',
    'the operator disagrees; the one-line fix is the same empty state as its siblings.',
  ].join(' ')],
  ['components/widgets/v2/', [
    'REAL §19 VIOLATION, NOT YET FIXED (2026-09-11). The v2 pack is ~70 variants across',
    'school + vertical families and each file carries the fallback 5x (once per variant),',
    'so it is its own pass. Priority order set by the operator: fitness first (he is on a',
    'GYM tenant), then restaurant/retail/bar — all done; v2 is next.',
  ].join(' ')],
  ['components/widgets/themes/', [
    'REAL §19 VIOLATION, NOT YET FIXED (2026-09-11). The themed full-screen scenes each',
    'bake their own design system, so an empty state has to be designed per theme rather',
    'than dropped in. Deferred with the v2 pack, deliberately, rather than half-done.',
  ].join(' ')],
  ['components/widgets/', [
    'REAL §19 VIOLATION, NOT YET FIXED (2026-09-11). Top-level K-12 scene widgets',
    '(Animated* / Bulletin* / Scrapbook* / Storybook*). Same deferral as themes/: each is',
    'a bespoke scene whose empty state needs designing, not a shared drop-in.',
  ].join(' ')],
];

function baselineReason(file) {
  for (const [prefix, reason] of BASELINE_REASONS) {
    if (file.includes(prefix)) return reason;
  }
  return 'TODO — state why this is not fixed yet';
}

// ─────────────────────────────────────────────────────────────────────────
// Prose detection — is this string CONTENT, or is it machinery?
// ─────────────────────────────────────────────────────────────────────────
const NOT_PROSE = [
  '://', 'linear-gradient', 'radial-gradient', 'rgba(', 'rgb(', 'hsl(',
  'var(--', 'calc(', '!important', 'data:', 'sans-serif', 'monospace',
  'translate', 'cubic-bezier', '@media', '</', '/>', '&&', '=>',
];

function isProse(raw) {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (s.length < 4) return false;
  const lower = s.toLowerCase();
  for (const bad of NOT_PROSE) if (lower.includes(bad)) return false;
  // A CSS value / dimension list, e.g. "0 12px 24px rgba(...)" or "1fr 1fr".
  if (/^[\d.\s,%a-z-]*$/.test(lower) && /\d\s*(px|em|rem|vh|vw|fr|%|s|ms)\b/.test(lower)) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  // At least one token that is a real word (>=2 letters), so "$9.99 ·" or
  // "7:30 AM" alone is not prose — but "Big Burger Combo" is.
  return words.some((w) => (w.match(/[A-Za-z]/g) || []).length >= 2);
}

function countWords(raw) {
  return String(raw).trim().split(/\s+/).filter(Boolean).length;
}

// ─────────────────────────────────────────────────────────────────────────
// AST helpers
// ─────────────────────────────────────────────────────────────────────────
function parse(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function unwrap(node) {
  let n = node;
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression?.(n) || ts.isNonNullExpression(n))) {
    n = n.expression;
  }
  return n;
}

/**
 * Every `const NAME = <init>` in the file, at ANY scope — not just module
 * level. Mutation-tested 2026-09-11: a module-level-only map was evaded by
 * moving the fabricated array INSIDE the component function, which is the
 * first thing anyone would do to quiet this gate. Names are flattened into
 * one map; a shadowed name resolves to the last declaration seen, which for a
 * "does this literal contain invented prose" question is good enough and errs
 * toward reporting.
 */
function allConsts(sf) {
  const map = new Map();
  (function walk(n) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      map.set(n.name.text, n.initializer);
    }
    ts.forEachChild(n, walk);
  })(sf);
  return map;
}

/** Does this expression read a config member (`c.x`, `cfg.x`, `config.x`)? */
function readsConfig(node) {
  let found = false;
  (function walk(n) {
    if (found || !n) return;
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)) {
      const base = n.expression.text;
      if (base === 'c' || base === 'cfg' || base === 'config') { found = true; return; }
    }
    ts.forEachChild(n, walk);
  })(node);
  return found;
}

/**
 * Grade a resolved fallback value. Returns a reason string when the value is
 * FABRICATED CONTENT, else null. `consts` resolves identifier/spread hops.
 */
function fabricationReason(node, consts, depth = 0) {
  const n = unwrap(node);
  if (!n || depth > 4) return null;

  if (ts.isIdentifier(n)) {
    const init = consts.get(n.text);
    return init ? fabricationReason(init, consts, depth + 1) : null;
  }

  if (ts.isArrayLiteralExpression(n)) {
    let proseStrings = 0;
    let proseObjects = 0;
    for (const el0 of n.elements) {
      const el = unwrap(el0);
      if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) {
        if (isProse(el.text)) proseStrings++;
      } else if (ts.isObjectLiteralExpression(el)) {
        if (objectProseCount(el) >= 1) proseObjects++;
      } else if (ts.isSpreadElement(el)) {
        const r = fabricationReason(el.expression, consts, depth + 1);
        if (r) return r;
      }
    }
    if (proseObjects >= 1) {
      return `array of ${proseObjects} fabricated record(s)`;
    }
    if (proseStrings >= 2) {
      return `array of ${proseStrings} fabricated lines`;
    }
    return null;
  }

  if (ts.isObjectLiteralExpression(n)) {
    for (const p of n.properties) {
      if (ts.isSpreadAssignment(p)) {
        const r = fabricationReason(p.expression, consts, depth + 1);
        if (r) return `object spreading ${r}`;
      }
    }
    const cnt = objectProseCount(n);
    if (cnt >= 2) return `fabricated record with ${cnt} prose fields`;
    return null;
  }

  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
    if (countWords(n.text) >= 12 && isProse(n.text)) {
      return `fabricated paragraph (${countWords(n.text)} words)`;
    }
    return null;
  }

  return null;
}

function objectProseCount(obj) {
  let count = 0;
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const v = unwrap(p.initializer);
    if ((ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) && isProse(v.text)) count++;
    else if (ts.isArrayLiteralExpression(v)) {
      for (const el0 of v.elements) {
        const el = unwrap(el0);
        if ((ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) && isProse(el.text)) { count++; break; }
      }
    }
  }
  return count;
}

/** CHECK 1 over one file. */
function findFabricatedFallbacks(file) {
  const sf = parse(file);
  const consts = allConsts(sf);
  const hits = [];

  (function walk(n) {
    if (!n) return;

    // `A || B`  /  `A ?? B`  — B is the fallback.
    if (ts.isBinaryExpression(n) &&
        (n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
         n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
      if (readsConfig(n.left)) {
        const reason = fabricationReason(n.right, consts);
        if (reason) {
          hits.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, reason, shape: '||' });
        }
      }
    }

    // `COND ? A : B` where COND reads config — either branch may be the lie.
    if (ts.isConditionalExpression(n) && readsConfig(n.condition)) {
      for (const [branch, label] of [[n.whenTrue, '?:'], [n.whenFalse, '?:']]) {
        if (readsConfig(branch)) continue; // that branch IS the operator's data
        const reason = fabricationReason(branch, consts);
        if (reason) {
          hits.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, reason, shape: label });
        }
      }
    }

    // `{ ...FABRICATED, ...(c.x || {}) }` — a merge UNDER the operator's data,
    // which is how a half-filled record silently completes itself with lies.
    if (ts.isObjectLiteralExpression(n)) {
      const spreads = n.properties.filter(ts.isSpreadAssignment);
      if (spreads.length >= 2 && spreads.some((s) => readsConfig(s.expression))) {
        for (const s of spreads) {
          if (readsConfig(s.expression)) continue;
          const reason = fabricationReason(s.expression, consts);
          if (reason) {
            hits.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, reason: `merged under operator data: ${reason}`, shape: 'spread' });
          }
        }
      }
    }

    ts.forEachChild(n, walk);
  })(sf);

  // De-dupe by line.
  const seen = new Set();
  return hits.filter((h) => {
    const k = `${h.line}:${h.reason}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// CHECK 2 — widgetType -> component -> file, and panel key coverage
// ─────────────────────────────────────────────────────────────────────────

/** `case 'FOO': return <FooWidget .../>` in WidgetRenderer -> {FOO: 'FooWidget'} */
function rendererSwitchMap() {
  const sf = parse(RENDERER);
  const out = new Map();
  (function walk(n) {
    if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression)) {
      const type = n.expression.text;
      let comp = null;
      (function inner(m) {
        if (comp || !m) return;
        if ((ts.isJsxSelfClosingElement(m) || ts.isJsxOpeningElement(m)) && ts.isIdentifier(m.tagName)) {
          comp = m.tagName.text;
          return;
        }
        ts.forEachChild(m, inner);
      })(n);
      if (comp && !out.has(type)) out.set(type, comp);
    }
    ts.forEachChild(n, walk);
  })(sf);
  return out;
}

/**
 * Component name -> the file that actually DEFINES it.
 *
 * Two hops, and the second one is load-bearing. Almost every vertical widget
 * reaches WidgetRenderer through `widget-families.tsx`, which re-exports a
 * LAZY PROXY:
 *
 *     const loadRestaurantMenuBoardWidget = () => import('./restaurant/MenuBoardWidget');
 *     export const MenuBoardWidget = lazyWidget(loadRestaurantMenuBoardWidget, 'MenuBoardWidget');
 *
 * Resolving only WidgetRenderer's own imports therefore maps MenuBoardWidget to
 * `widget-families.tsx` — whose directory is not a vertical pack, so CHECK 2
 * silently skipped EVERY widget it was written to cover. That is exactly the
 * "green gate that checks nothing" failure this repo has been bitten by, and it
 * was caught by mutation-testing the gate (delete an editor, see nothing fail),
 * not by reading it. So we follow a re-export through `lazyWidget(loader, ...)`
 * to the loader's own `import('./real/File')`.
 */
function componentFileMap() {
  const out = new Map();

  function addImports(file) {
    const sf = parse(file);
    const local = new Map();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause) continue;
      const spec = st.moduleSpecifier;
      if (!ts.isStringLiteral(spec) || !spec.text.startsWith('.')) continue;
      const resolved = resolveRel(file, spec.text);
      if (!resolved) continue;
      const nb = st.importClause.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) local.set(el.name.text, resolved);
      if (st.importClause.name) local.set(st.importClause.name.text, resolved);
    }
    return { sf, local };
  }

  const { local: rendererImports } = addImports(RENDERER);
  for (const [name, file] of rendererImports) out.set(name, file);

  // Hop 2 — resolve lazy proxies declared in any module WidgetRenderer imports.
  for (const barrel of new Set(rendererImports.values())) {
    let sf;
    try { sf = parse(barrel); } catch { continue; }
    // dynamic-import loaders, by variable name
    const loaders = new Map();
    (function walk(n) {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        let target = null;
        (function inner(m) {
          if (target || !m) return;
          if (ts.isCallExpression(m) && m.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const a = m.arguments[0];
            if (a && ts.isStringLiteral(a)) target = resolveRel(barrel, a.text);
            return;
          }
          ts.forEachChild(m, inner);
        })(n.initializer);
        if (target) loaders.set(n.name.text, target);
      }
      ts.forEachChild(n, walk);
    })(sf);

    // `export const X = lazyWidget(loaderName, 'X')` -> X lives in loaderName's target
    (function walk(n) {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
          ts.isCallExpression(n.initializer)) {
        for (const a of n.initializer.arguments) {
          const arg = unwrap(a);
          if (ts.isIdentifier(arg) && loaders.has(arg.text)) {
            out.set(n.name.text, loaders.get(arg.text));
            break;
          }
          // inline form: lazyWidget(() => import('./x'), 'X')
          if (ts.isArrowFunction(arg)) {
            let target = null;
            (function inner(m) {
              if (target || !m) return;
              if (ts.isCallExpression(m) && m.expression.kind === ts.SyntaxKind.ImportKeyword) {
                const s0 = m.arguments[0];
                if (s0 && ts.isStringLiteral(s0)) target = resolveRel(barrel, s0.text);
                return;
              }
              ts.forEachChild(m, inner);
            })(arg);
            if (target) { out.set(n.name.text, target); break; }
          }
        }
      }
      ts.forEachChild(n, walk);
    })(sf);
  }

  return out;
}

function resolveRel(fromFile, rel) {
  const base = path.resolve(path.dirname(fromFile), rel);
  for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return fs.existsSync(base) ? base : null;
}

/** Config keys a widget file READS (`c.x` / `cfg.x` / `config.x`). */
function configKeysRead(file) {
  const sf = parse(file);
  const keys = new Set();
  (function walk(n) {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && ts.isIdentifier(n.name)) {
      const base = n.expression.text;
      if (base === 'c' || base === 'cfg' || base === 'config') keys.add(n.name.text);
    }
    // `const { a, b } = config` / `= c`
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(unwrap(n.initializer))) {
      const base = unwrap(n.initializer).text;
      if ((base === 'c' || base === 'cfg' || base === 'config') && ts.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) {
          if (ts.isIdentifier(el.propertyName || el.name)) keys.add((el.propertyName || el.name).text);
        }
      }
    }
    ts.forEachChild(n, walk);
  })(sf);
  return keys;
}

/** widgetType -> Set(keys the PropertiesPanel writes/exposes). */
function panelKeyMap() {
  const sf = parse(PANEL);
  const out = new Map();

  function collectKeys(node, into) {
    (function walk(n) {
      if (!n) return;
      // key="foo" on a *Field / *Editor JSX element
      if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.name.text === 'key' &&
          n.initializer && ts.isStringLiteral(n.initializer)) {
        into.add(n.initializer.text);
      }
      // setField({ foo: ..., bar: ... })
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'setField') {
        for (const a of n.arguments) {
          const o = unwrap(a);
          if (ts.isObjectLiteralExpression(o)) {
            for (const p of o.properties) {
              if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name && ts.isIdentifier(p.name)) into.add(p.name.text);
              if (ts.isPropertyAssignment(p) && p.name && ts.isStringLiteral(p.name)) into.add(p.name.text);
            }
          }
        }
      }
      // { key: 'foo' } row descriptors inside fields={[...]}
      if (ts.isObjectLiteralExpression(n)) {
        for (const p of n.properties) {
          if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'key') {
            const v = unwrap(p.initializer);
            if (ts.isStringLiteral(v)) into.add(v.text);
          }
        }
      }
      ts.forEachChild(n, walk);
    })(node);
  }

  // Walk the `switch (zone.widgetType)` clauses. Fall-through cases share the
  // next non-empty clause's body, which is why we buffer pending labels.
  (function walk(n) {
    if (ts.isSwitchStatement(n) && /widgetType/.test(n.expression.getText(sf))) {
      let pending = [];
      for (const clause of n.caseBlock.clauses) {
        if (!ts.isCaseClause(clause)) continue;
        if (!ts.isStringLiteral(clause.expression)) continue;
        pending.push(clause.expression.text);
        if (clause.statements.length === 0) continue;
        const keys = new Set();
        for (const st of clause.statements) collectKeys(st, keys);
        for (const t of pending) {
          const prev = out.get(t) || new Set();
          for (const k of keys) prev.add(k);
          out.set(t, prev);
        }
        pending = [];
      }
    }
    ts.forEachChild(n, walk);
  })(sf);

  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Walk / run
// ─────────────────────────────────────────────────────────────────────────
function widgetFiles() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'node_modules') continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
        out.push(p);
      }
    }
  })(WIDGETS_ROOT);
  return out.sort();
}

function rel(p) { return path.relative(path.resolve(WEB_ROOT, '..', '..'), p); }

function run() {
  const mode = process.argv[2] || 'check';
  const findings = [];

  // CHECK 1
  for (const file of widgetFiles()) {
    let hits = [];
    try { hits = findFabricatedFallbacks(file); }
    catch (err) { console.error(`[widget-truth] parse failed: ${rel(file)} — ${err.message}`); process.exitCode = 1; continue; }
    for (const h of hits) {
      findings.push({ check: 'fabricated-fallback', file: rel(file), line: h.line, detail: `${h.shape} fallback renders ${h.reason}` });
    }
  }

  // CHECK 2
  const skipped2 = [];
  const typeToComp = rendererSwitchMap();
  const compToFile = componentFileMap();
  const panelKeys = panelKeyMap();
  for (const [type, comp] of typeToComp) {
    const file = compToFile.get(comp);
    if (!file) { skipped2.push(`${type} (component ${comp} not resolvable from WidgetRenderer imports)`); continue; }
    const dir = path.basename(path.dirname(file));
    if (!CHECK2_DIRS.includes(dir)) continue;
    const keys = panelKeys.get(type);
    if (!keys) { skipped2.push(`${type} (no PropertiesPanel case)`); continue; }
    let read;
    try { read = configKeysRead(file); } catch { continue; }
    for (const k of [...read].sort()) {
      if (UNIVERSAL_KEYS.has(k)) continue;
      if (keys.has(k)) continue;
      findings.push({ check: 'orphan-field', file: rel(file), line: 0, detail: `${type} renders config.${k} but PropertiesPanel exposes no editor for it` });
    }
  }

  // The baseline key deliberately EXCLUDES the line number: line numbers churn
  // on every unrelated edit above them, and a baseline that red-lights CI
  // because someone added an import is a baseline people delete. Growth WITHIN
  // a file is caught by `count` instead — 3 findings where 2 were baselined is
  // a new violation and fails.
  const key = (f) => `${f.check}|${f.file}|${f.detail}`;
  const counts = new Map();
  for (const f of findings) counts.set(key(f), (counts.get(key(f)) || 0) + 1);

  const baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : { entries: {} };
  const baseKeys = new Set(Object.keys(baseline.entries || {}));

  if (mode === 'baseline') {
    const entries = {};
    for (const f of findings) {
      const prev = (baseline.entries || {})[key(f)];
      entries[key(f)] = {
        file: f.file,
        check: f.check,
        detail: f.detail,
        count: counts.get(key(f)),
        baselinedOn: prev?.baselinedOn || new Date().toISOString().slice(0, 10),
        reason: (prev && prev.reason && !/^TODO/.test(prev.reason)) ? prev.reason : baselineReason(f.file),
      };
    }
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({
      note: [
        'Known §19 widget-truth findings, 2026-09-11. This baseline is NOT clean and is not',
        'pretending to be: every entry is either a real unfixed violation with a dated reason,',
        'or a documented judgement call. A NEW finding fails CI; a baselined finding that gets',
        'fixed is removed automatically by the next run, so this can only ever shrink.',
        'Generated by apps/web/tools/check-widget-truth.cjs — run `baseline` to regenerate.',
      ].join(' '),
      entries,
    }, null, 2) + '\n');
    console.log(`[widget-truth] baseline rewritten: ${Object.keys(entries).length} entries`);
    return;
  }

  if (mode === 'report') {
    console.log(`[widget-truth] ${widgetFiles().length} widget files scanned`);
    console.log(`[widget-truth] CHECK 2 scope: ${CHECK2_DIRS.join(', ')} (${typeToComp.size} widget types in WidgetRenderer's switch)`);
    for (const s of skipped2) console.log(`  skipped(check2): ${s}`);
    for (const f of findings) console.log(`  ${f.check}  ${f.file}${f.line ? ':' + f.line : ''}  ${f.detail}`);
    console.log(`[widget-truth] ${findings.length} finding(s), ${baseKeys.size} baselined`);
    return;
  }

  const nw = [];
  for (const [k, n] of counts) {
    const entry = (baseline.entries || {})[k];
    if (!entry) {
      const f = findings.find((x) => key(x) === k);
      nw.push({ ...f, note: 'not baselined' });
    } else if (n > (entry.count || 1)) {
      const f = findings.find((x) => key(x) === k);
      nw.push({ ...f, note: `${n} occurrence(s), baseline allows ${entry.count || 1}` });
    }
  }

  // Ratchet down: anything baselined that is now gone (or reduced) tightens.
  const entries = { ...(baseline.entries || {}) };
  let tightened = [];
  for (const k of baseKeys) {
    const n = counts.get(k) || 0;
    if (n === 0) { delete entries[k]; tightened.push(`${k} — FIXED`); }
    else if (n < (entries[k].count || 1)) { tightened.push(`${k} — ${entries[k].count} -> ${n}`); entries[k] = { ...entries[k], count: n }; }
  }
  if (tightened.length) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ note: baseline.note, entries }, null, 2) + '\n');
    console.log(`[widget-truth] ratchet: ${tightened.length} baselined finding(s) improved — baseline tightened:`);
    for (const t of tightened) console.log(`    - ${t}`);
  }

  if (nw.length) {
    console.error(`\n[widget-truth] FAIL — ${nw.length} new §19 violation(s):\n`);
    for (const f of nw) {
      console.error(`  ${f.file}${f.line ? ':' + f.line : ''}`);
      console.error(`    ${f.check}: ${f.detail}  (${f.note})`);
    }
    console.error(`\nA widget must never invent content it does not have. Render a real empty`);
    console.error(`state instead (apps/web/src/components/widgets/WidgetEmptyState.tsx) — it`);
    console.error(`names the next action on the builder canvas and holds the zone quietly on a`);
    console.error(`live screen. If a finding is genuinely acceptable, add it to`);
    console.error(`apps/web/tools/widget-truth-baseline.json WITH A REASON.\n`);
    process.exit(1);
  }

  console.log(`[widget-truth] OK — ${findings.length} finding(s), all baselined (${baseKeys.size} entries).`);
}

run();
