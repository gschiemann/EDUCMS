#!/usr/bin/env node
/**
 * Inject the EduCMS V3 rebrand+text+image-overrides shim.
 *
 * Successor to `inject-brand-shim.cjs` (V1, colors only) and the V2
 * shim (added editable text). V3 adds per-image-slot overrides for the
 * 80 self-contained signage / HS templates. The EXTERNAL_HTML widget
 * appends query params (each base64-url-encoded JSON):
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
 *   - `img`         per-image-slot URL overrides (G3, §19). Keyed by the
 *                   slot's `data-img` (preferred) OR `data-slot` value
 *                   (the existing `data-widget="image-slot"` convention).
 *                   { "hero": "https://cdn/…/photo.jpg" }. Applied as
 *                   background-image on the slot div (and `src` if the
 *                   slot is itself an <img>), and sets
 *                   `data-has-image="true"` so the slot's empty-state
 *                   placeholder hides (templates already gate `.ph` /
 *                   `.ph-empty` on that attribute).
 *
 * The shim is per-file (not a shared script) because templates are
 * self-contained — no external imports — and the iframe is sandboxed
 * without same-origin, so a shared asset isn't reachable cleanly.
 *
 * Why a numbered marker: this script runs every time a template
 * changes. The marker carries a version (`EDUCMS-SHIM-V3`) so older
 * shims (V2 text-only, V1 brand-only) are removed and replaced. Without
 * version-aware replacement, the older shim would block the new image
 * overrides (it never read the `img` param).
 *
 * Idempotent — re-running with the SAME version skips already-shimmed
 * files.
 *
 * Usage:  node apps/web/scripts/inject-shim-v2.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../public/templates');
const MARKER = 'EDUCMS-SHIM-V3';
const OLD_MARKERS = ['EDUCMS-SHIM-V2', 'EDUCMS-BRAND-SHIM']; // legacy markers to remove

// Inline runtime — minified, runs at end of <head> before first paint.
// Reads `brand`, `text`, `textStyles`, `img` from URL params; applies
// brand to :root CSS vars, then walks `[data-field]` elements post-load
// and applies textContent / inline-style overrides, and walks
// `[data-img]` / `[data-slot]` image slots applying the URL override as
// background-image (or src for an <img>). Re-runs on postMessage
// `{type:'educms-overrides',...}` for parent-driven instant updates.
//
// applyImages: for each key in `img`, find the slot element by
// `data-img="<key>"` first (forward-compat), else `data-slot="<key>"`
// (the shipped `data-widget="image-slot"` convention). If the slot is an
// <img> set its `src`; otherwise set `background-image: url(...)` plus
// `background-size:cover` / `background-position:center`, and stamp
// `data-has-image="true"` so the template's own empty-state placeholder
// (gated on that attribute) hides. CSS url() value is sanitised by
// stripping quotes/parens/whitespace so a hostile URL can't break out of
// the url() context.
const SHIM = `<script>/*${MARKER}*/(function(){try{
function dec(p){if(!p)return null;try{var j=decodeURIComponent(Array.prototype.map.call(atob(p.replace(/-/g,'+').replace(/_/g,'/')),function(c){return '%'+('00'+c.charCodeAt(0).toString(16)).slice(-2);}).join(''));return JSON.parse(j);}catch(e){return null;}}
function readParams(){var q=new URLSearchParams(location.search);return{brand:dec(q.get('brand'))||{},text:dec(q.get('text'))||{},styles:dec(q.get('textStyles'))||{},img:dec(q.get('img'))||{}};}
var BRAND_MAP={background:['--bg','--brand-canvas','--brand-bg','--surface-canvas'],surface:['--paper','--brand-paper','--surface'],
text:['--ink','--fg','--brand-ink','--brand-fg','--text'],muted:['--mute','--brand-mute','--text-muted'],
primary:['--primary','--brand-primary','--color-primary'],accent:['--accent','--brand-accent','--brand-gold','--gold','--color-accent'],
fontDisplay:['--font-display','--font-headline'],fontBody:['--font-grotesk','--font-body','--font-sans'],fontCondensed:['--font-condensed','--font-numeric']};
function applyBrand(b){var r=document.documentElement.style;Object.keys(BRAND_MAP).forEach(function(k){if(b[k])BRAND_MAP[k].forEach(function(v){r.setProperty(v,b[k]);});});}
function applyTextAndStyles(text,styles){var keys={};Object.keys(text||{}).forEach(function(k){keys[k]=1;});Object.keys(styles||{}).forEach(function(k){keys[k]=1;});Object.keys(keys).forEach(function(k){var nodes=document.querySelectorAll('[data-field="'+k.replace(/"/g,'\\\\"')+'"]');for(var i=0;i<nodes.length;i++){var el=nodes[i];if(text&&typeof text[k]==='string'){if(el.children.length===0){el.textContent=text[k];}else{var tn=null;for(var j=0;j<el.childNodes.length;j++){if(el.childNodes[j].nodeType===3){tn=el.childNodes[j];break;}}if(tn){tn.textContent=text[k];}else{el.insertBefore(document.createTextNode(text[k]),el.firstChild);}}}var s=styles&&styles[k];if(s){if(s.color)el.style.color=s.color;if(s.fontSize!=null)el.style.fontSize=(typeof s.fontSize==='number'?s.fontSize+'px':s.fontSize);if(s.fontWeight!=null)el.style.fontWeight=String(s.fontWeight);if(s.fontStyle)el.style.fontStyle=s.fontStyle;if(s.fontFamily)el.style.fontFamily=s.fontFamily;if(s.textDecoration)el.style.textDecoration=s.textDecoration;if(s.textAlign)el.style.textAlign=s.textAlign;if(s.backgroundColor)el.style.backgroundColor=s.backgroundColor;if(s.lineHeight!=null)el.style.lineHeight=String(s.lineHeight);}}});}
function applyImages(img){if(!img)return;Object.keys(img).forEach(function(k){var v=img[k];if(typeof v!=='string'||!v)return;var esc=k.replace(/"/g,'\\\\"');var el=document.querySelector('[data-img="'+esc+'"]')||document.querySelector('[data-slot="'+esc+'"]');if(!el)return;var safe=v.replace(/["'()\\s]/g,'');if(!safe)return;if(el.tagName==='IMG'){el.setAttribute('src',safe);}else{el.style.backgroundImage="url('"+safe+"')";el.style.backgroundSize='cover';el.style.backgroundPosition='center';}el.setAttribute('data-has-image','true');});}
function applyAll(){var p=readParams();applyBrand(p.brand);applyTextAndStyles(p.text,p.styles);applyImages(p.img);}
applyBrand(readParams().brand);
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',applyAll);}else{applyAll();}
addEventListener('message',function(e){try{var d=e.data;if(d&&d.type==='educms-overrides'){if(d.brand)applyBrand(d.brand);applyTextAndStyles(d.text||{},d.textStyles||{});applyImages(d.img||{});}}catch(_){}});
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
