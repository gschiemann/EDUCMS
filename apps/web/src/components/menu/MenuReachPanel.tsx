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

  // Nothing is listening — the honest headline, and the way out of it.
  if (reach.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              These prices aren&rsquo;t on any screen yet
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
              A price here reaches a screen through a <strong>menu board</strong> — one of the QSR, bar or
              menu templates with &ldquo;Driven by your POS&rdquo; switched on. The board matches its rows to
              these items <strong>by name</strong>, so &ldquo;burger&rdquo; shows up wherever a board has a row
              called burger. You don&rsquo;t have a menu board yet, so nothing here is being read.
            </p>
            <Link
              href={`/${schoolId}/templates`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 hover:underline"
            >
              Pick a menu template <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const reached = new Set(reach.flatMap((b) => b.matched.map((n) => n.toLowerCase())));
  const orphans = catalogNames.filter((n) => !reached.has(n.toLowerCase()));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Tv2 className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-800">
          Where these prices show up
        </p>
      </div>

      <ul className="space-y-1.5">
        {reach.map((b) => (
          <li key={b.id} className="flex items-start gap-2 text-xs">
            {b.matched.length > 0
              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
              : <AlertCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />}
            <div className="min-w-0">
              <Link href={`/${schoolId}/templates/${b.id}`} className="font-medium text-slate-800 hover:underline">
                {b.name}
              </Link>
              <span className="text-slate-500">
                {' — '}
                {b.matched.length > 0
                  ? `shows ${b.matched.length} of your item${b.matched.length === 1 ? '' : 's'}`
                  : 'none of your items match its rows'}
                {b.boardOnly.length > 0 && (b.boardOnly.length === 1
                  ? '; 1 row keeps a typed price'
                  : `; ${b.boardOnly.length} rows keep a typed price`)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {orphans.length > 0 && (
        <p className="text-[11px] leading-relaxed text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
          <strong>Not on any board:</strong> {orphans.slice(0, 8).join(', ')}
          {orphans.length > 8 ? ` +${orphans.length - 8} more` : ''}. Editing these changes nothing on screen until a
          board has a row with the same name.
        </p>
      )}
    </div>
  );
}
