"use client";

/**
 * /[schoolId]/settings/overview — Settings Overview (§7.1).
 *
 * Wave-1 state: the shared shell is live and the previous all-in-one
 * landing page renders here as the editor body so every capability stays
 * reachable while each category is extracted into its own route (§20,
 * Wave 2). The Overview readiness summary replaces this body when the
 * category routes land.
 */
import { useTranslations } from 'next-intl';
import { useTenant } from '@/hooks/use-api';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import { LegacySettingsPage } from '../_legacy/LegacySettingsPage';

export default function SettingsOverviewPage() {
  const t = useTranslations();
  const { data: tenant } = useTenant();
  const tenantName = (tenant as { name?: string } | undefined)?.name ?? '';
  return (
    <SettingsPageFrame
      section="overview"
      title={t('settings.shell.sections.overview.label')}
      description={t('settings.shell.sections.overview.description')}
      scope={{ kind: 'organization', label: tenantName }}
    >
      <LegacySettingsPage />
    </SettingsPageFrame>
  );
}
