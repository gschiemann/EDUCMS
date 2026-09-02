/**
 * /[schoolId]/settings/ai — BYOK AI provider + brand voice.
 *
 * 2026-05-25 — operator: "shouldnt it be like the others where i
 * click configure, it goes to another page where i set everything
 * up and the main setting page just shows whats configured once
 * your done." The full BYOK form lives here; the catalog row links in.
 *
 * 2026-09-02 — migrated into the Settings Command Center shell
 * (handoff §7.7 / §19.2). The page-level back-link + H1 are GONE: the
 * shell owns breadcrumb (Settings / Integrations / AI provider & brand
 * voice), title, purpose line and the context rail. The body, the
 * RoleGate and both cards are untouched — this is a shell migration,
 * not a rewrite. No frame `save` prop: AiKeyCard and BrandVoiceCard
 * each own their own save + verification flow, and secrets are never
 * optimistically confirmed (§13.2).
 */
'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AiKeyCard } from '@/components/settings/AiKeyCard';
import { BrandVoiceCard } from '@/components/settings/BrandVoiceCard';
import { RoleGate } from '@/components/RoleGate';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import { ContextAction, ContextModule, EditorHead } from '@/components/settings/shell/primitives';

export default function SettingsAiPage() {
  const params = useParams();
  const schoolId = params?.schoolId as string;
  const t = useTranslations();

  const searchItems = useMemo(() => ([
        { label: t('settings.ai.title'), keywords: ['ai key', 'byok', 'anthropic', 'openai', 'gemini'] },
        { label: t('settings.aiVoice.title'), keywords: ['brand voice', 'tone'] },
      ] as const), []); // eslint-disable-line react-hooks/exhaustive-deps

  // MUST be memoized: <SettingsPageFrame> lists `context` / `searchItems`
  // in its registration effect's dependency array, so an inline node or a
  // fresh array re-registers on every render and the shell's setState
  // re-renders us - an unbounded loop ("Maximum update depth exceeded").
  const context = useMemo(
    () => (
    <>
      <ContextModule
        label={t('settings.cc.integrations.providerRail.appliesToLabel')}
        title={t('settings.cc.integrations.providerRail.appliesToValue')}
      />
      <ContextModule label={t('settings.cc.integrations.railAuditLabel')}>
        <ContextAction href={`/${schoolId}/audit`}>{t('settings.cc.integrations.railAuditAction')}</ContextAction>
      </ContextModule>
    </>
    ),
    // `t` is intentionally NOT a dependency: useTranslations() returns a
    // fresh function identity on every render, which would defeat the
    // memo and re-register the page in a loop. Copy is static per locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schoolId],
  );

  return (
    <SettingsPageFrame
      section="integrations"
      subtitle={t('settings.cc.integrations.families.ai')}
      title={t('settings.cc.integrations.pages.ai.title')}
      description={t('settings.cc.integrations.pages.ai.description')}
      context={context}
      searchItems={searchItems}
    >
      <EditorHead
        icon={Sparkles}
        title={t('settings.ai.title')}
        description={t('settings.ai.subtitle')}
      />

      <RoleGate
        allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}
        fallback={
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {t('settings.ai.adminOnlyNote')}
          </div>
        }
      >
        <div className="space-y-5">
          <AiKeyCard />
          <BrandVoiceCard />
        </div>
      </RoleGate>
    </SettingsPageFrame>
  );
}
