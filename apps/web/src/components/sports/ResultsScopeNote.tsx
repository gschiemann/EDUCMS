'use client';

/**
 * "Results display" — what VenueOS does and does not do for a meet sport
 * (K-12 launch audit F26, 2026-09-27). The scope itself lives in
 * `@/lib/sports-scope`; this is the one sentence every surface shows:
 *
 *   - `console` — a band above the game console's results pad / grid, the
 *     place an operator types places and marks and could reasonably take
 *     VenueOS for the meet's scoring system;
 *   - `picker`  — under the New-game sport grid once a meet sport is picked.
 *
 * Renders nothing for a game sport (football, basketball …), which VenueOS
 * does run.
 */

import { useTranslations } from 'next-intl';
import { ClipboardList } from 'lucide-react';
import type { SportDefinition } from '@cms/api-types';
import { resultsKind, sportScope } from '@/lib/sports-scope';

/**
 * The small "Results" tag on a meet sport's tile in the New-game picker, so
 * the difference is visible before anything is picked.
 */
export function ResultsScopeTag({ sport }: { sport: SportDefinition | string | null | undefined }) {
  const t = useTranslations('sportsTemplates.scope');
  if (sportScope(sport) !== 'results') return null;
  return (
    <span
      title={t('tagHint')}
      className="rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-amber-800"
    >
      {t('tag')}
    </span>
  );
}

export function ResultsScopeNote({
  sport,
  variant = 'console',
}: {
  sport: SportDefinition | string | null | undefined;
  variant?: 'console' | 'picker';
}) {
  const t = useTranslations('sportsTemplates.scope');
  const kind = resultsKind(sport);
  if (!kind) return null;

  const body = (
    <p className="min-w-0">
      <strong className="font-bold">{t('title')}.</strong> {t('lead')} {t(kind)}
    </p>
  );

  if (variant === 'picker') {
    return (
      <div
        role="note"
        data-results-scope={kind}
        className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-snug text-amber-900"
      >
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        {body}
      </div>
    );
  }

  return (
    <div
      role="note"
      data-results-scope={kind}
      className="border-t border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] leading-snug text-amber-900"
    >
      <div className="mx-auto flex max-w-4xl items-start gap-2">
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        {body}
      </div>
    </div>
  );
}
