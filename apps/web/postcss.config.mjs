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
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
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
