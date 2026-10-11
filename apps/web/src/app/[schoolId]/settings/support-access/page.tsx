'use client';

/**
 * /[schoolId]/settings/support-access — "VenueOS support access" (2026-10-11).
 *
 * The customer's control over VenueOS's reach into their organisation:
 * approve / deny a request, give access proactively, end it any time, and
 * see everything that was ever granted. Organisation-scoped: the grant lives
 * on the organisation root, so a location admin sees the same state as HQ.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { LifeBuoy } from 'lucide-react';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import { ContextModule, EditorHead, EditorSection, StatusPill } from '@/components/settings/shell/primitives';
import { SupportAccessSettings } from '@/components/support-access/SupportAccessSettings';
import { useMySupportAccess } from '@/hooks/use-support-access';
import { useAppStore } from '@/lib/store';

export default function SupportAccessSettingsPage() {
  const t = useTranslations();
  const user = useAppStore((s) => s.user);
  const { data } = useMySupportAccess(!!user && user.role !== 'SUPER_ADMIN');
  const state: 'active' | 'pending' | 'none' | 'unknown' = !data ? 'unknown' : data.active ? 'active' : data.pending.length ? 'pending' : 'none';

  const searchItems = useMemo(
    () => [
      { label: t('settings.cc.supportAccess.searchGive'), anchor: 'sa-section', keywords: ['venueos', 'support', 'access', 'help', 'remote', 'grant', 'approve'] },
    ],
    [t],
  );

  const context = (
    <>
      <ContextModule
        label={t('settings.cc.supportAccess.railStateLabel')}
        title={
          <StatusPill
            kind={state === 'active' ? 'attention' : state === 'pending' ? 'attention' : state === 'none' ? 'ready' : 'unknown'}
            label={t(`settings.cc.supportAccess.railState.${state}`)}
          />
        }
      >
        {t(`settings.cc.supportAccess.railStateBody.${state}`)}
      </ContextModule>
      <ContextModule label={t('settings.cc.supportAccess.railRuleLabel')} title={t('settings.cc.supportAccess.railRuleTitle')}>
        {t('settings.cc.supportAccess.railRuleBody')}
      </ContextModule>
    </>
  );

  return (
    <SettingsPageFrame
      section="supportAccess"
      title={t('settings.shell.sections.supportAccess.label')}
      description={t('settings.shell.sections.supportAccess.description')}
      searchItems={searchItems}
      context={context}
    >
      <EditorHead icon={LifeBuoy} title={t('settings.cc.supportAccess.editorTitle')} description={t('settings.cc.supportAccess.editorDesc')} />
      <EditorSection id="sa-section" title={t('settings.cc.supportAccess.sectionTitle')} description={t('settings.cc.supportAccess.sectionDesc')}>
        <SupportAccessSettings />
      </EditorSection>
    </SettingsPageFrame>
  );
}
