"use client";

/**
 * Settings Command Center — shared shell (§6, §9.2, §14).
 *
 * Renders INSIDE the existing DashboardLayout (product rail + top toolbar
 * are preserved, §6.1). Owns:
 *   - page header: breadcrumb · title · purpose · [secondary action] · Discard/Save
 *   - three-column workspace (index 205px / editor fluid / context 260px) ≥1280px
 *   - index + editor with a Context drawer 768–1279px
 *   - index-as-route + full-width editor + sticky save bar <768px
 *   - dirty navigation dialog (Save changes / Discard and continue / Stay here)
 *   - ⌘K command palette
 *
 * Measurements from scratch/design/settings-page/venueos-settings-command-center-v2.html.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronRight, ChevronLeft, Search, PanelRight, Loader2, X, Building2, MapPin, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { useTenant } from '@/hooks/use-api';
import { useIsMobile } from '@/hooks/use-mobile';
import { SETTINGS_SECTIONS, sectionForPathname, settingsHref, visibleSections } from './registry';
import { SettingsIndex } from './SettingsIndex';
import { SettingsCommandPalette } from './SettingsCommandPalette';
import { isDirty, useSettingsShell } from './SettingsShellContext';

export function SettingsShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const pathname = usePathname() ?? '';
  const role = useUIStore((s) => s.user?.role as string | undefined);
  const { data: tenant } = useTenant();
  const isMobile = useIsMobile();
  const { page, navigate, dirtyPrompt, resolveDirtyPrompt, contextOpen, setContextOpen, paletteOpen, setPaletteOpen } = useSettingsShell();
  const commandButtonRef = useRef<HTMLButtonElement>(null);

  const routeSection = sectionForPathname(pathname);
  const activeId = page?.section ?? routeSection?.id ?? null;
  const activeDef = activeId ? SETTINGS_SECTIONS.find((s) => s.id === activeId) ?? null : null;
  const isIndexRoute = /\/settings\/?$/.test(pathname);
  const allowed = activeDef ? visibleSections(role).some((s) => s.id === activeDef.id) : true;

  const tenantName = (tenant as { name?: string } | undefined)?.name ?? '';
  const scope = page?.scope ?? (activeDef?.scopes.includes('account') && !activeDef.scopes.includes('organization')
    ? { kind: 'account' as const, label: t('settings.shell.scopePersonal') }
    : { kind: 'organization' as const, label: tenantName });

  const title = page?.title ?? (activeDef ? t(`settings.shell.sections.${activeDef.labelKey}.label`) : t('nav.settings'));
  const description = page?.description ?? (activeDef ? t(`settings.shell.sections.${activeDef.descriptionKey}.description`) : undefined);
  const save = page?.save;
  const dirty = isDirty(save);
  const saveLabel = save && typeof save.dirty === 'number' && save.dirty > 0
    ? t('settings.shell.saveCount', { count: save.dirty })
    : t('settings.shell.save');

  // ⌘K / Ctrl+K opens the palette while inside Settings.
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

  // Close the context drawer on route change.
  useEffect(() => {
    setContextOpen(false);
  }, [pathname, setContextOpen]);

  const ScopeIcon = scope.kind === 'account' ? UserRound : scope.kind === 'location' ? MapPin : Building2;

  // Mobile: `/settings` is the category index (its own view, §14).
  if (isMobile && isIndexRoute) {
    return (
      <div className="px-4 py-5">
        <h1 className="text-[26px] leading-[32px] font-medium tracking-[-.03em] text-slate-900">{t('nav.settings')}</h1>
        <p className="mt-1 text-[13px] text-slate-500 flex items-center gap-1.5">
          <ScopeIcon className="w-3.5 h-3.5" aria-hidden />
          {scope.label}
        </p>
        <div className="mt-5">
          <SettingsIndex schoolId={schoolId} role={role} activeId={null} variant="page" />
        </div>
        <SettingsCommandPalette schoolId={schoolId} role={role} scopeLabel={scope.label} returnFocusTo={commandButtonRef} />
      </div>
    );
  }

  const saveActions = save ? (
    <>
      {dirty && !save.saving && (
        <button
          type="button"
          onClick={() => save.onDiscard?.()}
          className="min-h-[42px] px-3.5 rounded-[10px] border border-slate-200 bg-white text-[13px] font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        >
          {t('settings.shell.discard')}
        </button>
      )}
      <button
        type="button"
        onClick={() => save.onSave?.()}
        disabled={!dirty || !!save.saving}
        aria-disabled={!dirty || !!save.saving}
        className={cn(
          'min-h-[42px] px-3.5 rounded-[10px] text-[13px] font-medium inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
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

  return (
    <div className={cn('mx-auto w-full max-w-[1400px]', isMobile ? 'px-4 py-4' : 'px-6 py-6 lg:px-7')}>
      {/* Page header (§6.2). Pages that have not registered through
          <SettingsPageFrame> yet still carry their own header inside the
          editor column, so the shell header renders only for registered pages. */}
      {page && (
      <div className={cn('flex gap-4 mb-[22px]', isMobile ? 'flex-col' : 'items-end justify-between')}>
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 mb-1.5 text-[12px] text-slate-500">
            <button
              type="button"
              onClick={() => navigate(isMobile ? `/${schoolId}/settings` : settingsHref(schoolId, 'overview'))}
              className="hover:text-slate-900 focus-visible:outline-none focus-visible:underline"
            >
              {t('nav.settings')}
            </button>
            {activeDef && (
              <>
                <ChevronRight className="w-3.5 h-3.5" aria-hidden />
                <span className={page?.subtitle ? undefined : 'text-slate-700'}>{t(`settings.shell.sections.${activeDef.labelKey}.label`)}</span>
              </>
            )}
            {page?.subtitle && (
              <>
                <ChevronRight className="w-3.5 h-3.5" aria-hidden />
                <span className="text-slate-700">{page.subtitle}</span>
              </>
            )}
          </nav>
          <h1 className="text-[27px] leading-[34px] font-medium tracking-[-.03em] text-slate-900">{title}</h1>
          {description && <p className="mt-1 text-[13px] leading-[18px] text-slate-500 max-w-2xl">{description}</p>}
        </div>
        <div className={cn('flex items-center gap-2 shrink-0', isMobile && 'w-full justify-end flex-wrap')}>
          {!isMobile && (
            <button
              ref={commandButtonRef}
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden lg:flex items-center gap-2 min-h-[42px] w-[300px] xl:w-[340px] px-3 rounded-[11px] border border-slate-200 bg-slate-50 text-[13px] text-slate-500 text-left hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            >
              <Search className="w-4 h-4" aria-hidden />
              <span className="flex-1 truncate">{t('settings.shell.palettePlaceholder')}</span>
              <kbd className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500">⌘K</kbd>
            </button>
          )}
          {page?.headerAction}
          {!isMobile && saveActions}
        </div>
      </div>
      )}

      {/* Workspace (§6.3) */}
      <div
        className={cn(
          'rounded-[17px] border border-slate-200 bg-white overflow-hidden',
          !isMobile && 'grid grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[205px_minmax(0,1fr)_260px] min-h-[620px]',
        )}
      >
        {!isMobile && (
          <aside className="bg-[#fbfcfe] border-r border-slate-200" aria-label={t('settings.shell.indexLabel')}>
            <div className="sticky top-4">
              <SettingsIndex schoolId={schoolId} role={role} activeId={activeId} />
            </div>
          </aside>
        )}

        <section className={cn('min-w-0', isMobile ? 'px-4 py-[18px]' : 'px-[26px] py-6')} aria-label={title}>
          {isMobile && (
            <button
              type="button"
              onClick={() => navigate(`/${schoolId}/settings`)}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-2.5 mb-3.5 rounded-[9px] border border-slate-200 text-[13px] font-medium text-slate-600"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden />
              {t('settings.shell.allSettings')}
            </button>
          )}
          {!isMobile && page?.context && (
            <div className="xl:hidden flex justify-end -mt-1 mb-3">
              <button
                type="button"
                onClick={() => setContextOpen(true)}
                aria-expanded={contextOpen}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 rounded-[9px] border border-slate-200 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
              >
                <PanelRight className="w-4 h-4" aria-hidden />
                {t('settings.shell.context')}
              </button>
            </div>
          )}
          {allowed ? children : (
            <div className="rounded-[11px] border border-slate-200 bg-slate-50 px-5 py-6 text-center">
              <strong className="block text-[14px] font-medium text-slate-900">
                {t('settings.shell.noAccessTitle', { section: activeDef ? t(`settings.shell.sections.${activeDef.labelKey}.label`) : t('nav.settings') })}
              </strong>
              <p className="mt-1.5 text-[13px] text-slate-500">{t('settings.shell.noAccessBody')}</p>
            </div>
          )}
          {isMobile && page?.context && (
            <div className="mt-8 pt-5 border-t border-slate-200">
              <h3 className="text-[13px] font-medium text-slate-900 mb-1">{t('settings.shell.context')}</h3>
              {page.context}
            </div>
          )}
        </section>

        {!isMobile && (
          <aside className="hidden xl:block bg-[#fafbfe] border-l border-slate-200 p-[18px]" aria-label={t('settings.shell.contextLabel')}>
            {page?.context ?? (
              <p className="text-[12px] text-slate-400">{t('settings.shell.contextEmpty')}</p>
            )}
          </aside>
        )}
      </div>

      {/* Context drawer, 960–1279px (§14) */}
      {!isMobile && contextOpen && page?.context && (
        <div className="fixed top-0 right-0 bottom-0 left-0 z-[110] xl:hidden" role="dialog" aria-modal="true" aria-label={t('settings.shell.contextLabel')}>
          <div className="absolute top-0 right-0 bottom-0 left-0 bg-slate-900/40" onClick={() => setContextOpen(false)} />
          <div className="absolute top-0 right-0 bottom-0 w-[320px] max-w-[90vw] bg-white border-l border-slate-200 p-[18px] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-medium text-slate-900">{t('settings.shell.context')}</h3>
              <button type="button" onClick={() => setContextOpen(false)} aria-label={t('settings.common.cancel')} className="w-9 h-9 grid place-items-center rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>
            {page.context}
          </div>
        </div>
      )}

      {/* Sticky save bar on mobile, only while dirty (§14) */}
      {isMobile && save && dirty && (
        <div className="fixed left-0 right-0 bottom-0 z-[100] px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 bg-white/95 border-t border-slate-200 flex items-center justify-end gap-2">
          {saveActions}
        </div>
      )}

      {/* Dirty navigation guard (§9.2) */}
      {dirtyPrompt && (
        <div className="fixed top-0 right-0 bottom-0 left-0 z-[130] grid place-items-center px-4 bg-slate-900/40">
          <div role="alertdialog" aria-modal="true" aria-labelledby="sv-dirty-title" aria-describedby="sv-dirty-body" className="w-full max-w-[420px] rounded-[14px] bg-white border border-slate-200 shadow-2xl p-5">
            <h2 id="sv-dirty-title" className="text-[15px] font-medium text-slate-900">{t('settings.shell.dirtyTitle')}</h2>
            <p id="sv-dirty-body" className="mt-1.5 text-[13px] text-slate-500">{t('settings.shell.dirtyBody')}</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" autoFocus onClick={() => resolveDirtyPrompt('stay')} className="min-h-[42px] px-3.5 rounded-[10px] border border-slate-200 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
                {t('settings.shell.dirtyStay')}
              </button>
              <button type="button" onClick={() => resolveDirtyPrompt('discard')} className="min-h-[42px] px-3.5 rounded-[10px] border border-red-200 text-[13px] font-medium text-red-700 hover:bg-red-50">
                {t('settings.shell.dirtyDiscard')}
              </button>
              {save?.onSave && (
                <button type="button" onClick={() => resolveDirtyPrompt('save')} className="min-h-[42px] px-3.5 rounded-[10px] text-[13px] font-medium text-[var(--brand-primary-ink)]" style={{ background: 'var(--brand-primary)' }}>
                  {t('settings.shell.dirtySave')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <SettingsCommandPalette schoolId={schoolId} role={role} scopeLabel={scope.label} returnFocusTo={commandButtonRef} />
    </div>
  );
}
