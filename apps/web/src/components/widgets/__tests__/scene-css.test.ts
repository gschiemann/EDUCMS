import { boostSceneCss, SCENE_BOOST } from '../scene-css';

/**
 * Regression cover for the 2026-08-09 flagship-template bug: flattened
 * Tailwind preflight outranked every scene widget's own CSS, rendering
 * the Animated Rainbow title at 16px and collapsing the Teacher-of-the-
 * Week photo box to zero height. See scene-css.ts for the full analysis.
 */

const idCount = (selector: string) => (selector.match(/:not\(#\\?#\)/g) || []).length;

describe('boostSceneCss', () => {
  it('prefixes a plain rule so it outranks flattened preflight', () => {
    const out = boostSceneCss('.aw-titleBox h1 { font-size: 110px; }');
    expect(out).toBe(`${SCENE_BOOST} .aw-titleBox h1 { font-size: 110px; }`);
  });

  it('prefixes every selector in a comma-separated list', () => {
    const out = boostSceneCss('.a, .b .c { color: red; }');
    expect(out).toBe(`${SCENE_BOOST} .a, ${SCENE_BOOST} .b .c { color: red; }`);
  });

  it('boosts rules nested inside @media but not the @media prelude', () => {
    const out = boostSceneCss('@media (min-width: 40px) { .a { color: red; } }');
    expect(out).toBe(`@media (min-width: 40px) { ${SCENE_BOOST} .a { color: red; } }`);
  });

  it('never touches @keyframes stops', () => {
    // Prefixing `0%` / `from` / `to` would produce invalid CSS and kill
    // the animation — every scene widget is animation-driven.
    const css = '@keyframes aw-spin { 0% { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
    expect(boostSceneCss(css)).toBe(css);
  });

  it('does not let a statement at-rule leak into the next rule (@import → @keyframes)', () => {
    // Regression: themes/rainbow-animated.tsx opens with an @import, which ends
    // at a `;` and opens no block. Before the fix its text stayed in the prelude
    // buffer, so the following `@keyframes` block registered its at-rule name as
    // "import" — the keyframe stops were then treated as selectors and boosted
    // to `:not(#\#) 0%`, which is invalid CSS. The browser drops the whole
    // @keyframes rule and the widget's animation silently dies.
    const css = "@import url('https://fonts.example/x.css');\n@keyframes spin { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }";
    const out = boostSceneCss(css);
    expect(out).toBe(css);
    expect(out).not.toMatch(/:not\(#\\#\)[^{]*0%/);
  });

  it('still boosts a normal rule that follows a statement at-rule', () => {
    const out = boostSceneCss("@import url('x.css');\n.a { color: red; }");
    expect(out).toBe(`@import url('x.css');\n${SCENE_BOOST} .a { color: red; }`);
  });

  it('keeps pseudo-elements valid (prefix, never suffix)', () => {
    // `h1::before:not(#\#)` would be invalid CSS — the booster must go in
    // front of the subject, which is why we prepend a descendant.
    const out = boostSceneCss('.aw-cloud::before { content: ""; }');
    expect(out).toBe(`${SCENE_BOOST} .aw-cloud::before { content: ""; }`);
    expect(out).not.toMatch(/::before:not/);
  });

  it('does not steer on braces inside comments or quoted strings', () => {
    const css = '.a { content: "}{"; } /* .b { x } */ .c { color: red; }';
    const out = boostSceneCss(css);
    expect(out).toContain(`${SCENE_BOOST} .a {`);
    expect(out).toContain(`${SCENE_BOOST} .c {`);
    // The commented-out rule stays commented out, unboosted.
    expect(out).toContain('/* .b { x } */');
  });

  it('sits above flattened preflight and below flattened utilities', () => {
    // These two numbers are what the whole fix balances on:
    //   preflight (base layer)  = 2 boosts  → scene CSS must exceed it
    //   utilities               = 4 boosts  → scene CSS must stay under,
    //                                         so a utility class on a
    //                                         scene element still wins.
    // Measured from the built stylesheet; the guard script below asserts
    // the real CSS still matches.
    expect(idCount(SCENE_BOOST)).toBe(3);
  });
});
