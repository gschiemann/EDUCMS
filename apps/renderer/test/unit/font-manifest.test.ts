/**
 * The bundle must carry every font the Designer is told it may use.
 *
 * fonts/manifest.json is generated from DESIGNER_FONTS in
 * apps/api/src/ai/designer-prompt.ts; this test goes red the moment the two
 * disagree, so a font the prompt agent adds can never silently render as a
 * fallback in the critique loop. Fix: add the fontsource package (5.3.0) to
 * apps/renderer/package.json, `pnpm install`, `pnpm --filter renderer gen:fonts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SUBSTITUTES, extractDesignerFonts, loadManifest } from '../../src/fonts/manifest.js';
import { packageRoot } from '../../src/paths.js';
import { repoRoot } from '../helpers/env.js';
import { testCatalog } from '../helpers/server.js';

const PROMPT = path.join(repoRoot(), 'apps', 'api', 'src', 'ai', 'designer-prompt.ts');

test('the manifest mirrors DESIGNER_FONTS exactly (regenerate with `pnpm --filter renderer gen:fonts`)', (t) => {
  if (!fs.existsSync(PROMPT)) {
    t.skip('apps/api is not present (renderer built on its own)');
    return;
  }
  const fromPrompt = extractDesignerFonts(fs.readFileSync(PROMPT, 'utf8'));
  assert.deepEqual(loadManifest().designerFonts, fromPrompt);
});

test('every Designer font and every look-alike is bundled, installed, and named what it claims', () => {
  const manifest = loadManifest();
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot(), 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
  const wanted = new Set([...manifest.designerFonts, ...Object.values(SUBSTITUTES)]);
  for (const family of wanted) {
    const npm = manifest.families[family];
    assert.ok(npm, `${family} has no package in fonts/manifest.json`);
    assert.ok(pkg.dependencies[npm], `${npm} is not a dependency of apps/renderer`);
  }
  assert.deepEqual(manifest.substitutes, { ...SUBSTITUTES });
  const catalog = testCatalog();
  for (const family of wanted) {
    const entry = catalog.families.get(family.toLowerCase());
    assert.ok(entry, `${family} did not load into the catalog`);
    assert.equal(entry.family.toLowerCase(), family.toLowerCase());
    assert.ok(entry.files.size > 0, `${family} ships no woff2 files`);
    assert.ok(entry.subsets.includes('latin'), `${family} has no latin subset`);
  }
});

test('extractDesignerFonts reads the literal list and ignores quoted words in comments', () => {
  const src = `
    export const DESIGNER_FONTS = [
      'Inter', "Oswald", // 'NotAFont' in a comment
      /* 'AlsoNot' */ 'Patrick Hand',
    ] as const;
    export const OTHER = ['Nope'];`;
  assert.deepEqual(extractDesignerFonts(src), ['Inter', 'Oswald', 'Patrick Hand']);
  assert.throws(() => extractDesignerFonts('export const X = [];'));
});

test('the font-file allowlist is exact: no traversal, no unknown ids, no unlisted files', () => {
  const catalog = testCatalog();
  assert.ok(catalog.resolveFontPath('/s/vosr/v/inter/inter-latin-wght-normal.woff2'));
  assert.ok(catalog.resolveFontPath('/s/vosr/s/anton/anton-latin-400-normal.woff2'));
  for (const bad of [
    '/s/vosr/v/inter/../../../../etc/passwd',
    '/s/vosr/v/inter/%2e%2e%2fpackage.json',
    '/s/vosr/v/inter/package.json',
    '/s/vosr/s/inter/inter-latin-wght-normal.woff2', // wrong scope
    '/s/vosr/v/lobster/lobster-latin-400-normal.woff2',
    '/s/vosr/v/inter/inter-latin-wght-normal.woff2/..',
    '/s/inter/v12/whatever.woff2',
  ]) {
    assert.equal(catalog.resolveFontPath(bad), null, bad);
  }
});
