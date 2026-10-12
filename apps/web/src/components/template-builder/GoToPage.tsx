"use client";

/**
 * "When tapped → Go to page [dropdown]" (owner, 2026-10-12).
 *
 * Every button / touch widget on an interactive template gets this at the top
 * of Properties: pick a page and a tap opens it. It writes the existing
 * `goto-scene` touch action — the player already honours it — so nothing new
 * runs on a screen. "+ New page…" makes the page and links it in one step
 * (the operator stays on the page they are building).
 */
import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Hand } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import { usePages } from './usePages';
import type { TouchActionConfig } from './types';

const NEW_PAGE = '__new_page__';

export function GoToPageSelect({ value, onChange, id, ariaLabel }: {
  value: string;
  onChange: (sceneId: string) => void;
  id?: string;
  ariaLabel?: string;
}) {
  const t = useTranslations('builderPages');
  const p = usePages();
  return (
    <>
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        disabled={p.adding}
        data-go-to-page="true"
        onChange={async (e) => {
          const v = e.target.value;
          if (v === NEW_PAGE) {
            const made = await p.addPage({ open: false });
            if (made) onChange(made);
            return;
          }
          onChange(v);
        }}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <option value="">{t('nothing')}</option>
        {p.pages.map((s) => (
          <option key={s.id} value={s.id}>{s.name}{s.isDefault ? ` · ${t('startPage')}` : ''}</option>
        ))}
        {p.templateId && <option value={NEW_PAGE}>{t('newPageOption')}</option>}
      </select>
      {p.error && <p role="alert" className="mt-1 text-[10px] font-semibold text-rose-700">{p.error}</p>}
    </>
  );
}

export function WhenTappedGoToPage({ zone }: { zone: { id: string; touchAction?: TouchActionConfig | null } }) {
  const t = useTranslations('builderPages');
  const updateZone = useBuilderStore((s) => s.updateZone);
  const selectId = useId();
  const action = zone.touchAction ?? null;
  const other = !!action && action.type !== 'goto-scene';
  const value = action?.type === 'goto-scene' ? String((action as { target?: string }).target || '') : '';
  return (
    <section className="space-y-2" data-when-tapped="true">
      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1 flex items-center gap-1.5">
        <Hand className="w-3 h-3" aria-hidden /> {t('whenTapped')}
      </h3>
      <div className="bg-indigo-50/40 rounded-xl p-3 border border-indigo-100 space-y-1.5">
        <label htmlFor={selectId} className="block text-[10px] font-semibold text-slate-600">{t('goToPage')}</label>
        <GoToPageSelect
          id={selectId}
          value={other ? '' : value}
          onChange={(sceneId) => {
            updateZone(zone.id, { touchAction: sceneId ? ({ type: 'goto-scene', target: sceneId } as TouchActionConfig) : null }, true);
          }}
        />
        <p className="text-[10px] text-slate-500 leading-snug">{other ? t('otherAction') : t('linkHint')}</p>
      </div>
    </section>
  );
}
