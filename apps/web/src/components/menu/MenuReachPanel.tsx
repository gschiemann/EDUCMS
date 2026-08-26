'use client';

/**
 * MenuReachPanel — where these prices actually go.
 *
 * The price book was a dead end. An operator added burger / fries / shake
 * and nothing on the page said what happens next: not what the prices are
 * for, not which boards use them, not whether "burger" would ever appear
 * anywhere. The only onward link went to Settings → POS, which is a
 * different question entirely.
 *
 * The connection it was hiding: a menu board with "Driven by your POS" on
 * looks each of its rows up in this catalog BY NAME. So an item reaches a
 * screen only if some board displays a row with that name. This panel
 * makes that visible in the two ways that matter — which boards are
 * listening at all, and which items land on none of them.
 *
 * It reads the board HTML the same way the board does (see
 * lib/menu/menu-matching.ts, which mirrors the board's own normalization
 * and is tested against a shipped board), so what it claims here and what
 * happens on glass cannot drift.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Tv2, AlertCircle, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import { boardMenuRows, matchMenuToBoard, isMenuDrivenBoard } from '@/lib/menu/menu-matching';

interface TemplateLite {
  id: string;
  name: string;
  zones?: Array<{ widgetType?: string; defaultConfig?: Record<string, unknown> | null }>;
}

/** A board that is listening to the price book, and what it takes from it. */
interface BoardReach {
  id: string;
  name: string;
  url: string;
  matched: string[];   // catalog names this board shows
  boardOnly: string[]; // rows keeping a typed price
}

async function readBoardRows(url: string, overrides: Record<string, string>) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) return null;
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const fields: Array<{ key: string; defaultText: string }> = [];
  doc.querySelectorAll('[data-field]').forEach((el) => {
    const key = (el as HTMLElement).getAttribute('data-field');
    if (!key) return;
    let text = '';
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 3) { text = (c.textContent || '').trim(); if (text) break; }
    }
    fields.push({ key, defaultText: text || (el.textContent || '').trim() });
  });
  return boardMenuRows(fields, overrides);
}

export function MenuReachPanel({ schoolId, catalogNames }: {
  schoolId: string;
  catalogNames: string[];
}) {
  const templatesQ = useQuery<TemplateLite[]>({
    queryKey: ['templates', undefined],
    queryFn: () => apiFetch<TemplateLite[]>('/templates', { cache: 'no-store' }),
    staleTime: 60_000, retry: false,
  });

  // Every template with a zone the live menu feeds.
  const menuBoards = useMemo(() => {
    const out: Array<{ id: string; name: string; url: string; overrides: Record<string, string> }> = [];
    for (const tpl of templatesQ.data || []) {
      for (const z of tpl.zones || []) {
        const cfg = (z.defaultConfig || {}) as Record<string, unknown>;
        if (z.widgetType !== 'EXTERNAL_HTML' || !isMenuDrivenBoard(cfg)) continue;
        const url = typeof cfg.url === 'string' ? cfg.url.split('?')[0] : '';
        if (!url) continue;
        out.push({
          id: tpl.id, name: tpl.name, url,
          overrides: (cfg.textOverrides && typeof cfg.textOverrides === 'object'
            ? cfg.textOverrides : {}) as Record<string, string>,
        });
        break; // one menu zone per template is enough to call it a menu board
      }
    }
    return out;
  }, [templatesQ.data]);

  const [reach, setReach] = useState<BoardReach[] | null>(null);
  useEffect(() => {
    if (!templatesQ.data) return;
    if (menuBoards.length === 0) { setReach([]); return; }
    let cancelled = false;
    Promise.all(menuBoards.map(async (b) => {
      const rows = await readBoardRows(b.url, b.overrides).catch(() => null);
      if (!rows) return null;
      const r = matchMenuToBoard(rows, catalogNames);
      return {
        id: b.id, name: b.name, url: b.url,
        matched: r.matched.map((m) => m.catalogName),
        boardOnly: r.boardOnly.map((x) => x.displayName),
      } as BoardReach;
    })).then((rs) => { if (!cancelled) setReach(rs.filter(Boolean) as BoardReach[]); });
    return () => { cancelled = true; };
  }, [menuBoards, catalogNames, templatesQ.data]);

  if (templatesQ.isLoading || reach === null) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        <Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1.5" /> Checking which boards use these prices&hellip;
      </div>
    );
  }

  const reached = new Set(reach.flatMap((b) => b.matched.map((n) => n.toLowerCase())));
  const orphans = catalogNames.filter((n) => !reached.has(n.toLowerCase()));
  const showing = reach.filter((b) => b.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length);
  const silent = reach.length - showing.length;

  // LEAD WITH THE ANSWER, NOT THE INVENTORY.
  //
  // The first version listed every menu-capable template in the tenant —
  // fifteen rows, each saying "none of your items match its rows". All
  // true, all identical, and it buried the one line that mattered. A
  // board that shows nothing of yours is not news fifteen times over; it
  // is one number.
  if (showing.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              {catalogNames.length === 0
                ? 'No items yet'
                : `Your ${catalogNames.length === 1 ? 'item isn’t' : `${catalogNames.length} items aren’t`} on a screen yet`}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
              {reach.length === 0 ? (
                <>
                  Prices reach a screen through a <strong>menu board</strong> — a QSR, bar or menu
                  template with &ldquo;Driven by your POS&rdquo; on. You don&rsquo;t have one yet, so
                  nothing is reading these.
                </>
              ) : (
                <>
                  Boards match your items <strong>by name</strong>, and none of your{' '}
                  {reach.length === 1 ? 'menu board has' : `${reach.length} menu boards have`} a row
                  called {orphans.slice(0, 3).map((o) => `“${o}”`).join(', ') || 'any of these'}.
                  Open a board and press <strong>Use my price book</strong> — it renames the rows for you.
                </>
              )}
            </p>
            <Link
              href={`/${schoolId}/templates`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 hover:underline"
            >
              Open a menu board <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const VISIBLE = 4;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <Tv2 className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-800">
          On {showing.length} board{showing.length === 1 ? '' : 's'}
        </p>
      </div>

      <ul className="space-y-1">
        {showing.slice(0, VISIBLE).map((b) => (
          <li key={b.id} className="flex items-start gap-2 text-xs">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <Link href={`/${schoolId}/templates/${b.id}`} className="font-medium text-slate-800 hover:underline">
                {b.name}
              </Link>
              <span className="text-slate-500">
                {` — ${b.matched.length} item${b.matched.length === 1 ? '' : 's'}`}
                {b.boardOnly.length > 0 && (b.boardOnly.length === 1
                  ? '; 1 row still on a typed price'
                  : `; ${b.boardOnly.length} rows still on a typed price`)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {(showing.length > VISIBLE || silent > 0) && (
        <p className="text-[11px] text-slate-400">
          {showing.length > VISIBLE && `+${showing.length - VISIBLE} more showing your items. `}
          {silent > 0 && `${silent} other menu board${silent === 1 ? '' : 's'} show none of them.`}
        </p>
      )}

      {orphans.length > 0 && (
        <p className="text-[11px] leading-relaxed text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
          <strong>Not on any board:</strong> {orphans.slice(0, 6).join(', ')}
          {orphans.length > 6 ? ` +${orphans.length - 6} more` : ''}
        </p>
      )}
    </div>
  );
}
