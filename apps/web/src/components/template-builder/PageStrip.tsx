"use client";

/**
 * PageStrip — every page of an interactive template, as thumbnails UNDER the
 * canvas (owner, 2026-10-12: "build it like Canva / PowerPoint / Intuiface").
 *
 * Shared layer first, then each page in order; click to edit that page,
 * "+ Add page" creates a page AND opens it. The page being edited carries its
 * own small controls: rename, move left / right, make it the start page,
 * delete. Thumbnails are a cheap schematic — the page's background and a
 * block per widget, shared widgets faint — never live widgets: a strip of N
 * live boards would be N copies of the whole canvas (mobile-perf standard).
 *
 * Mounted by BuilderShell only while the template is interactive
 * (pages.ts isInteractiveTemplate).
 */
import { memo, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Star, Pencil, Trash2, ChevronLeft, ChevronRight, Check, X, Layers3, Loader2 } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import { getZoneColor } from './constants';
import { usePages } from './usePages';
import { zonesOnPage } from './pages';
import type { Zone } from './types';

const THUMB_W = 112;

export function PageStrip() {
  const t = useTranslations('builderPages');
  const p = usePages();
  const zones = useBuilderStore((s) => s.zones);
  const meta = useBuilderStore((s) => s.meta);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const renameId = useId();

  const aspect = meta.screenWidth > 0 && meta.screenHeight > 0 ? meta.screenHeight / meta.screenWidth : 9 / 16;
  const thumbH = Math.round(THUMB_W * Math.min(Math.max(aspect, 0.3), 1.9));
  const shared = zonesOnPage(zones, null);
  const sharedActive = p.activeSceneId === null;

  const commitRename = async () => {
    if (!renaming) return;
    if (await p.renamePage(renaming, draft)) setRenaming(null);
  };

  return (
    <nav
      aria-label={t('stripLabel')}
      data-page-strip="true"
      className="shrink-0 border-t border-slate-200 bg-white px-3 py-2"
    >
      <div className="flex items-end gap-2 overflow-x-auto pb-1">
        {/* Shared layer — what shows on every page. */}
        <button
          type="button"
          onClick={() => p.setActiveSceneId(null)}
          aria-pressed={sharedActive}
          aria-label={t('showShared')}
          data-page-shared="true"
          className={`shrink-0 flex flex-col items-stretch rounded-lg border-2 p-1 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
            sharedActive ? 'border-indigo-500 bg-indigo-50' : 'border-dashed border-slate-300 bg-slate-50 hover:border-slate-400'
          }`}
          style={{ width: THUMB_W + 12 }}
        >
          <PageThumb zones={shared} sharedZones={[]} width={THUMB_W} height={thumbH} meta={meta} />
          <span className="mt-1 flex items-center gap-1 text-[11px] font-bold text-slate-600">
            <Layers3 className="w-3 h-3 shrink-0" aria-hidden />
            <span className="truncate">{t('shared')}</span>
          </span>
          <span className="text-[10px] text-slate-500 truncate">{t('sharedHint')}</span>
        </button>

        {p.pages.map((page, i) => {
          const active = page.id === p.activeSceneId;
          const own = zonesOnPage(zones, page.id);
          const isRenaming = renaming === page.id;
          return (
            <div
              key={page.id}
              data-page-id={page.id}
              data-page-active={active ? 'true' : undefined}
              className={`shrink-0 rounded-lg border-2 p-1 transition-colors ${active ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
              style={{ width: THUMB_W + 12 }}
            >
              <button
                type="button"
                onClick={() => p.setActiveSceneId(page.id)}
                onDoubleClick={() => { setRenaming(page.id); setDraft(page.name); }}
                aria-pressed={active}
                aria-label={t('openPage', { name: page.name })}
                className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded"
              >
                <PageThumb zones={own} sharedZones={shared} width={THUMB_W} height={thumbH} meta={meta} />
              </button>
              {isRenaming ? (
                <div className="mt-1 flex items-center gap-0.5">
                  <label htmlFor={renameId} className="sr-only">{t('rename')}</label>
                  <input
                    id={renameId}
                    autoFocus
                    value={draft}
                    maxLength={80}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename();
                      if (e.key === 'Escape') { setRenaming(null); p.clearError(); }
                    }}
                    className="min-w-0 flex-1 px-1 py-0.5 text-[11px] rounded border border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <IconBtn label={t('save')} onClick={() => void commitRename()}><Check className="w-3 h-3" /></IconBtn>
                  <IconBtn label={t('cancel')} onClick={() => { setRenaming(null); p.clearError(); }}><X className="w-3 h-3" /></IconBtn>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-1 min-w-0">
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">{i + 1}</span>
                  {page.isDefault && <Star className="w-3 h-3 shrink-0 text-amber-500 fill-amber-400" aria-label={t('startPage')} />}
                  <span className={`truncate text-[11px] font-bold ${active ? 'text-indigo-700' : 'text-slate-700'}`} title={page.name}>{page.name}</span>
                </div>
              )}
              {active && !isRenaming && (
                <div className="mt-0.5 flex items-center justify-between">
                  <IconBtn label={t('moveLeft')} disabled={i === 0 || p.busy} onClick={() => void p.movePage(page.id, -1)}><ChevronLeft className="w-3 h-3" /></IconBtn>
                  <IconBtn label={t('rename')} onClick={() => { setRenaming(page.id); setDraft(page.name); }}><Pencil className="w-3 h-3" /></IconBtn>
                  {!page.isDefault && (
                    <IconBtn label={t('makeStart')} disabled={p.busy} onClick={() => void p.makeStartPage(page.id)}><Star className="w-3 h-3" /></IconBtn>
                  )}
                  <IconBtn label={t('delete')} disabled={page.isDefault || p.busy} danger onClick={() => void p.deletePage(page.id)}><Trash2 className="w-3 h-3" /></IconBtn>
                  <IconBtn label={t('moveRight')} disabled={i === p.pages.length - 1 || p.busy} onClick={() => void p.movePage(page.id, 1)}><ChevronRight className="w-3 h-3" /></IconBtn>
                </div>
              )}
              {!active && (
                <div className="text-[10px] text-slate-500 truncate">{t('widgets', { count: own.length })}</div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => void p.addPage()}
          disabled={p.adding}
          data-page-add="true"
          className="shrink-0 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-indigo-300 bg-white text-indigo-600 hover:bg-indigo-50 hover:border-indigo-400 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          style={{ width: THUMB_W + 12, height: thumbH + 30 }}
        >
          {p.adding ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden /> : <Plus className="w-5 h-5" aria-hidden />}
          <span className="mt-1 text-[11px] font-bold">{t('addPage')}</span>
        </button>
      </div>
      {p.error && (
        <p role="alert" className="mt-1 text-[11px] font-semibold text-rose-700">{p.error}</p>
      )}
    </nav>
  );
}

/**
 * Shown over the canvas while the page being edited has nothing of its own —
 * right after "+ Add page" above all. Never intercepts the pointer, so a
 * widget can still be dropped straight onto it.
 */
export function EmptyPageHint() {
  const t = useTranslations('builderPages');
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const scenes = useBuilderStore((s) => s.scenes);
  const hasOwn = useBuilderStore((s) => s.zones.some((z) => (z.sceneId ?? null) === s.activeSceneId && s.activeSceneId !== null));
  if (!activeSceneId || hasOwn) return null;
  const page = scenes.find((s) => s.id === activeSceneId);
  if (!page || page.isDefault) return null;
  const home = scenes.find((s) => s.isDefault)?.name || scenes[0]?.name || '';
  return (
    <div
      data-empty-page-hint="true"
      role="status"
      className="pointer-events-none absolute left-1/2 top-[42%] z-20 -translate-x-1/2 -translate-y-1/2 w-[min(440px,calc(100%_-_32px))] rounded-xl border border-indigo-200 bg-white/95 px-4 py-3 text-center shadow-lg"
    >
      <p className="text-sm font-bold text-slate-800">{t('emptyTitle')}</p>
      <p className="mt-1 text-xs text-slate-600 leading-snug">{t('emptyBody', { home })}</p>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: {
  label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`p-1 rounded text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-indigo-400 ${danger ? 'hover:text-rose-600 hover:bg-rose-50' : 'hover:text-slate-800 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );
}

/** Schematic page thumbnail: background + one block per widget. */
const PageThumb = memo(function PageThumb({ zones, sharedZones, width, height, meta }: {
  zones: Zone[]; sharedZones: Zone[]; width: number; height: number;
  meta: { bgColor: string; bgGradient: string };
}) {
  const bg = meta.bgGradient || meta.bgColor || '#ffffff';
  const block = (z: Zone, faint: boolean) => {
    const c = getZoneColor(z.widgetType);
    return (
      <span
        key={z.id}
        style={{
          position: 'absolute',
          left: `${z.x}%`, top: `${z.y}%`, width: `${z.width}%`, height: `${z.height}%`,
          background: c.bg, border: `1px solid ${c.border}`, borderRadius: 2,
          opacity: faint ? 0.35 : 0.95, zIndex: z.zIndex,
        }}
      />
    );
  };
  return (
    <span
      aria-hidden
      className="relative block overflow-hidden rounded border border-slate-200"
      style={{ width, height, background: bg }}
    >
      {sharedZones.map((z) => block(z, true))}
      {zones.map((z) => block(z, false))}
    </span>
  );
});
