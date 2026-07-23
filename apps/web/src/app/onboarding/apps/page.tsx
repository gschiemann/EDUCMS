/**
 * Onboarding wizard — /onboarding/apps
 *
 * Task #265 (Day 2, 2026-07-01 launch sprint) — "Concierge auto-fill lands
 * in ONBOARDING": right after the branding step scrapes the tenant's
 * website, this step re-uses that SAME sourceUrl to ask the ALREADY-LIVE
 * Integration Concierge (`/integrations/discover`) what to put on the
 * operator's screens — "here's what we can put on your screens" — instead
 * of making the operator find this out later by opening a template's Apps
 * tab. See CLAUDE.md "AI Integration Concierge — vision" workstream 3.
 *
 * REUSE, not rebuild (per the mission brief): the suggestion-chip UI
 * (ConciergeSuggestionRow / ConciergeDescribeIntake), the resolver
 * (resolveConciergeSuggestions in concierge-map.ts), and the discover/
 * describe hooks (use-api.ts) are the EXACT same ones AppLibraryPanel's
 * Tier-2 "Suggested for you" row already ships. Nothing new was built for
 * discovery or resolution — only this page or the handoff.
 *
 * This step CANNOT reuse AppConfigForm directly — that component reads
 * `useBuilderStore` (the template canvas's Zustand store), which doesn't
 * exist yet in onboarding (there is no template open). So "Add" here does
 * the lightest honest thing instead of a fake/half canvas: it marks the
 * suggestion as picked and persists the resolved (appId, prefill) pairs to
 * a tenant-scoped localStorage handoff (saveOnboardingConciergeSuggestions
 * in concierge-map.ts) — the SAME pattern BrandingWizard already uses for
 * its own scan cache. AppLibraryPanel reads that handoff back
 * (readOnboardingConciergeSuggestions) BEFORE firing its own discover call,
 * so the very first time the operator opens any template's Apps tab, the
 * "Suggested for you" row is instantly pre-warmed with real detected links
 * — no new backend persistence, no new setting, nothing to configure.
 *
 * Never a wall: skippable in one tap at every state (loading, found
 * nothing, found some, all picked). No website on file, or discover finds
 * nothing → falls through to the same free-text "Tell us what you do"
 * describe intake the Apps panel uses.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useTenantBranding, useDiscoverIntegrations, useDescribeBusiness } from '@/hooks/use-api';
import {
  resolveConciergeSuggestions, saveOnboardingConciergeSuggestions,
  type SuggestedApp,
} from '@/components/apps/concierge-map';
import { ConciergeSuggestionRow, ConciergeDescribeIntake } from '@/components/apps/ConciergeAppSuggestions';
import type { AppDefinition } from '@/components/apps/app-registry';

export default function OnboardingAppsPage() {
  const t = useTranslations();
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const activeTenant = useAppStore((s) => s.activeTenant);
  const tenantId = user?.tenantId;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!user) router.replace('/login?next=/onboarding/apps');
  }, [user, router]);

  // The branding step just adopted a brand (or the operator arrived here
  // directly on a re-visit) — `/branding/me` is the source of truth for
  // the tenant's sourceUrl either way. staleTime is 60s so this is a cache
  // hit, not a fresh network round trip, in the common "just adopted"
  // path (BrandingWizard's adopt() already invalidated this query).
  const { data: branding, isLoading: brandingLoading } = useTenantBranding();
  const sourceUrl = branding?.sourceUrl?.trim() || '';

  const discover = useDiscoverIntegrations();
  const describe = useDescribeBusiness();
  const [suggestions, setSuggestions] = useState<SuggestedApp[]>([]);
  const [describeSuggestions, setDescribeSuggestions] = useState<SuggestedApp[] | null>(null);
  const [pickedAppIds, setPickedAppIds] = useState<Set<string>>(new Set());
  const [discoverDone, setDiscoverDone] = useState(false);

  // Fire discover ONCE, the moment we know the tenant's sourceUrl — this is
  // a first-run onboarding page, no remount-storm risk like the Apps panel
  // (which the operator can open/close repeatedly), so no module-level
  // session cache is needed here; the one useEffect firing once covers it.
  useEffect(() => {
    if (brandingLoading) return;
    if (!sourceUrl) { setDiscoverDone(true); return; }
    let alive = true;
    discover.mutate(
      { url: sourceUrl },
      {
        onSuccess: (res) => {
          if (!alive) return;
          setSuggestions(resolveConciergeSuggestions(res.candidates || [], res.ownLinks || {}));
          setDiscoverDone(true);
        },
        onError: () => { if (alive) setDiscoverDone(true); },
      },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl, brandingLoading]);

  // Persist the running pick-list to the onboarding->Apps-panel handoff on
  // every change, so navigating away (Skip, or the final "Go to dashboard")
  // never loses what was already tapped. Cheap no-op when there's nothing
  // to save yet (empty sourceUrl / no suggestions resolved).
  useEffect(() => {
    if (!sourceUrl) return;
    const all = describeSuggestions ? [...suggestions, ...describeSuggestions] : suggestions;
    if (all.length === 0) return;
    // De-dupe by app id — describe can resolve an app discover already did.
    const seen = new Set<string>();
    const deduped = all.filter((s) => (seen.has(s.app.id) ? false : (seen.add(s.app.id), true)));
    saveOnboardingConciergeSuggestions(tenantId, sourceUrl, deduped, pickedAppIds);
  }, [sourceUrl, tenantId, suggestions, describeSuggestions, pickedAppIds]);

  const handleDescribeSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    describe.mutate(
      { text: trimmed },
      {
        onSuccess: (res) => {
          setDescribeSuggestions(resolveConciergeSuggestions(res.candidates || [], res.ownLinks || {}));
        },
      },
    );
  };

  const handlePick = (app: AppDefinition) => {
    setPickedAppIds((prev) => {
      const next = new Set(prev);
      next.add(app.id);
      return next;
    });
  };

  const goToDashboard = () => {
    router.push(activeTenant ? `/${activeTenant}/dashboard?branded=1` : '/');
  };

  const visibleSuggestions = useMemo(
    () => suggestions.filter((s) => !pickedAppIds.has(s.app.id)),
    [suggestions, pickedAppIds],
  );
  const visibleDescribeSuggestions = useMemo(
    () => (describeSuggestions ? describeSuggestions.filter((s) => !pickedAppIds.has(s.app.id)) : null),
    [describeSuggestions, pickedAppIds],
  );
  const pickedApps = useMemo(
    () => [...suggestions, ...(describeSuggestions || [])].filter((s, i, arr) =>
      pickedAppIds.has(s.app.id) && arr.findIndex((x) => x.app.id === s.app.id) === i),
    [suggestions, describeSuggestions, pickedAppIds],
  );

  const stillWorking = brandingLoading || (!discoverDone && !!sourceUrl);
  const hasAnyDiscoverSuggestions = visibleSuggestions.length > 0 || pickedApps.length > 0;

  return (
    <div className="min-h-screen">
      <header className="px-6 py-3 border-b border-slate-200 bg-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-bold">VenueOS</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{t('onboardingPages.gettingStarted')}</span>
        </div>
        <button
          type="button"
          onClick={goToDashboard}
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          {t('onboardingPages.skipForNow')} →
        </button>
      </header>

      <div className="mx-auto max-w-xl px-4 pt-10 pb-16">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-violet-100 text-violet-600 mb-3">
            <Sparkles className="w-6 h-6" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold">{t('onboardingPages.appsReadyHeading')}</h1>
          <p className="text-slate-600 mt-1 text-sm">
            {sourceUrl
              ? t('onboardingPages.lookedAtWebsite')
              : t('onboardingPages.tellUsSuggest')}
          </p>
        </div>

        <div className="space-y-3">
          {stillWorking && (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-8">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              {t('onboardingPages.lookingAt', { business: sourceUrl || t('onboardingPages.yourBusiness') })}
            </div>
          )}

          {!stillWorking && hasAnyDiscoverSuggestions && (
            <ConciergeSuggestionRow
              suggestions={visibleSuggestions}
              onSelect={(app) => handlePick(app)}
              onDismiss={goToDashboard}
              chipLabel={(app) => t('onboardingPages.addYourApp', { name: app.name })}
            />
          )}

          {!stillWorking && !hasAnyDiscoverSuggestions && !describeSuggestions && (
            <ConciergeDescribeIntake
              placeholder={t('onboardingPages.describePlaceholder')}
              isPending={describe.isPending}
              results={null}
              onSubmit={handleDescribeSubmit}
              onSelect={(app) => handlePick(app)}
              onDismissResults={() => setDescribeSuggestions(null)}
            />
          )}

          {!stillWorking && describeSuggestions && visibleDescribeSuggestions && (
            <ConciergeDescribeIntake
              isPending={describe.isPending}
              results={visibleDescribeSuggestions}
              onSubmit={handleDescribeSubmit}
              onSelect={(app) => handlePick(app)}
              onDismissResults={() => setDescribeSuggestions(null)}
            />
          )}

          {pickedApps.length > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
                {t('onboardingPages.readyForAppsPanel')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {pickedApps.map(({ app }) => (
                  <span
                    key={app.id}
                    className="text-[11px] font-semibold text-emerald-800 bg-white border border-emerald-200 rounded-full px-2.5 py-1"
                  >
                    {app.name}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-emerald-700/80 leading-snug">
                {t('onboardingPages.prefilledHint')}
              </p>
            </div>
          )}

          {!stillWorking && !hasAnyDiscoverSuggestions && describeSuggestions && visibleDescribeSuggestions?.length === 0 && pickedApps.length === 0 && (
            <p className="text-center text-xs text-slate-400 pt-2">
              {t('onboardingPages.noMatchesYet')}
            </p>
          )}
        </div>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href={activeTenant ? `/${activeTenant}/dashboard?branded=1` : '/'}
            className="text-sm text-slate-500 hover:text-slate-900"
          >
            {t('onboardingPages.illDoThisLater')}
          </Link>
          <button
            type="button"
            onClick={goToDashboard}
            className="px-5 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
          >
            {pickedApps.length > 0 ? t('onboardingPages.goToDashboard') : t('onboardingPages.skipToDashboard')}
          </button>
        </div>
      </div>
    </div>
  );
}
