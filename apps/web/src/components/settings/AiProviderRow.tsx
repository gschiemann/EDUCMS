/**
 * AiProviderRow — slim status card on /settings.
 *
 * 2026-05-25 — operator: "shouldnt it be like the others where i
 * click configure, it goes to another page where i set everything
 * up and the main setting page just shows whats configured once
 * your done." Mirrors the Industry / Emergency / Brand row pattern:
 * single line with a status pill + inline description + Configure
 * button that navigates to /settings/ai for the full configuration
 * flow.
 *
 * Fetches status from GET /ai/key + catalog labels from
 * GET /ai/key/catalog so the row reads e.g. "Anthropic · Claude 3.5
 * Haiku" without duplicating catalog data on the FE.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Sparkles, AlertCircle, Check, Loader2, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';

// 2026-05-26 audit AI-P0-5 — server-side gate on /settings/ai is
// SUPER_ADMIN | DISTRICT_ADMIN | SCHOOL_ADMIN. CONTRIBUTOR /
// RESTRICTED_VIEWER who saw the Configure CTA on /settings would land
// on a half-rendered page with an amber RoleGate message. Same set
// of roles as the server gate so the FE doesn't drift.
const AI_CONFIGURE_ROLES = new Set(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']);

interface AiKeyStatus {
  configured: boolean;
  provider: 'anthropic' | 'openai' | 'google' | null;
  model: string | null;
  keyHealthy: boolean | null;
  platformFallbackAvailable: boolean;
}
interface AiModelInfo {
  id: string;
  label: string;
}
interface AiProviderInfo {
  id: 'anthropic' | 'openai' | 'google';
  label: string;
  models: AiModelInfo[];
}

export function AiProviderRow() {
  const t = useTranslations();
  const params = useParams();
  const schoolId = params?.schoolId as string;
  const user = useAppStore((s) => s.user);
  const canConfigure = AI_CONFIGURE_ROLES.has((user?.role || '').toUpperCase());
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const [catalog, setCatalog] = useState<AiProviderInfo[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, c] = await Promise.all([
          apiFetch<AiKeyStatus>('/ai/key'),
          apiFetch<{ providers: AiProviderInfo[] }>('/ai/key/catalog').catch(() => ({ providers: [] })),
        ]);
        setStatus(s);
        setCatalog(c.providers);
      } catch {
        // API not deployed yet / not reachable — render the "not
        // configured" branch so the row still renders the Configure
        // CTA.
        setStatus({
          configured: false,
          provider: null,
          model: null,
          keyHealthy: null,
          platformFallbackAvailable: false,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Resolve provider + model labels from catalog (so the row reads
  // "Anthropic · Claude Haiku 4.5" not "anthropic · claude-haiku-4-5").
  const providerInfo = catalog?.find((p) => p.id === status?.provider);
  const modelInfo = providerInfo?.models.find((m) => m.id === status?.model);

  // Pick the state we're rendering. Five branches:
  //   1. loading
  //   2. configured + key healthy → "Connected — X · Y"
  //   3. configured + key NOT healthy → red banner ("re-enter key")
  //   4. not configured + platform fallback exists → "Free trial active"
  //   5. not configured + no fallback → "Set up AI"
  const renderStatusPill = () => {
    if (loading) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">
          <Loader2 className="w-3 h-3 animate-spin" /> {t('settings.common.loading')}
        </span>
      );
    }
    if (status?.configured && status?.keyHealthy === false) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-[11px] font-bold text-rose-700">
          <AlertCircle className="w-3 h-3" /> {t('settings.ai.keyBroken')}
        </span>
      );
    }
    if (status?.configured) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700">
          <Check className="w-3 h-3" /> {t('settings.ai.connected')}
        </span>
      );
    }
    if (status?.platformFallbackAvailable) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-[11px] font-bold text-violet-700">
          {t('settings.ai.freeTrial')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">
        {t('settings.ai.notSetUp')}
      </span>
    );
  };

  const renderInlineCopy = () => {
    if (loading) return null;
    if (status?.configured && status.keyHealthy === false) {
      return t('settings.ai.keyBrokenHint');
    }
    if (status?.configured && providerInfo && modelInfo) {
      return `${providerInfo.label} · ${modelInfo.label}`;
    }
    if (status?.configured && providerInfo) {
      return providerInfo.label;
    }
    if (status?.platformFallbackAvailable) {
      return t('settings.ai.freeTrialHint');
    }
    return t('settings.ai.setupHint');
  };

  // 2026-05-25 — colors normalized to indigo to match the Brand
  // row. Operator: "the configure button looks slightly diffrent on
  // AI provider on where its located and the color purple it
  // has...keep it standard size unless we need more space." Card
  // container + padding were always the same code as Brand /
  // Emergency; the only thing making AI look "off" was the violet
  // accent. Now all three admin settings rows share the same
  // `Configure` button style (indigo for AI + Brand, rose for
  // Emergency since rose is the dedicated emergency semantic).
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-indigo-600" />
        </div>
        <div className="min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-slate-800 shrink-0">{t('settings.ai.title')}</span>
          {renderStatusPill()}
          <span className="text-[11px] text-slate-500 truncate">{renderInlineCopy()}</span>
        </div>
      </div>
      {/* 2026-05-26 audit AI-P0-5 — Configure link is gated on the
          same role set the server uses (/settings/ai requires
          SUPER_ADMIN / DISTRICT_ADMIN / SCHOOL_ADMIN). Lower roles
          see a read-only "Admin only" pill instead of a dead link
          that would land them on a half-rendered RoleGate page. */}
      {canConfigure ? (
        <Link
          href={`/${schoolId}/settings/ai`}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors"
        >
          {status?.configured ? t('settings.common.manage') : t('settings.common.configure')}
        </Link>
      ) : (
        <span
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold cursor-not-allowed"
          title={t('settings.ai.adminOnlyTooltip')}
        >
          <Lock className="w-3 h-3" /> {t('settings.common.adminOnly')}
        </span>
      )}
    </div>
  );
}
