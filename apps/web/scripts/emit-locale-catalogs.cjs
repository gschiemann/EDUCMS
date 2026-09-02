#!/usr/bin/env node
/*
 * Emit the NON-default locale catalogs as static JSON under public/locales/.
 *
 * WHY (2026-09-02, bundle-budget gate): es.json and zh.json used to be
 * `import()`-ed, which makes Turbopack compile each catalog into a JS chunk
 * (~130 KB each) that counts against the ratcheted chunk ceiling and is
 * parsed as JavaScript on every switch. Served as plain JSON they are fetched
 * once, cached by the CDN, and cost the JS budget nothing. English stays
 * inlined in the bundle — it is the SSR/first-paint fallback and must never
 * depend on a network round trip.
 *
 * The source of truth stays src/i18n/messages/*.json (the parity guard reads
 * those); this file is a build-time copy. public/locales/ is gitignored.
 */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src', 'i18n', 'messages');
const OUT = path.join(__dirname, '..', 'public', 'locales');
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const locale of ['es', 'zh']) {
  const src = path.join(SRC, `${locale}.json`);
  const parsed = JSON.parse(fs.readFileSync(src, 'utf8')); // validates
  fs.writeFileSync(path.join(OUT, `${locale}.json`), JSON.stringify(parsed));
  n += 1;
}
console.log(`[i18n] emitted ${n} locale catalog(s) → public/locales/`);
