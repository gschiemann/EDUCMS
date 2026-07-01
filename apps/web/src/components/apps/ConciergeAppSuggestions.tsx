"use client";

/**
 * ConciergeAppSuggestions — the "Suggested for you" pinned row + the
 * "Tell us what you do" describe-fallback intake.
 *
 * Extracted from AppLibraryPanel.tsx (2026-07-01, task #265 "Concierge
 * auto-fill lands in ONBOARDING") so the exact same suggestion-chip UI
 * renders in TWO places without duplicating it:
 *   1. AppLibraryPanel (the template builder's Apps tab) — Tier 2, already
 *      shipped.
 *   2. The new onboarding "Your apps, ready to go" step
 *      (apps/web/src/app/onboarding/apps/page.tsx) — task #265.
 *
 * Deliberately builder-agnostic: no `useBuilderStore`, no addZone. It only
 * renders `SuggestedApp[]` (from concierge-map.ts) and calls back with the
 * chosen app + its prefill values — what happens next (open a config form
 * against a live canvas, or stash the pick for later) is entirely up to
 * the caller. This is what let the onboarding step reuse the identical
 * chip visuals without a template/canvas context existing yet.
 */

import { useState } from 'react';
import { Loader2, Wand2, X } from 'lucide-react';
import { BRAND_ICONS } from './brand-icons';
import type { AppDefinition } from './app-registry';
import type { SuggestedApp } from './concierge-map';
import {
  Tv, Video, Radio, Presentation, FileText, Palette, Table, Globe, MapPin,
  QrCode, Clock, Timer, Cloud, Rss, CalendarDays, Users, ThumbsUp, LayoutGrid, Star,
  type LucideIcon,
} from 'lucide-react';

// Mirrors AppLibraryPanel's ICONS map — kept in sync there since both files
// resolve the same `app.icon` string vocabulary from app-registry.ts.
const ICONS: Record<string, LucideIcon> = {
  Tv, Video, Radio, Presentation, FileText, Palette, Table, Globe, MapPin,
  QrCode, Clock, Timer, Cloud, Rss, CalendarDays, Users, ThumbsUp, LayoutGrid, Star,
};

function AppIcon({ appId, name, className }: { appId: string; name: string; className?: string }) {
  const Brand = BRAND_ICONS[appId];
  if (Brand) return <Brand className={className} />;
  const Cmp = ICONS[name] || Globe;
  return <Cmp className={className} aria-hidden />;
}

/**
 * The "we found this on your site" pinned row. Renders nothing if
 * `suggestions` is empty — callers decide when that's the case (still
 * loading vs. genuinely nothing found) rather than this component guessing.
 */
export function ConciergeSuggestionRow({
  suggestions,
  onSelect,
  onDismiss,
  chipLabel = (app) => `We found your ${app.name}`,
}: {
  suggestions: SuggestedApp[];
  onSelect: (app: AppDefinition, prefill: Record<string, string>) => void;
  onDismiss: () => void;
  /** Customize the chip copy — onboarding wants "Add your YouTube",
   *  the Apps panel wants "We found your YouTube". */
  chipLabel?: (app: AppDefinition) => string;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-700">
          <Wand2 className="w-3 h-3" aria-hidden />
          Suggested for you
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss suggestions"
          className="text-violet-400 hover:text-violet-600"
        >
          <X className="w-3 h-3" aria-hidden />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map(({ app, prefill }) => (
          <button
            key={app.id}
            type="button"
            onClick={() => onSelect(app, prefill)}
            className="flex items-center gap-1.5 text-[10px] font-semibold text-violet-800 bg-white border border-violet-200 rounded-full pl-1.5 pr-2.5 py-1 hover:border-violet-400 hover:bg-violet-50 transition-colors"
            title={`We found this on your site — ${app.name}`}
          >
            <AppIcon appId={app.id} name={app.icon} className="w-3 h-3 text-violet-500" />
            {chipLabel(app)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The "Tell us what you do" free-text fallback intake (no website / no
 * discover matches). Owns its own text-field state and loading spinner;
 * the caller supplies the actual /describe call via `onSubmit` and the
 * results (already resolved to SuggestedApp[]) via `results`.
 */
export function ConciergeDescribeIntake({
  placeholder = 'Tell us what you do (e.g. “coffee shop in Austin”)',
  isPending,
  results,
  onSubmit,
  onSelect,
  onDismissResults,
}: {
  placeholder?: string;
  isPending: boolean;
  results: SuggestedApp[] | null;
  onSubmit: (text: string) => void;
  onSelect: (app: AppDefinition, prefill: Record<string, string>) => void;
  onDismissResults: () => void;
}) {
  const [value, setValue] = useState('');

  if (results) {
    return (
      <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-700">
            <Wand2 className="w-3 h-3" aria-hidden />
            Suggested for you
          </div>
          <button
            type="button"
            onClick={onDismissResults}
            aria-label="Dismiss suggestions"
            className="text-violet-400 hover:text-violet-600"
          >
            <X className="w-3 h-3" aria-hidden />
          </button>
        </div>
        {results.length === 0 ? (
          <p className="text-[10px] text-violet-700/80">No matches yet — try browsing the grid below.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {results.map(({ app, prefill }) => (
              <button
                key={app.id}
                type="button"
                onClick={() => onSelect(app, prefill)}
                className="flex items-center gap-1.5 text-[10px] font-semibold text-violet-800 bg-white border border-violet-200 rounded-full pl-1.5 pr-2.5 py-1 hover:border-violet-400 hover:bg-violet-50 transition-colors"
              >
                <AppIcon appId={app.id} name={app.icon} className="w-3 h-3 text-violet-500" />
                {app.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(value); }}
        placeholder={placeholder}
        aria-label="Describe your business to get app suggestions"
        className="flex-1 px-2.5 py-1.5 text-[11px] border border-dashed border-slate-300 rounded-md placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300"
      />
      <button
        type="button"
        onClick={() => onSubmit(value)}
        disabled={!value.trim() || isPending}
        aria-label="Get app suggestions"
        className="shrink-0 p-1.5 rounded-md bg-violet-100 text-violet-600 hover:bg-violet-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Wand2 className="w-3.5 h-3.5" aria-hidden />}
      </button>
    </div>
  );
}

export { AppIcon };
