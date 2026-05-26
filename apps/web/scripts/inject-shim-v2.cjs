#!/usr/bin/env node
/**
 * Inject the EduCMS V2 rebrand+text-overrides shim.
 *
 * Successor to `inject-brand-shim.cjs` (which only handled colors).
 * V2 adds editable-text overrides for the 80 self-contained signage /
 * HS templates. The EXTERNAL_HTML widget appends THREE query params
 * (each base64-url-encoded JSON):
 *   - `brand`       CSS custom property overrides (background / text /
 *                   primary / accent / font slots)
 *   - `text`        per-data-field text overrides
 *                   { "i.0.0.n": "Carolina oysters" }
 *   - `textStyles`  per-data-field inline-style overrides
 *                   { "i.0.0.n": { color: "#fff", fontSize: 56,
 *                                  fontWeight: 700, fontStyle: "italic",
 *                                  textDecoration: "underline",
 *                                  fontFamily: "Georgia, serif",
 *                                  textAlign: "right" } }
 *
 * The shim is per-file (not a shared script) because templates are
 * self-contained — no external imports — and the iframe is sandboxed
 * without same-origin, so a shared asset isn't reachable cleanly.
 *
 * Why a numbered marker: this script runs every time a template
 * changes. The marker carries a version (`EDUCMS-SHIM-V2`) so older
 * shims (`EDUCMS-BRAND-SHIM` V1) are removed and replaced. Without
 * version-aware replacement, the original brand-only shim would block
 * the new text/textStyles overrides.
 *
 * Idempotent — re-running with the SAME version skips already-shimmed
 * files.
 *
 * Usage:  node apps/web/scripts/inject-shim-v2.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../public/templates');
const MARKER = 'EDUCMS-SHIM-V2';
const OLD_MARKERS = ['EDUCMS-BRAND-SHIM']; // legacy markers to remove

// Inline runtime — minified, runs at end of <head> before first paint.
// Reads `brand`, `text`, `textStyles` from URL params; applies brand to
// :root CSS vars, then walks `[data-field]` elements post-load and
// applies textContent / inline-style overrides. Re-runs on postMessage
// `{type:'educms-overrides',...}` for parent-driven instant updates.
const SHIM = `<script>/*${MARKER}*/(function(){try{
function dec(p){if(!p)return null;try{var j=decodeURIComponent(Array.prototype.map.call(atob(p.replace(/-/g,'+').replace(/_/g,'/')),function(c){return '%'+('00'+c.charCodeAt(0).toString(16)).slice(-2);}).join(''));return JSON.parse(j);}catch(e){return null;}}
function readParams(){var q=new URLSearchParams(location.search);return{brand:dec(q.get('brand'))||{},text:dec(q.get('text'))||{},styles:dec(q.get('textStyles'))||{}};}
var BRAND_MAP={background:['--bg','--brand-canvas','--brand-bg','--surface-canvas'],surface:['--paper','--brand-paper','--surface'],
text:['--ink','--fg','--brand-ink','--brand-fg','--text'],muted:['--mute','--brand-mute','--text-muted'],
primary:['--primary','--brand-primary','--color-primary'],accent:['--accent','--brand-accent','--brand-gold','--gold','--color-accent'],
fontDisplay:['--font-display','--font-headline'],fontBody:['--font-grotesk','--font-body','--font-sans'],fontCondensed:['--font-condensed','--font-numeric']};
function applyBrand(b){var r=document.documentElement.style;Object.keys(BRAND_MAP).forEach(function(k){if(b[k])BRAND_MAP[k].forEach(function(v){r.setProperty(v,b[k]);});});}
function applyTextAndStyles(text,styles){var keys={};Object.keys(text||{}).forEach(function(k){keys[k]=1;});Object.keys(styles||{}).forEach(function(k){keys[k]=1;});Object.keys(keys).forEach(function(k){var nodes=document.querySelectorAll('[data-field="'+k.replace(/"/g,'\\\\"')+'"]');for(var i=0;i<nodes.length;i++){var el=nodes[i];if(text&&typeof text[k]==='string'){if(el.children.length===0){el.textContent=text[k];}else{var tn=null;for(var j=0;j<el.childNodes.length;j++){if(el.childNodes[j].nodeType===3){tn=el.childNodes[j];break;}}if(tn){tn.textContent=text[k];}else{el.insertBefore(document.createTextNode(text[k]),el.firstChild);}}}var s=styles&&styles[k];if(s){if(s.color)el.style.color=s.color;if(s.fontSize!=null)el.style.fontSize=(typeof s.fontSize==='number'?s.fontSize+'px':s.fontSize);if(s.fontWeight!=null)el.style.fontWeight=String(s.fontWeight);if(s.fontStyle)el.style.fontStyle=s.fontStyle;if(s.fontFamily)el.style.fontFamily=s.fontFamily;if(s.textDecoration)el.style.textDecoration=s.textDecoration;if(s.textAlign)el.style.textAlign=s.textAlign;if(s.backgroundColor)el.style.backgroundColor=s.backgroundColor;if(s.lineHeight!=null)el.style.lineHeight=String(s.lineHeight);}}});}
function applyAll(){var p=readParams();applyBrand(p.brand);applyTextAndStyles(p.text,p.styles);}
applyBrand(readParams().brand);
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',applyAll);}else{applyAll();}
addEventListener('message',function(e){try{var d=e.data;if(d&&d.type==='educms-overrides'){if(d.brand)applyBrand(d.brand);applyTextAndStyles(d.text||{},d.textStyles||{});}}catch(_){}});
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

// Remove a legacy shim block (matches by marker) so we can replace it.
function removeLegacyShim(html, marker) {
  const re = new RegExp(
    `<script>\\s*/\\*${marker}\\*/[\\s\\S]*?</script>\\s*`,
    'g',
  );
  return html.replace(re, '');
}

const files = walk(ROOT);
let injected = 0, replaced = 0, skipped = 0;
for (const file of files) {
  let html = fs.readFileSync(file, 'utf8');

  if (html.includes(MARKER)) {
    skipped++;
    continue;
  }

  let hadOld = false;
  for (const old of OLD_MARKERS) {
    if (html.includes(old)) {
      html = removeLegacyShim(html, old);
      hadOld = true;
    }
  }

  const idx = html.search(/<\/head>/i);
  if (idx === -1) {
    console.warn('no </head> in ' + path.relative(ROOT, file) + ' — skipped');
    skipped++;
    continue;
  }
  html = html.slice(0, idx) + SHIM + '\n' + html.slice(idx);
  fs.writeFileSync(file, html);
  if (hadOld) replaced++; else injected++;
}
console.log(`shim ${MARKER}: injected ${injected}, replaced ${replaced} legacy, skipped ${skipped} up-to-date (of ${files.length} templates)`);
