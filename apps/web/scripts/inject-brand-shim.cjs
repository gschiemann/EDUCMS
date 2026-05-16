#!/usr/bin/env node
/**
 * Inject the EduCMS rebrand shim into every signage / HS template.
 *
 * The 78 templates are self-contained HTML rendered in a sandboxed
 * iframe by the EXTERNAL_HTML widget. To make them adaptable to any
 * customer's brand, the EXTERNAL_HTML widget appends a `?brand=` query
 * param (base64-encoded JSON) to the iframe URL. This shim, injected
 * into each template's <head>, reads that param on load and overrides
 * the template's CSS custom properties — background, surface, text,
 * primary, accent, and the three font slots.
 *
 * Why a shim per file instead of one shared script: the templates are
 * self-contained (no external imports — a hard rule of the pack), and
 * the iframe is sandboxed without same-origin, so it can't reach a
 * shared asset cleanly. A ~30-line inline shim keeps "self-contained"
 * true.
 *
 * Why it sets MULTIPLE css-var aliases per semantic key: the pack was
 * built in two passes with two token-naming schemes — qsr/hospitality
 * use `--brand-primary` etc., bar/corporate/fashion/healthcare use
 * bare `--primary`. The shim sets every known alias for each semantic
 * control, so one brand panel rebrands all 78 regardless of scheme.
 *
 * Idempotent — re-running skips files that already carry the shim
 * (matched by the EDUCMS-BRAND-SHIM marker). Run after any change to
 * the template HTML.
 *
 * Usage:  node apps/web/scripts/inject-brand-shim.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../public/templates');
const MARKER = 'EDUCMS-BRAND-SHIM';

const SHIM = `<script>/*${MARKER}*/(function(){try{
var p=new URLSearchParams(location.search).get('brand');if(!p)return;
var json=decodeURIComponent(Array.prototype.map.call(atob(p.replace(/-/g,'+').replace(/_/g,'/')),function(c){return '%'+('00'+c.charCodeAt(0).toString(16)).slice(-2);}).join(''));
var b=JSON.parse(json),r=document.documentElement.style;
var MAP={background:['--bg','--brand-canvas','--brand-bg'],surface:['--paper','--brand-paper'],
text:['--ink','--fg','--brand-ink','--brand-fg'],muted:['--mute','--brand-mute'],
primary:['--primary','--brand-primary'],accent:['--accent','--brand-accent','--brand-gold','--gold'],
fontDisplay:['--font-display'],fontBody:['--font-grotesk'],fontCondensed:['--font-condensed']};
Object.keys(MAP).forEach(function(k){if(b[k])MAP[k].forEach(function(v){r.setProperty(v,b[k]);});});
}catch(e){}})();</script>`;

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
let injected = 0, skipped = 0;
for (const file of files) {
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes(MARKER)) { skipped++; continue; }
  // Inject right before </head> so it runs before first paint —
  // documentElement always exists during head parsing, so the
  // setProperty overrides land before the template's CSS renders.
  const idx = html.search(/<\/head>/i);
  if (idx === -1) {
    console.warn('no </head> in ' + path.relative(ROOT, file) + ' — skipped');
    skipped++;
    continue;
  }
  html = html.slice(0, idx) + SHIM + '\n' + html.slice(idx);
  fs.writeFileSync(file, html);
  injected++;
}
console.log(`brand shim: injected ${injected}, skipped ${skipped} (of ${files.length} templates)`);
