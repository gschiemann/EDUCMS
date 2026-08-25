"use client";

/**
 * StarterBoardCard — "This is what your screens will show."
 *
 * THE ACTIVATION MOMENT (audit §20 / VERT-001). A tenant that has just signed
 * up has no hardware on the wall yet, so the dashboard has nothing real to show
 * them and the product feels like an empty filing cabinet. But they DO already
 * have a board: `StarterBoardService` seeds one vertical-appropriate template
 * plus "My first playlist" at signup. This card puts that board on a simulated
 * TV so the very first dashboard load answers "what does this thing actually
 * do?" — and hands them the two moves that follow: make it yours, then hang it
 * on a real screen.
 *
 * IT RETIRES ITSELF. The card renders ONLY while the tenant has zero screens.
 * The moment a real screen is paired, the live fleet is the truth and this
 * simulation would be noise — so it disappears for good with no dismiss state
 * to manage.
 *
 * REAL BOARD, NOT A SCREENSHOT. It mounts `ScaledTemplateThumbnail` with
 * `freeze={false}`, which is the same live render the template builder and the
 * full-screen preview use: real widgets, real clock, real ticker, live
 * EXTERNAL_HTML iframe for board-style presets. What they see here is what the
 * player will draw.
 *
 * COSTS NOTHING EXTRA. `useScreens` / `usePlaylists` are already mounted by the
 * dashboard and React Query dedupes them; the only added request is ONE
 * `GET /templates/:id`, fired only when a starter board exists AND no screen is
 * paired. No pollers, no interval, no blur — mobile-perf rules hold.
 */

import Link from 'next/link';
import { MonitorPlay, Paintbrush, Sparkles } from 'lucide-react';
import { useTemplate } from '@/hooks/use-api';
import { STARTER_PLAYLIST_NAME, useStarterBoard } from '@/hooks/use-starter-board';
import { useUIStore } from '@/store/ui-store';
import { ScaledTemplateThumbnail } from '@/components/templates/ScaledTemplateThumbnail';

export function StarterBoardCard({ schoolId }: { schoolId: string }) {
  const { fleetIsEmpty, playlist: starterPlaylist, template: starterSummary } = useStarterBoard();
  const role = useUIStore((s) => s.user?.role);

  const templateId = fleetIsEmpty ? (starterSummary?.id ?? '') : '';
  // `useTemplate` self-disables on an empty id, so nothing is requested for a
  // tenant that already has screens or has no starter board.
  const { data: template } = useTemplate(templateId);

  // A read-only viewer can neither edit a template nor pair a screen; showing
  // them two buttons they'll be 403'd on is worse than showing nothing.
  if (role === 'RESTRICTED_VIEWER') return null;
  if (!fleetIsEmpty || !template?.zones?.length) return null;

  const builderHref = `/${schoolId}/templates/builder/${template.id}`;
  const screensHref = `/${schoolId}/screens`;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
        {/* ─── The simulated screen ───────────────────────────────
            A plain CSS bezel: dark frame, inner ring for the glass edge,
            a short neck + foot underneath. Deliberately cheap — no blur,
            no filters — so it costs nothing on a phone GPU. */}
        <div className="w-full lg:w-[58%] lg:shrink-0">
          <div className="rounded-xl bg-slate-900 p-2.5 shadow-lg shadow-slate-900/20 ring-1 ring-slate-800 sm:p-3">
            <div className="overflow-hidden rounded-md bg-black">
              <ScaledTemplateThumbnail
                zones={template.zones}
                screenWidth={template.screenWidth}
                screenHeight={template.screenHeight}
                bgColor={template.bgColor}
                bgGradient={template.bgGradient}
                bgImage={template.bgImage}
                // Big enough that the card's own width is always the
                // constraint — the board fills the bezel edge to edge.
                maxHeight={900}
                // FALSE on purpose: render the real, live board, not the
                // catalog's static poster PNG.
                freeze={false}
              />
            </div>
          </div>
          {/* Neck + foot — sells "this is a TV" in ~30 bytes of markup. */}
          <div className="mx-auto h-3 w-14 rounded-b-md bg-slate-800" />
          <div className="mx-auto h-1.5 w-36 rounded-full bg-slate-300" />
        </div>

        {/* ─── The two moves that follow ──────────────────────── */}
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-700">
            <Sparkles className="h-3 w-3" aria-hidden />
            Your first board is ready
          </div>
          <h2 className="mt-3 text-xl font-bold text-slate-900">
            This is what your screens will show
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            We built <span className="font-semibold text-slate-800">{template.name}</span> for you
            and put it in <span className="font-semibold text-slate-800">{starterPlaylist?.name || STARTER_PLAYLIST_NAME}</span>.
            It&apos;s a real, editable board — change the words, colors, and photos, then pair a
            screen to send it to the wall.
          </p>
          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
            <Link
              href={builderHref}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700"
            >
              <Paintbrush className="h-4 w-4" aria-hidden />
              Customize this board
            </Link>
            <Link
              href={screensHref}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <MonitorPlay className="h-4 w-4" aria-hidden />
              Pair a screen
            </Link>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Nothing is published yet — this board only goes live once you schedule it on a screen.
          </p>
        </div>
      </div>
    </section>
  );
}
