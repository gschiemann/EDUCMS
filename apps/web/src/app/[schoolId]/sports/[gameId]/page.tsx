'use client';

/**
 * VenueOS Sports — Sprint 13. The operator game-day control surface.
 *
 * Entirely data-driven off the SportDefinition for the game's sport:
 * the score increments, the clock model, the segment structure, the
 * stat fields, and the celebration cues all come from one declarative
 * object in @cms/api-types. Adding a sport adds controls here for free.
 *
 * Every action writes through useGameControl() which PATCHes the API
 * and pushes the updated game straight into the query cache, so the
 * console reacts instantly; the 4s poll behind it is a reconcile net.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ExternalLink,
  Play,
  Pause,
  RotateCcw,
  Minus,
  Plus,
  Tv,
  Check,
  MonitorPlay,
  Star,
} from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useGame,
  useGameControl,
  useGameScreens,
  useShowGameOnScreens,
  useHideGameFromScreens,
} from '@/hooks/use-api';
import { findSport } from '@cms/api-types';
import type { SportDefinition, SportStatField } from '@cms/api-types';

const GAME_STATUSES: { key: string; label: string }[] = [
  { key: 'SCHEDULED', label: 'Scheduled' },
  { key: 'PRE_GAME', label: 'Pre-game' },
  { key: 'LIVE', label: 'Live' },
  { key: 'HALFTIME', label: 'Halftime' },
  { key: 'FINAL', label: 'Final' },
];

// ── clock helpers ──────────────────────────────────────────────

function fmtClock(ms: number): string {
  const safe = Math.max(0, ms);
  const m = Math.floor(safe / 60_000);
  const s = Math.floor((safe % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseClock(text: string): number | null {
  const m = text.trim().match(/^(\d{1,3}):([0-5]?\d)$/);
  if (!m) return null;
  return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000;
}

/** Live clock projected from the stored anchor, ticking every 100ms. */
function useLiveClock(game: any, def: SportDefinition | undefined): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!game || !def) return;
    const anchorAt = new Date(game.clockUpdatedAt).getTime();
    const project = () => {
      if (!game.clockRunning || def.clock.type === 'none') {
        setMs(game.clockMs);
        return;
      }
      const elapsed = Date.now() - anchorAt;
      if (def.clock.type === 'countup') setMs(game.clockMs + elapsed);
      else setMs(Math.max(0, game.clockMs - elapsed));
    };
    project();
    if (!game.clockRunning || def.clock.type === 'none') return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
  }, [game?.clockMs, game?.clockRunning, game?.clockUpdatedAt, def]);
  return ms;
}

// ── page ───────────────────────────────────────────────────────

export default function GameControlPage() {
  return (
    <RoleGate
      allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR']}
      fallback={
        <div className="text-center py-24 text-sm text-slate-500">
          You don&rsquo;t have permission to run a game.
        </div>
      }
    >
      <GameControl />
    </RoleGate>
  );
}

function GameControl() {
  const params = useParams();
  const router = useRouter();
  const schoolId = String(params?.schoolId || '');
  const gameId = String(params?.gameId || '');

  const { data: game, isLoading, error } = useGame(gameId);
  const ctl = useGameControl(gameId);
  const def = useMemo(() => (game ? findSport((game as any).sport) : undefined), [game]);
  const liveMs = useLiveClock(game, def);

  // "Stream overlay" copies the public scorebug URL to the clipboard
  // so the operator can paste it straight into an OBS / vMix browser
  // source. Falls back to opening the URL if the clipboard is blocked.
  const [copied, setCopied] = useState(false);
  const copyOverlayUrl = () => {
    const url = `${window.location.origin}/scorebug/${gameId}`;
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => window.open(url, '_blank'));
    } else {
      window.open(url, '_blank');
    }
  };

  if (isLoading) {
    return <div className="text-center py-24 text-sm text-slate-400">Loading game…</div>;
  }
  if (error || !game) {
    return (
      <div className="text-center py-24 text-sm text-slate-500">
        Game not found.
        <div className="mt-3">
          <Button variant="outline" onClick={() => router.push(`/${schoolId}/sports`)}>
            Back to Game Day
          </Button>
        </div>
      </div>
    );
  }
  if (!def) {
    return (
      <div className="text-center py-24 text-sm text-slate-500">
        Unknown sport &ldquo;{(game as any).sport}&rdquo;.
      </div>
    );
  }

  const g: any = game;
  const homeColor = g.homeColor || '#4f46e5';
  const awayColor = g.awayColor || '#dc2626';

  return (
    <div className="max-w-5xl mx-auto px-1 py-2">
      {/* header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.push(`/${schoolId}/sports`)}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Game Day
        </button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={copyOverlayUrl}
            title="Copy the broadcast scorebug URL for an OBS / vMix browser source"
          >
            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Tv className="h-4 w-4" />}
            {copied ? 'Overlay URL copied' : 'Stream overlay'}
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => window.open(`/board/${gameId}`, '_blank')}
          >
            <ExternalLink className="h-4 w-4" />
            Open scoreboard
          </Button>
        </div>
      </div>

      {/* live preview bar */}
      <div className="rounded-2xl bg-slate-900 text-white p-5 flex items-center justify-between">
        <TeamReadout name={g.homeTeam} score={g.homeScore} color={homeColor} align="left" />
        <div className="text-center px-4">
          <div className="text-xs font-semibold tracking-widest text-slate-400">
            {def.emoji} {segmentText(def, g)}
          </div>
          {def.clock.type !== 'none' && (
            <div
              className={`text-4xl font-black tabular-nums mt-1 ${
                g.clockRunning ? 'text-amber-300' : 'text-white'
              }`}
            >
              {fmtClock(liveMs)}
            </div>
          )}
        </div>
        <TeamReadout name={g.awayTeam} score={g.awayScore} color={awayColor} align="right" />
      </div>

      {/* status */}
      <Section title="Game status">
        <div className="flex flex-wrap gap-2">
          {GAME_STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => ctl.status.mutate({ status: s.key })}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                g.status === s.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      {/* push the scoreboard to the venue's screens */}
      <Section title="Show on screens">
        <ScreenPushPanel gameId={gameId} />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* score */}
        <Section title="Score">
          <div className="grid grid-cols-2 gap-4">
            <ScoreColumn
              label={g.homeTeam}
              score={g.homeScore}
              color={homeColor}
              increments={def.score.increments}
              onAdd={(d) => ctl.score.mutate({ team: 'home', delta: d })}
            />
            <ScoreColumn
              label={g.awayTeam}
              score={g.awayScore}
              color={awayColor}
              increments={def.score.increments}
              onAdd={(d) => ctl.score.mutate({ team: 'away', delta: d })}
            />
          </div>
        </Section>

        {/* clock + segment */}
        <Section title={def.clock.type === 'none' ? def.segment.name : 'Clock & ' + def.segment.name.toLowerCase()}>
          {def.clock.type !== 'none' && (
            <ClockControls
              game={g}
              def={def}
              liveMs={liveMs}
              onAction={(action, ms) => ctl.clock.mutate({ action, ms })}
            />
          )}
          <div className={def.clock.type !== 'none' ? 'mt-4 pt-4 border-t border-slate-100' : ''}>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              {def.segment.name}
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="icon"
                variant="outline"
                onClick={() => ctl.segment.mutate({ delta: -1 })}
                aria-label={`Previous ${def.segment.name.toLowerCase()}`}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <div className="text-2xl font-black text-slate-900 min-w-[120px] text-center">
                {segmentText(def, g)}
              </div>
              <Button
                size="icon"
                variant="outline"
                onClick={() => ctl.segment.mutate({ delta: 1 })}
                aria-label={`Next ${def.segment.name.toLowerCase()}`}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Section>
      </div>

      {/* celebrations */}
      <Section title="Celebration cues">
        <p className="text-xs text-slate-400 mb-3">
          Tap a cue — every scoreboard playing this game fires the animation.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {def.celebrations.map((c) => (
            <CueButton key={c.key} cue={c} onFire={() => ctl.cue.mutate({ key: c.key })} />
          ))}
        </div>
      </Section>

      {/* stats */}
      {def.stats.length > 0 && (
        <Section title="Game stats">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {def.stats.map((s) => (
              <StatField
                key={s.key}
                field={s}
                value={(g.stats || {})[s.key]}
                onCommit={(v) => ctl.stats.mutate({ stats: { [s.key]: v } })}
              />
            ))}
          </div>
        </Section>
      )}

      {/* broadcast spotlight */}
      <Section title="Scoreboard spotlight">
        <SpotlightControl gameId={gameId} current={g.spotlight} />
      </Section>
    </div>
  );
}

// ── segment text ───────────────────────────────────────────────

function segmentText(def: SportDefinition, g: any): string {
  const n = g.segment;
  if (n > def.segment.count) {
    const ot = n - def.segment.count;
    return ot > 1 ? `OT${ot}` : 'OT';
  }
  if (def.segment.name === 'Inning') {
    const half = String((g.stats || {}).half || '').toUpperCase();
    return `${half ? half + ' ' : ''}#${n}`;
  }
  return `${def.segment.name} ${n}`;
}

// ── sub-components ─────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl bg-white ring-1 ring-slate-200 p-5">
      <h2 className="text-sm font-bold text-slate-900 mb-3">{title}</h2>
      {children}
    </div>
  );
}

function ScreenPushPanel({ gameId }: { gameId: string }) {
  const { data: screens, isLoading } = useGameScreens(gameId);
  const show = useShowGameOnScreens(gameId);
  const hide = useHideGameFromScreens(gameId);

  const list: any[] = Array.isArray(screens) ? screens : [];
  const showingCount = list.filter((s) => s.showing).length;
  const busy = show.isPending || hide.isPending;

  if (isLoading) {
    return <p className="text-sm text-slate-400">Loading screens…</p>;
  }
  if (list.length === 0) {
    return <p className="text-sm text-slate-400">No paired screens in this venue yet.</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs text-slate-400">
          Push this scoreboard to a display. An emergency alert always overrides it.
        </p>
        {showingCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => hide.mutate(undefined)}
            className="shrink-0"
          >
            Stop all ({showingCount})
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {list.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2"
          >
            <span
              className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                s.status === 'ONLINE' ? 'bg-green-500' : 'bg-slate-300'
              }`}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800 truncate">{s.name}</div>
              {s.showingOther && !s.showing && (
                <div className="text-[11px] text-amber-600">showing another game</div>
              )}
            </div>
            {s.showing ? (
              <Button
                size="sm"
                disabled={busy}
                className="bg-green-600 text-white gap-1.5 shrink-0"
                onClick={() => hide.mutate([s.id])}
              >
                <MonitorPlay className="h-3.5 w-3.5" />
                On air
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                className="shrink-0"
                onClick={() => show.mutate([s.id])}
              >
                Show
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamReadout({
  name,
  score,
  color,
  align,
}: {
  name: string;
  score: number;
  color: string;
  align: 'left' | 'right';
}) {
  return (
    <div className={`flex-1 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <div className="flex items-center gap-2" style={{ flexDirection: align === 'right' ? 'row-reverse' : 'row' }}>
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-sm font-bold truncate max-w-[180px]">{name}</span>
      </div>
      <div className="text-5xl font-black tabular-nums mt-1">{score}</div>
    </div>
  );
}

function ScoreColumn({
  label,
  score,
  color,
  increments,
  onAdd,
}: {
  label: string;
  score: number;
  color: string;
  increments: number[];
  onAdd: (delta: number) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-bold text-slate-600 truncate">{label}</span>
      </div>
      <div className="text-5xl font-black text-slate-900 tabular-nums text-center my-2">
        {score}
      </div>
      <div className="flex flex-wrap gap-1.5 justify-center">
        {increments.map((inc) => (
          <button
            key={inc}
            onClick={() => onAdd(inc)}
            className="h-9 min-w-[44px] px-2 rounded-lg text-sm font-bold text-white"
            style={{ backgroundColor: color }}
          >
            +{inc}
          </button>
        ))}
        <button
          onClick={() => onAdd(-1)}
          className="h-9 min-w-[44px] px-2 rounded-lg text-sm font-bold bg-slate-100 text-slate-600 hover:bg-slate-200"
        >
          −1
        </button>
      </div>
    </div>
  );
}

function ClockControls({
  game,
  def,
  liveMs,
  onAction,
}: {
  game: any;
  def: SportDefinition;
  liveMs: number;
  onAction: (action: string, ms?: number) => void;
}) {
  const [setText, setSetText] = useState('');

  const commitSet = () => {
    const ms = parseClock(setText);
    if (ms !== null) {
      onAction('set', ms);
      setSetText('');
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <div
          className={`text-5xl font-black tabular-nums ${
            game.clockRunning ? 'text-amber-500' : 'text-slate-900'
          }`}
        >
          {fmtClock(liveMs)}
        </div>
        <div className="flex gap-2 ml-auto">
          {game.clockRunning ? (
            <Button onClick={() => onAction('pause')} className="gap-1.5 bg-amber-500 text-white">
              <Pause className="h-4 w-4" />
              Pause
            </Button>
          ) : (
            <Button onClick={() => onAction('start')} className="gap-1.5 bg-green-600 text-white">
              <Play className="h-4 w-4" />
              Start
            </Button>
          )}
          <Button variant="outline" onClick={() => onAction('reset')} className="gap-1.5">
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Input
          value={setText}
          onChange={(e) => setSetText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commitSet()}
          placeholder="MM:SS"
          className="w-24"
        />
        <Button variant="secondary" size="sm" onClick={commitSet} disabled={parseClock(setText) === null}>
          Set clock
        </Button>
        <span className="text-xs text-slate-400">
          {def.clock.type === 'countdown' ? 'Counts down' : 'Counts up'}
        </span>
      </div>
    </div>
  );
}

function CueButton({
  cue,
  onFire,
}: {
  cue: { key: string; label: string; emoji: string };
  onFire: () => void;
}) {
  const [fired, setFired] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const fire = () => {
    onFire();
    setFired(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFired(false), 1400);
  };

  return (
    <button
      onClick={fire}
      className={`flex flex-col items-center gap-1 rounded-xl border-2 py-3 px-2 transition-all ${
        fired
          ? 'border-green-500 bg-green-50 scale-95'
          : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
      }`}
    >
      <span className="text-3xl">{cue.emoji}</span>
      <span className="text-xs font-semibold text-slate-700 text-center leading-tight">
        {fired ? 'Fired!' : cue.label}
      </span>
    </button>
  );
}

function StatField({
  field,
  value,
  onCommit,
}: {
  field: SportStatField;
  value: unknown;
  onCommit: (v: number | string) => void;
}) {
  const [local, setLocal] = useState<string>(value === undefined || value === null ? '' : String(value));

  // Re-sync when a poll / another operator changes the value, unless
  // the field is focused (don't yank the operator's in-progress edit).
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setLocal(value === undefined || value === null ? '' : String(value));
    }
  }, [value]);

  const commit = () => {
    if (field.type === 'number') {
      let n = parseInt(local, 10);
      if (Number.isNaN(n)) n = field.min ?? 0;
      if (field.min !== undefined) n = Math.max(field.min, n);
      if (field.max !== undefined) n = Math.min(field.max, n);
      setLocal(String(n));
      onCommit(n);
    } else {
      onCommit(local);
    }
  };

  return (
    <div>
      <label className="text-xs font-semibold text-slate-500">{field.label}</label>
      <Input
        className="mt-1"
        type={field.type === 'number' ? 'number' : 'text'}
        value={local}
        min={field.min}
        max={field.max}
        onFocus={() => { focused.current = true; }}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { focused.current = false; commit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

function SpotlightControl({ gameId, current }: { gameId: string; current: any }) {
  const ctl = useGameControl(gameId);
  const sp = current && typeof current === 'object' ? current : {};
  const [title, setTitle] = useState<string>(sp.title || '');
  const [photoUrl, setPhotoUrl] = useState<string>(sp.photoUrl || '');
  const [subtitle, setSubtitle] = useState<string>(sp.subtitle || '');
  const seed: Array<{ label?: string; value?: string }> = Array.isArray(sp.lines) ? sp.lines : [];
  const [lines, setLines] = useState(
    [0, 1, 2, 3].map((i) => ({ label: seed[i]?.label || '', value: seed[i]?.value || '' })),
  );
  const onAir = !!(sp.visible && sp.title);

  const setLine = (i: number, key: 'label' | 'value', val: string) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));

  const show = () => {
    if (!title.trim()) return;
    ctl.spotlight.mutate({
      visible: true,
      title: title.trim(),
      photoUrl: photoUrl.trim() || undefined,
      subtitle: subtitle.trim() || undefined,
      lines: lines.filter((l) => l.label.trim() || l.value.trim()),
    });
  };
  const remove = () => ctl.spotlight.mutate({ clear: true });

  return (
    <div>
      <p className="text-xs text-slate-400 mb-3">
        Feature a player or a promo on the scoreboard — photo, title, and up to four stat
        lines.
        {onAir && <span className="ml-1 font-bold text-green-600">● On the board now</span>}
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500">Title</label>
          <Input
            className="mt-1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Mookie Betts  ·  or  ·  $2 Hot Dog Night"
            maxLength={80}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Subtitle</label>
          <Input
            className="mt-1"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="#50 · Right Field"
            maxLength={80}
          />
        </div>
      </div>
      <div className="mt-3">
        <label className="text-xs font-semibold text-slate-500">Photo URL</label>
        <div className="mt-1 flex items-center gap-2">
          {photoUrl.trim() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photoUrl}
              src={photoUrl}
              alt=""
              className="h-10 w-10 shrink-0 rounded object-cover ring-1 ring-slate-200"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : null}
          <Input
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="https://…/headshot.jpg"
            maxLength={2048}
          />
        </div>
      </div>
      <div className="mt-3">
        <label className="text-xs font-semibold text-slate-500">Stat lines</label>
        <div className="mt-1 grid sm:grid-cols-2 gap-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                className="w-24"
                value={l.label}
                onChange={(e) => setLine(i, 'label', e.target.value)}
                placeholder="AVG"
                maxLength={24}
              />
              <Input
                value={l.value}
                onChange={(e) => setLine(i, 'value', e.target.value)}
                placeholder=".312"
                maxLength={24}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button
          onClick={show}
          disabled={!title.trim() || ctl.spotlight.isPending}
          className="gap-1.5"
        >
          <Star className="h-4 w-4" />
          Put on the board
        </Button>
        {onAir && (
          <Button variant="outline" onClick={remove} disabled={ctl.spotlight.isPending}>
            Remove from board
          </Button>
        )}
      </div>
    </div>
  );
}
