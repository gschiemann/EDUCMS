'use client';

/**
 * Team abbreviations — what the ribbon, scorebug and team-abbr widgets show
 * for each side (Muse beta S-04 / DEV-028, 2026-10-07).
 *
 * Every surface used to take the first three letters of the team name, so
 * "Muse Sports Test Home" and "Muse Sports Test Away" both read MUS. The
 * shared rule (`resolveTeamAbbrevs`, @cms/api-types) now derives a smarter
 * default; this card shows it as an editable placeholder, saves an override
 * on blur/Enter (one PATCH, never per keystroke) and warns when the two
 * sides would read the same.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isValidTeamAbbrevInput, normalizeTeamAbbrev, resolveTeamAbbrevs } from '@cms/api-types';
import { useUpdateGameDetails } from '@/hooks/use-api';

export interface TeamAbbrevGame {
  homeTeam?: string | null;
  awayTeam?: string | null;
  homeAbbrev?: string | null;
  awayAbbrev?: string | null;
}

export function TeamAbbrevFields({ gameId, game }: { gameId: string; game: TeamAbbrevGame }) {
  const t = useTranslations('sportsConsoleSetup');
  const update = useUpdateGameDetails(gameId);
  const [home, setHome] = useState(game.homeAbbrev ?? '');
  const [away, setAway] = useState(game.awayAbbrev ?? '');
  const [dirty, setDirty] = useState<'home' | 'away' | null>(null);

  // Follow the server value unless that side is being edited.
  // `dirty` is read, not depended on: only a SERVER change should re-sync.
  useEffect(() => {
    if (dirty !== 'home') setHome(game.homeAbbrev ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.homeAbbrev]);
  useEffect(() => {
    if (dirty !== 'away') setAway(game.awayAbbrev ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.awayAbbrev]);

  // What a board would show with the CURRENT drafts — the derived default
  // where a box is empty — so the collision warning is live while typing.
  const shown = resolveTeamAbbrevs({
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    homeAbbrev: isValidTeamAbbrevInput(home) ? home : null,
    awayAbbrev: isValidTeamAbbrevInput(away) ? away : null,
  });
  const derived = resolveTeamAbbrevs({ homeTeam: game.homeTeam, awayTeam: game.awayTeam });

  const commit = (side: 'home' | 'away', raw: string) => {
    setDirty(null);
    if (!isValidTeamAbbrevInput(raw)) return; // the inline error stays; nothing is sent
    const next = normalizeTeamAbbrev(raw);
    const current = side === 'home' ? game.homeAbbrev ?? null : game.awayAbbrev ?? null;
    if (next === current) return;
    update.mutate(side === 'home' ? { homeAbbrev: next } : { awayAbbrev: next });
  };

  const field = (side: 'home' | 'away', value: string, setValue: (v: string) => void, teamName: string) => {
    const invalid = !isValidTeamAbbrevInput(value);
    const id = `team-abbrev-${side}`;
    return (
      <div className="min-w-0">
        <label htmlFor={id} className="block text-xs text-slate-500 truncate">{teamName}</label>
        <input
          id={id}
          value={value}
          maxLength={5}
          placeholder={side === 'home' ? derived.home : derived.away}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(e) => { setDirty(side); setValue(e.target.value.toUpperCase()); }}
          onBlur={(e) => commit(side, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="mt-1 w-24 min-h-[40px] rounded-lg border border-slate-200 px-2.5 text-sm font-bold uppercase tracking-wider bg-white"
        />
        {invalid && (
          <p id={`${id}-error`} className="mt-1 text-[11px] text-rose-600">{t('abbrevInvalid')}</p>
        )}
      </div>
    );
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-100" data-testid="team-abbrev-fields">
      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{t('abbrevTitle')}</div>
      <p className="text-xs text-slate-500 mt-1">{t('abbrevHelp')}</p>
      <div className="mt-2 flex flex-wrap items-start gap-4">
        {field('home', home, setHome, game.homeTeam || t('abbrevHome'))}
        {field('away', away, setAway, game.awayTeam || t('abbrevAway'))}
      </div>
      {shown.collision && (
        <p role="status" data-testid="team-abbrev-collision" className="mt-2 text-xs font-semibold text-amber-700">
          {t('abbrevCollision', { abbrev: shown.home })}
        </p>
      )}
      {update.isError && (
        <p role="status" className="mt-2 text-xs text-rose-600">{t('abbrevSaveFailed')}</p>
      )}
    </div>
  );
}
