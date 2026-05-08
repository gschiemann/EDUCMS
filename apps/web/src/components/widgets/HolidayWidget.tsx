"use client";

/**
 * HolidayWidget — renders a themed holiday lobby template.
 *
 * Imported from the holiday HTML pack (see scratch/holidays-import +
 * apps/web/public/holiday-templates/*.html). Each template is a
 * full-canvas 3840x2160 designed scene — North Pole workshop for
 * Christmas, haunted lobby for Halloween, etc.
 *
 * Why iframe: each HTML defines its own Google Fonts + CSS classes
 * with generic names (.viewport, .stage, .top, .hd). Rendering them
 * inline inside the dashboard would let those classes leak into the
 * surrounding admin UI and the host's :root vars would fight the
 * --stage-scale variable. An iframe gives perfect CSS isolation, its
 * own font loading, and the auto-scale script (injected at copy time)
 * does the right thing on resize.
 *
 * Variants × grade levels supported:
 *   christmas, easter, halloween, stpatricks, thanksgiving, valentines
 *   × es | ms | hs
 *   = 18 distinct templates.
 *
 * The user said "these need a ton of work but import them" — so this
 * is the import step. They land as system presets in `system-presets.ts`
 * with category=HOLIDAYS so they're discoverable behind the new
 * Holidays sub-filter on /templates.
 */

import { useEffect, useMemo, useRef } from 'react';

export type HolidayVariant =
  | 'christmas'
  | 'easter'
  | 'halloween'
  | 'stpatricks'
  | 'thanksgiving'
  | 'valentines';

export type HolidayGradeLevel = 'es' | 'ms' | 'hs';

export interface HolidayConfig {
  variant?: HolidayVariant;
  gradeLevel?: HolidayGradeLevel;
  /** Force portrait mode — picks the *-portrait.html sibling. */
  portrait?: boolean;
  /**
   * Per-field text overrides keyed by the iframe's data-field
   * attribute. Set by the PropertiesPanel HOLIDAY case; flushed to
   * the iframe via postMessage on every change.
   */
  fields?: Record<string, string>;
}

/**
 * Event the HolidayWidget bridges from the iframe to the editor:
 *   - 'holiday:ready'        — iframe finished loading, here is the
 *                              schema of editable fields
 *   - 'holiday:fieldClicked' — operator clicked a [data-field] inside
 *                              the iframe; canvas should jump to that
 *                              field in the panel
 */
export interface HolidayFieldSchema {
  key: string;
  defaultText: string;
  multiline: boolean;
}

/**
 * The widget posts these CustomEvents on `window` so the
 * PropertiesPanel HOLIDAY case + the canvas click-to-edit flow can
 * react without HolidayWidget being passed an onChange callback.
 *
 *   holiday:fields-loaded — detail = { zoneId, fields: HolidayFieldSchema[] }
 *   template-edit-field   — detail = { zoneId, fieldKey } (canvas standard)
 */

export const HOLIDAY_VARIANTS: Array<{
  key: HolidayVariant;
  label: string;
  emoji: string;
  monthHint: string;
}> = [
  { key: 'halloween',    label: 'Halloween',     emoji: '🎃', monthHint: 'October' },
  { key: 'thanksgiving', label: 'Thanksgiving',  emoji: '🦃', monthHint: 'November' },
  { key: 'christmas',    label: 'Christmas',     emoji: '🎄', monthHint: 'December' },
  { key: 'valentines',   label: "Valentine's Day", emoji: '💝', monthHint: 'February' },
  { key: 'stpatricks',   label: "St. Patrick's", emoji: '☘️', monthHint: 'March' },
  { key: 'easter',       label: 'Easter',        emoji: '🐰', monthHint: 'April' },
];

export const HOLIDAY_GRADE_LEVELS: Array<{ key: HolidayGradeLevel; label: string }> = [
  { key: 'es', label: 'Elementary' },
  { key: 'ms', label: 'Middle School' },
  { key: 'hs', label: 'High School' },
];

export function HolidayWidget({ config }: { config: HolidayConfig }) {
  const variant: HolidayVariant = config.variant || 'christmas';
  const gradeLevel: HolidayGradeLevel = config.gradeLevel || 'es';
  const portrait: boolean = !!config.portrait;
  const fields = config.fields || {};
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Read the zone id from the BuilderZone wrapper that hosts every
  // widget. Avoids threading a zoneId prop through WidgetPreview.
  const getZoneId = (): string | null => {
    const w = wrapperRef.current;
    if (!w) return null;
    const host = w.closest('[data-zone-id]') as HTMLElement | null;
    return host?.getAttribute('data-zone-id') || null;
  };

  // Public path served by Next — copies live in apps/web/public/holiday-templates.
  // Any lint-flagged "iframe with src from variable" worry is addressed by
  // the fact that variant + gradeLevel are constrained to the literal unions
  // above; nothing user-typed flows into the URL. The "-portrait" suffix is
  // also a literal so URL injection isn't possible.
  const src = useMemo(() => {
    const suffix = portrait ? '-portrait' : '';
    return `/holiday-templates/${gradeLevel}-${variant}${suffix}.html`;
  }, [variant, gradeLevel, portrait]);

  // ── Bridge: listen for messages FROM the iframe ─────────────
  // The injected holiday-bridge script posts schema on load + click
  // events when operators tap a data-field hotspot. We surface both
  // as window CustomEvents so PropertiesPanel + canvas listeners
  // pick them up via the same flow they already use for themed widgets.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      // Origin check: same origin only (iframe is served from /public).
      if (e.origin && e.origin !== window.location.origin) return;
      // Make sure the message came from OUR iframe, not some random
      // other one mounted on the page.
      if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return;
      const d: any = e.data;
      if (d.type === 'holiday:ready' && Array.isArray(d.fields)) {
        // Tell anyone listening (PropertiesPanel) about the schema.
        window.dispatchEvent(new CustomEvent('holiday:fields-loaded', {
          detail: { zoneId: getZoneId(), fields: d.fields as HolidayFieldSchema[] },
        }));
        // Re-flush any saved overrides on (re)load so user-typed text
        // persists across iframe reloads.
        const f = config.fields || {};
        Object.entries(f).forEach(([k, v]) => {
          try {
            iframeRef.current?.contentWindow?.postMessage(
              { type: 'holiday:setField', key: k, value: v },
              window.location.origin,
            );
          } catch { /* swallow */ }
        });
      } else if (d.type === 'holiday:fieldClicked' && typeof d.key === 'string') {
        // Same event the themed widgets dispatch — so the canvas
        // click-to-edit flow lands here uniformly. PropertiesPanel
        // tries fieldKey first then sectionKey, so we send both: the
        // section is the prefix before the first dot ('headline' for
        // `headline.kicker`). This way clicking a hotspot whose exact
        // key isn't in the DOM (rare, e.g. legacy data) still scrolls
        // to the section heading.
        const dotIdx = d.key.indexOf('.');
        const sectionKey = dotIdx > 0 ? d.key.slice(0, dotIdx) : d.key;
        window.dispatchEvent(new CustomEvent('template-edit-field', {
          detail: { zoneId: getZoneId(), fieldKey: d.key, sectionKey },
        }));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [config.fields]);

  // ── Push field updates DOWN to the iframe whenever they change.
  // We do this in an effect (not on the iframe element) so even the
  // initial mount with pre-existing overrides flushes once the iframe
  // is up. The bridge ignores unknown keys, so over-posting is fine.
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    Object.entries(fields).forEach(([k, v]) => {
      try {
        win.postMessage(
          { type: 'holiday:setField', key: k, value: String(v ?? '') },
          window.location.origin,
        );
      } catch { /* swallow */ }
    });
  }, [fields]);

  return (
    <div ref={wrapperRef} className="w-full h-full overflow-hidden bg-black">
      <iframe
        ref={iframeRef}
        key={src}                         // force remount on variant change so iframe reloads the new HTML
        src={src}
        title={`${variant} ${gradeLevel} holiday template`}
        className="w-full h-full border-0 block"
        // The HTML is hand-authored by us, served from our own origin.
        // Sandbox keeps it from running cross-origin scripts but allows
        // its own scripts (the bridge) + same-origin styles.
        sandbox="allow-same-origin allow-scripts"
        loading="lazy"
        // No allow=fullscreen / camera / etc — these are decorative scenes.
      />
    </div>
  );
}

/**
 * Static field schema per holiday variant + grade level. Extracted
 * from the [data-field] hotspots in apps/web/public/holiday-templates/*.html.
 *
 * Why static: PropertiesPanel needs the field list synchronously the
 * moment a HOLIDAY zone is selected. The iframe-bridge holiday:ready
 * message has a race — if the iframe loads before the panel mounts
 * its listener, the schema event is gone and the panel sits empty.
 * Hardcoded schema lets the panel render fields immediately and the
 * bridge stays useful only for click-to-scroll and live updates.
 *
 * If you change the [data-field] hotspots in an HTML, regenerate this
 * map: see scratch/regen-holiday-schema.js (one-off node script).
 */
export interface HolidayFieldDef {
  key: string;
  defaultText: string;
  multiline: boolean;
}

/**
 * Look up the static schema for a `${gradeLevel}-${variant}` combo.
 * Returns [] if the combo isn't in the map (defensive — should never
 * happen since the unions are constrained).
 */
export function holidayFieldSchemaFor(
  variant: HolidayVariant,
  gradeLevel: HolidayGradeLevel,
): HolidayFieldDef[] {
  return HOLIDAY_FIELD_SCHEMA[`${gradeLevel}-${variant}`] || [];
}

export const HOLIDAY_FIELD_SCHEMA: Record<string, HolidayFieldDef[]> = {
  "es-halloween": [
    { key: "school.name", defaultText: "Maple Tree", multiline: false },
    { key: "school.sub", defaultText: "~ a spooky welcome ~", multiline: false },
    { key: "clock.label", defaultText: "right now", multiline: false },
    { key: "clock.time", defaultText: "8:42", multiline: false },
    { key: "countdown.label", defaultText: "days till", multiline: false },
    { key: "countdown.value", defaultText: "03", multiline: false },
    { key: "headline.kicker", defaultText: "~ Boooo ~", multiline: false },
    { key: "headline.title", defaultText: "Happy Halloween", multiline: false },
    { key: "headline.sub", defaultText: "Costume parade Friday · 2pm in the gym", multiline: false },
    { key: "costume.k", defaultText: "~ wear today ~", multiline: false },
    { key: "costume.t1", defaultText: "Costume", multiline: false },
    { key: "costume.t2", defaultText: "day", multiline: false },
    { key: "costume.p", defaultText: "No masks that cover faces · no scary weapons · K–2 stay in homeroom · 3–5 to gym", multiline: false },
    { key: "costume.t", defaultText: "all day Friday", multiline: false },
    { key: "parade.t", defaultText: "Parade!", multiline: false },
    { key: "parade.p", defaultText: "Line up by grade · march around the gym · families welcome", multiline: false },
    { key: "parade.t1", defaultText: "Fri 2:00 pm", multiline: false },
    { key: "lunch.k", defaultText: "~ today's lunch ~", multiline: false },
    { key: "lunch.t1", defaultText: "Mummy", multiline: false },
    { key: "lunch.t2", defaultText: "dogs", multiline: false },
    { key: "lunch.p", defaultText: "All-beef hot dog wrapped in pastry · ghost-shaped fries · pumpkin cookie · apple cider", multiline: true },
    { key: "lunch.t", defaultText: "$3.75 · line A", multiline: false },
    { key: "events.hdr", defaultText: "~ spooky week ~", multiline: false },
    { key: "events.day", defaultText: "Mon Oct 28 — Fri Nov 1", multiline: false },
    { key: "events.0.d", defaultText: "Mon", multiline: false },
    { key: "events.0.e1", defaultText: "Pumpkin", multiline: false },
    { key: "events.0.e2", defaultText: "decorating", multiline: false },
    { key: "events.0.w", defaultText: "Art room · 2:30 pm · K–5", multiline: false },
    { key: "events.1.d", defaultText: "Wed", multiline: false },
    { key: "events.1.e1", defaultText: "Story", multiline: false },
    { key: "events.1.e2", defaultText: "night", multiline: false },
    { key: "events.1.w", defaultText: "Library · 6 pm · families", multiline: false },
    { key: "events.2.d", defaultText: "Thu", multiline: false },
    { key: "events.2.e1", defaultText: "Spirit", multiline: false },
    { key: "events.2.e2", defaultText: "orange", multiline: false },
    { key: "events.2.w", defaultText: "Wear orange · all day", multiline: false },
    { key: "events.3.d", defaultText: "Fri", multiline: false },
    { key: "events.3.e1", defaultText: "Costume", multiline: false },
    { key: "events.3.e2", defaultText: "parade", multiline: false },
    { key: "events.3.w", defaultText: "Gym · 2 pm · families welcome", multiline: false },
    { key: "ticker.tag", defaultText: "~ BOO! ~", multiline: false },
    { key: "ticker.message", defaultText: "★ Costume parade Friday at 2 — line up in the gym · families welcome ★ Trick-or-treat in the hallways with your buddy class · 1pm ★ NO MASKS THAT COVER FACES — costume rules in the office ★ Pumpkin cookies in the cafeteria all week ★", multiline: true },
  ],
  "ms-halloween": [
    { key: "school.name", defaultText: "Banner Middle", multiline: false },
    { key: "school.sub", defaultText: "a haunted weekly · vol 03", multiline: false },
    { key: "clock.label", defaultText: "period 03", multiline: false },
    { key: "clock.time", defaultText: "9:42", multiline: false },
    { key: "countdown.label", defaultText: "days till", multiline: false },
    { key: "countdown.value", defaultText: "02", multiline: false },
    { key: "headline.kicker", defaultText: "★ Bears After Dark · costume contest 31st ★", multiline: false },
    { key: "headline.title", defaultText: "Boo.", multiline: false },
    { key: "headline.sub", defaultText: "Dance Friday in the gym 7–10pm · costumes encouraged · no scary masks during school day", multiline: true },
    { key: "contest.k", defaultText: "★ costume contest", multiline: false },
    { key: "contest.t1", defaultText: "Three", multiline: false },
    { key: "contest.t2", defaultText: "categories", multiline: false },
    { key: "contest.p", defaultText: "Best group · Most original · Best DIY. Submit team names in homeroom by Thursday — judging on the dance floor at 8:30.", multiline: true },
    { key: "contest.m1", defaultText: "prize: pizza party", multiline: false },
    { key: "contest.m2", defaultText: "judge: Mr. Park", multiline: false },
    { key: "lunch.k", defaultText: "★ today's lunch", multiline: false },
    { key: "lunch.t1", defaultText: "Mummy", multiline: false },
    { key: "lunch.t2", defaultText: "dogs", multiline: false },
    { key: "lunch.p", defaultText: "All-beef hot dog wrapped in pastry · jack-o-lantern fries · pumpkin chocolate-chip cookie · apple cider · vegan ghost-mac at line C.", multiline: true },
    { key: "lunch.m1", defaultText: "$3.75 · all lines", multiline: false },
    { key: "lunch.m2", defaultText: "veg avail", multiline: false },
    { key: "rules.k", defaultText: "★ costume rules", multiline: false },
    { key: "rules.t", defaultText: "Read me.", multiline: false },
    { key: "rules.p", defaultText: "No masks during school day · no fake weapons · keep it school-appropriate · no full face paint that hides identity.", multiline: true },
    { key: "rules.m1", defaultText: "questions? front office", multiline: false },
    { key: "events.h", defaultText: "★ this week ★", multiline: false },
    { key: "events.day", defaultText: "Mon Oct 28 — Fri Nov 1", multiline: false },
    { key: "events.0.d", defaultText: "Tue", multiline: false },
    { key: "events.0.e1", defaultText: "Pumpkin", multiline: false },
    { key: "events.0.e2", defaultText: "painting", multiline: false },
    { key: "events.0.w", defaultText: "cafeteria · lunch · all grades", multiline: false },
    { key: "events.1.d", defaultText: "Wed", multiline: false },
    { key: "events.1.e1", defaultText: "Spirit", multiline: false },
    { key: "events.1.e2", defaultText: "orange", multiline: false },
    { key: "events.1.w", defaultText: "wear orange · all day", multiline: false },
    { key: "events.2.d", defaultText: "Thu", multiline: false },
    { key: "events.2.e1", defaultText: "Movie", multiline: false },
    { key: "events.2.e2", defaultText: "night", multiline: false },
    { key: "events.2.w", defaultText: "caf · 6pm · Hocus Pocus · $3", multiline: false },
    { key: "events.3.d", defaultText: "Fri", multiline: false },
    { key: "events.3.e1", defaultText: "The", multiline: false },
    { key: "events.3.e2", defaultText: "dance", multiline: false },
    { key: "events.3.w", defaultText: "gym · 7–10 · costumes welcome", multiline: false },
    { key: "ticker.tag", defaultText: "BANNER AFTER DARK", multiline: false },
    { key: "ticker.message", defaultText: "★ Costume contest at the dance — submit team names by Thursday in homeroom ★ NO MASKS or full face paint during the school day — costume rules in the office ★ Movie night Thursday — Hocus Pocus in the cafeteria 6pm $3 ★ Mummy dogs and pumpkin cookies on the menu all week ★", multiline: true },
  ],
  "hs-halloween": [
    { key: "broadcast.live", defaultText: "● LIVE", multiline: false },
    { key: "broadcast.ch", defaultText: "CH 31 — BANNER NIGHT REPORT", multiline: false },
    { key: "broadcast.ts", defaultText: "FRI 10·31 · 22:14 PST", multiline: false },
    { key: "bats.icons", defaultText: "▼  ▼  ▼     ▼", multiline: false },
    { key: "headline.kicker", defaultText: "★ haunted homecoming · 31 oct ★", multiline: false },
    { key: "headline.t1", defaultText: "Boo", multiline: false },
    { key: "headline.t2", defaultText: "U.", multiline: false },
    { key: "headline.sub", defaultText: "Costume contest in the gym at lunch · trunk-or-treat in the senior lot 6pm · Friday's football game is themed Monsters vs Knights — wear orange or be eaten.", multiline: true },
    { key: "contest.k", defaultText: "★ costume contest", multiline: false },
    { key: "contest.t1", defaultText: "$200", multiline: false },
    { key: "contest.t2", defaultText: "prize", multiline: false },
    { key: "contest.p", defaultText: "Three categories — solo, group, and faculty. ASB judges. No real weapons, no offensive costumes. Sign in at the gym door before 11:50.", multiline: true },
    { key: "contest.m1", defaultText: "Fri · gym · 12:05", multiline: false },
    { key: "trunk.k", defaultText: "★ trunk-or-treat", multiline: false },
    { key: "trunk.t1", defaultText: "Senior", multiline: false },
    { key: "trunk.t2", defaultText: "lot.", multiline: false },
    { key: "trunk.p", defaultText: "Clubs decorate trunks · candy for grades 1–6 from the neighborhood. Volunteer slot? Sign-up sheet outside ASB room. Setup 5pm, doors 6.", multiline: true },
    { key: "trunk.m1", defaultText: "Fri Oct 31 · 6–8pm", multiline: false },
    { key: "trunk.m2", defaultText: "senior lot", multiline: false },
    { key: "game.k", defaultText: "★ home game", multiline: false },
    { key: "game.t", defaultText: "Monsters vs Knights.", multiline: false },
    { key: "game.p", defaultText: "Theme out — the louder the costume the better. Free face paint at gate D. Kickoff 7:30. Tailgate opens 5:30 in lot B with the band.", multiline: true },
    { key: "game.m1", defaultText: "Fri · 7:30 · field", multiline: false },
    { key: "shows.h", defaultText: "★ haunt week showtimes", multiline: false },
    { key: "shows.day", defaultText: "MON OCT 27 — FRI OCT 31", multiline: false },
    { key: "shows.0.d", defaultText: "MON", multiline: false },
    { key: "shows.0.e1", defaultText: "Pumpkin", multiline: false },
    { key: "shows.0.e2", defaultText: "carve", multiline: false },
    { key: "shows.0.w", defaultText: "art rm · 3:30 · $5", multiline: false },
    { key: "shows.1.d", defaultText: "WED", multiline: false },
    { key: "shows.1.e1", defaultText: "Movie", multiline: false },
    { key: "shows.1.e2", defaultText: "night", multiline: false },
    { key: "shows.1.w", defaultText: "aud · 7pm · the thing", multiline: false },
    { key: "shows.2.d", defaultText: "FRI", multiline: false },
    { key: "shows.2.e1", defaultText: "Costume", multiline: false },
    { key: "shows.2.e2", defaultText: "contest", multiline: false },
    { key: "shows.2.w", defaultText: "gym · 12:05", multiline: false },
    { key: "shows.3.d", defaultText: "FRI", multiline: false },
    { key: "shows.3.e1", defaultText: "Trunk", multiline: false },
    { key: "shows.3.e2", defaultText: "+ game", multiline: false },
    { key: "shows.3.w", defaultText: "lot+field · 6 · 7:30", multiline: false },
    { key: "ticker.tag", defaultText: "NIGHT REPORT", multiline: false },
    { key: "ticker.message", defaultText: "★ COSTUME CONTEST FRIDAY GYM 12:05 — $200 SOLO PRIZE ★ TRUNK OR TREAT SENIOR LOT 6PM — VOLUNTEERS NEEDED ★ HAUNTED HOMECOMING GAME 7:30 — WEAR ORANGE ★ THE THING IN THE AUDITORIUM WED 7PM ★", multiline: true },
  ],
  "es-thanksgiving": [
    { key: "school.name", defaultText: "Maple Tree", multiline: false },
    { key: "school.sub", defaultText: "~ a thankful school ~", multiline: false },
    { key: "clock.label", defaultText: "right now", multiline: false },
    { key: "clock.time", defaultText: "9:14", multiline: false },
    { key: "countdown.label", defaultText: "break starts", multiline: false },
    { key: "countdown.value", defaultText: "2 days", multiline: false },
    { key: "headline.kicker", defaultText: "~ this week ~", multiline: false },
    { key: "headline.t1", defaultText: "Give", multiline: false },
    { key: "headline.t2", defaultText: "thanks", multiline: false },
    { key: "headline.sub", defaultText: "Add a leaf to our gratitude tree · Feast Wednesday · No school Thurs/Fri", multiline: false },
    { key: "tree.k", defaultText: "~ our gratitude tree ~", multiline: false },
    { key: "tree.t1", defaultText: "What we're", multiline: false },
    { key: "tree.t2", defaultText: "thankful for", multiline: false },
    { key: "tree.l1", defaultText: "my puppy Biscuit", multiline: false },
    { key: "tree.l2", defaultText: "grandma's house", multiline: false },
    { key: "tree.l3", defaultText: "my big sister", multiline: false },
    { key: "tree.l4", defaultText: "recess outside", multiline: false },
    { key: "tree.l5", defaultText: "Mr. Park", multiline: false },
    { key: "tree.l6", defaultText: "books at bedtime", multiline: false },
    { key: "tree.l7", defaultText: "soccer team", multiline: false },
    { key: "tree.l8", defaultText: "sleepovers", multiline: false },
    { key: "tree.meta", defaultText: "~ add yours in the front office ~", multiline: false },
    { key: "feast.k", defaultText: "~ Wednesday's feast ~", multiline: false },
    { key: "feast.t1", defaultText: "Turkey", multiline: false },
    { key: "feast.t2", defaultText: "day lunch", multiline: false },
    { key: "feast.p", defaultText: "Roast turkey · cornbread stuffing · mashed potatoes · cranberry · green beans · pumpkin cookie · families eat free with their student", multiline: true },
    { key: "feast.t1r", defaultText: "Wed Nov 26 · 11:30", multiline: false },
    { key: "feast.t2r", defaultText: "$3.75 students · adults $5", multiline: false },
    { key: "events.h1", defaultText: "Harvest", multiline: false },
    { key: "events.h2", defaultText: "week", multiline: false },
    { key: "events.day", defaultText: "Mon Nov 24 — Fri Nov 28", multiline: false },
    { key: "events.0.d", defaultText: "Mon", multiline: false },
    { key: "events.0.e1", defaultText: "Leaf", multiline: false },
    { key: "events.0.e2", defaultText: "writing", multiline: false },
    { key: "events.0.w", defaultText: "Homerooms · all morning", multiline: false },
    { key: "events.1.d", defaultText: "Tue", multiline: false },
    { key: "events.1.e1", defaultText: "Pie", multiline: false },
    { key: "events.1.e2", defaultText: "drive", multiline: false },
    { key: "events.1.w", defaultText: "Pickup in cafeteria · 3pm", multiline: false },
    { key: "events.2.d", defaultText: "Wed", multiline: false },
    { key: "events.2.e1", defaultText: "Family", multiline: false },
    { key: "events.2.e2", defaultText: "feast", multiline: false },
    { key: "events.2.w", defaultText: "Caf · 11:30 · early dismiss 1pm", multiline: false },
    { key: "events.3.d", defaultText: "Thu/Fri", multiline: false },
    { key: "events.3.e1", defaultText: "No", multiline: false },
    { key: "events.3.e2", defaultText: "school", multiline: false },
    { key: "events.3.w", defaultText: "Holiday break · back Mon Dec 1", multiline: false },
    { key: "ticker.tag", defaultText: "~ harvest week ~", multiline: false },
    { key: "ticker.message", defaultText: "★ Family feast Wednesday 11:30 in the cafeteria — adults $5 ★ Leaf writing in homerooms — every kid adds 3 thank-yous to our tree ★ Pie drive pickup Tuesday 3pm — proceeds for new playground balls ★ No school Thursday or Friday — happy break! ★", multiline: true },
  ],
  "ms-thanksgiving": [
    { key: "school.name", defaultText: "Banner Middle", multiline: false },
    { key: "school.sub", defaultText: "harvest issue · vol 04", multiline: false },
    { key: "clock.label", defaultText: "period", multiline: false },
    { key: "clock.time", defaultText: "9:18", multiline: false },
    { key: "countdown.label", defaultText: "break in", multiline: false },
    { key: "countdown.value", defaultText: "2 days", multiline: false },
    { key: "headline.kicker", defaultText: "★ Wednesday early dismiss · Thurs–Fri no school ★", multiline: false },
    { key: "headline.t1", defaultText: "Give", multiline: false },
    { key: "headline.t2", defaultText: "thanks.", multiline: false },
    { key: "headline.sub", defaultText: "Drop a note in the gratitude jar · feast Wednesday in the cafeteria · canned-goods drive runs all week.", multiline: true },
    { key: "drive.k", defaultText: "★ canned goods drive", multiline: false },
    { key: "drive.t1", defaultText: "Pack the", multiline: false },
    { key: "drive.t2", defaultText: "pantry", multiline: false },
    { key: "drive.p", defaultText: "Each homeroom collects through Wednesday — winning class earns a pizza lunch. Most-needed: peanut butter, pasta, oatmeal, canned tuna.", multiline: true },
    { key: "drive.m1", defaultText: "drop: caf entry", multiline: false },
    { key: "drive.m2", defaultText: "deadline Wed", multiline: false },
    { key: "feast.k", defaultText: "★ Wednesday's feast", multiline: false },
    { key: "feast.t1", defaultText: "Turkey", multiline: false },
    { key: "feast.t2", defaultText: "&amp; the works.", multiline: false },
    { key: "feast.p", defaultText: "Roast turkey · cornbread stuffing · mashed potatoes &amp; gravy · cranberry · green beans · pumpkin pie. Vegetarian shepherd's pie at line C.", multiline: true },
    { key: "feast.m1", defaultText: "Wed Nov 26 · 11:30", multiline: false },
    { key: "feast.m2", defaultText: "$4.50 · adults $7", multiline: false },
    { key: "jar.k", defaultText: "★ gratitude jar", multiline: false },
    { key: "jar.t", defaultText: "3 lines.", multiline: false },
    { key: "jar.p", defaultText: "Write three things you're thankful for and drop the slip in the jar at the front office. We'll read favorites at the assembly.", multiline: true },
    { key: "jar.m1", defaultText: "slips at office", multiline: false },
    { key: "events.h", defaultText: "★ harvest week", multiline: false },
    { key: "events.day", defaultText: "Mon Nov 24 — Fri Nov 28", multiline: false },
    { key: "events.0.d", defaultText: "Mon", multiline: false },
    { key: "events.0.e1", defaultText: "Drive", multiline: false },
    { key: "events.0.e2", defaultText: "begins", multiline: false },
    { key: "events.0.w", defaultText: "cans · pasta · peanut butter", multiline: false },
    { key: "events.1.d", defaultText: "Tue", multiline: false },
    { key: "events.1.e1", defaultText: "Pie", multiline: false },
    { key: "events.1.e2", defaultText: "sale", multiline: false },
    { key: "events.1.w", defaultText: "caf · 3pm pickup · $12", multiline: false },
    { key: "events.2.d", defaultText: "Wed", multiline: false },
    { key: "events.2.e1", defaultText: "Family", multiline: false },
    { key: "events.2.e2", defaultText: "feast", multiline: false },
    { key: "events.2.w", defaultText: "caf · 11:30 · early dismiss 1pm", multiline: false },
    { key: "events.3.d", defaultText: "Thu/Fri", multiline: false },
    { key: "events.3.e1", defaultText: "No", multiline: false },
    { key: "events.3.e2", defaultText: "school", multiline: false },
    { key: "events.3.w", defaultText: "break · back Mon Dec 1", multiline: false },
    { key: "ticker.tag", defaultText: "HARVEST WEEK", multiline: false },
    { key: "ticker.message", defaultText: "★ Family feast Wednesday 11:30 in the cafeteria — adults $7 ★ Canned goods drive ends Wednesday — winning homeroom earns pizza lunch ★ Pie sale Tuesday 3pm pickup outside cafeteria ★ Early dismiss 1pm Wednesday — no school Thursday or Friday ★", multiline: true },
  ],
  "hs-thanksgiving": [
    { key: "masthead.t1", defaultText: "The", multiline: false },
    { key: "masthead.t2", defaultText: "Banner.", multiline: false },
    { key: "masthead.vol", defaultText: "Vol XLI · No 9 · Banner High", multiline: false },
    { key: "masthead.date", defaultText: "Thursday, November 26", multiline: false },
    { key: "masthead.price", defaultText: "Late edition · all senses", multiline: false },
    { key: "headline.kicker", defaultText: "★ harvest issue · gratitude · gravy ★", multiline: false },
    { key: "headline.t1", defaultText: "Give", multiline: false },
    { key: "headline.t2", defaultText: "thanks.", multiline: false },
    { key: "headline.deck", defaultText: "Three days off, one feast, and the smallest break of the school year — but we'll take it. Inside: the senior food drive blew past goal, the turkey trot route map, and a teacher pie-vote so contested it went to a runoff. School resumes Monday.", multiline: true },
    { key: "drive.k", defaultText: "★ canned food drive", multiline: false },
    { key: "drive.t1", defaultText: "8,400", multiline: false },
    { key: "drive.t2", defaultText: "cans.", multiline: false },
    { key: "drive.p", defaultText: "Goal smashed by Tuesday. Final count Friday at homeroom. Top homeroom wins a pancake breakfast in December. Drop-offs continue at the front office.", multiline: true },
    { key: "drive.m1", defaultText: "deadline · Fri 11/22 3pm", multiline: false },
    { key: "trot.k", defaultText: "★ turkey trot 5k", multiline: false },
    { key: "trot.t1", defaultText: "Wed", multiline: false },
    { key: "trot.t2", defaultText: "7am.", multiline: false },
    { key: "trot.p", defaultText: "Route loops the practice fields and out to Maple Ave. PE credit if you finish under 40 min. Costumes encouraged. Coach Rivera pacing the back of the pack.", multiline: true },
    { key: "trot.m1", defaultText: "Wed 11/25 · 7am · field A", multiline: false },
    { key: "break.k", defaultText: "★ break", multiline: false },
    { key: "break.t1", defaultText: "3", multiline: false },
    { key: "break.t2", defaultText: "days off.", multiline: false },
    { key: "break.p", defaultText: "No school Wed–Fri. Office closed Thu and Fri. Powerschool grades posted Tuesday before close.", multiline: true },
    { key: "break.m1", defaultText: "Wed 11/25 — Fri 11/27", multiline: false },
    { key: "pievote.k", defaultText: "★ teacher pie vote", multiline: false },
    { key: "pievote.t1", defaultText: "Pecan", multiline: false },
    { key: "pievote.t2", defaultText: "wins.", multiline: false },
    { key: "pievote.p", defaultText: "Pecan over apple by 12 votes in the runoff. Bake-off Tuesday in the cafeteria — winning teacher takes the pan home.", multiline: true },
    { key: "pievote.m1", defaultText: "Tue 11/24 · caf · 12:30", multiline: false },
    { key: "sked.h", defaultText: "★ harvest week schedule", multiline: false },
    { key: "sked.day", defaultText: "Mon 11/23 — Fri 11/27", multiline: false },
    { key: "sked.0.d", defaultText: "MON", multiline: false },
    { key: "sked.0.e1", defaultText: "Food", multiline: false },
    { key: "sked.0.e2", defaultText: "drive", multiline: false },
    { key: "sked.0.w", defaultText: "cans · all day · office", multiline: false },
    { key: "sked.1.d", defaultText: "TUE", multiline: false },
    { key: "sked.1.e1", defaultText: "Pie", multiline: false },
    { key: "sked.1.e2", defaultText: "vote", multiline: false },
    { key: "sked.1.w", defaultText: "caf · 12:30", multiline: false },
    { key: "sked.2.d", defaultText: "WED", multiline: false },
    { key: "sked.2.e1", defaultText: "Turkey", multiline: false },
    { key: "sked.2.e2", defaultText: "trot", multiline: false },
    { key: "sked.2.w", defaultText: "field A · 7am", multiline: false },
    { key: "sked.3.d", defaultText: "WED", multiline: false },
    { key: "sked.3.e1", defaultText: "Half", multiline: false },
    { key: "sked.3.e2", defaultText: "day", multiline: false },
    { key: "sked.3.w", defaultText: "dismiss · 12:15", multiline: false },
    { key: "sked.4.d", defaultText: "MON", multiline: false },
    { key: "sked.4.e1", defaultText: "Back", multiline: false },
    { key: "sked.4.e2", defaultText: "to it", multiline: false },
    { key: "sked.4.w", defaultText: "classes resume · 11/30", multiline: false },
  ],
  "es-christmas": [
    { key: "school.name", defaultText: "Maple Tree", multiline: false },
    { key: "school.sub", defaultText: "~ ho ho ho ~", multiline: false },
    { key: "clock.label", defaultText: "right now", multiline: false },
    { key: "clock.time", defaultText: "9:32", multiline: false },
    { key: "countdown.label", defaultText: "days till break", multiline: false },
    { key: "countdown.value", defaultText: "04", multiline: false },
    { key: "headline.kicker", defaultText: "~ welcome to ~", multiline: false },
    { key: "headline.title", defaultText: "Merry Christmas", multiline: false },
    { key: "headline.sub", defaultText: "Pajama day Friday · Concert Wed at 7 · Break starts Dec 19", multiline: false },
    { key: "advent.k", defaultText: "~ countdown to break ~", multiline: false },
    { key: "advent.t1", defaultText: "Open a", multiline: false },
    { key: "advent.t2", defaultText: "door", multiline: false },
    { key: "advent.d1", defaultText: "1", multiline: false },
    { key: "advent.d2", defaultText: "2", multiline: false },
    { key: "advent.d3", defaultText: "3", multiline: false },
    { key: "advent.d4", defaultText: "4", multiline: false },
    { key: "advent.d5", defaultText: "5", multiline: false },
    { key: "advent.d6", defaultText: "6", multiline: false },
    { key: "advent.d7", defaultText: "7", multiline: false },
    { key: "advent.d8", defaultText: "8", multiline: false },
    { key: "advent.d9", defaultText: "9", multiline: false },
    { key: "advent.d10", defaultText: "10", multiline: false },
    { key: "advent.d11", defaultText: "11", multiline: false },
    { key: "advent.d12", defaultText: "12", multiline: false },
    { key: "advent.d13", defaultText: "13", multiline: false },
    { key: "advent.d14", defaultText: "14", multiline: false },
    { key: "advent.d15", defaultText: "15", multiline: false },
    { key: "advent.d16", defaultText: "16", multiline: false },
    { key: "advent.d17", defaultText: "17", multiline: false },
    { key: "advent.d18", defaultText: "18", multiline: false },
    { key: "advent.d19", defaultText: "19", multiline: false },
    { key: "advent.d20", defaultText: "20", multiline: false },
    { key: "advent.d21", defaultText: "21", multiline: false },
    { key: "advent.d22", defaultText: "22", multiline: false },
    { key: "advent.d23", defaultText: "23", multiline: false },
    { key: "advent.d24", defaultText: "24", multiline: false },
    { key: "advent.meta", defaultText: "~ today: bring a canned good for the food drive ~", multiline: false },
    { key: "feast.k", defaultText: "~ Friday's lunch ~", multiline: false },
    { key: "feast.t1", defaultText: "Holiday", multiline: false },
    { key: "feast.t2", defaultText: "feast", multiline: false },
    { key: "feast.p", defaultText: "Roast turkey · stuffing · mashed potatoes · gingerbread cookie · hot cocoa for everyone · pajamas welcome", multiline: true },
    { key: "feast.t1r", defaultText: "Fri Dec 19 · 11:30", multiline: false },
    { key: "feast.t2r", defaultText: "$3.75 students", multiline: false },
    { key: "events.h1", defaultText: "Spirit", multiline: false },
    { key: "events.h2", defaultText: "week", multiline: false },
    { key: "events.day", defaultText: "Mon Dec 15 — Fri Dec 19", multiline: false },
    { key: "events.0.d", defaultText: "Mon", multiline: false },
    { key: "events.0.e1", defaultText: "Ugly", multiline: false },
    { key: "events.0.e2", defaultText: "sweater", multiline: false },
    { key: "events.0.w", defaultText: "All grades · prize at lunch", multiline: false },
    { key: "events.1.d", defaultText: "Wed", multiline: false },
    { key: "events.1.e1", defaultText: "Winter", multiline: false },
    { key: "events.1.e2", defaultText: "concert", multiline: false },
    { key: "events.1.w", defaultText: "Gym · 7pm · families welcome", multiline: false },
    { key: "events.2.d", defaultText: "Thu", multiline: false },
    { key: "events.2.e1", defaultText: "Class", multiline: false },
    { key: "events.2.e2", defaultText: "parties", multiline: false },
    { key: "events.2.w", defaultText: "After lunch · sign up to bring", multiline: false },
    { key: "events.3.d", defaultText: "Fri", multiline: false },
    { key: "events.3.e1", defaultText: "Pajama", multiline: false },
    { key: "events.3.e2", defaultText: "day", multiline: false },
    { key: "events.3.w", defaultText: "Wear your PJs · cocoa · early dismiss", multiline: false },
    { key: "ticker.tag", defaultText: "~ FA-LA-LA ~", multiline: false },
    { key: "ticker.message", defaultText: "★ Winter concert Wednesday 7pm in the gym — families welcome ★ Pajama day Friday — wear your coziest PJs and bring a canned good ★ Break starts after school Friday Dec 19 — see you back Jan 5 ★ Hot cocoa for everyone in the cafeteria all week ★", multiline: true },
  ],
  "ms-christmas": [
    { key: "school.name", defaultText: "Banner Middle", multiline: false },
    { key: "school.sub", defaultText: "winter issue · vol 06", multiline: false },
    { key: "clock.label", defaultText: "period", multiline: false },
    { key: "clock.time", defaultText: "9:42", multiline: false },
    { key: "countdown.label", defaultText: "break in", multiline: false },
    { key: "countdown.value", defaultText: "4 days", multiline: false },
    { key: "headline.kicker", defaultText: "★ winter concert wed 7pm · spirit week mon–fri ★", multiline: false },
    { key: "headline.t1", defaultText: "Happy", multiline: false },
    { key: "headline.t2", defaultText: "Holidays.", multiline: false },
    { key: "headline.sub", defaultText: "Toy drive in the front office · concert Wednesday at 7 · pajama day Friday · break starts after school Friday Dec 19.", multiline: true },
    { key: "drive.k", defaultText: "★ toy drive", multiline: false },
    { key: "drive.t1", defaultText: "Drop a", multiline: false },
    { key: "drive.t2", defaultText: "gift", multiline: false },
    { key: "drive.p", defaultText: "New, unwrapped toys benefit Banner Family Services. Bins are at the front office and outside the cafeteria. Donations through Friday.", multiline: true },
    { key: "drive.m1", defaultText: "deadline Fri Dec 19", multiline: false },
    { key: "concert.k", defaultText: "★ winter concert", multiline: false },
    { key: "concert.t1", defaultText: "Bands", multiline: false },
    { key: "concert.t2", defaultText: "&amp; choir.", multiline: false },
    { key: "concert.p", defaultText: "Sixth-grade band opens at 7:00, choir at 7:30, jazz band closes the night with three pieces. Doors at 6:30 — families and friends welcome.", multiline: true },
    { key: "concert.m1", defaultText: "Wed Dec 17 · 7pm", multiline: false },
    { key: "concert.m2", defaultText: "main gym · free", multiline: false },
    { key: "spirit.k", defaultText: "★ spirit week", multiline: false },
    { key: "spirit.t", defaultText: "Dress code.", multiline: false },
    { key: "spirit.p", defaultText: "Mon ugly sweater · Tue red &amp; green · Wed concert clothes · Thu festive socks · Fri PJ day. Prize to wildest each day.", multiline: true },
    { key: "spirit.m1", defaultText: "vote in homeroom", multiline: false },
    { key: "events.h", defaultText: "★ this week", multiline: false },
    { key: "events.day", defaultText: "Mon Dec 15 — Fri Dec 19", multiline: false },
    { key: "events.0.d", defaultText: "Mon", multiline: false },
    { key: "events.0.e1", defaultText: "Ugly", multiline: false },
    { key: "events.0.e2", defaultText: "sweater", multiline: false },
    { key: "events.0.w", defaultText: "all day · prizes at lunch", multiline: false },
    { key: "events.1.d", defaultText: "Wed", multiline: false },
    { key: "events.1.e1", defaultText: "Winter", multiline: false },
    { key: "events.1.e2", defaultText: "concert", multiline: false },
    { key: "events.1.w", defaultText: "gym · 7pm · families welcome", multiline: false },
    { key: "events.2.d", defaultText: "Thu", multiline: false },
    { key: "events.2.e1", defaultText: "Class", multiline: false },
    { key: "events.2.e2", defaultText: "parties", multiline: false },
    { key: "events.2.w", defaultText: "last period · sign up", multiline: false },
    { key: "events.3.d", defaultText: "Fri", multiline: false },
    { key: "events.3.e1", defaultText: "PJ", multiline: false },
    { key: "events.3.e2", defaultText: "day", multiline: false },
    { key: "events.3.w", defaultText: "cocoa · early dismiss 1pm", multiline: false },
    { key: "ticker.tag", defaultText: "FA-LA-LA-LA-LA", multiline: false },
    { key: "ticker.message", defaultText: "★ Winter concert Wednesday 7pm in the gym — doors at 6:30 ★ Toy drive bins at the front office and cafeteria — new unwrapped only, ends Friday ★ Spirit week — ugly sweater Mon, PJ day Fri, prizes daily ★ Break starts after school Friday Dec 19 — back Mon Jan 5 ★", multiline: true },
  ],
  "hs-christmas": [
    { key: "orn.tl", defaultText: "'25", multiline: false },
    { key: "orn.tr", defaultText: "★", multiline: false },
    { key: "orn.bl", defaultText: "★", multiline: false },
    { key: "orn.br", defaultText: "DEC", multiline: false },
    { key: "masthead.est", defaultText: "est. 1924", multiline: false },
    { key: "masthead.t1", defaultText: "Banner", multiline: false },
    { key: "masthead.t2", defaultText: "High", multiline: false },
    { key: "masthead.vol", defaultText: "winter issue", multiline: false },
    { key: "headline.kicker", defaultText: "★ winter formal · december 19 ★", multiline: false },
    { key: "headline.t1", defaultText: "Snow", multiline: false },
    { key: "headline.t2", defaultText: "Ball.", multiline: false },
    { key: "headline.sub", defaultText: "Tickets at the ASB window — $35 single, $60 couple — through Friday. Theme is \"Midnight Forest.\" Toy drive ends Thursday; donation bins at every entrance.", multiline: true },
    { key: "tickets.k", defaultText: "★ formal tickets", multiline: false },
    { key: "tickets.t1", defaultText: "$35", multiline: false },
    { key: "tickets.t2", defaultText: "solo", multiline: false },
    { key: "tickets.p", defaultText: "Sales close Friday 3pm — no door sales. Couples $60. ASB window during all three lunches. Cash or card.", multiline: true },
    { key: "tickets.m1", defaultText: "deadline · Fri 12/12", multiline: false },
    { key: "dance.k", defaultText: "★ snow ball", multiline: false },
    { key: "dance.t1", defaultText: "Dec", multiline: false },
    { key: "dance.t2", defaultText: "19.", multiline: false },
    { key: "dance.p", defaultText: "Doors 7:30pm at the field house · DJ Vega, photo booth, late dessert bar. Last entry 9pm. Bus pickup at midnight from lot B.", multiline: true },
    { key: "dance.m1", defaultText: "Fri 12/19 · 7:30pm", multiline: false },
    { key: "dance.m2", defaultText: "field house", multiline: false },
    { key: "toy.k", defaultText: "★ toy drive", multiline: false },
    { key: "toy.t", defaultText: "Bring one.", multiline: false },
    { key: "toy.p", defaultText: "New, unwrapped — drop in any red bin through Thursday. Goal: 1,200 toys. Top homeroom gets a pizza party in January.", multiline: true },
    { key: "toy.m1", defaultText: "deadline · Thu 12/18", multiline: false },
    { key: "sked.h", defaultText: "★ winter week", multiline: false },
    { key: "sked.day", defaultText: "Mon 12/15 — Fri 12/19", multiline: false },
    { key: "sked.0.d", defaultText: "MON", multiline: false },
    { key: "sked.0.e1", defaultText: "Ugly", multiline: false },
    { key: "sked.0.e2", defaultText: "sweater", multiline: false },
    { key: "sked.0.w", defaultText: "spirit · all day", multiline: false },
    { key: "sked.1.d", defaultText: "WED", multiline: false },
    { key: "sked.1.e1", defaultText: "Choir", multiline: false },
    { key: "sked.1.e2", defaultText: "concert", multiline: false },
    { key: "sked.1.w", defaultText: "aud · 7pm · free", multiline: false },
    { key: "sked.2.d", defaultText: "THU", multiline: false },
    { key: "sked.2.e1", defaultText: "Toy", multiline: false },
    { key: "sked.2.e2", defaultText: "drive ends", multiline: false },
    { key: "sked.2.w", defaultText: "red bins · 3pm", multiline: false },
    { key: "sked.3.d", defaultText: "FRI", multiline: false },
    { key: "sked.3.e1", defaultText: "Snow", multiline: false },
    { key: "sked.3.e2", defaultText: "Ball", multiline: false },
    { key: "sked.3.w", defaultText: "field house · 7:30", multiline: false },
  ],
  "es-valentines": [
    { key: "school.name", defaultText: "Maple Tree", multiline: false },
    { key: "school.sub", defaultText: "~ love is in the air ~", multiline: false },
    { key: "clock.label", defaultText: "right now", multiline: false },
    { key: "clock.time", defaultText: "10:08", multiline: false },
    { key: "countdown.label", defaultText: "days till parties", multiline: false },
    { key: "countdown.value", defaultText: "02", multiline: false },
    { key: "headline.kicker", defaultText: "~ Friday is ~", multiline: false },
    { key: "headline.t1", defaultText: "Be My", multiline: false },
    { key: "headline.t2", defaultText: "Valentine", multiline: false },
    { key: "headline.sub", defaultText: "Bring a card for everyone in your class · Class parties Friday afternoon", multiline: false },
    { key: "mailbox.k", defaultText: "~ how it works ~", multiline: false },
    { key: "mailbox.t1", defaultText: "Class", multiline: false },
    { key: "mailbox.t2", defaultText: "mailboxes", multiline: false },
    { key: "mailbox.e1", defaultText: "♥", multiline: false },
    { key: "mailbox.e2", defaultText: "XO", multiline: false },
    { key: "mailbox.e3", defaultText: "♥", multiline: false },
    { key: "mailbox.e4", defaultText: "U", multiline: false },
    { key: "mailbox.meta", defaultText: "~ make one card for every classmate · names on the inside ~", multiline: false },
    { key: "feast.k", defaultText: "~ Friday's lunch ~", multiline: false },
    { key: "feast.t1", defaultText: "Sweetheart", multiline: false },
    { key: "feast.t2", defaultText: "special", multiline: false },
    { key: "feast.p", defaultText: "Heart-shaped pizza · strawberry milk · pink frosted cookie · fruit cup with raspberries · vanilla pudding cup with sprinkles", multiline: true },
    { key: "feast.t1r", defaultText: "Fri Feb 13 · 11:30", multiline: false },
    { key: "feast.t2r", defaultText: "$3.75 · line A", multiline: false },
    { key: "events.h1", defaultText: "Heart", multiline: false },
    { key: "events.h2", defaultText: "week", multiline: false },
    { key: "events.day", defaultText: "Mon Feb 9 — Fri Feb 13", multiline: false },
    { key: "events.0.d", defaultText: "Mon", multiline: false },
    { key: "events.0.e1", defaultText: "Card", multiline: false },
    { key: "events.0.e2", defaultText: "making", multiline: false },
    { key: "events.0.w", defaultText: "Art class · all grades", multiline: false },
    { key: "events.1.d", defaultText: "Wed", multiline: false },
    { key: "events.1.e1", defaultText: "Wear", multiline: false },
    { key: "events.1.e2", defaultText: "pink", multiline: false },
    { key: "events.1.w", defaultText: "Spirit day · pink or red", multiline: false },
    { key: "events.2.d", defaultText: "Thu", multiline: false },
    { key: "events.2.e1", defaultText: "Mailbox", multiline: false },
    { key: "events.2.e2", defaultText: "delivery", multiline: false },
    { key: "events.2.w", defaultText: "Drop cards in homerooms", multiline: false },
    { key: "events.3.d", defaultText: "Fri", multiline: false },
    { key: "events.3.e1", defaultText: "Class", multiline: false },
    { key: "events.3.e2", defaultText: "parties", multiline: false },
    { key: "events.3.w", defaultText: "After lunch · sign up to bring", multiline: false },
    { key: "ticker.tag", defaultText: "~ XOXO ~", multiline: false },
    { key: "ticker.message", defaultText: "★ Bring a Valentine for EVERY classmate — no one left out ★ Class parties Friday after lunch — sign up to bring fruit, juice, or cookies ★ Wear pink or red on Wednesday for spirit day ★ Heart-shaped pizza Friday in the cafeteria ★", multiline: true },
  ],
  "ms-valentines": [
    { key: "school.name", defaultText: "Banner Middle", multiline: false },
    { key: "school.sub", defaultText: "heart issue · vol 09", multiline: false },
    { key: "clock.label", defaultText: "period", multiline: false },
    { key: "clock.time", defaultText: "10:24", multiline: false },
    { key: "countdown.label", defaultText: "dance in", multiline: false },
    { key: "countdown.value", defaultText: "02", multiline: false },
    { key: "headline.kicker", defaultText: "★ candygram orders close thu · dance fri 7pm ★", multiline: false },
    { key: "headline.t1", defaultText: "Be", multiline: false },
    { key: "headline.t2", defaultText: "Mine.", multiline: false },
    { key: "headline.sub", defaultText: "Crush Crush Dance Friday in the gym · candygrams in the cafeteria · spirit week all week.", multiline: true },
    { key: "candygram.k", defaultText: "★ candygrams", multiline: false },
    { key: "candygram.t1", defaultText: "Send a", multiline: false },
    { key: "candygram.t2", defaultText: "heart", multiline: false },
    { key: "candygram.p", defaultText: "Order a $2 lollipop with a sweet anonymous note — delivered to your friend's locker on Friday morning. ASB sells at lunch all week.", multiline: true },
    { key: "candygram.m1", defaultText: "$2 each · 3 for $5", multiline: false },
    { key: "candygram.m2", defaultText: "deadline thu", multiline: false },
    { key: "dance.k", defaultText: "★ Friday's dance", multiline: false },
    { key: "dance.t1", defaultText: "Crush", multiline: false },
    { key: "dance.t2", defaultText: "crush.", multiline: false },
    { key: "dance.p", defaultText: "DJ Vibe back by demand · pink &amp; red dress code · photo booth · ASB concessions. Doors close at 7:30 — be on time.", multiline: true },
    { key: "dance.m1", defaultText: "Fri Feb 13 · 7–9:30", multiline: false },
    { key: "dance.m2", defaultText: "$5 ASB · $7 door", multiline: false },
    { key: "kindness.k", defaultText: "★ kindness wall", multiline: false },
    { key: "kindness.t", defaultText: "Shout outs.", multiline: false },
    { key: "kindness.p", defaultText: "Drop a kind note for any student or teacher in the box at the office — we'll post the wall in the main hallway all week.", multiline: true },
    { key: "kindness.m1", defaultText: "no names mean no posts", multiline: false },
    { key: "events.h", defaultText: "★ heart week", multiline: false },
    { key: "events.day", defaultText: "Mon Feb 9 — Fri Feb 13", multiline: false },
    { key: "events.0.d", defaultText: "Mon", multiline: false },
    { key: "events.0.e1", defaultText: "Candygrams", multiline: false },
    { key: "events.0.e2", defaultText: "open", multiline: false },
    { key: "events.0.w", defaultText: "caf · lunch · ASB table", multiline: false },
    { key: "events.1.d", defaultText: "Wed", multiline: false },
    { key: "events.1.e1", defaultText: "Pink/red", multiline: false },
    { key: "events.1.e2", defaultText: "day", multiline: false },
    { key: "events.1.w", defaultText: "spirit · prizes at lunch", multiline: false },
    { key: "events.2.d", defaultText: "Thu", multiline: false },
    { key: "events.2.e1", defaultText: "Order", multiline: false },
    { key: "events.2.e2", defaultText: "deadline", multiline: false },
    { key: "events.2.w", defaultText: "candygrams close 3pm", multiline: false },
    { key: "events.3.d", defaultText: "Fri", multiline: false },
    { key: "events.3.e1", defaultText: "The", multiline: false },
    { key: "events.3.e2", defaultText: "dance", multiline: false },
    { key: "events.3.w", defaultText: "gym · 7–9:30 · doors close 7:30", multiline: false },
    { key: "ticker.tag", defaultText: "XOXO BANNER", multiline: false },
    { key: "ticker.message", defaultText: "★ Crush Crush Dance Friday 7–9:30 in the gym — doors close at 7:30 ★ Candygram orders close Thursday 3pm — buy at lunch in the caf ★ Pink &amp; red day Wednesday — best fit wins free dance ticket ★ Kindness wall in the main hall — drop a note at the office ★", multiline: true },
  ],
  "hs-valentines": [
    { key: "school.name", defaultText: "Banner High", multiline: false },
    { key: "school.sub", defaultText: "cupid issue · vol XIII", multiline: false },
    { key: "clock.label", defaultText: "period", multiline: false },
    { key: "clock.time", defaultText: "10:14", multiline: false },
    { key: "countdown.label", defaultText: "candygram cutoff", multiline: false },
    { key: "countdown.value", defaultText: "02d", multiline: false },
    { key: "headline.kicker", defaultText: "★ asb candygrams · ½ off through wed ★", multiline: false },
    { key: "headline.t1", defaultText: "Be", multiline: false },
    { key: "headline.t2", defaultText: "mine?", multiline: false },
    { key: "headline.sub", defaultText: "Anonymous candygrams delivered Friday during 4th period — $2 each at the ASB window. Sweetheart dance Saturday 8pm in the gym, no theme this year, just vibes.", multiline: true },
    { key: "grams.k", defaultText: "★ candygrams", multiline: false },
    { key: "grams.t1", defaultText: "$2", multiline: false },
    { key: "grams.t2", defaultText: "each.", multiline: false },
    { key: "grams.p", defaultText: "Anonymous or signed. ASB window during lunches. Half-price three-pack through Wednesday. Delivered 4th period Friday — yes even to the office.", multiline: true },
    { key: "grams.m1", defaultText: "deadline · Thu 2/13 3pm", multiline: false },
    { key: "dance.k", defaultText: "★ sweetheart dance", multiline: false },
    { key: "dance.t1", defaultText: "Sat", multiline: false },
    { key: "dance.t2", defaultText: "8pm.", multiline: false },
    { key: "dance.p", defaultText: "Gym, no theme, real DJ, $10 at the door — $8 with a candygram receipt. Single, paired, group of friends, all welcome. Last entry 10pm.", multiline: true },
    { key: "dance.m1", defaultText: "Sat 2/15 · 8–11pm", multiline: false },
    { key: "dance.m2", defaultText: "main gym", multiline: false },
    { key: "single.k", defaultText: "★ singles awareness", multiline: false },
    { key: "single.t", defaultText: "Pizza & a movie.", multiline: false },
    { key: "single.p", defaultText: "Friday after school in the library — Spider-Verse, free pizza, ASB hosting. Open to anyone single, partnered, or just hungry.", multiline: true },
    { key: "single.m1", defaultText: "Fri 2/14 · 3:30 · library", multiline: false },
    { key: "sked.h", defaultText: "★ heart week", multiline: false },
    { key: "sked.day", defaultText: "Mon 2/10 — Sat 2/15", multiline: false },
    { key: "sked.0.d", defaultText: "MON", multiline: false },
    { key: "sked.0.e1", defaultText: "Pink", multiline: false },
    { key: "sked.0.e2", defaultText: "day", multiline: false },
    { key: "sked.0.w", defaultText: "spirit · all day", multiline: false },
    { key: "sked.1.d", defaultText: "WED", multiline: false },
    { key: "sked.1.e1", defaultText: "Gram", multiline: false },
    { key: "sked.1.e2", defaultText: "deadline", multiline: false },
    { key: "sked.1.w", defaultText: "asb window · 3pm", multiline: false },
    { key: "sked.2.d", defaultText: "FRI", multiline: false },
    { key: "sked.2.e1", defaultText: "Pizza", multiline: false },
    { key: "sked.2.e2", defaultText: "+ movie", multiline: false },
    { key: "sked.2.w", defaultText: "library · 3:30 free", multiline: false },
    { key: "sked.3.d", defaultText: "SAT", multiline: false },
    { key: "sked.3.e1", defaultText: "Sweetheart", multiline: false },
    { key: "sked.3.e2", defaultText: "dance", multiline: false },
    { key: "sked.3.w", defaultText: "gym · 8pm $10", multiline: false },
  ],
  "es-stpatricks": [
    { key: "school.name", defaultText: "Maple Tree", multiline: false },
    { key: "school.sub", defaultText: "~ feelin' lucky! ~", multiline: false },
    { key: "clock.label", defaultText: "right now", multiline: false },
    { key: "clock.time", defaultText: "10:14", multiline: false },
    { key: "countdown.label", defaultText: "days till", multiline: false },
    { key: "countdown.value", defaultText: "01", multiline: false },
    { key: "headline.kicker", defaultText: "~ March 17 ~", multiline: false },
    { key: "headline.t1", defaultText: "Lucky", multiline: false },
    { key: "headline.t2", defaultText: "Day", multiline: false },
    { key: "headline.sub", defaultText: "Wear green or get pinched · Leprechaun trap contest in the library · Class parade 2pm", multiline: true },
    { key: "hunt.k", defaultText: "~ catch him if you can ~", multiline: false },
    { key: "hunt.t1", defaultText: "Leprechaun", multiline: false },
    { key: "hunt.t2", defaultText: "on the loose", multiline: false },
    { key: "hunt.p", defaultText: "Lucky the leprechaun has been spotted in our halls — follow the green footprints to find his pot of gold (chocolate coins for everyone who finds it!)", multiline: true },
    { key: "hunt.meta", defaultText: "~ trap submissions due Thursday in the library ~", multiline: false },
    { key: "feast.k", defaultText: "~ Tuesday's lunch ~", multiline: false },
    { key: "feast.t1", defaultText: "Green", multiline: false },
    { key: "feast.t2", defaultText: "eggs &amp; ham", multiline: false },
    { key: "feast.p", defaultText: "Real green eggs · ham · Irish soda bread · green apple slices · pistachio pudding · lime sherbet float at the dessert station", multiline: true },
    { key: "feast.t1r", defaultText: "Tue Mar 17 · 11:30", multiline: false },
    { key: "feast.t2r", defaultText: "$3.75 · all lines", multiline: false },
    { key: "events.h1", defaultText: "Lucky", multiline: false },
    { key: "events.h2", defaultText: "week", multiline: false },
    { key: "events.day", defaultText: "Mon Mar 16 — Fri Mar 20", multiline: false },
    { key: "events.0.d", defaultText: "Mon", multiline: false },
    { key: "events.0.e1", defaultText: "Trap", multiline: false },
    { key: "events.0.e2", defaultText: "building", multiline: false },
    { key: "events.0.w", defaultText: "STEM lab · all grades", multiline: false },
    { key: "events.1.d", defaultText: "Tue", multiline: false },
    { key: "events.1.e1", defaultText: "Wear", multiline: false },
    { key: "events.1.e2", defaultText: "green!", multiline: false },
    { key: "events.1.w", defaultText: "Or get pinched · all day", multiline: false },
    { key: "events.2.d", defaultText: "Tue", multiline: false },
    { key: "events.2.e1", defaultText: "Class", multiline: false },
    { key: "events.2.e2", defaultText: "parade", multiline: false },
    { key: "events.2.w", defaultText: "Hallways · 2pm · K leads", multiline: false },
    { key: "events.3.d", defaultText: "Thu", multiline: false },
    { key: "events.3.e1", defaultText: "Trap", multiline: false },
    { key: "events.3.e2", defaultText: "contest", multiline: false },
    { key: "events.3.w", defaultText: "Library · winners at 3pm", multiline: false },
    { key: "ticker.tag", defaultText: "~ TOP O' THE MORNIN' ~", multiline: false },
    { key: "ticker.message", defaultText: "★ Wear green Tuesday — pinches happen if you forget! ★ Leprechaun trap contest — bring yours to the library by Thursday ★ Green eggs and ham in the cafeteria — really really green ★ Class parade 2pm Tuesday — kindergarten leads the way ★", multiline: true },
  ],
  "ms-stpatricks": [
    { key: "school.name", defaultText: "Banner Middle", multiline: false },
    { key: "school.sub", defaultText: "lucky issue · vol 11", multiline: false },
    { key: "clock.label", defaultText: "period", multiline: false },
    { key: "clock.time", defaultText: "10:14", multiline: false },
    { key: "countdown.label", defaultText: "parade in", multiline: false },
    { key: "countdown.value", defaultText: "01", multiline: false },
    { key: "headline.kicker", defaultText: "★ wear green tuesday or get pinched ★", multiline: false },
    { key: "headline.t1", defaultText: "Lucky", multiline: false },
    { key: "headline.t2", defaultText: "us.", multiline: false },
    { key: "headline.sub", defaultText: "Hallway parade Tuesday 2pm · ASB pot-of-gold raffle all week · spirit dress code: emerald or gold.", multiline: true },
    { key: "raffle.k", defaultText: "★ pot-of-gold raffle", multiline: false },
    { key: "raffle.t1", defaultText: "Win a", multiline: false },
    { key: "raffle.t2", defaultText: "prize", multiline: false },
    { key: "raffle.p", defaultText: "Buy tickets at the ASB table — proceeds fund spring dance. Top prize: $50 gift card. Drawing Friday at lunch in the cafeteria.", multiline: true },
    { key: "raffle.m1", defaultText: "$1 each · $5 for 6", multiline: false },
    { key: "parade.k", defaultText: "★ hallway parade", multiline: false },
    { key: "parade.t1", defaultText: "March", multiline: false },
    { key: "parade.t2", defaultText: "17.", multiline: false },
    { key: "parade.p", defaultText: "Sixth grade leads · seventh in middle · eighth in back. Costumes welcome — no fake beards in classrooms please. ASB hands out shamrock pins at the start.", multiline: true },
    { key: "parade.m1", defaultText: "Tue Mar 17 · 2pm", multiline: false },
    { key: "parade.m2", defaultText: "main hall", multiline: false },
    { key: "dresscode.k", defaultText: "★ dress code", multiline: false },
    { key: "dresscode.t", defaultText: "Wear green.", multiline: false },
    { key: "dresscode.p", defaultText: "Emerald, lime, hunter, neon — all greens count. No green? Grab a shamrock sticker at the front office before first period.", multiline: true },
    { key: "dresscode.m1", defaultText: "free stickers · office", multiline: false },
    { key: "events.h", defaultText: "★ lucky week", multiline: false },
    { key: "events.day", defaultText: "Mon Mar 16 — Fri Mar 20", multiline: false },
    { key: "events.0.d", defaultText: "Mon", multiline: false },
    { key: "events.0.e1", defaultText: "Raffle", multiline: false },
    { key: "events.0.e2", defaultText: "opens", multiline: false },
    { key: "events.0.w", defaultText: "ASB table · all lunches", multiline: false },
    { key: "events.1.d", defaultText: "Tue", multiline: false },
    { key: "events.1.e1", defaultText: "Wear", multiline: false },
    { key: "events.1.e2", defaultText: "green", multiline: false },
    { key: "events.1.w", defaultText: "spirit day · pinches happen", multiline: false },
    { key: "events.2.d", defaultText: "Tue", multiline: false },
    { key: "events.2.e1", defaultText: "The", multiline: false },
    { key: "events.2.e2", defaultText: "parade", multiline: false },
    { key: "events.2.w", defaultText: "main hall · 2pm · 6th leads", multiline: false },
    { key: "events.3.d", defaultText: "Fri", multiline: false },
    { key: "events.3.e1", defaultText: "Raffle", multiline: false },
    { key: "events.3.e2", defaultText: "drawing", multiline: false },
    { key: "events.3.w", defaultText: "caf · lunch · top prize $50", multiline: false },
    { key: "ticker.tag", defaultText: "TOP O' THE MORNIN'", multiline: false },
    { key: "ticker.message", defaultText: "★ Wear green Tuesday — pinches if you forget, pins free at the office ★ Hallway parade Tuesday 2pm — 6th grade leads ★ Pot-of-gold raffle drawing Friday at lunch ★ Green eggs and ham on the menu Tuesday ★", multiline: true },
  ],
  "hs-stpatricks": [
    { key: "term.path1", defaultText: "banner-hs:", multiline: false },
    { key: "term.path2", defaultText: "~/march/wear-green", multiline: false },
    { key: "term.ts", defaultText: "$ TUE 03·17 · 10:14:22 PST", multiline: false },
    { key: "headline.prompt1", defaultText: "$ sudo wear-green --tuesday", multiline: false },
    { key: "headline.t1", defaultText: "Lucky", multiline: false },
    { key: "headline.t2", defaultText: "17.", multiline: false },
    { key: "headline.sub", defaultText: "School colors are emerald all week — gold lockers get spirit points. ASB hosts trivia at lunch Tuesday with cash prizes; Friday is the parade-pep rally double-header before the spring game.", multiline: true },
    { key: "trivia.cmd", defaultText: "./trivia --quad --noon", multiline: false },
    { key: "trivia.t1", defaultText: "$50", multiline: false },
    { key: "trivia.t2", defaultText: "cash", multiline: false },
    { key: "trivia.p", defaultText: "Five rounds of Irish lore + general spirit. Teams of 3 — sign up at lunch outside the senior bench. Top team takes the cash, second gets pizza for a week.", multiline: true },
    { key: "trivia.m1", defaultText: "Tue · quad · 12:05", multiline: false },
    { key: "parade.cmd", defaultText: "./parade --route=main --depart 14:00", multiline: false },
    { key: "parade.t1", defaultText: "Pep", multiline: false },
    { key: "parade.t2", defaultText: "parade.", multiline: false },
    { key: "parade.p", defaultText: "Marching band leads down main hall to the front lawn pep rally. Spring sports captains introduced. Bring noise. Tuesday after 7th period.", multiline: true },
    { key: "parade.m1", defaultText: "Tue · 2pm · main hall → lawn", multiline: false },
    { key: "spirit.cmd", defaultText: "cat /etc/dresscode", multiline: false },
    { key: "spirit.t", defaultText: "Wear green.", multiline: false },
    { key: "spirit.p", defaultText: "Any shade — you're not getting pinched at school but you'll lose homeroom spirit points. Pins free at the front office for the unprepared.", multiline: true },
    { key: "spirit.m1", defaultText: "Tue · all day", multiline: false },
    { key: "sked.h", defaultText: "★ lucky week · cron", multiline: false },
    { key: "sked.day", defaultText: "Mon 3/16 — Fri 3/20", multiline: false },
    { key: "sked.0.d", defaultText: "MON 8AM", multiline: false },
    { key: "sked.0.e1", defaultText: "Cap", multiline: false },
    { key: "sked.0.e2", defaultText: "decor", multiline: false },
    { key: "sked.0.w", defaultText: "homeroom doors all day", multiline: false },
    { key: "sked.1.d", defaultText: "TUE 12P", multiline: false },
    { key: "sked.1.e1", defaultText: "Quad", multiline: false },
    { key: "sked.1.e2", defaultText: "trivia", multiline: false },
    { key: "sked.1.w", defaultText: "$50 prize · teams of 3", multiline: false },
    { key: "sked.2.d", defaultText: "TUE 2P", multiline: false },
    { key: "sked.2.e1", defaultText: "Pep", multiline: false },
    { key: "sked.2.e2", defaultText: "parade", multiline: false },
    { key: "sked.2.w", defaultText: "main hall · band leads", multiline: false },
    { key: "sked.3.d", defaultText: "FRI 7P", multiline: false },
    { key: "sked.3.e1", defaultText: "Spring", multiline: false },
    { key: "sked.3.e2", defaultText: "game", multiline: false },
    { key: "sked.3.w", defaultText: "field · home opener", multiline: false },
  ],
  "es-easter": [
    { key: "school.name", defaultText: "Maple Tree", multiline: false },
    { key: "school.sub", defaultText: "~ hop into spring ~", multiline: false },
    { key: "clock.label", defaultText: "right now", multiline: false },
    { key: "clock.time", defaultText: "10:36", multiline: false },
    { key: "countdown.label", defaultText: "spring break", multiline: false },
    { key: "countdown.value", defaultText: "03", multiline: false },
    { key: "headline.kicker", defaultText: "~ Friday's the day ~", multiline: false },
    { key: "headline.t1", defaultText: "Egg", multiline: false },
    { key: "headline.t2", defaultText: "Hunt", multiline: false },
    { key: "headline.sub", defaultText: "Bring your basket · K–2 hunt at 9:30 · 3–5 hunt at 10:30 · field behind the gym", multiline: false },
    { key: "basket.k", defaultText: "~ how it works ~", multiline: false },
    { key: "basket.t1", defaultText: "Fill your", multiline: false },
    { key: "basket.t2", defaultText: "basket", multiline: false },
    { key: "basket.p", defaultText: "200+ eggs hidden across the field — find as many as you can in 10 minutes. Golden eggs win prizes! Trade your eggs at the candy table for stickers and treats.", multiline: true },
    { key: "basket.meta", defaultText: "~ baskets at the office if you forget yours ~", multiline: false },
    { key: "feast.k", defaultText: "~ Friday's lunch ~", multiline: false },
    { key: "feast.t1", defaultText: "Spring", multiline: false },
    { key: "feast.t2", defaultText: "picnic", multiline: false },
    { key: "feast.p", defaultText: "Ham &amp; cheese sliders · carrot sticks · deviled eggs · fruit salad with strawberries · pastel-frosted sugar cookies · juice box", multiline: true },
    { key: "feast.t1r", defaultText: "Fri Apr 18 · 11:30", multiline: false },
    { key: "feast.t2r", defaultText: "$3.75 · all lines", multiline: false },
    { key: "events.h1", defaultText: "Spring", multiline: false },
    { key: "events.h2", defaultText: "week", multiline: false },
    { key: "events.day", defaultText: "Mon Apr 14 — Fri Apr 18", multiline: false },
    { key: "events.0.d", defaultText: "Mon", multiline: false },
    { key: "events.0.e1", defaultText: "Egg", multiline: false },
    { key: "events.0.e2", defaultText: "decorating", multiline: false },
    { key: "events.0.w", defaultText: "Art class · all grades", multiline: false },
    { key: "events.1.d", defaultText: "Wed", multiline: false },
    { key: "events.1.e1", defaultText: "Pastel", multiline: false },
    { key: "events.1.e2", defaultText: "day", multiline: false },
    { key: "events.1.w", defaultText: "Wear pink, lavender, mint", multiline: false },
    { key: "events.2.d", defaultText: "Fri", multiline: false },
    { key: "events.2.e1", defaultText: "Egg", multiline: false },
    { key: "events.2.e2", defaultText: "hunt", multiline: false },
    { key: "events.2.w", defaultText: "Field · K–2 9:30 · 3–5 10:30", multiline: false },
    { key: "events.3.d", defaultText: "Mon→", multiline: false },
    { key: "events.3.e1", defaultText: "Spring", multiline: false },
    { key: "events.3.e2", defaultText: "break", multiline: false },
    { key: "events.3.w", defaultText: "Apr 21–25 · back Apr 28", multiline: false },
    { key: "ticker.tag", defaultText: "~ HOPPY SPRING ~", multiline: false },
    { key: "ticker.message", defaultText: "★ Egg hunt Friday on the back field — bring a basket from home or grab one at the office ★ K–2 hunts at 9:30 · 3–5 hunts at 10:30 ★ Pastel day Wednesday — wear your prettiest spring colors ★ Spring break starts after school Friday — see you back Apr 28 ★", multiline: true },
  ],
  "ms-easter": [
    { key: "school.name", defaultText: "Banner Middle", multiline: false },
    { key: "school.sub", defaultText: "spring break · vol 12", multiline: false },
    { key: "clock.label", defaultText: "period", multiline: false },
    { key: "clock.time", defaultText: "10:14", multiline: false },
    { key: "countdown.label", defaultText: "break in", multiline: false },
    { key: "countdown.value", defaultText: "02", multiline: false },
    { key: "headline.kicker", defaultText: "★ egg hunt + spring fling all week ★", multiline: false },
    { key: "headline.t1", defaultText: "Hop", multiline: false },
    { key: "headline.t2", defaultText: "to it.", multiline: false },
    { key: "headline.sub", defaultText: "Egg hunt on the back lawn Friday lunch · 200 prize eggs hidden · ASB hosting a tie-dye station Thursday after school.", multiline: true },
    { key: "hunt.k", defaultText: "★ egg hunt", multiline: false },
    { key: "hunt.t1", defaultText: "200", multiline: false },
    { key: "hunt.t2", defaultText: "eggs", multiline: false },
    { key: "hunt.p", defaultText: "Hidden across the back lawn and quad before lunch on Friday. Find one with a gold sticker — bring it to the ASB table for a real prize.", multiline: true },
    { key: "hunt.m1", defaultText: "Fri · lunch · back lawn", multiline: false },
    { key: "break.k", defaultText: "★ spring break", multiline: false },
    { key: "break.t1", defaultText: "9", multiline: false },
    { key: "break.t2", defaultText: "days.", multiline: false },
    { key: "break.p", defaultText: "Out Friday at 3:15 — back Monday April 6. No homework hand-ins until Tuesday. Office staffed Monday–Wednesday for transcript pickups.", multiline: true },
    { key: "break.m1", defaultText: "Mar 28 — Apr 5", multiline: false },
    { key: "break.m2", defaultText: "return Mon Apr 6", multiline: false },
    { key: "tiedye.k", defaultText: "★ tie-dye", multiline: false },
    { key: "tiedye.t", defaultText: "Bring a tee.", multiline: false },
    { key: "tiedye.p", defaultText: "Plain cotton tee or socks — ASB supplies dye, gloves, rubber bands. Outside D-wing 3:15 Thursday. Wear clothes you don't love.", multiline: true },
    { key: "tiedye.m1", defaultText: "Thu · 3:15 · D-wing", multiline: false },
    { key: "events.h", defaultText: "★ spring fling week", multiline: false },
    { key: "events.day", defaultText: "Mon Mar 23 — Fri Mar 27", multiline: false },
    { key: "events.0.d", defaultText: "Mon", multiline: false },
    { key: "events.0.e1", defaultText: "Pastel", multiline: false },
    { key: "events.0.e2", defaultText: "day", multiline: false },
    { key: "events.0.w", defaultText: "spirit · wear pastels", multiline: false },
    { key: "events.1.d", defaultText: "Wed", multiline: false },
    { key: "events.1.e1", defaultText: "Bunny", multiline: false },
    { key: "events.1.e2", defaultText: "hop", multiline: false },
    { key: "events.1.w", defaultText: "PE · 7th + 8th period", multiline: false },
    { key: "events.2.d", defaultText: "Thu", multiline: false },
    { key: "events.2.e1", defaultText: "Tie", multiline: false },
    { key: "events.2.e2", defaultText: "dye", multiline: false },
    { key: "events.2.w", defaultText: "D-wing · 3:15pm", multiline: false },
    { key: "events.3.d", defaultText: "Fri", multiline: false },
    { key: "events.3.e1", defaultText: "Egg", multiline: false },
    { key: "events.3.e2", defaultText: "hunt", multiline: false },
    { key: "events.3.w", defaultText: "back lawn · lunch", multiline: false },
    { key: "ticker.tag", defaultText: "SPRING FLING", multiline: false },
    { key: "ticker.message", defaultText: "★ Egg hunt Friday lunch — back lawn — 200 prize eggs ★ Tie-dye Thursday after school behind D-wing — bring a plain tee ★ Pastel spirit day Monday ★ Spring break Mar 28 through Apr 5 ★", multiline: true },
  ],
  "hs-easter": [
    { key: "school.name", defaultText: "Banner High", multiline: false },
    { key: "school.sub", defaultText: "spring issue · vol XV", multiline: false },
    { key: "headline.kicker", defaultText: "★ spring break · march 28 → april 5 ★", multiline: false },
    { key: "headline.t1", defaultText: "Out", multiline: false },
    { key: "headline.t2", defaultText: "of", multiline: false },
    { key: "headline.t3", defaultText: "office.", multiline: false },
    { key: "headline.sub", defaultText: "Nine days off — return Monday April 6. AP review packets posted to Schoology Friday. SAT prep continues virtually. Drive safe.", multiline: true },
    { key: "break.k", defaultText: "★ closure", multiline: false },
    { key: "break.t1", defaultText: "9", multiline: false },
    { key: "break.t2", defaultText: "days off.", multiline: false },
    { key: "break.p", defaultText: "School closed Mar 28–Apr 5. Office staffed Mon–Wed for transcript pickup. Custodial/grounds on full week — keep the lot south clear.", multiline: true },
    { key: "break.m1", defaultText: "Sat 3/28 — Sun 4/5", multiline: false },
    { key: "break.m2", defaultText: "return Mon 4/6", multiline: false },
    { key: "ap.k", defaultText: "★ ap review", multiline: false },
    { key: "ap.t1", defaultText: "38", multiline: false },
    { key: "ap.t2", defaultText: "days.", multiline: false },
    { key: "ap.p", defaultText: "AP exams begin May 3. Review packets drop Friday on Schoology. Optional study sessions Tuesday + Thursday over break — virtual.", multiline: true },
    { key: "ap.m1", defaultText: "virtual · 10am tue/thu", multiline: false },
    { key: "prom.k", defaultText: "★ prom", multiline: false },
    { key: "prom.t", defaultText: "May 16.", multiline: false },
    { key: "prom.p", defaultText: "Tickets go on sale April 8 for $85. Theme reveal at the post-break assembly. Senior gallery wall in the commons opens that week.", multiline: true },
    { key: "prom.m1", defaultText: "tickets · Apr 8", multiline: false },
    { key: "sked.h1", defaultText: "★ pre-break", multiline: false },
    { key: "sked.h2", defaultText: "week", multiline: false },
    { key: "sked.day", defaultText: "Mon 3/23 — Fri 3/27", multiline: false },
    { key: "sked.0.d", defaultText: "TUE", multiline: false },
    { key: "sked.0.e1", defaultText: "Senior", multiline: false },
    { key: "sked.0.e2", defaultText: "photos", multiline: false },
    { key: "sked.0.w", defaultText: "commons · all day", multiline: false },
    { key: "sked.1.d", defaultText: "WED", multiline: false },
    { key: "sked.1.e1", defaultText: "Spring", multiline: false },
    { key: "sked.1.e2", defaultText: "play", multiline: false },
    { key: "sked.1.w", defaultText: "aud · 7pm · $5", multiline: false },
    { key: "sked.2.d", defaultText: "THU", multiline: false },
    { key: "sked.2.e1", defaultText: "Spirit", multiline: false },
    { key: "sked.2.e2", defaultText: "rally", multiline: false },
    { key: "sked.2.w", defaultText: "gym · 1pm", multiline: false },
    { key: "sked.3.d", defaultText: "FRI", multiline: false },
    { key: "sked.3.e1", defaultText: "Out", multiline: false },
    { key: "sked.3.e2", defaultText: "at 3:15", multiline: false },
    { key: "sked.3.w", defaultText: "break begins · drive safe", multiline: false },
  ],
};
