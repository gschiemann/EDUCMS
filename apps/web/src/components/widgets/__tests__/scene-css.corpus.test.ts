import * as fs from 'fs';
import * as path from 'path';

import { boostSceneCss, SCENE_BOOST } from '../scene-css';

/**
 * Corpus test — runs the real transform over the REAL CSS of every scene
 * widget in the repo and asserts structural invariants.
 *
 * Why this exists: the 2026-08-09 sweep wrapped 225 `<style>` tags across 164
 * widget files in `sceneCss()`. Unit tests cover the algorithm on synthetic
 * input; this covers it on the actual production corpus, so a widget whose CSS
 * uses a construct the scanner mishandles fails CI instead of silently
 * rendering wrong on a screen in a school.
 *
 * The invariants are deliberately structural (block count, round-trip selector
 * identity, keyframes untouched) rather than "does it look right" — those are
 * exactly the properties a selector rewriter can violate.
 */

const WIDGETS = path.join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(p, out);
    } else if (entry.name.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

/** Extract every template-literal CSS blob that looks like a stylesheet. */
function extractCssBlocks(src: string): string[] {
  const blocks: string[] = [];
  const re = /`([^`\\]|\\.|\$\{[^}]*\})*`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Model the RUNTIME string, not the source text: JS evaluates `${…}`
    // before sceneCss ever sees the CSS, so a literal `${` never reaches the
    // scanner in production. Leaving them in would make the scanner read `${`
    // as a block open and report failures that cannot happen on a screen.
    const body = m[0].slice(1, -1).replace(/\$\{[^}]*\}/g, 'RUNTIMEVALUE');
    // A stylesheet, not an arbitrary string: has at least one `selector { … }`
    // and a declaration.
    if (/\{[^}]*:[^}]*\}/.test(body) && /[.#a-zA-Z@][^{}]*\{/.test(body) && body.length > 60) {
      blocks.push(body);
    }
  }
  return blocks;
}

/** Count `{` that actually open a block, skipping comments and strings. */
function countBlocks(css: string): number {
  let n = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      i = e === -1 ? css.length : e + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < css.length && css[i] !== q) {
        if (css[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '{') n++;
  }
  return n;
}

const files = walk(WIDGETS);
const corpus: { file: string; css: string }[] = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const css of extractCssBlocks(src)) {
    corpus.push({ file: path.relative(WIDGETS, f), css });
  }
}

describe('boostSceneCss over the real widget corpus', () => {
  it('found a substantial corpus to test against', () => {
    // Guards the extractor itself: if a refactor moves scene CSS somewhere this
    // regex no longer sees, this test must fail loudly rather than pass vacuously.
    expect(corpus.length).toBeGreaterThan(50);
  });

  it('never adds or drops a block in any widget', () => {
    const broken: string[] = [];
    for (const { file, css } of corpus) {
      if (countBlocks(boostSceneCss(css)) !== countBlocks(css)) broken.push(file);
    }
    expect(broken).toEqual([]);
  });

  it('round-trips: stripping the booster returns the original CSS', () => {
    const broken: string[] = [];
    // Whitespace-normalised: the transform legitimately rewrites a multi-line
    // selector list (`.a,\n.b {`) onto one line (`.a, .b {`). That is the same
    // stylesheet. What must NOT change is the actual content.
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    for (const { file, css } of corpus) {
      const back = boostSceneCss(css).split(`${SCENE_BOOST} `).join('');
      if (norm(back) !== norm(css)) broken.push(file);
    }
    expect(broken).toEqual([]);
  });

  it('never injects the booster inside @keyframes', () => {
    const broken: string[] = [];
    for (const { file, css } of corpus) {
      const out = boostSceneCss(css);
      const re = /@(-webkit-)?keyframes[^{]*\{/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(out))) {
        // Walk to the matching close brace and check the body is untouched.
        let depth = 0;
        let i = m.index + m[0].length - 1;
        for (; i < out.length; i++) {
          if (out[i] === '{') depth++;
          else if (out[i] === '}') {
            depth--;
            if (depth === 0) break;
          }
        }
        if (out.slice(m.index, i).includes(SCENE_BOOST)) {
          broken.push(`${file} :: ${m[0].trim()}`);
          break;
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('leaves html/:root selectors unprefixed (they can have no ancestor)', () => {
    const broken: string[] = [];
    for (const { file, css } of corpus) {
      const out = boostSceneCss(css);
      if (/(^|[}\s])(html|:root)\b/i.test(css) && new RegExp(`${SCENE_BOOST.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')} (html|:root)\\b`, 'i').test(out)) {
        broken.push(file);
      }
    }
    expect(broken).toEqual([]);
  });

  it('boosts the FIRST style rule of every stylesheet, including @import-led ones', () => {
    // The highest-value invariant in this file. 91 of the widget stylesheets
    // open with `@import url(…);`, and a statement at-rule ends at `;` without
    // opening a block. Before the semicolon flush, that text stayed in the
    // prelude buffer and was glued onto the next selector, which then matched
    // `startsWith('@')` and was emitted verbatim — so the FIRST style rule of
    // all 91 went unboosted. That rule is almost always the widget's own
    // `.xxx-root`, i.e. exactly where the load-bearing padding lives
    // (MenuBoardWidget `.rmb-root`, WaitTimeWidget `.rwt-root`,
    // RetailStorefrontHoursWidget `.rshw-root`, …). Unboosted, flattened
    // preflight `*{padding:0}` still wins and the board renders flush against
    // the LED edge — the very symptom this whole change exists to remove.
    // Differential invariant: a leading statement at-rule is never itself
    // boosted, so REMOVING it must not change how many selectors get boosted.
    // Before the fix the @import-led version came out with exactly one fewer
    // booster — the swallowed root rule. This states that precisely, without
    // needing to re-parse the stylesheet.
    const countBoosts = (s: string) => s.split(SCENE_BOOST).length - 1;
    const broken: string[] = [];
    for (const { file, css } of corpus) {
      // Line-based, NOT `[^;]*;` — these @import URLs legitimately contain
      // semicolons inside their quoted href (`…family=Fredoka:wght@500;700…`),
      // which a naive semicolon-terminated match would cut in half. (The real
      // scanner is unaffected: it skips quoted strings, so a `;` inside the
      // href never triggers the depth-0 flush.)
      const stripped = css.replace(/^[ \t]*@(?:import|charset|namespace)\b.*$/gm, '');
      if (stripped === css) continue; // no statement at-rule to worry about
      const withAtRule = countBoosts(boostSceneCss(css));
      const without = countBoosts(boostSceneCss(stripped));
      if (withAtRule !== without) {
        broken.push(`${file} :: ${without - withAtRule} rule(s) lost their boost to the leading at-rule`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('produces no empty or malformed selector', () => {
    const broken: string[] = [];
    for (const { file, css } of corpus) {
      const out = boostSceneCss(css);
      if (out.includes(`${SCENE_BOOST} {`) || out.includes(`${SCENE_BOOST} ,`) || out.includes(`${SCENE_BOOST}  `)) {
        broken.push(file);
      }
    }
    expect(broken).toEqual([]);
  });
});
