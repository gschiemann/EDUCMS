"use client";

/**
 * The page strip under an area's header: "Profile · Logo & colors ·
 * Locations · Student privacy". Each tab is an existing route (no URL
 * changed in Phase 1). Rendered only when the person sees two or more tabs.
 *
 * Navigation links, not an ARIA tablist: every tab is its own URL, so the
 * current one is `aria-current="page"`. On a phone the strip scrolls
 * sideways; the current tab is scrolled into view on mount.
 */
import { useEffect, useRef, type MouseEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { tabHref, type SettingsAreaDefinition, type SettingsTabDefinition } from './registry';
import { useSettingsShellActions } from './SettingsShellContext';

export function SettingsTabs({
  schoolId,
  area,
  tabs,
  activeTabId,
}: {
  schoolId: string;
  area: SettingsAreaDefinition;
  tabs: readonly SettingsTabDefinition[];
  activeTabId: string | null;
}) {
  const t = useTranslations('settings.shell');
  const { navigate } = useSettingsShellActions();
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  if (tabs.length < 2) return null;

  const onClick = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };

  return (
    <nav
      aria-label={t('tabsLabel', { area: t(`areas.${area.id}.label`) })}
      className="-mx-4 px-4 md:mx-0 md:px-0 mb-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-testid="settings-tabs"
    >
      <ul className="flex w-max min-w-full list-none m-0 p-0 border-b border-slate-200">
        {tabs.map((tab) => {
          const href = tabHref(schoolId, tab);
          const active = tab.id === activeTabId;
          return (
            <li key={tab.id} className="mr-1 last:mr-0">
              <Link
                ref={active ? activeRef : undefined}
                href={href}
                onClick={(e) => onClick(e, href)}
                aria-current={active ? 'page' : undefined}
                data-testid={`settings-tab-${tab.id}`}
                className={cn(
                  'relative inline-flex items-center min-h-[44px] px-3 text-[13px] font-medium whitespace-nowrap rounded-t-[8px] transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
                  active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50',
                )}
              >
                {t(`tabs.${tab.id}`)}
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full"
                    style={{ background: 'var(--brand-primary)' }}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
