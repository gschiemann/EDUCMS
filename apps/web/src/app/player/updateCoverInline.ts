/**
 * The cover frame's FIRST-PAINT half (2026-10-10, off-hours update).
 *
 * When the player applies a new web bundle it captures what is on the glass
 * (`updateCover.ts`) into sessionStorage and navigates. THIS script runs in
 * the next document, inline in the player layout, BEFORE any chunk and
 * before React hydrates: it paints that frame as the document's very first
 * frame so the reload never shows the connecting splash. It holds the frame
 * until the page proves operator content is on the glass
 * (`removeUpdateCover`), or 60 s, whichever is first — a boot that never
 * reaches content must not stay hidden behind a frozen picture.
 *
 * HOW IT PAINTS WITHOUT A DOM NODE. React 19 hydrates `<html>` and `<body>`;
 * a foreign element inserted before hydration is a mismatch risk. The pin
 * script already sets attributes and inline styles on `<html>` pre-hydration
 * (`data-led-narrow`, `style.width`), so the cover does the same: the frame
 * is the `<html>` element's own background, `data-edu-update-cover` marks
 * it, and two layout rules make the body transparent and the player root
 * invisible while the mark is present. Removing the mark reveals the new
 * content underneath in one paint.
 *
 * ES5 on purpose (Chromium 83 WebViews, CLAUDE.md #10) — no arrow functions,
 * no template literals, no optional chaining. Lives in its own module so
 * the layout's inline-script parse test covers the interpolated result and
 * a jsdom test can run the body directly.
 */

export const UPDATE_COVER_KEY = 'edu:update-cover';
export const UPDATE_COVER_ATTR = 'data-edu-update-cover';
/** Hard cap on how long the cover may hold without content underneath. */
export const UPDATE_COVER_MAX_HOLD_MS = 60_000;
/** A record older than this is stale (a crash, a manual reload hours later). */
export const UPDATE_COVER_MAX_AGE_MS = 120_000;

export const UPDATE_COVER_INLINE_JS =
  "(function(){try{" +
  "var KEY='" + UPDATE_COVER_KEY + "',ATTR='" + UPDATE_COVER_ATTR + "';" +
  "var raw=null;try{raw=sessionStorage.getItem(KEY);}catch(e){}" +
  "if(!raw)return;" +
  "var rec=null;try{rec=JSON.parse(raw);}catch(e){}" +
  "if(!rec||rec.v!==1||typeof rec.navigatedAtMs!=='number'){try{sessionStorage.removeItem(KEY);}catch(e){}return;}" +
  "var now=Date.now();" +
  "if(now-rec.navigatedAtMs>" + UPDATE_COVER_MAX_AGE_MS + "||now<rec.navigatedAtMs-" + UPDATE_COVER_MAX_AGE_MS + "){try{sessionStorage.removeItem(KEY);}catch(e){}return;}" +
  "var html=document.documentElement;" +
  "var color=(typeof rec.color==='string'&&/^#[0-9a-fA-F]{3,8}$/.test(rec.color))?rec.color:'#000';" +
  "html.style.backgroundColor=color;" +
  "if(rec.kind==='image'&&typeof rec.data==='string'&&rec.data.indexOf('data:image/')===0){" +
  "html.style.backgroundImage='url(\"'+rec.data+'\")';" +
  "html.style.backgroundRepeat='no-repeat';" +
  "html.style.backgroundSize='100% 100%';" +
  "html.style.backgroundPosition='0 0';" +
  "}" +
  "html.setAttribute(ATTR,rec.kind==='image'&&rec.data?'image':'color');" +
  "rec.coverAtMs=now;" +
  "try{sessionStorage.setItem(KEY,JSON.stringify(rec));}catch(e){}" +
  "function clear(){try{html.removeAttribute(ATTR);html.style.backgroundImage='';html.style.backgroundColor='';html.style.backgroundRepeat='';html.style.backgroundSize='';html.style.backgroundPosition='';}catch(e){}}" +
  "window.__eduUpdateCover={record:rec,clear:clear};" +
  "setTimeout(function(){if(html.getAttribute(ATTR))clear();}," + UPDATE_COVER_MAX_HOLD_MS + ");" +
  "}catch(e){}})();";
