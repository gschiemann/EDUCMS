/**
 * Scene-CSS specificity booster.
 *
 * ── WHY THIS EXISTS (2026-08-09) ─────────────────────────────────────
 * Full-screen "scene" widgets (Animated Rainbow / Cafeteria, the MS+HS
 * packs, fitness boards…) ship their own design system as a plain CSS
 * string in a runtime `<style>` tag. That CSS is UNLAYERED and never
 * passes through PostCSS.
 *
 * Our Chromium-95 hotfix (postcss.config.mjs, e95c9ff8) runs
 * @csstools/postcss-cascade-layers, which flattens Tailwind's `@layer`
 * blocks and preserves layer order by BOOSTING specificity with
 * `:not(#\#)` hacks. Tailwind's preflight (the `base` layer) comes out as:
 *
 *     h1:not(#\#):not(#\#) { font-size: inherit }   → (2,0,1)
 *     :not(#\#):not(#\#)   { padding: 0; margin: 0 } → (2,0,0)
 *
 * Native cascade layers give unlayered author CSS priority over ALL
 * layered CSS — that is the guarantee scene widgets were written
 * against. Flattening erased it, so boosted preflight silently outranked
 * every plain class selector in every scene:
 *
 *   `.aw-titleBox h1 {font-size:110px}` (0,1,1) lost → title rendered 16px
 *   `.aw-tFace {padding-top:100%}`      (0,1,0) lost → the Teacher-of-the-
 *                                        Week photo box collapsed to 0px
 *   …and every other padding/margin in every scene, since `*` wins them all.
 *
 * ── WHY THE FIX LIVES HERE AND NOT IN globals.css ────────────────────
 * It can't live there. The flattener boosts EVERYTHING it processes, and
 * it gives unlayered CSS the HIGHEST boost of all (measured: preflight
 * unlayered = 5, utilities = 3). So any counter-rule added to globals.css
 * outranks the widgets too — it cannot hand the win back to them.
 * Re-ordering the layers doesn't work either: the plugin gives every
 * layer a minimum of one boost, leaving even a first-position `base` at
 * (1,0,1) — still ahead of a plain class selector.
 *
 * So the scene CSS itself has to carry the specificity. We prepend a
 * descendant booster to each selector, which raises it above preflight
 * while staying BELOW Tailwind utilities (4 boosts) so a utility class
 * on a scene element still wins, exactly as it does today. The operator's
 * zone-wide override injection is `!important`, so it still beats both.
 *
 * We PREPEND an ancestor rather than appending to the subject, because
 * appending breaks on pseudo-elements (`h1::before:not(#\#)` is invalid).
 * Prepending is always valid and needs no compound-selector surgery. The
 * booster matches any element, and a scene is always mounted inside a
 * wrapper, so an ancestor always exists.
 *
 * Call sites use `sceneCss()` DURING RENDER, not at module load. That is
 * deliberate: it runs on the server and the client alike, so both emit the
 * same `<style>` text and React cannot hydration-mismatch. The transform is
 * pure and memoized (see `sceneCss` below), so the repeat cost is a Map hit.
 *
 * ONE RULE FOR SCENE AUTHORS: never use `!important` on a property the
 * operator can edit (font-size, font-family, color, weight, line-height,
 * alignment). Boosted, such a rule becomes (3,x,y)-important and outranks
 * the operator's OWN !important override — their edit then silently does
 * nothing, on real screens as well as in the builder. Source order already
 * settles intra-scene conflicts. `apps/web/tools/check-scene-css.cjs`
 * fails the build on it.
 */

/**
 * Three IDs' worth of specificity: above flattened preflight (2), below
 * flattened Tailwind utilities (4). `apps/web/src/components/widgets/
 * __tests__/scene-css.test.ts` pins those two numbers against the real
 * built stylesheet, so a layer-count change in globals.css fails CI
 * instead of silently un-fixing every scene widget again.
 */
export const SCENE_BOOST = ':not(#\\#):not(#\\#):not(#\\#)';

/**
 * Prefix every style-rule selector in `css` with `booster`, leaving
 * at-rule preludes and `@keyframes` stops (`0%`, `from`, `to`) untouched.
 *
 * Deliberately a small scanner rather than a regex: it has to respect
 * comments, quoted strings, and nesting depth to know which `{` opens a
 * style rule and which opens an at-rule block.
 */
/** Selectors that ARE the root element, so they can have no ancestor. */
const ROOT_SELECTOR = /^(html|:root)\b/i;

/** Length of the run of whitespace and comments at the start of `s`. */
function leadingTriviaLength(s: string): number {
  let i = 0;
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end === -1 ? s.length : end + 2;
      continue;
    }
    return i;
  }
}

export function boostSceneCss(css: string, booster: string = SCENE_BOOST): string {
  let out = '';
  let buf = '';
  let depth = 0;
  // At-rule name in effect at each nesting level, so we can tell whether
  // the selectors we're looking at are keyframe stops.
  const atRules: string[] = [];
  let i = 0;

  while (i < css.length) {
    const ch = css[i];

    // Comments and strings pass through verbatim — a `{`, `}` or `,`
    // inside one must not steer the scanner.
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      buf += css.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) {
        if (css[j] === '\\') j++;
        j++;
      }
      const stop = Math.min(j + 1, css.length);
      buf += css.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === '{') {
      // Split off leading trivia (whitespace + comments) so the booster
      // lands in front of the SELECTOR, not in front of a comment that
      // happens to precede the rule.
      const leadLen = leadingTriviaLength(buf);
      const lead = buf.slice(0, leadLen);
      const rest = buf.slice(leadLen);
      const selectors = rest.trimEnd();
      // Preserve the author's spacing before `{` so the emitted CSS still
      // reads like the source when someone inspects it in devtools.
      const trailing = rest.slice(selectors.length);
      const inKeyframes = atRules.some((name) => /keyframes$/i.test(name));

      if (selectors.startsWith('@')) {
        // At-rule: keep the prelude, remember its name for this level.
        atRules[depth] = selectors.slice(1).split(/[\s({]/)[0] || '';
        out += buf;
      } else if (inKeyframes || selectors === '') {
        // Keyframe stops are not selectors; never prefix them.
        atRules[depth] = '';
        out += buf;
      } else {
        atRules[depth] = '';
        out +=
          lead +
          selectors
            .split(',')
            .map((sel) => {
              const s = sel.trim();
              // `html` / `:root` ARE the root element — they have no
              // ancestor, so a descendant prefix could never match and
              // would silently delete the rule. Leave them alone. Safe:
              // these only ever carry custom-property definitions here,
              // and preflight does not reset custom properties.
              return ROOT_SELECTOR.test(s) ? s : `${booster} ${s}`;
            })
            .join(', ') +
          trailing;
      }

      out += '{';
      buf = '';
      depth++;
      i++;
      continue;
    }

    if (ch === '}') {
      out += buf + '}';
      buf = '';
      depth = Math.max(0, depth - 1);
      atRules.length = depth;
      i++;
      continue;
    }

    // Statement at-rules (`@import`, `@charset`, `@namespace`, `@layer a, b;`)
    // end at a semicolon and open NO block. Without this flush their text stays
    // in the prelude buffer and gets glued onto the next rule — which is how
    // `@import url(…);` directly above `@keyframes foo {` made the scanner
    // record the block's at-rule name as "import" instead of "keyframes",
    // so the keyframe stops were treated as selectors and boosted to
    // `:not(#\#) 0%`. That is invalid, the browser drops the whole @keyframes
    // rule, and the widget's animation silently stops. (Real, shipped in
    // themes/rainbow-animated.tsx — caught by the corpus test.)
    if (ch === ';' && depth === 0) {
      out += buf + ';';
      buf = '';
      i++;
      continue;
    }

    buf += ch;
    i++;
  }

  return out + buf;
}

/**
 * Memoized front-end for `boostSceneCss` — the form every widget calls.
 *
 * Widgets inject scene CSS three ways (`<style>{CSS}</style>`, an inline
 * template literal, and `dangerouslySetInnerHTML`), and some of those sit
 * in render paths that run per-frame. Boosting is a pure string→string
 * transform, so the result is cached by input.
 *
 * For the common case (a module-level `const CSS`) the key is the SAME
 * string object every call, so V8 reuses its cached hash and the lookup
 * is effectively free. Interpolated template literals do allocate a new
 * string per render, hence the bounded cache: without a cap, a scene
 * whose CSS embeds a live value (a score, a colour) would grow the Map
 * without limit on a player that runs for weeks.
 */
const CACHE_LIMIT = 512;
const cache = new Map<string, string>();

export function sceneCss(css: string): string {
  if (typeof css !== 'string' || css === '') return css;
  const hit = cache.get(css);
  if (hit !== undefined) return hit;
  const out = boostSceneCss(css);
  // Simple bounded eviction: clearing wholesale beats an LRU here — the
  // working set is a handful of scenes, so a refill is cheap and rare.
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(css, out);
  return out;
}
