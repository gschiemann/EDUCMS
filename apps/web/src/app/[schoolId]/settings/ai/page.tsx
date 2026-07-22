/**
 * /[schoolId]/settings/ai — dedicated page for the BYOK AI provider
 * configuration.
 *
 * 2026-05-25 — operator: "shouldnt it be like the others where i
 * click configure, it goes to another page where i set everything
 * up and the main setting page just shows whats configured once
 * your done." Moved the full BYOK form off the main settings page
 * into here; the main page now shows a single-row status card
 * (AiProviderRow) with a Configure → /settings/ai link.
 *
 * Same back-link header pattern as /settings/branding,
 * /settings/billing, /settings/emergency, etc.
 */
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AiKeyCard } from '@/components/settings/AiKeyCard';
import { BrandVoiceCard } from '@/components/settings/BrandVoiceCard';
import { RoleGate } from '@/components/RoleGate';

export default function SettingsAiPage() {
  const params = useParams();
  const schoolId = params?.schoolId as string;
  const t = useTranslations();

  // 2026-05-25 — header pattern unified with /settings/emergency
  // per operator: "did you determine to not round the top menu
  // items under each setting? i suggested it but you just ignored
  // it." The old "full-width white box with border-b" looked square
  // against the page background. Same max-w-contained layout that
  // emergency uses is what everything else should look like.
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <header>
        <Link
          href={`/${schoolId}/settings`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {t('settings.common.back')}
        </Link>
        <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-indigo-500" />
          {t('settings.ai.title')}
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          {t('settings.ai.subtitle')}
        </p>
      </header>

      <RoleGate
        allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}
        fallback={
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {t('settings.ai.adminOnlyNote')}
          </div>
        }
      >
        <AiKeyCard />
        <BrandVoiceCard />
      </RoleGate>
    </div>
  );
}
