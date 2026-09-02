"use client";

/**
 * /[schoolId]/settings — Settings index.
 *
 * Desktop/tablet: redirects to /settings/overview (handoff §8).
 * Mobile (<768px): the shell renders the category index as its own view
 * (§14); this page contributes nothing so the index stays the only content.
 */
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/use-mobile';
import { settingsHref } from '@/components/settings/shell/registry';

export default function SettingsIndexPage() {
  const params = useParams<{ schoolId: string }>();
  const router = useRouter();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth >= 768 && params?.schoolId) {
      router.replace(settingsHref(params.schoolId, 'overview'));
    }
  }, [params?.schoolId, router]);

  if (isMobile) return null;
  return null;
}
