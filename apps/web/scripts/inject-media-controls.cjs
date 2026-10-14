// Add the shared media styling/selection companion without replacing any
// existing applyMenu, kiosk engine, carousel, or click-to-edit shim.
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const marker = 'EDUCMS-MEDIA-CONTROLS-V2';
const code = buildSync({ entryPoints: [path.join(__dirname, 'board-media-controls.ts')], bundle: true, minify: true,
  format: 'iife', target: ['chrome83', 'safari12'], write: false }).outputFiles[0].text.trim();
const script = `<script>/*${marker}*/${code}</script>`;
let changed = 0;
function injectFile(file) {
  const before = fs.readFileSync(file, 'utf8');
  const clean = before.replace(/<script>\/\*EDUCMS-MEDIA-CONTROLS-V\d+\*\/[\s\S]*?<\/script>\s*/g, '');
  const after = clean.replace(/<\/body>/i, `${script}\n</body>`);
  if (after !== before) { fs.writeFileSync(file, after); changed++; }
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(file); continue; }
    if (!entry.name.endsWith('.html')) continue;
    injectFile(file);
  }
}
// Optional paths relative to public/ let a release update only its reviewed
// boards. Validate every path before writing any of them; no arguments keeps
// the established full-library behavior.
const requested = process.argv.slice(2);
if (requested.length) {
  const root = path.resolve(__dirname, '../public');
  const files = requested.map(rel => {
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !file.endsWith('.html') || !fs.statSync(file).isFile())
      throw new Error(`Invalid board path: ${rel}`);
    return file;
  });
  files.forEach(injectFile);
} else {
  walk(path.join(__dirname, '../public/templates'));
  walk(path.join(__dirname, '../public/holiday-templates'));
}
console.log(`${marker}: updated ${changed} boards`);
