'use client';

/**
 * TriviaScoreboardWidget — live trivia night leaderboard for a bar.
 *
 * The host runs trivia from a tablet; the wall display picks up the
 * `teams` array (sorted automatically), the current `roundNumber`,
 * `totalRounds`, and a per-question countdown. Movement between
 * positions animates softly so the room feels the lead change.
 *
 * No live data feed required — operator pastes scores in the editor
 * (or wires the trivia host's CSV / Google Sheet later). The widget
 * just renders what's in config; the per-question countdown is
 * computed from `questionDeadline` (ISO timestamp) so a refresh
 * doesn't reset the timer.
 *
 * Visual DNA: stadium scoreboard — black + neon green + amber, big
 * numerical type, rank columns with medals for top 3.
 *
 * Widget type: BAR_TRIVIA_SCOREBOARD
 */

import { useEffect, useState } from 'react';

export interface TriviaTeam {
  name: string;
  /** Total points this round. Higher = better. */
  score: number;
  /** Optional emoji avatar / team color glyph. */
  emoji?: string;
  /** Optional delta from last round, used for the small ▲ / ▼ arrow. */
  delta?: number;
}

export interface TriviaScoreboardConfig {
  teams?: TriviaTeam[];
  /** Current round number (1-indexed). Default 1. */
  roundNumber?: number;
  /** Total rounds in the night. Default 6. */
  totalRounds?: number;
  /** Current question number within the round. Default 1. */
  questionNumber?: number;
  /** Total questions in this round. Default 10. */
  totalQuestions?: number;
  /** ISO timestamp for question end. If set, a countdown renders. */
  questionDeadline?: string;
  /** Headline. Default "TRIVIA NIGHT". */
  title?: string;
  /** Subtitle. Default "LIVE LEADERBOARD". */
  subtitle?: string;
  /** Top accent. Default neon green #22c55e. */
  accentColor?: string;
  /** Cap visible rows. Default 5. */
  maxRows?: number;
}

const DEMO_TEAMS: TriviaTeam[] = [
  { name: 'Quizzly Bears',          score: 47, emoji: '🐻', delta: +6 },
  { name: 'Smarty Pints',           score: 42, emoji: '🍻', delta: +4 },
  { name: "Trebek's Sneaks",        score: 38, emoji: '🎤', delta: +2 },
  { name: 'I am Smartacus',         score: 35, emoji: '⚔️', delta: +5 },
  { name: 'You Quiz, You Lose',     score: 31, emoji: '🤓', delta: +1 },
  { name: 'Les Quizerables',        score: 28, emoji: '🎭', delta: +0 },
];

const MEDALS = ['🥇', '🥈', '🥉'];

export function TriviaScoreboardWidget({
  config,
  live: _live,
}: {
  config?: TriviaScoreboardConfig;
  live?: boolean;
}) {
  const c: TriviaScoreboardConfig = config || {};
  const accent = c.accentColor || '#22c55e';
  const title = c.title || 'TRIVIA NIGHT';
  const subtitle = c.subtitle || 'LIVE LEADERBOARD';
  const round = c.roundNumber ?? 1;
  const totalRounds = c.totalRounds ?? 6;
  const question = c.questionNumber ?? 1;
  const totalQuestions = c.totalQuestions ?? 10;
  const maxRows = c.maxRows ?? 5;

  const teams = (c.teams && c.teams.length > 0) ? [...c.teams] : DEMO_TEAMS;
  const sorted = teams.sort((a, b) => b.score - a.score).slice(0, maxRows);

  // Question countdown
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  let secondsLeft: number | null = null;
  if (c.questionDeadline) {
    const deadline = new Date(c.questionDeadline).getTime();
    if (!Number.isNaN(deadline)) {
      secondsLeft = Math.max(0, Math.floor((deadline - now) / 1000));
    }
  }

  return (
    <div
      className="bts-root"
      style={{ '--bts-accent': accent } as React.CSSProperties}
    >
      <style>{CSS}</style>

      <div className="bts-bg" />
      <div className="bts-glow" />
      <div className="bts-grain" aria-hidden />
      <div className="bts-scanlines" aria-hidden />

      {/* Header — title + round / question status row */}
      <div className="bts-header">
        <div className="bts-title-block">
          <span className="bts-title-icon" aria-hidden>🎯</span>
          <span className="bts-title">{title}</span>
        </div>
        <div className="bts-round-block">
          <div className="bts-round-pill">
            ROUND <span className="bts-round-num">{round}</span> / {totalRounds}
          </div>
          <div className="bts-q-pill">
            Q <span className="bts-q-num">{question}</span> / {totalQuestions}
          </div>
          {secondsLeft != null && (
            <div className={'bts-timer-pill' + (secondsLeft <= 10 ? ' bts-timer-pill--urgent' : '')}>
              <span className="bts-timer-num">{String(Math.floor(secondsLeft / 60)).padStart(1, '0')}:{String(secondsLeft % 60).padStart(2, '0')}</span>
            </div>
          )}
        </div>
      </div>

      <div className="bts-subtitle">{subtitle}</div>

      {/* Leaderboard */}
      <div className="bts-board" role="list">
        {sorted.map((t, i) => {
          const rank = i + 1;
          const isTop = rank <= 3;
          return (
            <div
              key={t.name}
              className={'bts-row' + (isTop ? ` bts-row--top bts-row--rank-${rank}` : '')}
              role="listitem"
            >
              <div className="bts-rank">
                {isTop ? (
                  <span className="bts-medal" aria-hidden>{MEDALS[rank - 1]}</span>
                ) : (
                  <span className="bts-rank-num">#{rank}</span>
                )}
              </div>
              <div className="bts-team">
                {t.emoji && <span className="bts-team-emoji" aria-hidden>{t.emoji}</span>}
                <span className="bts-team-name">{t.name}</span>
              </div>
              <div className="bts-delta">
                {typeof t.delta === 'number' && t.delta > 0 && (
                  <span className="bts-delta-up">▲ {t.delta}</span>
                )}
                {typeof t.delta === 'number' && t.delta < 0 && (
                  <span className="bts-delta-down">▼ {Math.abs(t.delta)}</span>
                )}
                {typeof t.delta === 'number' && t.delta === 0 && (
                  <span className="bts-delta-flat">—</span>
                )}
              </div>
              <div className="bts-score">{t.score}</div>
            </div>
          );
        })}
      </div>

      {teams.length > maxRows && (
        <div className="bts-more">+ {teams.length - maxRows} more teams playing</div>
      )}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@500;600;700;800&family=Inter:wght@500;600;700&family=JetBrains+Mono:wght@600;700;800&display=swap');

.bts-root {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  overflow: hidden;
  color: #f8fafc;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
}

.bts-bg {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 0;
  background:
    radial-gradient(900px 500px at 80% 0%, rgba(34, 197, 94, 0.10), transparent 60%),
    radial-gradient(700px 400px at 0% 100%, rgba(245, 158, 11, 0.07), transparent 60%),
    linear-gradient(160deg, #06080a 0%, #0a0c0e 50%, #050709 100%);
}
.bts-glow {
  position: absolute; top: -10%; right: -10%; bottom: -10%; left: -10%; z-index: 1;
  pointer-events: none;
  background: radial-gradient(900px 500px at 50% 0%, var(--bts-accent, #22c55e), transparent 65%);
  opacity: 0.07;
  filter: blur(80px);
}
.bts-grain {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 2;
  pointer-events: none;
  opacity: 0.04;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/></svg>");
  mix-blend-mode: overlay;
}
.bts-scanlines {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 3;
  pointer-events: none;
  opacity: 0.05;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 2px,
    rgba(34, 197, 94, 0.4) 2px,
    rgba(34, 197, 94, 0.4) 3px
  );
  mix-blend-mode: screen;
}

/* Header */
.bts-header {
  position: relative; z-index: 10;
  display: flex; align-items: center; justify-content: space-between;
  padding: clamp(10px, 2.4cqh, 22px) clamp(14px, 3cqw, 26px) clamp(4px, 1cqh, 8px);
  border-bottom: 2px solid rgba(34, 197, 94, 0.4);
}
.bts-title-block {
  display: flex; align-items: center; gap: clamp(6px, 1.2cqw, 14px);
}
.bts-title-icon {
  font-size: clamp(20px, 4.5cqh, 44px);
  filter: drop-shadow(0 0 14px var(--bts-accent, #22c55e));
}
.bts-title {
  font-family: 'Bebas Neue', 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(20px, 5cqh, 50px);
  letter-spacing: 0.18em;
  color: var(--bts-accent, #22c55e);
  text-shadow: 0 0 22px var(--bts-accent, #22c55e);
  line-height: 1;
  text-transform: uppercase;
}
.bts-round-block {
  display: flex; align-items: center; gap: clamp(5px, 1cqw, 10px);
  flex-wrap: wrap; justify-content: flex-end;
}
.bts-round-pill, .bts-q-pill {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(10px, 1.6cqh, 14px);
  letter-spacing: 0.18em;
  color: #fbbf24;
  background: rgba(0,0,0,0.5);
  border: 1px solid rgba(245, 158, 11, 0.4);
  border-radius: 4px;
  padding: clamp(4px, 0.8cqh, 6px) clamp(8px, 1.4cqw, 12px);
}
.bts-round-num, .bts-q-num {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 800;
  color: #fef3c7;
  text-shadow: 0 0 8px #fbbf24;
}
.bts-timer-pill {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: clamp(13px, 2.2cqh, 20px);
  background: rgba(0,0,0,0.7);
  border: 2px solid var(--bts-accent, #22c55e);
  border-radius: 4px;
  padding: clamp(3px, 0.6cqh, 5px) clamp(8px, 1.4cqw, 14px);
  color: var(--bts-accent, #22c55e);
  text-shadow: 0 0 14px var(--bts-accent, #22c55e);
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
}
.bts-timer-pill--urgent {
  border-color: #ef4444;
  color: #ef4444;
  text-shadow: 0 0 14px #ef4444;
  animation: bts-timer-blink 0.5s steps(2) infinite;
}
@keyframes bts-timer-blink {
  0%, 49%   { opacity: 1; }
  50%, 100% { opacity: 0.45; }
}
.bts-timer-num {
  font-variant-numeric: tabular-nums;
}

.bts-subtitle {
  position: relative; z-index: 10;
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  font-size: clamp(9px, 1.4cqh, 12px);
  color: #94a3b8;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  text-align: center;
  padding: clamp(4px, 0.8cqh, 6px) 0 clamp(6px, 1.4cqh, 10px);
}

/* Board */
.bts-board {
  position: relative; z-index: 10;
  display: flex; flex-direction: column; gap: clamp(4px, 0.8cqh, 8px);
  padding: clamp(4px, 1cqh, 10px) clamp(14px, 3cqw, 26px);
}

.bts-row {
  display: grid;
  grid-template-columns: clamp(40px, 7cqw, 60px) 1fr clamp(40px, 7cqw, 70px) clamp(60px, 10cqw, 110px);
  align-items: center;
  gap: clamp(8px, 1.6cqw, 16px);
  padding: clamp(7px, 1.5cqh, 14px) clamp(10px, 1.8cqw, 18px);
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  transition: background 250ms;
}
.bts-row--top {
  background: rgba(34, 197, 94, 0.06);
  border-color: rgba(34, 197, 94, 0.18);
}
.bts-row--rank-1 {
  background: rgba(251, 191, 36, 0.10);
  border: 1px solid rgba(251, 191, 36, 0.5);
  box-shadow: 0 0 18px rgba(251, 191, 36, 0.18);
}

.bts-rank {
  display: flex; align-items: center; justify-content: center;
}
.bts-medal {
  font-size: clamp(20px, 3.6cqh, 36px);
  line-height: 1;
}
.bts-rank-num {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: clamp(13px, 2.2cqh, 22px);
  color: #64748b;
  letter-spacing: 0.04em;
}

.bts-team {
  display: flex; align-items: center; gap: clamp(6px, 1.2cqw, 12px);
  min-width: 0;
}
.bts-team-emoji {
  font-size: clamp(18px, 3cqh, 28px);
  flex-shrink: 0;
  line-height: 1;
}
.bts-team-name {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(14px, 2.6cqh, 26px);
  color: #f8fafc;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bts-row--rank-1 .bts-team-name {
  color: #fef3c7;
  text-shadow: 0 0 12px rgba(251, 191, 36, 0.4);
}

.bts-delta {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: clamp(10px, 1.5cqh, 14px);
  text-align: right;
  letter-spacing: 0.04em;
}
.bts-delta-up {
  color: var(--bts-accent, #22c55e);
}
.bts-delta-down {
  color: #ef4444;
}
.bts-delta-flat {
  color: #475569;
}

.bts-score {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 800;
  font-size: clamp(20px, 4.2cqh, 44px);
  color: var(--bts-accent, #22c55e);
  text-shadow: 0 0 14px var(--bts-accent, #22c55e);
  text-align: right;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  line-height: 1;
}
.bts-row--rank-1 .bts-score {
  color: #fbbf24;
  text-shadow: 0 0 18px #fbbf24;
}

.bts-more {
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
