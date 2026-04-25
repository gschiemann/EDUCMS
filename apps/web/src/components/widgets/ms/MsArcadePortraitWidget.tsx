"use client";

/**
 * MsArcadePortraitWidget — Middle-school lobby scene (PORTRAIT 2160×3840).
 *
 * APPROVED 2026-04-25 — matches scratch/design/arcade-ms-portrait-v1.html.
 * Portrait sibling to MsArcadeWidget. Reviewed by user, ported via
 * HsStage scale pattern. DO NOT regress to vw/% units. Every pixel
 * size must match the mockup.
 *
 * Scene layout (panels stacked top-to-bottom on a 2160×3840 canvas,
 * 64px edge inset, 20px gaps):
 *   - HUD            → school identity + 3 stat tiles (clock/weather/countdown)
 *   - HERO QUEST     → showpiece card with tag, headline, subtitle, meta chips
 *   - XP BAR         → field-day progress strip
 *   - QUEST LOG      → 6 single-column period rows
 *   - LEADERBOARD    → top 3 scores, top-down ranking
 *   - SIDE QUESTS    → 2-up event tiles
 *   - NEWS BAR       → BOSS BATTLE × scrolling ticker (full-bleed bottom)
 *
 * box-sizing: border-box on every panel that sets explicit width.
 * overflow: hidden on every panel — both rules ported verbatim from
 * the landscape arcade widget for the same alignment + clip reasons.
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsArcadePortraitConfig {
  // HUD — school identity
  'school.name'?: string;
  'school.team'?: string;
  'school.lv'?: string;
  'school.date'?: string;
  // HUD — stats
  'clock.label'?: string;
  'clock.time'?: string;
  'weather.label'?: string;
  'weather.temp'?: string;
  'countdown.label'?: string;
  'countdown.value'?: string;
  // Hero quest
  'greeting.tag'?: string;
  'greeting.headline'?: string;
  'greeting.subtitle'?: string;
  'greeting.m0'?: string;
  'greeting.m1'?: string;
  'greeting.m2'?: string;
  // XP bar
  'xp.label'?: string;
  'xp.sub'?: string;
  'xp.pct'?: string;
  // Quest log (agenda)
  'agenda.title'?: string;
  'agenda.day'?: string;
  'agenda.letter'?: string;
  'agenda.date'?: string;
  'agenda.0.icon'?: string;
  'agenda.0.t'?: string;
  'agenda.0.r'?: string;
  'agenda.0.xp'?: string;
  'agenda.1.icon'?: string;
  'agenda.1.t'?: string;
  'agenda.1.r'?: string;
  'agenda.1.xp'?: string;
  'agenda.2.icon'?: string;
  'agenda.2.t'?: string;
  'agenda.2.r'?: string;
  'agenda.2.xp'?: string;
  'agenda.3.icon'?: string;
  'agenda.3.t'?: string;
  'agenda.3.r'?: string;
  'agenda.3.xp'?: string;
  'agenda.4.icon'?: string;
  'agenda.4.t'?: string;
  'agenda.4.r'?: string;
  'agenda.4.xp'?: string;
  'agenda.5.icon'?: string;
  'agenda.5.t'?: string;
  'agenda.5.r'?: string;
  'agenda.5.xp'?: string;
  // Leaderboard
  'leaderboard.title'?: string;
  'leaderboard.sub'?: string;
  'leaderboard.0.av'?: string;
  'leaderboard.0.name'?: string;
  'leaderboard.0.sub'?: string;
  'leaderboard.0.pts'?: string;
  'leaderboard.1.av'?: string;
  'leaderboard.1.name'?: string;
  'leaderboard.1.sub'?: string;
  'leaderboard.1.pts'?: string;
  'leaderboard.2.av'?: string;
  'leaderboard.2.name'?: string;
  'leaderboard.2.sub'?: string;
  'leaderboard.2.pts'?: string;
  // Loot (side quests)
  'loot.title'?: string;
  'loot.sub'?: string;
  'loot.0.dow'?: string;
  'loot.0.d'?: string;
  'loot.0.t'?: string;
  'loot.0.s'?: string;
  'loot.0.tag'?: string;
  'loot.1.dow'?: string;
  'loot.1.d'?: string;
  'loot.1.t'?: string;
  'loot.1.s'?: string;
  'loot.1.tag'?: string;
  // Newsbar
  'newsbar.tag'?: string;
  'newsbar.message'?: string;
}

const DEFAULTS: Required<MsArcadePortraitConfig> = {
  'school.name': 'WESTRIDGE.MS',
  'school.team': 'HOUSE: OTTERS',
  'school.lv': '7',
  'school.date': 'TUE APR 21',
  'clock.label': 'TIME',
  'clock.time': '07:53',
  'weather.label': 'CLIMATE',
  'weather.temp': '46°',
  'countdown.label': 'NEXT LV',
  'countdown.value': '12d',
  'greeting.tag': '◆ MAIN QUEST · DAY B',
  // Headline contains structural markup (highlighted word + line break)
  // matching the mockup. Rendered via dangerouslySetInnerHTML so the
  // .ms-arc-p-hl span keeps the green highlight + drop shadow.
  'greeting.headline': 'GO <span class="ms-arc-p-hl">FORTH</span>,<br/>OTTERS.',
  'greeting.subtitle':
    "Today's party assembles at 08:05. Bring: pencil (common), journal (uncommon), courage (rare). Mr. Nguyen awaits in room 108 for the poetry workshop.",
  'greeting.m0': '+50 XP attendance',
  'greeting.m1': '+25 XP participation',
  'greeting.m2': 'bonus: bring a friend',
  'xp.label': 'FIELD DAY PROGRESS',
  'xp.sub': '284 / 460 otters signed up · close Fri',
  'xp.pct': '62%',
  'agenda.title': '◆ QUEST LOG — TODAY',
  'agenda.day': 'DAY',
  'agenda.letter': 'B',
  'agenda.date': '6 quests queued',
  'agenda.0.icon': '✓',
  'agenda.0.t': 'P1 · MATH 7',
  'agenda.0.r': 'rm 214 · ms. patel',
  'agenda.0.xp': '+50 XP',
  'agenda.1.icon': 'P2',
  'agenda.1.t': 'ENGLISH — POETRY',
  'agenda.1.r': 'rm 108 · mr. nguyen',
  'agenda.1.xp': '+75 XP',
  'agenda.2.icon': 'P3',
  'agenda.2.t': 'SCIENCE — LAB',
  'agenda.2.r': 'rm 207 · closed-toe shoes',
  'agenda.2.xp': '+100 XP',
  'agenda.3.icon': 'P4',
  'agenda.3.t': 'PE — MILE RUN',
  'agenda.3.r': 'gym a · coach reyes',
  'agenda.3.xp': '+80 XP',
  'agenda.4.icon': 'LU',
  'agenda.4.t': 'LUNCH — A PERIOD',
  'agenda.4.r': 'chicken & rice · 7th grade',
  'agenda.4.xp': '+25 HP',
  'agenda.5.icon': 'P5',
  'agenda.5.t': 'SOCIAL STUDIES',
  'agenda.5.r': 'rm 115 · map quiz',
  'agenda.5.xp': '+90 XP',
  'leaderboard.title': '▲ TOP SCORES',
  'leaderboard.sub': 'weekly · by homeroom',
  'leaderboard.0.av': '7B',
  'leaderboard.0.name': "MS. CHEN'S 7B",
  'leaderboard.0.sub': 'homework streak · attendance',
  'leaderboard.0.pts': '14,820',
  'leaderboard.1.av': 'MR',
  'leaderboard.1.name': 'MAYA R.',
  'leaderboard.1.sub': '7th grade · birthday today',
  'leaderboard.1.pts': '9,940',
  'leaderboard.2.av': 'DK',
  'leaderboard.2.name': 'DANIEL K.',
  'leaderboard.2.sub': 'math olympiad · 3rd place',
  'leaderboard.2.pts': '8,720',
  'loot.title': '✦ SIDE QUESTS',
  'loot.sub': 'this week · loot tier marked',
  'loot.0.dow': 'TUE',
  'loot.0.d': '3:00',
  'loot.0.t': 'Robotics Club',
  'loot.0.s': 'rm 207 · build week',
  'loot.0.tag': 'RARE LOOT',
  'loot.1.dow': 'WED',
  'loot.1.d': '7pm',
  'loot.1.t': 'Spring Band Concert',
  'loot.1.s': 'auditorium · "echoes"',
  'loot.1.tag': 'LEGENDARY',
  'newsbar.tag': '!! BOSS BATTLE',
  'newsbar.message':
    'PICTURE DAY → THU · FULL UNIFORM · PERMISSION SLIPS BY WED · BUS 14 +10 · SUB IN B-12 · SPELLING BEE SIGN-UPS END FRI · 8TH GRADE FIELD TRIP FORMS DUE TMRW · LOST BLUE WATER BOTTLE → FRONT OFFICE · LIBRARY RETURNS DUE THIS WEEK · ',
};

/**
 * Pull a value from the merged config, falling back to DEFAULTS when
 * the caller passed undefined or an empty string. Mirrors the landscape
 * arcade widget's pattern: an empty string in the editor means "blank"
 * but for the demo gallery we want the demo copy.
 */
const pick = <K extends keyof Required<MsArcadePortraitConfig>>(
  cfg: MsArcadePortraitConfig,
  key: K,
): string => {
  const v = cfg[key];
  return (v === undefined || v === '' ? DEFAULTS[key] : v) as string;
};

export function MsArcadePortraitWidget({
  config,
}: {
  config?: MsArcadePortraitConfig;
}) {
  const cfg = config || {};

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: '#0d0d1a',
        backgroundImage:
          'linear-gradient(rgba(255,255,255,.02) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,.02) 2px, transparent 2px)',
        backgroundSize: '60px 60px',
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
        color: '#f1f1ff',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Soft ambient green vignette at the top (matches .stage::before in the mockup) */}
      <div className="ms-arc-p-glow" />

      {/* ─── Top HUD ───────────────────────────────────────────── */}
      <div className="ms-arc-p-hud">
        <div className="ms-arc-p-player" data-widget="school">
          <div className="ms-arc-p-avatar" aria-hidden="true" />
          <div className="ms-arc-p-info">
            <div className="ms-arc-p-name" data-field="school.name">
              {pick(cfg, 'school.name')}
            </div>
            <div className="ms-arc-p-sub">
              <span data-field="school.team">{pick(cfg, 'school.team')}</span>
              {' · LV.'}
              <b data-field="school.lv">{pick(cfg, 'school.lv')}</b>
              {' · '}
              <span data-field="school.date">{pick(cfg, 'school.date')}</span>
            </div>
          </div>
        </div>
        <div className="ms-arc-p-hud-stats">
          <div className="ms-arc-p-stat" data-widget="clock">
            <span className="ms-arc-p-k" data-field="clock.label">
              {pick(cfg, 'clock.label')}
            </span>
            <span className="ms-arc-p-v" data-field="clock.time">
              {pick(cfg, 'clock.time')}
            </span>
          </div>
          <div className="ms-arc-p-stat" data-widget="weather">
            <span className="ms-arc-p-k" data-field="weather.label">
              {pick(cfg, 'weather.label')}
            </span>
            <span className="ms-arc-p-v ms-arc-p-mp" data-field="weather.temp">
              {pick(cfg, 'weather.temp')}
            </span>
          </div>
          <div className="ms-arc-p-stat" data-widget="countdown">
            <span className="ms-arc-p-k" data-field="countdown.label">
              {pick(cfg, 'countdown.label')}
            </span>
            <span className="ms-arc-p-v ms-arc-p-xp" data-field="countdown.value">
              {pick(cfg, 'countdown.value')}
            </span>
          </div>
        </div>
      </div>

      {/* ─── Hero quest card ───────────────────────────────────── */}
      <div className="ms-arc-p-quest" data-widget="greeting">
        <div className="ms-arc-p-quest-tag" data-field="greeting.tag">
          {pick(cfg, 'greeting.tag')}
        </div>
        <h1
          className="ms-arc-p-quest-h1"
          data-field="greeting.headline"
          dangerouslySetInnerHTML={{ __html: pick(cfg, 'greeting.headline') }}
        />
        <p className="ms-arc-p-quest-sub" data-field="greeting.subtitle">
          {pick(cfg, 'greeting.subtitle')}
        </p>
        <div className="ms-arc-p-quest-meta">
          <span data-field="greeting.m0">{pick(cfg, 'greeting.m0')}</span>
          <span data-field="greeting.m1">{pick(cfg, 'greeting.m1')}</span>
          <span data-field="greeting.m2">{pick(cfg, 'greeting.m2')}</span>
        </div>
      </div>

      {/* ─── XP bar ────────────────────────────────────────────── */}
      <div className="ms-arc-p-xpbar" data-widget="xp">
        <div className="ms-arc-p-xp-lbl">
          <span data-field="xp.label">{pick(cfg, 'xp.label')}</span>
          <span data-field="xp.sub">{pick(cfg, 'xp.sub')}</span>
        </div>
        <div className="ms-arc-p-xp-track">
          <div className="ms-arc-p-xp-fill" />
        </div>
        <div className="ms-arc-p-xp-pct" data-field="xp.pct">
          {pick(cfg, 'xp.pct')}
        </div>
      </div>

      {/* ─── Quest log (agenda) ────────────────────────────────── */}
      <div className="ms-arc-p-board" data-widget="agenda">
        <div className="ms-arc-p-board-head">
          <h2 className="ms-arc-p-board-h2" data-field="agenda.title">
            {pick(cfg, 'agenda.title')}
          </h2>
          <div className="ms-arc-p-board-day">
            <span data-field="agenda.day">{pick(cfg, 'agenda.day')}</span>{' '}
            <b data-field="agenda.letter">{pick(cfg, 'agenda.letter')}</b>
            {' · '}
            <span data-field="agenda.date">{pick(cfg, 'agenda.date')}</span>
          </div>
        </div>
        <div className="ms-arc-p-board-list">
          {([0, 1, 2, 3, 4, 5] as const).map((i) => {
            // Per-row metadata mirrors the HTML mockup verbatim
            const meta: {
              className: string;
              iconStyle: React.CSSProperties;
              status: string;
            }[] = [
              { className: 'done', iconStyle: { background: '#5ff28d' }, status: 'done' },
              { className: 'active', iconStyle: { background: '#ffd84d', color: '#000' }, status: 'live' },
              { className: '', iconStyle: { background: '#3de0e8', color: '#000' }, status: 'up next' },
              { className: '', iconStyle: { background: '#ff8a3d' }, status: '10:50' },
              { className: '', iconStyle: { background: '#ff5ca8' }, status: '11:45' },
              { className: '', iconStyle: { background: '#a86bff' }, status: '12:35' },
            ];
            const m = meta[i];
            return (
              <div
                key={i}
                className={`ms-arc-p-q ${m.className}`.trim()}
                data-widget={`agenda.${i}`}
              >
                <span
                  className="ms-arc-p-q-icon"
                  style={m.iconStyle}
                  data-field={`agenda.${i}.icon`}
                >
                  {pick(cfg, `agenda.${i}.icon` as keyof Required<MsArcadePortraitConfig>)}
                </span>
                <span className="ms-arc-p-q-txt">
                  <b data-field={`agenda.${i}.t`}>
                    {pick(cfg, `agenda.${i}.t` as keyof Required<MsArcadePortraitConfig>)}
                  </b>
                  <span data-field={`agenda.${i}.r`}>
                    {pick(cfg, `agenda.${i}.r` as keyof Required<MsArcadePortraitConfig>)}
                  </span>
                </span>
                <span className="ms-arc-p-q-rw">
                  <span data-field={`agenda.${i}.xp`}>
                    {pick(cfg, `agenda.${i}.xp` as keyof Required<MsArcadePortraitConfig>)}
                  </span>
                  {m.status}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Leaderboard (top 3) ───────────────────────────────── */}
      <div className="ms-arc-p-side" data-widget="leaderboard">
        <div className="ms-arc-p-side-header">
          <h2 className="ms-arc-p-side-h2" data-field="leaderboard.title">
            {pick(cfg, 'leaderboard.title')}
          </h2>
          <div className="ms-arc-p-side-sub" data-field="leaderboard.sub">
            {pick(cfg, 'leaderboard.sub')}
          </div>
        </div>
        <div className="ms-arc-p-entries">
          {([0, 1, 2] as const).map((i) => {
            const klass = i === 0 ? 'g1' : i === 1 ? 'g2' : 'g3';
            const rank = i === 0 ? '#1' : i === 1 ? '#2' : '#3';
            const avStyle: React.CSSProperties =
              i === 1 ? { background: '#ffd84d' } : i === 2 ? { background: '#ff5ca8' } : {};
            return (
              <div
                key={i}
                className={`ms-arc-p-entry ms-arc-p-${klass}`}
                data-widget={`leaderboard.${i}`}
              >
                <span className="ms-arc-p-rank">{rank}</span>
                <span
                  className="ms-arc-p-av"
                  style={avStyle}
                  data-field={`leaderboard.${i}.av`}
                >
                  {pick(cfg, `leaderboard.${i}.av` as keyof Required<MsArcadePortraitConfig>)}
                </span>
                <span className="ms-arc-p-entry-name" data-field={`leaderboard.${i}.name`}>
                  {pick(cfg, `leaderboard.${i}.name` as keyof Required<MsArcadePortraitConfig>)}
                  <span data-field={`leaderboard.${i}.sub`}>
                    {pick(cfg, `leaderboard.${i}.sub` as keyof Required<MsArcadePortraitConfig>)}
                  </span>
                </span>
                <span className="ms-arc-p-pts">
                  <span data-field={`leaderboard.${i}.pts`}>
                    {pick(cfg, `leaderboard.${i}.pts` as keyof Required<MsArcadePortraitConfig>)}
                  </span>
                  <span>PTS</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Side quests / events ──────────────────────────────── */}
      <div className="ms-arc-p-events">
        <div className="ms-arc-p-eventsbox" data-widget="loot">
          <div className="ms-arc-p-events-head">
            <h2 className="ms-arc-p-events-h2" data-field="loot.title">
              {pick(cfg, 'loot.title')}
            </h2>
            <div className="ms-arc-p-events-sub" data-field="loot.sub">
              {pick(cfg, 'loot.sub')}
            </div>
          </div>
          <div className="ms-arc-p-events-list">
            {([0, 1] as const).map((i) => (
              <div key={i} className="ms-arc-p-it" data-widget={`loot.${i}`}>
                <div className="ms-arc-p-it-date">
                  <span data-field={`loot.${i}.dow`}>
                    {pick(cfg, `loot.${i}.dow` as keyof Required<MsArcadePortraitConfig>)}
                  </span>
                  <span data-field={`loot.${i}.d`}>
                    {pick(cfg, `loot.${i}.d` as keyof Required<MsArcadePortraitConfig>)}
                  </span>
                </div>
                <div className="ms-arc-p-it-info">
                  <div className="ms-arc-p-it-t" data-field={`loot.${i}.t`}>
                    {pick(cfg, `loot.${i}.t` as keyof Required<MsArcadePortraitConfig>)}
                  </div>
                  <div className="ms-arc-p-it-s" data-field={`loot.${i}.s`}>
                    {pick(cfg, `loot.${i}.s` as keyof Required<MsArcadePortraitConfig>)}
                  </div>
                  <span className="ms-arc-p-it-tag" data-field={`loot.${i}.tag`}>
                    {pick(cfg, `loot.${i}.tag` as keyof Required<MsArcadePortraitConfig>)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Bottom news bar (BOSS BATTLE × scrolling feed) ────── */}
      <div className="ms-arc-p-newsbar" data-widget="newsbar">
        <span className="ms-arc-p-newsbar-tag" data-field="newsbar.tag">
          {pick(cfg, 'newsbar.tag')}
        </span>
        <div className="ms-arc-p-msg-wrap">
          <div className="ms-arc-p-msg">
            <span data-field="newsbar.message">{pick(cfg, 'newsbar.message')}</span>
            <span aria-hidden="true">{pick(cfg, 'newsbar.message')}</span>
          </div>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — every pixel value matches scratch/design/arcade-ms-portrait-v1.html. */
const CSS = `
/* Box-sizing border-box on every panel that sets explicit width — same
   load-bearing rule as the landscape arcade widget. Without this the
   right edge drifts past its intended column. */
.ms-arc-p-hud, .ms-arc-p-quest, .ms-arc-p-xpbar, .ms-arc-p-board,
.ms-arc-p-side, .ms-arc-p-events, .ms-arc-p-eventsbox, .ms-arc-p-newsbar {
  box-sizing: border-box;
}

/* Soft ambient green vignette near the top (matches .stage::before). */
.ms-arc-p-glow {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse 1400px 1100px at 50% 14%, rgba(93,242,141,.12), transparent 60%);
}

/* ─── Top HUD ─────────────────────────────────────────────────
   Portrait: school block on top row, three stat tiles on second row.
   2032px wide column (2160 - 2*64), 360px tall, 24px gap between rows. */
.ms-arc-p-hud {
  position: absolute; top: 56px; left: 64px; right: 64px; height: 360px;
  display: flex; flex-direction: column; gap: 24px; overflow: hidden;
}
.ms-arc-p-player { display: flex; align-items: center; gap: 44px; }
.ms-arc-p-avatar {
  width: 200px; height: 200px; background: #ff8a3d;
  position: relative; image-rendering: pixelated;
  box-shadow:
    inset 0 -20px 0 rgba(0,0,0,.2),
    inset 20px 0 0 rgba(0,0,0,.05);
  border: 6px solid #f1f1ff;
  flex-shrink: 0;
}
.ms-arc-p-avatar::before {
  content: ''; position: absolute; top: 56px; left: 40px;
  width: 34px; height: 34px; background: #f1f1ff;
  box-shadow: 86px 0 0 #f1f1ff;
}
.ms-arc-p-avatar::after {
  content: ''; position: absolute; bottom: 42px; left: 60px;
  width: 80px; height: 28px; background: #f1f1ff;
}
.ms-arc-p-info { min-width: 0; }
.ms-arc-p-name {
  font-family: 'Press Start 2P', monospace; font-size: 92px;
  color: #ffd84d; line-height: 1; letter-spacing: .02em;
}
.ms-arc-p-sub {
  font-family: 'VT323', monospace; font-size: 64px; color: #3de0e8;
  margin-top: 22px; letter-spacing: .06em;
}
.ms-arc-p-sub b { color: #5ff28d; font-weight: normal; }

/* Three equal stat tiles in row 2 — fill the full width minus gaps.
   2032 (panel) - 2*28 (gaps) = 1976 / 3 = ~658px per tile. */
.ms-arc-p-hud-stats {
  display: grid; grid-template-columns: 1fr 1fr 1fr;
  gap: 28px; flex: 1; min-height: 0;
}
.ms-arc-p-stat {
  background: #1a1a2e; border: 6px solid #f1f1ff; padding: 24px 36px;
  box-shadow: 10px 10px 0 #000;
  display: flex; flex-direction: column; justify-content: center; gap: 12px;
  overflow: hidden;
}
.ms-arc-p-stat .ms-arc-p-k {
  font-family: 'Press Start 2P', monospace; font-size: 32px;
  color: #a0a0c0; letter-spacing: .05em; line-height: 1;
}
.ms-arc-p-stat .ms-arc-p-v {
  font-family: 'VT323', monospace; font-size: 110px; line-height: 1;
  color: #f1f1ff; letter-spacing: .04em;
}
.ms-arc-p-stat .ms-arc-p-v.ms-arc-p-hp { color: #5ff28d; }
.ms-arc-p-stat .ms-arc-p-v.ms-arc-p-mp { color: #3de0e8; }
.ms-arc-p-stat .ms-arc-p-v.ms-arc-p-xp { color: #ffd84d; }

/* ─── Hero quest card ─────────────────────────────────────────
   Portrait gets the showpiece: 1100px tall, headline 240px. */
.ms-arc-p-quest {
  position: absolute; top: 436px; left: 64px; right: 64px; height: 1100px;
  background: #1a1a2e; border: 6px solid #f1f1ff;
  box-shadow: 16px 16px 0 #000;
  padding: 70px 88px; overflow: hidden;
}
.ms-arc-p-quest::before {
  content: ''; position: absolute; right: -180px; top: -180px;
  width: 720px; height: 720px;
  background: repeating-conic-gradient(from 0deg, rgba(93,242,141,.14) 0deg 15deg, transparent 15deg 30deg);
  transform: rotate(12deg);
}
.ms-arc-p-quest-tag {
  display: inline-block; background: #ffd84d; color: #000;
  font-family: 'Press Start 2P', monospace; font-size: 48px;
  padding: 20px 36px; letter-spacing: .04em;
  margin-bottom: 44px; box-shadow: 6px 6px 0 #000;
  position: relative;
}
.ms-arc-p-quest-h1 {
  font-family: 'Press Start 2P', monospace; font-size: 240px; line-height: 1.04;
  color: #f1f1ff; margin: 0; letter-spacing: -.01em;
  position: relative;
}
.ms-arc-p-quest-h1 .ms-arc-p-hl {
  color: #5ff28d; text-shadow: 8px 8px 0 #000;
}
.ms-arc-p-quest-sub {
  font-family: 'VT323', monospace; font-size: 80px; line-height: 1.22;
  color: #3de0e8; margin-top: 56px; letter-spacing: .02em;
  position: relative;
}
.ms-arc-p-quest-meta {
  display: flex; gap: 26px; margin-top: 56px; flex-wrap: wrap;
  position: relative;
}
.ms-arc-p-quest-meta span {
  font-family: 'VT323', monospace; font-size: 56px;
  background: #000; color: #ffd84d;
  padding: 14px 32px; border: 3px solid #ffd84d; letter-spacing: .04em;
}

/* ─── XP bar (field-day progress) ────────────────────────────
   3-cell grid: label / track / pct. Track is 110px tall — fat track
   reads better from 8ft away in portrait orientation. */
.ms-arc-p-xpbar {
  position: absolute; top: 1556px; left: 64px; right: 64px; height: 240px;
  background: #1a1a2e; border: 6px solid #f1f1ff; box-shadow: 10px 10px 0 #000;
  padding: 32px 56px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 56px; align-items: center;
  overflow: hidden;
}
.ms-arc-p-xp-lbl {
  font-family: 'Press Start 2P', monospace; font-size: 48px;
  color: #ffd84d; line-height: 1.2; letter-spacing: .04em; white-space: nowrap;
}
.ms-arc-p-xp-lbl span {
  display: block; font-family: 'VT323', monospace; font-size: 56px;
  color: #a0a0c0; margin-top: 14px; letter-spacing: .02em; line-height: 1;
}
.ms-arc-p-xp-track {
  height: 110px; background: #000; border: 5px solid #f1f1ff;
  position: relative; overflow: hidden; image-rendering: pixelated;
}
.ms-arc-p-xp-fill {
  position: absolute; top: 0; left: 0; bottom: 0; width: 62%;
  background: linear-gradient(90deg, #5ff28d 0%, #5ff28d 80%, #3de0e8 100%);
  box-shadow: inset 0 -16px 0 rgba(0,0,0,.25);
}
.ms-arc-p-xp-fill::after {
  content: ''; position: absolute; inset: 12px 8px;
  background: repeating-linear-gradient(90deg, transparent 0 28px, rgba(255,255,255,.15) 28px 32px);
}
.ms-arc-p-xp-pct {
  font-family: 'Press Start 2P', monospace; font-size: 88px;
  color: #5ff28d; letter-spacing: .02em; text-shadow: 5px 5px 0 #000;
}

/* ─── Quest log (6 items, SINGLE vertical column) ─────────────
   2032×880 → 6 rows in a single column, ~120px tall each. Active row
   keeps the blinking ▶ pointer; done row keeps the opacity dim. */
.ms-arc-p-board {
  position: absolute; top: 1816px; left: 64px; right: 64px; height: 880px;
  background: #1a1a2e; border: 6px solid #f1f1ff; box-shadow: 16px 16px 0 #000;
  padding: 32px 56px 28px; overflow: hidden;
}
.ms-arc-p-board-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  margin-bottom: 22px; padding-bottom: 16px; border-bottom: 5px solid #f1f1ff;
}
.ms-arc-p-board-h2 {
  font-family: 'Press Start 2P', monospace; font-size: 60px;
  color: #ff5ca8; margin: 0; letter-spacing: .02em;
}
.ms-arc-p-board-day {
  font-family: 'VT323', monospace; font-size: 48px;
  color: #3de0e8; letter-spacing: .04em;
}
.ms-arc-p-board-day b { color: #ffd84d; }
.ms-arc-p-board-list {
  display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 14px;
}
.ms-arc-p-q {
  display: grid; grid-template-columns: 96px 1fr auto; gap: 32px; align-items: center;
  background: #0f0f20; border: 3px solid #333355; padding: 18px 28px; position: relative;
}
.ms-arc-p-q.active {
  border-color: #5ff28d; box-shadow: inset 0 0 0 3px rgba(93,242,141,.2);
}
.ms-arc-p-q.done { opacity: .55; }
.ms-arc-p-q-icon {
  width: 80px; height: 80px; background: #a86bff;
  display: grid; place-items: center;
  font-family: 'Press Start 2P', monospace; font-size: 28px; color: #fff;
  border: 4px solid #f1f1ff;
}
.ms-arc-p-q-txt {
  font-family: 'VT323', monospace; font-size: 56px; color: #f1f1ff;
  line-height: 1.05; letter-spacing: .02em;
}
.ms-arc-p-q-txt b { font-weight: normal; color: #ffd84d; }
.ms-arc-p-q-txt span {
  display: block; font-family: 'Space Grotesk', system-ui, sans-serif;
  font-weight: 500; font-size: 32px; color: #a0a0c0;
  letter-spacing: 0; margin-top: 6px;
}
.ms-arc-p-q-rw {
  font-family: 'Press Start 2P', monospace; font-size: 36px;
  color: #5ff28d; letter-spacing: .04em; text-align: right;
  white-space: nowrap; line-height: 1.1;
}
.ms-arc-p-q-rw span {
  display: block; color: #a0a0c0; font-size: 22px; margin-top: 8px;
}
.ms-arc-p-q.done .ms-arc-p-q-rw { color: #6a6a88; }
.ms-arc-p-q.active::before {
  content: '▶'; position: absolute; left: -36px; top: 50%; transform: translateY(-50%);
  font-family: 'Press Start 2P', monospace; font-size: 50px; color: #5ff28d;
  animation: msArcPBlink 1s steps(2) infinite;
}
@keyframes msArcPBlink { 50% { opacity: 0; } }

/* ─── Leaderboard (TOP 3) ─────────────────────────────────────
   Portrait reads top-down naturally. Avatar bumped 108→128 because
   the wider panel can support it. */
.ms-arc-p-side {
  position: absolute; top: 2716px; left: 64px; right: 64px; height: 540px;
  background: #1a1a2e; border: 6px solid #f1f1ff; box-shadow: 16px 16px 0 #000;
  padding: 36px 56px;
  display: flex; flex-direction: column; overflow: hidden;
}
.ms-arc-p-side-header {
  display: flex; justify-content: space-between; align-items: flex-end;
  margin-bottom: 18px; padding-bottom: 16px; border-bottom: 5px solid #f1f1ff;
}
.ms-arc-p-side-h2 {
  font-family: 'Press Start 2P', monospace; font-size: 60px;
  color: #ffd84d; margin: 0; letter-spacing: .02em;
}
.ms-arc-p-side-sub {
  font-family: 'VT323', monospace; font-size: 44px;
  color: #a0a0c0; letter-spacing: .04em;
}
.ms-arc-p-entries {
  display: grid; grid-template-rows: 1fr 1fr 1fr; gap: 8px;
  flex: 1; min-height: 0; margin-top: 8px;
}
.ms-arc-p-entry {
  display: grid; grid-template-columns: 200px 128px 1fr auto; gap: 36px; align-items: center;
  padding: 6px 0; border-bottom: 3px dashed #333355;
}
.ms-arc-p-entry:last-child { border-bottom: 0; }
.ms-arc-p-rank {
  font-family: 'Press Start 2P', monospace; font-size: 60px;
  color: #6a6a88; letter-spacing: .02em;
}
.ms-arc-p-g1 .ms-arc-p-rank { color: #ffd84d; }
.ms-arc-p-g2 .ms-arc-p-rank { color: #c0c0c0; }
.ms-arc-p-g3 .ms-arc-p-rank { color: #ff8a3d; }
.ms-arc-p-av {
  width: 128px; height: 128px; background: #3de0e8; border: 5px solid #f1f1ff;
  display: grid; place-items: center;
  font-family: 'Press Start 2P', monospace; font-size: 40px; color: #000;
}
.ms-arc-p-entry-name {
  font-family: 'VT323', monospace; font-size: 64px; color: #f1f1ff;
  line-height: 1.05; letter-spacing: .04em;
}
.ms-arc-p-entry-name span {
  display: block; font-family: 'Space Grotesk', system-ui, sans-serif;
  font-weight: 500; font-size: 34px; color: #a0a0c0;
  letter-spacing: 0; margin-top: 4px;
}
.ms-arc-p-pts {
  font-family: 'Press Start 2P', monospace; font-size: 54px;
  color: #5ff28d; letter-spacing: .02em; white-space: nowrap;
  text-align: right; line-height: 1.1;
}
.ms-arc-p-pts span:last-child {
  color: #a0a0c0; font-size: 28px; display: block; margin-top: 10px; letter-spacing: .1em;
}

/* ─── Side quests / events ────────────────────────────────────
   324px high panel with 2 horizontal items side-by-side. */
.ms-arc-p-events {
  position: absolute; top: 3276px; left: 64px; right: 64px; height: 324px;
  overflow: hidden;
}
.ms-arc-p-eventsbox {
  background: #1a1a2e; border: 6px solid #f1f1ff; box-shadow: 10px 10px 0 #000;
  padding: 28px 36px; height: 100%;
  display: flex; flex-direction: column; overflow: hidden;
}
.ms-arc-p-events-head {
  display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px;
}
.ms-arc-p-events-h2 {
  font-family: 'Press Start 2P', monospace; font-size: 48px;
  color: #ff8a3d; margin: 0; letter-spacing: .02em; line-height: 1.15;
}
.ms-arc-p-events-sub {
  font-family: 'VT323', monospace; font-size: 36px;
  color: #a0a0c0; letter-spacing: .04em;
}
.ms-arc-p-events-list {
  display: grid; gap: 18px; flex: 1; grid-template-columns: 1fr 1fr; min-height: 0;
}
.ms-arc-p-it {
  display: grid; grid-template-columns: 150px 1fr; gap: 24px; align-items: center;
  padding: 14px 18px; background: #0f0f20; border: 3px solid #333355;
  min-width: 0; overflow: hidden;
}
.ms-arc-p-it-date {
  background: #ffd84d; color: #000;
  font-family: 'Press Start 2P', monospace; font-size: 26px;
  padding: 12px 6px; text-align: center; line-height: 1.3; letter-spacing: .04em;
  border: 3px solid #f1f1ff;
}
.ms-arc-p-it-date span {
  display: block; font-family: 'VT323', monospace; font-size: 56px;
  line-height: 1; color: #000; margin-top: 6px;
}
.ms-arc-p-it-info { min-width: 0; overflow: hidden; }
.ms-arc-p-it-info .ms-arc-p-it-t {
  font-family: 'VT323', monospace; font-size: 48px; color: #f1f1ff;
  line-height: 1.05; letter-spacing: .02em;
}
.ms-arc-p-it-info .ms-arc-p-it-s {
  font-family: 'Space Grotesk', system-ui, sans-serif; font-weight: 500;
  font-size: 28px; color: #a0a0c0; margin-top: 6px;
}
.ms-arc-p-it-info .ms-arc-p-it-tag {
  font-family: 'Press Start 2P', monospace; font-size: 22px;
  color: #5ff28d; letter-spacing: .06em; margin-top: 10px; display: inline-block;
}

/* ─── Bottom news bar (BOSS BATTLE × scrolling feed) ──────────
   Slightly taller than landscape (200 vs 150) so the message font
   (76px) reads from the hallway. */
.ms-arc-p-newsbar {
  position: absolute; bottom: 20px; left: 64px; right: 64px; height: 200px;
  background: #ff5ca8; color: #000;
  display: flex; align-items: stretch;
  border: 6px solid #f1f1ff; box-shadow: 12px 12px 0 #000; overflow: hidden;
}
.ms-arc-p-newsbar-tag {
  background: #000; color: #fff;
  font-family: 'Press Start 2P', monospace; font-size: 48px;
  padding: 0 56px; display: flex; align-items: center;
  letter-spacing: .04em; flex-shrink: 0; border-right: 5px solid #f1f1ff;
}
.ms-arc-p-msg-wrap {
  flex: 1; overflow: hidden; display: flex; align-items: center;
  padding-left: 48px;
}
.ms-arc-p-msg {
  font-family: 'VT323', monospace; font-size: 76px; color: #000;
  white-space: nowrap; letter-spacing: .02em;
  animation: msArcPScroll 60s linear infinite;
}
.ms-arc-p-msg span { display: inline-block; padding-right: 96px; }
@keyframes msArcPScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
