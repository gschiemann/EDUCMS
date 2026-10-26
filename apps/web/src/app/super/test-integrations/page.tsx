'use client';

/**
 * /super/test-integrations — the integration test tool, VenueOS staff only
 * (moved here from customer Settings on 2026-10-26). The super layout admits
 * SUPER_ADMIN only; the tool acts on the organization this session is in.
 */
import { useTranslations } from 'next-intl';
import { useAppStore } from '@/lib/store';
import { SettingsShellProvider } from '@/components/settings/shell/SettingsShellContext';
import { TestIntegrationsPanel } from '@/components/super/TestIntegrationsPanel';

export default function TestIntegrationsPage() {
  const t = useTranslations('businessConsole');
  const user = useAppStore((s) => s.user);
  const slug = useAppStore((s) => s.activeTenant) || user?.tenantSlug || user?.tenantId || '';
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8" data-testid="super-test-integrations">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t('testIntegrationsTitle')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('testIntegrationsBody')}</p>
      </header>
      {slug ? (
        <SettingsShellProvider>
          <TestIntegrationsPanel schoolId={slug} />
        </SettingsShellProvider>
      ) : (
        <p className="text-sm text-slate-600">{t('noOrganization')}</p>
      )}
    </div>
  );
}
