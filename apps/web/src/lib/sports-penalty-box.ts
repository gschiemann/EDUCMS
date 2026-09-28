/**
 * sports-penalty-box — the penalty box as every surface reads it (K-12 sports
 * launch, K12-F17 follow-up, 2026-09-27).
 *
 * The /board route and the sport widgets each read `stats.penalties` their own
 * way: the board kept only rows with an id and a real side and counted a
 * man-advantage from the rows with time left, while the widgets counted EVERY
 * row (an expired one included, a side-less one as "home") — so a widget
 * board could say POWER PLAY while the board said even strength. Both now
 * read the box through this one module.
 *
 * Each penalty is an anchor `{ id, team, player, ms, at, running }`; its
 * remaining time is projected with THE countdown projection
 * (`projectCountdownMs`, @cms/api-types sports-clock.ts) on the page's server
 * clock, and formatted like the game clock's MM:SS (rounding up — "0:01"
 * holds until the true zero).
 *
 * Pure — no React, no DOM, no clock of its own. Chromium-83 safe.
 */

export interface PenaltyAnchor {
  id: string;
  player: string;
  ms: number;
  at: string;
  running: boolean;
}

/**
 * One team's penalty anchors, in stored order: only rows that belong to that
 * side and carry an id (a row the table can address). Never mutates `stats`.
 */
export function penaltyAnchors(stats: unknown, team: 'home' | 'away'): PenaltyAnchor[] {
  const raw =
    stats && typeof stats === 'object' && Array.isArray((stats as Record<string, unknown>).penalties)
      ? ((stats as Record<string, unknown>).penalties as unknown[])
      : [];
  return raw
    .filter(
      (p): p is Record<string, unknown> =>
        !!p && typeof p === 'object' && (p as Record<string, unknown>).team === team,
    )
    .map((p) => ({
      id: String(p.id || ''),
      player: String(p.player || ''),
      ms: Math.max(0, Number(p.ms) || 0),
      at: String(p.at || ''),
      running: !!p.running,
    }))
    .filter((p) => p.id);
}

/**
 * The man-advantage from the live penalties — the team with FEWER players in
 * the box is on the power play (audit P2). Counts only active penalties
 * (running, or frozen at a stoppage, but not expired); the differential gives
 * 5-on-4 / 5-on-3 strength. Null at even strength.
 */
export function powerPlay(stats: unknown): { team: 'home' | 'away'; diff: number } | null {
  const raw =
    stats && typeof stats === 'object' && Array.isArray((stats as Record<string, unknown>).penalties)
      ? ((stats as Record<string, unknown>).penalties as unknown[])
      : [];
  let home = 0;
  let away = 0;
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const rec = p as Record<string, unknown>;
    // A penalty still counts toward the box until its remaining ms hits 0.
    if ((Number(rec.ms) || 0) <= 0) continue;
    if (rec.team === 'home') home += 1;
    else if (rec.team === 'away') away += 1;
  }
  if (home === away) return null;
  // FEWER boxed players ⇒ that team is up a skater (on the power play).
  return home < away ? { team: 'home', diff: away - home } : { team: 'away', diff: home - away };
}
