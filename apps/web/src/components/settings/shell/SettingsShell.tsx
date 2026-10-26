"use client";

/**
 * Settings — shared shell (Phase 1 simplification, 2026-10-26).
 *
 * Renders INSIDE the existing DashboardLayout (product rail + top toolbar are
 * preserved). Two shapes:
 *
 *   /settings            the Settings home — the page renders itself
 *                        (`SettingsHome`): search, what needs attention, the
 *                        six areas, Activity and My account.
 *   /settings/<page>     an area page: header (breadcrumb · area name · one
 *                        line · Search · Details · Discard/Save), the area's
 *                        page strip, then [six-area rail | editor] on desktop
 *                        or a full-width editor with "All settings" on a phone.
 *
 * What went (audit P8): the right-hand context rail took 260 px of a 917 px
 * workspace on the owner's 1325 px Safari, leaving ~400 px of text. A page's
 * context modules now open from a "Details" button (a drawer on desktop, the
 * end of the page on a phone), so the editor gets the room.
 *
 * Still owned here: the dirty navigation guard (Save / Discard / Stay), the
 * ⌘K search palette, and the no-access answer for a route this role cannot
 * open (Editors and Viewers are pointed at My account).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronRight, ChevronLeft, Search, PanelRight, Loader2, X, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import {
  canSeeSettings,
  routeAllowed,
  routeForPathname,
  settingsHomeHref,
  settingsSubpath,
  visibleTabs,
} from './registry';
import { SettingsIndex } from './SettingsIndex';
import { SettingsTabs } from './SettingsTabs';
import { SettingsCommandPalette } from './SettingsCommandPalette';
import { HelpText } from './primitives';
import { isDirty, useSettingsShell } from './SettingsShellContext';

export function SettingsShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const pathname = usePathname() ?? '';
  const role = useUIStore((s) => s.user?.role as string | undefined);
  const isMobile = useIsMobile();
  const { vertical } = useTenantCopy();
  const { page, navigate, dirtyPrompt, resolveDirtyPrompt, contextOpen, setContextOpen, paletteOpen, setPaletteOpen } = useSettingsShell();
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  const isHome = settingsSubpath(pathname) === '';
  const route = routeForPathname(pathname);
  const area = route?.area ?? null;
  const tabs = area ? visibleTabs(area, role, vertical) : [];
  // A tab hidden for this vertical but opened by URL still shows as current.
  const stripTabs = route && area && !tabs.some((tab) => tab.id === route.tab.id) ? [...tabs, route.tab] : tabs;
  const allowed = routeAllowed(pathname, role);

  const areaLabel = area ? t(`settings.shell.areas.${area.id}.label`) : null;
  const title = areaLabel ?? page?.title ?? t('nav.settings');
  const description = area ? t(`settings.shell.areas.${area.id}.description`) : page?.description;
  const save = page?.save;
  const dirty = isDirty(save);
  const saveLabel = save && typeof save.dirty === 'number' && save.dirty > 0
    ? t('settings.shell.saveCount', { count: save.dirty })
    : t('settings.shell.save');

  // ⌘K / Ctrl+K opens search anywhere in Settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setPaletteOpen]);

  // Close the Details drawer on route change.
  useEffect(() => {
    setContextOpen(false);
  }, [pathname, setContextOpen]);

  const palette = (
    <SettingsCommandPalette schoolId={schoolId} role={role} returnFocusTo={searchButtonRef} />
  );

  // The Settings home renders its own layout (search, attention, six areas).
  if (isHome) {
    return (
      <>
        {children}
        {palette}
      </>
    );
  }

  const saveActions = save ? (
    <>
      {dirty && !save.saving && (
        <button
          type="button"
          onClick={() => save.onDiscard?.()}
          className="min-h-[44px] px-3.5 rounded-[10px] border border-slate-200 bg-white text-[13px] font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        >
          {t('settings.shell.discard')}
        </button>
      )}
      <button
        type="button"
        // A page's onSave may REJECT on purpose (the dirty guard needs the
        // rejection to keep the editor dirty); the page renders its own
        // ErrorSummary. Swallow here so a failed header save is not an
        // unhandled promise rejection (People/SSO agent finding, 2026-09-02).
        onClick={() => { void Promise.resolve(save.onSave?.()).catch(() => {}); }}
        disabled={!dirty || !!save.saving}
        aria-disabled={!dirty || !!save.saving}
        className={cn(
          'min-h-[44px] px-3.5 rounded-[10px] text-[13px] font-medium inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
          dirty ? 'text-[var(--brand-primary-ink)] shadow-[0_6px_16px_rgba(15,23,42,.14)]' : 'text-slate-400 bg-slate-100 cursor-default',
        )}
        style={dirty ? { background: 'var(--brand-primary)' } : undefined}
      >
        {save.saving ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            {t('settings.common.saving')}
          </>
        ) : dirty ? (
          saveLabel
        ) : (
          t('settings.shell.noChanges')
        )}
      </button>
    </>
  ) : null;

  const home = settingsHomeHref(schoolId);
  const detailsButton = page?.context ? (
    <button
      type="button"
      onClick={() => setContextOpen(true)}
      aria-expanded={contextOpen}
      className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-[10px] border border-slate-200 bg-white text-[13px] font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
    >
      <PanelRight className="w-4 h-4" aria-hidden />
      {t('settings.shell.details')}
    </button>
  ) : null;

  return (
    <div className={cn('mx-auto w-full max-w-[1200px]', isMobile ? 'px-4 py-4' : 'px-6 py-6 lg:px-7')}>
      {/* Header */}
      <div className={cn('flex gap-3 mb-4', isMobile ? 'flex-col' : 'items-end justify-between')}>
        <div className="min-w-0">
          {isMobile ? (
            <button
              type="button"
              onClick={() => navigate(home)}
              className="inline-flex items-center gap-1 min-h-[44px] -ml-1 pr-2 text-[13px] font-medium text-slate-600 focus-visible:outline-none focus-visible:underline"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden />
              {t('settings.shell.allSettings')}
            </button>
          ) : (
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 mb-1.5 text-[12px] text-slate-500">
              <Link
                href={home}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  navigate(home);
                }}
                className="hover:text-slate-900 focus-visible:outline-none focus-visible:underline"
              >
                {t('nav.settings')}
              </Link>
              {areaLabel && (
                <>
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden />
                  <span className={page?.subtitle ? undefined : 'text-slate-700'}>{areaLabel}</span>
                </>
              )}
              {page?.subtitle && (
                <>
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden />
                  <span className="text-slate-700">{page.subtitle}</span>
                </>
              )}
            </nav>
          )}
          <h1 className={cn('font-medium tracking-[-.03em] text-slate-900', isMobile ? 'text-[24px] leading-[30px]' : 'text-[27px] leading-[34px]')}>{title}</h1>
          {description && <HelpText text={description} className="mt-1 text-[13px] leading-[18px] text-slate-500 max-w-2xl" />}
        </div>
        <div className={cn('flex items-center gap-2 shrink-0', isMobile && 'w-full flex-wrap')}>
          <button
            ref={searchButtonRef}
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={t('settings.shell.searchButton')}
            className={cn(
              'flex items-center gap-2 min-h-[44px] rounded-[11px] border border-slate-200 bg-slate-50 text-[13px] text-slate-500 text-left hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
              isMobile ? 'px-3' : 'w-[220px] lg:w-[260px] px-3',
            )}
          >
            <Search className="w-4 h-4 shrink-0" aria-hidden />
            <span className={cn('truncate', isMobile ? 'sr-only' : 'flex-1')}>{t('settings.shell.searchButton')}</span>
            {!isMobile && <kbd className="hidden lg:inline text-[11px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500">⌘K</kbd>}
          </button>
          {detailsButton}
          {page?.headerAction}
          {!isMobile && saveActions}
        </div>
      </div>

      {area && allowed && (
        <SettingsTabs schoolId={schoolId} area={area} tabs={stripTabs} activeTabId={route?.tab.id ?? null} />
      )}

      {/* Workspace */}
      <div
        className={cn(
          'rounded-[17px] border border-slate-200 bg-white overflow-hidden',
          !isMobile && 'grid grid-cols-[200px_minmax(0,1fr)] min-h-[560px]',
        )}
      >
        {!isMobile && (
          <aside className="bg-[#fbfcfe] border-r border-slate-200" aria-label={t('settings.shell.indexLabel')}>
            <div className="sticky top-4">
              <SettingsIndex schoolId={schoolId} role={role} activeArea={area?.id ?? null} />
            </div>
          </aside>
        )}

        <section className={cn('min-w-0', isMobile ? 'px-4 py-[18px]' : 'px-[26px] py-6')} aria-label={title}>
          {allowed ? children : (
            <NoAccess
              sectionLabel={area && route ? t(`settings.shell.tabs.${route.tab.id}`) : title}
              isAdmin={canSeeSettings(role)}
              schoolId={schoolId}
            />
          )}
          {isMobile && page?.context && (
            <div className="mt-8 pt-5 border-t border-slate-200">
              <h2 className="text-[13px] font-medium text-slate-900 mb-1">{t('settings.shell.details')}</h2>
              {page.context}
            </div>
          )}
        </section>
      </div>

      {/* Details drawer (desktop) */}
      {!isMobile && contextOpen && page?.context && (
        <div className="fixed top-0 right-0 bottom-0 left-0 z-[110]" role="dialog" aria-modal="true" aria-label={t('settings.shell.detailsLabel')}>
          <div className="absolute top-0 right-0 bottom-0 left-0 bg-slate-900/40" role="presentation" onClick={() => setContextOpen(false)} />
          <div className="absolute top-0 right-0 bottom-0 w-[340px] max-w-[90vw] bg-white border-l border-slate-200 p-[18px] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[13px] font-medium text-slate-900">{t('settings.shell.details')}</h2>
              <button type="button" onClick={() => setContextOpen(false)} aria-label={t('settings.common.cancel')} className="w-11 h-11 grid place-items-center rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>
            {page.context}
          </div>
        </div>
      )}

      {/* Sticky save bar on mobile, only while dirty */}
      {isMobile && save && dirty && (
        <div className="fixed left-0 right-0 bottom-0 z-[100] px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 bg-white border-t border-slate-200 flex items-center justify-end gap-2">
          {saveActions}
        </div>
      )}

      {/* Dirty navigation guard */}
      {dirtyPrompt && (
        <div className="fixed top-0 right-0 bottom-0 left-0 z-[130] grid place-items-center px-4 bg-slate-900/40">
          <div role="alertdialog" aria-modal="true" aria-labelledby="sv-dirty-title" aria-describedby="sv-dirty-body" className="w-full max-w-[420px] rounded-[14px] bg-white border border-slate-200 shadow-2xl p-5">
            <h2 id="sv-dirty-title" className="text-[15px] font-medium text-slate-900">{t('settings.shell.dirtyTitle')}</h2>
            <p id="sv-dirty-body" className="mt-1.5 text-[13px] text-slate-500">{t('settings.shell.dirtyBody')}</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" autoFocus onClick={() => resolveDirtyPrompt('stay')} className="min-h-[44px] px-3.5 rounded-[10px] border border-slate-200 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
                {t('settings.shell.dirtyStay')}
              </button>
              <button type="button" onClick={() => resolveDirtyPrompt('discard')} className="min-h-[44px] px-3.5 rounded-[10px] border border-red-200 text-[13px] font-medium text-red-700 hover:bg-red-50">
                {t('settings.shell.dirtyDiscard')}
              </button>
              {save?.onSave && (
                <button type="button" onClick={() => resolveDirtyPrompt('save')} className="min-h-[44px] px-3.5 rounded-[10px] text-[13px] font-medium text-[var(--brand-primary-ink)]" style={{ background: 'var(--brand-primary)' }}>
                  {t('settings.shell.dirtySave')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {palette}
    </div>
  );
}

/**
 * A route this role cannot open. An administrator is told who can grant it;
 * an Editor or Viewer — who no longer sees Settings at all — is pointed at
 * My account, where everything they CAN change lives.
 */
function NoAccess({ sectionLabel, isAdmin, schoolId }: { sectionLabel: string; isAdmin: boolean; schoolId: string }) {
  const t = useTranslations();
  return (
    <div className="rounded-[11px] border border-slate-200 bg-slate-50 px-5 py-6 text-center" data-testid="settings-no-access">
      <strong className="block text-[14px] font-medium text-slate-900">
        {t('settings.shell.noAccessTitle', { section: sectionLabel })}
      </strong>
      <p className="mt-1.5 text-[13px] text-slate-500">
        {isAdmin ? t('settings.shell.noAccessBody') : t('settings.shell.noAccessBodyAccount')}
      </p>
      <Link
        href={isAdmin ? settingsHomeHref(schoolId) : `/${schoolId}/account`}
        className="mt-4 inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-[10px] text-[13px] font-medium text-[var(--brand-primary-ink)]"
        style={{ background: 'var(--brand-primary)' }}
      >
        {!isAdmin && <UserRound className="w-4 h-4" aria-hidden />}
        {isAdmin ? t('settings.shell.backToSettings') : t('settings.shell.openMyAccount')}
      </Link>
    </div>
  );
}
