"use client";

/**
 * MsHomeroomPortraitWidget — Middle-school lobby scene (PORTRAIT 2160×3840).
 *
 * APPROVED 2026-04-25 — matches scratch/design/homeroom-ms-portrait-v1.html.
 * Portrait sibling to MsHomeroomWidget.
 *
 * Scene metaphor: COZY CLASSROOM, vertical reading rhythm. Same
 * chalkboard + corkboard + polaroid + manila-folder palette as the
 * landscape; different geometry (2160×3840 stage with every panel
 * inset 64px and 20px gaps).
 *
 * Scene layout (panels absolutely positioned on a 2160×3840 stage):
 *   - hud           → y=  56  h= 460  badge + school header + hall-pass + 3 tiles
 *   - hero          → y= 536  h= 900  chalkboard headline + sub + pen chips
 *   - row-spot      → y=1456  h= 620  polaroid (3 avatar rows) + notebook countdown
 *   - agenda        → y=2096  h=1080  corkboard with 7 pinned cards (NOW spans row 1)
 *   - lower         → y=3196  h= 480  lunch bag + bus card + manila clubs
 *   - ticker        → y=3696  h=  84  torn-paper pinned banner
 *   - wainscot      → y=3780  h=  60  wood floor (.stage::before equivalent)
 *
 * box-sizing: border-box on every panel — the .hero panel (2032px wide
 * after 64px insets, with 90px horizontal padding + 24px borders) and
 * the corkboard (same width) both rely on it to land on their intended
 * edges. Every panel uses overflow:hidden.
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsHomeroomPortraitConfig {
  // School / brand
  'school.team'?: string;
  'school.name'?: string;
  'school.year'?: string;
  'school.house'?: string;
  // Day stamp
  'day.label'?: string;
  'day.dow'?: string;
  'day.date'?: string;
  // HUD tiles
  'clock.label'?: string;
  'clock.time'?: string;
  'weather.label'?: string;
  'weather.temp'?: string;
  'weather2.label'?: string;
  'weather2.cond'?: string;
  // Hero — chalkboard greeting
  'greeting.eyebrow'?: string;
  'greeting.h1'?: string;
  'greeting.h2'?: string;
  'greeting.subtitle'?: string;
  'greeting.tag1'?: string;
  'greeting.tag2'?: string;
  'greeting.tag3'?: string;
  'greeting.tag4'?: string;
  // Shoutouts polaroid
  'shoutouts.label'?: string;
  'shoutouts.title'?: string;
  'shoutouts.0.av'?: string;
  'shoutouts.0.who'?: string;
  'shoutouts.0.note'?: string;
  'shoutouts.1.av'?: string;
  'shoutouts.1.who'?: string;
  'shoutouts.1.note'?: string;
  'shoutouts.2.av'?: string;
  'shoutouts.2.who'?: string;
  'shoutouts.2.note'?: string;
  // Countdown
  'countdown.label'?: string;
  'countdown.value'?: string;
  'countdown.meta'?: string;
  'countdown.sub'?: string;
  // Agenda
  'agenda.title'?: string;
  'agenda.day'?: string;
  'agenda.letter'?: string;
  'agenda.dayName'?: string;
  'agenda.0.p'?: string;
  'agenda.0.time'?: string;
  'agenda.0.c'?: string;
  'agenda.0.r'?: string;
  'agenda.0.teacher'?: string;
  'agenda.1.p'?: string;
  'agenda.1.time'?: string;
  'agenda.1.c'?: string;
  'agenda.1.r'?: string;
  'agenda.1.teacher'?: string;
  'agenda.2.p'?: string;
  'agenda.2.time'?: string;
  'agenda.2.c'?: string;
  'agenda.2.r'?: string;
  'agenda.2.teacher'?: string;
  'agenda.3.p'?: string;
  'agenda.3.time'?: string;
  'agenda.3.c'?: string;
  'agenda.3.r'?: string;
  'agenda.3.teacher'?: string;
  'agenda.4.p'?: string;
  'agenda.4.time'?: string;
  'agenda.4.c'?: string;
  'agenda.4.r'?: string;
  'agenda.4.teacher'?: string;
  'agenda.5.p'?: string;
  'agenda.5.time'?: string;
  'agenda.5.c'?: string;
  'agenda.5.r'?: string;
  'agenda.5.teacher'?: string;
  'agenda.6.p'?: string;
  'agenda.6.time'?: string;
  'agenda.6.c'?: string;
  'agenda.6.r'?: string;
  'agenda.6.teacher'?: string;
  // Lunch bag
  'lunch.receipt'?: string;
  'lunch.label'?: string;
  'lunch.entree'?: string;
  'lunch.sides'?: string;
  'lunch.tag1'?: string;
  'lunch.tag2'?: string;
  'lunch.tag3'?: string;
  // Buses
  'buses.title'?: string;
  'buses.label'?: string;
  'buses.0.num'?: string;
  'buses.0.rt'?: string;
  'buses.0.sub'?: string;
  'buses.0.st'?: string;
  'buses.1.num'?: string;
  'buses.1.rt'?: string;
  'buses.1.sub'?: string;
  'buses.1.st'?: string;
  'buses.2.num'?: string;
  'buses.2.rt'?: string;
  'buses.2.sub'?: string;
  'buses.2.st'?: string;
  // Clubs folder
  'clubs.label'?: string;
  'clubs.title'?: string;
  'clubs.0.n'?: string;
  'clubs.0.m'?: string;
  'clubs.0.w'?: string;
  'clubs.1.n'?: string;
  'clubs.1.m'?: string;
  'clubs.1.w'?: string;
  'clubs.2.n'?: string;
  'clubs.2.m'?: string;
  'clubs.2.w'?: string;
  // Ticker
  'announcement.badge'?: string;
  'announcement.message'?: string;
}

const DEFAULTS: Required<MsHomeroomPortraitConfig> = {
  // School / brand
  'school.team': 'Home of the Otters',
  'school.name': 'Westridge Middle',
  'school.year': '2025–26 · Term 2',
  'school.house': 'House Otter · Lvl 7',
  // Day stamp
  'day.label': 'Hall Pass · Today',
  'day.dow': 'Tuesday',
  'day.date': 'Apr 21',
  // HUD tiles
  'clock.label': 'Now',
  'clock.time': '7:53',
  'weather.label': 'Outside',
  'weather.temp': '46°',
  'weather2.label': 'Sky',
  'weather2.cond': 'Sunny',
  // Hero
  'greeting.eyebrow': 'Good Morning, Otters',
  'greeting.h1': 'Hey',
  'greeting.h2': 'have a good one.',
  'greeting.subtitle':
    "First period starts at 8:05. Hit your locker, say hi to someone, bring a pencil. Homeroom takes attendance by 8:10 sharp. Today's poetry workshop in Rm 108 with Mr. Nguyen — bring your journal.",
  'greeting.tag1': 'Day B · Block schedule',
  'greeting.tag2': 'Spring Field Day · 12 days out',
  'greeting.tag3': 'Picture Day · Thursday',
  'greeting.tag4': 'Bus 14 · running +10',
  // Shoutouts
  'shoutouts.label': "Today's High-Fives",
  'shoutouts.title': 'Birthdays & Shoutouts',
  'shoutouts.0.av': 'MR',
  'shoutouts.0.who': 'Maya R. — turns 13!',
  'shoutouts.0.note': '7th grade · cake at lunch',
  'shoutouts.1.av': 'DK',
  'shoutouts.1.who': 'Daniel K. — Math Olympiad!',
  'shoutouts.1.note': '3rd place state finals',
  'shoutouts.2.av': '7B',
  'shoutouts.2.who': "Ms. Chen's 7B",
  'shoutouts.2.note': 'homework streak record',
  // Countdown
  'countdown.label': 'Spring Field Day',
  'countdown.value': '12',
  'countdown.meta': 'Sign-ups close Friday',
  'countdown.sub': 'at lunch · gym A · cone toss + tug-of-war',
  // Agenda
  'agenda.title': "Today's rotation",
  'agenda.day': 'Day',
  'agenda.letter': 'B',
  'agenda.dayName': '· Tuesday Apr 21',
  'agenda.0.p': 'P1',
  'agenda.0.time': '8:05',
  'agenda.0.c': 'Math 7',
  'agenda.0.r': 'Rm 214',
  'agenda.0.teacher': 'Ms. Patel',
  'agenda.1.p': 'P2',
  'agenda.1.time': '9:00',
  'agenda.1.c': 'English Poetry',
  'agenda.1.r': 'Rm 108',
  'agenda.1.teacher': 'Mr. Nguyen',
  'agenda.2.p': 'P3',
  'agenda.2.time': '9:55',
  'agenda.2.c': 'Science Lab',
  'agenda.2.r': 'Rm 207',
  'agenda.2.teacher': 'Ms. Okafor',
  'agenda.3.p': 'P4',
  'agenda.3.time': '10:50',
  'agenda.3.c': 'PE Mile Run',
  'agenda.3.r': 'Gym A',
  'agenda.3.teacher': 'Coach Reyes',
  'agenda.4.p': 'LU',
  'agenda.4.time': '11:45',
  'agenda.4.c': 'A-Lunch',
  'agenda.4.r': 'Cafeteria',
  'agenda.4.teacher': '7th graders',
  'agenda.5.p': 'P5',
  'agenda.5.time': '12:35',
  'agenda.5.c': 'Map Quiz',
  'agenda.5.r': 'Rm 115',
  'agenda.5.teacher': 'Mr. Alvarez',
  'agenda.6.p': 'P6',
  'agenda.6.time': '1:30',
  'agenda.6.c': 'Art / Print',
  'agenda.6.r': 'Rm B-12',
  'agenda.6.teacher': 'Ms. Park',
  // Lunch
  'lunch.receipt': "Today's Menu · A-Period",
  'lunch.label': 'In the cafeteria',
  'lunch.entree': 'Chicken & rice bowl',
  'lunch.sides':
    'w/ roasted broccoli, garlic bread & seasonal fruit. Salad bar all period.',
  'lunch.tag1': 'Veg ✓',
  'lunch.tag2': 'GF avail',
  'lunch.tag3': 'DF option',
  // Buses
  'buses.title': '2:45 Buses',
  'buses.label': 'East loop',
  'buses.0.num': '12',
  'buses.0.rt': 'Oakdale & Pine Ridge',
  'buses.0.sub': '5 stops · Wallace',
  'buses.0.st': 'On time',
  'buses.1.num': '14',
  'buses.1.rt': 'Westridge Heights',
  'buses.1.sub': '7 stops · curb sign',
  'buses.1.st': '+10 min',
  'buses.2.num': '27',
  'buses.2.rt': 'Clark / Downtown',
  'buses.2.sub': 'cross-town',
  'buses.2.st': 'Scheduled',
  // Clubs
  'clubs.label': 'After school · today @ 3:00',
  'clubs.title': 'Clubs & Auditions',
  'clubs.0.n': 'Robotics Build Week',
  'clubs.0.m': 'Rm 207 · 7th & 8th',
  'clubs.0.w': '3:00 – 4:30',
  'clubs.1.n': 'Drama Auditions',
  'clubs.1.m': 'Auditorium · all grades',
  'clubs.1.w': '3:15 – 4:30',
  'clubs.2.n': 'Garden Club',
  'clubs.2.m': 'Greenhouse · sign in office',
  'clubs.2.w': '3:00 – 4:00',
  // Ticker
  'announcement.badge': 'Heads Up',
  'announcement.message':
    'Picture Day moved to Thursday — full uniform, smile ready · permission slips to front office by Wed · spelling bee sign-ups end Friday · 8th-grade field trip forms due tomorrow · library returns due this week · lost blue water bottle (otter sticker) → front office · Ms. Park out today, sub in B-12 · yearbook photos need names + grade · ',
};

/**
 * Pick a value from the merged config, falling back to DEFAULTS if the
 * caller passed an empty string. Mirrors the landscape widget pattern of
 * "empty string → use default" — empty strings in the editor mean
 * "blank" but in the demo we want the demo copy.
 */
const pick = <K extends keyof Required<MsHomeroomPortraitConfig>>(
  cfg: MsHomeroomPortraitConfig,
  key: K,
): string => {
  const v = cfg[key];
  return (v === undefined || v === '' ? DEFAULTS[key] : v) as string;
};

export function MsHomeroomPortraitWidget({
  config,
}: {
  config?: MsHomeroomPortraitConfig;
}) {
  const cfg = config || {};

  // Per-card metadata mirroring the HTML mockup. In portrait the NOW card
  // (P2 / agenda.1) renders FIRST in the grid (full-width row 1), then
  // P1 (done), then P3..P6 in 2-up rows. The render order here is the
  // DOM order from the mockup: now, done(P1), P3, P4, P5, P6, P7-ish.
  // Avatar background colors for shoutouts pre-baked.
  const shoutoutAv = ['var(--crayon-p)', 'var(--crayon-b)', 'var(--crayon-g)'];
  const busStatusClass = ['on', 'late', 'sched'] as const;
  const clubDot = ['var(--crayon-b)', 'var(--crayon-p)', 'var(--crayon-g)'];
  // Countdown bar — first 5 filled, last 5 empty (matches mockup, 10 dashes).
  const countdownDashes = [false, false, false, false, false, true, true, true, true, true];

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: '#f4ecd8',
        backgroundImage:
          'radial-gradient(ellipse 1500px 1400px at 50% 0%, rgba(244,169,61,.12), transparent 70%), radial-gradient(ellipse 1300px 1200px at 100% 100%, rgba(59,109,191,.07), transparent 70%), radial-gradient(rgba(31,34,48,.04) 1.2px, transparent 1.2px)',
        backgroundSize: 'auto, auto, 28px 28px',
        fontFamily: "'Figtree', system-ui, sans-serif",
        color: '#1f2230',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Wood-grain wainscoting along the bottom (mockup paints this on
          .stage::before; we use a dedicated div so HsStage's own ::before
          is left untouched). */}
      <div className="ms-hr-p-wainscot" aria-hidden="true" />

      {/* ─── HUD ─────────────────────────────────────────── */}
      <header className="ms-hr-p-hud">
        <div className="ms-hr-p-hud-top">
          <div className="ms-hr-p-badge" data-widget="school" aria-hidden="true">
            <div className="ms-hr-p-face" />
            <div className="ms-hr-p-lvl" data-field="school.team">
              {pick(cfg, 'school.team')}
            </div>
          </div>
          <div className="ms-hr-p-hud-info">
            <div className="ms-hr-p-eye">Welcome, Otters</div>
            <div className="ms-hr-p-name" data-field="school.name">
              {pick(cfg, 'school.name')}
            </div>
            <div className="ms-hr-p-sub">
              <span data-field="school.year">{pick(cfg, 'school.year')}</span>
              <span className="ms-hr-p-bullet" />
              <b data-field="school.house">{pick(cfg, 'school.house')}</b>
            </div>
          </div>
          <div className="ms-hr-p-stamp" data-widget="day">
            <div className="ms-hr-p-stamp-lab" data-field="day.label">
              {pick(cfg, 'day.label')}
            </div>
            <div className="ms-hr-p-stamp-day">
              <span data-field="day.dow">{pick(cfg, 'day.dow')}</span>{' '}
              <b data-field="day.date">{pick(cfg, 'day.date')}</b>
            </div>
          </div>
        </div>

        <div className="ms-hr-p-tiles">
          <div className="ms-hr-p-tile" data-widget="clock">
            <span className="ms-hr-p-tile-k" data-field="clock.label">
              {pick(cfg, 'clock.label')}
            </span>
            <span className="ms-hr-p-tile-v" data-field="clock.time">
              {pick(cfg, 'clock.time')}
            </span>
          </div>
          <div className="ms-hr-p-tile" data-widget="weather">
            <span className="ms-hr-p-tile-k" data-field="weather.label">
              {pick(cfg, 'weather.label')}
            </span>
            <span className="ms-hr-p-tile-v ms-hr-p-cool" data-field="weather.temp">
              {pick(cfg, 'weather.temp')}
            </span>
          </div>
          <div className="ms-hr-p-tile" data-widget="weather2">
            <span className="ms-hr-p-tile-k" data-field="weather2.label">
              {pick(cfg, 'weather2.label')}
            </span>
            <span className="ms-hr-p-tile-v ms-hr-p-sun" data-field="weather2.cond">
              {pick(cfg, 'weather2.cond')}
            </span>
          </div>
        </div>
      </header>

      {/* ─── HERO — chalkboard greeting ─────────────────── */}
      <section className="ms-hr-p-hero" data-widget="greeting">
        <div className="ms-hr-p-sun" aria-hidden="true">
          <svg viewBox="0 0 200 200">
            <g
              fill="none"
              stroke="#f4cf3d"
              strokeWidth="5"
              strokeLinecap="round"
              opacity="0.95"
            >
              <circle cx="100" cy="100" r="44" />
              <line x1="100" y1="20" x2="100" y2="40" />
              <line x1="100" y1="160" x2="100" y2="180" />
              <line x1="20" y1="100" x2="40" y2="100" />
              <line x1="160" y1="100" x2="180" y2="100" />
              <line x1="40" y1="40" x2="56" y2="56" />
              <line x1="144" y1="144" x2="160" y2="160" />
              <line x1="160" y1="40" x2="144" y2="56" />
              <line x1="40" y1="160" x2="56" y2="144" />
            </g>
            <g
              stroke="#f4cf3d"
              strokeWidth="3.5"
              fill="none"
              strokeLinecap="round"
              opacity="0.85"
            >
              <path d="M 82 96 Q 88 92 94 96" />
              <path d="M 106 96 Q 112 92 118 96" />
              <path d="M 82 116 Q 100 130 118 116" />
            </g>
          </svg>
        </div>
        <div className="ms-hr-p-doodles" aria-hidden="true">
          <svg width="320" height="140" viewBox="0 0 280 120">
            <g
              fill="none"
              stroke="#f7f3e6"
              strokeWidth="3.5"
              strokeLinecap="round"
              opacity="0.55"
            >
              <circle cx="50" cy="70" r="14" />
              <circle cx="34" cy="50" r="10" />
              <circle cx="66" cy="50" r="10" />
              <circle cx="34" cy="90" r="10" />
              <circle cx="66" cy="90" r="10" />
              <line x1="50" y1="86" x2="50" y2="120" />
              <path d="M 50 110 Q 80 100 95 115" />
              <circle cx="170" cy="40" r="10" stroke="#e8503a" />
              <circle cx="158" cy="28" r="8" stroke="#e8503a" />
              <circle cx="182" cy="28" r="8" stroke="#e8503a" />
              <circle cx="158" cy="52" r="8" stroke="#e8503a" />
              <circle cx="182" cy="52" r="8" stroke="#e8503a" />
              <line x1="170" y1="58" x2="170" y2="120" stroke="#5ba84e" />
              <path
                d="M 230 80 L 240 60 L 250 80 L 270 80 L 254 94 L 260 114 L 240 102 L 220 114 L 226 94 L 210 80 Z"
                stroke="#f4cf3d"
              />
            </g>
          </svg>
        </div>

        <div className="ms-hr-p-greet-eye" data-field="greeting.eyebrow">
          {pick(cfg, 'greeting.eyebrow')}
        </div>
        <h1 className="ms-hr-p-h1">
          <span data-field="greeting.h1">{pick(cfg, 'greeting.h1')}</span>
          {' — '}
          <em data-field="greeting.h2">{pick(cfg, 'greeting.h2')}</em>
        </h1>
        <p className="ms-hr-p-hero-sub" data-field="greeting.subtitle">
          {pick(cfg, 'greeting.subtitle')}
        </p>
        <div className="ms-hr-p-pencils" data-widget="greeting.tags">
          <span className="ms-hr-p-pen">
            <span className="ms-hr-p-dot" />
            <span data-field="greeting.tag1">{pick(cfg, 'greeting.tag1')}</span>
          </span>
          <span className="ms-hr-p-pen ms-hr-p-pen-b">
            <span className="ms-hr-p-dot" />
            <span data-field="greeting.tag2">{pick(cfg, 'greeting.tag2')}</span>
          </span>
          <span className="ms-hr-p-pen ms-hr-p-pen-y">
            <span className="ms-hr-p-dot" />
            <span data-field="greeting.tag3">{pick(cfg, 'greeting.tag3')}</span>
          </span>
          <span className="ms-hr-p-pen ms-hr-p-pen-g">
            <span className="ms-hr-p-dot" />
            <span data-field="greeting.tag4">{pick(cfg, 'greeting.tag4')}</span>
          </span>
        </div>
      </section>

      {/* ─── SPOTLIGHT + COUNTDOWN row (two columns, side by side) ── */}
      <section className="ms-hr-p-row-spot">
        <div className="ms-hr-p-polaroid" data-widget="shoutouts">
          <div className="ms-hr-p-tape" aria-hidden="true" />
          <div className="ms-hr-p-pol-ey" data-field="shoutouts.label">
            {pick(cfg, 'shoutouts.label')}
          </div>
          <h3 className="ms-hr-p-pol-title" data-field="shoutouts.title">
            {pick(cfg, 'shoutouts.title')}
          </h3>
          <div className="ms-hr-p-lines">
            {([0, 1, 2] as const).map((i) => {
              const ic = i === 0 ? '🎂' : i === 1 ? '⭐' : '🔥';
              return (
                <div
                  className="ms-hr-p-line"
                  data-widget={`shoutouts.${i}`}
                  key={i}
                >
                  <span
                    className="ms-hr-p-av"
                    style={{ background: shoutoutAv[i] }}
                    data-field={`shoutouts.${i}.av`}
                  >
                    {pick(cfg, `shoutouts.${i}.av` as keyof Required<MsHomeroomPortraitConfig>)}
                  </span>
                  <span className="ms-hr-p-who" data-field={`shoutouts.${i}.who`}>
                    {pick(cfg, `shoutouts.${i}.who` as keyof Required<MsHomeroomPortraitConfig>)}
                    <span data-field={`shoutouts.${i}.note`}>
                      {pick(cfg, `shoutouts.${i}.note` as keyof Required<MsHomeroomPortraitConfig>)}
                    </span>
                  </span>
                  <span className="ms-hr-p-ic">{ic}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ms-hr-p-countdown" data-widget="countdown">
          <div className="ms-hr-p-cd-ey">
            Days until{' '}
            <b data-field="countdown.label">{pick(cfg, 'countdown.label')}</b>
          </div>
          <div className="ms-hr-p-cd-row">
            <div className="ms-hr-p-cd-num" data-field="countdown.value">
              {pick(cfg, 'countdown.value')}
            </div>
            <div className="ms-hr-p-cd-meta" data-field="countdown.meta">
              {pick(cfg, 'countdown.meta')}
              <span data-field="countdown.sub">
                {pick(cfg, 'countdown.sub')}
              </span>
            </div>
          </div>
          <div className="ms-hr-p-dashes" aria-hidden="true">
            {countdownDashes.map((empty, i) => (
              <span
                key={i}
                className={`ms-hr-p-dash${empty ? ' ms-hr-p-dash-empty' : ''}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ─── AGENDA — corkboard with index cards ─────────── */}
      <section className="ms-hr-p-agenda" data-widget="agenda">
        <div className="ms-hr-p-ag-head">
          <h2 className="ms-hr-p-ag-title" data-field="agenda.title">
            {pick(cfg, 'agenda.title')}
          </h2>
          <div className="ms-hr-p-ag-day">
            <span data-field="agenda.day">{pick(cfg, 'agenda.day')}</span>{' '}
            <b data-field="agenda.letter">{pick(cfg, 'agenda.letter')}</b>{' '}
            <span data-field="agenda.dayName">{pick(cfg, 'agenda.dayName')}</span>
          </div>
        </div>
        <div className="ms-hr-p-ag-grid">
          {/* Row 1 (full width): NOW / current period (P2 = agenda.1) */}
          <div className="ms-hr-p-card ms-hr-p-now" data-widget="agenda.1">
            <div className="ms-hr-p-now-left">
              <div className="ms-hr-p-card-top">
                <span className="ms-hr-p-card-p" data-field="agenda.1.p">
                  {pick(cfg, 'agenda.1.p')}
                </span>
                <span className="ms-hr-p-card-t" data-field="agenda.1.time">
                  {pick(cfg, 'agenda.1.time')}
                </span>
              </div>
              <div className="ms-hr-p-card-r">
                <b data-field="agenda.1.r">{pick(cfg, 'agenda.1.r')}</b> ·{' '}
                <span data-field="agenda.1.teacher">
                  {pick(cfg, 'agenda.1.teacher')}
                </span>
              </div>
            </div>
            <div className="ms-hr-p-now-right">
              <div className="ms-hr-p-card-c" data-field="agenda.1.c">
                {pick(cfg, 'agenda.1.c')}
              </div>
              <div className="ms-hr-p-card-r">
                poetry workshop &mdash; bring your journal
              </div>
            </div>
          </div>

          {/* Row 2: P1 (done), P3 */}
          <div className="ms-hr-p-card ms-hr-p-done" data-widget="agenda.0">
            <div className="ms-hr-p-card-top">
              <span className="ms-hr-p-card-p" data-field="agenda.0.p">
                {pick(cfg, 'agenda.0.p')}
              </span>
              <span className="ms-hr-p-card-t" data-field="agenda.0.time">
                {pick(cfg, 'agenda.0.time')}
              </span>
            </div>
            <div className="ms-hr-p-card-c" data-field="agenda.0.c">
              {pick(cfg, 'agenda.0.c')}
            </div>
            <div className="ms-hr-p-card-r">
              <b data-field="agenda.0.r">{pick(cfg, 'agenda.0.r')}</b> ·{' '}
              <span data-field="agenda.0.teacher">
                {pick(cfg, 'agenda.0.teacher')}
              </span>
            </div>
          </div>
          <div className="ms-hr-p-card" data-widget="agenda.2">
            <div className="ms-hr-p-card-top">
              <span className="ms-hr-p-card-p" data-field="agenda.2.p">
                {pick(cfg, 'agenda.2.p')}
              </span>
              <span className="ms-hr-p-card-t" data-field="agenda.2.time">
                {pick(cfg, 'agenda.2.time')}
              </span>
            </div>
            <div className="ms-hr-p-card-c" data-field="agenda.2.c">
              {pick(cfg, 'agenda.2.c')}
            </div>
            <div className="ms-hr-p-card-r">
              <b data-field="agenda.2.r">{pick(cfg, 'agenda.2.r')}</b> ·{' '}
              <span data-field="agenda.2.teacher">
                {pick(cfg, 'agenda.2.teacher')}
              </span>
            </div>
          </div>

          {/* Row 3: P4, LU */}
          <div className="ms-hr-p-card" data-widget="agenda.3">
            <div className="ms-hr-p-card-top">
              <span className="ms-hr-p-card-p" data-field="agenda.3.p">
                {pick(cfg, 'agenda.3.p')}
              </span>
              <span className="ms-hr-p-card-t" data-field="agenda.3.time">
                {pick(cfg, 'agenda.3.time')}
              </span>
            </div>
            <div className="ms-hr-p-card-c" data-field="agenda.3.c">
              {pick(cfg, 'agenda.3.c')}
            </div>
            <div className="ms-hr-p-card-r">
              <b data-field="agenda.3.r">{pick(cfg, 'agenda.3.r')}</b> ·{' '}
              <span data-field="agenda.3.teacher">
                {pick(cfg, 'agenda.3.teacher')}
              </span>
            </div>
          </div>
          <div className="ms-hr-p-card" data-widget="agenda.4">
            <div className="ms-hr-p-card-top">
              <span className="ms-hr-p-card-p" data-field="agenda.4.p">
                {pick(cfg, 'agenda.4.p')}
              </span>
              <span className="ms-hr-p-card-t" data-field="agenda.4.time">
                {pick(cfg, 'agenda.4.time')}
              </span>
            </div>
            <div className="ms-hr-p-card-c" data-field="agenda.4.c">
              {pick(cfg, 'agenda.4.c')}
            </div>
            <div className="ms-hr-p-card-r">
              <b data-field="agenda.4.r">{pick(cfg, 'agenda.4.r')}</b> ·{' '}
              <span data-field="agenda.4.teacher">
                {pick(cfg, 'agenda.4.teacher')}
              </span>
            </div>
          </div>

          {/* Row 4: P5, P6 */}
          <div className="ms-hr-p-card" data-widget="agenda.5">
            <div className="ms-hr-p-card-top">
              <span className="ms-hr-p-card-p" data-field="agenda.5.p">
                {pick(cfg, 'agenda.5.p')}
              </span>
              <span className="ms-hr-p-card-t" data-field="agenda.5.time">
                {pick(cfg, 'agenda.5.time')}
              </span>
            </div>
            <div className="ms-hr-p-card-c" data-field="agenda.5.c">
              {pick(cfg, 'agenda.5.c')}
            </div>
            <div className="ms-hr-p-card-r">
              <b data-field="agenda.5.r">{pick(cfg, 'agenda.5.r')}</b> ·{' '}
              <span data-field="agenda.5.teacher">
                {pick(cfg, 'agenda.5.teacher')}
              </span>
            </div>
          </div>
          <div className="ms-hr-p-card" data-widget="agenda.6">
            <div className="ms-hr-p-card-top">
              <span className="ms-hr-p-card-p" data-field="agenda.6.p">
                {pick(cfg, 'agenda.6.p')}
              </span>
              <span className="ms-hr-p-card-t" data-field="agenda.6.time">
                {pick(cfg, 'agenda.6.time')}
              </span>
            </div>
            <div className="ms-hr-p-card-c" data-field="agenda.6.c">
              {pick(cfg, 'agenda.6.c')}
            </div>
            <div className="ms-hr-p-card-r">
              <b data-field="agenda.6.r">{pick(cfg, 'agenda.6.r')}</b> ·{' '}
              <span data-field="agenda.6.teacher">
                {pick(cfg, 'agenda.6.teacher')}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── LOWER — lunch · buses · clubs ─────────────── */}
      <section className="ms-hr-p-lower">
        {/* LUNCH — brown paper bag */}
        <div className="ms-hr-p-lunchbag" data-widget="lunch">
          <div className="ms-hr-p-bag">
            <div className="ms-hr-p-receipt" data-field="lunch.receipt">
              {pick(cfg, 'lunch.receipt')}
            </div>
            <div className="ms-hr-p-bag-ey" data-field="lunch.label">
              {pick(cfg, 'lunch.label')}
            </div>
            <div className="ms-hr-p-entree" data-field="lunch.entree">
              {pick(cfg, 'lunch.entree')}
            </div>
            <div className="ms-hr-p-sides" data-field="lunch.sides">
              {pick(cfg, 'lunch.sides')}
            </div>
            <div className="ms-hr-p-tags">
              <span className="ms-hr-p-tag ms-hr-p-tag-veg" data-field="lunch.tag1">
                {pick(cfg, 'lunch.tag1')}
              </span>
              <span className="ms-hr-p-tag ms-hr-p-tag-gf" data-field="lunch.tag2">
                {pick(cfg, 'lunch.tag2')}
              </span>
              <span className="ms-hr-p-tag ms-hr-p-tag-df" data-field="lunch.tag3">
                {pick(cfg, 'lunch.tag3')}
              </span>
            </div>
          </div>
        </div>

        {/* BUSES — yellow bus card */}
        <div className="ms-hr-p-buses" data-widget="buses">
          <div className="ms-hr-p-bus-head">
            <span className="ms-hr-p-bus-t" data-field="buses.title">
              {pick(cfg, 'buses.title')}
            </span>
            <span className="ms-hr-p-bus-ey" data-field="buses.label">
              {pick(cfg, 'buses.label')}
            </span>
          </div>
          <div className="ms-hr-p-bus-list">
            {([0, 1, 2] as const).map((i) => {
              const stCls = busStatusClass[i];
              return (
                <div className="ms-hr-p-bus" data-widget={`buses.${i}`} key={i}>
                  <span className="ms-hr-p-bus-num" data-field={`buses.${i}.num`}>
                    {pick(cfg, `buses.${i}.num` as keyof Required<MsHomeroomPortraitConfig>)}
                  </span>
                  <div className="ms-hr-p-bus-info">
                    <div className="ms-hr-p-bus-rt" data-field={`buses.${i}.rt`}>
                      {pick(cfg, `buses.${i}.rt` as keyof Required<MsHomeroomPortraitConfig>)}
                    </div>
                    <div className="ms-hr-p-bus-sub" data-field={`buses.${i}.sub`}>
                      {pick(cfg, `buses.${i}.sub` as keyof Required<MsHomeroomPortraitConfig>)}
                    </div>
                  </div>
                  <span
                    className={`ms-hr-p-bus-st ms-hr-p-bus-${stCls}`}
                    data-field={`buses.${i}.st`}
                  >
                    {pick(cfg, `buses.${i}.st` as keyof Required<MsHomeroomPortraitConfig>)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* CLUBS — manila folder */}
        <div className="ms-hr-p-folder" data-widget="clubs">
          <span className="ms-hr-p-clip" aria-hidden="true" />
          <div className="ms-hr-p-folder-ey" data-field="clubs.label">
            {pick(cfg, 'clubs.label')}
          </div>
          <h3 className="ms-hr-p-folder-title" data-field="clubs.title">
            {pick(cfg, 'clubs.title')}
          </h3>
          <div className="ms-hr-p-folder-list">
            {([0, 1, 2] as const).map((i) => (
              <div
                className="ms-hr-p-folder-row"
                data-widget={`clubs.${i}`}
                key={i}
              >
                <span
                  className="ms-hr-p-folder-dot"
                  style={{ background: clubDot[i] }}
                />
                <span className="ms-hr-p-folder-n" data-field={`clubs.${i}.n`}>
                  {pick(cfg, `clubs.${i}.n` as keyof Required<MsHomeroomPortraitConfig>)}
                  <span data-field={`clubs.${i}.m`}>
                    {pick(cfg, `clubs.${i}.m` as keyof Required<MsHomeroomPortraitConfig>)}
                  </span>
                </span>
                <span className="ms-hr-p-folder-w" data-field={`clubs.${i}.w`}>
                  {pick(cfg, `clubs.${i}.w` as keyof Required<MsHomeroomPortraitConfig>)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── TICKER — torn-paper banner ─────────────────── */}
      <div className="ms-hr-p-ticker-pin ms-hr-p-ticker-pin-l" aria-hidden="true" />
      <div className="ms-hr-p-ticker-pin ms-hr-p-ticker-pin-r" aria-hidden="true" />
      <div className="ms-hr-p-ticker" data-widget="announcement">
        <div className="ms-hr-p-ticker-badge" data-field="announcement.badge">
          {pick(cfg, 'announcement.badge')}
        </div>
        <div className="ms-hr-p-ticker-feed">
          <div className="ms-hr-p-ticker-msg">
            <span data-field="announcement.message">
              {pick(cfg, 'announcement.message')}
            </span>
            <span aria-hidden="true">{pick(cfg, 'announcement.message')}</span>
          </div>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — every pixel value matches scratch/design/homeroom-ms-portrait-v1.html. */
const CSS = `
/* Universal border-box so explicit widths mean edge-to-edge (matches mockup). */
.ms-hr-p-hud, .ms-hr-p-hud *, .ms-hr-p-hud *::before, .ms-hr-p-hud *::after,
.ms-hr-p-hero, .ms-hr-p-hero *, .ms-hr-p-hero *::before, .ms-hr-p-hero *::after,
.ms-hr-p-row-spot, .ms-hr-p-row-spot *, .ms-hr-p-row-spot *::before, .ms-hr-p-row-spot *::after,
.ms-hr-p-agenda, .ms-hr-p-agenda *, .ms-hr-p-agenda *::before, .ms-hr-p-agenda *::after,
.ms-hr-p-lower, .ms-hr-p-lower *, .ms-hr-p-lower *::before, .ms-hr-p-lower *::after,
.ms-hr-p-ticker, .ms-hr-p-ticker *, .ms-hr-p-ticker *::before, .ms-hr-p-ticker *::after,
.ms-hr-p-wainscot, .ms-hr-p-ticker-pin {
  box-sizing: border-box;
}

/* Theme tokens scoped to the widget (matches :root in mockup). */
.ms-hr-p-hud, .ms-hr-p-hero, .ms-hr-p-row-spot, .ms-hr-p-agenda, .ms-hr-p-lower, .ms-hr-p-ticker, .ms-hr-p-wainscot {
  --slate:    #2d4a3a;
  --slate-2:  #1f3328;
  --chalk:    #f7f3e6;
  --chalk-d:  rgba(247,243,230,.78);
  --paper:    #f4ecd8;
  --paper-2:  #ece3cc;
  --cork:     #c4894d;
  --cork-2:   #b07939;
  --cork-d:   #8a5a2c;
  --kraft:    #c5984e;
  --kraft-d:  #8c6a32;
  --bus:      #ffc340;
  --bus-d:    #d49a17;
  --pencil:   #f4a93d;
  --crayon-r: #e8503a;
  --crayon-b: #3b6dbf;
  --crayon-g: #5ba84e;
  --crayon-p: #c25a9e;
  --crayon-y: #f4cf3d;
  --ink:      #1f2230;
  --ink-2:    #3b3f53;
  --pin:      #d8473a;
}

/* Wood-grain wainscoting along the bottom edge of the stage. */
.ms-hr-p-wainscot {
  position: absolute; left: 0; right: 0; bottom: 0; height: 60px; z-index: 0; pointer-events: none;
  background:
    repeating-linear-gradient(90deg,
      #8a5a2c 0 280px, #7d4f24 280px 320px, #8a5a2c 320px 600px, #6f4520 600px 640px),
    linear-gradient(180deg, #6f4520 0%, #8a5a2c 25%, #6f4520 100%);
  border-top: 5px solid #4a2e15;
  box-shadow: inset 0 6px 0 rgba(0,0,0,.18);
}

/* ─── HUD (y=56, h=460) ─────────────────────────────────
   ROW 1 (h=256):  badge + school info (eye/name/sub) + hall-pass stamp
   ROW 2 (h=184):  3 tiles in a row
─────────────────────────────────────────────────────── */
.ms-hr-p-hud {
  position: absolute; top: 56px; left: 64px; right: 64px; height: 460px;
  z-index: 4;
  display: grid; grid-template-rows: 256px 184px; gap: 20px;
}

.ms-hr-p-hud-top {
  display: grid; grid-template-columns: auto 1fr auto;
  gap: 40px; align-items: center;
}

.ms-hr-p-badge {
  width: 240px; height: 240px; flex-shrink: 0;
  background: var(--slate);
  border: 10px solid #6b4621;
  box-shadow: 10px 10px 0 rgba(0,0,0,.18), inset 0 0 0 5px var(--slate-2);
  position: relative;
  transform: rotate(-2deg);
}
.ms-hr-p-badge::before {
  content: ''; position: absolute; inset: 0;
  background-image:
    radial-gradient(rgba(247,243,230,.10) 1.6px, transparent 1.7px),
    radial-gradient(rgba(247,243,230,.06) 1px,   transparent 1.1px);
  background-size: 22px 22px, 11px 11px;
  background-position: 0 0, 5px 7px;
  mix-blend-mode: screen;
}
.ms-hr-p-face { position: absolute; inset: 28px; display: grid; place-items: center; }
.ms-hr-p-face::before {
  content: ''; width: 156px; height: 132px; border-radius: 60% 60% 50% 50%;
  border: 5px solid var(--chalk);
  box-shadow: 0 0 0 1px rgba(247,243,230,.35);
  background:
    radial-gradient(circle at 30% 38%, var(--chalk) 0 7px, transparent 8px),
    radial-gradient(circle at 70% 38%, var(--chalk) 0 7px, transparent 8px),
    radial-gradient(circle at 50% 60%, var(--chalk) 0 5px, transparent 6px);
}
.ms-hr-p-face::after {
  content: ''; position: absolute; top: 10px; left: 50%;
  width: 180px; height: 36px; transform: translateX(-50%);
  background:
    radial-gradient(circle at 18% 50%, var(--chalk) 0 8px, transparent 9px),
    radial-gradient(circle at 82% 50%, var(--chalk) 0 8px, transparent 9px);
}
.ms-hr-p-lvl {
  position: absolute; bottom: -22px; left: 50%; transform: translateX(-50%) rotate(-3deg);
  background: var(--bus); color: var(--ink);
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 38px;
  padding: 6px 24px; border: 5px solid var(--ink);
  box-shadow: 5px 5px 0 rgba(0,0,0,.25);
  letter-spacing: .02em; white-space: nowrap;
}

.ms-hr-p-hud-info { min-width: 0; }
.ms-hr-p-hud-info .ms-hr-p-eye {
  font-family: 'Patrick Hand', cursive; font-size: 44px; color: var(--crayon-r);
  letter-spacing: .14em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 18px;
}
.ms-hr-p-hud-info .ms-hr-p-eye::before {
  content: ''; width: 64px; height: 5px; background: var(--crayon-r); border-radius: 2px;
}
.ms-hr-p-hud-info .ms-hr-p-name {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 124px; line-height: .92; color: var(--ink);
  letter-spacing: -.025em; margin-top: 8px;
}
.ms-hr-p-hud-info .ms-hr-p-sub {
  font-family: 'Patrick Hand', cursive; font-size: 44px; color: var(--ink-2);
  letter-spacing: .04em; margin-top: 14px;
}
.ms-hr-p-hud-info .ms-hr-p-sub b { color: var(--crayon-r); font-weight: 700; }
.ms-hr-p-hud-info .ms-hr-p-bullet {
  display: inline-block; width: 14px; height: 14px; border-radius: 50%;
  background: var(--pencil); margin: 0 18px; vertical-align: middle;
}

/* Hall-pass day stamp */
.ms-hr-p-stamp {
  justify-self: end; text-align: center;
  transform: rotate(-3deg);
  background: var(--paper-2); border: 6px solid var(--ink);
  padding: 18px 56px 22px;
  box-shadow: 9px 9px 0 var(--ink);
  position: relative;
}
.ms-hr-p-stamp::before, .ms-hr-p-stamp::after {
  content: ''; position: absolute; top: 50%; width: 30px; height: 30px;
  background: var(--ink); border-radius: 50%;
  transform: translateY(-50%);
}
.ms-hr-p-stamp::before { left: -18px; }
.ms-hr-p-stamp::after  { right: -18px; }
.ms-hr-p-stamp-lab {
  font-family: 'Patrick Hand', cursive; font-size: 36px; letter-spacing: .22em;
  text-transform: uppercase; color: var(--ink-2);
}
.ms-hr-p-stamp-day {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 80px; line-height: 1; color: var(--ink); letter-spacing: -.02em;
  margin-top: 4px;
}
.ms-hr-p-stamp-day b { color: var(--crayon-r); font-weight: 900; }

/* tiles row — full-width, 3 equal */
.ms-hr-p-tiles {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px;
  align-items: stretch;
}
.ms-hr-p-tile {
  background: #fff; border: 6px solid var(--ink);
  box-shadow: 9px 9px 0 var(--ink);
  padding: 28px 36px;
  display: flex; flex-direction: column; gap: 8px;
  position: relative;
  overflow: hidden;
}
.ms-hr-p-tile:nth-child(1) { transform: rotate(-1.5deg); }
.ms-hr-p-tile:nth-child(2) { transform: rotate(1deg); }
.ms-hr-p-tile:nth-child(3) { transform: rotate(-.5deg); }
.ms-hr-p-tile-k {
  font-family: 'Patrick Hand', cursive; font-size: 36px;
  letter-spacing: .14em; text-transform: uppercase; color: var(--ink-2);
}
.ms-hr-p-tile-v {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 96px; line-height: 1; color: var(--ink); letter-spacing: -.02em;
}
.ms-hr-p-tile-v.ms-hr-p-cool { color: var(--crayon-b); }
.ms-hr-p-tile-v.ms-hr-p-sun  { color: var(--pencil); font-size: 80px; }

/* ─── HERO (y=536, h=900) — chalkboard ─────────────── */
.ms-hr-p-hero {
  position: absolute; top: 536px; left: 64px; right: 64px; height: 900px;
  background: var(--slate);
  background-image:
    radial-gradient(ellipse 800px 280px at 70% 30%, rgba(247,243,230,.07), transparent 65%),
    radial-gradient(ellipse 600px 260px at 20% 78%, rgba(247,243,230,.05), transparent 65%),
    radial-gradient(rgba(247,243,230,.05) 1.5px, transparent 1.6px),
    radial-gradient(rgba(247,243,230,.03) 1px,   transparent 1.1px);
  background-size: auto, auto, 24px 24px, 11px 11px;
  background-position: 0 0, 0 0, 0 0, 6px 8px;
  border: 24px solid #8a5a2c;
  border-image: linear-gradient(135deg, #a06a35 0%, #6b4621 50%, #a06a35 100%) 1;
  box-shadow:
    10px 10px 0 rgba(0,0,0,.25),
    inset 0 0 0 7px var(--slate-2),
    inset 0 0 110px rgba(0,0,0,.35);
  padding: 64px 90px 56px;
  z-index: 2;
  overflow: hidden;
}
.ms-hr-p-sun {
  position: absolute; top: 56px; right: 100px; width: 260px; height: 260px;
  pointer-events: none; opacity: .92;
}
.ms-hr-p-sun svg { width: 100%; height: 100%; }
.ms-hr-p-doodles {
  position: absolute; bottom: 36px; left: 80px; pointer-events: none; opacity: .85;
}

.ms-hr-p-greet-eye {
  font-family: 'Patrick Hand', cursive; font-size: 56px;
  color: var(--crayon-y); letter-spacing: .14em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 20px;
  margin-bottom: 22px;
}
.ms-hr-p-greet-eye::before { content: '✶'; font-size: 64px; color: var(--crayon-y); }
.ms-hr-p-h1 {
  font-family: 'Kalam', cursive; font-weight: 700;
  font-size: 260px; line-height: .94;
  color: var(--chalk); margin: 0;
  letter-spacing: -.005em;
  text-shadow: 5px 5px 0 rgba(0,0,0,.25), 0 0 60px rgba(247,243,230,.06);
  position: relative;
}
.ms-hr-p-h1 em {
  font-family: 'Caveat', cursive; font-style: italic; font-weight: 700;
  color: var(--pencil);
}
.ms-hr-p-hero-sub {
  font-family: 'Patrick Hand', cursive; font-size: 60px; line-height: 1.32;
  color: var(--chalk-d); margin-top: 44px; max-width: 1820px;
  letter-spacing: .005em;
}
.ms-hr-p-hero-sub b {
  color: var(--crayon-y); font-weight: 400;
  background: linear-gradient(180deg, transparent 65%, rgba(244,207,61,.22) 65% 92%, transparent 92%);
  padding: 0 6px;
}
.ms-hr-p-pencils {
  margin-top: 36px;
  display: flex; gap: 20px; flex-wrap: wrap;
}
.ms-hr-p-pen {
  display: inline-flex; align-items: center; gap: 18px;
  padding: 14px 30px;
  background: rgba(247,243,230,.08); border: 4px dashed var(--chalk-d);
  border-radius: 999px;
  font-family: 'Patrick Hand', cursive; font-size: 42px;
  color: var(--chalk); letter-spacing: .02em;
}
.ms-hr-p-pen .ms-hr-p-dot {
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--crayon-r); border: 4px solid var(--chalk);
  box-shadow: 2px 2px 0 rgba(0,0,0,.4);
  flex-shrink: 0;
}
.ms-hr-p-pen-b .ms-hr-p-dot { background: var(--crayon-b); }
.ms-hr-p-pen-g .ms-hr-p-dot { background: var(--crayon-g); }
.ms-hr-p-pen-y .ms-hr-p-dot { background: var(--crayon-y); }

/* ─── SPOTLIGHT + COUNTDOWN row (y=1456, h=620) ───────── */
.ms-hr-p-row-spot {
  position: absolute; top: 1456px; left: 64px; right: 64px; height: 620px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
  z-index: 3;
}

.ms-hr-p-polaroid {
  position: relative; height: 100%;
  background: #fff; border: 6px solid var(--ink); padding: 36px 44px 28px;
  box-shadow: 14px 14px 0 var(--ink);
  transform: rotate(-1.4deg);
  overflow: hidden;
}
.ms-hr-p-tape {
  position: absolute; top: -20px; left: 28%; width: 280px; height: 60px;
  background: rgba(255, 197, 76, .85);
  transform: rotate(-3deg);
  box-shadow: 0 4px 12px rgba(0,0,0,.18);
  background-image: repeating-linear-gradient(90deg, rgba(0,0,0,.04) 0 2px, transparent 2px 8px);
}
.ms-hr-p-pol-ey {
  font-family: 'Patrick Hand', cursive; font-size: 40px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--crayon-r); margin-bottom: 10px;
}
.ms-hr-p-pol-title {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 86px; line-height: 1; color: var(--ink);
  letter-spacing: -.02em; margin: 0 0 22px;
}
.ms-hr-p-lines { display: grid; gap: 14px; }
.ms-hr-p-line {
  display: grid; grid-template-columns: 110px 1fr auto; gap: 22px; align-items: center;
  padding: 12px 0;
  border-bottom: 3px dashed rgba(31,34,48,.18);
}
.ms-hr-p-line:last-child { border-bottom: 0; }
.ms-hr-p-av {
  width: 108px; height: 108px; border-radius: 50%; border: 5px solid var(--ink);
  display: grid; place-items: center;
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 46px; color: #fff;
  box-shadow: 4px 4px 0 var(--ink);
}
.ms-hr-p-who {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 64px;
  color: var(--ink); line-height: 1;
}
.ms-hr-p-who span {
  display: block; font-family: 'Patrick Hand', cursive; font-size: 38px; color: var(--ink-2);
  letter-spacing: .02em; margin-top: 6px;
}
.ms-hr-p-ic { font-size: 70px; line-height: 1; }

/* Notebook countdown — taller for portrait; ruled paper full bleed */
.ms-hr-p-countdown {
  position: relative; height: 100%;
  background: #fdfaf0;
  border: 6px solid var(--ink); border-left-width: 30px;
  border-left-color: var(--crayon-r);
  box-shadow: 14px 14px 0 var(--ink);
  padding: 36px 48px 36px 70px;
  overflow: hidden;
  transform: rotate(.8deg);
}
.ms-hr-p-countdown::before {
  content: ''; position: absolute; inset: 0;
  background-image: repeating-linear-gradient(180deg,
    transparent 0 64px, rgba(59,109,191,.18) 64px 66px);
  pointer-events: none;
}
.ms-hr-p-countdown::after {
  content: ''; position: absolute; left: 8px; top: 0; bottom: 0; width: 18px;
  background:
    radial-gradient(circle, var(--ink) 0 5px, transparent 6px) 0 30px / 18px 70px;
  pointer-events: none;
}
.ms-hr-p-cd-ey {
  position: relative; z-index: 2;
  font-family: 'Patrick Hand', cursive; font-size: 40px;
  color: var(--ink-2); letter-spacing: .14em; text-transform: uppercase;
}
.ms-hr-p-cd-ey b { color: var(--crayon-r); font-weight: 400; }
.ms-hr-p-cd-row {
  position: relative; z-index: 2;
  display: grid; grid-template-columns: auto 1fr; gap: 36px; align-items: center; margin-top: 12px;
}
.ms-hr-p-cd-num {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 280px; line-height: .9; color: var(--crayon-r); letter-spacing: -.04em;
  text-shadow: 7px 7px 0 var(--ink);
}
.ms-hr-p-cd-meta {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 60px; line-height: 1.1; color: var(--ink);
}
.ms-hr-p-cd-meta span {
  display: block; font-family: 'Patrick Hand', cursive; font-size: 38px; color: var(--ink-2);
  margin-top: 8px;
}
.ms-hr-p-dashes {
  position: relative; z-index: 2;
  margin-top: 26px;
  display: flex; gap: 10px; align-items: center;
}
.ms-hr-p-dash {
  flex: 1; height: 18px; background: var(--crayon-g); border-radius: 9px;
  box-shadow: 3px 3px 0 rgba(0,0,0,.18);
}
.ms-hr-p-dash-empty { background: rgba(31,34,48,.12); box-shadow: none; }

/* ─── AGENDA (y=2096, h=1080) — corkboard, 2×4 grid w/ NOW span ── */
.ms-hr-p-agenda {
  position: absolute; top: 2096px; left: 64px; right: 64px; height: 1080px;
  background: var(--cork);
  background-image:
    radial-gradient(rgba(74, 39, 13, .35) 1.5px, transparent 1.7px),
    radial-gradient(rgba(74, 39, 13, .25) 1px,   transparent 1.1px),
    radial-gradient(rgba(255, 255, 255, .14) 1.2px, transparent 1.3px);
  background-size: 20px 20px, 10px 10px, 28px 28px;
  background-position: 0 0, 4px 6px, 8px 12px;
  border: 14px solid var(--cork-d);
  box-shadow:
    16px 16px 0 rgba(0,0,0,.25),
    inset 0 0 0 5px var(--cork-2),
    inset 0 0 90px rgba(74,39,13,.30);
  padding: 32px 36px 32px;
  z-index: 2;
  overflow: hidden;
}
.ms-hr-p-ag-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  padding: 0 8px 18px;
  margin-bottom: 16px;
  border-bottom: 5px dashed rgba(74,39,13,.55);
}
.ms-hr-p-ag-title {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 110px; line-height: 1; margin: 0; color: #fff;
  letter-spacing: -.02em;
  text-shadow: 6px 6px 0 var(--cork-d);
}
.ms-hr-p-ag-day {
  font-family: 'Patrick Hand', cursive; font-size: 46px; color: #fffbe9;
  letter-spacing: .12em; text-transform: uppercase;
}
.ms-hr-p-ag-day b {
  color: var(--bus); font-weight: 400;
  background: var(--ink); padding: 4px 18px; border-radius: 8px;
  margin: 0 8px;
}

/* Custom grid: NOW spans 2 cols on row 1; rest 2-up in 3 rows. */
.ms-hr-p-ag-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 280px 190px 190px 190px;
  gap: 20px 22px;
  padding: 8px 8px 0;
}
.ms-hr-p-card {
  position: relative;
  background: #fffbeb;
  padding: 22px 24px 18px;
  box-shadow: 6px 6px 0 rgba(0,0,0,.22);
  display: flex; flex-direction: column; gap: 8px;
  background-image: linear-gradient(180deg,
    transparent 0 70px, var(--crayon-r) 70px 73px,
    transparent 73px 100%);
  overflow: hidden;
}
.ms-hr-p-card:nth-child(1) { transform: rotate(-1.5deg); }   /* NOW */
.ms-hr-p-card:nth-child(2) { transform: rotate( 1.2deg); }
.ms-hr-p-card:nth-child(3) { transform: rotate(-1deg); }
.ms-hr-p-card:nth-child(4) { transform: rotate( 1.4deg); }
.ms-hr-p-card:nth-child(5) { transform: rotate(-1.2deg); }
.ms-hr-p-card:nth-child(6) { transform: rotate( .9deg); }
.ms-hr-p-card:nth-child(7) { transform: rotate(-1.6deg); }
/* push pin */
.ms-hr-p-card::before {
  content: ''; position: absolute; top: -18px; left: 50%; transform: translateX(-50%);
  width: 38px; height: 38px; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, var(--pin) 0 35%, #aa3024 50%, #6b1d12 80%);
  box-shadow: 4px 5px 8px rgba(0,0,0,.4), inset 0 -3px 0 rgba(0,0,0,.3);
  z-index: 3;
}
.ms-hr-p-card-top {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-top: 10px;
  border-bottom: 3px dotted var(--ink-2); padding-bottom: 8px;
}
.ms-hr-p-card-p {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 72px; line-height: 1; color: var(--crayon-b);
  letter-spacing: -.01em;
}
.ms-hr-p-card-t {
  font-family: 'Patrick Hand', cursive; font-size: 38px; color: var(--ink-2);
  letter-spacing: .06em;
}
.ms-hr-p-card-c {
  font-family: 'Figtree', system-ui, sans-serif; font-weight: 800; font-size: 56px; color: var(--ink);
  line-height: 1.05; letter-spacing: -.005em; margin-top: 12px;
}
.ms-hr-p-card-r {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 44px; color: var(--ink-2);
  margin-top: auto; padding-top: 10px;
  line-height: 1.1;
}
.ms-hr-p-card-r b { color: var(--crayon-r); font-weight: 600; }

/* NOW card — spans full width, scaled up, washi-tape banner */
.ms-hr-p-card.ms-hr-p-now {
  grid-column: 1 / -1;
  background: #fffac4;
  transform: rotate(-1.2deg);
  box-shadow: 12px 12px 0 rgba(0,0,0,.35);
  z-index: 4;
  padding: 28px 36px 24px;
  flex-direction: row; align-items: stretch; gap: 32px;
  background-image: linear-gradient(180deg,
    transparent 0 84px, var(--crayon-r) 84px 88px,
    transparent 88px 100%);
}
.ms-hr-p-card.ms-hr-p-now::before {
  background: radial-gradient(circle at 35% 35%, var(--crayon-y) 0 35%, var(--bus-d) 50%, #6b4e0a 80%);
}
.ms-hr-p-card.ms-hr-p-now::after {
  content: 'NOW'; position: absolute; top: 18px; right: -18px;
  background: var(--crayon-r); color: #fff;
  font-family: 'Patrick Hand', cursive; font-size: 36px;
  letter-spacing: .26em; text-transform: uppercase;
  padding: 8px 22px; transform: rotate(8deg);
  box-shadow: 4px 4px 0 rgba(0,0,0,.3);
  border: 4px solid var(--ink);
}
.ms-hr-p-now-left {
  flex: 0 0 30%; display: flex; flex-direction: column; justify-content: center;
}
.ms-hr-p-now-right {
  flex: 1; display: flex; flex-direction: column; justify-content: center;
}
.ms-hr-p-card.ms-hr-p-now .ms-hr-p-card-top {
  border-bottom: 3px dotted var(--ink-2); padding-bottom: 12px; margin-top: 8px;
}
.ms-hr-p-card.ms-hr-p-now .ms-hr-p-card-p { font-size: 110px; }
.ms-hr-p-card.ms-hr-p-now .ms-hr-p-card-t { font-size: 50px; }
.ms-hr-p-card.ms-hr-p-now .ms-hr-p-card-c { font-size: 96px; line-height: 1; margin: 0 0 10px; }
.ms-hr-p-card.ms-hr-p-now .ms-hr-p-card-r { font-size: 56px; margin-top: 8px; padding-top: 0; }

.ms-hr-p-card.ms-hr-p-done { opacity: .55; background: #f1ead1; }
.ms-hr-p-card.ms-hr-p-done .ms-hr-p-card-c {
  text-decoration: line-through; text-decoration-thickness: 3px; text-decoration-color: var(--crayon-r);
}
.ms-hr-p-card.ms-hr-p-done::before {
  background: radial-gradient(circle at 35% 35%, #888 0 35%, #555 50%, #222 80%);
}

/* ─── LOWER (y=3196, h=480) — lunch · buses · clubs ──── */
.ms-hr-p-lower {
  position: absolute; top: 3196px; left: 64px; right: 64px; height: 480px;
  display: grid; grid-template-columns: 1fr 1.15fr 1fr; gap: 20px;
  z-index: 4;
  overflow: hidden;
}

/* Brown-paper lunch bag */
.ms-hr-p-lunchbag {
  position: relative;
  transform: rotate(-1deg);
  overflow: visible;
}
.ms-hr-p-bag {
  position: relative;
  background: var(--kraft);
  background-image:
    radial-gradient(rgba(0,0,0,.08) 1.2px, transparent 1.3px),
    linear-gradient(170deg, rgba(255,255,255,.08), transparent 60%),
    linear-gradient(20deg,  rgba(0,0,0,.08), transparent 50%);
  background-size: 20px 20px, auto, auto;
  border: 6px solid var(--kraft-d);
  box-shadow: 12px 12px 0 var(--ink);
  padding: 50px 44px 36px;
  height: 100%;
  overflow: hidden;
  /* curled top edge */
  clip-path: polygon(
    4% 4%, 8% 0%, 16% 4%, 24% 1%, 34% 5%, 44% 0%, 56% 4%, 66% 1%, 76% 5%, 86% 0%, 94% 4%, 100% 8%, 100% 100%, 0% 100%, 0% 8%
  );
}
.ms-hr-p-receipt {
  position: absolute; top: -10px; left: 50%; transform: translateX(-50%) rotate(2deg);
  background: #fffde7; border: 5px solid var(--ink);
  padding: 8px 26px;
  font-family: 'Patrick Hand', cursive; font-size: 32px;
  letter-spacing: .14em; text-transform: uppercase; color: var(--ink);
  box-shadow: 4px 4px 0 rgba(0,0,0,.2);
  z-index: 3;
  white-space: nowrap;
}
.ms-hr-p-bag-ey {
  font-family: 'Patrick Hand', cursive; font-size: 36px; letter-spacing: .14em; text-transform: uppercase;
  color: rgba(31,34,48,.78);
}
.ms-hr-p-entree {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 76px; line-height: .95; color: var(--ink); letter-spacing: -.02em;
  margin-top: 8px;
}
.ms-hr-p-sides {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 46px; line-height: 1.15;
  color: var(--ink); margin-top: 14px;
}
.ms-hr-p-tags {
  display: flex; gap: 12px; margin-top: 18px; flex-wrap: wrap;
}
.ms-hr-p-tag {
  font-family: 'Patrick Hand', cursive; font-size: 32px;
  padding: 6px 18px; border: 4px solid var(--ink);
  background: #fff; color: var(--ink);
  letter-spacing: .04em;
  transform: rotate(-1deg);
}
.ms-hr-p-tag-veg { background: #d6f0c6; }
.ms-hr-p-tag-gf  { background: #ffe4c1; }
.ms-hr-p-tag-df  { background: #d3def7; }

/* School-bus card */
.ms-hr-p-buses {
  background: linear-gradient(180deg, var(--bus) 0%, var(--bus-d) 100%);
  border: 7px solid var(--ink);
  box-shadow: 12px 12px 0 var(--ink);
  padding: 22px 28px 24px;
  display: flex; flex-direction: column; gap: 12px;
  position: relative;
  overflow: hidden;
}
.ms-hr-p-buses::before {
  content: ''; position: absolute; top: 8px; left: 8px; right: 8px; bottom: 8px;
  border: 4px dashed rgba(31,34,48,.35); pointer-events: none;
}
.ms-hr-p-bus-head {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 8px;
  border-bottom: 5px solid var(--ink);
}
.ms-hr-p-bus-t {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 72px; color: var(--ink); line-height: 1; letter-spacing: -.02em;
}
.ms-hr-p-bus-ey {
  font-family: 'Patrick Hand', cursive; font-size: 36px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--ink-2);
}
.ms-hr-p-bus-list {
  display: grid; gap: 8px; padding-top: 4px;
}
.ms-hr-p-bus {
  background: #fff; border: 5px solid var(--ink);
  padding: 10px 18px;
  display: grid; grid-template-columns: 90px 1fr auto; gap: 18px; align-items: center;
  box-shadow: 4px 4px 0 rgba(0,0,0,.25);
}
.ms-hr-p-bus-num {
  background: var(--ink); color: var(--bus); border: 4px solid var(--ink);
  width: 90px; height: 76px;
  display: grid; place-items: center;
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 56px; line-height: 1; letter-spacing: -.02em;
}
.ms-hr-p-bus-rt {
  font-family: 'Figtree', system-ui, sans-serif; font-weight: 800; font-size: 36px; color: var(--ink); line-height: 1.05;
}
.ms-hr-p-bus-sub {
  font-family: 'Patrick Hand', cursive; font-size: 28px; color: var(--ink-2);
  letter-spacing: .04em; margin-top: 4px;
}
.ms-hr-p-bus-st {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 38px;
  padding: 6px 18px; border: 4px solid var(--ink);
  line-height: 1; letter-spacing: .02em;
  transform: rotate(-2deg);
  box-shadow: 3px 3px 0 var(--ink);
  white-space: nowrap;
}
.ms-hr-p-bus-st.ms-hr-p-bus-on    { background: #d6f0c6; color: #2d6a1d; }
.ms-hr-p-bus-st.ms-hr-p-bus-late  { background: #ffd1c1; color: #b1380f; }
.ms-hr-p-bus-st.ms-hr-p-bus-sched { background: #d3def7; color: #233a7a; }

/* Manila folder for clubs */
.ms-hr-p-folder {
  position: relative;
  background: var(--kraft);
  border: 6px solid var(--kraft-d);
  box-shadow: 12px 12px 0 var(--ink);
  padding: 30px 36px 24px;
  transform: rotate(.8deg);
  background-image:
    radial-gradient(rgba(0,0,0,.06) 1.2px, transparent 1.3px);
  background-size: 24px 24px;
  overflow: hidden;
}
.ms-hr-p-folder::before {
  content: ''; position: absolute; top: -34px; left: 64px; width: 280px; height: 34px;
  background: var(--kraft); border: 6px solid var(--kraft-d); border-bottom: 0;
  border-radius: 10px 10px 0 0;
}
.ms-hr-p-folder::after {
  content: 'CLUBS'; position: absolute; top: -28px; left: 100px;
  font-family: 'Patrick Hand', cursive; font-size: 28px; letter-spacing: .14em; color: var(--ink);
  z-index: 2;
}
.ms-hr-p-clip {
  position: absolute; top: -8px; right: 70px; width: 60px; height: 96px;
  pointer-events: none;
  transform: rotate(15deg);
  filter: drop-shadow(2px 2px 2px rgba(0,0,0,.4));
  z-index: 3;
}
.ms-hr-p-clip::before, .ms-hr-p-clip::after {
  content: ''; position: absolute; left: 0; right: 0;
  border: 4px solid #b3b3bc; background: transparent;
}
.ms-hr-p-clip::before { top: 0; height: 60px; border-radius: 30px 30px 0 0; border-bottom: 0; }
.ms-hr-p-clip::after  { top: 16px; height: 48px; border-radius: 24px 24px 0 0; border-bottom: 0; left: 10px; right: 10px; }
.ms-hr-p-folder-ey {
  font-family: 'Patrick Hand', cursive; font-size: 32px; letter-spacing: .14em;
  text-transform: uppercase; color: rgba(31,34,48,.7);
}
.ms-hr-p-folder-title {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900; font-size: 60px;
  color: var(--ink); margin: 6px 0 14px; line-height: 1; letter-spacing: -.02em;
}
.ms-hr-p-folder-list { display: grid; gap: 6px; }
.ms-hr-p-folder-row {
  display: grid; grid-template-columns: 28px 1fr auto; gap: 18px; align-items: center;
  padding: 8px 0;
  border-bottom: 3px dotted rgba(31,34,48,.4);
}
.ms-hr-p-folder-row:last-child { border-bottom: 0; }
.ms-hr-p-folder-dot {
  width: 26px; height: 26px; border-radius: 50%;
  border: 4px solid var(--ink); box-shadow: 2px 2px 0 var(--ink);
}
.ms-hr-p-folder-n {
  font-family: 'Figtree', system-ui, sans-serif; font-weight: 800; font-size: 34px; color: var(--ink); line-height: 1.05;
}
.ms-hr-p-folder-n span {
  display: block; font-family: 'Patrick Hand', cursive; font-size: 28px;
  color: var(--ink-2); margin-top: 4px;
}
.ms-hr-p-folder-w {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 40px;
  color: var(--crayon-r); white-space: nowrap;
}

/* ─── TICKER (y=3696, h=84) — torn-paper banner with pins ─── */
.ms-hr-p-ticker {
  position: absolute; top: 3696px; left: 64px; right: 64px; height: 84px;
  background: var(--paper);
  border: 5px solid var(--ink);
  box-shadow: 8px 8px 0 var(--ink);
  display: grid; grid-template-columns: auto 1fr; align-items: stretch;
  z-index: 4;
  overflow: hidden;
  clip-path: polygon(
    0 8%, 2% 0, 4% 6%, 7% 0, 10% 5%, 13% 0, 16% 7%, 20% 0, 24% 5%, 28% 0, 32% 6%, 36% 0, 40% 5%, 44% 0, 48% 7%, 52% 0, 56% 5%, 60% 0, 64% 6%, 68% 0, 72% 5%, 76% 0, 80% 7%, 84% 0, 88% 5%, 92% 0, 96% 6%, 100% 0, 100% 92%, 96% 100%, 92% 95%, 88% 100%, 84% 94%, 80% 100%, 76% 93%, 72% 100%, 68% 95%, 64% 100%, 60% 94%, 56% 100%, 52% 93%, 48% 100%, 44% 95%, 40% 100%, 36% 94%, 32% 100%, 28% 93%, 24% 100%, 20% 95%, 16% 100%, 13% 94%, 10% 100%, 7% 95%, 4% 100%, 2% 94%, 0 100%
  );
}
.ms-hr-p-ticker-badge {
  background: var(--crayon-r); color: #fff;
  padding: 0 36px;
  display: flex; align-items: center; gap: 14px;
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900; font-size: 42px;
  letter-spacing: -.01em;
  border-right: 5px solid var(--ink);
}
.ms-hr-p-ticker-badge::before {
  content: ''; width: 24px; height: 24px;
  background: conic-gradient(var(--crayon-y) 0 33%, var(--crayon-b) 33% 66%, var(--chalk) 66% 100%);
  border: 3px solid #fff; border-radius: 50%;
}
.ms-hr-p-ticker-feed {
  overflow: hidden; display: flex; align-items: center;
  padding-left: 32px;
}
.ms-hr-p-ticker-msg {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 48px;
  color: var(--ink); white-space: nowrap; letter-spacing: .01em;
  animation: msHrPScroll 80s linear infinite;
}
.ms-hr-p-ticker-msg span { display: inline-block; padding-right: 80px; }
.ms-hr-p-ticker-msg span::after {
  content: '✶'; color: var(--crayon-r); margin-left: 60px; font-size: 36px;
}
.ms-hr-p-ticker-pin {
  position: absolute; top: 3680px; width: 38px; height: 38px; border-radius: 50%; z-index: 7;
  background: radial-gradient(circle at 35% 35%, var(--pin) 0 35%, #aa3024 50%, #6b1d12 80%);
  box-shadow: 4px 5px 8px rgba(0,0,0,.4), inset 0 -3px 0 rgba(0,0,0,.3);
}
.ms-hr-p-ticker-pin-l { left: 100px; }
.ms-hr-p-ticker-pin-r { right: 100px; }

@keyframes msHrPScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
`;
