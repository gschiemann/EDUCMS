import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateGoogleFontsCss, parseGoogleFontsUrl, pickVariant, substituteFaces } from '../../src/fonts/google-css.js';
import { testCatalog } from '../helpers/server.js';

const G = 'https://fonts.googleapis.com/css2?';

test('css2 URLs parse: families, axes, discrete values, ranges, display', () => {
  const p = parseGoogleFontsUrl(
    `${G}family=Fraunces:opsz,wght@9..144,500;9..144,800&family=Inter:ital,wght@0,400;1,700&family=Anton&display=swap`,
  );
  assert.ok(p);
  assert.equal(p.api, 'css2');
  assert.equal(p.display, 'swap');
  assert.deepEqual(p.families.map((f) => f.name), ['Fraunces', 'Inter', 'Anton']);
  const [fraunces, inter, anton] = p.families;
  assert.deepEqual(fraunces?.axes, ['opsz', 'wght']);
  assert.deepEqual(fraunces?.specs, [
    { italic: false, weight: 500 },
    { italic: false, weight: 800 },
  ]);
  assert.deepEqual(fraunces?.otherAxes.opsz, [
    [9, 144],
    [9, 144],
  ]);
  assert.deepEqual(inter?.specs, [
    { italic: false, weight: 400 },
    { italic: true, weight: 700 },
  ]);
  assert.deepEqual(anton?.specs, [{ italic: false, weight: 400 }]);
});

test('legacy /css URLs parse, including 700italic / bi shorthands and | separators', () => {
  const p = parseGoogleFontsUrl('https://fonts.googleapis.com/css?family=Poppins:400,700italic|Barlow:bi');
  assert.ok(p);
  assert.equal(p.api, 'css');
  assert.deepEqual(p.families[0]?.specs, [
    { italic: false, weight: 400 },
    { italic: true, weight: 700 },
  ]);
  assert.deepEqual(p.families[1]?.specs, [{ italic: true, weight: 700 }]);
});

test('non-Google and non-stylesheet URLs are not Google Fonts requests', () => {
  assert.equal(parseGoogleFontsUrl('https://fonts.bunny.net/css2?family=Inter'), null);
  assert.equal(parseGoogleFontsUrl('https://fonts.googleapis.com/icon?family=Material+Icons'), null);
  assert.equal(parseGoogleFontsUrl('not a url'), null);
});

test('discrete weights stay discrete faces on the variable file (600 in CSS resolves like production)', () => {
  const catalog = testCatalog();
  const out = generateGoogleFontsCss(parseGoogleFontsUrl(`${G}family=Inter:wght@400;700&display=swap`)!, catalog);
  assert.equal(out.status, 200);
  assert.deepEqual(out.served, ['Inter']);
  assert.match(out.css, /font-family: 'Inter';/);
  assert.match(out.css, /font-weight: 400;/);
  assert.match(out.css, /font-weight: 700;/);
  assert.doesNotMatch(out.css, /font-weight: 100 900/);
  assert.match(out.css, /font-display: swap;/);
  assert.match(out.css, /url\(https:\/\/fonts\.gstatic\.com\/s\/vosr\/v\/inter\/inter-latin-wght-normal\.woff2\)/);
  // One face per weight per subset, latin last (checked first by the browser).
  const latinIdx = out.css.lastIndexOf('/* latin */');
  const extIdx = out.css.lastIndexOf('/* latin-ext */');
  assert.ok(latinIdx > extIdx);
});

test('a weight range becomes a ranged face; opsz picks the file that carries the axis', () => {
  const catalog = testCatalog();
  const out = generateGoogleFontsCss(parseGoogleFontsUrl(`${G}family=Fraunces:opsz,wght@9..144,300..900`)!, catalog);
  assert.equal(out.status, 200);
  assert.match(out.css, /font-weight: 300 900;/);
  assert.match(out.css, /fraunces-latin-opsz-normal\.woff2/);
  const entry = catalog.families.get('fraunces')!;
  assert.equal(pickVariant(entry, ['wght']), 'wght');
  assert.equal(pickVariant(entry, ['opsz', 'wght']), 'opsz');
  assert.equal(pickVariant(entry, ['SOFT', 'WONK', 'opsz', 'wght']), 'full');
});

test('static families serve one file per weight', () => {
  const out = generateGoogleFontsCss(parseGoogleFontsUrl(`${G}family=Poppins:wght@400;800`)!, testCatalog());
  assert.equal(out.status, 200);
  assert.match(out.css, /poppins-latin-400-normal\.woff2/);
  assert.match(out.css, /poppins-latin-800-normal\.woff2/);
});

test('css2 is strict like Google: one impossible selector makes the whole link a 400', () => {
  const out = generateGoogleFontsCss(parseGoogleFontsUrl(`${G}family=Inter:wght@400&family=Anton:wght@700`)!, testCatalog());
  assert.equal(out.status, 400);
  assert.equal(out.css, '');
  assert.equal(out.invalid[0]?.family, 'Anton');
  assert.match(out.invalid[0]?.reason ?? '', /700/);
  // Italic on a family with none, an axis the family lacks, a value off its range.
  for (const bad of ['Oswald:ital,wght@1,400', 'Inter:wdth,wght@100,400', 'Inter:wght@50']) {
    assert.equal(generateGoogleFontsCss(parseGoogleFontsUrl(`${G}family=${bad}`)!, testCatalog()).status, 400, bad);
  }
});

test('the legacy /css API is lenient: unavailable variants are simply dropped', () => {
  const out = generateGoogleFontsCss(parseGoogleFontsUrl('https://fonts.googleapis.com/css?family=Anton:400,700')!, testCatalog());
  assert.equal(out.status, 200);
  assert.match(out.css, /anton-latin-400-normal\.woff2/);
});

test('a family the bundle lacks is left out and reported, the rest still served', () => {
  const out = generateGoogleFontsCss(parseGoogleFontsUrl(`${G}family=Lobster&family=Inter`)!, testCatalog());
  assert.equal(out.status, 200);
  assert.deepEqual(out.notBundled, ['Lobster']);
  assert.deepEqual(out.served, ['Inter']);
});

test('every generated URL is one the catalog will actually serve from disk', () => {
  const catalog = testCatalog();
  for (const family of catalog.manifest.designerFonts) {
    const out = generateGoogleFontsCss(parseGoogleFontsUrl(`${G}family=${encodeURIComponent(family)}`)!, catalog);
    assert.equal(out.status, 200, family);
    const urls = [...out.css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => new URL(m[1] as string));
    assert.ok(urls.length > 0, `${family} produced no faces`);
    for (const u of urls) {
      const file = catalog.resolveFontPath(u.pathname);
      assert.ok(file && fs.existsSync(file), `${family}: ${u.pathname} does not resolve`);
    }
  }
});

test('system-font look-alikes: Impact → Anton, Arial/Helvetica → Arimo, Georgia → Gelasio, Times → Tinos', () => {
  const faces = substituteFaces(testCatalog());
  const byFamily = new Map<string, string[]>();
  for (const f of faces) byFamily.set(f.family, [...(byFamily.get(f.family) ?? []), f.url]);
  assert.ok(byFamily.get('Impact')?.every((u) => u.includes('/anton/')));
  assert.ok(byFamily.get('Arial')?.every((u) => u.includes('/arimo/')));
  assert.ok(byFamily.get('Helvetica')?.every((u) => u.includes('/arimo/')));
  assert.ok(byFamily.get('Georgia')?.every((u) => u.includes('/gelasio/')));
  assert.ok(byFamily.get('Times New Roman')?.every((u) => u.includes('/tinos/')));
  // Arial covers regular and bold and italic.
  const arial = faces.filter((f) => f.family === 'Arial');
  assert.ok(arial.some((f) => f.style === 'italic'));
  assert.ok(arial.some((f) => f.weight === '400 700'));
});
