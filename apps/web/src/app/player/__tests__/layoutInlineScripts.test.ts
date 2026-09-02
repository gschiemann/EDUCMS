/**
 * Every inline `<script dangerouslySetInnerHTML>` in the player layout must
 * PARSE — as the browser receives it, not as the source file reads.
 *
 * 2026-09-02: the boot-proof watchdog was written as
 * `m=/Chrome\/(\d+)/.exec(ua)` inside a JS TEMPLATE LITERAL. The literal
 * consumed `\/` and `\d` as escapes, so the page shipped `/Chrome/(d+)/` —
 * `Unexpected token ')'` in Chromium AND WebKit, on the life-safety player
 * route, and the whole script (a 25 s watchdog) was dead. Cross-Browser and
 * CI & Security went red on master. Same class as the 2026-05-09 Safari
 * bridge regression (a literal LF inside a regex literal): hand-written
 * inline JS that nobody ran through a parser.
 *
 * This test evaluates each template literal (with `${…}` interpolations
 * blanked) and feeds the RESULT to `new Function`, which is what the engine
 * does. A regex with an unescaped `\d` fails here before it fails on a
 * Taurus.
 */

import * as fs from 'fs';
import * as path from 'path';

const LAYOUT = path.join(__dirname, '..', 'layout.tsx');

function inlineScriptBodies(src: string): Array<{ line: number; body: string }> {
  const out: Array<{ line: number; body: string }> = [];
  const re = /__html:\s*`([\s\S]*?)`\s*,?\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    // Blank interpolations, then let the JS engine apply the template-literal
    // escape rules exactly as it does at render time.
    const raw = m[1].replace(/\$\{[\s\S]*?\}/g, '""');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const body = new Function('return `' + raw + '`;')() as string;
    out.push({ line, body });
  }
  return out;
}

describe('player layout inline scripts parse as the browser receives them', () => {
  const src = fs.readFileSync(LAYOUT, 'utf8');
  const scripts = inlineScriptBodies(src);

  it('finds the inline scripts (canary — the extractor must not silently match nothing)', () => {
    expect(scripts.length).toBeGreaterThanOrEqual(3);
  });

  it.each(scripts.map((s) => [s.line, s.body] as const))(
    'script at layout.tsx:%s is valid JavaScript',
    (_line, body) => {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      expect(() => new Function(body)).not.toThrow();
    },
  );

  it('the boot watchdog keeps its Chrome-version regex intact after escaping', () => {
    const watchdog = scripts.find((s) => s.body.includes('edu-boot-failed'));
    expect(watchdog).toBeDefined();
    expect(watchdog!.body).toContain('/Chrome\\/(\\d+)/');
  });
});
