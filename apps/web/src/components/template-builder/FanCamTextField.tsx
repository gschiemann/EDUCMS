'use client';

/**
 * The Fan Cam's words, where students are on screen (K-12 sports launch, lane
 * B3, leftover b — 2026-09-27).
 *
 * The frame shipped as a "Kiss Cam". At a school — or a location that says its
 * athletes include minors — the people in the stands are students, so the
 * title may not ask for a kiss or anything like it. This field refuses such
 * words AS THEY ARE TYPED, says why, and offers school-safe titles in one tap.
 * The typed words stay in the box (so the operator sees what was refused);
 * the zone keeps no title, so the frame shows its default "FAN CAM".
 *
 * The API refuses the same words on save (templates/fan-cam-guard.ts) — this
 * is the first line, the canvas's click-to-edit and an imported file are the
 * reasons there is a second. Everywhere else the field is an ordinary text
 * field: a pro venue's Kiss Cam is its own business.
 */
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fanCamTextIsSchoolSafe, SCHOOL_SAFE_FAN_CAM_PRESETS } from '@cms/api-types';
import { useStudentPrivacy } from '@/hooks/use-student-privacy';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { useBuilderStore } from './useBuilderStore';

/**
 * Whether students are the audience here: the location's own student-privacy
 * answer once it has loaded; until then, its vertical — and a vertical nobody
 * knows reads as a school, because this question is about children.
 */
export function useStudentsOnScreen(): boolean {
  const { data } = useStudentPrivacy();
  const copy = useTenantCopy();
  if (data && typeof data.applies === 'boolean') return data.applies;
  return copy.vertical === 'K12';
}

const presetKey = (p: string) => `venue.camPreset${p.charAt(0).toUpperCase()}${p.slice(1)}`;

export function FanCamTextField({
  label,
  value,
  placeholder,
  presets,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  /** Offer the school-safe titles (the title field; not the sponsor line). */
  presets?: boolean;
  onChange: (v: string) => void;
}) {
  const t = useTranslations('sportsTemplates');
  const studentsOnScreen = useStudentsOnScreen();
  // The words the field refused, kept in the box until the operator changes
  // them — the zone itself holds no title meanwhile.
  const [refused, setRefused] = useState<string | null>(null);
  const beginTransaction = useBuilderStore((s) => s.beginTransaction);
  const endTransaction = useBuilderStore((s) => s.endTransaction);
  const inputId = useId();
  const errorId = useId();
  const shown = refused ?? value;

  const commit = (v: string) => {
    if (studentsOnScreen && !fanCamTextIsSchoolSafe(v)) {
      setRefused(v);
      onChange('');
      return;
    }
    setRefused(null);
    onChange(v);
  };

  return (
    <div>
      <label htmlFor={inputId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        value={shown}
        placeholder={placeholder}
        aria-invalid={refused !== null}
        aria-describedby={refused !== null ? errorId : undefined}
        onFocus={() => beginTransaction()}
        onBlur={endTransaction}
        onChange={(e) => commit(e.target.value)}
        className={`w-full px-3 py-2 rounded-lg bg-white border text-xs font-medium focus:outline-none focus:ring-2 transition-all shadow-sm ${
          refused !== null
            ? 'border-rose-300 focus:ring-rose-300 focus:border-rose-400'
            : 'border-slate-200/60 focus:ring-indigo-400 focus:border-indigo-400'
        }`}
      />
      {refused !== null && (
        <p id={errorId} role="alert" className="mt-1.5 text-[11px] leading-snug font-medium text-rose-600">
          {t('venue.camNotSchoolSafe', { text: refused })}
        </p>
      )}
      {presets && studentsOnScreen && (
        <div className="mt-2">
          <div className="text-[10px] font-semibold text-slate-500 mb-1">{t('venue.camSchoolSafeTitles')}</div>
          <div className="flex flex-wrap">
            {SCHOOL_SAFE_FAN_CAM_PRESETS.map((p) => {
              const title = t(presetKey(p));
              const active = refused === null && value === title;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    beginTransaction();
                    commit(title);
                    endTransaction();
                  }}
                  className={`mr-1.5 mb-1.5 px-2 py-1 rounded-md border text-[10px] font-bold tracking-wide ${
                    active
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {title}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
