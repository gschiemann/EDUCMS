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
 * design this implements (Phase 1: shell + instant apps).
 */

import { useMemo, useState } from 'react';
import {
  Search, ChevronLeft, Lock, Sparkles as AggregatorIcon,
  Tv, Video, Radio, Presentation, FileText, Palette, Table, Globe, MapPin,
  QrCode, Clock, Timer, Cloud, Rss, CalendarDays, Users, ThumbsUp, LayoutGrid, Star,
  type LucideIcon,
} from 'lucide-react';
import {
  APP_REGISTRY, APP_CATEGORY_LABEL, FRICTION_TIER_LABEL,
  listAppCategories,
  type AppDefinition, type AppCategory,
} from './app-registry';
import { AppConfigForm } from './AppConfigForm';

// String -> component map. Kept local to the panel (not the registry file)
// so app-registry.ts stays React-free / easily unit-testable.
const ICONS: Record<string, LucideIcon> = {
  Tv, Video, Radio, Presentation, FileText, Palette, Table, Globe, MapPin,
  QrCode, Clock, Timer, Cloud, Rss, CalendarDays, Users, ThumbsUp, LayoutGrid, Star,
};

function AppIcon({ name, className }: { name: string; className?: string }) {
  const Cmp = ICONS[name] || Globe;
  return <Cmp className={className} aria-hidden />;
}

export function AppLibraryPanel() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<AppCategory | 'ALL'>('ALL');
  const [openApp, setOpenApp] = useState<AppDefinition | null>(null);

  const categories = useMemo(() => listAppCategories(), []);

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

  if (openApp) {
    return <AppConfigForm app={openApp} onBack={() => setOpenApp(null)} onDone={() => setOpenApp(null)} />;
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 shrink-0">
        <h2 className="text-sm font-bold text-slate-800 mb-2">Apps</h2>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps…"
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
      </div>

      {/* Category filter row */}
      <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap gap-1 shrink-0">
        <CategoryChip label="All apps" active={category === 'ALL'} onClick={() => setCategory('ALL')} />
        {categories.map((c) => (
          <CategoryChip key={c} label={APP_CATEGORY_LABEL[c]} active={category === c} onClick={() => setCategory(c)} />
        ))}
      </div>

      {/* Card grid */}
      <div className="flex-1 overflow-auto p-3 bg-slate-50/40">
        {apps.length === 0 ? (
          <div className="text-center text-xs text-slate-400 py-12">
            No apps match your search.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {apps.map((app) => (
              <AppCard key={app.id} app={app} onClick={() => setOpenApp(app)} />
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
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
      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors ${
        active ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

function FrictionBadge({ tier }: { tier: AppDefinition['frictionTier'] }) {
  const label = FRICTION_TIER_LABEL[tier];
  const cls =
    tier === 'instant'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : tier === 'login'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-violet-50 text-violet-700 border-violet-200';
  const Icon = tier === 'instant' ? null : tier === 'login' ? Lock : AggregatorIcon;
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${cls}`}>
      {Icon && <Icon className="w-2.5 h-2.5" aria-hidden />}
      {label}
    </span>
  );
}

function AppCard({ app, onClick }: { app: AppDefinition; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={app.blurb}
      className="group relative rounded-xl border-2 border-slate-200 hover:border-indigo-300 transition-all overflow-hidden bg-white shadow-sm hover:shadow-lg text-left flex flex-col"
    >
      <div className="w-full bg-slate-100 flex items-center justify-center" style={{ aspectRatio: '16 / 10' }}>
        <AppIcon name={app.icon} className="w-8 h-8 text-slate-400 group-hover:text-indigo-500 transition-colors" />
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
  );
}

// Re-exported so AppConfigForm's "back" chevron can share the same visual
// language without duplicating the icon import list.
export { ChevronLeft };
