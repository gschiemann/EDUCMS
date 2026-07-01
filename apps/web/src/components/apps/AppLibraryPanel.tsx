"use client";

/**
 * AppLibraryPanel — the "Apps" tab in the template editor sidebar.
 *
 * Searchable card grid + category filter + friction-tier badges. Clicking a
 * card opens the per-app config form (AppConfigForm) with a live preview;
 * confirming there adds the zone via the SAME `addZone` + `updateZone` path
 * VariantPicker.handlePick uses, so Apps-added zones are indistinguishable
 * from any other zone to the rest of the builder (undo/redo, layers,
 * properties panel, save — all just work).
 *
 * See docs/research/2026-06-30-app-library/00-SYNTHESIS.md §5/§6 for the
 * design this implements (Phase 1: shell + instant apps), and
 * 20-WORLDCLASS-BUILD-PLAN.md Tier 1 for the paste-first / auto-detect /
 * a11y / mobile / icon pass implemented here (2026-07-01).
 *
 * Tier 2 (2026-07-01, see 20-WORLDCLASS-BUILD-PLAN.md Tier 2 "Full
 * Concierge 'Suggested for you' row"): wires the ALREADY-LIVE
 * /integrations/discover + /describe Concierge endpoints into this panel.
 * When the tenant has a known website (branding's scraped `sourceUrl`),
 * fires ONE discover call per browser session and floats a "Suggested for
 * you" row above the grid for anything we recognize on their site AND have
 * a matching App Registry tile for (see concierge-map.ts). No website on
 * file, or nothing matched → a slim "Tell us what you do" one-liner calls
 * /describe instead. Both are non-blocking suggestions, dismissible,
 * never a forced step — matches Greg's "no new settings" rule exactly:
 * this REMOVES the "hunt down your own URLs" chore, it doesn't add one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, ChevronLeft, Sparkles as AggregatorIcon, CheckCircle2, X,
  Tv, Video, Radio, Presentation, FileText, Palette, Table, Globe, MapPin,
  QrCode, Clock, Timer, Cloud, Rss, CalendarDays, Users, ThumbsUp, LayoutGrid, Star,
  Loader2, Wand2,
  type LucideIcon,
} from 'lucide-react';
import {
  APP_REGISTRY, APP_CATEGORY_LABEL, FRICTION_TIER_LABEL,
  listAppCategories, getApp,
  type AppDefinition, type AppCategory,
} from './app-registry';
import { detectApp } from './url-transforms';
import { AppConfigForm } from './AppConfigForm';
import { BRAND_ICONS } from './brand-icons';
import { CONCIERGE_TO_APP_MAP } from './concierge-map';
import {
  useTenantBranding, useDiscoverIntegrations, useDescribeBusiness,
  type ConciergeProviderCandidate,
} from '@/hooks/use-api';

// String -> component map. Kept local to the panel (not the registry file)
// so app-registry.ts stays React-free / easily unit-testable. Non-branded
// apps (Weather, QR, Clock, Countdown, generic Web Page, etc.) render these
// semantic lucide glyphs; branded apps resolve to a real logo mark from
// brand-icons.tsx first (see AppIcon below).
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

/** One resolved "Suggested for you" tile: an App Registry app matched from
 *  a Concierge candidate, with the operator's own detected link ready to
 *  prefill the config form. */
interface SuggestedApp {
  app: AppDefinition;
  prefill: Record<string, string>;
}

/** Module-level "fired this session" guard for the discover call — mirrors
 *  AiGenerateButton's getAiStatusSource() cache pattern. The panel can
 *  mount/unmount many times as the operator navigates the builder; without
 *  this every remount would re-fire the (rate-limited, 20/hr) discover
 *  call against the same unchanged website. Keyed by sourceUrl so a
 *  branding change (rare) still gets a fresh discover. */
let __conciergeDiscoverCache: { sourceUrl: string; suggestions: SuggestedApp[] } | null = null;

export function AppLibraryPanel() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<AppCategory | 'ALL'>('ALL');
  const [openApp, setOpenApp] = useState<AppDefinition | null>(null);
  const [openInitialValues, setOpenInitialValues] = useState<Record<string, string> | undefined>(undefined);
  const [pasteValue, setPasteValue] = useState('');
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  const categories = useMemo(() => listAppCategories(), []);

  const openAppWithValues = (app: AppDefinition, values: Record<string, string> | undefined, trigger?: HTMLButtonElement | null) => {
    lastTriggerRef.current = trigger ?? null;
    setOpenInitialValues(values);
    setOpenApp(app);
  };

  const closeApp = () => {
    setOpenApp(null);
    setOpenInitialValues(undefined);
    // a11y — return focus to the card/button that opened the form instead
    // of dropping it, so a keyboard/SR user doesn't lose their place in the
    // grid (discovery/mobile/a11y workstream, 2026-07-01).
    requestAnimationFrame(() => lastTriggerRef.current?.focus());
  };

  // Paste-first / auto-detect (world-class build headline "wow", Tier 1 #1).
  // Runs the same matchers every app's build() already uses — see
  // url-transforms.ts detectApp(). No match just clears the strip; the grid
  // below is completely untouched either way. Pure derivation of
  // `pasteValue` — no need for an effect + extra state, which would just
  // cause a redundant cascading render on every keystroke.
  const pasteMatch = useMemo(() => {
    const q = pasteValue.trim();
    if (!q) return null;
    const detected = detectApp(q);
    if (!detected) return null;
    const app = getApp(detected.appId);
    return app ? { app, prefill: detected.prefill } : null;
  }, [pasteValue]);
  const pasteNoMatch = pasteValue.trim().length > 0 && !pasteMatch;

  // ── Concierge auto-fill (Tier 2, 2026-07-01) ──────────────────────────
  // Resolve a discover/describe response's candidates + ownLinks into
  // App Registry tiles via concierge-map.ts. `detectedValue` (the
  // operator's ACTUAL link, from the backend's extractOwnLinks) wins over
  // just knowing the category exists — that's what lets a suggestion open
  // pre-filled instead of just naming an app the operator already knows.
  const resolveSuggestions = (
    candidates: ConciergeProviderCandidate[],
    ownLinks: Record<string, string>,
  ): SuggestedApp[] => {
    const out: SuggestedApp[] = [];
    const seen = new Set<string>();
    const tryAdd = (key: string, value: string | undefined) => {
      const match = CONCIERGE_TO_APP_MAP[key];
      if (!match || seen.has(match.appId)) return;
      const app = getApp(match.appId);
      if (!app || app.comingSoon) return; // never suggest a dead-end tile
      seen.add(match.appId);
      out.push({ app, prefill: value ? { [match.prefillKey]: value } : {} });
    };
    // Own-links first (higher-value — carries a real detected value).
    for (const [key, value] of Object.entries(ownLinks)) tryAdd(key, value);
    // Then any candidate we haven't already matched via ownLinks, even
    // without a specific detected value (still worth surfacing — "we
    // noticed you might want Slides" beats not suggesting it at all).
    for (const c of candidates) tryAdd(c.id, c.detectedValue);
    return out.slice(0, 4); // keep the row small — a pinned strip, not a second grid
  };

  const { data: branding } = useTenantBranding();
  const sourceUrl = branding?.sourceUrl?.trim() || '';
  const discover = useDiscoverIntegrations();
  const describe = useDescribeBusiness();
  const [suggestions, setSuggestions] = useState<SuggestedApp[]>(
    () => (sourceUrl && __conciergeDiscoverCache?.sourceUrl === sourceUrl ? __conciergeDiscoverCache.suggestions : []),
  );
  const [conciergeDismissed, setConciergeDismissed] = useState(false);
  const [describeValue, setDescribeValue] = useState('');
  const [describeSuggestions, setDescribeSuggestions] = useState<SuggestedApp[] | null>(null);

  // Fire the discover call AT MOST once per (session, sourceUrl) — never
  // on every panel open, and never blocking the grid below it.
  useEffect(() => {
    if (!sourceUrl) return;
    if (__conciergeDiscoverCache?.sourceUrl === sourceUrl) {
      setSuggestions(__conciergeDiscoverCache.suggestions);
      return;
    }
    let alive = true;
    discover.mutate(
      { url: sourceUrl },
      {
        onSuccess: (res) => {
          const resolved = resolveSuggestions(res.candidates || [], res.ownLinks || {});
          __conciergeDiscoverCache = { sourceUrl, suggestions: resolved };
          if (alive) setSuggestions(resolved);
        },
        // Discover failures are non-fatal by design (matches the backend's
        // own "candidates: []" degrade) — the grid below is unaffected;
        // we just don't show a suggestion row.
      },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl]);

  // Accepts an optional override so a caller that just set `describeValue`
  // (React state updates aren't synchronous) can submit the NEW text
  // immediately instead of racing the stale closure value — e.g. the
  // empty-search-state recovery button that seeds the box from the
  // operator's search query and submits in the same click.
  const handleDescribeSubmit = (overrideText?: string) => {
    const text = (overrideText ?? describeValue).trim();
    if (!text) return;
    describe.mutate(
      { text },
      {
        onSuccess: (res) => {
          setDescribeSuggestions(resolveSuggestions(res.candidates || [], res.ownLinks || {}));
        },
      },
    );
  };

  const showConciergeRow = !conciergeDismissed && suggestions.length > 0;

  const apps = useMemo(() => {
    let list = APP_REGISTRY.slice();
    if (category !== 'ALL') list = list.filter((a) => a.category === category);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.blurb.toLowerCase().includes(q));
    }
    // Instant apps first, then login, then aggregator/coming-soon — surfaces
    // the "just works" tiles at the top without hiding the honest rest.
    const tierOrder: Record<string, number> = { instant: 0, login: 1, aggregator: 2 };
    return list.sort((a, b) => (tierOrder[a.frictionTier] ?? 9) - (tierOrder[b.frictionTier] ?? 9));
  }, [search, category]);

  // The existing search box should ALSO recognize a pasted URL instead of
  // just returning "No apps match your search" — the operator who reaches
  // for the only text field they can see shouldn't hit a dead end either.
  const searchDetected = useMemo(() => {
    const q = search.trim();
    if (!q || apps.length > 0) return null;
    const detected = detectApp(q);
    if (!detected) return null;
    const app = getApp(detected.appId);
    return app ? { app, prefill: detected.prefill } : null;
  }, [search, apps.length]);

  if (openApp) {
    return (
      <AppConfigForm
        app={openApp}
        initialValues={openInitialValues}
        onBack={closeApp}
        onDone={closeApp}
      />
    );
  }

  const hasFilters = !!search.trim() || category !== 'ALL';

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 shrink-0 space-y-2.5">
        <h2 className="text-sm font-bold text-slate-800">Apps</h2>

        {/* Paste-first / auto-detect — THE headline "wow": paste any link,
            we figure out which app it is and open it prefilled. */}
        <div>
          <label htmlFor="app-paste-anything" className="sr-only">Paste any link</label>
          <input
            id="app-paste-anything"
            type="text"
            inputMode="url"
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            placeholder="Paste any link — YouTube, Slides, Maps…"
            className="w-full px-3 py-2 text-xs border-2 border-indigo-200 rounded-lg bg-indigo-50/40 placeholder:text-indigo-400/70 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
          />
          {pasteMatch && (
            <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 min-w-0">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden />
                <span className="truncate">We recognized this — {pasteMatch.app.name}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const app = pasteMatch.app;
                  const prefill = pasteMatch.prefill;
                  setPasteValue('');
                  openAppWithValues(app, prefill);
                }}
                className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                Set up
              </button>
            </div>
          )}
          {pasteNoMatch && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400 px-0.5">
              <X className="w-3 h-3 shrink-0" aria-hidden />
              We couldn’t recognize that link — try searching below, or use Web Page / URL for any site.
            </div>
          )}
        </div>

        {/* Concierge auto-fill (Tier 2, 2026-07-01) — "we found this on
            your site" pinned row, ABOVE the grid. Non-blocking, dismissible,
            never a forced step. Only rendered once a discover call actually
            resolved matches; a still-loading or empty result renders
            nothing here (no skeleton flash for a background call). */}
        {showConciergeRow && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                <Wand2 className="w-3 h-3" aria-hidden />
                Suggested for you
              </div>
              <button
                type="button"
                onClick={() => setConciergeDismissed(true)}
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
                  onClick={() => openAppWithValues(app, prefill)}
                  className="flex items-center gap-1.5 text-[10px] font-semibold text-violet-800 bg-white border border-violet-200 rounded-full pl-1.5 pr-2.5 py-1 hover:border-violet-400 hover:bg-violet-50 transition-colors"
                  title={`We found this on your site — ${app.name}`}
                >
                  <AppIcon appId={app.id} name={app.icon} className="w-3 h-3 text-violet-500" />
                  We found your {app.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps…"
            aria-label="Search apps"
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>

        {/* No website suggestions available (either no sourceUrl on file, or
            discover found nothing we can offer) — fall through to the
            free-text /describe intake instead of silence. Kept tiny and
            collapsed-by-default feeling (a single input, not a form). */}
        {!showConciergeRow && !describeSuggestions && (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={describeValue}
              onChange={(e) => setDescribeValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDescribeSubmit(); }}
              placeholder="Tell us what you do (e.g. “coffee shop in Austin”)"
              aria-label="Describe your business to get app suggestions"
              className="flex-1 px-2.5 py-1.5 text-[11px] border border-dashed border-slate-300 rounded-md placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300"
            />
            <button
              type="button"
              onClick={() => handleDescribeSubmit()}
              disabled={!describeValue.trim() || describe.isPending}
              aria-label="Get app suggestions"
              className="shrink-0 p-1.5 rounded-md bg-violet-100 text-violet-600 hover:bg-violet-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {describe.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Wand2 className="w-3.5 h-3.5" aria-hidden />}
            </button>
          </div>
        )}
        {describeSuggestions && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                <Wand2 className="w-3 h-3" aria-hidden />
                Suggested for you
              </div>
              <button
                type="button"
                onClick={() => { setDescribeSuggestions(null); setDescribeValue(''); }}
                aria-label="Dismiss suggestions"
                className="text-violet-400 hover:text-violet-600"
              >
                <X className="w-3 h-3" aria-hidden />
              </button>
            </div>
            {describeSuggestions.length === 0 ? (
              <p className="text-[10px] text-violet-700/80">No matches yet — try browsing the grid below.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {describeSuggestions.map(({ app, prefill }) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => openAppWithValues(app, prefill)}
                    className="flex items-center gap-1.5 text-[10px] font-semibold text-violet-800 bg-white border border-violet-200 rounded-full pl-1.5 pr-2.5 py-1 hover:border-violet-400 hover:bg-violet-50 transition-colors"
                  >
                    <AppIcon appId={app.id} name={app.icon} className="w-3 h-3 text-violet-500" />
                    {app.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Category filter row */}
      <div
        role="group"
        aria-label="Filter by category"
        className="px-3 py-2 border-b border-slate-100 flex flex-wrap gap-1 shrink-0"
      >
        <CategoryChip label="All apps" active={category === 'ALL'} onClick={() => setCategory('ALL')} />
        {categories.map((c) => (
          <CategoryChip key={c} label={APP_CATEGORY_LABEL[c]} active={category === c} onClick={() => setCategory(c)} />
        ))}
      </div>

      {/* Card grid */}
      <div className="flex-1 overflow-auto p-3 bg-slate-50/40">
        {apps.length === 0 ? (
          <div className="text-center text-xs text-slate-400 py-10 px-2 space-y-3">
            {searchDetected ? (
              <div className="text-left rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 mb-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  We found a match: {searchDetected.app.name}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const { app, prefill } = searchDetected;
                    setSearch('');
                    openAppWithValues(app, prefill);
                  }}
                  className="w-full text-[10px] font-bold uppercase tracking-wide px-2 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                >
                  Click to set up
                </button>
              </div>
            ) : (
              <p>No apps match your search.</p>
            )}
            {hasFilters && (
              <button
                type="button"
                onClick={() => { setSearch(''); setCategory('ALL'); }}
                className="text-[10px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
              >
                Clear search &amp; filters
              </button>
            )}
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const webUrlApp = getApp('web-url');
                  if (webUrlApp) openAppWithValues(webUrlApp, undefined);
                }}
                className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
              >
                Or add any web page by URL
              </button>
              {!searchDetected && (
                <button
                  type="button"
                  onClick={() => {
                    const q = search.trim();
                    setDescribeValue(q);
                    setSearch('');
                    setCategory('ALL');
                    handleDescribeSubmit(q);
                  }}
                  className="text-[10px] font-semibold text-violet-600 hover:text-violet-700 underline underline-offset-2"
                >
                  Not sure? Describe your venue and we’ll pick apps
                </button>
              )}
            </div>
          </div>
        ) : (
          <div role="list" className="grid grid-cols-1 min-[340px]:grid-cols-2 gap-3">
            {apps.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                onClick={(trigger) => openAppWithValues(app, undefined, trigger)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400 shrink-0" aria-live="polite" role="status">
        {apps.length} app{apps.length === 1 ? '' : 's'} · {APP_REGISTRY.length} total
      </div>
    </div>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors ${
        active ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

function FrictionBadge({ tier }: { tier: AppDefinition['frictionTier'] }) {
  // The 'login' tier is currently unreachable in the UI: its only user
  // (google-reviews) is ALSO comingSoon, which renders the grey "Soon"
  // badge instead (see AppCard below) — never this one. Rather than ship
  // dead Lock-icon UI that implies a real tier exists today, only 'instant'
  // and 'aggregator' render a badge; 'login' falls through to nothing so
  // the code matches reality (discovery/mobile/a11y workstream, 2026-07-01).
  // Revisit when a real login-tier app ships.
  if (tier === 'login') return null;
  const label = FRICTION_TIER_LABEL[tier];
  const cls =
    tier === 'instant'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-violet-50 text-violet-700 border-violet-200';
  const Icon = tier === 'instant' ? null : AggregatorIcon;
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${cls}`}>
      {Icon && <Icon className="w-2.5 h-2.5" aria-hidden />}
      {label}
    </span>
  );
}

function AppCard({ app, onClick }: { app: AppDefinition; onClick: (trigger: HTMLButtonElement) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    // The interactive element itself (button) keeps its native role; the
    // `listitem` semantics live on this non-interactive wrapper instead of
    // being force-assigned onto the button (jsx-a11y flags overriding an
    // interactive element's implicit role with a non-interactive one).
    <div role="listitem">
      <button
        ref={ref}
        type="button"
        onClick={() => onClick(ref.current!)}
        title={app.blurb}
        className="group relative w-full rounded-xl border-2 border-slate-200 hover:border-indigo-300 transition-all overflow-hidden bg-white shadow-sm hover:shadow-lg text-left flex flex-col focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <div className="w-full bg-slate-100 flex items-center justify-center" style={{ aspectRatio: '16 / 10' }}>
          <AppIcon appId={app.id} name={app.icon} className="w-8 h-8 text-slate-400 group-hover:text-indigo-500 transition-colors" />
        </div>
        <div className="px-2.5 py-2 border-t border-slate-100 bg-white flex-1 flex flex-col gap-1">
          <div className="text-[11px] font-bold text-slate-700 truncate">{app.name}</div>
          <div className="text-[10px] text-slate-500 line-clamp-2 leading-snug min-h-[2.2em]">{app.blurb}</div>
          <div className="mt-1 flex items-center justify-between gap-1">
            <FrictionBadge tier={app.frictionTier} />
            {app.comingSoon && (
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                Soon
              </span>
            )}
          </div>
        </div>
      </button>
    </div>
  );
}

// Re-exported so AppConfigForm's "back" chevron can share the same visual
// language without duplicating the icon import list.
export { ChevronLeft };
