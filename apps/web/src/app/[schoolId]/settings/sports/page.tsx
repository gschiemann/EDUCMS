'use client';

/**
 * /[schoolId]/settings/sports — Settings → Sports (K-12 sports launch, lane
 * B3, 2026-09-27). Its first (and today only) editor is "Student information
 * on public screens": the school's FERPA directory-information and photo-
 * release attestations, and — for a non-K-12 tenant — "our athletes include
 * minors". See StudentPrivacySettingsCard for the rules; the API
 * (apps/api/src/sports/student-privacy.*) enforces them on every public output.
 *
 * No frame `save` prop: each action saves on its own, audited, and the card
 * only ever shows what the API answered (a legal attestation is never
 * optimistically confirmed).
 */
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import { ContextAction, ContextModule, EditorHead } from '@/components/settings/shell/primitives';
import { StudentPrivacySettingsCard } from '@/components/sports/StudentPrivacySettingsCard';
import { useTenant } from '@/hooks/use-api';

export default function SportsSettingsPage() {
  const params = useParams();
  const schoolId = String(params?.schoolId || '');
  const t = useTranslations();
  const { data: tenant } = useTenant();
  const orgName = (tenant as { name?: string } | undefined)?.name ?? '';

  // Memoized: SettingsPageFrame re-registers when `context` / `searchItems`
  // change identity (an inline node would loop the shell's registration).
  const searchItems = useMemo(
    () => [
      {
        label: t('studentPrivacy.title'),
        anchor: 'sp-names',
        keywords: ['ferpa', 'directory information', 'names', 'photo release', 'opt-out', 'minors'],
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const context = useMemo(
    () => (
      <ContextModule label={t('settings.cc.integrations.railAuditLabel')}>
        <ContextAction href={`/${schoolId}/audit`}>{t('settings.cc.integrations.railAuditAction')}</ContextAction>
      </ContextModule>
    ),
    // `t` changes identity every render; the copy is static per locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schoolId],
  );

  return (
    <SettingsPageFrame
      section="sports"
      title={t('settings.shell.sections.sports.label')}
      description={t('settings.shell.sections.sports.description')}
      context={context}
      searchItems={searchItems}
    >
      <EditorHead icon={ShieldCheck} title={t('studentPrivacy.title')} description={t('studentPrivacy.subtitle')} />
      <StudentPrivacySettingsCard orgName={orgName} />
    </SettingsPageFrame>
  );
}
