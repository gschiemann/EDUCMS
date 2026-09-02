"use client";

/**
 * Settings command palette (§12). Searches category labels, per-page field
 * labels and synonyms, provider names and location names. Respects the
 * permission filter — hidden sections never appear in results.
 *
 * Keyboard: arrows move, Enter opens, Escape closes, focus returns to the
 * command button that opened it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, ChevronRight, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { settingsHref, visibleSections, type SettingsSectionDefinition } from './registry';
import { useSettingsShell, type SettingsSearchItem } from './SettingsShellContext';

interface PaletteResult {
  key: string;
  section: SettingsSectionDefinition | null;
  label: string;
  detail: string;
  href: string;
  anchor?: string;
  score: number;
}

export interface PaletteLocation {
  id: string;
  name: string;
  href: string;
}

export function SettingsCommandPalette({
  schoolId,
  role,
  scopeLabel,
  locations = [],
  returnFocusTo,
}: {
  schoolId: string;
  role: string | null | undefined;
  scopeLabel: string;
  locations?: readonly PaletteLocation[];
  returnFocusTo: React.RefObject<HTMLElement | null>;
}) {
  const t = useTranslations();
  const { paletteOpen, setPaletteOpen, navigate, page } = useSettingsShell();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => visibleSections(role), [role]);

  const results = useMemo<PaletteResult[]>(() => {
    const q = query.trim().toLowerCase();
    const out: PaletteResult[] = [];
    const scoreOf = (hay: readonly string[]) => {
      if (!q) return 1;
      let best = 0;
      for (const h of hay) {
        const s = h.toLowerCase();
        if (s === q) best = Math.max(best, 100);
        else if (s.startsWith(q)) best = Math.max(best, 80);
        else if (s.includes(q)) best = Math.max(best, 50);
      }
      return best;
    };
    for (const s of sections) {
      const label = t(`settings.shell.sections.${s.labelKey}.label`);
      const desc = t(`settings.shell.sections.${s.descriptionKey}.description`);
      const score = scoreOf([label, ...s.keywords]);
      if (score > 0) {
        out.push({ key: `sec:${s.id}`, section: s, label, detail: desc, href: settingsHref(schoolId, s), score: score + 5 });
      }
    }
    const pageItems: readonly SettingsSearchItem[] = page?.searchItems ?? [];
    const pageSection = page ? sections.find((s) => s.id === page.section) ?? null : null;
    if (pageSection) {
      for (const item of pageItems) {
        const score = scoreOf([item.label, ...(item.keywords ?? [])]);
        if (score > 0) {
          out.push({
            key: `item:${item.anchor ?? item.href ?? item.label}`,
            section: pageSection,
            label: item.label,
            detail: t(`settings.shell.sections.${pageSection.labelKey}.label`),
            href: item.href ?? settingsHref(schoolId, pageSection),
            anchor: item.anchor,
            score,
          });
        }
      }
    }
    for (const loc of locations) {
      const score = q ? scoreOf([loc.name]) : 0;
      if (score > 0) {
        out.push({ key: `loc:${loc.id}`, section: null, label: loc.name, detail: t('settings.shell.paletteSwitchScope'), href: loc.href, score: score - 10 });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 12);
  }, [query, sections, page, locations, schoolId, t]);

  useEffect(() => {
    if (paletteOpen) {
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
    window.setTimeout(() => returnFocusTo.current?.focus(), 0);
  };

  const open = (r: PaletteResult) => {
    setPaletteOpen(false);
    if (r.anchor && page && r.section?.id === page.section) {
      const target = document.getElementById(r.anchor);
      if (target) {
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        const focusable = target.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]');
        (focusable ?? target).focus?.();
        return;
      }
    }
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
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-slate-500">{t('settings.shell.paletteEmpty', { query })}</div>
          )}
          {results.map((r, i) => {
            const Icon = r.section?.icon ?? MapPin;
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
                <span className="flex items-center gap-1 text-[11px] text-slate-400 whitespace-nowrap">
                  {r.section ? scopeLabel : null}
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
