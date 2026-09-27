'use client';

/**
 * The dashboard prompt of the student-privacy default (K-12 sports launch,
 * lane B3, 2026-09-27): "Student names and photos are hidden on public screens
 * until an admin confirms your directory-information policy."
 *
 * Renders ONLY where the policy applies (a school, or a tenant that serves
 * minors) and names are still hidden — then it says exactly that and links to
 * Settings → Sports. When names are confirmed but photos are not, a quieter
 * line says so. A venue the policy does not apply to sees nothing. The API
 * enforces the rule either way; this banner only explains why a board shows
 * jersey numbers instead of names.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';
import { useStudentPrivacy } from '@/hooks/use-student-privacy';

export function StudentPrivacyBanner({ schoolId, className = '' }: { schoolId: string; className?: string }) {
  const t = useTranslations('studentPrivacy');
  const { data } = useStudentPrivacy();
  if (!data || !data.applies) return null;
  const namesHidden = !data.names.allowed;
  const photosHidden = !data.photos.allowed;
  if (!namesHidden && !photosHidden) return null;
  return (
    <div
      role="status"
      data-testid="student-privacy-banner"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-3 py-2.5 text-[13px] ${
        namesHidden ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'
      } ${className}`}
    >
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{namesHidden ? t('banner') : t('photosBanner')}</span>
      <Link
        href={`/${schoolId}/settings/sports`}
        className="shrink-0 font-semibold underline underline-offset-2"
      >
        {t('bannerAction')}
      </Link>
    </div>
  );
}
