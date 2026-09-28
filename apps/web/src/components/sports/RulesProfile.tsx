'use client';

/**
 * The rules profile a game runs, on the operator's screens — K-12 sports
 * launch program, lane A3 (register rows K12-F01 and K12-F27).
 *
 *  - `RulesProfilePicker` — the New Game modal: which rules (NFHS varsity,
 *    UIL junior high, boys / girls lacrosse, a local pickleball format…) the
 *    game will be played under, what that choice has been checked against,
 *    and — for a state-option shot clock (NFHS basketball 35 s, boys lacrosse
 *    70 s, girls lacrosse 90 s) — whether this state uses it.
 *  - `GameRulesCard` — the console's Setup: the rules the game is bound to,
 *    the same verification line, and (before the game starts) the one
 *    audited way to switch it.
 *  - `RulesVerificationNote` — "rules not verified for this sport" said
 *    plainly wherever a profile is not source-checked (F27), instead of a
 *    scoreboard that looks like it knows the rule book.
 *
 * The profiles themselves — values, sources, the official scorer's review
 * list — are @cms/api-types sports-rules.ts; nothing here decides a rule.
 * Operator surface (not a player / Taurus surface): Tailwind is fine.
 */
import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  gameRulesInfo,
  inningGameCanEnd,
  rulesProfilesForSport,
  snapshotRules,
  sportForGame,
  type RulesProfile,
  type RulesVerification,
  type SportDefinition,
} from '@cms/api-types';
import { useSetGameRules } from '@/hooks/use-api';

type Translate = ReturnType<typeof useTranslations>;

/** A profile's translated name — "NFHS · Varsity · 2026-27". */
export function rulesProfileName(t: Translate, p: RulesProfile): string {
  if (p.variant === 'classic') return t('variant.classic');
  const local = p.association === 'Local format';
  const parts: string[] = [local ? t('localFormat') : p.association];
  if (p.division) parts.push(t(`division.${p.division}`));
  if (p.level !== 'any') parts.push(t(`level.${p.level}`));
  if (p.variant) parts.push(t(`variant.${p.variant}`));
  if (!local) parts.push(p.season);
  return parts.join(' · ');
}

const NOTE_TONE: Record<RulesVerification, string> = {
  'source-checked': 'text-emerald-700 bg-emerald-50 border-emerald-200',
  partial: 'text-amber-800 bg-amber-50 border-amber-200',
  'not-verified': 'text-rose-800 bg-rose-50 border-rose-200',
};

const NOTE_KEY: Record<RulesVerification, string> = {
  'source-checked': 'verification.sourceChecked',
  partial: 'verification.partial',
  'not-verified': 'verification.notVerified',
};

/** What a profile's values have been checked against, in one line. */
export function RulesVerificationNote({
  verification,
  className = '',
}: {
  verification: RulesVerification;
  className?: string;
}) {
  const t = useTranslations('sportsRules');
  return (
    <p
      data-testid="rules-verification"
      data-verification={verification}
      className={`rounded-lg border px-2.5 py-1.5 text-[12px] leading-snug ${NOTE_TONE[verification]} ${className}`}
    >
      {t(NOTE_KEY[verification])}
    </p>
  );
}

/** The shot-clock choice a state-option clock needs at setup, or null. */
function stateOptionShotClock(def: SportDefinition | undefined): SportDefinition['shotClock'] | null {
  const sc = def?.shotClock;
  return sc && sc.defaultLen === 0 && sc.options.length > 1 ? sc : null;
}

/**
 * New Game modal — the rules the game will be played under. `value` is a
 * profile key ('' = the sport's default); `shotClockLen` undefined = the
 * profile's default (OFF for a state-option clock).
 */
export function RulesProfilePicker({
  sport,
  value,
  onChange,
  shotClockLen,
  onShotClockLen,
}: {
  sport: string;
  value: string;
  onChange: (key: string) => void;
  shotClockLen: number | undefined;
  onShotClockLen: (len: number | undefined) => void;
}) {
  const t = useTranslations('sportsRules');
  const selectId = useId();
  const profiles = useMemo(() => rulesProfilesForSport(sport), [sport]);
  const selected = profiles.find((p) => p.key === value) ?? profiles[0];
  const def = useMemo(
    () => (selected ? sportForGame({ sport, rules: snapshotRules(selected) }) : undefined),
    [sport, selected],
  );
  if (!selected) return null;
  const shot = stateOptionShotClock(def);
  const shotLabel =
    shot?.label === 'Possession clock' ? t('shotClock.possessionLabel') : t('shotClock.label');
  const shotPick = shotClockLen ?? 0;

  return (
    <div className="mt-5" data-testid="rules-profile-picker">
      <label
        htmlFor={selectId}
        className="text-xs font-semibold text-slate-500 uppercase tracking-wide"
      >
        {t('pick')}
      </label>
      <select
        id={selectId}
        value={selected.key}
        onChange={(e) => {
          onChange(e.target.value);
          onShotClockLen(undefined);
        }}
        className="mt-1.5 block w-full min-h-[44px] rounded-lg border border-slate-200 bg-white px-2.5 text-sm"
      >
        {profiles.map((p) => (
          <option key={p.key} value={p.key}>
            {rulesProfileName(t, p)}
          </option>
        ))}
      </select>
      <RulesVerificationNote verification={selected.verification} className="mt-2" />
      {shot && (
        <div className="mt-3" data-testid="rules-shot-clock-choice">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {shotLabel}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {shot.options.map((len) => (
              <button
                key={len}
                type="button"
                aria-pressed={shotPick === len}
                onClick={() => onShotClockLen(len)}
                className={`min-h-[44px] rounded-lg border-2 px-3 text-xs font-semibold transition-colors ${
                  shotPick === len
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {len === 0 ? t('shotClock.off') : t('shotClock.seconds', { seconds: len })}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{t('shotClock.stateOption')}</p>
        </div>
      )}
    </div>
  );
}

/**
 * K12-F20 — baseball / softball: when the home team leads in the bottom of
 * the last regulation inning (or an extra one), the game is over — it did not
 * need to bat, or it just walked off. A hint for the table; the umpire ends
 * the game (`inningGameCanEnd`, @cms/api-types sports-rules.ts).
 */
export function InningGameOverHint({
  def,
  game,
}: {
  def: SportDefinition | undefined;
  game: { segment?: unknown; homeScore?: unknown; awayScore?: unknown; stats?: unknown };
}) {
  const t = useTranslations('sportsRules');
  if (!inningGameCanEnd(def, game)) return null;
  return (
    <p
      role="status"
      data-testid="inning-game-over-hint"
      className="w-full rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px] font-semibold text-emerald-900"
    >
      {t('gameCanEnd', { inning: Number(game.segment) })}
    </p>
  );
}

/**
 * Console Setup — the rules the game is bound to, what they were checked
 * against, and (only before the game starts) the audited switch.
 */
export function GameRulesCard({
  gameId,
  game,
}: {
  gameId: string;
  game: { sport?: string | null; rules?: unknown; status?: string | null };
}) {
  const t = useTranslations('sportsRules');
  const selectId = useId();
  const info = gameRulesInfo(game);
  const setRules = useSetGameRules(gameId);
  const [pick, setPick] = useState('');
  const [failed, setFailed] = useState(false);
  const open = game.status === 'SCHEDULED' || game.status === 'PRE_GAME';
  const profiles = rulesProfilesForSport(game.sport ?? null);
  const current = info.profile;
  const name = current && info.key ? rulesProfileName(t, current) : t('variant.classic');
  const target = pick || info.key || '';

  return (
    <div
      className="mt-3 rounded-xl border border-slate-200 bg-white p-3"
      data-testid="game-rules-card"
      data-rules-profile={info.key ?? ''}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t('title')}
        </span>
        <span className="text-sm font-bold text-slate-900">{name}</span>
      </div>
      <RulesVerificationNote verification={info.verification} className="mt-2" />
      {!info.key && <p className="mt-2 text-[12px] text-slate-500">{t('legacy')}</p>}
      {open ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="sr-only">
            {t('pick')}
          </label>
          <select
            id={selectId}
            value={target}
            onChange={(e) => {
              setPick(e.target.value);
              setFailed(false);
            }}
            className="min-h-[44px] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm"
          >
            {!info.key && <option value="">{t('variant.classic')}</option>}
            {profiles.map((p) => (
              <option key={p.key} value={p.key}>
                {rulesProfileName(t, p)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pick || pick === info.key || setRules.isPending}
            onClick={() =>
              setRules.mutate(
                { rulesProfile: pick },
                {
                  onSuccess: () => setPick(''),
                  onError: () => setFailed(true),
                },
              )
            }
            className="min-h-[44px] rounded-lg bg-indigo-600 px-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {setRules.isPending ? t('changing') : t('change')}
          </button>
          {failed && (
            <p role="alert" className="w-full text-[12px] text-rose-700">
              {t('changeFailed')}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-slate-500">{t('locked')}</p>
      )}
    </div>
  );
}
