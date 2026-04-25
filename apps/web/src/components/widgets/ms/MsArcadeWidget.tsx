"use client";

/**
 * MsArcadeWidget — Middle-school lobby scene, 3840×2160 (Arcade theme).
 *
 * APPROVED 2026-04-24 — matches scratch/design/arcade-ms-v2.html
 * Ported via HsStage transform:scale pattern. Every pixel size is
 * FIXED (matches the HTML mockup); DO NOT regress to vw/%.
 *
 * Scene layout (panels arranged on a 3840×2160 stage):
 *   - HUD            → school avatar + name/team/lv/date + clock/weather/countdown
 *   - greeting       → main quest hero card
 *   - xp             → field-day progress bar (fill width driven by xpPctNumber)
 *   - leaderboard    → top 3 scores (#1/#2/#3)
 *   - agenda         → quest log, 6 periods (2×3 grid)
 *   - loot           → side quests (2 items)
 *   - newsbar        → unified BOSS BATTLE × scrolling news feed (bottom)
 *
 * Box-sizing border-box on .quest/.xpbar/.side/.board/.eventsbox is
 * load-bearing — without it the right column misaligns by ~88px.
 * overflow:hidden on .board and .eventsbox keeps content from spilling
 * into the newsbar below. Keep both. See HTML mockup comments for
 * the v2.x geometry history.
 */

import { useEffect } from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsArcadeConfig {
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
  // Loot (side quests)
  'loot.title'?: string;
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

const DEFAULTS: Required<MsArcadeConfig> = {
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
  'greeting.headline': 'GO FORTH, OTTERS.',
  'greeting.subtitle': "Today's party assembles at 08:05. Bring: pencil (common), journal (uncommon), courage (rare). Mr. Nguyen awaits in room 108 for the poetry workshop.",
  'greeting.m0': '+50 XP attendance',
  'greeting.m1': '+25 XP participation',
  'greeting.m2': 'bonus: bring a friend',
  'xp.label': 'FIELD DAY PROGRESS',
  'xp.sub': '284 / 460 otters signed up · close Fri',
  'xp.pct': '62%',
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
  'loot.title': '✦ SIDE QUESTS',
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
  'newsbar.message': 'PICTURE DAY → THU · FULL UNIFORM · PERMISSION SLIPS BY WED · BUS 14 +10 · SUB IN B-12 · SPELLING BEE SIGN-UPS END FRI · 8TH GRADE FIELD TRIP FORMS DUE TMRW · LOST BLUE WATER BOTTLE → FRONT OFFICE · LIBRARY RETURNS DUE THIS WEEK · ',
};

/**
 * Pick a value from the merged config, falling back to DEFAULTS if the
 * caller passed an empty string. Mirrors the varsity widget's pattern
 * of "empty string → use default" — empty strings in the editor mean
 * "blank" but in the demo we want the demo copy.
 */
function pick<K extends keyof Required<MsArcadeConfig>>(
  cfg: Required<MsArcadeConfig>,
  key: K,
): Required<MsArcadeConfig>[K] {
  const v = cfg[key];
  return (v === undefined || v === '' ? DEFAULTS[key] : v) as Required<MsArcadeConfig>[K];
}

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&family=Space+Grotesk:wght@400;500;600;700&display=swap';

/**
 * Inject the Google Fonts <link> tag once. Multiple instances of the
 * widget on a page share a single link — the id check keeps it from
 * stacking up.
 */
function useArcadeFonts() {
  useEffect(() => {
    const id = 'ms-arcade-fonts';
    if (typeof document === 'undefined') return;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = FONTS_HREF;
    document.head.appendChild(link);
  }, []);
}

export function MsArcadeWidget({
  config,
  xpPctNumber = 62,
}: {
  config?: MsArcadeConfig;
  /** Numeric XP fill width (0–100). The display string `xp.pct` stays separate. */
  xpPctNumber?: number;
}) {
  useArcadeFonts();
  const cfg = { ...DEFAULTS, ...(config || {}) } as Required<MsArcadeConfig>;
  const fillPct = Math.max(0, Math.min(100, xpPctNumber));

  return (
    <HsStage
      stageStyle={{
        background: '#0d0d1a',
        backgroundImage:
          'linear-gradient(rgba(255,255,255,.02) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,.02) 2px, transparent 2px)',
        backgroundSize: '60px 60px',
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
        color: '#f1f1ff',
      }}
    >
      <style>{CSS}</style>

      {/* Soft ambient green vignette at the top (matches .stage::before in the mockup) */}
      <div className="ms-arc-glow" />

      {/* Top HUD */}
      <div className="ms-arc-hud">
        <div className="ms-arc-player" data-widget="school">
          <div className="ms-arc-avatar" aria-hidden="true" />
          <div className="ms-arc-info">
            <div className="ms-arc-name" data-field="school.name">{pick(cfg, 'school.name')}</div>
            <div className="ms-arc-sub">
              <span data-field="school.team">{pick(cfg, 'school.team')}</span>
              {' · LV.'}
              <b data-field="school.lv">{pick(cfg, 'school.lv')}</b>
              {' · '}
              <span data-field="school.date">{pick(cfg, 'school.date')}</span>
            </div>
          </div>
        </div>
        <div className="ms-arc-hud-stats">
          <div className="ms-arc-stat" data-widget="clock">
            <span className="ms-arc-k" data-field="clock.label">{pick(cfg, 'clock.label')}</span>
            <span className="ms-arc-v" data-field="clock.time">{pick(cfg, 'clock.time')}</span>
          </div>
          <div className="ms-arc-stat" data-widget="weather">
            <span className="ms-arc-k" data-field="weather.label">{pick(cfg, 'weather.label')}</span>
            <span className="ms-arc-v ms-arc-mp" data-field="weather.temp">{pick(cfg, 'weather.temp')}</span>
          </div>
          <div className="ms-arc-stat" data-widget="countdown">
            <span className="ms-arc-k" data-field="countdown.label">{pick(cfg, 'countdown.label')}</span>
            <span className="ms-arc-v ms-arc-xp" data-field="countdown.value">{pick(cfg, 'countdown.value')}</span>
          </div>
        </div>
      </div>

      {/* Hero quest card */}
      <div className="ms-arc-quest" data-widget="greeting">
        <div className="ms-arc-quest-tag" data-field="greeting.tag">{pick(cfg, 'greeting.tag')}</div>
        <h1 className="ms-arc-quest-h1" data-field="greeting.headline">
          {pick(cfg, 'greeting.headline')}
        </h1>
        <p className="ms-arc-quest-sub" data-field="greeting.subtitle">{pick(cfg, 'greeting.subtitle')}</p>
        <div className="ms-arc-quest-meta">
          <span data-field="greeting.m0">{pick(cfg, 'greeting.m0')}</span>
          <span data-field="greeting.m1">{pick(cfg, 'greeting.m1')}</span>
          <span data-field="greeting.m2">{pick(cfg, 'greeting.m2')}</span>
        </div>
      </div>

      {/* XP bar */}
      <div className="ms-arc-xpbar" data-widget="xp">
        <div className="ms-arc-xp-lbl">
          <span data-field="xp.label">{pick(cfg, 'xp.label')}</span>
          <span data-field="xp.sub">{pick(cfg, 'xp.sub')}</span>
        </div>
        <div className="ms-arc-xp-track">
          <div className="ms-arc-xp-fill" style={{ width: `${fillPct}%` }} />
        </div>
        <div className="ms-arc-xp-pct" data-field="xp.pct">{pick(cfg, 'xp.pct')}</div>
      </div>

      {/* Leaderboard (top 3) */}
      <div className="ms-arc-side" data-widget="leaderboard">
        <h2 className="ms-arc-side-h2" data-field="leaderboard.title">{pick(cfg, 'leaderboard.title')}</h2>
        <div className="ms-arc-side-sub" data-field="leaderboard.sub">{pick(cfg, 'leaderboard.sub')}</div>

        {([0, 1, 2] as const).map((i) => {
          const klass = i === 0 ? 'g1' : i === 1 ? 'g2' : 'g3';
          const rank = i === 0 ? '#1' : i === 1 ? '#2' : '#3';
          const avStyle: React.CSSProperties = i === 1 ? { background: '#ffd84d' } : i === 2 ? { background: '#ff5ca8' } : {};
          return (
            <div key={i} className={`ms-arc-entry ms-arc-${klass}`} data-widget={`leaderboard.${i}`}>
              <span className="ms-arc-rank">{rank}</span>
              <span className="ms-arc-av" style={avStyle} data-field={`leaderboard.${i}.av`}>
                {pick(cfg, `leaderboard.${i}.av` as keyof Required<MsArcadeConfig>)}
              </span>
              <span className="ms-arc-entry-name" data-field={`leaderboard.${i}.name`}>
                {pick(cfg, `leaderboard.${i}.name` as keyof Required<MsArcadeConfig>)}
                <span data-field={`leaderboard.${i}.sub`}>
                  {pick(cfg, `leaderboard.${i}.sub` as keyof Required<MsArcadeConfig>)}
                </span>
              </span>
              <span className="ms-arc-pts">
                <span data-field={`leaderboard.${i}.pts`}>
                  {pick(cfg, `leaderboard.${i}.pts` as keyof Required<MsArcadeConfig>)}
                </span>
                <span>PTS</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Quest log (agenda) */}
      <div className="ms-arc-board" data-widget="agenda">
        <div className="ms-arc-board-head">
          <h2 className="ms-arc-board-h2" data-field="agenda.title">{pick(cfg, 'agenda.title')}</h2>
          <div className="ms-arc-board-day">
            <span data-field="agenda.day">{pick(cfg, 'agenda.day')}</span>{' '}
            <b data-field="agenda.letter">{pick(cfg, 'agenda.letter')}</b>{' · '}
            <span data-field="agenda.date">{pick(cfg, 'agenda.date')}</span>
          </div>
        </div>
        <div className="ms-arc-board-list">
          {([0, 1, 2, 3, 4, 5] as const).map((i) => {
            // Map per-row metadata mirroring the HTML mockup
            const meta: { className: string; iconStyle: React.CSSProperties; status: string }[] = [
              { className: 'done', iconStyle: { background: '#5ff28d' }, status: 'done' },
              { className: 'active', iconStyle: { background: '#ffd84d', color: '#000' }, status: 'live' },
              { className: '', iconStyle: { background: '#3de0e8', color: '#000' }, status: 'up next' },
              { className: '', iconStyle: { background: '#ff8a3d' }, status: '10:50' },
              { className: '', iconStyle: { background: '#ff5ca8' }, status: '11:45' },
              { className: '', iconStyle: { background: '#a86bff' }, status: '12:35' },
            ];
            const m = meta[i];
            return (
              <div key={i} className={`ms-arc-q ${m.className}`.trim()} data-widget={`agenda.${i}`}>
                <span className="ms-arc-q-icon" style={m.iconStyle} data-field={`agenda.${i}.icon`}>
                  {pick(cfg, `agenda.${i}.icon` as keyof Required<MsArcadeConfig>)}
                </span>
                <span className="ms-arc-q-txt">
                  <b data-field={`agenda.${i}.t`}>
                    {pick(cfg, `agenda.${i}.t` as keyof Required<MsArcadeConfig>)}
                  </b>
                  <span data-field={`agenda.${i}.r`}>
                    {pick(cfg, `agenda.${i}.r` as keyof Required<MsArcadeConfig>)}
                  </span>
                </span>
                <span className="ms-arc-q-rw">
                  <span data-field={`agenda.${i}.xp`}>
                    {pick(cfg, `agenda.${i}.xp` as keyof Required<MsArcadeConfig>)}
                  </span>
                  {m.status}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Side quests (loot) */}
      <div className="ms-arc-events">
        <div className="ms-arc-eventsbox" data-widget="loot">
          <h2 className="ms-arc-events-h2" data-field="loot.title">{pick(cfg, 'loot.title')}</h2>
          <div className="ms-arc-events-list">
            {([0, 1] as const).map((i) => (
              <div key={i} className="ms-arc-it" data-widget={`loot.${i}`}>
                <div className="ms-arc-it-date">
                  <span data-field={`loot.${i}.dow`}>
                    {pick(cfg, `loot.${i}.dow` as keyof Required<MsArcadeConfig>)}
                  </span>
                  <span data-field={`loot.${i}.d`}>
                    {pick(cfg, `loot.${i}.d` as keyof Required<MsArcadeConfig>)}
                  </span>
                </div>
                <div className="ms-arc-it-info">
                  <div className="ms-arc-it-t" data-field={`loot.${i}.t`}>
                    {pick(cfg, `loot.${i}.t` as keyof Required<MsArcadeConfig>)}
                  </div>
                  <div className="ms-arc-it-s" data-field={`loot.${i}.s`}>
                    {pick(cfg, `loot.${i}.s` as keyof Required<MsArcadeConfig>)}
                  </div>
                  <span className="ms-arc-it-tag" data-field={`loot.${i}.tag`}>
                    {pick(cfg, `loot.${i}.tag` as keyof Required<MsArcadeConfig>)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Unified bottom bar (BOSS BATTLE × news feed) */}
      <div className="ms-arc-newsbar" data-widget="newsbar">
        <span className="ms-arc-newsbar-tag" data-field="newsbar.tag">{pick(cfg, 'newsbar.tag')}</span>
        <div className="ms-arc-msg-wrap">
          <div className="ms-arc-msg">
            <span data-field="newsbar.message">{pick(cfg, 'newsbar.message')}</span>
            <span aria-hidden="true">{pick(cfg, 'newsbar.message')}</span>
          </div>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — every pixel value matches scratch/design/arcade-ms-v2.html. */
const CSS = `
/* Box-sizing border-box on every panel that sets an explicit width.
   Without this the right column drifts ~88px past its intended edge —
   see the v2.4/v2.7 history in the HTML mockup. */
.ms-arc-quest, .ms-arc-xpbar, .ms-arc-side, .ms-arc-board, .ms-arc-eventsbox {
  box-sizing: border-box;
}

.ms-arc-glow {
  position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse 1600px 900px at 50% 18%, rgba(93,242,141,.10), transparent 60%);
}

/* ─── Top HUD ─────────────────────────────────────────────── */
.ms-arc-hud {
  position: absolute; top: 56px; left: 64px; right: 64px; height: 220px;
  display: flex; justify-content: space-between; align-items: center;
}
.ms-arc-player { display: flex; align-items: center; gap: 40px; }
.ms-arc-avatar {
  width: 200px; height: 200px; background: #ff8a3d;
  position: relative; image-rendering: pixelated;
  box-shadow: inset 0 -20px 0 rgba(0,0,0,.2), inset 20px 0 0 rgba(0,0,0,.05);
  border: 6px solid #f1f1ff;
}
.ms-arc-avatar::before {
  content: ''; position: absolute; top: 56px; left: 40px;
  width: 34px; height: 34px; background: #f1f1ff;
  box-shadow: 86px 0 0 #f1f1ff;
}
.ms-arc-avatar::after {
  content: ''; position: absolute; bottom: 42px; left: 60px;
  width: 80px; height: 28px; background: #f1f1ff;
}
.ms-arc-info .ms-arc-name {
  font-family: 'Press Start 2P', monospace; font-size: 76px; color: #ffd84d;
  line-height: 1; letter-spacing: .02em;
}
.ms-arc-info .ms-arc-sub {
  font-family: 'VT323', monospace; font-size: 60px; color: #3de0e8;
  margin-top: 20px; letter-spacing: .06em;
}
.ms-arc-info .ms-arc-sub b { color: #5ff28d; font-weight: normal; }

.ms-arc-hud-stats { display: flex; gap: 28px; }
.ms-arc-stat {
  background: #1a1a2e; border: 6px solid #f1f1ff; padding: 26px 36px;
  box-shadow: 10px 10px 0 #000;
  display: flex; align-items: center; gap: 28px;
}
.ms-arc-stat .ms-arc-k {
  font-family: 'Press Start 2P', monospace; font-size: 36px; color: #a0a0c0; letter-spacing: .05em;
}
.ms-arc-stat .ms-arc-v {
  font-family: 'VT323', monospace; font-size: 96px; line-height: 1;
  color: #f1f1ff; letter-spacing: .04em;
}
.ms-arc-stat .ms-arc-v.ms-arc-mp { color: #3de0e8; }
.ms-arc-stat .ms-arc-v.ms-arc-xp { color: #ffd84d; }

/* ─── Hero quest card ────────────────────────────────────── */
.ms-arc-quest {
  position: absolute; top: 310px; left: 64px; width: 2400px; height: 800px;
  background: #1a1a2e; border: 6px solid #f1f1ff;
  box-shadow: 16px 16px 0 #000;
  padding: 56px 80px; overflow: hidden;
}
.ms-arc-quest::before {
  content: ''; position: absolute; right: -140px; top: -140px;
  width: 620px; height: 620px;
  background: repeating-conic-gradient(from 0deg, rgba(93,242,141,.14) 0deg 15deg, transparent 15deg 30deg);
  transform: rotate(12deg);
}
.ms-arc-quest-tag {
  display: inline-block; background: #ffd84d; color: #000;
  font-family: 'Press Start 2P', monospace; font-size: 44px;
  padding: 18px 32px; letter-spacing: .04em;
  margin-bottom: 36px; box-shadow: 6px 6px 0 #000;
}
.ms-arc-quest-h1 {
  font-family: 'Press Start 2P', monospace; font-size: 160px; line-height: 1.05;
  color: #f1f1ff; margin: 0; letter-spacing: -.01em;
}
.ms-arc-quest-h1 .ms-arc-hl { color: #5ff28d; text-shadow: 6px 6px 0 #000; }
.ms-arc-quest-sub {
  font-family: 'VT323', monospace; font-size: 72px; line-height: 1.22;
  color: #3de0e8; margin-top: 44px; max-width: 2120px; letter-spacing: .02em;
}
.ms-arc-quest-meta { display: flex; gap: 26px; margin-top: 48px; }
.ms-arc-quest-meta span {
  font-family: 'VT323', monospace; font-size: 52px;
  background: #000; color: #ffd84d;
  padding: 12px 28px; border: 3px solid #ffd84d; letter-spacing: .04em;
}

/* ─── XP bar ─────────────────────────────────────────────── */
.ms-arc-xpbar {
  position: absolute; top: 1130px; left: 64px; width: 2400px; height: 230px;
  background: #1a1a2e; border: 6px solid #f1f1ff; box-shadow: 10px 10px 0 #000;
  padding: 32px 48px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 48px; align-items: center;
  overflow: hidden;
}
.ms-arc-xp-lbl {
  font-family: 'Press Start 2P', monospace; font-size: 48px;
  color: #ffd84d; line-height: 1.2; letter-spacing: .04em; white-space: nowrap;
}
.ms-arc-xp-lbl span {
  display: block; font-family: 'VT323', monospace; font-size: 56px;
  color: #a0a0c0; margin-top: 12px; letter-spacing: .02em; line-height: 1;
}
.ms-arc-xp-track {
  height: 90px; background: #000; border: 5px solid #f1f1ff;
  position: relative; overflow: hidden; image-rendering: pixelated;
}
.ms-arc-xp-fill {
  position: absolute; top: 0; left: 0; bottom: 0;
  background: linear-gradient(90deg, #5ff28d 0%, #5ff28d 80%, #3de0e8 100%);
  box-shadow: inset 0 -14px 0 rgba(0,0,0,.25);
}
.ms-arc-xp-fill::after {
  content: ''; position: absolute; inset: 10px 8px;
  background: repeating-linear-gradient(90deg, transparent 0 24px, rgba(255,255,255,.15) 24px 28px);
}
.ms-arc-xp-pct {
  font-family: 'Press Start 2P', monospace; font-size: 76px; color: #5ff28d;
  letter-spacing: .02em; text-shadow: 5px 5px 0 #000;
}

/* ─── Leaderboard ────────────────────────────────────────── */
.ms-arc-side {
  position: absolute; top: 310px; right: 64px; width: 1280px; height: 1050px;
  background: #1a1a2e; border: 6px solid #f1f1ff; box-shadow: 16px 16px 0 #000;
  padding: 52px 52px;
  display: flex; flex-direction: column;
}
.ms-arc-side-h2 {
  font-family: 'Press Start 2P', monospace; font-size: 64px; color: #ffd84d;
  margin: 0 0 14px; letter-spacing: .02em;
}
.ms-arc-side-sub {
  font-family: 'VT323', monospace; font-size: 44px; color: #a0a0c0;
  letter-spacing: .04em; margin-bottom: 38px;
}
.ms-arc-entry {
  display: grid; grid-template-columns: 170px 108px 1fr auto;
  gap: 28px; align-items: center;
  padding: 28px 0; border-bottom: 3px dashed #333355;
}
.ms-arc-entry:last-child { border-bottom: 0; }
.ms-arc-rank {
  font-family: 'Press Start 2P', monospace; font-size: 54px;
  color: #6a6a88; letter-spacing: .02em;
}
.ms-arc-g1 .ms-arc-rank { color: #ffd84d; }
.ms-arc-g2 .ms-arc-rank { color: #c0c0c0; }
.ms-arc-g3 .ms-arc-rank { color: #ff8a3d; }
.ms-arc-av {
  width: 108px; height: 108px; background: #3de0e8; border: 5px solid #f1f1ff;
  display: grid; place-items: center;
  font-family: 'Press Start 2P', monospace; font-size: 36px; color: #000;
}
.ms-arc-entry-name {
  font-family: 'VT323', monospace; font-size: 58px; color: #f1f1ff;
  line-height: 1.1; letter-spacing: .04em;
}
.ms-arc-entry-name span {
  display: block; font-family: 'Space Grotesk', system-ui, sans-serif;
  font-weight: 500; font-size: 32px; color: #a0a0c0;
  letter-spacing: 0; margin-top: 2px;
}
.ms-arc-pts {
  font-family: 'Press Start 2P', monospace; font-size: 48px; color: #5ff28d;
  letter-spacing: .02em; white-space: nowrap; text-align: right;
}
.ms-arc-pts span:last-child {
  color: #a0a0c0; font-size: 28px; display: block; margin-top: 10px; letter-spacing: .1em;
}

/* ─── Quest log (agenda) ─────────────────────────────────── */
.ms-arc-board {
  position: absolute; top: 1380px; left: 64px; width: 2400px; height: 590px;
  background: #1a1a2e; border: 6px solid #f1f1ff; box-shadow: 16px 16px 0 #000;
  padding: 32px 52px 28px; overflow: hidden;
}
.ms-arc-board-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  margin-bottom: 18px; padding-bottom: 14px; border-bottom: 5px solid #f1f1ff;
}
.ms-arc-board-h2 {
  font-family: 'Press Start 2P', monospace; font-size: 56px; color: #ff5ca8;
  margin: 0; letter-spacing: .02em;
}
.ms-arc-board-day {
  font-family: 'VT323', monospace; font-size: 40px; color: #3de0e8; letter-spacing: .04em;
}
.ms-arc-board-day b { color: #ffd84d; }
.ms-arc-board-list {
  display: grid; grid-template-columns: 1fr 1fr; gap: 18px 28px; margin-top: 14px;
}
.ms-arc-q {
  display: grid; grid-template-columns: 76px 1fr auto; gap: 22px; align-items: center;
  background: #0f0f20; border: 3px solid #333355; padding: 14px 22px; position: relative;
}
.ms-arc-q.active {
  border-color: #5ff28d; box-shadow: inset 0 0 0 3px rgba(93,242,141,.2);
}
.ms-arc-q.done { opacity: .55; }
.ms-arc-q-icon {
  width: 60px; height: 60px; background: #a86bff;
  display: grid; place-items: center;
  font-family: 'Press Start 2P', monospace; font-size: 22px; color: #fff;
  border: 3px solid #f1f1ff;
}
.ms-arc-q-txt {
  font-family: 'VT323', monospace; font-size: 40px; color: #f1f1ff;
  line-height: 1.1; letter-spacing: .02em;
}
.ms-arc-q-txt b { font-weight: normal; color: #ffd84d; }
.ms-arc-q-txt span {
  display: block; font-family: 'Space Grotesk', system-ui, sans-serif;
  font-weight: 500; font-size: 24px; color: #a0a0c0; letter-spacing: 0; margin-top: 2px;
}
.ms-arc-q-rw {
  font-family: 'Press Start 2P', monospace; font-size: 28px; color: #5ff28d;
  letter-spacing: .04em; text-align: right; white-space: nowrap;
}
.ms-arc-q-rw span {
  display: block; color: #a0a0c0; font-size: 18px; margin-top: 6px;
}
.ms-arc-q.done .ms-arc-q-rw { color: #6a6a88; }
.ms-arc-q.active::before {
  content: '▶'; position: absolute; left: -32px; top: 50%; transform: translateY(-50%);
  font-family: 'Press Start 2P', monospace; font-size: 44px; color: #5ff28d;
  animation: msArcBlink 1s steps(2) infinite;
}
@keyframes msArcBlink { 50% { opacity: 0; } }

/* ─── Side quests (loot) ─────────────────────────────────── */
.ms-arc-events {
  position: absolute; top: 1380px; right: 64px; width: 1280px; height: 590px;
}
.ms-arc-eventsbox {
  background: #1a1a2e; border: 6px solid #f1f1ff; box-shadow: 10px 10px 0 #000;
  padding: 28px 36px; height: 100%;
  display: flex; flex-direction: column; overflow: hidden;
}
.ms-arc-events-h2 {
  font-family: 'Press Start 2P', monospace; font-size: 44px; color: #ff8a3d;
  margin: 0 0 18px; letter-spacing: .02em; line-height: 1.15;
}
.ms-arc-events-list {
  display: grid; gap: 16px; flex: 1; grid-auto-rows: 1fr; min-height: 0;
}
.ms-arc-it {
  display: grid; grid-template-columns: 130px 1fr; gap: 22px; align-items: center;
  padding: 16px 18px; background: #0f0f20; border: 3px solid #333355;
}
.ms-arc-it-date {
  background: #ffd84d; color: #000;
  font-family: 'Press Start 2P', monospace; font-size: 22px;
  padding: 12px 6px; text-align: center; line-height: 1.3; letter-spacing: .04em;
  border: 3px solid #f1f1ff;
}
.ms-arc-it-date span {
  display: block; font-family: 'VT323', monospace; font-size: 52px;
  line-height: 1; color: #000; margin-top: 4px;
}
.ms-arc-it-info .ms-arc-it-t {
  font-family: 'VT323', monospace; font-size: 44px; color: #f1f1ff;
  line-height: 1.05; letter-spacing: .02em;
}
.ms-arc-it-info .ms-arc-it-s {
  font-family: 'Space Grotesk', system-ui, sans-serif; font-weight: 500;
  font-size: 24px; color: #a0a0c0; margin-top: 4px;
}
.ms-arc-it-info .ms-arc-it-tag {
  font-family: 'Press Start 2P', monospace; font-size: 20px; color: #5ff28d;
  letter-spacing: .06em; margin-top: 10px; display: inline-block;
}

/* ─── Unified bottom bar ─────────────────────────────────── */
.ms-arc-newsbar {
  position: absolute; bottom: 20px; left: 64px; right: 64px; height: 150px;
  background: #ff5ca8; color: #000;
  display: flex; align-items: stretch;
  border: 6px solid #f1f1ff; box-shadow: 12px 12px 0 #000; overflow: hidden;
}
.ms-arc-newsbar-tag {
  background: #000; color: #fff;
  font-family: 'Press Start 2P', monospace; font-size: 44px;
  padding: 0 48px; display: flex; align-items: center;
  letter-spacing: .04em; flex-shrink: 0; border-right: 5px solid #f1f1ff;
}
.ms-arc-msg-wrap {
  flex: 1; overflow: hidden; display: flex; align-items: center;
  padding-left: 40px;
}
.ms-arc-msg {
  font-family: 'VT323', monospace; font-size: 68px; color: #000;
  white-space: nowrap; letter-spacing: .02em;
  animation: msArcScroll 60s linear infinite;
}
.ms-arc-msg span { display: inline-block; padding-right: 80px; }
@keyframes msArcScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
`;
