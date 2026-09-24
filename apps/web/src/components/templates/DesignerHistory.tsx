'use client';

/**
 * The AI Designer's board HISTORY — the list inside the AI dialog (2026-09-23).
 *
 * Greg: "keep a history of the generated templates so we aren't just throwing away tokens, that way
 * they can go back to them and decide later if they want to continue tweaking them". Every batch the
 * Designer finishes is kept by the API (a done job, 90 days; a batch a board was kept from, for
 * good). This lists them, newest first — GET /templates/generate-designer/jobs — one row each:
 *
 *   Sep 20, 12:03 PM                                           3 boards
 *   A lunch menu board for Super Taco with our twelve tacos…
 *   [Bound to Toast · 9 items]  [Kept as Super Taco Lunch]
 *
 * Tapping a row hands the item to the page, which reopens the batch by id (GET …/jobs/:id →
 * `designerBatchFromJob`) into the SAME pick grid a fresh batch lands in — so Keep, Edit with words
 * and Regenerate (server-side `…/again`) work unchanged. "Kept as" names a template that still
 * exists (the page resolves it from the templates list); a deleted keep shows nothing.
 *
 * No thumbnails here (a phone would render every board of every batch): the pick grid renders the
 * boards once a batch is opened. The list is read when it opens, a page at a time ("Show more"),
 * and is never polled.
 */
import { Check, ChevronRight, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useDesignerJobHistory, type DesignerHistoryItem } from '@/hooks/use-api';
import { historyBrief, historyWhen } from '@/lib/ai-boards';
import { DesignerBoundBadge } from '@/components/templates/DesignerJobProgress';

export interface DesignerHistoryProps {
  /** The kept template's name — undefined when it no longer exists (then the row says nothing). */
  keptName: (templateId: string) => string | undefined;
  /** The batch being reopened (its read is in flight): its row spins, the others wait. */
  openingId: string | null;
  /** Why the last reopen failed, if it did. */
  openError: string | null;
  onOpen: (item: DesignerHistoryItem) => void;
}

export function DesignerHistory({ keptName, openingId, openError, onOpen }: DesignerHistoryProps) {
  const t = useTranslations('aiBoards');
  const locale = useLocale();
  const history = useDesignerJobHistory();
  const items = history.data?.pages.flatMap((page) => page?.items ?? []) ?? [];

  return (
    <div data-testid="designer-history" className="flex flex-col gap-3">
      {openError && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700"
        >
          {openError}
        </div>
      )}
      {history.isPending ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 motion-reduce:animate-none" aria-hidden />
        </div>
      ) : history.isError && items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <p className="text-sm text-slate-500">{t('history.loadFailed')}</p>
          <button
            type="button"
            onClick={() => {
              void history.refetch();
            }}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:min-h-9"
          >
            {t('history.retry')}
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm leading-relaxed text-slate-500">{t('history.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const kept = item.keptTemplateId ? keptName(item.keptTemplateId) : undefined;
            const brief = historyBrief(item) || t('history.untitled');
            const opening = openingId === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  disabled={openingId !== null}
                  aria-busy={opening || undefined}
                  data-testid="designer-history-row"
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-violet-300 hover:bg-violet-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60 motion-reduce:transition-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500">
                      <span>{historyWhen(item.createdAt, locale)}</span>
                      <span className="shrink-0">{t('history.boards', { count: item.candidateCount })}</span>
                    </span>
                    <span className="mt-0.5 block break-words text-sm font-semibold text-slate-800 line-clamp-2">
                      {brief}
                    </span>
                    {(item.boundTo || kept) && (
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.boundTo && <DesignerBoundBadge boundTo={item.boundTo} />}
                        {kept && (
                          <span
                            data-testid="designer-history-kept"
                            className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700"
                          >
                            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            {t('history.keptAs', { name: kept })}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  {opening ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-violet-700">
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                      {t('history.opening')}
                    </span>
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {history.hasNextPage && items.length > 0 && (
        <button
          type="button"
          onClick={() => {
            void history.fetchNextPage();
          }}
          disabled={history.isFetchingNextPage}
          className="self-center inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60 sm:min-h-9"
        >
          {history.isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />}
          {history.isFetchingNextPage ? t('history.loadingMore') : t('history.more')}
        </button>
      )}
    </div>
  );
}
