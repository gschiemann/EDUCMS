'use client';

/**
 * "Don't type student names here" — the builder's side of typed student names
 * (K-12 sports launch follow-up, lane B4, 2026-09-27).
 *
 * The API blanks a typed value on every real screen when it is a rostered
 * student the school's student-privacy policy hides
 * (apps/api/src/sports/typed-student-names.ts). The operator deserves to know
 * that BEFORE typing a name into a relay leg, an announcement line, a player
 * card or a celebration — so each of those fields (the shared list,
 * `studentNameEditorKeys` in @cms/api-types) carries this notice while the
 * school's names are hidden.
 *
 * Shown when the location's policy applies and names are not confirmed — or,
 * until that answer has loaded, when the location is a school (the question is
 * about children, so an unknown answer warns). Never shown at a venue the
 * policy does not apply to, nor after the school confirms.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';
import { studentNameEditorKeys } from '@cms/api-types';
import { useStudentPrivacy } from '@/hooks/use-student-privacy';
import { useTenantCopy } from '@/hooks/use-tenant-copy';

/** Are student names hidden on this location's public screens? */
export function useStudentNamesHidden(): boolean {
  const { data } = useStudentPrivacy();
  const copy = useTenantCopy();
  if (data && typeof data.applies === 'boolean') return data.applies && !data.names?.allowed;
  return copy.vertical === 'K12';
}

export function StudentNameNotice() {
  const hidden = useStudentNamesHidden();
  const t = useTranslations('studentPrivacy');
  const params = useParams<{ schoolId?: string }>();
  if (!hidden) return null;
  const schoolId = typeof params?.schoolId === 'string' ? params.schoolId : '';
  return (
    <div
      role="note"
      data-testid="student-name-notice"
      className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11.5px] leading-snug text-amber-900"
    >
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block font-semibold">{t('typedNames.warning')}</span>
        <span className="block">{t('typedNames.detail')}</span>
        {schoolId && (
          <Link href={`/${schoolId}/settings/sports`} className="mt-0.5 inline-block font-semibold underline underline-offset-2">
            {t('bannerAction')}
          </Link>
        )}
      </span>
    </div>
  );
}

/**
 * For a panel that renders a zone's fields from a list (the venue editor, the
 * generic v2 editor): call with each config key it is about to render; the
 * notice comes back right before the FIRST typed-student-name field, and null
 * for every other key and for later name fields (one notice per widget).
 */
export function studentNameNoticePlacer(
  widgetType: string | null | undefined,
  cfg: Record<string, unknown>,
): (key: string) => React.ReactNode {
  const keys = studentNameEditorKeys(widgetType, cfg);
  let shown = false;
  function noticeBefore(key: string): React.ReactNode {
    if (shown || !keys.has(key)) return null;
    shown = true;
    return <StudentNameNotice key="student-name-notice" />;
  }
  return noticeBefore;
}
