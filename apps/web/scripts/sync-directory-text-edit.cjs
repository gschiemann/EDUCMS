#!/usr/bin/env node
// Idempotent: every directory (including private documents using these URLs)
// receives the same shared native text editor and standard style transport.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '../../..');
const folder = path.join(root, 'apps/web/public/templates/signage/corporate/directory');
const source = buildSync({ entryPoints: [path.join(__dirname, 'directory-text-edit.ts')], bundle: true, minify: true, target: 'chrome83', format: 'iife', write: false }).outputFiles[0].text;
const script = '<script>/*EDUCMS-DIRECTORY-TEXT-V1*/' + source + '</script>';
const marker = /<script>\/\*EDUCMS-DIRECTORY-TEXT-V1\*\/[\s\S]*?<\/script>/g;
const changed = new Map();
for (const name of fs.readdirSync(folder).filter(name => name.endsWith('.html') && !name.startsWith('_'))) {
  const file = path.join(folder, name);
  const original = fs.readFileSync(file, 'utf8');
  const next = original.replace(marker, '').replace('</body>', script + '</body>');
  if (next === original) continue;
  fs.writeFileSync(file, next);
  changed.set('/templates/signage/corporate/directory/' + name, 'sha256-' + createHash('sha256').update(next).digest('base64'));
}
const manifestPath = path.join(root, 'docs/templates/corporate-directory-touch-install-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath));
for (const item of [...manifest.assets, ...manifest.records]) if (changed.has(item.url)) item.sha256 = changed.get(item.url);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Updated ${changed.size} directories with shared text editing; customer records unchanged.`);
