"use client";

/**
 * Settings index (§6.4): grouped navigation rows — 18–20px icon, short label,
 * at most ONE status indicator, 42px min height, brand-tinted selection.
 * Rows are real links (navigation semantics, §15), routed through the
 * shell's dirty guard.
 */
import type { MouseEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  SETTINGS_GROUP_ORDER,
  settingsHref,
  visibleSections,
  type SettingsSectionDefinition,
  type SettingsSectionId,
} from './registry';
import { useSettingsShell } from './SettingsShellContext';

export function SettingsIndex({
  schoolId,
  role,
  activeId,
  variant = 'rail',
  onNavigate,
}: {
  schoolId: string;
  role: string | null | undefined;
  activeId: SettingsSectionId | null;
  /** rail = desktop column; page = full-width mobile index route. */
  variant?: 'rail' | 'page';
  onNavigate?: () => void;
}) {
  const t = useTranslations();
  const { statuses, navigate } = useSettingsShell();
  const sections = visibleSections(role);

  const groups = SETTINGS_GROUP_ORDER.map((g) => ({
    id: g,
    label: t(`settings.shell.groups.${g}`),
    items: sections.filter((s) => s.group === g),
  })).filter((g) => g.items.length > 0);

  const onClick = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate?.();
    navigate(href);
  };

  return (
    <nav aria-label={t('settings.shell.indexLabel')} className={cn(variant === 'rail' ? 'p-3' : 'p-0')}>
      {variant === 'rail' && (
        <div className="px-2.5 pt-0.5 pb-3 text-[11px] font-medium tracking-[.08em] uppercase text-slate-500">
          {t('settings.shell.indexHeading')}
        </div>
      )}
      {groups.map((g, gi) => (
        <div key={g.id} className={cn(gi > 0 && (variant === 'rail' ? 'mt-3 pt-3 border-t border-slate-200' : 'mt-5'))}>
          <div className={cn('text-[11px] font-medium tracking-[.08em] uppercase text-slate-400', variant === 'rail' ? 'px-2.5 pb-1.5' : 'px-1 pb-2')}>
            {g.label}
          </div>
          <ul className="grid gap-[3px] list-none m-0 p-0">
            {g.items.map((s) => (
              <IndexRow
                key={s.id}
                section={s}
                href={settingsHref(schoolId, s)}
                label={t(`settings.shell.sections.${s.labelKey}.label`)}
                active={s.id === activeId}
                status={statuses[s.id] ?? null}
                variant={variant}
                onClick={onClick}
              />
            ))}
          </ul>
        </div>
      ))}
      {variant === 'rail' && (
        <div className="mx-2 mt-4 px-3 py-3 rounded-[10px] bg-slate-100/80">
          <strong className="block text-[12px] font-medium text-slate-900">{t('settings.shell.historyTitle')}</strong>
          <span className="block mt-1 text-[11px] leading-[15px] text-slate-500">{t('settings.shell.historyBody')}</span>
        </div>
      )}
    </nav>
  );
}

function IndexRow({
  section,
  href,
  label,
  active,
  status,
  variant,
  onClick,
}: {
  section: SettingsSectionDefinition;
  href: string;
  label: string;
  active: boolean;
  status: 'attention' | 'error' | null;
  variant: 'rail' | 'page';
  onClick: (e: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const t = useTranslations();
  const Icon = section.icon;
  return (
    <li>
      <Link
        href={href}
        onClick={(e) => onClick(e, href)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'grid items-center gap-2 rounded-[9px] text-[13px] font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
          variant === 'rail'
            ? 'grid-cols-[24px_minmax(0,1fr)_auto] min-h-[42px] px-2.5'
            : 'grid-cols-[28px_minmax(0,1fr)_auto] min-h-[52px] px-3 border border-slate-200 bg-white',
          active ? 'text-[var(--brand-primary)]' : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900',
        )}
        style={active ? { background: 'var(--brand-primary-soft)' } : undefined}
      >
        <Icon className="w-[18px] h-[18px]" aria-hidden />
        <span className="truncate">{label}</span>
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
}
