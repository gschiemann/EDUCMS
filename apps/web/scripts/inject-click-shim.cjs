#!/usr/bin/env node
/**
 * Inject the STANDALONE click-to-edit shim (EDUCMS-CLICK-V2) — and, for the
 * boards that already report clicks via a hand-crafted handler, a freeze-only
 * companion (EDUCMS-FREEZE-V1).
 *
 * WHY a second, additive shim (separate from inject-shim-v2.cjs):
 *
 *   The click-to-edit "hot zones" (click a board element → the
 *   PropertiesPanel jumps to that field's editor) are INDEPENDENT of the
 *   override-APPLY logic (brand / text / image / live-menu). Most static
 *   boards carry an apply shim from inject-shim-v2.cjs (now V6, which
 *   already bundles click-to-edit AND gallery freeze) — but the QSR /
 *   menus-pos / bar MENU boards carry a DIFFERENT, hand-crafted V5 shim whose
 *   `applyMenu()` overlays live per-location POS prices + auto-86 onto the
 *   board. That menu shim is load-bearing for the live Domino's / restaurant
 *   pilot and must NOT be clobbered. It just never grew click-to-edit OR
 *   freeze.
 *
 *   These shims are purely ADDITIVE: they only read the DOM, post messages
 *   (`educms-ready`, `educms-field-click`), listen for `educms-edit-mode`,
 *   and (freeze) wrap the timer globals. They touch no content, no styles,
 *   no apply logic — so they drop onto a menu board alongside whatever apply
 *   shim is already there, with zero risk to rendering.
 *
 *   Per-file routing (idempotent + conflict-free):
 *     - file already carries EDUCMS-SHIM-V6 → SKIP (V6 has click + freeze).
 *     - file loads the external kiosk `_edit-shim.js` → SKIP (it has both).
 *     - file has no editable `[data-field]` → SKIP (nothing to arm).
 *     - file ALREADY reports `educms-field-click` from a hand-crafted block
 *       (e.g. the Domino's board's delegated editAtPoint handler), after any
 *       legacy CLICK-V1 is stripped → inject FREEZE-ONLY (EDUCMS-FREEZE-V1);
 *       injecting the full click shim would DOUBLE-report every click.
 *     - otherwise (the 30 menu boards on CLICK-V1) → strip CLICK-V1, inject
 *       the full CLICK-V2 (click-to-edit + freeze).
 *
 * GALLERY FREEZE mode (shared by both shims): when the board URL carries
 * `freeze=1` (the templates GALLERY GRID appends it; the full-screen preview
 * modal / builder / player never do), the shim wraps setInterval / setTimeout /
 * requestAnimationFrame at the very top of its IIFE — installed BEFORE the
 * board's own <body> scripts run, so every timer the board starts (the live
 * clock, auto-fit settle timers, ticker rAF) is recorded — then after a
 * generous settle window (auto-fit done) clears them all and injects
 * `<style>*{animation:none!important;transition:none!important;}`. Near-zero
 * ongoing CPU per off-screen-but-mounted iframe. Strict NO-OP when freeze=1 is
 * absent; undone if the board is later put into edit mode.
 *
 * Click protocol (matches PropertiesPanel's EXTERNAL_HTML handler exactly):
 *   - on load           → postMessage {type:'educms-ready'}  (panel re-arms)
 *   - on edit-mode on   → outline [data-field]/[data-imgslot]/[data-img]/
 *                         [data-slot]/[data-action] on hover; on click post
 *                         {type:'educms-field-click', key, kind}
 *   - never arms unless the panel sends edit-mode, so the LIVE PLAYER stays
 *     fully non-interactive (no outlines, no click interception).
 *
 * Usage:  node apps/web/scripts/inject-click-shim.cjs [subdir]
 */
const fs = require('fs');
const path = require('path');

const SUBDIR = process.argv[2] ? process.argv[2].replace(/^\/+|\/+$/g, '') : '';
const ROOT = path.resolve(__dirname, '../public/templates', SUBDIR);
const MARKER = 'EDUCMS-CLICK-V2';
const FREEZE_MARKER = 'EDUCMS-FREEZE-V1';
// CLICK-V2 = CLICK-V1's additive click-to-edit PLUS gallery freeze. CLICK-V1 is
// removed + replaced. FREEZE-V1 = the same freeze logic with NO click handler,
// for boards whose click-to-edit is already hand-crafted (so we don't double-arm).
const OLD_MARKERS = ['EDUCMS-CLICK-V1'];

// Shared freeze fragment — identical to inject-shim-v2 V6's freeze block.
// Declares FROZEN + _frzStyle + _unfreeze, then installs the timer-recording
// wrappers (NO-OP unless freeze=1) and schedules the one-shot freezeNow().
const FREEZE_FRAG = `var FROZEN=(function(){try{return new URLSearchParams(location.search).get('freeze')==='1';}catch(e){return false;}})();
var _frzStyle=null;
function _unfreeze(){if(_frzStyle){try{if(_frzStyle.parentNode)_frzStyle.parentNode.removeChild(_frzStyle);}catch(e){}_frzStyle=null;}}
(function(){if(!FROZEN)return;var ivs=[],tos=[],rafs=[];var _si=window.setInterval,_st=window.setTimeout,_raf=window.requestAnimationFrame;
window.setInterval=function(){var id=_si.apply(window,arguments);try{ivs.push(id);}catch(e){}return id;};
window.setTimeout=function(){var id=_st.apply(window,arguments);try{tos.push(id);}catch(e){}return id;};
if(_raf)window.requestAnimationFrame=function(cb){var id=_raf.call(window,cb);try{rafs.push(id);}catch(e){}return id;};
function freezeNow(){window.setInterval=_si;window.setTimeout=_st;if(_raf)window.requestAnimationFrame=_raf;try{for(var i=0;i<ivs.length;i++)clearInterval(ivs[i]);}catch(e){}try{for(var j=0;j<tos.length;j++)clearTimeout(tos[j]);}catch(e){}try{if(_raf)for(var k=0;k<rafs.length;k++)cancelAnimationFrame(rafs[k]);}catch(e){}try{var hi=_st(function(){},0);if(typeof hi==='number'&&hi>0){var lo=hi>100000?hi-100000:0;for(var z=hi;z>lo;z--){clearTimeout(z);clearInterval(z);}}}catch(e){}if(!_frzStyle){try{_frzStyle=document.createElement('style');_frzStyle.setAttribute('data-educms-freeze','1');_frzStyle.appendChild(document.createTextNode('*{animation:none!important;transition:none!important;}'));(document.head||document.documentElement).appendChild(_frzStyle);}catch(e){}}}
_st(freezeNow,1400);window.__educmsFreezeNow=freezeNow;}());`;

// Full click-to-edit + freeze shim (the 30 menu boards lacking any click).
const SHIM = `<script>/*${MARKER}*/(function(){try{
var editMode=false;
${FREEZE_FRAG}
function armEdit(){document.querySelectorAll('[data-field],[data-imgslot],[data-img],[data-slot],[data-action]').forEach(function(el){if(el.__veArmed)return;if(el.closest&&el.closest('#venueos-fields'))return;el.__veArmed=true;el.style.cursor='pointer';var isAct=el.hasAttribute('data-action');el.addEventListener('mouseenter',function(){el.style.outline='2px dashed '+(isAct?'#f59e0b':'#06b6d4');el.style.outlineOffset='2px';});el.addEventListener('mouseleave',function(){el.style.outline='';});el.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();var key=el.getAttribute('data-action')||el.getAttribute('data-field')||el.getAttribute('data-imgslot')||el.getAttribute('data-slot')||el.getAttribute('data-img')||'';var kind=el.hasAttribute('data-action')?'action':(el.hasAttribute('data-field')?'text':'img');try{parent.postMessage({type:'educms-field-click',key:key,kind:kind},'*');}catch(_){}},true);});}
function ready(){try{parent.postMessage({type:'educms-ready'},'*');}catch(_){}}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',ready);}else{ready();}
addEventListener('message',function(e){try{var d=e.data;if(!d||typeof d!=='object')return;if(d.type==='educms-edit-mode'){editMode=!!d.on;if(editMode){_unfreeze();armEdit();}}}catch(_){}});
}catch(e){}})();</script>`;

// Freeze-ONLY shim (no click handler) — for boards whose click-to-edit is
// already hand-crafted (the Domino's delegated editAtPoint handler). Adds the
// SAME freeze behaviour without a second click reporter. It still listens for
// educms-edit-mode purely to UN-freeze if the operator opens the board for edit.
const FREEZE_SHIM = `<script>/*${FREEZE_MARKER}*/(function(){try{
${FREEZE_FRAG}
addEventListener('message',function(e){try{var d=e.data;if(!d||typeof d!=='object')return;if(d.type==='educms-edit-mode'&&d.on){_unfreeze();}}catch(_){}});
}catch(e){}})();</script>`;

// Remove a legacy click-shim block (matches by marker) so we can replace it.
function removeLegacyShim(html, marker) {
  const re = new RegExp(`<script>\\s*/\\*${marker}\\*/[\\s\\S]*?</script>\\s*`, 'g');
  return html.replace(re, '');
}

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
let injectedClick = 0, injectedFreeze = 0, skipped = 0;
for (const file of files) {
  let html = fs.readFileSync(file, 'utf8');

  // Idempotent: already carries one of OUR up-to-date shims → SKIP.
  if (html.includes(MARKER) || html.includes(FREEZE_MARKER)) { skipped++; continue; }
  // inject-shim-v2 V6 already bundles click-to-edit AND freeze → SKIP.
  if (html.includes('EDUCMS-SHIM-V6')) { skipped++; continue; }
  // External kiosk shim already provides click-to-edit + freeze (+ engine hook).
  if (/src=["'][^"']*_edit-shim\.js/.test(html)) { skipped++; continue; }
  // No editable fields → nothing to arm / no point freezing a static doc here.
  if (!/data-field=/.test(html)) { skipped++; continue; }

  // Strip our legacy CLICK-V1 (it lacked freeze) so we can re-inject CLICK-V2.
  for (const old of OLD_MARKERS) {
    if (html.includes(old)) html = removeLegacyShim(html, old);
  }

  const idx = html.search(/<\/head>/i);
  if (idx === -1) { console.warn('no </head> in ' + path.relative(ROOT, file) + ' — skipped'); skipped++; continue; }

  // After stripping CLICK-V1: does a HAND-CRAFTED click reporter remain
  // (e.g. the Domino's board's delegated editAtPoint handler)? If so, inject
  // FREEZE-ONLY — a second full click shim would double-report every click.
  // Otherwise inject the full click shim (click-to-edit + freeze).
  if (html.includes('educms-field-click')) {
    html = html.slice(0, idx) + FREEZE_SHIM + '\n' + html.slice(idx);
    fs.writeFileSync(file, html);
    injectedFreeze++;
    continue;
  }
  html = html.slice(0, idx) + SHIM + '\n' + html.slice(idx);
  fs.writeFileSync(file, html);
  injectedClick++;
}
console.log(`click-shim: injected ${injectedClick} click(${MARKER}) + ${injectedFreeze} freeze-only(${FREEZE_MARKER}), skipped ${skipped} (of ${files.length} templates)`);
