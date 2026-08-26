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
 * IT RETIRES WHEN THE OPERATOR HAS OUTGROWN IT — THREE WAYS (fixed 2026-08-25).
 * The rule used to be "zero screens", full stop, and the comment here bragged
 * that it needed no dismiss state. That was the bug: an operator with no
 * hardware yet who had already built his own boards was shown the beginner
 * "here's the board we made you" hero forever, with no way to clear it
 * (operator: "this screen is very nice but it never goes away, even if i make
 * the templaet"). Pairing a screen is one graduation; BUILDING YOUR OWN CONTENT
 * is another. So the card retires when ANY of these is true:
 *
 *   1. A real screen is paired — the live fleet is the truth and a simulation
 *      would be noise.
 *   2. `hasOwnContent` — the tenant has content beyond the single item-less
 *      playlist we seeded (see use-starter-board.ts for why that shape is
 *      unambiguous and why it is read off an already-mounted query).
 *   3. The operator dismissed it. Signal 2 cannot see a board that was built
 *      but never put in a playlist — proving THAT needs the whole
 *      `GET /templates` gallery on every dashboard load — so the X is the
 *      backstop that makes "stuck forever" impossible regardless of what we
 *      can detect.
 *
 * DISMISS FOLLOWS THE GETTING-STARTED GUIDE'S PATTERN — a localStorage flag,
 * read in an effect, every access try/caught (dashboard/page.tsx
 * `edu_dashboard_hint_dismissed`). It is keyed BY TENANT because an operator who
 * runs three locations graduates them one at a time. No new user-facing setting,
 * no schema, no request. Unlike the guide there is no "show it again" pill: this
 * card's whole complaint was that it would not go away, and nothing in it is
 * lost — the board stays one click away in Templates, and the getting-started
 * guide's step 1 links to the very same builder.
 *
 * IT IS NOT THE ONLY WAY TO PAIR A SCREEN. Verified before letting it retire on
 * a 0-screen tenant: /screens is also reachable from the sidebar nav, the mobile
 * tab bar, the mobile dashboard's "Screens" quick action + "Screens online" row,
 * the getting-started guide's Connect-a-Screen step, and three dashboard KPI
 * cards — including "Fleet health", which renders "No screens paired" for
 * exactly this tenant. Retiring the card strands nobody.
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
 * paired AND the card has not already retired. No pollers, no interval, no blur
 * — mobile-perf rules hold.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MonitorPlay, Paintbrush, Sparkles, X } from 'lucide-react';
import { useTemplate } from '@/hooks/use-api';
import { STARTER_PLAYLIST_NAME, useStarterBoard } from '@/hooks/use-starter-board';
import { useUIStore } from '@/store/ui-store';
import { ScaledTemplateThumbnail } from '@/components/templates/ScaledTemplateThumbnail';

/** Per-tenant "I'm done with this" flag. See the dismiss note in the header. */
export function starterBoardDismissKey(schoolId: string) {
  return 'edu_starter_board_dismissed:' + schoolId;
}

export function StarterBoardCard({ schoolId }: { schoolId: string }) {
  const {
    fleetIsEmpty,
    playlist: starterPlaylist,
    template: starterSummary,
    hasOwnContent,
  } = useStarterBoard();
  const role = useUIStore((s) => s.user?.role);

  // `null` = "haven't read localStorage yet". Rendering nothing until it is read
  // keeps the server's HTML and the client's first paint identical (no
  // hydration mismatch) AND means a dismissed card never flashes a full
  // simulated TV before removing itself.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(starterBoardDismissKey(schoolId)) === '1');
    } catch {
      setDismissed(false);
    }
  }, [schoolId]);
  const dismiss = () => {
    setDismissed(true);
    // Private mode / blocked storage: the card still goes away for this
    // session, it just can't remember. Never throw at the operator.
    try { localStorage.setItem(starterBoardDismissKey(schoolId), '1'); } catch { /* ignore */ }
  };

  // Every reason the card would not render is folded into the id, so a retired
  // card costs ZERO requests — the same discipline as the original fleet gate.
  const retired = !fleetIsEmpty || hasOwnContent || dismissed !== false;
  const templateId = retired ? '' : (starterSummary?.id ?? '');
  // `useTemplate` self-disables on an empty id, so nothing is requested for a
  // tenant that already has screens, has its own content, dismissed the card,
  // or has no starter board.
  const { data: template } = useTemplate(templateId);

  // A read-only viewer can neither edit a template nor pair a screen; showing
  // them two buttons they'll be 403'd on is worse than showing nothing.
  if (role === 'RESTRICTED_VIEWER') return null;
  if (retired || !template?.zones?.length) return null;

  const builderHref = `/${schoolId}/templates/builder/${template.id}`;
  const screensHref = `/${schoolId}/screens`;

  return (
    <section className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      {/* The safety valve. Same affordance + same wording style as the
          getting-started guide's X, so an operator who has already learned to
          close that card knows what this one does. Copy stays literal English
          because every other string in this card is — the card is not wired to
          next-intl at all, and half-translating one tooltip is worse than
          none; localizing it is a whole-card job.
          White chip, not a bare glyph: stacked below `lg` this button sits over
          the dark TV bezel, where a slate-400 X would vanish. */}
      <button
        type="button"
        onClick={dismiss}
        title="Hide this card"
        aria-label="Hide the starter board card"
        className="absolute top-3 right-3 z-10 rounded-lg bg-white/90 p-1.5 text-slate-500 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-white hover:text-slate-800"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
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

        {/* ─── The two moves that follow ────────────────────────
            `lg:pr-9` keeps the headline clear of the dismiss X in the
            side-by-side layout, where this column reaches the card's top edge
            whenever it is taller than the TV. */}
        <div className="min-w-0 flex-1 lg:pr-9">
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
