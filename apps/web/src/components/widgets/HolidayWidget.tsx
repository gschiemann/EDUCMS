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

import { useMemo } from 'react';

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
}

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

  // Public path served by Next — copies live in apps/web/public/holiday-templates.
  // Any lint-flagged "iframe with src from variable" worry is addressed by
  // the fact that variant + gradeLevel are constrained to the literal unions
  // above; nothing user-typed flows into the URL.
  const src = useMemo(() => `/holiday-templates/${gradeLevel}-${variant}.html`, [variant, gradeLevel]);

  return (
    <div className="w-full h-full overflow-hidden bg-black">
      <iframe
        key={src}                         // force remount on variant change so iframe reloads the new HTML
        src={src}
        title={`${variant} ${gradeLevel} holiday template`}
        className="w-full h-full border-0 block"
        // The HTML is hand-authored by us, served from our own origin.
        // Sandbox keeps it from running cross-origin scripts but allows
        // its own scripts (the autoscale snippet) + same-origin styles.
        sandbox="allow-same-origin allow-scripts"
        loading="lazy"
        // No allow=fullscreen / camera / etc — these are decorative scenes.
      />
    </div>
  );
}
