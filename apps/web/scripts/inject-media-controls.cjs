// Add the shared media styling/selection companion without replacing any
// existing applyMenu, kiosk engine, carousel, or click-to-edit shim.
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const marker = 'EDUCMS-MEDIA-CONTROLS-V1';
const code = buildSync({ entryPoints: [path.join(__dirname, 'board-media-controls.ts')], bundle: true, minify: true,
  format: 'iife', target: ['chrome83', 'safari12'], write: false }).outputFiles[0].text.trim();
const script = `<script>/*${marker}*/${code}</script>`;
let changed = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(file); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const before = fs.readFileSync(file, 'utf8');
    const clean = before.replace(/<script>\/\*EDUCMS-MEDIA-CONTROLS-V\d+\*\/[\s\S]*?<\/script>\s*/g, '');
    const after = clean.replace(/<\/body>/i, `${script}\n</body>`);
    if (after !== before) { fs.writeFileSync(file, after); changed++; }
  }
}
walk(path.join(__dirname, '../public/templates'));
console.log(`${marker}: updated ${changed} boards`);
