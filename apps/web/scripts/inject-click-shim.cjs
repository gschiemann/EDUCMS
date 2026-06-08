#!/usr/bin/env node
/**
 * Inject the STANDALONE click-to-edit shim (EDUCMS-CLICK-V1).
 *
 * WHY a second, additive shim (separate from inject-shim-v2.cjs):
 *
 *   The click-to-edit "hot zones" (click a board element → the
 *   PropertiesPanel jumps to that field's editor) are INDEPENDENT of the
 *   override-APPLY logic (brand / text / image / live-menu). Most static
 *   boards carry an apply shim from inject-shim-v2.cjs (now V5, which
 *   already bundles click-to-edit) — but the QSR / menus-pos / bar MENU
 *   boards carry a DIFFERENT, hand-crafted V5 shim whose `applyMenu()`
 *   overlays live per-location POS prices + auto-86 onto the board. That
 *   menu shim is load-bearing for the live Domino's / restaurant pilot and
 *   must NOT be clobbered. It just never grew click-to-edit.
 *
 *   This shim is purely ADDITIVE: it only reads the DOM + posts messages
 *   (`educms-ready`, `educms-field-click`) and listens for
 *   `educms-edit-mode`. It touches no content, no styles, no apply logic —
 *   so it drops onto a menu board (or any board) alongside whatever apply
 *   shim is already there, with zero risk to rendering.
 *
 *   Idempotent + targeted: it SKIPS files that already report clicks
 *   (inject-shim-v2 V5 boards, the external kiosk `_edit-shim.js` boards,
 *   the hand-crafted Domino's board) and files with no editable
 *   `[data-field]` at all. So running it over the whole tree only lands on
 *   the boards that are genuinely missing hot-zones.
 *
 * Protocol (matches PropertiesPanel's EXTERNAL_HTML handler exactly):
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
const MARKER = 'EDUCMS-CLICK-V1';

const SHIM = `<script>/*${MARKER}*/(function(){try{
var editMode=false;
function armEdit(){document.querySelectorAll('[data-field],[data-imgslot],[data-img],[data-slot],[data-action]').forEach(function(el){if(el.__veArmed)return;if(el.closest&&el.closest('#venueos-fields'))return;el.__veArmed=true;el.style.cursor='pointer';var isAct=el.hasAttribute('data-action');el.addEventListener('mouseenter',function(){el.style.outline='2px dashed '+(isAct?'#f59e0b':'#06b6d4');el.style.outlineOffset='2px';});el.addEventListener('mouseleave',function(){el.style.outline='';});el.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();var key=el.getAttribute('data-action')||el.getAttribute('data-field')||el.getAttribute('data-imgslot')||el.getAttribute('data-slot')||el.getAttribute('data-img')||'';var kind=el.hasAttribute('data-action')?'action':(el.hasAttribute('data-field')?'text':'img');try{parent.postMessage({type:'educms-field-click',key:key,kind:kind},'*');}catch(_){}},true);});}
function ready(){try{parent.postMessage({type:'educms-ready'},'*');}catch(_){}}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',ready);}else{ready();}
addEventListener('message',function(e){try{var d=e.data;if(!d||typeof d!=='object')return;if(d.type==='educms-edit-mode'){editMode=!!d.on;if(editMode)armEdit();}}catch(_){}});
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

  // Already has standalone click shim → idempotent skip.
  if (html.includes(MARKER)) { skipped++; continue; }
  // Already reports clicks (inject-shim-v2 V5, hand-crafted Domino's V5, or
  // any other shim that posts educms-field-click) → don't double-arm.
  if (html.includes('educms-field-click')) { skipped++; continue; }
  // External kiosk shim already provides click-to-edit (+ engine hook).
  if (/src=["'][^"']*_edit-shim\.js/.test(html)) { skipped++; continue; }
  // No editable fields → nothing to arm.
  if (!/data-field=/.test(html)) { skipped++; continue; }

  const idx = html.search(/<\/head>/i);
  if (idx === -1) { console.warn('no </head> in ' + path.relative(ROOT, file) + ' — skipped'); skipped++; continue; }
  html = html.slice(0, idx) + SHIM + '\n' + html.slice(idx);
  fs.writeFileSync(file, html);
  injected++;
}
console.log(`click-shim ${MARKER}: injected ${injected}, skipped ${skipped} (of ${files.length} templates)`);
