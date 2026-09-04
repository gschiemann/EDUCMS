
/**
 * SEC-010 (2026-09-04) — rendered per request so it can carry a CSP nonce.
 *
 * A prerendered route's inline scripts are built without a nonce, so the
 * enforced `script-src 'self' 'nonce-…'` from `src/proxy.ts` would refuse them
 * and this page would render blank. This route holds (or leads directly to) an
 * authenticated session, which is precisely what SEC-010's XSS impact is about,
 * so it is worth one render per request to bring it inside the policy. Public
 * marketing/legal/help pages and `/panic` deliberately stay prerendered and
 * report-only — see CSP_UNNONCEABLE_PREFIXES in src/lib/csp-script-policy.ts.
 *
 * `tools/check-csp-prerender.cjs` fails the build if this ever silently
 * reverts to being prerendered.
 */
export const dynamic = 'force-dynamic';
/**
 * Onboarding wizard — /onboarding/branding
 * Authed. After adopt, the new branding takes effect immediately
 * (BrandStyleInjector repaints on the `branding:update` event fired by
 * BrandingWizard) and we hand off to /onboarding/apps (task #265,
 * 2026-07-01) — the Concierge auto-fill step, which re-uses this SAME
 * scraped website to suggest apps before landing on the dashboard.
 */
'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { BrandingWizard } from '@/components/branding/BrandingWizard';
import { useAppStore } from '@/lib/store';
import { useTenant } from '@/hooks/use-api';
import Link from 'next/link';
import { Check } from 'lucide-react';

export default function OnboardingBrandingPage() {
  const t = useTranslations();
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const activeTenant = useAppStore((s) => s.activeTenant);
  // 2026-06-26 — pass the tenant's vertical so the wizard shows
  // industry-appropriate sample URLs + placeholder (Equinox/Chipotle/MLB
  // for gym/QSR/sports) instead of leaking K-12 chrome ("Try: Lincoln
  // County / Harvard / Stanford", placeholder "yourschool.org") to every
  // vertical on the operator's first-impression onboarding screen.
  const { data: tenant } = useTenant();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!user) router.replace('/login?next=/onboarding/branding');
  }, [user, router]);

  return (
    <div className="min-h-screen">
      <header className="px-6 py-3 border-b border-slate-200 bg-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-bold">VenueOS</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{t('onboardingPages.gettingStarted')}</span>
        </div>
        <Link href={activeTenant ? `/${activeTenant}/dashboard` : '/'} className="text-sm text-slate-500 hover:text-slate-900">{t('onboardingPages.skipForNow')} →</Link>
      </header>

      <div className="text-center py-6 px-4">
        <h1 className="text-2xl font-bold">{t('onboardingPages.makeItHome')}</h1>
        <p className="text-slate-600 mt-1 text-sm">{t('onboardingPages.pasteWebsite')}</p>
      </div>

      <BrandingWizard
        mode="authed"
        vertical={(tenant as any)?.vertical || 'K12'}
        onAdopted={() => {
          // 2026-07-01 (task #265) — instead of bouncing straight to the
          // dashboard, hand off to the Concierge auto-fill step, which
          // re-uses the SAME website we just scraped for branding to
          // suggest apps ("here's what we can put on your screens"). That
          // step's own Skip/"I'll do this later" takes the operator to the
          // dashboard exactly like this used to.
          router.push('/onboarding/apps');
        }}
      />
    </div>
  );
}
