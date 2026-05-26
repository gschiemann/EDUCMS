'use client';

/**
 * CtsCuePanel — operator phone-friendly remote cue trigger.
 *
 * The orchestrator on the ribbon auto-fires celebrations when the
 * CTS bridge sees a goal-delta / horn / period change. But:
 *
 *   - A horn might come a beat late.
 *   - The score might not auto-update during a controversial review.
 *   - The operator might want to fire a SPECIFIC cinematic (a Hat
 *     Trick for the third goal by the same player) instead of the
 *     deck's next round-robin pick.
 *   - The Stream Deck might not be plugged in tonight.
 *
 * This panel is the manual override. Mobile-first big-button grid
 * the show caller can tap one-handed during play. Each tap fires
 * the exact cinematic on the chosen screen via the admin-auth
 * /api/v1/screens/:id/cts-manual-cue endpoint (same path Stream
 * Deck uses).
 *
 * Lives inside the existing game-day console at /sports/<gameId>
 * → Run-game tab → "CTS Cues" panel, so the operator never leaves
 * their existing workflow.
 */

import { useMemo, useState } from 'react';
import { useScreens } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api-client';
import { CTS_CUE_LABELS } from '@/components/widgets/sports/CtsRibbonWidgets';

interface Screen {
  id: string;
  name: string;
  status?: string;
  ribbonTemplateId?: string | null;
}

// Default decks for the quick-trigger buttons. Same shape as the
// orchestrator's defaults so operator expectations match. Tap the
// HOME / AWAY / HORN row → fires the FIRST cue from each deck, with
// a state ref advancing on each tap so successive taps round-robin
// just like the auto-fire path.
const QUICK_DECKS = {
  home: ['CEL_SOCCER_GOAL', 'CEL_HOCKEY_GOAL', 'CEL_LX_GOAL', 'CEL_SC_GOAL_NEON'],
  away: ['CEL_HOCKEY_GOAL', 'CEL_SOCCER_GOAL', 'CEL_HK_GOAL_RETRO', 'CEL_LX_GOAL'],
  horn: ['CEL_FOOTBALL_TOUCHDOWN', 'CEL_BASKETBALL_BUZZER'],
} as const;

export function CtsCuePanel() {
  const screensQ = useScreens();
  const allScreens: Screen[] = useMemo(() => {
    const data = screensQ.data;
    if (!Array.isArray(data)) return [];
    return data as Screen[];
  }, [screensQ.data]);

  // Default: every screen that's currently paired. Operator can drill
  // into a single screen via the picker for venues with many displays.
  const [selectedScreenId, setSelectedScreenId] = useState<string>('');
  const targetScreens: Screen[] = useMemo(() => {
    if (selectedScreenId) {
      const s = allScreens.find((x) => x.id === selectedScreenId);
      return s ? [s] : [];
    }
    return allScreens.filter((s) => s.status !== 'REVOKED' && s.status !== 'PENDING');
  }, [allScreens, selectedScreenId]);

  // Round-robin indices for the quick-trigger rows (per team).
  const [quickIdx, setQuickIdx] = useState<{ home: number; away: number; horn: number }>(
    { home: 0, away: 0, horn: 0 },
  );
  // Per-screen last-fire feedback so the operator sees a tap landed.
  const [lastFire, setLastFire] = useState<Record<string, { cueId: string; team: string; t: number }>>({});
  const [busyScreenIds, setBusyScreenIds] = useState<Set<string>>(new Set());

  const fireOnScreen = async (screenId: string, cueId: string, team: 'home' | 'away' | 'horn') => {
    setBusyScreenIds((prev) => { const n = new Set(prev); n.add(screenId); return n; });
    try {
      await apiFetch(`/screens/${encodeURIComponent(screenId)}/cts-manual-cue`, {
        method: 'POST',
        body: JSON.stringify({ cueId, team }),
      });
      setLastFire((prev) => ({ ...prev, [screenId]: { cueId, team, t: Date.now() } }));
    } catch (e) {
      // Surface the error inline so the operator knows the tap didn't land.
      setLastFire((prev) => ({ ...prev, [screenId]: { cueId: `ERROR: ${(e as Error).message}`, team, t: Date.now() } }));
    } finally {
      setBusyScreenIds((prev) => { const n = new Set(prev); n.delete(screenId); return n; });
    }
  };

  const fireQuick = async (team: 'home' | 'away' | 'horn') => {
    const deck = QUICK_DECKS[team];
    const cueId = deck[quickIdx[team] % deck.length] || deck[0]!;
    setQuickIdx((prev) => ({ ...prev, [team]: (prev[team] + 1) % deck.length }));
    await Promise.all(targetScreens.map((s) => fireOnScreen(s.id, cueId, team)));
  };

  const fireSpecific = async (cueId: string, team: 'home' | 'away' | 'horn') => {
    await Promise.all(targetScreens.map((s) => fireOnScreen(s.id, cueId, team)));
  };

  if (screensQ.isLoading) {
    return <div className="p-4 text-slate-500 text-sm">Loading screens…</div>;
  }
  if (!allScreens.length) {
    return (
      <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm">
        No screens registered yet — pair a screen first, then load the CTS Water Polo Ribbon template on it.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 leading-relaxed">
        <strong className="text-slate-900">Manual cue trigger.</strong> Taps fire INSTANTLY on the selected screen(s).
        Use this when you want a specific celebration NOW (Hat Trick on goal #3, big TD scene at the buzzer, etc.) or
        when the CTS bridge is offline. Every fire is audit-logged.
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">Target screen</label>
        <select
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          value={selectedScreenId}
          onChange={(e) => setSelectedScreenId(e.target.value)}
        >
          <option value="">All ribbons ({allScreens.filter((s) => s.status !== 'REVOKED' && s.status !== 'PENDING').length} screens)</option>
          {allScreens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name || s.id.slice(0, 8)} {s.status ? `· ${s.status}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Quick triggers — three big buttons, round-robin from default decks. */}
      <div>
        <div className="text-xs font-semibold text-slate-700 mb-2">QUICK TRIGGERS (round-robins through the default deck)</div>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => fireQuick('home')}
            disabled={!targetScreens.length}
            className="px-4 py-5 rounded-xl bg-blue-600 text-white font-bold text-base shadow-md active:scale-95 transition-transform disabled:opacity-40"
          >
            🥅 HOME GOAL
          </button>
          <button
            type="button"
            onClick={() => fireQuick('away')}
            disabled={!targetScreens.length}
            className="px-4 py-5 rounded-xl bg-red-600 text-white font-bold text-base shadow-md active:scale-95 transition-transform disabled:opacity-40"
          >
            🥅 AWAY GOAL
          </button>
          <button
            type="button"
            onClick={() => fireQuick('horn')}
            disabled={!targetScreens.length}
            className="px-4 py-5 rounded-xl bg-amber-500 text-white font-bold text-base shadow-md active:scale-95 transition-transform disabled:opacity-40"
          >
            📯 HORN
          </button>
        </div>
      </div>

      {/* Specific cue picker — every cinematic in the library. */}
      <details className="rounded-lg border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          Specific cue picker ({Object.keys(CTS_CUE_LABELS).length} cinematics)
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-1.5">
          {(Object.keys(CTS_CUE_LABELS) as Array<keyof typeof CTS_CUE_LABELS>).map((cueId) => {
            // Infer the natural "team" tag for the cue from its id — soccer
            // goal → home (default), hockey hat trick → home, etc. Operator
            // can override per tap via the row buttons below.
            return (
              <div key={cueId} className="flex items-center gap-2 border-b border-slate-100 pb-1.5 last:border-b-0">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">{CTS_CUE_LABELS[cueId]}</div>
                  <code className="text-[10px] text-slate-500">{cueId}</code>
                </div>
                <button
                  type="button"
                  onClick={() => fireSpecific(cueId, 'home')}
                  disabled={!targetScreens.length}
                  className="px-2.5 py-1 rounded bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-bold disabled:opacity-40"
                  title="Fire as HOME team"
                >
                  H
                </button>
                <button
                  type="button"
                  onClick={() => fireSpecific(cueId, 'away')}
                  disabled={!targetScreens.length}
                  className="px-2.5 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold disabled:opacity-40"
                  title="Fire as AWAY team"
                >
                  A
                </button>
                <button
                  type="button"
                  onClick={() => fireSpecific(cueId, 'horn')}
                  disabled={!targetScreens.length}
                  className="px-2.5 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-700 text-xs font-bold disabled:opacity-40"
                  title="Fire as HORN / period event"
                >
                  ⏱
                </button>
              </div>
            );
          })}
        </div>
      </details>

      {/* Live fire log — last cue per screen so operator sees their taps landed. */}
      {targetScreens.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold text-slate-700 mb-2">TARGETS ({targetScreens.length})</div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {targetScreens.map((s) => {
              const lf = lastFire[s.id];
              const busy = busyScreenIds.has(s.id);
              const isError = lf && lf.cueId.startsWith('ERROR:');
              const fresh = lf && Date.now() - lf.t < 8000;
              return (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <div className="font-medium text-slate-900 truncate flex-1 mr-2">{s.name || s.id.slice(0, 8)}</div>
                  {busy && <span className="text-slate-400">firing…</span>}
                  {!busy && lf && fresh && !isError && (
                    <span className="text-emerald-600 font-mono">✓ {lf.cueId} <span className="text-slate-400">({lf.team})</span></span>
                  )}
                  {!busy && lf && fresh && isError && (
                    <span className="text-red-600 truncate max-w-[60%]" title={lf.cueId}>{lf.cueId}</span>
                  )}
                  {!busy && (!lf || !fresh) && (
                    <span className="text-slate-300">idle</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
