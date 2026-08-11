'use client';

/**
 * VenueOS Sports — Sprint 13. The game list + create flow.
 *
 * The hub of the SPORTS vertical: every game in the tenant, a "New
 * game" creator (sport + teams + colors), and per-game links into the
 * operator control surface and the public scoreboard board page.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Trophy, Plus, Radio, ExternalLink, Trash2, X, BadgeDollarSign, Copy,
  Loader2, ImageIcon, Globe, Search, ChevronDown, Clock,
} from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { useGames, useCreateGame, useDeleteGame, useDuplicateGame, useScrapeBranding, useTemplates } from '@/hooks/use-api';
import { appConfirm } from '@/components/ui/app-dialog';
import { SPORTS, findSport, formatScore } from '@cms/api-types';
import { AssetPicker } from '@/components/assets/AssetPicker';
import { filterRelevantTemplates } from '@/lib/template-relevance';
import { formatGameWhen, orderGames } from './game-list';
// Inputs-wave SCHED — client-boundary kickoff conversion (zone-less
// datetime-local → ISO with timezone; see scheduled-at.ts).
import { datetimeLocalToIso } from './scheduled-at';

const STATUS_BADGE: Record<string, string> = {
  SCHEDULED: 'bg-slate-100 text-slate-600',
  PRE_GAME: 'bg-amber-100 text-amber-700',
  LIVE: 'bg-red-100 text-red-700',
  HALFTIME: 'bg-blue-100 text-blue-700',
  FINAL: 'bg-slate-200 text-slate-700',
};

const TEAM_COLORS = ['#4f46e5', '#dc2626', '#0891b2', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#0f172a'];

export default function SportsPage() {
  return (
    <RoleGate
      // 2026-06-09 — operator: "lock viewer out of the sports, only admin and
      // editor." RESTRICTED_VIEWER removed → Sports is admin + Editor only.
      allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR']}
      fallback={
        <div className="text-center py-24 text-sm text-slate-500">
          You don&rsquo;t have permission to view game day.
        </div>
      }
    >
      <SportsHub />
    </RoleGate>
  );
}

function SportsHub() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const schoolId = String(params?.schoolId || '');
  const { data: games, isLoading } = useGames();
  const deleteGame = useDeleteGame();
  const duplicateGame = useDuplicateGame();
  const [creating, setCreating] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  // Sports Wave S2-3 (2026-07-02) — deep-link from a template gallery
  // card's "Use for a game →" action (templates/page.tsx). Auto-opens
  // New Game with this template preselected in the RIGHT layout
  // dropdown (surface tells us which of the three: scoreboard / ribbon
  // / scorebug) instead of leaving the operator to hunt for it. Read
  // once on mount (the query param has done its job); the modal owns
  // the value after that. `router.replace` strips it from the URL so a
  // page refresh / bookmark doesn't reopen the modal unexpectedly.
  const [presetTemplate, setPresetTemplate] = useState<{ id: string; surface: 'scoreboard' | 'ribbon' | 'scorebug' } | null>(null);
  useEffect(() => {
    const tId = searchParams?.get('templateId');
    const surface = searchParams?.get('surface');
    const wantsNewGame = searchParams?.get('newGame') === '1';
    if (wantsNewGame && tId && (surface === 'scoreboard' || surface === 'ribbon' || surface === 'scorebug')) {
      setPresetTemplate({ id: tId, surface });
      setCreating(true);
      router.replace(`/${schoolId}/sports`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list: any[] = Array.isArray(games) ? games : [];
  // Sports Wave S4-2 (P2, 2026-07-02 deep-pass audit) — LIVE first, then
  // upcoming (dated soonest-first, undated after), then FINAL collapsed
  // behind a single disclosure. See ./game-list.ts for the pure ordering
  // rule + its unit tests.
  const { live, upcoming, past } = useMemo(() => orderGames(list), [list]);

  const handleDelete = async (id: string, label: string) => {
    const ok = await appConfirm({
      title: 'Delete game?',
      message: `"${label}" and its event log will be permanently removed.`,
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (ok) deleteGame.mutate(id);
  };

  // Clone a finished game's whole presentation setup into a fresh
  // SCHEDULED game and drop the operator straight into its console to
  // rename the teams / date. The "build one, run a week off it" path.
  const handleDuplicate = async (id: string) => {
    if (duplicatingId) return;
    setDuplicatingId(id);
    try {
      const copy: any = await duplicateGame.mutateAsync(id);
      if (copy?.id) router.push(`/${schoolId}/sports/${copy.id}`);
    } catch {
      /* mutation surfaces its own error; just clear the spinner */
    } finally {
      setDuplicatingId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-1 py-2">
      {/* header — stacks on phones so the action buttons never clip at the
          viewport edge (mobile audit P1); side-by-side from sm+ up. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
            <Trophy className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Game Day</h1>
            <p className="text-sm text-slate-500">
              Live scoreboards, clocks, and celebration cues for every venue.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => router.push(`/${schoolId}/sports/sponsors`)}
          >
            <BadgeDollarSign className="h-4 w-4" />
            Sponsors
          </Button>
          <Button onClick={() => setCreating(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            New game
          </Button>
        </div>
      </div>

      {/* game list — LIVE first, then upcoming, then a collapsed Past section */}
      {isLoading ? (
        <div className="text-center py-24 text-sm text-slate-400">Loading games…</div>
      ) : list.length === 0 ? (
        <div className="text-center py-24 rounded-2xl border-2 border-dashed border-slate-200">
          <Trophy className="h-10 w-10 mx-auto text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-600">No games yet</p>
          <p className="text-sm text-slate-400">Create your first game to start running a scoreboard.</p>
          <Button onClick={() => setCreating(true)} className="mt-4 gap-1.5">
            <Plus className="h-4 w-4" />
            New game
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {live.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {live.map((g) => (
                <GameCard
                  key={g.id}
                  g={g}
                  schoolId={schoolId}
                  router={router}
                  duplicatingId={duplicatingId}
                  onDuplicate={handleDuplicate}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {upcoming.map((g) => (
                <GameCard
                  key={g.id}
                  g={g}
                  schoolId={schoolId}
                  router={router}
                  duplicatingId={duplicatingId}
                  onDuplicate={handleDuplicate}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {past.length > 0 && (
            <details className="group rounded-2xl border border-slate-200 bg-white/60">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-600 select-none">
                <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                Past games ({past.length})
              </summary>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 pb-4 pt-1">
                {past.map((g) => (
                  <GameCard
                    key={g.id}
                    g={g}
                    schoolId={schoolId}
                    router={router}
                    duplicatingId={duplicatingId}
                    onDuplicate={handleDuplicate}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {creating && (
        <CreateGameModal
          onClose={() => { setCreating(false); setPresetTemplate(null); }}
          initialPresetTemplate={presetTemplate}
        />
      )}
    </div>
  );
}

/**
 * One game's card in the Game Day list. Extracted from SportsHub's render
 * (Sports Wave S4-2) so the LIVE / upcoming / past sections can all reuse
 * it. LIVE games get a pulsing dot on the status pill (audit ask: "LIVE
 * first (pulse dot)"); upcoming games with a scheduledAt show a relative
 * "Tonight 7:00 PM" style chip under the sport line.
 */
function GameCard({
  g,
  schoolId,
  router,
  duplicatingId,
  onDuplicate,
  onDelete,
}: {
  g: any;
  schoolId: string;
  router: ReturnType<typeof useRouter>;
  duplicatingId: string | null;
  onDuplicate: (id: string) => void;
  onDelete: (id: string, label: string) => void;
}) {
  const def = findSport(g.sport);
  const isLive = g.status === 'LIVE' || g.status === 'HALFTIME';
  const when = g.scheduledAt ? formatGameWhen(g.scheduledAt) : '';
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-5 hover:ring-indigo-300 transition-all">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{def?.emoji || '🏆'}</span>
          <div>
            <span className="text-sm font-semibold text-slate-500">
              {def?.name || g.sport}
            </span>
            {when && (
              <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
                <Clock className="h-3 w-3" />
                {when}
                {/* Inputs-wave SCHED — a pending auto-push (Game.autoPushAt
                    set) rides the same list payload: no extra fetch. */}
                {g.autoPushAt && (
                  <span
                    className="inline-flex items-center text-[9px] font-black tracking-widest text-indigo-700 bg-indigo-50 border border-indigo-200 px-1 py-px rounded"
                    title="Schedule game mode — the board goes up automatically 10 minutes before start"
                  >
                    AUTO
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${
            STATUS_BADGE[g.status] || STATUS_BADGE.SCHEDULED
          }`}
        >
          {isLive && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-600" />
            </span>
          )}
          {g.status === 'PRE_GAME' ? 'PRE-GAME' : g.status}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex-1">
          <div className="text-base font-bold text-slate-900 truncate">{g.homeTeam}</div>
          <div className="text-xs text-slate-400">Home</div>
        </div>
        <div className="px-4 text-3xl font-black text-slate-900 tabular-nums">
          {formatScore(def, g.homeScore)} <span className="text-slate-300">–</span> {formatScore(def, g.awayScore)}
        </div>
        <div className="flex-1 text-right">
          <div className="text-base font-bold text-slate-900 truncate">{g.awayTeam}</div>
          <div className="text-xs text-slate-400">Away</div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button
          size="sm"
          className="flex-1 gap-1.5"
          onClick={() => router.push(`/${schoolId}/sports/${g.id}`)}
        >
          <Radio className="h-3.5 w-3.5" />
          Control
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => window.open(`/board/${g.id}`, '_blank')}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Scoreboard
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={duplicatingId === g.id}
          onClick={() => onDuplicate(g.id)}
          aria-label="Duplicate game (clone its content into a new game)"
          title="Duplicate — clone this game's content into a fresh game"
        >
          <Copy className={`h-4 w-4 text-slate-400 ${duplicatingId === g.id ? 'animate-pulse' : ''}`} />
        </Button>
        <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onDelete(g.id, `${g.homeTeam} vs ${g.awayTeam}`)}
            aria-label="Delete game"
          >
            <Trash2 className="h-4 w-4 text-slate-400" />
          </Button>
        </RoleGate>
      </div>
    </div>
  );
}

/**
 * The home team is almost always the operator's own school — they
 * shouldn't retype its name / color / logo for every game. We remember
 * the last home team per tenant in localStorage, pre-fill it on the
 * next New Game, and let the operator edit it (a new value is saved
 * next time) or clear it entirely.
 */
const HOME_TEAM_KEY = (schoolId: string) => `venueos:lastHomeTeam:${schoolId}`;
interface SavedHomeTeam {
  name?: string;
  color?: string;
  logoUrl?: string;
}
function readSavedHomeTeam(schoolId: string): SavedHomeTeam | null {
  if (typeof window === 'undefined' || !schoolId) return null;
  try {
    const raw = localStorage.getItem(HOME_TEAM_KEY(schoolId));
    return raw ? (JSON.parse(raw) as SavedHomeTeam) : null;
  } catch {
    return null;
  }
}

// Exported (not just used internally) so Sports Wave S4-3's regression test
// can mount it directly and assert the deep-link-preselect + Advanced
// auto-expand behavior without driving the whole SportsHub + query params.
export function CreateGameModal({ onClose, initialPresetTemplate = null }: {
  onClose: () => void;
  /** Sports Wave S2-3 (2026-07-02) — preselects the matching layout
   *  dropdown when arriving via a gallery card's "Use for a game →"
   *  deep link (templates/page.tsx). */
  initialPresetTemplate?: { id: string; surface: 'scoreboard' | 'ribbon' | 'scorebug' } | null;
}) {
  useOverlayLock(); // hide mobile tab bar so the modal footer clears it
  const params = useParams();
  const router = useRouter();
  const schoolId = String(params?.schoolId || '');
  const createGame = useCreateGame();

  const [sport, setSport] = useState(SPORTS[0]?.key || 'football');
  // Home team — lazy-initialized from the remembered last home team.
  const [homeTeam, setHomeTeam] = useState(() => readSavedHomeTeam(schoolId)?.name || '');
  const [awayTeam, setAwayTeam] = useState('');
  const [homeColor, setHomeColor] = useState(() => readSavedHomeTeam(schoolId)?.color || TEAM_COLORS[0]);
  const [awayColor, setAwayColor] = useState(TEAM_COLORS[1]);
  const [homeLogoUrl, setHomeLogoUrl] = useState(() => readSavedHomeTeam(schoolId)?.logoUrl || '');
  const [awayLogoUrl, setAwayLogoUrl] = useState('');
  const [homeRemembered, setHomeRemembered] = useState(() => !!readSavedHomeTeam(schoolId)?.name);
  // Sports Wave S4-1 (P1-8) — optional kickoff date/time. `<input
  // type="datetime-local">` value; empty stays legal (undefined → API
  // stores null). Never required — this is a convenience, not a gate.
  const [scheduledAt, setScheduledAt] = useState('');
  // 2026-07-12 world-class audit P1 — regulation period length for sports
  // that publish clock.segmentMsOptions (water polo 8:00 NCAA vs 7:00 NFHS
  // HS vs age-group). '' = the sport default; resets when the sport
  // changes. Stored per-game — every clock reset honors it, so a HS
  // operator never hand-sets 7:00 four times a game.
  const [clockSegmentMs, setClockSegmentMs] = useState('');
  // Sports Wave S4-3 (P2) — sport search, only shown once the grid gets
  // big enough to need it (>8 sports). No new setting: purely a filter
  // over the existing SPORTS list.
  const [sportQuery, setSportQuery] = useState('');
  const visibleSports = useMemo(() => {
    const q = sportQuery.trim().toLowerCase();
    if (!q) return SPORTS;
    return SPORTS.filter((s) => s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q));
  }, [sportQuery]);
  // Sprint 13 — operator-picked custom layouts. Each defaults to ''
  // ("Default — built-in layout") which sends null to the API and
  // falls back to the hardcoded /board, /ribbon, /scorebug.
  const [scoreboardTemplateId, setScoreboardTemplateId] = useState(initialPresetTemplate?.surface === 'scoreboard' ? initialPresetTemplate.id : '');
  const [ribbonTemplateId, setRibbonTemplateId] = useState(initialPresetTemplate?.surface === 'ribbon' ? initialPresetTemplate.id : '');
  const [scorebugTemplateId, setScorebugTemplateId] = useState(initialPresetTemplate?.surface === 'scorebug' ? initialPresetTemplate.id : '');
  // Sports Wave S4-3 (P2) — the three layout dropdowns duplicate the
  // in-game Layouts panel, so they're collapsed behind an "Advanced"
  // disclosure by default. Auto-expand when a gallery deep-link ("Use for
  // a game →") preselected one, so the operator can SEE what got picked
  // instead of it silently applying behind a closed panel.
  const [layoutsOpen, setLayoutsOpen] = useState(!!initialPresetTemplate);
  const { data: templates } = useTemplates();
  // 2026-07-01 — operator: "the drop down list of templates to choose
  // from is stupid and includes our touch menu's...we should only show
  // options that really work for the sport and for the screen we are
  // selecting it for." These three dropdowns used to dump the FULL
  // tenant template list (every vertical, touch kiosks included) —
  // filter each to its own sports-surface category (same categories
  // `aspectMatches` already enforces on the in-game Layouts panel at
  // sports/[gameId]/page.tsx). "Show all" is the escape hatch.
  const [showAllLayoutTemplates, setShowAllLayoutTemplates] = useState(false);
  const allTemplates = Array.isArray(templates) ? templates : [];
  const scoreboardTemplateOptions = showAllLayoutTemplates
    ? allTemplates
    : filterRelevantTemplates(allTemplates, { sportsSurface: 'scoreboard', wantsTouch: false });
  const ribbonTemplateOptions = showAllLayoutTemplates
    ? allTemplates
    : filterRelevantTemplates(allTemplates, { sportsSurface: 'ribbon', wantsTouch: false });
  const scorebugTemplateOptions = showAllLayoutTemplates
    ? allTemplates
    : filterRelevantTemplates(allTemplates, { sportsSurface: 'scorebug', wantsTouch: false });
  const [err, setErr] = useState('');

  /** Forget the saved home team and reset the home fields to blank. */
  const clearHomeTeam = () => {
    setHomeTeam('');
    setHomeColor(TEAM_COLORS[0]);
    setHomeLogoUrl('');
    setHomeRemembered(false);
    try {
      localStorage.removeItem(HOME_TEAM_KEY(schoolId));
    } catch {
      /* ignore */
    }
  };

  const def = useMemo(() => findSport(sport), [sport]);

  const submit = async () => {
    if (!homeTeam.trim() || !awayTeam.trim()) {
      setErr('Both team names are required.');
      return;
    }
    try {
      const game: any = await createGame.mutateAsync({
        sport,
        homeTeam: homeTeam.trim(),
        awayTeam: awayTeam.trim(),
        homeColor,
        awayColor,
        homeLogoUrl: homeLogoUrl.trim() || undefined,
        awayLogoUrl: awayLogoUrl.trim() || undefined,
        // Empty string → null (use the default hardcoded layout).
        scoreboardTemplateId: scoreboardTemplateId || null,
        ribbonTemplateId: ribbonTemplateId || null,
        scorebugTemplateId: scorebugTemplateId || null,
        // datetime-local gives "2026-08-21T19:00" (no seconds, no zone).
        // Inputs-wave SCHED fix: the API's `new Date(...)` parses a
        // zone-less string in the SERVER's zone (UTC on Railway) — a
        // 7-hour miss once auto-push acts on it. Convert HERE, where the
        // browser knows the operator's zone, and send full ISO instead.
        scheduledAt: datetimeLocalToIso(scheduledAt) ?? undefined,
        // Regulation period length pick (only sent when it differs from
        // the sport default — the server validates against the options).
        clockSegmentMs: clockSegmentMs ? Number(clockSegmentMs) : undefined,
      });
      // Remember this home team so the next New Game pre-fills it.
      try {
        localStorage.setItem(
          HOME_TEAM_KEY(schoolId),
          JSON.stringify({
            name: homeTeam.trim(),
            color: homeColor,
            logoUrl: homeLogoUrl.trim(),
          }),
        );
      } catch {
        /* ignore */
      }
      onClose();
      if (game?.id) router.push(`/${schoolId}/sports/${game.id}`);
    } catch (e) {
      setErr((e as Error).message || 'Could not create the game.');
    }
  };

  return (
    // 2026-05-26 — operator: "the sports picker menu is getting cut off
    // top and not centered when the safari browser is not maximized."
    // Root cause: items-center vertically centered the modal in 100vh,
    // but max-h-[90vh] left only 5vh of breathing room. On a 600px-tall
    // Safari window that's 30px — BEHIND the 73px sticky topbar — so
    // the modal's header poked up under the topbar and looked cut off.
    // Fix: scrollable overlay, items-start, pt-24 to clear the topbar,
    // and drop the max-h cap so the modal grows naturally while the
    // overlay handles overflow.
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50"
      onClick={onClose}
    >
      <div className="min-h-full flex items-start justify-center p-4 pt-24 pb-8">
      <div
        className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-900">New game</h2>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* sport picker */}
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Sport
          </label>
          {SPORTS.length > 8 && (
            <div className="relative w-40">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-300" />
              <input
                value={sportQuery}
                onChange={(e) => setSportQuery(e.target.value)}
                placeholder="Search sports…"
                className="w-full rounded-lg border border-slate-200 bg-white pl-7 pr-2 py-1 text-[11px] text-slate-600 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
            </div>
          )}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {visibleSports.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setSport(s.key);
                // Period length is sport-specific — never carry a water
                // polo 7:00 pick onto another sport.
                setClockSegmentMs('');
              }}
              className={`flex flex-col items-center gap-1 rounded-xl border-2 py-2.5 transition-colors ${
                sport === s.key
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <span className="text-2xl">{s.emoji}</span>
              <span className="text-[11px] font-medium text-slate-600">{s.name}</span>
            </button>
          ))}
          {visibleSports.length === 0 && (
            <p className="col-span-4 text-center text-xs text-slate-400 py-3">
              No sports match &ldquo;{sportQuery}&rdquo;.
            </p>
          )}
        </div>

        {/* teams */}
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Home team
              </label>
              {homeRemembered && (
                <button
                  type="button"
                  onClick={clearHomeTeam}
                  className="text-[11px] font-semibold text-emerald-600 hover:text-rose-600 cursor-pointer"
                  title="Forget the saved home team and start fresh"
                >
                  ✓ remembered · clear
                </button>
              )}
            </div>
            <Input
              className="mt-1.5"
              value={homeTeam}
              onChange={(e) => {
                setHomeTeam(e.target.value);
                setHomeRemembered(false);
              }}
              placeholder="Home"
              maxLength={80}
            />
            <TeamBrand
              color={homeColor}
              logoUrl={homeLogoUrl}
              onColor={setHomeColor}
              onLogo={setHomeLogoUrl}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Away team
            </label>
            <Input
              className="mt-1.5"
              value={awayTeam}
              onChange={(e) => setAwayTeam(e.target.value)}
              placeholder="Away"
              maxLength={80}
            />
            <TeamBrand
              color={awayColor}
              logoUrl={awayLogoUrl}
              onColor={setAwayColor}
              onLogo={setAwayLogoUrl}
            />
          </div>
        </div>

        {/* 2026-07-12 world-class audit P1 — regulation period length, only
            for sports that publish options (water polo: 8:00 NCAA is the
            default, HS plays 7:00, age-group 5:00-6:00). One pick at game
            creation; every clock reset honors it for the whole game. */}
        {def?.clock?.segmentMsOptions && def.clock.segmentMsOptions.length > 0 && (
          <div className="mt-5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {def.segment.name} length
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {def.clock.segmentMsOptions.map((o) => {
                const selected = clockSegmentMs
                  ? Number(clockSegmentMs) === o.ms
                  : o.ms === def.clock.segmentMs;
                return (
                  <button
                    key={o.ms}
                    type="button"
                    onClick={() => setClockSegmentMs(String(o.ms))}
                    className={`rounded-lg border-2 px-3 py-1.5 text-xs font-semibold transition-colors ${
                      selected
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sports Wave S4-1 (P1-8) — optional kickoff date/time. Never
            required; leaving it blank is exactly today's behavior. */}
        <div className="mt-5">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            When is it? <span className="text-slate-300 normal-case font-normal">(optional)</span>
          </label>
          <div className="mt-1.5 relative w-full sm:w-64">
            <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-300 pointer-events-none" />
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full rounded-lg border border-slate-200 pl-8 pr-2 py-2 text-sm bg-white"
            />
          </div>
        </div>

        {/* Sports Wave S4-3 (P2) — the three layout dropdowns duplicate the
            in-game Setup → Displays panel, so the happy path (sport + teams
            + go) doesn't have to look at them. Collapsed by default;
            auto-expanded when a gallery "Use for a game →" deep link
            preselected one (see initialPresetTemplate / layoutsOpen above)
            so the operator can see what got applied. */}
        <details
          className="group mt-5"
          open={layoutsOpen}
          onToggle={(e) => setLayoutsOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide select-none">
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-180" />
            Advanced: pick layouts now
          </summary>
          <div className="mt-2">
            <p className="text-[11px] text-slate-400">
              Pick a custom template per surface now, or leave on Default and choose later from the
              game&rsquo;s Setup → Displays panel.
            </p>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-medium text-slate-600">Scoreboard</label>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm bg-white"
                  value={scoreboardTemplateId}
                  onChange={(e) => setScoreboardTemplateId(e.target.value)}
                >
                  <option value="">Default — built-in layout</option>
                  {scoreboardTemplateOptions.map((t: any) => (
                    <option key={t.id} value={t.id}>
                      {t.isSystem ? '★ ' : ''}{t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600">Ribbon</label>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm bg-white"
                  value={ribbonTemplateId}
                  onChange={(e) => setRibbonTemplateId(e.target.value)}
                >
                  <option value="">Default — built-in layout</option>
                  {ribbonTemplateOptions.map((t: any) => (
                    <option key={t.id} value={t.id}>
                      {t.isSystem ? '★ ' : ''}{t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600">Scorebug</label>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm bg-white"
                  value={scorebugTemplateId}
                  onChange={(e) => setScorebugTemplateId(e.target.value)}
                >
                  <option value="">Default — built-in layout</option>
                  {scorebugTemplateOptions.map((t: any) => (
                    <option key={t.id} value={t.id}>
                      {t.isSystem ? '★ ' : ''}{t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {!showAllLayoutTemplates && (
              scoreboardTemplateOptions.length < allTemplates.length ||
              ribbonTemplateOptions.length < allTemplates.length ||
              scorebugTemplateOptions.length < allTemplates.length
            ) && (
              <button
                type="button"
                onClick={() => setShowAllLayoutTemplates(true)}
                className="mt-2 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
              >
                Show all templates ({allTemplates.length})
              </button>
            )}
          </div>
        </details>

        {def && (
          <p className="mt-4 text-xs text-slate-400">
            {def.emoji} {def.name}: {def.segment.count} {def.segment.name.toLowerCase()}
            {def.segment.count > 1 ? 's' : ''}
            {def.clock.type !== 'none'
              ? `, ${def.clock.type === 'countdown' ? 'countdown' : 'count-up'} clock`
              : ', no game clock'}
            .
          </p>
        )}

        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={createGame.isPending} className="gap-1.5">
            <Trophy className="h-4 w-4" />
            {createGame.isPending ? 'Creating…' : 'Create & control'}
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="mt-2">
      <span className="text-[11px] text-slate-400">{label}</span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {TEAM_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${label} ${c}`}
            onClick={() => onChange(c)}
            className={`h-6 w-6 rounded-full transition-transform ${
              value === c ? 'ring-2 ring-offset-2 ring-slate-900 scale-110' : ''
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Team branding for the new-game form. Four ways to set a team's
 * logo + color: pull both from the team's website (the branding
 * scraper), pick / upload a logo via the Assets library, or paste a
 * URL / pick a color.
 */
function TeamBrand({
  color,
  logoUrl,
  onColor,
  onLogo,
}: {
  color: string;
  logoUrl: string;
  onColor: (c: string) => void;
  onLogo: (u: string) => void;
}) {
  const scrape = useScrapeBranding();
  const [site, setSite] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [msg, setMsg] = useState('');

  const pull = async () => {
    if (!site.trim() || scrape.isPending) return;
    setMsg('');
    try {
      const p: any = await scrape.mutateAsync(site.trim());
      const logo = (p?.logos || []).find((l: any) => l?.url)?.url;
      const primary = p?.palette?.primary;
      if (logo) onLogo(logo);
      if (primary) onColor(primary);
      setMsg(
        logo || primary
          ? `Pulled${p?.displayName ? ` ${p.displayName}` : ''} — logo + colors applied.`
          : 'No logo or color found on that site.',
      );
    } catch (e: any) {
      setMsg(e?.message || "Couldn't read that site.");
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-1.5">
        <Input
          value={site}
          onChange={(e) => setSite(e.target.value)}
          placeholder="Team website — pull logo + colors"
          maxLength={300}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          disabled={scrape.isPending}
          onClick={pull}
        >
          {scrape.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Globe className="h-4 w-4" />
          )}
          Pull
        </Button>
      </div>
      <div className="flex items-center gap-2">
        {logoUrl.trim() ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={logoUrl}
            src={logoUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded object-contain bg-slate-50 ring-1 ring-slate-200"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded bg-slate-100 flex items-center justify-center">
            <ImageIcon className="h-4 w-4 text-slate-300" />
          </div>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          onClick={() => setPickerOpen(true)}
        >
          <ImageIcon className="h-4 w-4" />
          Logo
        </Button>
        <Input
          value={logoUrl}
          onChange={(e) => onLogo(e.target.value)}
          placeholder="…or paste a logo URL"
          maxLength={2048}
        />
      </div>
      <ColorRow label="Color" value={color} onChange={onColor} />
      {msg && <p className="text-[11px] text-slate-500">{msg}</p>}
      {pickerOpen && (
        <AssetPicker
          kind="image"
          title="Choose team logo"
          onPick={(url) => {
            onLogo(url);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
