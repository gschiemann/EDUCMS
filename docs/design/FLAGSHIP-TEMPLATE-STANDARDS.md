# Flagship Signage Templates — Standards & Editability Contract

This is the binding spec for every signage template we redesign (and every new one).
**Read this before building or committing any template.**

## 1. EVERYTHING is swappable — non-negotiable
Every template must let the school replace anything we designed specifically for it:

- **Every logo / seal / crest / mark** → an image slot. The default (initials, a glyph)
  is only a placeholder.
- **Every photo / hero / dish / product / portrait / background image** → an image slot.
- **Every color, every font, the overall size scale** → CMS-editable theme tokens.
- **Every piece of copy** → a `data-field`.

If we designed something specific to the template's theme, the school must be able to
swap it out. No exceptions, this template set or future ones.

**Person-features ALWAYS get a photo upload slot.** Any athlete-of-the-week, teacher/staff
spotlight, student spotlight, senior spotlight, or "person of the week" feature must have a
`data-imgslot` so the school can drop in that person's photo. A name + text with no photo
slot is a bug.

## 2. How image swapping works (the mechanism)
Any element that can hold an uploaded image carries **`data-imgslot="<key>"`** and a
placeholder child (emoji/glyph/initials). The runtime does:

```js
document.querySelectorAll('[data-imgslot]').forEach(function(el){
  var v = el.getAttribute('data-img') || '';      // CMS sets data-img to the uploaded URL
  if (v){ el.style.backgroundImage = 'url("'+v+'")';
    el.style.backgroundSize='cover'; el.style.backgroundPosition='center'; el.style.backgroundRepeat='no-repeat';
    el.classList.add('has-img'); }
});
```

**Food-image defaults (cafeteria templates):** non-elementary cafeteria boards ship with
real dish photos as the DEFAULT `data-img` on each food slot (so they never look like emoji
toys out of the box). Current defaults hotlink TheMealDB stock photos
(`https://www.themealdb.com/images/media/meals/*.jpg`) — Claude Code should treat these as
placeholders and let schools replace them per item via the slot's `data-img`. Emoji remain
only as the empty-slot fallback and for the Elementary set.

CSS hides the placeholder once an image is present:
```css
.slot.has-img .placeholder { display:none; }   /* emoji/initials vanish */
.slot.has-img::before { display:none; }         /* any decorative spotlight/scrim hides too */
```

**CMS contract:** to fill a slot, set the element's `data-img` attribute to the uploaded
image URL. The placeholder disappears and the image becomes the full-bleed background.
Logos/seals are also `data-imgslot` — set `data-img` to the school's logo and the
initials placeholder is replaced.

> Verified live: setting `data-img` on a slot hides the emoji (`display:none`) and shows
> the photo. This must hold for every slot in every template.

## 3. Theme tokens (color / font / size)
Each template has a hidden `[data-widget="theme"]` block of `data-field`s. Editing any
value updates a CSS variable live (incl. a global `--scale` that resizes ALL text at once).
Expose: every palette color, all font families, and the scale.

## 4. The rest of the flagship bar (recap)
- **Auto-fit text** (`data-fit` / `data-fit="single"`) — on **every editable text block** (not just headlines), so any CMS edit re-fits live. Floor every fit at **50px** (`data-fit-min="50"`) — never shrink below legible; if it won't fit at 50px the box gives, never a clip. Re-fits after webfonts load.
- **20-ft legibility** — **50px HARD MINIMUM** on the 3840 stage for the smallest supporting text (65" TVs viewed ~20 ft away: 4K on a 65" panel ≈ 68px/inch, so 50px ≈ 0.74" cap height ≈ legible at ~20 ft). Body copy **≥60px**, section values / day-names 100px+, heroes far larger — 50 is the FLOOR, not the norm. Never clamp/hide text behind `…` (these are non-touch boards).
- **Portrait + landscape** from one file (auto-detect, or `?o=portrait` / `?o=landscape`).
- **Live data** — clocks, bell schedules, countdowns, rotators from small config blocks.
- **Safe ticker** — the tag block sits above the scroll (z-index) so text can't bleed under it.
  CRITICAL: the ticker bar's background MUST be a **solid, fully-opaque color** — never a
  translucent / `backdrop-filter:blur` / `rgba(...,.4)` fill. On these boards the scrolling
  message will show THROUGH a see-through ticker (and through any colored block behind it),
  which we hit repeatedly. Solid bar, opaque tag, scroll clipped to the bar. Verify nothing
  scrolls visibly under a colored block.
- **Verify before delivery** — zero overflow / no clipping in BOTH orientations.

### Layout gotcha (cost us real time — don't repeat)
If the stage uses a blanket `.stage > * { position: relative }` (common, to lift content
above decorative layers), it **overrides `position:absolute` on decorative children by
specificity** — a full-bleed rainbow arc / aurora / mesh then becomes a giant in-flow flex
child that shoves the layout down and collapses cards to near-zero height. Scope the rule
(`.stage > .wrap`, give decorations a higher-specificity `position:absolute`, or put content
in one positioned wrapper). When a board renders "all blank space with tiny stacked content,"
this is almost always the cause.

## 4a. LIVE SCHEDULE ENGINE — standard for ANY board with a class/bell rotation
Any template that shows a period rotation, bell schedule, "now / next" board, or a
departures-style class list MUST use this shared engine. It reads each item's period time,
finds the current period from the live wall clock, highlights it, auto-fills the status,
and re-drives whenever a school edits a time (so **periods tie to their times**, exactly).
This is **non-negotiable and standard for every new scheduled template.**

**Markup contract** — put these on the items' container:
- `data-schedule` — marks the container
- `data-sched-item="<selector>"` — selector for each period item (e.g. `.row`, `.cell`, `.seg`, `.bed`, `.q`)
- `data-sched-time="<selector>"` — selector for the element holding the visible time inside each item
  (omit if each item carries a `data-time="8:05-8:55"` attribute instead — preferred when the time isn't shown as clean text)
- `data-sched-active="<class>"` — class applied to the live item (e.g. `now`, `live`, `up`, `active`)
- `data-sched-done="<class>"` (optional, default `done`) — class for finished periods
- `data-sched-status="<selector>"` (optional) — element whose text becomes `● Now` / `Up next` / `Starts 8:05` / `Done`
- `data-demo-min="565"` — **preview only**: forces a clock minute so screenshots show a mid-day state.
  **Claude Code: REMOVE `data-demo-min` in production** so it uses the real wall clock.

Each period's time is parsed from the visible text (or `data-time`). Times under 7 are treated
as PM (so `1:30` → 13:30). End time defaults to start + 50 min if only one time is given.

**The engine (paste verbatim, once per template, before `</body>`):**
```html
<script>
/* LIVE SCHEDULE ENGINE — ties each item's highlight to its period time. Standard across all scheduled boards. */
(function(){
  function parseMin(t){if(!t)return null;t=(''+t).replace(/[–—]/g,'-');var m=t.match(/(\d{1,2}):(\d{2})/g);if(!m)return null;function toMin(s){var p=s.split(':'),h=+p[0],mm=+p[1];if(h<7)h+=12;return h*60+mm;}return{start:toMin(m[0]),end:m[1]?toMin(m[1]):toMin(m[0])+50};}
  function fmt(min){var h=Math.floor(min/60),m=min%60;var ap=h>=12?'p':'a';h=h%12;if(h===0)h=12;return h+':'+(m<10?'0':'')+m+ap;}
  function run(){document.querySelectorAll('[data-schedule]').forEach(function(box){
    var itemSel=box.getAttribute('data-sched-item')||'.row',timeSel=box.getAttribute('data-sched-time'),actCls=box.getAttribute('data-sched-active')||'now',doneCls=box.getAttribute('data-sched-done')||'done',statSel=box.getAttribute('data-sched-status');
    var rows=[].slice.call(box.querySelectorAll(itemSel));
    var periods=rows.map(function(r){var dt=r.getAttribute('data-time');if(dt)return parseMin(dt);var t=timeSel?r.querySelector(timeSel):null;return parseMin(t?t.textContent:'');});
    var d=new Date(),nowMin=d.getHours()*60+d.getMinutes();
    var demo=box.getAttribute('data-demo-min');var first=periods.find(function(p){return p;}),last=[].concat(periods).reverse().find(function(p){return p;});
    if(demo!=null&&(!first||nowMin<first.start||(last&&nowMin>=last.end)))nowMin=+demo;
    var curIdx=-1;for(var i=0;i<periods.length;i++){if(periods[i]&&nowMin>=periods[i].start&&nowMin<periods[i].end){curIdx=i;break;}}
    var nextIdx=-1;if(curIdx<0){for(var j=0;j<periods.length;j++){if(periods[j]&&nowMin<periods[j].start){nextIdx=j;break;}}}else{nextIdx=curIdx+1;}
    rows.forEach(function(r,i){var p=periods[i],s=statSel?r.querySelector(statSel):null;r.classList.remove(actCls,doneCls);if(!p){if(s)s.textContent='';return;}
      if(i===curIdx){r.classList.add(actCls);if(s)s.textContent='● Now';}
      else if(nowMin>=p.end){r.classList.add(doneCls);if(s)s.textContent='Done';}
      else if(i===nextIdx){if(s)s.textContent='Up next';}
      else{if(s)s.textContent='Starts '+fmt(p.start);}});
  });}
  run();setInterval(run,30000);
  document.querySelectorAll('[data-schedule]').forEach(function(b){new MutationObserver(run).observe(b,{subtree:true,childList:true,characterData:true,attributes:true});});
})();
</script>
```
Supports multiple `[data-schedule]` containers on one board. Verify by setting `data-demo-min`
to several minutes and confirming the correct item lights and statuses update.

## 4b. LIVE DATES + WEEKDAY HIGHLIGHT — standard for ANY dated / weekly board
Dates, times, and "today" highlights must **default to the local clock/date** and stay
**CMS-overridable**. Standard for every board with a clock, a date, a "week of", or a
Mon–Fri layout.

- **Clocks** — already live via `data-live="clock"` / `"time"` (tick from the wall clock).
- **Dates** — any date element gets a `data-live` hook and auto-fills from today's date:
  - `data-live="today"` → today's date (e.g. `Jun 1`)
  - `data-live="weekof"` → Monday of the current week
  - `data-live="weekdate"` → that card's weekday date this week (cards in Mon→Fri DOM order,
    or tagged with `data-weekday="1..5"`)
- **CMS override** — to pin a custom value, the editor sets `data-pin` on the element; the
  engine then leaves it alone. No `data-pin` = always live.
- **Weekday "today" highlight** — each day item carries `data-weekday="1..5"` (Mon–Fri); the
  current weekday's card gets `.today`. Weekend → no highlight. `data-demo-dow="0..6"` on the
  board forces a weekday for preview/screenshots — **Claude Code: REMOVE `data-demo-dow` in production.**

**The date engine (paste once per dated board, before `</body>`):**
```html
<script>
(function(){
  var DMON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtD(d){return DMON[d.getMonth()]+' '+d.getDate();}
  function mondayOf(d){var x=new Date(d),g=x.getDay();x.setDate(x.getDate()+(g===0?-6:1-g));x.setHours(0,0,0,0);return x;}
  function fillDates(){var wk=document.querySelector('[data-demo-dow],.week'),demo=wk&&wk.getAttribute('data-demo-dow');
    var base=new Date();if(demo!=null){base=mondayOf(base);base.setDate(base.getDate()+((+demo||1)-1));}
    var mon=mondayOf(base);
    document.querySelectorAll('[data-live="weekof"]').forEach(function(el){if(!el.hasAttribute('data-pin'))el.textContent=fmtD(mon);});
    document.querySelectorAll('[data-live="today"]').forEach(function(el){if(!el.hasAttribute('data-pin'))el.textContent=fmtD(base);});
    document.querySelectorAll('[data-weekday]').forEach(function(c){var wd=+c.getAttribute('data-weekday'),dt=new Date(mon);dt.setDate(mon.getDate()+(wd-1));var el=c.querySelector('[data-live="weekdate"]');if(el&&!el.hasAttribute('data-pin'))el.textContent=fmtD(dt);
      c.classList.toggle('today',wd===(demo!=null?+demo:new Date().getDay()));});}
  fillDates();setInterval(fillDates,600000);
})();
</script>
```

## 4c. HOLIDAY / SEASONAL BOARDS (Christmas, Halloween, Valentine's, etc.)
These are celebration boards, NOT cafeteria boards.
- **No food panel.** Do not put a "today's lunch / dish photo" card on a holiday board.
  Use the space for holiday content (spotlight event, countdown, spirit-week, giving drive,
  a fun interactive scene). A photo slot here is for a holiday event/guest photo, not a tray.
- **Fill the canvas — zero dead space.** Holiday boards must feel rich and designed to the
  edges. Big layered headline, animated decor, an illustrated focal scene. If a region reads
  as empty, that's a defect — add real holiday content or grow the art, don't leave a void.
- **Each grade band + holiday gets its OWN concept.** Do not reuse the same top-bar +
  three-cards skeleton across them. Vary the composition (asymmetric splits, vertical glass
  timelines, kinetic typography, cinematic countdowns, illustrated scenes).
- **Elementary holiday = the "rainbow animated" standard.** ES holiday boards follow the
  beloved ES rainbow look: an animated rainbow arc, falling/animated decor (snow, coins,
  ornaments, clovers), an OVERSIZED layered display headline with offset drop-shadows, chunky
  bordered cards with hard offset shadows, and a big ILLUSTRATED focal scene (e.g. a
  candy-cane trail leading to a gift pile / a footprint trail to a pot of gold) — playful,
  saturated, packed, nothing blank. Emoji/illustration are welcome at ES (no real-food rule).

## 5. Image-slot checklist per template (fill in when building)
For each template, list every slot so nothing specific-to-theme is hard-coded:
- [ ] School logo / seal / crest
- [ ] Hero / feature image(s)
- [ ] Every per-item photo (dishes, products, portraits, etc.)
- [ ] Any themed background or decorative imagery
- [ ] Sponsor / partner / mascot marks if present

## 6. Workflow
We DESIGN + VERIFY here (files live as `*-flagship.html`). We do **not** swap production
files. We hand finished templates to Claude Code in batches (≈5) with a REPLACE-MANIFEST,
and Claude Code commits each batch to git for review + rollback.

## 7. BUILD CHECKLIST — every template, every time (Claude Code: do not skip a line)
Design must be identical across the library. Before a template is "done", ALL of these hold:

**Structure & scaling**
- [ ] Fixed `--stage-w`/`--stage-h` (3840×2160 land, 2160×3840 port) wrapped in a letterboxed `.viewport` that scales via `--stage-scale`.
- [ ] Orientation auto-detects AND honors `?o=portrait` / `?o=landscape`; both orientations verified zero-overflow.

**Type & legibility**
- [ ] **50px hard minimum** text on the 3840 stage (65" @ ~20 ft); body copy ≥60px; primary content far larger.
- [ ] NO clipping, NO text hidden behind `…` (these are non-touch boards) — wrap to another row or auto-fit instead.
- [ ] Auto-fit (`data-fit`, floor `data-fit-min="50"`) on **every editable text block** (not just headlines) so any edit re-fits live; never below 50px; re-fits after webfonts load.

**Editability (section 1–3)**
- [ ] Every logo/seal/crest/photo/dish/portrait/background = `data-imgslot` with placeholder + `has-img` hide rule.
- [ ] Every piece of copy = `data-field`.
- [ ] Hidden `[data-widget="theme"]` block exposes every color, every font family, and `--scale`; edits apply live.
- [ ] Cafeteria (non-ES): real dish photos as swappable defaults, and item text MATCHES its photo.

**Live behavior**
- [ ] Live clock(s) tick from the wall clock.
- [ ] Dates default to the local date (`data-live="today"/"weekof"/"weekdate"`), CMS-overridable via `data-pin` — see §4b.
- [ ] Weekday boards auto-highlight today's column (`data-weekday`); `data-demo-dow` for preview only.
- [ ] ANY period/bell/now-next/rotation board uses the **§4a live schedule engine** (periods tie to time; `data-demo-min` for preview only).
- [ ] Countdowns/rotators driven from small config, not hand-set.
- [ ] Ticker tag sits above the scroll (z-index) so text never bleeds under it.

**Brand**
- [ ] One canonical `theme.*` token set (brand, brand2, accent, accent2, ink, bg, pos, neg, fonts, scale) — see BRAND-TOKEN-SCHEMA.md.
- [ ] Re-skinning via tokens visibly changes the whole board.

**Verify before delivery**
- [ ] Zero overflow / no clipping in BOTH orientations (measure `scrollHeight-clientHeight`).
- [ ] Schedule engine lights the correct item at several `data-demo-min` values.

---

> **Provenance:** authored by the design team; canonical copy committed here on 2026-06-06
> as the binding spec the `venueos-template-designer` agent reads before building. Keep this
> file and `BRAND-TOKEN-SCHEMA.md` as the source of truth — update them when the standard
> evolves and the agent automatically stays current.
