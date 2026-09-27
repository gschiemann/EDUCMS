'use client';

/**
 * Settings → Sports → "Student information on public screens" (K-12 sports
 * launch, lane B3, 2026-09-27). Greg: "follow the laws, dont show any kids
 * without some legal approval from someone".
 *
 * Where a school records its decision. Two statements, each confirmed
 * separately by a school or district administrator (the API refuses anyone
 * else, an API key, and a stale wording):
 *   names  — the annual FERPA notice designates athletes' names and sports
 *            participation as directory information, opt-outs are recorded;
 *   photos — a signed release is on file for every student marked so.
 * Each shows where the current answer comes from (this location, or the
 * district, who and when), and offers exactly the actions that make sense:
 * confirm, withdraw, hide here (stricter than the district), stop hiding.
 * A non-K-12 tenant instead gets one switch: "Our athletes include minors".
 *
 * Plain language, not legal advice, and it says so. The server is the
 * authority: this card only ever reflects what the API answered.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import type {
  StudentPrivacyAction,
  StudentPrivacyCategory,
  StudentPrivacyCategoryView,
  StudentPrivacySettings,
} from '@cms/api-types';
import { EditorSection, EditorSkeleton, StatusPill } from '@/components/settings/shell/primitives';
import { useSetServesMinors, useSetStudentPrivacy, useStudentPrivacy } from '@/hooks/use-student-privacy';

/** A refusal in the operator's language: the API's codes, never its English text. */
function errorText(e: unknown, t: (key: string) => string): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'STUDENT_PRIVACY_ADMIN_ONLY') return t('readOnly');
  if (code === 'STUDENT_PRIVACY_WORDING_CHANGED') return t('needsReconfirm');
  return t('error');
}

export function StudentPrivacySettingsCard({ orgName }: { orgName: string }) {
  const t = useTranslations('studentPrivacy');
  const { data, isLoading, isError } = useStudentPrivacy();
  const setMinors = useSetServesMinors();

  if (isLoading) return <EditorSkeleton groups={2} />;
  if (isError || !data) {
    return (
      <p role="alert" className="text-[13px] text-red-700">
        {t('error')}
      </p>
    );
  }

  return (
    <div data-testid="student-privacy-settings">
      <p className="mb-2 text-[13px] leading-[19px] text-slate-700">{t('howItWorks')}</p>
      <p className="mb-5 text-[12px] leading-[17px] text-slate-500">
        {t('notLegalAdvice')}{' '}
        <Link href="/ferpa" className="underline text-indigo-600">
          {t('ferpaLink')}
        </Link>
      </p>

      {data.appliesBecause !== 'k12' && (
        <EditorSection id="sp-minors" title={t('servesMinors.label')} description={t('servesMinors.help')}>
          <label className="inline-flex items-center gap-2 text-[13px] text-slate-700">
            <input
              type="checkbox"
              checked={data.servesMinors === true}
              disabled={!data.canChange || setMinors.isPending}
              onChange={(e) => setMinors.mutate(e.target.checked)}
            />
            {t('servesMinors.label')}
          </label>
          {setMinors.isError && (
            <p role="alert" className="mt-2 text-[12px] text-red-700">
              {errorText(setMinors.error, t)}
            </p>
          )}
        </EditorSection>
      )}

      {data.applies && (
        <>
          <CategorySection category="names" data={data} orgName={orgName} />
          <CategorySection category="photos" data={data} orgName={orgName} />
          <EditorSection id="sp-students" title={t('perStudent.heading')}>
            <p className="text-[12px] leading-[17px] text-slate-600">{t('perStudent.help')}</p>
          </EditorSection>
        </>
      )}

      {!data.canChange && (
        <p className="mt-3 text-[12px] leading-[17px] text-slate-500">{t('readOnly')}</p>
      )}
    </div>
  );
}

function CategorySection({
  category,
  data,
  orgName,
}: {
  category: StudentPrivacyCategory;
  data: StudentPrivacySettings;
  orgName: string;
}) {
  const t = useTranslations('studentPrivacy');
  const locale = useLocale();
  const set = useSetStudentPrivacy();
  const [checked, setChecked] = useState(false);
  const view: StudentPrivacyCategoryView = data[category];
  const src = view.source;

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const who = src?.setBy?.name || src?.setBy?.email || t('someone');
  let sourceLine: string;
  if (!src) sourceLine = t('source.none');
  else if (src.state === 'ALLOW')
    sourceLine =
      src.level === 'self'
        ? t('source.self', { who, date: when(src.setAt) })
        : t('source.parent', { org: src.tenantName ?? '', who, date: when(src.setAt) });
  else
    sourceLine =
      src.level === 'self'
        ? t('source.selfHidden', { who, date: when(src.setAt) })
        : t('source.parentHidden', { org: src.tenantName ?? '' });

  const hiddenByParent = src?.state === 'HIDE' && src.level === 'parent';
  const canConfirm = data.canChange && !view.allowed && view.own !== 'HIDE' && !hiddenByParent;
  const act = (action: StudentPrivacyAction) =>
    set.mutate(
      { category, action, version: action === 'confirm' ? data.attestation.version : undefined },
      { onSuccess: () => setChecked(false) },
    );

  return (
    <EditorSection
      id={`sp-${category}`}
      title={t(`${category}.heading`)}
      action={
        <StatusPill
          kind={view.allowed ? 'ready' : 'attention'}
          label={view.allowed ? t(`${category}.shown`) : t(`${category}.hidden`)}
        />
      }
    >
      <p className="text-[12px] leading-[17px] text-slate-600" data-testid={`sp-${category}-source`}>
        {sourceLine}
      </p>
      {view.needsReconfirm && (
        <p className="mt-2 text-[12px] leading-[17px] text-amber-800">{t('needsReconfirm')}</p>
      )}

      {canConfirm && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-medium uppercase tracking-[.08em] text-slate-500">
            {t('statementLabel')}
          </p>
          <p className="mt-1.5 text-[13px] leading-[19px] text-slate-800">{t(`statement.${category}`)}</p>
          <label className="mt-3 flex items-start gap-2 text-[13px] text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>{t('confirmCheck', { org: orgName })}</span>
          </label>
          <button
            type="button"
            disabled={!checked || set.isPending}
            onClick={() => act('confirm')}
            className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {set.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label={t('saving')} />}
            {t('confirm')}
          </button>
        </div>
      )}

      {data.canChange && (
        <div className="mt-3 flex flex-wrap gap-2">
          {view.own === 'ALLOW' && (
            <SmallButton onClick={() => act('revoke')} disabled={set.isPending}>
              {t('revoke')}
            </SmallButton>
          )}
          {view.allowed && view.own !== 'ALLOW' && (
            <SmallButton onClick={() => act('hide')} disabled={set.isPending}>
              {t('hide')}
            </SmallButton>
          )}
          {view.own === 'HIDE' && (
            <SmallButton onClick={() => act('unhide')} disabled={set.isPending}>
              {t('unhide')}
            </SmallButton>
          )}
        </div>
      )}
      {set.isError && (
        <p role="alert" className="mt-2 text-[12px] text-red-700">
          {errorText(set.error, t)}
        </p>
      )}
    </EditorSection>
  );
}

function SmallButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
