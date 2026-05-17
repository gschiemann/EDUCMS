'use client';

/**
 * VenueOS Sports — Sprint 13. The game list + create flow.
 *
 * The hub of the SPORTS vertical: every game in the tenant, a "New
 * game" creator (sport + teams + colors), and per-game links into the
 * operator control surface and the public scoreboard board page.
 */

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Trophy, Plus, Radio, ExternalLink, Trash2, X, BadgeDollarSign,
  Loader2, ImageIcon, Globe,
} from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGames, useCreateGame, useDeleteGame, useScrapeBranding } from '@/hooks/use-api';
import { appConfirm } from '@/components/ui/app-dialog';
import { SPORTS, findSport } from '@cms/api-types';
import { AssetPicker } from '@/components/assets/AssetPicker';

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
      allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER']}
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
  const schoolId = String(params?.schoolId || '');
  const { data: games, isLoading } = useGames();
  const deleteGame = useDeleteGame();
  const [creating, setCreating] = useState(false);

  const list: any[] = Array.isArray(games) ? games : [];

  const handleDelete = async (id: string, label: string) => {
    const ok = await appConfirm({
      title: 'Delete game?',
      message: `"${label}" and its event log will be permanently removed.`,
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (ok) deleteGame.mutate(id);
  };

  return (
    <div className="max-w-6xl mx-auto px-1 py-2">
      {/* header */}
      <div className="flex items-center justify-between mb-6">
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

      {/* game grid */}
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {list.map((g) => {
            const def = findSport(g.sport);
            return (
              <div
                key={g.id}
                className="rounded-2xl bg-white ring-1 ring-slate-200 p-5 hover:ring-indigo-300 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{def?.emoji || '🏆'}</span>
                    <span className="text-sm font-semibold text-slate-500">
                      {def?.name || g.sport}
                    </span>
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      STATUS_BADGE[g.status] || STATUS_BADGE.SCHEDULED
                    }`}
                  >
                    {g.status === 'PRE_GAME' ? 'PRE-GAME' : g.status}
                  </span>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <div className="flex-1">
                    <div className="text-base font-bold text-slate-900 truncate">{g.homeTeam}</div>
                    <div className="text-xs text-slate-400">Home</div>
                  </div>
                  <div className="px-4 text-3xl font-black text-slate-900 tabular-nums">
                    {g.homeScore} <span className="text-slate-300">–</span> {g.awayScore}
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
                  <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => handleDelete(g.id, `${g.homeTeam} vs ${g.awayTeam}`)}
                      aria-label="Delete game"
                    >
                      <Trash2 className="h-4 w-4 text-slate-400" />
                    </Button>
                  </RoleGate>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && <CreateGameModal onClose={() => setCreating(false)} />}
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

function CreateGameModal({ onClose }: { onClose: () => void }) {
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-900">New game</h2>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* sport picker */}
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Sport
        </label>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {SPORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSport(s.key)}
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
