/**
 * 2026-05-04 — Goodview / Chromium 95 hotfix.
 *
 * Tailwind v4 emits all utilities inside CSS Cascade Layer blocks
 * (@layer base, @layer components, @layer utilities, etc.). CSS
 * cascade layers are Chromium 99+ only — Chromium 95 sees @layer as
 * an unknown at-rule and SILENTLY DISCARDS THE ENTIRE BLOCK CONTENT.
 *
 * On the operator's Goodview kiosk (Chromium 95.0.4638.74 / Android 11),
 * EVERY Tailwind utility was invisible. The splash card had no
 * background, no rounded corners, no glass blur. Image carousels
 * didn't fill the viewport because object-cover / w-full / h-full
 * were all dropped. Yodeck/OptiSigns work on the same hardware
 * because their stylesheets aren't wrapped in @layer.
 *
 * @csstools/postcss-cascade-layers polyfills this at BUILD TIME by
 * flattening every @layer block into equivalent flat CSS with
 * specificity hacks that preserve layer priority. Modern browsers
 * see the same cascade order they would have seen with native
 * @layer; Chromium 95 sees flat CSS it can actually parse.
 *
 * Plugin order matters — must run AFTER @tailwindcss/postcss so it
 * receives Tailwind's @layer-wrapped output as input.
 */

/**
 * 2026-08-31 — dev/prod pipeline parity ("no responsive CSS in `next dev`").
 *
 * @tailwindcss/postcss only flattens its CSS-Nesting output when `optimize`
 * is on, and `optimize` defaults to NODE_ENV === "production". So `next dev`
 * fed the cascade-layers plugin below nested variant rules like
 *
 *     .md\:flex { @media (width >= 48rem) { display: flex } }
 *
 * whose nested at-rule bodies are bare declarations. postcss-cascade-layers
 * (6.0.0) splits every @layer into a "selector rules" clone (which drops any
 * at-rule containing no style-rule descendants — i.e. exactly these) and a
 * "keyframes/other" clone (which drops all style rules), so a nested-variant
 * utility survived in NEITHER clone. Silently — no warning. Result: the dev
 * stylesheet had ~zero md:/lg:/sm:/hover: rules (7 @media blocks in 377KB vs
 * 30 blocks / 141 md: selectors in the prod build of the same tree), and
 * every desktop layout rendered as its mobile fallback in dev only.
 *
 * Fix: turn `optimize` on in dev too, minus minification. Tailwind then runs
 * its Lightning CSS pass first — hoisting nested variants into the top-level
 * `@media (min-width:…) { .md\:… }` shape — before cascade-layers flattens
 * layers, i.e. dev now runs the exact pipeline production ships. That keeps
 * local design verification faithful to prod (including the `:not(#\#)`
 * specificity landscape scene-css.ts is written against) and keeps dev CSS
 * parseable on a Chromium-95 kiosk pointed at a dev box during field debug.
 * Trade-offs: devtools shows post-Lightning CSS instead of authored
 * formatting, and each dev CSS rebuild pays a (fast, Rust) Lightning pass.
 *
 * The production branch MUST stay `{}` — the exact pre-fix default — so the
 * shipped CSS is byte-identical to before this change (verified 2026-08-31:
 * all 4 build chunks SHA-256-identical pre/post).
 */
const config = {
  plugins: {
    "@tailwindcss/postcss":
      process.env.NODE_ENV === "production"
        ? {}
        : { optimize: { minify: false } },
    "@csstools/postcss-cascade-layers": {
      // The default `onConditionalRulesChangingLayerOrder` handler
      // emits a console warning when a conditional rule (@media,
      // @supports, etc.) inside a layer would have its priority
      // changed by the flattening transform. Our usage is plain
      // Tailwind output so this is mostly a no-op, but keep the
      // 'warn' value so future regressions are visible in build logs.
      onConditionalRulesChangingLayerOrder: "warn",
    },
  },
};

export default config;
