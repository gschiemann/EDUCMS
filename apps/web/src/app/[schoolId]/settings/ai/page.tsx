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
import { AiKeyCard } from '@/components/settings/AiKeyCard';
import { RoleGate } from '@/components/RoleGate';

export default function SettingsAiPage() {
  const params = useParams();
  const schoolId = params?.schoolId as string;

  return (
    <div>
      <div className="px-6 pt-5">
        <Link
          href={`/${schoolId}/settings`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-violet-600 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Settings
        </Link>
      </div>
      <div className="px-6 pb-5 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-600" />
          <div>
            <h1 className="text-lg font-bold">AI provider</h1>
            <p className="text-xs text-slate-500">
              Pick a provider, paste a key, choose a model. AI-generated copy
              (announcements, tickers, menu items, etc.) routes through your
              account at your provider&rsquo;s rates.
            </p>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        <RoleGate
          allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}
          fallback={
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Only district + school admins can configure the AI provider. Ask
              your administrator if you need this changed.
            </div>
          }
        >
          <AiKeyCard />
        </RoleGate>
      </div>
    </div>
  );
}
