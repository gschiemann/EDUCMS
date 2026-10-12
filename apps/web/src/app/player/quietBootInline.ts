/**
 * Quiet boot — the FIRST-PAINT half of glass continuity (2026-10-11).
 *
 * The player route is server-rendered with `phase === 'registering'`, so the
 * HTML of EVERY load carries the KioskSplash ("Connecting to your CMS…" on an
 * indigo aurora). On a paired screen that has shown content that splash is
 * exactly the "blue screen" the owner banned: it flashed on every reload —
 * operator Refresh, a system REFRESH_WEB, the error boundary, a canvas
 * change, a native reload.
 *
 * This script runs inline in the player layout, before any chunk and before
 * React hydrates. When the stored credential names a screen that has shown
 * content (`hasShownContentBefore` in glassContinuity.ts — the same rule, in
 * ES5, tested against the same fixtures), it marks `<html>` with
 * `data-edu-quiet-boot`: two layout rules then paint the document black and
 * keep the player root invisible, so the splash in the server HTML is never
 * on the glass. Once React has mounted it renders black itself for every
 * non-content state of a quiet screen and removes the mark. An off-hours
 * update cover (updateCoverInline.ts), when one is pending, still paints the
 * previous frame on top — the cover wins over plain black.
 *
 * An alert is never hidden by this: the emergency surfaces carry
 * `data-edu-emergency-root`, which the layout keeps visible through the mark.
 * An unpaired / first-run screen gets no mark and keeps its splash.
 *
 * ES5 on purpose (Chromium 83 WebViews, CLAUDE.md #10).
 */

import { GLASS_SHOWN_PREFIX, LEGACY_MANIFEST_KEY, MANIFEST_CACHE_PREFIX, MANIFEST_PAIRING_PREFIX } from './offlineBoot';

export const QUIET_BOOT_ATTR = 'data-edu-quiet-boot';
export const DEVICE_TOKEN_KEY = 'edu_device_token';

export const QUIET_BOOT_INLINE_JS =
  "(function(){try{" +
  "if(/[?&]preview=1(&|$)/.test(location.search))return;" +
  "var ls=null;try{ls=window.localStorage;}catch(e){}" +
  "if(!ls)return;" +
  "var tok=null;try{tok=ls.getItem('" + DEVICE_TOKEN_KEY + "');}catch(e){}" +
  "if(!tok)return;" +
  "var parts=String(tok).split('.');if(parts.length!==3)return;" +
  "var raw=parts[1].replace(/-/g,'+').replace(/_/g,'/');while(raw.length%4)raw+='=';" +
  "var p=null;try{p=JSON.parse(atob(raw));}catch(e){return;}" +
  "var U=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;" +
  "if(!p||p.kind!=='device'||typeof p.sub!=='string'||!U.test(p.sub))return;" +
  "var sid=p.sub;" +
  "if(ls.getItem('" + MANIFEST_PAIRING_PREFIX + "'+sid)==='unpaired')return;" +
  "function has(raw){if(!raw)return false;try{var r=JSON.parse(raw);var m=r&&r.m;return !!m&&m.screenId===sid&&Object.prototype.toString.call(m.playlists)==='[object Array]'&&m.playlists.length>0;}catch(e){return false;}}" +
  "var shown=ls.getItem('" + GLASS_SHOWN_PREFIX + "'+sid)==='1'" +
  "||has(ls.getItem('" + MANIFEST_CACHE_PREFIX + "'+sid+':playing'))" +
  "||has(ls.getItem('" + LEGACY_MANIFEST_KEY + "'));" +
  "if(!shown)return;" +
  "document.documentElement.setAttribute('" + QUIET_BOOT_ATTR + "','1');" +
  "}catch(e){}})();";

/** Drop the first-paint mark (React renders the quiet states itself from here). */
export function clearQuietBoot(doc: Document): void {
  try { doc.documentElement.removeAttribute(QUIET_BOOT_ATTR); } catch { /* nothing to clear */ }
}
