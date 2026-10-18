'use client';

/**
 * ScreenDisplayFactsSection — "Panel and playback pacing" on the screen
 * Overview (2026-10-18, player 1.1.42 field candidate). What the panel runs and
 * offers, how steadily the native engine's frames reached the display, which
 * experiments are on for this screen and what each did, whether the player
 * window held keep-screen-on, and how its last few finished sessions went — all
 * read from the player's own native report (`Screen.lastVideoReport.native`),
 * and nothing else.
 *
 * Facts only: no buttons, no links, no inputs, no polling. The rules (and every
 * sentence, as a catalogue reference) live in ./displayFacts.ts (pure, tested);
 * this only lays them out — stacked label-over-value rows, so a phone reads it
 * top to bottom without a table to scroll.
 *
 * Renders NOTHING for a screen without a native report (or with none of the
 * fields it reads): no empty box. And it cannot take the drawer down: everything
 * it prints is resolved to plain strings in one guarded step (`buildDisplayView`),
 * so a report nobody foresaw makes the card disappear instead of throwing.
 */

import { Fragment, useId, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LIST_SEPARATOR, buildDisplayView, type FactLine } from './displayFacts';

const LINE_TONE: Record<FactLine['tone'], string> = {
  strong: 'text-[12.5px] font-bold text-slate-800',
  normal: 'text-[12px] font-semibold text-slate-700',
  muted: 'text-[10.5px] font-semibold text-slate-500',
};

export function ScreenDisplayFactsSection({
  screen,
  now,
}: {
  screen: { lastVideoReport?: unknown } | null | undefined;
  /** The drawer's single clock, so every age on one render is measured against one instant. */
  now: number;
}) {
  const t = useTranslations('screens.displayFacts');
  const locale = useLocale();
  const headingId = useId();
  const report = screen?.lastVideoReport;
  const view = useMemo(() => buildDisplayView(report, { nowMs: now, locale }, t), [report, now, locale, t]);
  if (!view) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-slate-200 p-3.5"
      data-testid="display-facts-section"
    >
      <h3 id={headingId} className="text-[10px] font-black uppercase tracking-wider text-slate-400">
        {view.title}
      </h3>
      <p className="mt-1 text-[10.5px] font-semibold text-slate-500 leading-snug" data-testid="display-facts-provenance">
        {view.provenance}
      </p>
      {view.session && (
        <p className="mt-1 text-[10.5px] font-semibold text-slate-600 leading-snug" data-testid="display-facts-session">
          {view.session}
        </p>
      )}
      <dl className="mt-3 divide-y divide-slate-100">
        {view.rows.map((row) => (
          <div key={row.id} className="py-2.5 first:pt-0 last:pb-0" data-testid={`display-facts-${row.id}`}>
            <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">{row.label}</dt>
            <dd className="mt-1 space-y-1">
              {row.lines.map((line, i) => (
                <p key={i} className={`leading-snug break-words ${LINE_TONE[line.tone]}`}>
                  {/* A line of several figures wraps BETWEEN them, never inside one ("max / gap 96 ms"). */}
                  {line.parts.length > 1
                    ? line.parts.map((part, j) => (
                        <Fragment key={j}>
                          {j > 0 && LIST_SEPARATOR}
                          <span className="whitespace-nowrap">{part}</span>
                        </Fragment>
                      ))
                    : line.parts[0]}
                </p>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
