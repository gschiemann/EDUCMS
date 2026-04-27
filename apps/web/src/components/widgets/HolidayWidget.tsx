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
        // click-to-edit flow lands here uniformly.
        window.dispatchEvent(new CustomEvent('template-edit-field', {
          detail: { zoneId: getZoneId(), fieldKey: d.key },
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
