/**
 * Onboarding wizard — /onboarding/branding
 * Authed. After adopt we bounce back to the dashboard so the new
 * branding takes effect immediately (BrandStyleInjector repaints on
 * the `branding:update` event fired by BrandingWizard).
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BrandingWizard } from '@/components/branding/BrandingWizard';
import { useAppStore } from '@/lib/store';
import Link from 'next/link';
import { Check } from 'lucide-react';

export default function OnboardingBrandingPage() {
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const activeTenant = useAppStore((s) => s.activeTenant);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!user) router.replace('/login?next=/onboarding/branding');
  }, [user, router]);

  return (
    <div className="min-h-screen">
      <header className="px-6 py-3 border-b border-slate-200 bg-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-bold">EduSignage</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">Onboarding · step 2 of 4</span>
        </div>
        <Link href={activeTenant ? `/${activeTenant}/dashboard` : '/'} className="text-sm text-slate-500 hover:text-slate-900">Skip for now →</Link>
      </header>

      <div className="text-center py-6 px-4">
        <h1 className="text-2xl font-bold">Make it feel like home.</h1>
        <p className="text-slate-600 mt-1 text-sm">Paste your school&apos;s website — we&apos;ll do the rest.</p>
      </div>

      <BrandingWizard
        mode="authed"
        onAdopted={() => {
          // Bounce home with a short success flash
          router.push(activeTenant ? `/${activeTenant}/dashboard?branded=1` : '/');
        }}
      />
    </div>
  );
}
