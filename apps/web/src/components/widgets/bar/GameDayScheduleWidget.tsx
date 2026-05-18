'use client';

/**
 * GameDayScheduleWidget — today's sports schedule for a sports bar.
 *
 * Reads a list of `games` and renders them in a card-stack layout
 * with league chip, away @ home matchup, kickoff time, channel, and
 * a status indicator (UPCOMING / LIVE / FINAL). When a game is "LIVE"
 * the row glows red.
 *
 * Times are passed as loose strings ("7:30 PM" / "19:30" / "7:30pm")
 * and normalized through formatTime12 so a 24-hour input still
 * renders 12-hour. Status detection compares against client-local
 * time and assumes a 3-hour game window.
 *
 * Widget type: BAR_GAME_DAY_SCHEDULE
 */

import { useEffect, useState } from 'react';
import { parseTimeToMinutes, formatTime12 } from '@/lib/format-time';

export interface BarGame {
  /** League shorthand. NFL / NBA / MLB / NHL / NCAAF / NCAAB / MLS / etc. */
  league?: string;
  /** Away team — full name or abbreviation. */
  away: string;
  /** Home team — full name or abbreviation. */
  home: string;
  /** Loose time string. */
  time: string;
  /** Channel hint. ESPN / FOX / NBC Sports / TNT / DirecTV 712 / etc. */
  channel?: string;
  /** Optional manual status override — defaults to time-based detection. */
  status?: 'UPCOMING' | 'LIVE' | 'FINAL';
  /** Optional team color emoji or short label. */
  emoji?: string;
}

export interface GameDayScheduleConfig {
  games?: BarGame[];
  /** Headline. Default "GAME DAY". */
  title?: string;
  /** Sub label. Default "TODAY'S MATCHUPS". */
  subtitle?: string;
  /** Accent color (LIVE chip / hover ring). Default red #ef4444. */
  accentColor?: string;
  /** Cap rows shown. Default 6. */
  maxRows?: number;
}

const DEMO_GAMES: BarGame[] = [
  { league: 'NFL',    away: 'Cowboys',     home: 'Eagles',      time: '1:00 PM',  channel: 'FOX',     emoji: '🏈' },
  { league: 'NFL',    away: 'Chiefs',      home: 'Bills',       time: '4:25 PM',  channel: 'CBS',     emoji: '🏈' },
  { league: 'NBA',    away: 'Lakers',      home: 'Celtics',     time: '7:30 PM',  channel: 'TNT',     emoji: '🏀' },
  { league: 'NHL',    away: 'Rangers',     home: 'Bruins',      time: '8:00 PM',  channel: 'ESPN+',   emoji: '🏒' },
  { league: 'MLB',    away: 'Yankees',     home: 'Red Sox',     time: '7:10 PM',  channel: 'YES',     emoji: '⚾' },
  { league: 'NCAAF',  away: 'Alabama',     home: 'Auburn',      time: '3:30 PM',  channel: 'CBS',     emoji: '🏈' },
];

function nowMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function detectStatus(timeStr: string): 'UPCOMING' | 'LIVE' | 'FINAL' {
  const start = parseTimeToMinutes(timeStr);
  if (start == null) return 'UPCOMING';
  const n = nowMin();
  // Game window heuristic: 3 hours after kickoff
  if (n < start) return 'UPCOMING';
  if (n < start + 180) return 'LIVE';
  return 'FINAL';
}

export function GameDayScheduleWidget({
  config,
  live: _live,
}: {
  config?: GameDayScheduleConfig;
  live?: boolean;
}) {
  const c: GameDayScheduleConfig = config || {};
  const accent = c.accentColor || '#ef4444';
  const title = c.title || 'GAME DAY';
  const subtitle = c.subtitle || "TODAY'S MATCHUPS";
  const maxRows = c.maxRows ?? 6;

  const games = (c.games && c.games.length > 0) ? c.games : DEMO_GAMES;

  // Re-render every 30s so the live/final status updates throughout the day
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const visible = games.slice(0, maxRows);

  return (
    <div
      className="bgds-root"
      style={{ '--bgds-accent': accent } as React.CSSProperties}
    >
      <style>{CSS}</style>

      <div className="bgds-bg" />
      <div className="bgds-glow" />
      <div className="bgds-grain" aria-hidden />

      {/* Header */}
      <div className="bgds-header">
        <div className="bgds-title-block">
          <span className="bgds-title-icon" aria-hidden>🏈</span>
          <span className="bgds-title">{title}</span>
        </div>
        <span className="bgds-subtitle">{subtitle}</span>
      </div>

      {/* Game list */}
      <div className="bgds-list" role="list">
        {visible.map((g, i) => {
          const status = g.status || detectStatus(g.time);
          return (
            <div
              key={i}
              className={'bgds-row bgds-row--' + status.toLowerCase()}
              role="listitem"
            >
              {/* League chip */}
              <div className="bgds-league">
                <div className="bgds-league-emoji" aria-hidden>{g.emoji || '🏟️'}</div>
                {g.league && <div className="bgds-league-text">{g.league}</div>}
              </div>

              {/* Matchup */}
              <div className="bgds-matchup">
                <div className="bgds-team bgds-team--away">{g.away}</div>
                <div className="bgds-at">@</div>
                <div className="bgds-team bgds-team--home">{g.home}</div>
              </div>

              {/* Status / time / channel */}
              <div className="bgds-meta">
                <div className="bgds-time">
                  {status === 'LIVE' && (
                    <span className="bgds-live-chip">
                      <span className="bgds-live-dot" aria-hidden /> LIVE
                    </span>
                  )}
                  {status === 'FINAL' && <span className="bgds-final-chip">FINAL</span>}
                  {status === 'UPCOMING' && (
                    <span className="bgds-time-text">{formatTime12(g.time) || g.time}</span>
                  )}
                </div>
                {g.channel && (
                  <div className="bgds-channel">{g.channel}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {games.length > maxRows && (
        <div className="bgds-more">+{games.length - maxRows} more on tap</div>
      )}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');

.bgds-root {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  overflow: hidden;
  color: #f8fafc;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
}

.bgds-bg {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 0;
  background:
    radial-gradient(800px 500px at 80% 20%, rgba(239,68,68,0.10), transparent 60%),
    radial-gradient(700px 400px at 20% 80%, rgba(34,211,238,0.07), transparent 60%),
    linear-gradient(160deg, #0a0a0a 0%, #0c0a14 50%, #0a0a0a 100%);
}
.bgds-glow {
  position: absolute; top: -10%; right: -10%; bottom: -10%; left: -10%; z-index: 1;
  pointer-events: none;
  background: radial-gradient(900px 500px at 50% 0%, var(--bgds-accent, #ef4444), transparent 65%);
  opacity: 0.07;
  filter: blur(80px);
}
.bgds-grain {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 2;
  pointer-events: none;
  opacity: 0.04;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/></svg>");
  mix-blend-mode: overlay;
}

.bgds-header {
  position: relative; z-index: 10;
  display: flex; align-items: baseline; justify-content: space-between;
  padding: clamp(10px, 2.5cqh, 22px) clamp(14px, 3cqw, 28px) clamp(8px, 2cqh, 14px);
  border-bottom: 2px solid rgba(239, 68, 68, 0.4);
}
.bgds-title-block {
  display: flex; align-items: center; gap: clamp(6px, 1.2cqw, 14px);
}
.bgds-title-icon {
  font-size: clamp(18px, 4cqh, 38px);
  filter: drop-shadow(0 0 12px var(--bgds-accent, #ef4444));
}
.bgds-title {
  font-family: 'Bebas Neue', 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(20px, 5cqh, 50px);
  letter-spacing: 0.18em;
  color: var(--bgds-accent, #ef4444);
  text-shadow: 0 0 22px var(--bgds-accent, #ef4444);
  line-height: 1;
  text-transform: uppercase;
}
.bgds-subtitle {
  font-family: 'Outfit', sans-serif;
  font-size: clamp(9px, 1.4cqh, 13px);
  font-weight: 600;
  letter-spacing: 0.32em;
  color: #94a3b8;
  text-transform: uppercase;
}

.bgds-list {
  position: relative; z-index: 10;
  display: flex; flex-direction: column;
  padding: clamp(6px, 1.2cqh, 12px) clamp(10px, 2cqw, 20px);
  gap: clamp(4px, 0.8cqh, 8px);
}

.bgds-row {
  display: grid;
  grid-template-columns: clamp(50px, 10cqw, 80px) 1fr auto;
  align-items: center;
  gap: clamp(6px, 1.2cqw, 14px);
  padding: clamp(7px, 1.4cqh, 13px) clamp(8px, 1.5cqw, 14px);
  border-radius: 8px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  transition: background 250ms ease, border-color 250ms ease;
}
.bgds-row--live {
  background: rgba(239, 68, 68, 0.10);
  border-color: rgba(239, 68, 68, 0.4);
  box-shadow: 0 0 22px rgba(239, 68, 68, 0.15);
  animation: bgds-row-pulse 2.4s ease-in-out infinite;
}
@keyframes bgds-row-pulse {
  0%, 100% { box-shadow: 0 0 18px rgba(239, 68, 68, 0.12); }
  50%      { box-shadow: 0 0 32px rgba(239, 68, 68, 0.22); }
}
.bgds-row--final {
  opacity: 0.55;
}

.bgds-league {
  display: flex; flex-direction: column; align-items: center;
  gap: clamp(2px, 0.4cqh, 4px);
}
.bgds-league-emoji {
  font-size: clamp(20px, 3.5cqh, 32px);
  line-height: 1;
}
.bgds-league-text {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(8px, 1.2cqh, 11px);
  color: #fbbf24;
  letter-spacing: 0.18em;
}

.bgds-matchup {
  display: flex; align-items: center; gap: clamp(5px, 1cqw, 12px);
  min-width: 0;
}
.bgds-team {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(13px, 2.4cqh, 24px);
  color: #f8fafc;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bgds-at {
  font-family: 'Outfit', sans-serif;
  font-weight: 500;
  font-size: clamp(10px, 1.7cqh, 16px);
  color: #64748b;
  letter-spacing: 0.06em;
}

.bgds-meta {
  display: flex; flex-direction: column; align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
}
.bgds-time {
  display: flex; align-items: center;
}
.bgds-time-text {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: clamp(11px, 1.9cqh, 17px);
  color: #cbd5e1;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.bgds-live-chip {
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--bgds-accent, #ef4444);
  color: #ffffff;
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(9px, 1.4cqh, 12px);
  letter-spacing: 0.2em;
  padding: 3px clamp(5px, 0.8cqw, 8px);
  border-radius: 3px;
  box-shadow: 0 0 14px var(--bgds-accent, #ef4444);
  animation: bgds-live-pulse 1.6s ease-in-out infinite;
}
@keyframes bgds-live-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.85; }
}
.bgds-live-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: #ffffff;
  animation: bgds-dot-blink 1s steps(2) infinite;
}
@keyframes bgds-dot-blink {
  0%, 49%   { opacity: 1; }
  50%, 100% { opacity: 0.4; }
}
.bgds-final-chip {
  background: rgba(255,255,255,0.06);
  color: #64748b;
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(9px, 1.3cqh, 11px);
  letter-spacing: 0.2em;
  padding: 3px clamp(5px, 0.8cqw, 8px);
  border-radius: 3px;
  border: 1px solid rgba(255,255,255,0.1);
}
.bgds-channel {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(9px, 1.3cqh, 11px);
  color: #94a3b8;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.bgds-more {
  position: relative; z-index: 10;
  padding: clamp(6px, 1cqh, 9px) clamp(14px, 3cqw, 26px);
  font-family: 'Inter', sans-serif;
  font-size: clamp(9px, 1.3cqh, 11px);
  color: #475569;
  letter-spacing: 0.1em;
  border-top: 1px solid rgba(255,255,255,0.05);
  text-transform: uppercase;
}
`;
