"use client";

/**
 * Settings rail (desktop) — the six areas, nothing else (Phase 1, 2026-10-26).
 *
 * One row per area: icon, plain name, at most ONE status dot (the worst of
 * the area's pages). Rows are real links routed through the shell's dirty
 * guard. The rail heading goes back to the Settings home.
 */
import type { MouseEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  areaHref,
  settingsHomeHref,
  visibleAreas,
  type SettingsAreaDefinition,
  type SettingsAreaId,
  type SettingsSectionId,
} from './registry';
import { useSettingsShell, type SettingsSectionStatus } from './SettingsShellContext';
import { useTenantCopy } from '@/hooks/use-tenant-copy';

/** The worst status of an area's pages: error > attention > none. */
export function areaStatus(
  area: SettingsAreaDefinition,
  statuses: Partial<Record<SettingsSectionId, SettingsSectionStatus>>,
): SettingsSectionStatus {
  let worst: SettingsSectionStatus = null;
  for (const tab of area.tabs) {
    const s = statuses[tab.section] ?? null;
    if (s === 'error') return 'error';
    if (s === 'attention') worst = 'attention';
  }
  return worst;
}

export function SettingsIndex({
  schoolId,
  role,
  activeArea,
  onNavigate,
}: {
  schoolId: string;
  role: string | null | undefined;
  activeArea: SettingsAreaId | null;
  onNavigate?: () => void;
}) {
  const t = useTranslations();
  const { statuses, navigate } = useSettingsShell();
  const { vertical } = useTenantCopy();
  const areas = visibleAreas(role, vertical);

  const onClick = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate?.();
    navigate(href);
  };

  const home = settingsHomeHref(schoolId);
  return (
    <nav aria-label={t('settings.shell.indexLabel')} className="p-3">
      <Link
        href={home}
        onClick={(e) => onClick(e, home)}
        className="block px-2.5 pt-0.5 pb-3 text-[11px] font-medium tracking-[.08em] uppercase text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:underline"
      >
        {t('nav.settings')}
      </Link>
      <ul className="grid gap-[3px] list-none m-0 p-0">
        {areas.map((area) => {
          const href = areaHref(schoolId, area, role, vertical);
          const active = area.id === activeArea;
          const status = areaStatus(area, statuses);
          const Icon = area.icon;
          return (
            <li key={area.id}>
              <Link
                href={href}
                onClick={(e) => onClick(e, href)}
                aria-current={active ? 'page' : undefined}
                data-testid={`settings-rail-${area.id}`}
                className={cn(
                  'grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 min-h-[44px] px-2.5 rounded-[9px] text-[13px] font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
                  active ? 'text-[var(--brand-primary)]' : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900',
                )}
                style={active ? { background: 'var(--brand-primary-soft)' } : undefined}
              >
                <Icon className="w-[18px] h-[18px]" aria-hidden />
                <span className="truncate">{t(`settings.shell.areas.${area.id}.label`)}</span>
                {status ? (
                  <span
                    className={cn('w-[7px] h-[7px] rounded-full', status === 'error' ? 'bg-red-600' : 'bg-amber-500')}
                    role="img"
                    aria-label={status === 'error' ? t('settings.shell.statusError') : t('settings.shell.statusAttention')}
                  />
                ) : (
                  <span aria-hidden />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
