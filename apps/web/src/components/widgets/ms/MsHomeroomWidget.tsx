"use client";

/**
 * MsHomeroomWidget — Middle-school lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-25 — matches scratch/design/homeroom-ms-v2.html.
 * Reviewed by user, ported via HsStage scale pattern. DO NOT
 * regress to vw/% units. Every pixel size must match the mockup.
 *
 * Scene metaphor: COZY CLASSROOM. A real homeroom is a chalkboard
 * above a corkboard above a row of cubbies, with a teacher's desk
 * in the corner and washi-taped flyers on the wall.
 *
 * Scene layout (panels arranged on a 3840×2160 stage):
 *   - hud         → schoolhouse badge (otter face) + day stamp + 3 tiles
 *   - hero        → slate chalkboard, hand-drawn welcome (top: 280px, h: 800px)
 *   - right       → birthdays polaroid + notebook countdown card
 *   - agenda      → corkboard with 7 pinned index cards (one "now", one "done")
 *   - lower       → brown-paper lunch bag + yellow bus locker row + manila clubs folder
 *   - ticker      → torn-paper banner pinned across bottom with two push-pins
 *
 * box-sizing: border-box on every panel that sets an explicit width is
 * load-bearing — the .hero panel (2440px wide with 80px horizontal
 * padding + 22px borders) and the right column (1232px wide) both rely
 * on it to land on their intended edge.
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsHomeroomConfig {
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

export const DEFAULTS: Required<MsHomeroomConfig> = {
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
 * caller passed an empty string. Mirrors the arcade widget's pattern of
 * "empty string → use default" — empty strings in the editor mean
 * "blank" but in the demo we want the demo copy.
 */
const pick = <K extends keyof Required<MsHomeroomConfig>>(
  cfg: MsHomeroomConfig,
  key: K,
): string => {
  const v = cfg[key];
  return (v === undefined || v === '' ? DEFAULTS[key] : v) as string;
};

export function MsHomeroomWidget({ config }: { config?: MsHomeroomConfig }) {
  const cfg = config || {};

  // Per-card metadata mirroring the HTML mockup. Card 0 is "done", Card 1 is
  // "now". Avatar background colors for shoutouts pre-baked. Bus status pill
  // class per row.
  const agendaState = ['done', 'now', '', '', '', '', ''] as const;
  const shoutoutAv = ['var(--crayon-p)', 'var(--crayon-b)', 'var(--crayon-g)'];
  const busStatusClass = ['on', 'late', 'sched'] as const;
  const clubDot = ['var(--crayon-b)', 'var(--crayon-p)', 'var(--crayon-g)'];
  // Countdown bar — first 5 filled, sixth onward empty (matches mockup).
  const countdownDashes = [false, false, false, false, false, true, true, true, true, true];

  return (
    <HsStage
      stageStyle={{
        background: '#f4ecd8',
        backgroundImage:
          'radial-gradient(ellipse 1800px 1100px at 50% 0%, rgba(244,169,61,.10), transparent 70%), radial-gradient(ellipse 1400px 900px at 100% 100%, rgba(59,109,191,.06), transparent 70%), radial-gradient(rgba(31,34,48,.04) 1.2px, transparent 1.2px)',
        backgroundSize: 'auto, auto, 28px 28px',
        fontFamily: "'Figtree', system-ui, sans-serif",
        color: '#1f2230',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Wood-grain wainscoting along the bottom (mockup paints this on
          .stage::before; we use a dedicated div so HsStage's own ::before
          is left untouched). */}
      <div className="ms-hr-wainscot" aria-hidden="true" />

      {/* ─── HUD ─────────────────────────────────────────── */}
      <header className="ms-hr-hud">
        <div className="ms-hr-brand" data-widget="school">
          <div className="ms-hr-badge" aria-hidden="true">
            <div className="ms-hr-face" />
            <div className="ms-hr-lvl" data-field="school.team" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'school.team')}
            </div>
          </div>
          <div className="ms-hr-info">
            <div className="ms-hr-eye">Welcome, Otters</div>
            <div className="ms-hr-name" data-field="school.name" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'school.name')}
            </div>
            <div className="ms-hr-sub">
              <span data-field="school.year" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.year')}</span>
              <span className="ms-hr-bullet" />
              <b data-field="school.house" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.house')}</b>
            </div>
          </div>
        </div>

        <div className="ms-hr-stamp" data-widget="day">
          <div className="ms-hr-stamp-lab" data-field="day.label" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'day.label')}
          </div>
          <div className="ms-hr-stamp-day">
            <span data-field="day.dow" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'day.dow')}</span>{' '}
            <b data-field="day.date" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'day.date')}</b>
          </div>
        </div>

        <div className="ms-hr-tiles">
          <div className="ms-hr-tile" data-widget="clock">
            <span className="ms-hr-tile-k" data-field="clock.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'clock.label')}
            </span>
            <span className="ms-hr-tile-v" data-field="clock.time" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'clock.time')}
            </span>
          </div>
          <div className="ms-hr-tile" data-widget="weather">
            <span className="ms-hr-tile-k" data-field="weather.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'weather.label')}
            </span>
            <span className="ms-hr-tile-v ms-hr-cool" data-field="weather.temp" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'weather.temp')}
            </span>
          </div>
          <div className="ms-hr-tile" data-widget="weather2">
            <span className="ms-hr-tile-k" data-field="weather2.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'weather2.label')}
            </span>
            <span className="ms-hr-tile-v ms-hr-sun" data-field="weather2.cond" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'weather2.cond')}
            </span>
          </div>
        </div>
      </header>

      {/* ─── HERO — chalkboard greeting ───────────────────── */}
      <section className="ms-hr-hero" data-widget="greeting">
        <div className="ms-hr-sun" aria-hidden="true">
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
        <div className="ms-hr-doodles" aria-hidden="true">
          <svg width="280" height="120" viewBox="0 0 280 120">
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

        <div className="ms-hr-greet-eye" data-field="greeting.eyebrow" style={{ whiteSpace: 'pre-wrap' }}>
          {pick(cfg, 'greeting.eyebrow')}
        </div>
        <h1 className="ms-hr-h1">
          <span data-field="greeting.h1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h1')}</span>
          {' — '}
          <em data-field="greeting.h2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h2')}</em>
        </h1>
        <p className="ms-hr-hero-sub" data-field="greeting.subtitle" style={{ whiteSpace: 'pre-wrap' }}>
          {pick(cfg, 'greeting.subtitle')}
        </p>
        <div className="ms-hr-pencils" data-widget="greeting.tags">
          <span className="ms-hr-pen">
            <span className="ms-hr-dot" />
            <span data-field="greeting.tag1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.tag1')}</span>
          </span>
          <span className="ms-hr-pen ms-hr-pen-b">
            <span className="ms-hr-dot" />
            <span data-field="greeting.tag2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.tag2')}</span>
          </span>
          <span className="ms-hr-pen ms-hr-pen-y">
            <span className="ms-hr-dot" />
            <span data-field="greeting.tag3" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.tag3')}</span>
          </span>
          <span className="ms-hr-pen ms-hr-pen-g">
            <span className="ms-hr-dot" />
            <span data-field="greeting.tag4" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.tag4')}</span>
          </span>
        </div>
      </section>

      {/* ─── RIGHT COLUMN ───────────────────────────────── */}
      <aside className="ms-hr-right">
        <div className="ms-hr-polaroid" data-widget="shoutouts">
          <div className="ms-hr-tape" aria-hidden="true" />
          <div className="ms-hr-pol-ey" data-field="shoutouts.label" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'shoutouts.label')}
          </div>
          <h3 className="ms-hr-pol-title" data-field="shoutouts.title" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'shoutouts.title')}
          </h3>
          <div className="ms-hr-lines">
            {([0, 1, 2] as const).map((i) => {
              const ic = i === 0 ? '🎂' : i === 1 ? '⭐' : '🔥';
              return (
                <div
                  className="ms-hr-line"
                  data-widget={`shoutouts.${i}`}
                  key={i}
                >
                  <span
                    className="ms-hr-av"
                    style={{ background: shoutoutAv[i], whiteSpace: 'pre-wrap' as const }}
                    data-field={`shoutouts.${i}.av`}>
                    {pick(cfg, `shoutouts.${i}.av` as keyof Required<MsHomeroomConfig>)}
                  </span>
                  <span className="ms-hr-who" data-field={`shoutouts.${i}.who`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `shoutouts.${i}.who` as keyof Required<MsHomeroomConfig>)}
                    <span data-field={`shoutouts.${i}.note`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `shoutouts.${i}.note` as keyof Required<MsHomeroomConfig>)}
                    </span>
                  </span>
                  <span className="ms-hr-ic">{ic}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ms-hr-countdown" data-widget="countdown">
          <div className="ms-hr-cd-ey">
            Days until{' '}
            <b data-field="countdown.label" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'countdown.label')}</b>
          </div>
          <div className="ms-hr-cd-row">
            <div className="ms-hr-cd-num" data-field="countdown.value" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'countdown.value')}
            </div>
            <div className="ms-hr-cd-meta" data-field="countdown.meta" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'countdown.meta')}
              <span data-field="countdown.sub" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'countdown.sub')}
              </span>
            </div>
          </div>
          <div className="ms-hr-dashes" aria-hidden="true">
            {countdownDashes.map((empty, i) => (
              <span
                key={i}
                className={`ms-hr-dash${empty ? ' ms-hr-dash-empty' : ''}`}
              />
            ))}
          </div>
        </div>
      </aside>

      {/* ─── AGENDA — corkboard with index cards ─────────── */}
      <section className="ms-hr-agenda" data-widget="agenda">
        <div className="ms-hr-ag-head">
          <h2 className="ms-hr-ag-title" data-field="agenda.title" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'agenda.title')}
          </h2>
          <div className="ms-hr-ag-day">
            <span data-field="agenda.day" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.day')}</span>{' '}
            <b data-field="agenda.letter" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.letter')}</b>{' '}
            <span data-field="agenda.dayName" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.dayName')}</span>
          </div>
        </div>
        <div className="ms-hr-ag-grid">
          {([0, 1, 2, 3, 4, 5, 6] as const).map((i) => {
            const state = agendaState[i];
            const cls = `ms-hr-card${state ? ` ms-hr-${state}` : ''}`;
            return (
              <div className={cls} data-widget={`agenda.${i}`} key={i}>
                <div className="ms-hr-card-top">
                  <span className="ms-hr-card-p" data-field={`agenda.${i}.p`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `agenda.${i}.p` as keyof Required<MsHomeroomConfig>)}
                  </span>
                  <span className="ms-hr-card-t" data-field={`agenda.${i}.time`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `agenda.${i}.time` as keyof Required<MsHomeroomConfig>)}
                  </span>
                </div>
                <div className="ms-hr-card-c" data-field={`agenda.${i}.c`} style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, `agenda.${i}.c` as keyof Required<MsHomeroomConfig>)}
                </div>
                <div className="ms-hr-card-r">
                  <b data-field={`agenda.${i}.r`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `agenda.${i}.r` as keyof Required<MsHomeroomConfig>)}
                  </b>
                  <br />
                  <span data-field={`agenda.${i}.teacher`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `agenda.${i}.teacher` as keyof Required<MsHomeroomConfig>)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── BOTTOM ROW — lunch · buses · clubs ─────────── */}
      <section className="ms-hr-lower">
        {/* LUNCH — brown paper bag */}
        <div className="ms-hr-lunchbag" data-widget="lunch">
          <div className="ms-hr-bag">
            <div className="ms-hr-receipt" data-field="lunch.receipt" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'lunch.receipt')}
            </div>
            <div className="ms-hr-bag-ey" data-field="lunch.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'lunch.label')}
            </div>
            <div className="ms-hr-entree" data-field="lunch.entree" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'lunch.entree')}
            </div>
            <div className="ms-hr-sides" data-field="lunch.sides" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'lunch.sides')}
            </div>
            <div className="ms-hr-tags">
              <span className="ms-hr-tag ms-hr-tag-veg" data-field="lunch.tag1" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'lunch.tag1')}
              </span>
              <span className="ms-hr-tag ms-hr-tag-gf" data-field="lunch.tag2" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'lunch.tag2')}
              </span>
              <span className="ms-hr-tag ms-hr-tag-df" data-field="lunch.tag3" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'lunch.tag3')}
              </span>
            </div>
          </div>
        </div>

        {/* BUSES — yellow bus card */}
        <div className="ms-hr-buses" data-widget="buses">
          <div className="ms-hr-bus-head">
            <span className="ms-hr-bus-t" data-field="buses.title" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'buses.title')}
            </span>
            <span className="ms-hr-bus-ey" data-field="buses.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'buses.label')}
            </span>
          </div>
          <div className="ms-hr-bus-list">
            {([0, 1, 2] as const).map((i) => {
              const stCls = busStatusClass[i];
              return (
                <div className="ms-hr-bus" data-widget={`buses.${i}`} key={i}>
                  <span className="ms-hr-bus-num" data-field={`buses.${i}.num`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `buses.${i}.num` as keyof Required<MsHomeroomConfig>)}
                  </span>
                  <div className="ms-hr-bus-info">
                    <div className="ms-hr-bus-rt" data-field={`buses.${i}.rt`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `buses.${i}.rt` as keyof Required<MsHomeroomConfig>)}
                    </div>
                    <div className="ms-hr-bus-sub" data-field={`buses.${i}.sub`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `buses.${i}.sub` as keyof Required<MsHomeroomConfig>)}
                    </div>
                  </div>
                  <span
                    className={`ms-hr-bus-st ms-hr-bus-${stCls}`}
                    data-field={`buses.${i}.st`}
                   style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `buses.${i}.st` as keyof Required<MsHomeroomConfig>)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* CLUBS — manila folder */}
        <div className="ms-hr-folder" data-widget="clubs">
          <span className="ms-hr-clip" aria-hidden="true" />
          <div className="ms-hr-folder-ey" data-field="clubs.label" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'clubs.label')}
          </div>
          <h3 className="ms-hr-folder-title" data-field="clubs.title" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'clubs.title')}
          </h3>
          <div className="ms-hr-folder-list">
            {([0, 1, 2] as const).map((i) => (
              <div className="ms-hr-folder-row" data-widget={`clubs.${i}`} key={i}>
                <span
                  className="ms-hr-folder-dot"
                  style={{ background: clubDot[i] }}
                />
                <span className="ms-hr-folder-n" data-field={`clubs.${i}.n`} style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, `clubs.${i}.n` as keyof Required<MsHomeroomConfig>)}
                  <span data-field={`clubs.${i}.m`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `clubs.${i}.m` as keyof Required<MsHomeroomConfig>)}
                  </span>
                </span>
                <span className="ms-hr-folder-w" data-field={`clubs.${i}.w`} style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, `clubs.${i}.w` as keyof Required<MsHomeroomConfig>)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── TICKER — torn-paper banner ───────────────────── */}
      <div className="ms-hr-ticker-pin ms-hr-ticker-pin-l" aria-hidden="true" />
      <div className="ms-hr-ticker-pin ms-hr-ticker-pin-r" aria-hidden="true" />
      <div className="ms-hr-ticker" data-widget="announcement">
        <div className="ms-hr-ticker-badge" data-field="announcement.badge" style={{ whiteSpace: 'pre-wrap' }}>
          {pick(cfg, 'announcement.badge')}
        </div>
        <div className="ms-hr-ticker-feed">
          <div className="ms-hr-ticker-msg">
            <span data-field="announcement.message" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'announcement.message')}
            </span>
            <span aria-hidden="true">{pick(cfg, 'announcement.message')}</span>
          </div>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — every pixel value matches scratch/design/homeroom-ms-v2.html. */
const CSS = `
/* Universal border-box so explicit widths mean edge-to-edge (matches mockup). */
.ms-hr-hud, .ms-hr-hud *, .ms-hr-hud *::before, .ms-hr-hud *::after,
.ms-hr-hero, .ms-hr-hero *, .ms-hr-hero *::before, .ms-hr-hero *::after,
.ms-hr-right, .ms-hr-right *, .ms-hr-right *::before, .ms-hr-right *::after,
.ms-hr-agenda, .ms-hr-agenda *, .ms-hr-agenda *::before, .ms-hr-agenda *::after,
.ms-hr-lower, .ms-hr-lower *, .ms-hr-lower *::before, .ms-hr-lower *::after,
.ms-hr-ticker, .ms-hr-ticker *, .ms-hr-ticker *::before, .ms-hr-ticker *::after,
.ms-hr-wainscot, .ms-hr-ticker-pin {
  box-sizing: border-box;
}

/* Theme tokens scoped to the widget (matches :root in mockup). */
.ms-hr-hud, .ms-hr-hero, .ms-hr-right, .ms-hr-agenda, .ms-hr-lower, .ms-hr-ticker, .ms-hr-wainscot {
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
.ms-hr-wainscot {
  position: absolute; left: 0; right: 0; bottom: 0; height: 60px; z-index: 0; pointer-events: none;
  background:
    repeating-linear-gradient(90deg,
      #8a5a2c 0 280px, #7d4f24 280px 320px, #8a5a2c 320px 600px, #6f4520 600px 640px),
    linear-gradient(180deg, #6f4520 0%, #8a5a2c 25%, #6f4520 100%);
  border-top: 5px solid #4a2e15;
  box-shadow: inset 0 6px 0 rgba(0,0,0,.18);
}

/* ─── TOP HUD ─────────────────────────────────────────── */
.ms-hr-hud {
  position: absolute; top: 56px; left: 64px; right: 64px; height: 204px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 56px; align-items: center;
  z-index: 4;
}

.ms-hr-brand { display: flex; align-items: center; gap: 36px; }
.ms-hr-badge {
  width: 200px; height: 200px; flex-shrink: 0;
  background: var(--slate);
  border: 8px solid #6b4621;
  box-shadow: 8px 8px 0 rgba(0,0,0,.18), inset 0 0 0 4px var(--slate-2);
  position: relative;
  transform: rotate(-2deg);
}
.ms-hr-badge::before {
  content: ''; position: absolute; inset: 0;
  background-image:
    radial-gradient(rgba(247,243,230,.10) 1.6px, transparent 1.7px),
    radial-gradient(rgba(247,243,230,.06) 1px,   transparent 1.1px);
  background-size: 22px 22px, 11px 11px;
  background-position: 0 0, 5px 7px;
  mix-blend-mode: screen;
}
.ms-hr-face { position: absolute; inset: 24px; display: grid; place-items: center; }
.ms-hr-face::before {
  content: ''; width: 130px; height: 110px; border-radius: 60% 60% 50% 50%;
  border: 4px solid var(--chalk);
  box-shadow: 0 0 0 1px rgba(247,243,230,.35);
  background:
    radial-gradient(circle at 30% 38%, var(--chalk) 0 6px, transparent 7px),
    radial-gradient(circle at 70% 38%, var(--chalk) 0 6px, transparent 7px),
    radial-gradient(circle at 50% 60%, var(--chalk) 0 4px, transparent 5px);
}
.ms-hr-face::after {
  content: ''; position: absolute; top: 8px; left: 50%;
  width: 150px; height: 30px; transform: translateX(-50%);
  background:
    radial-gradient(circle at 18% 50%, var(--chalk) 0 7px, transparent 8px),
    radial-gradient(circle at 82% 50%, var(--chalk) 0 7px, transparent 8px);
}
.ms-hr-lvl {
  position: absolute; bottom: -16px; left: 50%; transform: translateX(-50%) rotate(-3deg);
  background: var(--bus); color: var(--ink);
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 32px;
  padding: 4px 22px; border: 4px solid var(--ink);
  box-shadow: 4px 4px 0 rgba(0,0,0,.25);
  letter-spacing: .02em; white-space: nowrap;
}

.ms-hr-info .ms-hr-eye {
  font-family: 'Patrick Hand', cursive; font-size: 36px; color: var(--crayon-r);
  letter-spacing: .14em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 16px;
}
.ms-hr-info .ms-hr-eye::before {
  content: ''; width: 56px; height: 4px; background: var(--crayon-r); border-radius: 2px;
}
.ms-hr-info .ms-hr-name {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 124px; line-height: .92; color: var(--ink); letter-spacing: -.025em; margin-top: 6px;
}
.ms-hr-info .ms-hr-sub {
  font-family: 'Patrick Hand', cursive; font-size: 38px; color: var(--ink-2);
  letter-spacing: .04em; margin-top: 14px;
}
.ms-hr-info .ms-hr-sub b { color: var(--crayon-r); font-weight: 700; }
.ms-hr-info .ms-hr-bullet {
  display: inline-block; width: 12px; height: 12px; border-radius: 50%;
  background: var(--pencil); margin: 0 18px; vertical-align: middle;
}

/* Hall-pass day stamp */
.ms-hr-stamp {
  justify-self: center; text-align: center;
  transform: rotate(-3deg);
  background: var(--paper-2); border: 5px solid var(--ink);
  padding: 18px 56px 22px;
  box-shadow: 8px 8px 0 var(--ink);
  position: relative;
}
.ms-hr-stamp::before, .ms-hr-stamp::after {
  content: ''; position: absolute; top: 50%; width: 26px; height: 26px;
  background: var(--ink); border-radius: 50%;
  transform: translateY(-50%);
}
.ms-hr-stamp::before { left: -16px; }
.ms-hr-stamp::after  { right: -16px; }
.ms-hr-stamp-lab {
  font-family: 'Patrick Hand', cursive; font-size: 32px; letter-spacing: .22em;
  text-transform: uppercase; color: var(--ink-2);
}
.ms-hr-stamp-day {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 88px; line-height: 1; color: var(--ink); letter-spacing: -.02em;
  margin-top: 4px;
}
.ms-hr-stamp-day b { color: var(--crayon-r); font-weight: 900; }

.ms-hr-tiles { display: flex; gap: 18px; align-items: stretch; }
.ms-hr-tile {
  width: 200px; padding: 22px 24px;
  background: #fff; border: 5px solid var(--ink);
  box-shadow: 7px 7px 0 var(--ink);
  display: flex; flex-direction: column; gap: 4px;
  position: relative;
}
.ms-hr-tile:nth-child(1) { transform: rotate(-1.5deg); }
.ms-hr-tile:nth-child(2) { transform: rotate(1deg); }
.ms-hr-tile:nth-child(3) { transform: rotate(-.5deg); }
.ms-hr-tile-k {
  font-family: 'Patrick Hand', cursive; font-size: 28px;
  letter-spacing: .14em; text-transform: uppercase; color: var(--ink-2);
}
.ms-hr-tile-v {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 80px; line-height: 1; color: var(--ink); letter-spacing: -.02em;
}
.ms-hr-tile-v.ms-hr-cool { color: var(--crayon-b); }
.ms-hr-tile-v.ms-hr-sun  { color: var(--pencil); font-size: 64px; }

/* ─── HERO — chalkboard with hand-drawn welcome ──────── */
.ms-hr-hero {
  position: absolute; top: 280px; left: 64px; width: 2440px; height: 800px;
  background: var(--slate);
  background-image:
    radial-gradient(ellipse 800px 200px at 70% 30%, rgba(247,243,230,.07), transparent 65%),
    radial-gradient(ellipse 600px 200px at 20% 78%, rgba(247,243,230,.05), transparent 65%),
    radial-gradient(rgba(247,243,230,.05) 1.5px, transparent 1.6px),
    radial-gradient(rgba(247,243,230,.03) 1px,   transparent 1.1px);
  background-size: auto, auto, 24px 24px, 11px 11px;
  background-position: 0 0, 0 0, 0 0, 6px 8px;
  border: 22px solid #8a5a2c;
  border-image: linear-gradient(135deg, #a06a35 0%, #6b4621 50%, #a06a35 100%) 1;
  box-shadow:
    8px 8px 0 rgba(0,0,0,.25),
    inset 0 0 0 6px var(--slate-2),
    inset 0 0 100px rgba(0,0,0,.35);
  padding: 56px 80px 48px;
  z-index: 2;
  overflow: hidden;
}
.ms-hr-sun {
  position: absolute; top: 50px; right: 90px; width: 220px; height: 220px;
  pointer-events: none; opacity: .92;
}
.ms-hr-sun svg { width: 100%; height: 100%; }
.ms-hr-doodles {
  position: absolute; bottom: 24px; left: 60px; pointer-events: none; opacity: .85;
}

.ms-hr-greet-eye {
  font-family: 'Patrick Hand', cursive; font-size: 44px;
  color: var(--crayon-y); letter-spacing: .14em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 18px;
  margin-bottom: 18px;
}
.ms-hr-greet-eye::before { content: '✶'; font-size: 56px; color: var(--crayon-y); }
.ms-hr-h1 {
  font-family: 'Kalam', cursive; font-weight: 700;
  font-size: 256px; line-height: .95;
  color: var(--chalk); margin: 0;
  letter-spacing: -.005em;
  text-shadow: 0 4px 0 rgba(0,0,0,.25), 0 0 60px rgba(247,243,230,.06);
  position: relative;
}
.ms-hr-h1 em {
  font-family: 'Caveat', cursive; font-style: italic; font-weight: 700;
  color: var(--pencil);
}
.ms-hr-hero-sub {
  font-family: 'Patrick Hand', cursive; font-size: 50px; line-height: 1.32;
  color: var(--chalk-d); margin-top: 40px; max-width: 2050px;
  letter-spacing: .005em;
}
.ms-hr-hero-sub b {
  color: var(--crayon-y); font-weight: 400;
  background: linear-gradient(180deg, transparent 65%, rgba(244,207,61,.22) 65% 92%, transparent 92%);
  padding: 0 6px;
}
.ms-hr-pencils {
  margin-top: 32px;
  display: flex; gap: 18px; flex-wrap: wrap;
}
.ms-hr-pen {
  display: inline-flex; align-items: center; gap: 16px;
  padding: 12px 26px;
  background: rgba(247,243,230,.08); border: 3px dashed var(--chalk-d);
  border-radius: 999px;
  font-family: 'Patrick Hand', cursive; font-size: 36px;
  color: var(--chalk); letter-spacing: .02em;
}
.ms-hr-pen .ms-hr-dot {
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--crayon-r); border: 3px solid var(--chalk);
  box-shadow: 2px 2px 0 rgba(0,0,0,.4);
  flex-shrink: 0;
}
.ms-hr-pen-b .ms-hr-dot { background: var(--crayon-b); }
.ms-hr-pen-g .ms-hr-dot { background: var(--crayon-g); }
.ms-hr-pen-y .ms-hr-dot { background: var(--crayon-y); }

/* ─── RIGHT COLUMN — polaroid + countdown ────────────── */
.ms-hr-right {
  position: absolute; top: 280px; right: 64px; width: 1232px; height: 800px;
  display: grid; grid-template-rows: 470px 310px; gap: 20px;
  z-index: 3;
}

.ms-hr-polaroid {
  position: relative;
  background: #fff; border: 5px solid var(--ink); padding: 24px 28px 18px;
  box-shadow: 12px 12px 0 var(--ink);
  transform: rotate(-2deg);
  overflow: hidden;
}
.ms-hr-tape {
  position: absolute; top: -16px; left: 28%; width: 220px; height: 50px;
  background: rgba(255, 197, 76, .85);
  transform: rotate(-3deg);
  box-shadow: 0 4px 12px rgba(0,0,0,.18);
  background-image: repeating-linear-gradient(90deg, rgba(0,0,0,.04) 0 2px, transparent 2px 8px);
}
.ms-hr-pol-ey {
  font-family: 'Patrick Hand', cursive; font-size: 32px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--crayon-r); margin-bottom: 8px;
}
.ms-hr-pol-title {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 70px; line-height: 1; color: var(--ink); letter-spacing: -.02em; margin: 0 0 16px;
}
.ms-hr-lines { display: grid; gap: 10px; }
.ms-hr-line {
  display: grid; grid-template-columns: 88px 1fr auto; gap: 18px; align-items: center;
  padding: 8px 0;
  border-bottom: 2px dashed rgba(31,34,48,.18);
}
.ms-hr-line:last-child { border-bottom: 0; }
.ms-hr-av {
  width: 84px; height: 84px; border-radius: 50%; border: 4px solid var(--ink);
  display: grid; place-items: center;
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900; font-size: 36px; color: #fff;
  box-shadow: 3px 3px 0 var(--ink);
}
.ms-hr-who {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 52px;
  color: var(--ink); line-height: 1;
}
.ms-hr-who span {
  display: block; font-family: 'Patrick Hand', cursive; font-size: 30px; color: var(--ink-2);
  letter-spacing: .02em; margin-top: 4px;
}
.ms-hr-ic { font-size: 56px; line-height: 1; }

/* Notebook countdown */
.ms-hr-countdown {
  position: relative;
  background: #fdfaf0;
  border: 5px solid var(--ink); border-left-width: 24px;
  border-left-color: var(--crayon-r);
  box-shadow: 12px 12px 0 var(--ink);
  padding: 28px 40px 28px 60px;
  overflow: hidden;
  transform: rotate(-1deg);
}
.ms-hr-countdown::before {
  content: ''; position: absolute; inset: 0;
  background-image: repeating-linear-gradient(180deg,
    transparent 0 56px, rgba(59,109,191,.18) 56px 58px);
  pointer-events: none;
}
.ms-hr-countdown::after {
  content: ''; position: absolute; left: 6px; top: 0; bottom: 0; width: 16px;
  background:
    radial-gradient(circle, var(--ink) 0 5px, transparent 6px) 0 22px / 16px 60px;
  pointer-events: none;
}
.ms-hr-cd-ey {
  position: relative; z-index: 2;
  font-family: 'Patrick Hand', cursive; font-size: 32px;
  color: var(--ink-2); letter-spacing: .14em; text-transform: uppercase;
}
.ms-hr-cd-ey b { color: var(--crayon-r); font-weight: 400; }
.ms-hr-cd-row {
  position: relative; z-index: 2;
  display: grid; grid-template-columns: auto 1fr; gap: 28px; align-items: center; margin-top: 4px;
}
.ms-hr-cd-num {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 200px; line-height: .9; color: var(--crayon-r); letter-spacing: -.04em;
  text-shadow: 5px 5px 0 var(--ink);
}
.ms-hr-cd-meta {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 50px; line-height: 1.1; color: var(--ink);
}
.ms-hr-cd-meta span {
  display: block; font-family: 'Patrick Hand', cursive; font-size: 30px; color: var(--ink-2);
  margin-top: 6px;
}
.ms-hr-dashes {
  position: relative; z-index: 2;
  margin-top: 12px;
  display: flex; gap: 8px; align-items: center;
}
.ms-hr-dash {
  flex: 1; height: 12px; background: var(--crayon-g); border-radius: 6px;
  box-shadow: 2px 2px 0 rgba(0,0,0,.18);
}
.ms-hr-dash-empty { background: rgba(31,34,48,.12); box-shadow: none; }

/* ─── AGENDA — corkboard with pinned index cards ─────── */
.ms-hr-agenda {
  position: absolute; top: 1100px; left: 64px; right: 64px; height: 540px;
  background: var(--cork);
  background-image:
    radial-gradient(rgba(74, 39, 13, .35) 1.5px, transparent 1.7px),
    radial-gradient(rgba(74, 39, 13, .25) 1px,   transparent 1.1px),
    radial-gradient(rgba(255, 255, 255, .14) 1.2px, transparent 1.3px);
  background-size: 18px 18px, 9px 9px, 26px 26px;
  background-position: 0 0, 4px 6px, 8px 12px;
  border: 12px solid var(--cork-d);
  box-shadow:
    14px 14px 0 rgba(0,0,0,.25),
    inset 0 0 0 4px var(--cork-2),
    inset 0 0 80px rgba(74,39,13,.30);
  padding: 24px 28px 24px;
  z-index: 2;
}
.ms-hr-ag-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  padding: 0 8px 14px;
  margin-bottom: 14px;
  border-bottom: 4px dashed rgba(74,39,13,.55);
}
.ms-hr-ag-title {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 80px; line-height: 1; margin: 0; color: #fff;
  letter-spacing: -.02em;
  text-shadow: 5px 5px 0 var(--cork-d);
}
.ms-hr-ag-day {
  font-family: 'Patrick Hand', cursive; font-size: 36px; color: #fffbe9;
  letter-spacing: .12em; text-transform: uppercase;
}
.ms-hr-ag-day b {
  color: var(--bus); font-weight: 400;
  background: var(--ink); padding: 3px 14px; border-radius: 6px;
  margin: 0 6px;
}
/* 7 cards in a single row */
.ms-hr-ag-grid {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 16px;
  padding: 22px 8px 0;
}
.ms-hr-card {
  position: relative;
  background: #fffbeb;
  padding: 22px 18px 18px;
  box-shadow: 5px 5px 0 rgba(0,0,0,.22);
  min-height: 320px;
  display: flex; flex-direction: column; gap: 6px;
  background-image: linear-gradient(180deg,
    transparent 0 60px, var(--crayon-r) 60px 62px,
    transparent 62px 100%);
}
.ms-hr-card:nth-child(1) { transform: rotate(-2deg); }
.ms-hr-card:nth-child(2) { transform: rotate(1.2deg); }
.ms-hr-card:nth-child(3) { transform: rotate(-.8deg); }
.ms-hr-card:nth-child(4) { transform: rotate(2deg); }
.ms-hr-card:nth-child(5) { transform: rotate(-1deg); }
.ms-hr-card:nth-child(6) { transform: rotate(1.4deg); }
.ms-hr-card:nth-child(7) { transform: rotate(-1.6deg); }
/* push pin */
.ms-hr-card::before {
  content: ''; position: absolute; top: -16px; left: 50%; transform: translateX(-50%);
  width: 32px; height: 32px; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, var(--pin) 0 35%, #aa3024 50%, #6b1d12 80%);
  box-shadow: 3px 4px 6px rgba(0,0,0,.4), inset 0 -3px 0 rgba(0,0,0,.3);
  z-index: 3;
}
.ms-hr-card-top {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-top: 8px;
  border-bottom: 2px dotted var(--ink-2); padding-bottom: 6px;
}
.ms-hr-card-p {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 50px; line-height: 1; color: var(--crayon-b);
  letter-spacing: -.01em;
}
.ms-hr-card-t {
  font-family: 'Patrick Hand', cursive; font-size: 26px; color: var(--ink-2);
  letter-spacing: .06em;
}
.ms-hr-card-c {
  font-family: 'Figtree', system-ui, sans-serif; font-weight: 800; font-size: 36px; color: var(--ink);
  line-height: 1.05; letter-spacing: -.005em; margin-top: 8px;
}
.ms-hr-card-r {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 32px; color: var(--ink-2);
  margin-top: auto; padding-top: 10px;
  line-height: 1.1;
}
.ms-hr-card-r b { color: var(--crayon-r); font-weight: 600; }
/* "NOW" card — yellow washi tape across, lightly highlighted */
.ms-hr-card.ms-hr-now {
  background: #fffac4;
  transform: rotate(-2.5deg) scale(1.06);
  box-shadow: 9px 9px 0 rgba(0,0,0,.35);
  z-index: 4;
}
.ms-hr-card.ms-hr-now::before {
  background: radial-gradient(circle at 35% 35%, var(--crayon-y) 0 35%, var(--bus-d) 50%, #6b4e0a 80%);
}
.ms-hr-card.ms-hr-now::after {
  content: 'NOW'; position: absolute; top: 12px; right: -14px;
  background: var(--crayon-r); color: #fff;
  font-family: 'Patrick Hand', cursive; font-size: 26px;
  letter-spacing: .26em; text-transform: uppercase;
  padding: 6px 16px; transform: rotate(8deg);
  box-shadow: 3px 3px 0 rgba(0,0,0,.3);
  border: 3px solid var(--ink);
}
.ms-hr-card.ms-hr-done { opacity: .55; background: #f1ead1; }
.ms-hr-card.ms-hr-done .ms-hr-card-c {
  text-decoration: line-through; text-decoration-thickness: 3px; text-decoration-color: var(--crayon-r);
}
.ms-hr-card.ms-hr-done::before {
  background: radial-gradient(circle at 35% 35%, #888 0 35%, #555 50%, #222 80%);
}

/* ─── BOTTOM ROW — lunch · buses · clubs ─────────────── */
.ms-hr-lower {
  position: absolute; top: 1660px; left: 64px; right: 64px; height: 320px;
  display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 20px;
  z-index: 4;
}

/* Brown-paper lunch bag */
.ms-hr-lunchbag {
  position: relative;
  transform: rotate(-1.5deg);
}
.ms-hr-bag {
  position: relative;
  background: var(--kraft);
  background-image:
    radial-gradient(rgba(0,0,0,.08) 1.2px, transparent 1.3px),
    linear-gradient(170deg, rgba(255,255,255,.08), transparent 60%),
    linear-gradient(20deg,  rgba(0,0,0,.08), transparent 50%);
  background-size: 18px 18px, auto, auto;
  border: 5px solid var(--kraft-d);
  box-shadow: 10px 10px 0 var(--ink);
  padding: 32px 36px 28px;
  height: 100%;
  /* curled top edge */
  clip-path: polygon(
    4% 4%, 8% 0%, 16% 4%, 24% 1%, 34% 5%, 44% 0%, 56% 4%, 66% 1%, 76% 5%, 86% 0%, 94% 4%, 100% 8%, 100% 100%, 0% 100%, 0% 8%
  );
}
.ms-hr-receipt {
  position: absolute; top: -18px; left: 50%; transform: translateX(-50%) rotate(2deg);
  background: #fffde7; border: 4px solid var(--ink);
  padding: 6px 22px;
  font-family: 'Patrick Hand', cursive; font-size: 26px;
  letter-spacing: .14em; text-transform: uppercase; color: var(--ink);
  box-shadow: 3px 3px 0 rgba(0,0,0,.2);
  z-index: 3;
  white-space: nowrap;
}
.ms-hr-bag-ey {
  font-family: 'Patrick Hand', cursive; font-size: 30px; letter-spacing: .14em; text-transform: uppercase;
  color: rgba(31,34,48,.78);
}
.ms-hr-entree {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 64px; line-height: .95; color: var(--ink); letter-spacing: -.02em;
  margin-top: 6px;
}
.ms-hr-sides {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 38px; line-height: 1.15;
  color: var(--ink); margin-top: 10px;
}
.ms-hr-tags {
  display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap;
}
.ms-hr-tag {
  font-family: 'Patrick Hand', cursive; font-size: 26px;
  padding: 4px 14px; border: 3px solid var(--ink);
  background: #fff; color: var(--ink);
  letter-spacing: .04em;
  transform: rotate(-1deg);
}
.ms-hr-tag-veg { background: #d6f0c6; }
.ms-hr-tag-gf  { background: #ffe4c1; }
.ms-hr-tag-df  { background: #d3def7; }

/* School-bus locker row */
.ms-hr-buses {
  background: linear-gradient(180deg, var(--bus) 0%, var(--bus-d) 100%);
  border: 6px solid var(--ink);
  box-shadow: 10px 10px 0 var(--ink);
  padding: 16px 22px 18px;
  display: flex; flex-direction: column; gap: 10px;
  position: relative;
  overflow: hidden;
}
.ms-hr-buses::before {
  content: ''; position: absolute; top: 6px; left: 6px; right: 6px; bottom: 6px;
  border: 3px dashed rgba(31,34,48,.35); pointer-events: none;
}
.ms-hr-bus-head {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 6px;
  border-bottom: 4px solid var(--ink);
}
.ms-hr-bus-t {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 56px; color: var(--ink); line-height: 1; letter-spacing: -.02em;
}
.ms-hr-bus-ey {
  font-family: 'Patrick Hand', cursive; font-size: 28px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-2);
}
.ms-hr-bus-list {
  display: grid; gap: 6px; padding-top: 4px;
}
.ms-hr-bus {
  background: #fff; border: 4px solid var(--ink);
  padding: 8px 14px;
  display: grid; grid-template-columns: 70px 1fr auto; gap: 14px; align-items: center;
  box-shadow: 3px 3px 0 rgba(0,0,0,.25);
}
.ms-hr-bus-num {
  background: var(--ink); color: var(--bus); border: 3px solid var(--ink);
  width: 70px; height: 60px;
  display: grid; place-items: center;
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900;
  font-size: 44px; line-height: 1; letter-spacing: -.02em;
}
.ms-hr-bus-rt {
  font-family: 'Figtree', system-ui, sans-serif; font-weight: 800; font-size: 28px; color: var(--ink); line-height: 1.05;
}
.ms-hr-bus-sub {
  font-family: 'Patrick Hand', cursive; font-size: 22px; color: var(--ink-2);
  letter-spacing: .04em; margin-top: 2px;
}
.ms-hr-bus-st {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 30px;
  padding: 4px 14px; border: 3px solid var(--ink);
  line-height: 1; letter-spacing: .02em;
  transform: rotate(-2deg);
  box-shadow: 2px 2px 0 var(--ink);
  white-space: nowrap;
}
.ms-hr-bus-st.ms-hr-bus-on    { background: #d6f0c6; color: #2d6a1d; }
.ms-hr-bus-st.ms-hr-bus-late  { background: #ffd1c1; color: #b1380f; }
.ms-hr-bus-st.ms-hr-bus-sched { background: #d3def7; color: #233a7a; }

/* Manila folder for clubs */
.ms-hr-folder {
  position: relative;
  background: var(--kraft);
  border: 5px solid var(--kraft-d);
  box-shadow: 10px 10px 0 var(--ink);
  padding: 22px 28px 18px;
  transform: rotate(1deg);
  background-image:
    radial-gradient(rgba(0,0,0,.06) 1.2px, transparent 1.3px);
  background-size: 22px 22px;
}
.ms-hr-folder::before {
  content: ''; position: absolute; top: -28px; left: 56px; width: 240px; height: 28px;
  background: var(--kraft); border: 5px solid var(--kraft-d); border-bottom: 0;
  border-radius: 8px 8px 0 0;
}
.ms-hr-folder::after {
  content: 'CLUBS'; position: absolute; top: -22px; left: 88px;
  font-family: 'Patrick Hand', cursive; font-size: 22px; letter-spacing: .14em; color: var(--ink);
  z-index: 2;
}
.ms-hr-clip {
  position: absolute; top: -8px; right: 60px; width: 50px; height: 80px; pointer-events: none;
  transform: rotate(15deg);
  filter: drop-shadow(2px 2px 2px rgba(0,0,0,.4));
  z-index: 3;
}
.ms-hr-clip::before, .ms-hr-clip::after {
  content: ''; position: absolute; left: 0; right: 0;
  border: 3px solid #b3b3bc; background: transparent;
}
.ms-hr-clip::before { top: 0; height: 50px; border-radius: 25px 25px 0 0; border-bottom: 0; }
.ms-hr-clip::after  { top: 14px; height: 40px; border-radius: 20px 20px 0 0; border-bottom: 0; left: 8px; right: 8px; }
.ms-hr-folder-ey {
  font-family: 'Patrick Hand', cursive; font-size: 26px; letter-spacing: .14em; text-transform: uppercase;
  color: rgba(31,34,48,.7);
}
.ms-hr-folder-title {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900; font-size: 46px;
  color: var(--ink); margin: 4px 0 10px; line-height: 1; letter-spacing: -.02em;
}
.ms-hr-folder-list { display: grid; gap: 4px; }
.ms-hr-folder-row {
  display: grid; grid-template-columns: 22px 1fr auto; gap: 14px; align-items: center;
  padding: 6px 0;
  border-bottom: 2px dotted rgba(31,34,48,.4);
}
.ms-hr-folder-row:last-child { border-bottom: 0; }
.ms-hr-folder-dot {
  width: 20px; height: 20px; border-radius: 50%; border: 3px solid var(--ink); box-shadow: 2px 2px 0 var(--ink);
}
.ms-hr-folder-n {
  font-family: 'Figtree', system-ui, sans-serif; font-weight: 800; font-size: 28px; color: var(--ink); line-height: 1.05;
}
.ms-hr-folder-n span {
  display: block; font-family: 'Patrick Hand', cursive; font-size: 22px; color: var(--ink-2); margin-top: 2px;
}
.ms-hr-folder-w {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 32px; color: var(--crayon-r); white-space: nowrap;
}

/* ─── TICKER — torn paper banner with push pins ──────── */
.ms-hr-ticker {
  position: absolute; bottom: 60px; left: 64px; right: 64px; height: 100px;
  background: var(--paper);
  border: 5px solid var(--ink);
  box-shadow: 8px 8px 0 var(--ink);
  display: grid; grid-template-columns: auto 1fr; align-items: stretch;
  z-index: 4;
  clip-path: polygon(
    0 8%, 2% 0, 4% 6%, 7% 0, 10% 5%, 13% 0, 16% 7%, 20% 0, 24% 5%, 28% 0, 32% 6%, 36% 0, 40% 5%, 44% 0, 48% 7%, 52% 0, 56% 5%, 60% 0, 64% 6%, 68% 0, 72% 5%, 76% 0, 80% 7%, 84% 0, 88% 5%, 92% 0, 96% 6%, 100% 0, 100% 92%, 96% 100%, 92% 95%, 88% 100%, 84% 94%, 80% 100%, 76% 93%, 72% 100%, 68% 95%, 64% 100%, 60% 94%, 56% 100%, 52% 93%, 48% 100%, 44% 95%, 40% 100%, 36% 94%, 32% 100%, 28% 93%, 24% 100%, 20% 95%, 16% 100%, 13% 94%, 10% 100%, 7% 95%, 4% 100%, 2% 94%, 0 100%
  );
}
.ms-hr-ticker-badge {
  background: var(--crayon-r); color: #fff;
  padding: 0 36px;
  display: flex; align-items: center; gap: 14px;
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 900; font-size: 44px;
  letter-spacing: -.01em;
  border-right: 5px solid var(--ink);
}
.ms-hr-ticker-badge::before {
  content: ''; width: 22px; height: 22px;
  background: conic-gradient(var(--crayon-y) 0 33%, var(--crayon-b) 33% 66%, var(--chalk) 66% 100%);
  border: 3px solid #fff; border-radius: 50%;
}
.ms-hr-ticker-feed {
  overflow: hidden; display: flex; align-items: center;
  padding-left: 32px;
}
.ms-hr-ticker-msg {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 50px;
  color: var(--ink); white-space: nowrap; letter-spacing: .01em;
  animation: msHrScroll 80s linear infinite;
}
.ms-hr-ticker-msg span { display: inline-block; padding-right: 80px; }
.ms-hr-ticker-msg span::after {
  content: '✶'; color: var(--crayon-r); margin-left: 60px; font-size: 38px;
}
.ms-hr-ticker-pin {
  position: absolute; bottom: 130px; width: 32px; height: 32px; border-radius: 50%; z-index: 7;
  background: radial-gradient(circle at 35% 35%, var(--pin) 0 35%, #aa3024 50%, #6b1d12 80%);
  box-shadow: 3px 4px 6px rgba(0,0,0,.4), inset 0 -3px 0 rgba(0,0,0,.3);
}
.ms-hr-ticker-pin-l { left: 90px; }
.ms-hr-ticker-pin-r { right: 90px; }

@keyframes msHrScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
`;
