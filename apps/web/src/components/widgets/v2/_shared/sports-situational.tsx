'use client';
/**
 * Shared sports situational graphics — the broadcast-style state strip
 * rendered beneath the score on BOTH the scoreboard widget and the
 * standalone venue /board page. ONE source of truth so the template
 * widget and the game-day display can never drift apart.
 *
 * Per sport:
 *   - baseball / softball  → lit base diamond + B/S/O pip clusters
 *   - football             → possession marker + down & distance + ball-on
 *   - basketball           → per-team timeout pips + BONUS badges + possession
 *   - volleyball / pickle  → serve indicator
 *   - everything else      → clean SportDefinition stat chips
 *
 * Surface-agnostic: the caller passes plain colors (accent / ink / dim
 * / hairline) and a height `h` that the situational sizing scales off.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { SportDefinition } from '@cms/api-types';
import { sceneCss } from '../../scene-css';

function px(zoneH: number, f: number): number {
  return Math.max(8, Math.round(zoneH * f));
}
function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const side = (v: unknown): 'home' | 'away' | null => {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'home' || s === 'h') return 'home';
  if (s === 'away' || s === 'a') return 'away';
  return null;
};

export interface SituationalColors {
  accent: string;
  ink: string;
  dim: string;
  hairline: string;
}

// ── Structured-stat readers (SHARED DATA CONTRACTS) ─────────────
//
// These parse the three structured keys the api persists + the console
// writes onto Game.stats. ONE reader per shape so the board, ribbon, and
// scorebug never disagree about how a result/foul/exclusion is decoded
// (the lineScore cumulative-vs-per-segment drift is the failure to avoid).
// Each reader is defensive: anything malformed is dropped, never thrown,
// and an empty/absent key yields an empty array (callers render NOTHING —
// never a fake grid).

/** stats.results — finish / per-apparatus results for LEADERBOARD sports
 *  (track / swim / cross-country / golf) AND gymnastics / cheer per-
 *  apparatus. `mark` is a free display string (times "1:52.31", decimal
 *  scores "9.850", distances "142-06", strokes "72 (+1)"). */
export interface ResultEntry {
  place: number;
  name: string;
  team: 'home' | 'away' | null;
  lane?: number;
  mark: string;
}
export interface ResultEvent {
  event: string;
  order?: number;
  entries: ResultEntry[];
}

export function readResults(stats: Record<string, unknown> | undefined): ResultEvent[] {
  const raw = stats && Array.isArray(stats.results) ? (stats.results as unknown[]) : [];
  return raw
    .map((e): ResultEvent | null => {
      if (!e || typeof e !== 'object') return null;
      const rec = e as Record<string, unknown>;
      const event = String(rec.event ?? '').trim();
      if (!event) return null;
      const entriesRaw = Array.isArray(rec.entries) ? rec.entries : [];
      const entries = entriesRaw
        .map((x): ResultEntry | null => {
          if (!x || typeof x !== 'object') return null;
          const er = x as Record<string, unknown>;
          const name = String(er.name ?? '').trim();
          const mark = String(er.mark ?? '').trim();
          // A finish row with neither a competitor nor a mark is noise.
          if (!name && !mark) return null;
          const out: ResultEntry = {
            place: Math.max(0, Math.round(num(er.place))),
            name,
            team: side(er.team),
            mark,
          };
          const lane = Math.round(num(er.lane));
          if (lane > 0) out.lane = lane;
          return out;
        })
        .filter((x): x is ResultEntry => x !== null)
        // Place ascending; un-placed (0) rows sink to the bottom — matches
        // the contract's "sorted by entry.place for finish events".
        .sort((a, b) => (a.place || 9999) - (b.place || 9999));
      if (entries.length === 0) return null;
      const order = num(rec.order);
      return { event, order: Number.isFinite(order) ? order : undefined, entries };
    })
    .filter((e): e is ResultEvent => e !== null);
}

/** stats.playerFouls — basketball foul-trouble (5 = fouled out HS). */
export interface PlayerFoul {
  team: 'home' | 'away';
  jersey: number;
  name?: string;
  fouls: number;
}
export function readPlayerFouls(stats: Record<string, unknown> | undefined): PlayerFoul[] {
  const raw = stats && Array.isArray(stats.playerFouls) ? (stats.playerFouls as unknown[]) : [];
  return raw
    .map((p): PlayerFoul | null => {
      if (!p || typeof p !== 'object') return null;
      const rec = p as Record<string, unknown>;
      const team = side(rec.team);
      if (!team) return null;
      const name = String(rec.name ?? '').trim();
      const out: PlayerFoul = {
        team,
        jersey: Math.max(0, Math.round(num(rec.jersey))),
        fouls: Math.max(0, Math.round(num(rec.fouls))),
      };
      if (name) out.name = name;
      return out;
    })
    .filter((p): p is PlayerFoul => p !== null);
}

/** stats.playerExclusions — water-polo per-player exclusions (3 = ejected). */
export interface PlayerExclusion {
  team: 'home' | 'away';
  jersey: number;
  name?: string;
  count: number;
}
export function readPlayerExclusions(stats: Record<string, unknown> | undefined): PlayerExclusion[] {
  const raw =
    stats && Array.isArray(stats.playerExclusions) ? (stats.playerExclusions as unknown[]) : [];
  return raw
    .map((p): PlayerExclusion | null => {
      if (!p || typeof p !== 'object') return null;
      const rec = p as Record<string, unknown>;
      const team = side(rec.team);
      if (!team) return null;
      const name = String(rec.name ?? '').trim();
      const out: PlayerExclusion = {
        team,
        jersey: Math.max(0, Math.round(num(rec.jersey))),
        count: Math.max(0, Math.round(num(rec.count))),
      };
      if (name) out.name = name;
      return out;
    })
    .filter((p): p is PlayerExclusion => p !== null);
}

/** Short label for a foul-trouble / exclusion chip: "#23 (4)" or
 *  "#23 RIVERA (4)" when a name is present. Capped so a long name can't
 *  overrun the strip. */
export function playerChip(p: { jersey: number; name?: string }, count: number): string {
  const name = (p.name || '').trim();
  const who = `#${p.jersey}${name ? ' ' + name.toUpperCase().slice(0, 14) : ''}`;
  return `${who} (${count})`;
}

/** A row of N pips, `filled` of them solid — the iconic count display. */
function Pips({ n, filled, color, dim, size }: { n: number; filled: number; color: string; dim: string; size: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: i < filled ? color : 'transparent',
            border: `${Math.max(1, Math.round(size * 0.16))}px solid ${i < filled ? color : dim}`,
            marginLeft: i === 0 ? 0 : Math.round(size * 0.45),
            boxSizing: 'border-box',
            display: 'inline-block',
          }}
        />
      ))}
    </span>
  );
}

/** Baseball base diamond — 2B top, 1B right, 3B left; lit when occupied. */
function BaseDiamond({ on1, on2, on3, accent, dim, h }: { on1: boolean; on2: boolean; on3: boolean; accent: string; dim: string; h: number }) {
  const s = px(h, 0.15);
  const fill = (on: boolean) => (on ? accent : 'none');
  const stroke = (on: boolean) => (on ? accent : dim);
  return (
    <svg width={s * 1.7} height={s} viewBox="0 0 85 50" aria-hidden>
      {/* 3B left */}
      <rect x="11" y="23" width="14" height="14" transform="rotate(45 18 30)" fill={fill(on3)} stroke={stroke(on3)} strokeWidth="2.6" />
      {/* 2B top */}
      <rect x="35.5" y="6" width="14" height="14" transform="rotate(45 42.5 13)" fill={fill(on2)} stroke={stroke(on2)} strokeWidth="2.6" />
      {/* 1B right */}
      <rect x="60" y="23" width="14" height="14" transform="rotate(45 67 30)" fill={fill(on1)} stroke={stroke(on1)} strokeWidth="2.6" />
    </svg>
  );
}

/** A labelled count cluster — "B ●●○". */
function Count({ label, n, filled, accent, dim, h }: { label: string; n: number; filled: number; accent: string; dim: string; h: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <span style={{ fontSize: px(h, 0.055), fontWeight: 900, color: dim, letterSpacing: 1, marginRight: px(h, 0.02) }}>{label}</span>
      <Pips n={n} filled={Math.max(0, Math.min(n, filled))} color={accent} dim={dim} size={px(h, 0.045)} />
    </span>
  );
}

type RowProps = { def: SportDefinition; stats: Record<string, unknown>; h: number } & SituationalColors;

/**
 * Does this sport + state actually have a broadcast situational graphic
 * worth drawing? A compact surface (the scorebug) calls this to decide
 * whether to render the strip's frame at all; `SituationalRow` itself
 * uses it as the empty-guard, so the predicate and the renderer can
 * never disagree about whether there is anything to show.
 */
export function hasSituational(def: SportDefinition, stats: Record<string, unknown>): boolean {
  // Baseball / softball always have a live count worth showing.
  if (def.segment.name === 'Inning') return true;
  // Football — only once a down is set, the ball has a spot, or
  // possession is known.
  if (def.key === 'football') {
    return (
      num(stats.down) > 0 ||
      side(stats.possession) !== null ||
      (stats.ballOn !== undefined && stats.ballOn !== null && stats.ballOn !== '')
    );
  }
  // Basketball — timeout pips are always meaningful.
  if (def.key === 'basketball') return true;
  // Rally sports — the match set/game count is always worth showing, plus
  // the serve indicator when a server is set.
  if (def.key === 'volleyball' || def.key === 'pickleball') return true;
  // Judged meet sports — the apparatus/rotation (gymnastics), division/
  // round (cheer), or current diver/DD (diving) is always worth a
  // broadcast situational line, so the scorebug shows real meet context
  // instead of a generic chip dump.
  if (def.key === 'gymnastics' || def.key === 'competitive_cheer' || def.key === 'diving') return true;
  // Invasion sports — the broadcast-standard tuned line (shots / power
  // play / ground balls / corners) ports from the ribbon so the board
  // strip never falls to a raw chip dump. Only worth a frame once a stat
  // has a value. (audit P2 — cross-surface parity with ribbonSituational)
  if (def.key === 'soccer' || def.key === 'hockey' || def.key === 'lacrosse' || def.key === 'field_hockey') {
    return curatedInvasion(def, stats) !== null;
  }
  // Remaining LEADERBOARD meet sports (golf / cross country / track /
  // swim) — the now-showing meet line, again only when a stat is set.
  if (def.mode === 'LEADERBOARD') {
    return curatedLeaderboard(def, stats) !== null;
  }
  // Water polo — the exclusion ("X of 3") line + shots. Worth a frame
  // once a shot is recorded OR any player has an exclusion on the
  // structured stats.playerExclusions contract.
  if (def.key === 'water_polo') {
    return (
      num(stats.homeShots) > 0 ||
      num(stats.awayShots) > 0 ||
      readPlayerExclusions(stats).some((p) => p.count > 0)
    );
  }
  // Everything else — only if at least one SportDefinition stat has a value.
  return def.stats.some((s) => {
    const raw = stats[s.key];
    return raw !== undefined && raw !== null && raw !== '';
  });
}

/**
 * Curated invasion-sport situational line — the SAME tuned content the
 * ribbon renders (ribbonSituational in app/ribbon/[gameId]/page.tsx) so
 * the in-venue board strip and the ribbon never disagree. Returns an
 * ordered list of plain text chips, or null when nothing is live.
 */
function curatedInvasion(def: SportDefinition, stats: Record<string, unknown>): string[] | null {
  const parts: string[] = [];
  if (def.key === 'soccer') {
    const hs = num(stats.homeShots);
    const as = num(stats.awayShots);
    if (hs || as) parts.push(`SHOTS ${hs}-${as}`);
    const added = num(stats.addedTime);
    if (added > 0) parts.push(`+${added}' ADDED`);
    // Cards only when at least one team has one — a 0-0 card line is noise.
    if (num(stats.homeRedCards) || num(stats.awayRedCards)) {
      parts.push(`RED ${num(stats.homeRedCards)}-${num(stats.awayRedCards)}`);
    } else if (num(stats.homeYellowCards) || num(stats.awayYellowCards)) {
      parts.push(`YC ${num(stats.homeYellowCards)}-${num(stats.awayYellowCards)}`);
    }
  } else if (def.key === 'hockey') {
    const hs = num(stats.homeShots);
    const as = num(stats.awayShots);
    if (hs || as) parts.push(`SHOTS ON GOAL ${hs}-${as}`);
    // A team with active penalties → the other team is on the power play.
    const hp = num(stats.homePenalties);
    const ap = num(stats.awayPenalties);
    if (hp > ap) parts.push('AWAY POWER PLAY');
    else if (ap > hp) parts.push('HOME POWER PLAY');
    else if (hp && ap) parts.push('4-ON-4');
  } else if (def.key === 'lacrosse') {
    const hs = num(stats.homeShots);
    const as = num(stats.awayShots);
    if (hs || as) parts.push(`SHOTS ${hs}-${as}`);
    const hg = num(stats.homeGroundBalls);
    const ag = num(stats.awayGroundBalls);
    if (hg || ag) parts.push(`GB ${hg}-${ag}`);
  } else if (def.key === 'field_hockey') {
    const hs = num(stats.homeShots);
    const as = num(stats.awayShots);
    if (hs || as) parts.push(`SHOTS ${hs}-${as}`);
    const hc = num(stats.homeCorners);
    const ac = num(stats.awayCorners);
    if (hc || ac) parts.push(`CORNERS ${hc}-${ac}`);
  }
  return parts.length ? parts : null;
}

/**
 * Curated meet (LEADERBOARD) situational line for the remaining meet
 * sports the dedicated branches don't already handle — golf, cross
 * country, and timed track & swim. (Diving — judged, no lanes/clock/
 * splits — got its OWN dedicated branch in SituationalRow, 2026-07-01
 * split; it never reaches this fallback.) Mirrors ribbonSituational.
 * Returns ordered text chips, or null when nothing is live.
 */
function curatedLeaderboard(def: SportDefinition, stats: Record<string, unknown>): string[] | null {
  const parts: string[] = [];
  if (def.key === 'golf') {
    const hole = num(stats.currentHole);
    if (hole > 0) parts.push(`HOLE ${hole}`);
    const hPar = String(stats.homePar || '').trim();
    const aPar = String(stats.awayPar || '').trim();
    if (hPar || aPar) parts.push(`HOME ${hPar || 'E'} / AWAY ${aPar || 'E'}`);
  } else if (def.key === 'cross_country') {
    const lead = String(stats.leadRunner || '').trim();
    if (lead) parts.push(`${lead.toUpperCase()} LEADING`);
    const fin = num(stats.finishers);
    if (fin > 0) parts.push(`${fin} FINISHED`);
  } else {
    // Track & field / swimming (+ the deprecated legacy swimming_diving
    // key) — the currently-contested event.
    const ev = String(stats.currentEvent || '').trim();
    if (ev) parts.push(`NOW · ${ev.toUpperCase()}`);
  }
  return parts.length ? parts : null;
}

/** The broadcast situational strip — dispatches on sport. */
export function SituationalRow({ def, stats, h, accent, ink, dim, hairline }: RowProps) {
  if (!hasSituational(def, stats)) return null;
  const gap = px(h, 0.06);
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: px(h, 0.17),
    borderTop: `1px solid ${hairline}`,
    paddingTop: px(h, 0.02),
  };
  // Chromium 83 (NovaStar Taurus LED controllers) has no flex `gap` —
  // space the row's children with an adjacent-sibling margin rule
  // instead. The class is keyed by `h` so two strips at different
  // sizes never collide on the generated rule. (CLAUDE.md rule #10.)
  const rowClass = `venueSitRow-h${h}`;
  const gapCss = <style>{sceneCss(`.${rowClass} > * + * { margin-left: ${gap}px; }`)}</style>;

  let content: ReactNode;
  let wrap = false;

  // ── Baseball / softball — base diamond + B/S/O ──
  if (def.segment.name === 'Inning') {
    content = (
      <>
        <BaseDiamond
          on1={num(stats.on1B) > 0}
          on2={num(stats.on2B) > 0}
          on3={num(stats.on3B) > 0}
          accent={accent}
          dim={dim}
          h={h}
        />
        <Count label="B" n={3} filled={num(stats.balls)} accent={accent} dim={dim} h={h} />
        <Count label="S" n={2} filled={num(stats.strikes)} accent={accent} dim={dim} h={h} />
        <Count label="O" n={2} filled={num(stats.outs)} accent="#dc2626" dim={dim} h={h} />
      </>
    );
  } else if (def.key === 'football') {
    // ── Football — timeouts + down & distance + ball-on + possession ──
    const down = num(stats.down);
    const dist = num(stats.distance);
    const ballOn = stats.ballOn;
    const poss = side(stats.possession);
    // Per-team timeout pips, the broadcast standard — 3 a half.
    const toMax = def.stats.find((s) => s.key === 'homeTimeouts')?.max ?? 3;
    const toPips = (filled: number) => (
      <Pips
        n={toMax}
        filled={Math.max(0, Math.min(toMax, filled))}
        color={accent}
        dim={dim}
        size={px(h, 0.04)}
      />
    );
    content = (
      <>
        {toPips(num(stats.homeTimeouts))}
        {poss && (
          <span style={{ fontSize: px(h, 0.06), fontWeight: 900, color: accent }}>
            🏈 {poss.toUpperCase()} BALL
          </span>
        )}
        {down > 0 && (
          <span style={{ fontSize: px(h, 0.07), fontWeight: 900, color: ink, letterSpacing: 1 }}>
            {ordinal(down)} &amp; {dist === 0 ? 'GOAL' : dist}
          </span>
        )}
        {ballOn !== undefined && ballOn !== null && ballOn !== '' && (
          <span style={{ fontSize: px(h, 0.055), fontWeight: 800, color: dim, letterSpacing: 1 }}>
            BALL ON {String(ballOn)}
          </span>
        )}
        {toPips(num(stats.awayTimeouts))}
      </>
    );
  } else if (def.key === 'basketball') {
    // ── Basketball — per-team timeouts + bonus, possession arrow ──
    const poss = side(stats.possession);
    const bonus = (f: number) => (f >= 10 ? 'DOUBLE BONUS' : f >= 7 ? 'BONUS' : null);
    const TeamSit = ({ to, b, alignR }: { to: number; b: string | null; alignR?: boolean }) => (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          flexDirection: alignR ? 'row-reverse' : 'row',
        }}
      >
        <Pips n={5} filled={to} color={accent} dim={dim} size={px(h, 0.04)} />
        {b && (
          <span
            style={{
              fontSize: px(h, 0.05),
              fontWeight: 900,
              color: '#f59e0b',
              letterSpacing: 1,
              marginLeft: alignR ? undefined : px(h, 0.03),
              marginRight: alignR ? px(h, 0.03) : undefined,
            }}
          >
            {b}
          </span>
        )}
      </span>
    );
    // Foul-trouble surface — players at 4+ personal fouls (one away from
    // fouling out at the HS 5-foul limit). Reads the structured
    // stats.playerFouls contract the console writes; renders nothing
    // when the array is empty so we never show a fake foul line.
    const inTrouble = readPlayerFouls(stats)
      .filter((p) => p.fouls >= 4)
      .sort((a, b) => b.fouls - a.fouls)
      .slice(0, 4);
    content = (
      <>
        <TeamSit to={num(stats.homeTimeouts)} b={bonus(num(stats.homeFouls))} />
        <span style={{ fontSize: px(h, 0.055), fontWeight: 900, color: accent, letterSpacing: 1 }}>
          {poss === 'home' ? '◀ ' : ''}POSS{poss === 'away' ? ' ▶' : ''}
        </span>
        <TeamSit to={num(stats.awayTimeouts)} b={bonus(num(stats.awayFouls))} alignR />
        {inTrouble.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span
              style={{
                fontSize: px(h, 0.045),
                fontWeight: 900,
                letterSpacing: 1,
                color: '#dc2626',
                marginRight: px(h, 0.025),
              }}
            >
              FOUL TROUBLE
            </span>
            {inTrouble.map((p) => (
              <span
                key={`${p.team}-${p.jersey}`}
                style={{
                  fontSize: px(h, 0.05),
                  fontWeight: 900,
                  letterSpacing: 1,
                  // 5 = fouled out (HS); flag in red, 4 in amber.
                  color: p.fouls >= 5 ? '#dc2626' : '#f59e0b',
                  marginRight: px(h, 0.025),
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {playerChip(p, p.fouls)}
              </span>
            ))}
          </span>
        )}
      </>
    );
  } else if (def.key === 'volleyball' || def.key === 'pickleball') {
    // ── Rally sports — match set/game count + serve indicator ──
    // The MATCH story (e.g. SETS 2–1) belongs on every surface, not just
    // the current-set points. Volleyball stores sets won in homeSets/
    // awaySets; pickleball in homeGames/awayGames. Always show the match
    // count; add the serve glyph + serving team when one is set. (The
    // old branch was gated on `serving` being set, which suppressed the
    // set count entirely when no serve was recorded.)
    const wonKey = def.key === 'pickleball' ? 'Games' : 'Sets';
    const homeWon = num(stats[`home${wonKey}`]);
    const awayWon = num(stats[`away${wonKey}`]);
    const serveSide = String(stats.serving || '').trim();
    // Pickleball gets its own glyph (🥒) — def.emoji is sport-aware, so a
    // bogus volleyball ball never shows on a pickleball board.
    const serveGlyph = def.emoji || '🏐';
    content = (
      <>
        <span style={{ fontSize: px(h, 0.055), fontWeight: 900, color: ink, letterSpacing: 2 }}>
          {wonKey.toUpperCase()}{' '}
          <strong style={{ color: accent, fontVariantNumeric: 'tabular-nums' }}>
            {homeWon}&ndash;{awayWon}
          </strong>
        </span>
        {serveSide && (
          <span style={{ fontSize: px(h, 0.06), fontWeight: 900, color: accent, letterSpacing: 1 }}>
            {serveGlyph} SERVING &mdash; {serveSide.toUpperCase()}
          </span>
        )}
      </>
    );
  } else if (def.key === 'gymnastics') {
    // ── Gymnastics — current apparatus + competitor count (judged meet) ──
    // The shared row only receives `stats` (no segment number), so the
    // rotation count lives on the LEADERBOARD board scene; here we surface
    // the apparatus the operator is on + how many gymnasts are competing
    // — both real stat keys (currentApparatus / home|awayAthletes).
    const apparatus = String(stats.currentApparatus || '').trim();
    const homeAth = num(stats.homeAthletes);
    const awayAth = num(stats.awayAthletes);
    content = (
      <>
        <span style={{ fontSize: px(h, 0.06), fontWeight: 900, color: accent, letterSpacing: 2 }}>
          🤸 {apparatus ? apparatus.toUpperCase() : 'WARM-UPS'}
        </span>
        {(homeAth > 0 || awayAth > 0) && (
          <span style={{ fontSize: px(h, 0.05), fontWeight: 800, color: dim, letterSpacing: 2 }}>
            <strong style={{ color: ink, fontVariantNumeric: 'tabular-nums' }}>{homeAth + awayAth}</strong>{' '}
            COMPETING
          </span>
        )}
      </>
    );
  } else if (def.key === 'competitive_cheer') {
    // ── Competitive cheer — division + routine context (judged meet) ──
    // `division` is a real stat key; the round number is the segment and
    // lives on the board scene, not in `stats`. Surface the division and,
    // when set, the home routine name (home|awayRoutine stat keys).
    const division = String(stats.division || '').trim();
    const routine = String(stats.homeRoutine || stats.awayRoutine || '').trim();
    content = (
      <>
        <span style={{ fontSize: px(h, 0.06), fontWeight: 900, color: accent, letterSpacing: 2 }}>
          📣 {division ? division.toUpperCase() : 'COMPETITION'}
        </span>
        {routine && (
          <span style={{ fontSize: px(h, 0.05), fontWeight: 800, color: dim, letterSpacing: 2 }}>
            <strong style={{ color: ink }}>{routine.toUpperCase()}</strong>
          </span>
        )}
      </>
    );
  } else if (def.key === 'diving') {
    // ── Diving — current diver + dive code/DD (judged meet, no lanes/
    //    clock/splits — a fundamentally different data model from
    //    swimming, split out 2026-07-01). ──
    const diver = String(stats.currentDiver || '').trim();
    const code = String(stats.diveCode || '').trim();
    const dd = String(stats.dd || '').trim();
    content = (
      <>
        <span style={{ fontSize: px(h, 0.06), fontWeight: 900, color: accent, letterSpacing: 2 }}>
          🤿 {diver ? diver.toUpperCase() : 'WARM-UPS'}
        </span>
        {code && (
          <span style={{ fontSize: px(h, 0.05), fontWeight: 800, color: dim, letterSpacing: 2 }}>
            <strong style={{ color: ink, fontVariantNumeric: 'tabular-nums' }}>{code.toUpperCase()}</strong>
            {dd ? ` · DD ${dd}` : ''}
          </span>
        )}
      </>
    );
  } else if (
    def.key === 'soccer' ||
    def.key === 'hockey' ||
    def.key === 'lacrosse' ||
    def.key === 'field_hockey'
  ) {
    // ── Invasion sports — the SAME tuned broadcast line the ribbon shows
    //    (shots / power play / ground balls / corners) instead of a raw
    //    chip dump. Ported from ribbonSituational for cross-surface
    //    parity. (audit P2) ──
    const chips = curatedInvasion(def, stats);
    if (!chips) return null;
    content = (
      <>
        {chips.map((c) => (
          <span key={c} style={{ fontSize: px(h, 0.055), fontWeight: 900, color: ink, letterSpacing: 1 }}>
            {c}
          </span>
        ))}
      </>
    );
  } else if (def.mode === 'LEADERBOARD') {
    // ── Remaining meet sports (golf / cross country / track / swim) —
    //    the now-showing meet line, ported from the ribbon. Gymnastics +
    //    cheer are handled by their own branches above. (audit P2) ──
    const chips = curatedLeaderboard(def, stats);
    if (!chips) return null;
    content = (
      <>
        {chips.map((c) => (
          <span key={c} style={{ fontSize: px(h, 0.055), fontWeight: 900, color: accent, letterSpacing: 1 }}>
            {c}
          </span>
        ))}
      </>
    );
  } else if (def.key === 'water_polo') {
    // ── Water polo — per-player exclusion ("X of 3") surface. A player
    //    is ejected for the game at the 3rd major foul, so the broadcast
    //    standard is to show each excluded player's running count. Reads
    //    the structured stats.playerExclusions contract; renders the shot
    //    chips + any exclusions, and falls through to NOTHING when neither
    //    is set (no fake line). ──
    const wpShots: ReactNode[] = [];
    const hs = num(stats.homeShots);
    const as = num(stats.awayShots);
    if (hs || as) {
      wpShots.push(
        <span key="wpshots" style={{ fontSize: px(h, 0.055), fontWeight: 900, color: ink, letterSpacing: 1 }}>
          SHOTS {hs}-{as}
        </span>,
      );
    }
    const excluded = readPlayerExclusions(stats)
      .filter((p) => p.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
    if (wpShots.length === 0 && excluded.length === 0) return null;
    content = (
      <>
        {wpShots}
        {excluded.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span
              style={{
                fontSize: px(h, 0.045),
                fontWeight: 900,
                letterSpacing: 1,
                color: '#dc2626',
                marginRight: px(h, 0.025),
              }}
            >
              EXCLUSIONS
            </span>
            {excluded.map((p) => (
              <span
                key={`${p.team}-${p.jersey}`}
                style={{
                  fontSize: px(h, 0.05),
                  fontWeight: 900,
                  letterSpacing: 1,
                  // 3 = ejected; flag in red, fewer in amber.
                  color: p.count >= 3 ? '#dc2626' : '#f59e0b',
                  marginRight: px(h, 0.025),
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {`#${p.jersey}${p.name ? ' ' + p.name.toUpperCase().slice(0, 14) : ''} ${p.count} OF 3`}
              </span>
            ))}
          </span>
        )}
      </>
    );
  } else {
    // ── Everything else — clean stat chips ──
    const chips = def.stats
      .map((s) => {
        const raw = stats[s.key];
        if (raw === undefined || raw === null || raw === '') return null;
        return { label: s.label.toUpperCase(), value: String(raw) };
      })
      .filter((x): x is { label: string; value: string } => x !== null)
      .slice(0, 6);
    if (chips.length === 0) return null;
    wrap = true;
    content = (
      <>
        {chips.map((s) => (
          <span key={s.label} style={{ fontSize: px(h, 0.055), fontWeight: 700, color: dim }}>
            {s.label}{' '}
            <strong style={{ color: ink, fontVariantNumeric: 'tabular-nums' }}>{s.value}</strong>
          </span>
        ))}
      </>
    );
  }

  return (
    <>
      {gapCss}
      <div className={rowClass} style={wrap ? { ...rowStyle, flexWrap: 'wrap' } : rowStyle}>
        {content}
      </div>
    </>
  );
}
