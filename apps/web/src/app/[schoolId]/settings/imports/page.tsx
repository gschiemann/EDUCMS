'use client';

/**
 * /[schoolId]/settings/imports — DEPRECATED REDIRECT STUB.
 *
 * 2026-05-25 — Design imports moved out of Settings into the Templates
 * section because importing a deck IS template authoring, not a
 * setting. New canonical location:
 *
 *     /[schoolId]/templates/imports
 *
 * Operator complaint that prompted the move:
 *   "this entire settings page should not be under settings, it should
 *    be under the template section itself, its not a setting its a
 *    feature"
 *
 * Why keep this stub:
 *   - Inbound links from the Settings → Developer page, support
 *     emails, bookmarks, and the partner's own training docs still
 *     point here. A hard 404 would break those.
 *   - We do a client-side router.replace() so the URL bar updates to
 *     the new path immediately and back-button navigation skips the
 *     deprecated route. No flash of an old page; the layout shell
 *     renders the loading skeleton while the redirect resolves.
 *
 * Plan: ship this stub for at least one major version, then delete.
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function DesignImportsRedirect() {
  const params = useParams();
  const router = useRouter();
  const schoolId = params?.schoolId as string;
  const t = useTranslations();

  useEffect(() => {
    if (!schoolId) return;
    // router.replace — not router.push — so the deprecated URL is
    // removed from the browser history and back-arrow doesn't loop.
    router.replace(`/${schoolId}/templates/imports`);
  }, [schoolId, router]);

  return (
    <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3 text-slate-400 text-sm">
      <Loader2 className="w-6 h-6 animate-spin" />
      <p>{t('settings.imports.redirecting')}</p>
    </div>
  );
}
