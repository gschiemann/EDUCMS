"use client";

/**
 * ScenesPanel — the PAGES tab (Phase D2.5 scenes, renamed 2026-10-12).
 *
 * Operator-facing these are "Pages" (owner: "rename everywhere
 * user-facing"); the data is still `TemplateScene`. The page strip under the
 * canvas (PageStrip.tsx) is the primary surface; this tab is the same list as
 * rows, for renaming / reordering / choosing the start page with more room.
 * Both run through usePages so they can never disagree.
 *
 * Zone-to-page assignment lives in Properties (the selected zone has the
 * context); "When tapped → Go to page" too.
 */
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Star, Trash2, Pencil, Check, X, Loader2, Layers3, ChevronUp, ChevronDown } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import { usePages } from './usePages';
import { zonesOnPage } from './pages';

export function ScenesPanel() {
  const t = useTranslations('builderPages');
  const p = usePages();
  const zones = useBuilderStore((s) => s.zones);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputId = useId();

  const commitRename = async () => {
    if (!renamingId) return;
    if (await p.renamePage(renamingId, renameValue)) setRenamingId(null);
  };

  const sharedCount = zonesOnPage(zones, null).length;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm" data-pages-panel="true">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-slate-600">
          <Layers3 className="w-4 h-4 text-indigo-500" aria-hidden />
          <h2 className="text-xs font-bold uppercase tracking-wider">{t('title')}</h2>
          {p.isFetching && <Loader2 className="w-3 h-3 animate-spin text-slate-400" aria-hidden />}
        </div>
        <button
          type="button"
          onClick={() => void p.addPage()}
          disabled={p.adding}
          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {p.adding ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <Plus className="w-3 h-3" aria-hidden />}
          {t('addPage')}
        </button>
      </div>

      <p className="text-[11px] text-slate-500 leading-snug">{t('intro')}</p>

      {p.error && (
        <div role="alert" className="text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-2.5 py-1.5">
          {p.error}
        </div>
      )}

      <div className="space-y-1.5">
        {p.pages.map((page, i) => {
          const isActive = page.id === p.activeSceneId;
          const isRenaming = renamingId === page.id;
          const count = zonesOnPage(zones, page.id).length;
          return (
            <div
              key={page.id}
              className={`group rounded-lg border px-2.5 py-2 transition-colors ${
                isActive ? 'border-indigo-300 bg-indigo-50/70' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void p.makeStartPage(page.id)}
                  className={`shrink-0 ${page.isDefault ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}
                  title={page.isDefault ? t('startPage') : t('makeStart')}
                  aria-label={page.isDefault ? t('startPage') : t('makeStart')}
                  disabled={p.busy || page.isDefault}
                >
                  <Star className={`w-3.5 h-3.5 ${page.isDefault ? 'fill-amber-400' : ''}`} aria-hidden />
                </button>
                {isRenaming ? (
                  <>
                    <label htmlFor={renameInputId} className="sr-only">{t('rename')}</label>
                    <input
                      id={renameInputId}
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename();
                        if (e.key === 'Escape') { setRenamingId(null); p.clearError(); }
                      }}
                      maxLength={80}
                      className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <button type="button" onClick={() => void commitRename()} disabled={p.busy}
                      className="shrink-0 p-1 rounded text-emerald-600 hover:bg-emerald-50 disabled:opacity-50" aria-label={t('save')}>
                      <Check className="w-3.5 h-3.5" aria-hidden />
                    </button>
                    <button type="button" onClick={() => { setRenamingId(null); p.clearError(); }}
                      className="shrink-0 p-1 rounded text-slate-400 hover:bg-slate-100" aria-label={t('cancel')}>
                      <X className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => p.setActiveSceneId(page.id)}
                      className="flex-1 min-w-0 text-left flex items-center gap-2"
                    >
                      <span className={`truncate text-xs font-bold ${isActive ? 'text-indigo-700' : 'text-slate-700'}`}>{page.name}</span>
                      <span className="text-[10px] text-slate-500 shrink-0">{t('widgets', { count })}</span>
                    </button>
                    <button type="button" onClick={() => void p.movePage(page.id, -1)} disabled={i === 0 || p.busy}
                      className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30" aria-label={t('moveLeft')} title={t('moveLeft')}>
                      <ChevronUp className="w-3.5 h-3.5" aria-hidden />
                    </button>
                    <button type="button" onClick={() => void p.movePage(page.id, 1)} disabled={i === p.pages.length - 1 || p.busy}
                      className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30" aria-label={t('moveRight')} title={t('moveRight')}>
                      <ChevronDown className="w-3.5 h-3.5" aria-hidden />
                    </button>
                    <button type="button" onClick={() => { setRenamingId(page.id); setRenameValue(page.name); p.clearError(); }}
                      className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label={t('rename')} title={t('rename')}>
                      <Pencil className="w-3.5 h-3.5" aria-hidden />
                    </button>
                    <button type="button" onClick={() => void p.deletePage(page.id)} disabled={page.isDefault || p.busy}
                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label={t('delete')} title={page.isDefault ? t('cantDeleteStart') : t('delete')}>
                      <Trash2 className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* The shared layer — widgets on every page (corner logo, nav bar). */}
        <button
          type="button"
          onClick={() => p.setActiveSceneId(null)}
          className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors flex items-center gap-2 ${
            p.activeSceneId === null ? 'border-slate-400 bg-slate-100' : 'border-dashed border-slate-200 bg-slate-50 hover:bg-slate-100'
          }`}
        >
          <Layers3 className="w-3.5 h-3.5 text-slate-400" aria-hidden />
          <span className="text-xs font-bold text-slate-600">{t('shared')}</span>
          <span className="text-[10px] text-slate-500">{t('widgets', { count: sharedCount })}</span>
          <span className="ml-auto text-[10px] text-slate-500">{t('sharedHint')}</span>
        </button>
      </div>
    </div>
  );
}
