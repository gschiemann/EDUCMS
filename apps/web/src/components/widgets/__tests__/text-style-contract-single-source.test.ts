/**
 * M0-3 anti-drift ratchet — ONE place may turn a text-style override into CSS.
 *
 * The bug this closes was not a typo, it was DUPLICATION. Three renderers each
 * carried their own copy of "how do I turn `{bold:true}` into CSS":
 *   - BuilderZone's `buildRules` closure (the most complete),
 *   - `player/page.tsx`'s hand-copied `_buildPlayerRules` (which had quietly
 *     fallen behind on lineHeight / textAlign / numeric fontWeight / explicit
 *     fontStyle + textDecoration / backgroundColor / hidden),
 *   - and the EXTERNAL_HTML sender, which had NO copy at all and shipped the
 *     builder's booleans to shims that read CSS props only.
 * All three now derive from `text-style-contract.ts`.
 *
 * A grep-shaped test is the wrong tool for "is this component mounted"
 * (CLAUDE.md #9) but the right one for "did someone re-introduce a second
 * writer of this string": the declaration text IS the artifact, and the
 * contract module is the only file allowed to emit it.
 *
 * MUTATION: paste `font-weight: 800 !important` back into either consumer and
 * this goes red.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../../../..');

/** Files that render a text-style override and must NOT build the CSS themselves. */
const CONSUMERS = [
  'src/components/template-builder/BuilderZone.tsx',
  'src/app/player/page.tsx',
  'src/components/widgets/WidgetRenderer.tsx',
];

/** The only file allowed to author these declarations. */
const CONTRACT = 'src/components/widgets/text-style-contract.ts';

/**
 * Declaration fragments that only a text-style rule builder produces. Written
 * as regexes so spacing changes still match.
 */
const RULE_SIGNATURES: Array<[string, RegExp]> = [
  ['font-weight: 800 !important', /font-weight:\s*\$?\{?[^}\n]*\}?\s*!important/],
  ['font-style: italic !important', /font-style:\s*\$?\{?[^}\n]*\}?\s*!important/],
  ['text-decoration: … !important', /text-decoration:\s*\$?\{?[^}\n]*\}?\s*!important/],
];

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('M0-3 — exactly one source builds text-style CSS', () => {
  it('the contract module really does author the declarations', () => {
    const src = read(CONTRACT);
    for (const [label, re] of RULE_SIGNATURES) {
      expect(`${CONTRACT} must emit ${label}: ${re.test(src)}`).toBe(`${CONTRACT} must emit ${label}: true`);
    }
  });

  it.each(CONSUMERS)('%s delegates instead of re-deriving the rules', (rel) => {
    const src = read(rel);
    for (const [label, re] of RULE_SIGNATURES) {
      expect(`${rel} emits ${label}: ${re.test(src)}`).toBe(`${rel} emits ${label}: false`);
    }
  });

  it.each(CONSUMERS)('%s imports the contract', (rel) => {
    expect(read(rel)).toMatch(/from '@\/components\/widgets\/text-style-contract'|from '\.\/text-style-contract'/);
  });

  it('and nobody else hard-codes the bold weight', () => {
    // 800 is the contract's answer to `bold: true`. If a second file starts
    // asserting it, the two can disagree — which is how this bug was born.
    for (const rel of CONSUMERS) {
      expect(`${rel} hard-codes 800: ${/font-weight:\s*800/.test(read(rel))}`)
        .toBe(`${rel} hard-codes 800: false`);
    }
  });
});
