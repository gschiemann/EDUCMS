"use client";

/**
 * Settings search (§12, rebuilt for Phase 1). Answers "how do I …" from
 * anywhere in Settings: the six areas, their pages, ~25 plain-language jobs
 * ("Change my logo", "Invite someone", "Square") and the fields of the page
 * you are on. Labels AND synonyms come from the catalogs, so a Spanish or
 * Chinese operator can search in their own words (audit P9 — synonyms used to
 * be English-only arrays). Respects the role/vertical filter: a place this
 * person cannot open never appears.
 *
 * Keyboard: arrows move, Enter opens, Escape closes, focus returns to the
 * search button that opened it.
 */
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, ChevronRight, UserRound, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  areaById,
  areaHref,
  tabHref,
  visibleAreas,
  visibleJobs,
  visibleTabs,
} from './registry';
import { useSettingsShell, type SettingsSearchItem } from './SettingsShellContext';
import { useTenantCopy } from '@/hooks/use-tenant-copy';

type IconType = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

interface PaletteResult {
  key: string;
  icon: IconType;
  label: string;
  detail: string;
  href: string;
  anchor?: string;
  /** True when the result is a field on the page that is open right now. */
  onThisPage?: boolean;
  score: number;
}

/** Split a translated "a, b, c" synonym list. */
function words(list: string): string[] {
  return list.split(/[,，、]/).map((w) => w.trim()).filter(Boolean);
}

export function SettingsCommandPalette({
  schoolId,
  role,
  returnFocusTo,
}: {
  schoolId: string;
  role: string | null | undefined;
  returnFocusTo: React.RefObject<HTMLElement | null>;
}) {
  const t = useTranslations();
  const { paletteOpen, setPaletteOpen, navigate, page } = useSettingsShell();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const params = useParams<{ schoolId: string }>();
  const slug = schoolId || params?.schoolId || '';

  const { vertical } = useTenantCopy();

  const results = useMemo<PaletteResult[]>(() => {
    const q = query.trim().toLowerCase();
    const out: PaletteResult[] = [];
    const scoreOf = (hay: readonly string[]) => {
      if (!q) return 0;
      let best = 0;
      for (const h of hay) {
        const s = h.toLowerCase();
        if (s === q) best = Math.max(best, 100);
        else if (s.startsWith(q)) best = Math.max(best, 80);
        else if (s.includes(q)) best = Math.max(best, 50);
      }
      return best;
    };
    const areas = visibleAreas(role, vertical);

    for (const area of areas) {
      const label = t(`settings.shell.areas.${area.id}.label`);
      const hay = [label, ...area.keywords, ...words(t(`settings.shell.areas.${area.id}.keywords`))];
      const score = q ? scoreOf(hay) : 1;
      if (score > 0) {
        out.push({
          key: `area:${area.id}`,
          icon: area.icon,
          label,
          detail: t(`settings.shell.areas.${area.id}.description`),
          href: areaHref(slug, area, role, vertical),
          score: score + 6,
        });
      }
      if (!q) continue;
      for (const tab of visibleTabs(area, role, vertical)) {
        const tabLabel = t(`settings.shell.tabs.${tab.id}`);
        const tabScore = scoreOf([tabLabel]);
        if (tabScore > 0 && tabLabel !== label) {
          out.push({ key: `tab:${tab.id}`, icon: area.icon, label: tabLabel, detail: label, href: tabHref(slug, tab), score: tabScore + 4 });
        }
      }
    }

    if (q) {
      for (const job of visibleJobs(role, vertical)) {
        const label = t(`settings.shell.jobs.${job.id}.label`);
        const score = scoreOf([label, ...job.keywords, ...words(t(`settings.shell.jobs.${job.id}.keywords`))]);
        if (score <= 0) continue;
        const [path, anchor] = job.href.split('#');
        const icon: IconType = job.area === 'account' ? UserRound : job.area === 'activity' ? History : areaById(job.area).icon;
        const detail = job.area === 'account' || job.area === 'activity'
          ? t(`settings.shell.jobAreas.${job.area}`)
          : t(`settings.shell.areas.${job.area}.label`);
        out.push({ key: `job:${job.id}`, icon, label, detail, href: `/${slug}/${path}`, anchor, score: score + 2 });
      }

      const pageItems: readonly SettingsSearchItem[] = page?.searchItems ?? [];
      for (const item of pageItems) {
        const score = scoreOf([item.label, ...(item.keywords ?? [])]);
        if (score > 0) {
          out.push({
            key: `item:${item.anchor ?? item.href ?? item.label}`,
            icon: Search,
            label: item.label,
            detail: page?.title ?? '',
            href: item.href ?? '',
            anchor: item.anchor,
            onThisPage: !item.href,
            score,
          });
        }
      }
    }

    // One row per destination; the best-scoring label wins.
    const seen = new Set<string>();
    return out
      .sort((a, b) => b.score - a.score)
      .filter((r) => {
        const dest = `${r.href}#${r.anchor ?? ''}#${r.label}`;
        if (seen.has(dest)) return false;
        seen.add(dest);
        return true;
      })
      .slice(0, 12);
  }, [query, role, vertical, page, slug, t]);

  // Whatever opened the palette gets focus back on close (the home's search
  // field, the header button, or the element that had focus for ⌘K).
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (paletteOpen) {
      openerRef.current = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
      setQuery('');
      setCursor(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [paletteOpen]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [cursor]);

  const close = () => {
    setPaletteOpen(false);
    window.setTimeout(() => (returnFocusTo.current ?? openerRef.current)?.focus?.(), 0);
  };

  const open = (r: PaletteResult) => {
    setPaletteOpen(false);
    const here = typeof window !== 'undefined' ? window.location.pathname : '';
    if (r.anchor && (r.onThisPage || r.href === here)) {
      const target = document.getElementById(r.anchor);
      if (target) {
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        const focusable = target.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]');
        (focusable ?? target).focus?.();
        return;
      }
    }
    if (!r.href) return;
    navigate(r.anchor ? `${r.href}#${r.anchor}` : r.href);
  };

  if (!paletteOpen) return null;

  return (
    <div className="fixed top-0 right-0 bottom-0 left-0 z-[120] flex items-start justify-center px-4 pt-[12vh] bg-slate-900/40" role="presentation" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.shell.paletteLabel')}
        className="w-full max-w-[560px] rounded-[14px] bg-white shadow-2xl border border-slate-200 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, Math.max(results.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const r = results[cursor];
            if (r) open(r);
          }
        }}
      >
        <div className="flex items-center gap-2.5 px-4 min-h-[52px] border-b border-slate-200">
          <Search className="w-4 h-4 text-slate-400" aria-hidden />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.shell.palettePlaceholder')}
            aria-label={t('settings.shell.palettePlaceholder')}
            aria-activedescendant={results[cursor] ? `sv-palette-${results[cursor].key}` : undefined}
            aria-controls="sv-palette-list"
            role="combobox"
            aria-expanded="true"
            className="flex-1 min-h-[44px] text-[14px] bg-transparent outline-none placeholder:text-slate-400"
          />
          <kbd className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500">Esc</kbd>
        </div>
        <div id="sv-palette-list" ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto py-1.5">
          {results.length === 0 && query.trim() && (
            <div className="px-4 py-6 text-center text-[13px] text-slate-500">{t('settings.shell.paletteEmpty', { query })}</div>
          )}
          {results.map((r, i) => {
            const Icon = r.icon;
            return (
              <div
                key={r.key}
                id={`sv-palette-${r.key}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => open(r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open(r);
                  }
                }}
                className={cn(
                  'mx-1.5 grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 min-h-[44px] px-2.5 rounded-[9px] cursor-pointer',
                  i === cursor ? 'text-[var(--brand-primary)]' : 'text-slate-700',
                )}
                style={i === cursor ? { background: 'var(--brand-primary-soft)' } : undefined}
              >
                <Icon className="w-[18px] h-[18px]" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium truncate">{r.label}</span>
                  <span className="block text-[11px] text-slate-500 truncate">{r.detail}</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" aria-hidden />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
