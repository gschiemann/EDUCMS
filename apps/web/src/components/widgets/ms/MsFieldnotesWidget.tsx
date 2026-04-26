"use client";

/**
 * MsFieldnotesWidget — Middle-school lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-25 — matches scratch/design/fieldnotes-ms-v2.html.
 * Reviewed by user, ported via HsStage scale pattern. DO NOT
 * regress to vw/% units. Every pixel size must match the mockup.
 *
 * Scene layout (panels arranged on a 3840×2160 stage):
 *   - mast        → brass compass + journal title + wax seal + 3 stamp tiles
 *   - spread      → kraft-paper two-page spread with leather spine:
 *                     LEFT page = botanical specimen card + hero copy
 *                     RIGHT page = polaroid + countdown + agenda (7 entries)
 *   - margin      → 4 marginalia cards (lunch / clubs / buses / shoutouts)
 *   - ticker      → "P.S." postscript ribbon at the bottom
 *   - decorations → coffee ring on left page, ink blot, scribble note
 *
 * box-sizing: border-box is load-bearing on every panel with an explicit
 * width — the stamp tiles, specimen, the cards in .margin, and the
 * ticker all rely on it to land on the right edge given their borders +
 * padding.
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsFieldnotesConfig {
  // Top masthead — school lockup
  'school.ey'?: string;
  'school.name'?: string;
  'school.amp'?: string;
  'school.mascot'?: string;
  'school.sub'?: string;
  // Wax seal
  'brand.vol'?: string;
  'brand.num'?: string;
  'brand.day'?: string;
  // Stamp tiles
  'weather.k'?: string;
  'weather.v'?: string;
  'weather.cap'?: string;
  'clock.k'?: string;
  'clock.v'?: string;
  'clock.cap'?: string;
  'bell.k'?: string;
  'bell.v'?: string;
  'bell.cap'?: string;
  // Page numbers
  'pageno.l'?: string;
  'pageno.r'?: string;
  // Specimen card
  'specimen.latin'?: string;
  'specimen.common'?: string;
  'specimen.meta'?: string;
  // Hero copy
  'greeting.chapter'?: string;
  'greeting.h1a'?: string;
  'greeting.h1b'?: string;
  'greeting.h1c'?: string;
  'greeting.h1d'?: string;
  'greeting.lede'?: string;
  'greeting.scribble'?: string;
  'greeting.stampname'?: string;
  // Polaroid spotlight
  'spotlight.ey'?: string;
  'spotlight.name'?: string;
  'spotlight.note'?: string;
  // Countdown
  'countdown.ey'?: string;
  'countdown.num'?: string;
  'countdown.unit'?: string;
  'countdown.label'?: string;
  'countdown.cap'?: string;
  // Agenda
  'agenda.h'?: string;
  'agenda.h2'?: string;
  'agenda.day'?: string;
  'agenda.0.t'?: string;
  'agenda.0.c'?: string;
  'agenda.0.r'?: string;
  'agenda.0.x'?: string;
  'agenda.1.t'?: string;
  'agenda.1.c'?: string;
  'agenda.1.r'?: string;
  'agenda.1.x'?: string;
  'agenda.2.t'?: string;
  'agenda.2.c'?: string;
  'agenda.2.r'?: string;
  'agenda.2.x'?: string;
  'agenda.3.t'?: string;
  'agenda.3.c'?: string;
  'agenda.3.r'?: string;
  'agenda.3.x'?: string;
  'agenda.4.t'?: string;
  'agenda.4.c'?: string;
  'agenda.4.r'?: string;
  'agenda.4.x'?: string;
  'agenda.5.t'?: string;
  'agenda.5.c'?: string;
  'agenda.5.r'?: string;
  'agenda.5.x'?: string;
  'agenda.6.t'?: string;
  'agenda.6.c'?: string;
  'agenda.6.r'?: string;
  'agenda.6.x'?: string;
  // Lunch card
  'lunch.ey'?: string;
  'lunch.h'?: string;
  'lunch.entree'?: string;
  'lunch.sides'?: string;
  'lunch.quote'?: string;
  // Clubs card
  'clubs.ey'?: string;
  'clubs.h'?: string;
  'clubs.0.n'?: string;
  'clubs.0.r'?: string;
  'clubs.0.w'?: string;
  'clubs.1.n'?: string;
  'clubs.1.r'?: string;
  'clubs.1.w'?: string;
  'clubs.2.n'?: string;
  'clubs.2.r'?: string;
  'clubs.2.w'?: string;
  'clubs.3.n'?: string;
  'clubs.3.r'?: string;
  'clubs.3.w'?: string;
  // Buses card
  'buses.ey'?: string;
  'buses.h'?: string;
  'buses.0.num'?: string;
  'buses.0.rt'?: string;
  'buses.0.note'?: string;
  'buses.0.st'?: string;
  'buses.1.num'?: string;
  'buses.1.rt'?: string;
  'buses.1.note'?: string;
  'buses.1.st'?: string;
  'buses.2.num'?: string;
  'buses.2.rt'?: string;
  'buses.2.note'?: string;
  'buses.2.st'?: string;
  'buses.3.num'?: string;
  'buses.3.rt'?: string;
  'buses.3.note'?: string;
  'buses.3.st'?: string;
  // Shoutouts card
  'shouts.ey'?: string;
  'shouts.h'?: string;
  'shouts.0.ic'?: string;
  'shouts.0.name'?: string;
  'shouts.0.note'?: string;
  'shouts.1.ic'?: string;
  'shouts.1.name'?: string;
  'shouts.1.note'?: string;
  'shouts.2.ic'?: string;
  'shouts.2.name'?: string;
  'shouts.2.note'?: string;
  'shouts.3.ic'?: string;
  'shouts.3.name'?: string;
  'shouts.3.note'?: string;
  // Ticker
  'ticker.tag'?: string;
  'ticker.0'?: string;
  'ticker.1'?: string;
  'ticker.2'?: string;
  'ticker.3'?: string;
  'ticker.4'?: string;
  'ticker.5'?: string;
}

export const DEFAULTS: Required<MsFieldnotesConfig> = {
  // Top masthead — school lockup
  'school.ey': 'Field Notebook · Volume 142',
  'school.name': 'Westridge',
  'school.amp': '&',
  'school.mascot': 'Otters',
  'school.sub': "a daily naturalist's log — kept by the front office",
  // Wax seal
  'brand.vol': 'ENTRY №',
  'brand.num': '147',
  'brand.day': 'Tue · Apr 21',
  // Stamp tiles
  'weather.k': 'Outside',
  'weather.v': '46°',
  'weather.cap': 'clear · light SW',
  'clock.k': 'Right Now',
  'clock.v': '7:53',
  'clock.cap': 'first bell at 8:05',
  'bell.k': 'Day',
  'bell.v': 'B',
  'bell.cap': 'rotation — 7 periods',
  // Page numbers
  'pageno.l': '— pg. 284 —',
  'pageno.r': '— pg. 285 —',
  // Specimen card
  'specimen.latin': 'Lutra schoolus',
  'specimen.common': '"the everyday otter"',
  'specimen.meta': 'Pressed · 21 Apr · pg. 284',
  // Hero copy
  'greeting.chapter': 'Chapter 147 · morning observations',
  'greeting.h1a': 'Today,',
  'greeting.h1b': 'try',
  'greeting.h1c': 'something',
  'greeting.h1d': 'new.',
  'greeting.lede':
    'Observations from the front office: the cafeteria smells of cinnamon, the hallways are already loud, and first period begins at 8:05 sharp. Pack a pencil, a journal, and a small bit of courage.',
  'greeting.scribble': '— Mrs. Calloway',
  'greeting.stampname': 'The Otter Council',
  // Polaroid
  'spotlight.ey': 'Specimen of the Day',
  'spotlight.name': 'Mr. Nguyen, P2 English',
  'spotlight.note': 'Room 108 · poetry workshop · birthdays today: 2',
  // Countdown
  'countdown.ey': 'FIELD DAY · sign-ups close',
  'countdown.num': '12',
  'countdown.unit': 'days',
  'countdown.label': 'until the meadow opens',
  'countdown.cap': '284 of 460 otters signed up — paper slips at the front office',
  // Agenda
  'agenda.h': "Today's",
  'agenda.h2': 'rotation',
  'agenda.day': 'Tuesday · Day B · seven entries',
  'agenda.0.t': '8:05',
  'agenda.0.c': 'Math 7',
  'agenda.0.r': 'rm 214 · Ms. Patel',
  'agenda.0.x': 'done',
  'agenda.1.t': '9:00',
  'agenda.1.c': 'English — Poetry',
  'agenda.1.r': 'rm 108 · bring journal',
  'agenda.1.x': 'now',
  'agenda.2.t': '9:55',
  'agenda.2.c': 'Science — lab',
  'agenda.2.r': 'rm 207 · closed-toe shoes',
  'agenda.2.x': 'up next',
  'agenda.3.t': '10:50',
  'agenda.3.c': 'PE — mile run',
  'agenda.3.r': 'gym A · Coach Reyes',
  'agenda.3.x': '10:50',
  'agenda.4.t': '11:45',
  'agenda.4.c': 'Lunch — A',
  'agenda.4.r': '7th grade · cafeteria',
  'agenda.4.x': 'A-period',
  'agenda.5.t': '12:35',
  'agenda.5.c': 'Social Studies',
  'agenda.5.r': 'rm 115 · map quiz',
  'agenda.5.x': '12:35',
  'agenda.6.t': '1:30',
  'agenda.6.c': 'Art — printmaking',
  'agenda.6.r': 'rm B-12 · sub today',
  'agenda.6.x': '1:30',
  // Lunch
  'lunch.ey': '— lunch log —',
  'lunch.h': 'On the menu',
  'lunch.entree': 'Chicken & rice bowl',
  'lunch.sides': 'Roasted broccoli · garlic bread · seasonal fruit. Salad bar all period. Veg + GF on request.',
  'lunch.quote': 'surprisingly good — 7th grader, anonymous',
  // Clubs
  'clubs.ey': '— after school —',
  'clubs.h': 'Clubs & auditions',
  'clubs.0.n': 'Robotics — build week',
  'clubs.0.r': 'rm 207',
  'clubs.0.w': '3:00–4:30',
  'clubs.1.n': 'Drama auditions',
  'clubs.1.r': 'auditorium',
  'clubs.1.w': '3:15–4:30',
  'clubs.2.n': 'Garden Club',
  'clubs.2.r': 'greenhouse',
  'clubs.2.w': '3:00–4:00',
  'clubs.3.n': 'Yearbook',
  'clubs.3.r': 'computer lab B',
  'clubs.3.w': '3:00–4:00',
  // Buses
  'buses.ey': '— bus watch · 2:45 dismissal —',
  'buses.h': 'Routes today',
  'buses.0.num': '№12',
  'buses.0.rt': 'Oakdale · Pine Ridge',
  'buses.0.note': 'Driver: Ms. Park',
  'buses.0.st': 'on time',
  'buses.1.num': '№14',
  'buses.1.rt': 'Westridge Heights',
  'buses.1.note': 'Driver: Mr. Hall',
  'buses.1.st': '+10 min',
  'buses.2.num': '№27',
  'buses.2.rt': 'Clark · Downtown',
  'buses.2.note': 'Driver: Ms. Aoki',
  'buses.2.st': 'scheduled',
  'buses.3.num': '№31',
  'buses.3.rt': 'Maple Ave loop',
  'buses.3.note': 'Driver: Mr. Diaz',
  'buses.3.st': 'on time',
  // Shoutouts
  'shouts.ey': '— marginalia —',
  'shouts.h': 'Seen today',
  'shouts.0.ic': '★',
  'shouts.0.name': 'Maya R.',
  'shouts.0.note': 'turns 13 today — cake at lunch',
  'shouts.1.ic': 'π',
  'shouts.1.name': 'Daniel K.',
  'shouts.1.note': '3rd place · regional math olympiad',
  'shouts.2.ic': '7B',
  'shouts.2.name': "Ms. Chen's class",
  'shouts.2.note': '14-day homework streak',
  'shouts.3.ic': '📚',
  'shouts.3.name': 'Library crew',
  'shouts.3.note': '100 books read this quarter',
  // Ticker
  'ticker.tag': 'P.S.',
  'ticker.0': 'Picture day moved to Thursday — full uniform — slips due Wed',
  'ticker.1': 'Sub in rm B-12 today — Mr. Diaz',
  'ticker.2': 'Spelling bee sign-ups end Friday',
  'ticker.3': 'Yearbook photos need names + grade',
  'ticker.4': '8th graders — field trip forms due tomorrow',
  'ticker.5': 'Lost blue water bottle → front office',
};

/**
 * Pick a value from the merged config, falling back to DEFAULTS if the
 * caller passed an empty string. Empty strings in the editor mean
 * "blank" but in the demo we want the demo copy.
 */
const pick = <K extends keyof Required<MsFieldnotesConfig>>(
  cfg: MsFieldnotesConfig,
  key: K,
): string => {
  const v = cfg[key];
  return (v === undefined || v === '' ? DEFAULTS[key] : v) as string;
};

export function MsFieldnotesWidget({ config }: { config?: MsFieldnotesConfig }) {
  const cfg = config || {};

  // Bus status pill class — per-row, baked from the mockup choices.
  const busStClass = ['on', 'late', 'sched', 'on'] as const;
  // Club dot colors — per-row, baked from the mockup inline styles.
  const clubDotColor = ['var(--ms-fn-ink-blue)', 'var(--ms-fn-stamp)', 'var(--ms-fn-moss)', 'var(--ms-fn-gold)'] as const;
  // Shoutout icon variant per row.
  const shoutClass = ['', 's2', 's3', 's4'] as const;

  return (
    <HsStage
      stageStyle={{
        background:
          'radial-gradient(ellipse 1800px 1100px at 50% 50%, rgba(255,236,196,.06), transparent 70%), radial-gradient(ellipse 1200px 700px at 12% 92%, rgba(0,0,0,.18), transparent 70%), radial-gradient(ellipse 1100px 600px at 90% 10%, rgba(0,0,0,.15), transparent 70%), #d8c39c',
        backgroundColor: '#d8c39c',
        fontFamily: "'Work Sans', system-ui, sans-serif",
        color: '#1e1a14',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Stage-level kraft-paper noise overlay (mockup .stage::before). */}
      <div className="ms-fn-stage-noise" aria-hidden="true" />

      {/* ─── TOP MASTHEAD ──────────────────────────────────────── */}
      <header className="ms-fn-mast">
        <div className="ms-fn-lockup" data-widget="school">
          <div className="ms-fn-compass" aria-hidden="true">
            <span className="ms-fn-card ms-fn-n">N</span>
            <span className="ms-fn-card ms-fn-s">S</span>
            <span className="ms-fn-card ms-fn-e">E</span>
            <span className="ms-fn-card ms-fn-w">W</span>
            <span className="ms-fn-pivot" />
          </div>
          <div className="ms-fn-info">
            <div className="ms-fn-ey">
              <span data-field="school.ey" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.ey')}</span>
            </div>
            <div className="ms-fn-ttl">
              <span data-field="school.name" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.name')}</span>{' '}
              <em data-field="school.amp" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.amp')}</em>{' '}
              <span data-field="school.mascot" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.mascot')}</span>
            </div>
            <div className="ms-fn-sub" data-field="school.sub" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'school.sub')}
            </div>
          </div>
        </div>

        <div className="ms-fn-seal" data-widget="brand">
          <div className="ms-fn-disc">
            <div className="ms-fn-vol" data-field="brand.vol" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'brand.vol')}
            </div>
            <div className="ms-fn-num" data-field="brand.num" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'brand.num')}
            </div>
            <div className="ms-fn-day" data-field="brand.day" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'brand.day')}
            </div>
          </div>
        </div>

        <div className="ms-fn-tiles">
          <div className="ms-fn-tile" data-widget="weather">
            <span className="ms-fn-k" data-field="weather.k" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'weather.k')}</span>
            <span className="ms-fn-v ms-fn-cool" data-field="weather.v" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'weather.v')}</span>
            <span className="ms-fn-cap" data-field="weather.cap" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'weather.cap')}</span>
          </div>
          <div className="ms-fn-tile" data-widget="clock">
            <span className="ms-fn-k" data-field="clock.k" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'clock.k')}</span>
            <span className="ms-fn-v" data-field="clock.v" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'clock.v')}</span>
            <span className="ms-fn-cap" data-field="clock.cap" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'clock.cap')}</span>
          </div>
          <div className="ms-fn-tile" data-widget="bell">
            <span className="ms-fn-k" data-field="bell.k" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'bell.k')}</span>
            <span className="ms-fn-v ms-fn-warm" data-field="bell.v" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'bell.v')}</span>
            <span className="ms-fn-cap" data-field="bell.cap" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'bell.cap')}</span>
          </div>
        </div>
      </header>

      {/* ─── SPREAD ROW ─────────────────────────────────────────── */}
      <section className="ms-fn-spread">
        {/* LEFT PAGE — botanical specimen + hero copy */}
        <div className="ms-fn-page ms-fn-left">
          <span className="ms-fn-pageno" data-widget="pageno-l">
            <span data-field="pageno.l" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'pageno.l')}</span>
          </span>
          <div className="ms-fn-coffee" aria-hidden="true" />
          <div className="ms-fn-inner">
            <div className="ms-fn-specimen-row">
              {/* Botanical specimen card */}
              <div className="ms-fn-specimen" data-widget="specimen" aria-hidden="true">
                <div className="ms-fn-leaf">
                  <svg viewBox="0 0 260 320" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <linearGradient id="ms-fn-leafg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#7d8a3a" />
                        <stop offset="100%" stopColor="#4a5520" />
                      </linearGradient>
                    </defs>
                    {/* main stem */}
                    <path d="M130 305 C 132 240, 132 170, 130 100"
                          stroke="#3b2a14" strokeWidth="4" fill="none" strokeLinecap="round" />
                    {/* big leaf body */}
                    <path d="M130 100
                             C 60 90, 25 130, 35 175
                             C 42 220, 95 250, 130 245
                             C 165 250, 218 220, 225 175
                             C 235 130, 200 90, 130 100 Z"
                          fill="url(#ms-fn-leafg)" stroke="#1e1a14" strokeWidth="3.5" />
                    {/* veins */}
                    <path d="M130 100 L 130 245
                             M130 130 L 75 160 M130 150 L 60 180 M130 170 L 65 200 M130 190 L 80 220 M130 210 L 100 235
                             M130 130 L 185 160 M130 150 L 200 180 M130 170 L 195 200 M130 190 L 180 220 M130 210 L 160 235"
                          stroke="#1e1a14" strokeWidth="1.5" fill="none" opacity=".55" />
                    {/* acorn cluster */}
                    <ellipse cx="80" cy="60" rx="22" ry="28" fill="#a36a28" stroke="#1e1a14" strokeWidth="3" />
                    <path d="M58 50 Q 80 34 102 50 L 102 64 Q 80 56 58 64 Z" fill="#5b3d10" stroke="#1e1a14" strokeWidth="2.5" />
                    <line x1="80" y1="34" x2="80" y2="20" stroke="#1e1a14" strokeWidth="3" />
                    <ellipse cx="170" cy="48" rx="18" ry="24" fill="#b87a35" stroke="#1e1a14" strokeWidth="3" />
                    <path d="M152 40 Q 170 28 188 40 L 188 52 Q 170 44 152 52 Z" fill="#5b3d10" stroke="#1e1a14" strokeWidth="2.5" />
                    {/* small leaf */}
                    <path d="M210 215 C 235 210, 245 230, 235 250 C 220 260, 200 245, 205 225 Z"
                          fill="#6e7a36" stroke="#1e1a14" strokeWidth="2.5" />
                  </svg>
                </div>
                <div className="ms-fn-latin" data-field="specimen.latin" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'specimen.latin')}</div>
                <div className="ms-fn-common" data-field="specimen.common" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'specimen.common')}</div>
                <div className="ms-fn-meta" data-field="specimen.meta" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'specimen.meta')}</div>
              </div>

              {/* Hero copy */}
              <div className="ms-fn-hero-copy" data-widget="greeting">
                <div className="ms-fn-chapter" data-field="greeting.chapter" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.chapter')}</div>
                <h1 className="ms-fn-h1">
                  <span data-field="greeting.h1a" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h1a')}</span>{' '}
                  <em data-field="greeting.h1b" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h1b')}</em>
                  <br />
                  <u data-field="greeting.h1c" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h1c')}</u>{' '}
                  <span data-field="greeting.h1d" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h1d')}</span>
                </h1>
                <div className="ms-fn-quillbar" aria-hidden="true" />
                <p className="ms-fn-lede" data-field="greeting.lede" style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, 'greeting.lede')}
                </p>
                <div className="ms-fn-signature">
                  <span className="ms-fn-scribble" data-field="greeting.scribble" style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, 'greeting.scribble')}
                  </span>
                  <span className="ms-fn-stamp">
                    Approved by
                    <br />
                    <b data-field="greeting.stampname" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.stampname')}</b>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SPINE */}
        <div className="ms-fn-spine" aria-hidden="true" />

        {/* RIGHT PAGE — polaroid + countdown + agenda */}
        <div className="ms-fn-page ms-fn-right">
          <span className="ms-fn-pageno" data-widget="pageno-r">
            <span data-field="pageno.r" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'pageno.r')}</span>
          </span>
          <div className="ms-fn-inner-right">
            {/* Polaroid */}
            <div className="ms-fn-polaroid" data-widget="spotlight">
              <div className="ms-fn-photo" aria-hidden="true">
                <svg viewBox="0 0 260 380" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
                  <rect width="260" height="380" fill="#dba66f" />
                  <circle cx="130" cy="200" r="150" fill="#e8c79a" opacity=".6" />
                  <ellipse cx="130" cy="160" rx="68" ry="78" fill="#5b3d20" />
                  <path d="M40 380 C 40 280, 90 240, 130 240 C 170 240, 220 280, 220 380 Z" fill="#2b3f6b" />
                  <path d="M100 280 L 130 320 L 160 280 L 160 380 L 100 380 Z" fill="#f6ecd2" />
                  <ellipse cx="105" cy="150" rx="20" ry="10" fill="#7a5530" opacity=".8" />
                  <ellipse cx="155" cy="150" rx="20" ry="10" fill="#7a5530" opacity=".8" />
                  <circle cx="108" cy="172" r="14" fill="none" stroke="#1e1a14" strokeWidth="3" />
                  <circle cx="152" cy="172" r="14" fill="none" stroke="#1e1a14" strokeWidth="3" />
                  <line x1="122" y1="172" x2="138" y2="172" stroke="#1e1a14" strokeWidth="3" />
                  <path d="M112 200 Q 130 215 148 200" stroke="#3a2410" strokeWidth="3" fill="none" strokeLinecap="round" />
                </svg>
              </div>
              <div className="ms-fn-caption">
                <span className="ms-fn-cap-ey" data-field="spotlight.ey" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'spotlight.ey')}</span>
                <span className="ms-fn-cap-name" data-field="spotlight.name" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'spotlight.name')}</span>
                <span data-field="spotlight.note" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'spotlight.note')}</span>
              </div>
            </div>

            {/* Countdown */}
            <div className="ms-fn-countdown" data-widget="countdown">
              <div className="ms-fn-cd-ey" data-field="countdown.ey" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'countdown.ey')}</div>
              <div>
                <div className="ms-fn-cd-num">
                  <span data-field="countdown.num" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'countdown.num')}</span>
                  <span data-field="countdown.unit" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'countdown.unit')}</span>
                </div>
                <div className="ms-fn-cd-label" data-field="countdown.label" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'countdown.label')}</div>
              </div>
              <div className="ms-fn-cd-cap" data-field="countdown.cap" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'countdown.cap')}</div>
            </div>

            {/* Agenda — taped notebook page across the bottom */}
            <div className="ms-fn-agenda" data-widget="agenda">
              <div className="ms-fn-agenda-head">
                <h2 className="ms-fn-agenda-h2">
                  <span data-field="agenda.h" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.h')}</span>{' '}
                  <em data-field="agenda.h2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.h2')}</em>
                </h2>
                <div className="ms-fn-agenda-day" data-field="agenda.day" style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, 'agenda.day')}
                </div>
              </div>
              <ul className="ms-fn-agenda-list">
                {([0, 1, 2, 3, 4, 5, 6] as const).map((i) => {
                  const liClass = i === 0 ? 'ms-fn-done' : i === 1 ? 'ms-fn-now' : '';
                  const xStyle: React.CSSProperties = i === 1 ? { color: 'var(--ms-fn-stamp)' } : {};
                  return (
                    <li
                      key={i}
                      className={`ms-fn-agenda-li ${liClass}`.trim()}
                      data-widget={`agenda.${i}`}
                    >
                      <span className="ms-fn-t" data-field={`agenda.${i}.t`} style={{ whiteSpace: 'pre-wrap' }}>
                        {pick(cfg, `agenda.${i}.t` as keyof Required<MsFieldnotesConfig>)}
                      </span>
                      <span className="ms-fn-c">
                        <span data-field={`agenda.${i}.c`} style={{ whiteSpace: 'pre-wrap' }}>
                          {pick(cfg, `agenda.${i}.c` as keyof Required<MsFieldnotesConfig>)}
                        </span>
                        <span data-field={`agenda.${i}.r`} style={{ whiteSpace: 'pre-wrap' }}>
                          {pick(cfg, `agenda.${i}.r` as keyof Required<MsFieldnotesConfig>)}
                        </span>
                      </span>
                      <span className="ms-fn-x" style={{ ...xStyle, whiteSpace: 'pre-wrap' as const }} data-field={`agenda.${i}.x`}>
                        {pick(cfg, `agenda.${i}.x` as keyof Required<MsFieldnotesConfig>)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* inkblot decoration */}
      <div className="ms-fn-blot" aria-hidden="true" />

      {/* ─── MARGINALIA ROW ─────────────────────────────────────── */}
      <section className="ms-fn-margin">
        {/* Lunch */}
        <div className="ms-fn-lunch ms-fn-card-base" data-widget="lunch">
          <div className="ms-fn-card-ey" data-field="lunch.ey" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.ey')}</div>
          <h3 className="ms-fn-card-h3" data-field="lunch.h" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.h')}</h3>
          <div className="ms-fn-entree" data-field="lunch.entree" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.entree')}</div>
          <div className="ms-fn-sides" data-field="lunch.sides" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.sides')}</div>
          <div className="ms-fn-quote" data-field="lunch.quote" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.quote')}</div>
        </div>

        {/* Clubs */}
        <div className="ms-fn-clubs ms-fn-card-base" data-widget="clubs">
          <div className="ms-fn-card-ey" data-field="clubs.ey" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'clubs.ey')}</div>
          <h3 className="ms-fn-card-h3" data-field="clubs.h" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'clubs.h')}</h3>
          <ul className="ms-fn-clubs-ul">
            {([0, 1, 2, 3] as const).map((i) => (
              <li key={i} className="ms-fn-clubs-li" data-widget={`clubs.${i}`}>
                <span className="ms-fn-dot" style={{ background: clubDotColor[i] }} />
                <span>
                  <b data-field={`clubs.${i}.n`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `clubs.${i}.n` as keyof Required<MsFieldnotesConfig>)}
                  </b>
                  <span className="ms-fn-where" data-field={`clubs.${i}.r`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `clubs.${i}.r` as keyof Required<MsFieldnotesConfig>)}
                  </span>
                </span>
                <span className="ms-fn-when" data-field={`clubs.${i}.w`} style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, `clubs.${i}.w` as keyof Required<MsFieldnotesConfig>)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Buses */}
        <div className="ms-fn-buses ms-fn-card-base" data-widget="buses">
          <div className="ms-fn-card-ey" data-field="buses.ey" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'buses.ey')}</div>
          <h3 className="ms-fn-card-h3" data-field="buses.h" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'buses.h')}</h3>
          <ul className="ms-fn-buses-ul">
            {([0, 1, 2, 3] as const).map((i) => (
              <li key={i} className="ms-fn-buses-li" data-widget={`buses.${i}`}>
                <span className="ms-fn-bus-num" data-field={`buses.${i}.num`} style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, `buses.${i}.num` as keyof Required<MsFieldnotesConfig>)}
                </span>
                <span className="ms-fn-bus-rt">
                  <b data-field={`buses.${i}.rt`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `buses.${i}.rt` as keyof Required<MsFieldnotesConfig>)}
                  </b>
                  <span data-field={`buses.${i}.note`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `buses.${i}.note` as keyof Required<MsFieldnotesConfig>)}
                  </span>
                </span>
                <span
                  className={`ms-fn-bus-st ms-fn-${busStClass[i]}`}
                  data-field={`buses.${i}.st`}
                 style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, `buses.${i}.st` as keyof Required<MsFieldnotesConfig>)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Shoutouts */}
        <div className="ms-fn-shouts ms-fn-card-base" data-widget="shouts">
          <div className="ms-fn-card-ey" data-field="shouts.ey" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'shouts.ey')}</div>
          <h3 className="ms-fn-card-h3" data-field="shouts.h" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'shouts.h')}</h3>
          <ul className="ms-fn-shouts-ul">
            {([0, 1, 2, 3] as const).map((i) => {
              const klass = shoutClass[i] ? `ms-fn-${shoutClass[i]}` : '';
              return (
                <li key={i} className="ms-fn-shouts-li" data-widget={`shouts.${i}`}>
                  <span className={`ms-fn-ic ${klass}`.trim()} data-field={`shouts.${i}.ic`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `shouts.${i}.ic` as keyof Required<MsFieldnotesConfig>)}
                  </span>
                  <span className="ms-fn-name">
                    <span data-field={`shouts.${i}.name`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `shouts.${i}.name` as keyof Required<MsFieldnotesConfig>)}
                    </span>
                    <span data-field={`shouts.${i}.note`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `shouts.${i}.note` as keyof Required<MsFieldnotesConfig>)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ─── TICKER ─────────────────────────────────────────────── */}
      <footer className="ms-fn-ticker" data-widget="ticker">
        <div className="ms-fn-ticker-tag">
          <span data-field="ticker.tag" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.tag')}</span>
        </div>
        <div className="ms-fn-feed">
          <div className="ms-fn-feed-inner">
            <span data-field="ticker.0" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.0')}</span>
            <span data-field="ticker.1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.1')}</span>
            <span data-field="ticker.2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.2')}</span>
            <span data-field="ticker.3" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.3')}</span>
            <span data-field="ticker.4" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.4')}</span>
            <span data-field="ticker.5" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.5')}</span>
            {/* duplicate set so the -50% scroll loop is seamless */}
            <span aria-hidden="true">{pick(cfg, 'ticker.0')}</span>
            <span aria-hidden="true">{pick(cfg, 'ticker.1')}</span>
            <span aria-hidden="true">{pick(cfg, 'ticker.2')}</span>
            <span aria-hidden="true">{pick(cfg, 'ticker.3')}</span>
            <span aria-hidden="true">{pick(cfg, 'ticker.4')}</span>
            <span aria-hidden="true">{pick(cfg, 'ticker.5')}</span>
          </div>
        </div>
      </footer>
    </HsStage>
  );
}

/** Inlined CSS — every pixel value matches scratch/design/fieldnotes-ms-v2.html.
 *  The mockup's scale wrapper boilerplate (.viewport / .stage-outer /
 *  .stage / fit() script) is replaced by HsStage; everything else is
 *  ported verbatim with a `ms-fn-` prefix. */
const CSS = `
/* Box-sizing border-box on every panel that sets an explicit width.
   The .ms-fn-tile, .ms-fn-specimen, .ms-fn-card-base, .ms-fn-ticker, and
   .ms-fn-page panels rely on it to land on their intended edges given
   the borders + padding used. */
.ms-fn-mast, .ms-fn-mast *, .ms-fn-mast *::before, .ms-fn-mast *::after,
.ms-fn-spread, .ms-fn-spread *, .ms-fn-spread *::before, .ms-fn-spread *::after,
.ms-fn-margin, .ms-fn-margin *, .ms-fn-margin *::before, .ms-fn-margin *::after,
.ms-fn-ticker, .ms-fn-ticker *, .ms-fn-ticker *::before, .ms-fn-ticker *::after,
.ms-fn-blot, .ms-fn-blot *, .ms-fn-blot *::after,
.ms-fn-stage-noise {
  box-sizing: border-box;
}

:root {
  --ms-fn-kraft: #d8c39c;
  --ms-fn-kraft-deep: #b89870;
  --ms-fn-paper: #f6ecd2;
  --ms-fn-paper-edge: #e6d6b3;
  --ms-fn-paper-rule: #b9a070;
  --ms-fn-ink: #1e1a14;
  --ms-fn-ink-2: #4a3f2f;
  --ms-fn-ink-blue: #2b3f6b;
  --ms-fn-ink-blue-dk: #1a2c52;
  --ms-fn-stamp: #b1432e;
  --ms-fn-stamp-dk: #8a311e;
  --ms-fn-moss: #5e6e34;
  --ms-fn-gold: #b58a2e;
  --ms-fn-sepia: rgba(70, 45, 18, .15);
  --ms-fn-washi-blue: #6b8fb5;
  --ms-fn-washi-coral: #cf8870;
  --ms-fn-shadow: rgba(40, 22, 8, .35);
}

/* Stage kraft-paper noise overlay */
.ms-fn-stage-noise {
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    radial-gradient(rgba(60,38,12,.16) 1px, transparent 1.5px),
    radial-gradient(rgba(120,90,50,.10) 1px, transparent 2px);
  background-size: 11px 11px, 23px 23px;
  background-position: 0 0, 5px 7px;
  mix-blend-mode: multiply;
  opacity: .65;
}

/* ─── TOP MASTHEAD ─────────────────────────────────────── */
.ms-fn-mast {
  position: absolute; top: 56px; left: 64px; right: 64px; height: 244px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 48px; align-items: center;
  z-index: 3;
}

/* Brass compass dial */
.ms-fn-lockup { display: flex; align-items: center; gap: 40px; }
.ms-fn-compass {
  width: 228px; height: 228px; flex-shrink: 0; position: relative;
  border-radius: 50%;
  background:
    radial-gradient(circle at 35% 30%, #f6deaa 0%, #d6a85c 35%, #9a6e22 70%, #5b3d10 100%);
  box-shadow:
    inset 0 0 0 6px #6e4a14,
    inset 0 0 0 12px #c8923d,
    inset 0 -16px 36px rgba(0,0,0,.45),
    10px 12px 0 rgba(0,0,0,.18),
    0 6px 24px rgba(0,0,0,.4);
}
.ms-fn-compass::before {
  content: ''; position: absolute; inset: 34px;
  border-radius: 50%;
  background:
    repeating-conic-gradient(from -90deg, var(--ms-fn-ink) 0 1.5deg, transparent 1.5deg 30deg),
    radial-gradient(circle, #f6ecd2 0%, #e3d2a8 75%, #c5a672 100%);
  box-shadow: inset 0 0 0 3px var(--ms-fn-ink-2);
}
.ms-fn-compass::after {
  content: ''; position: absolute; top: 50%; left: 50%; width: 14px; height: 160px;
  transform: translate(-50%, -50%) rotate(-22deg);
  background: linear-gradient(180deg, var(--ms-fn-stamp) 0 50%, var(--ms-fn-ink) 50% 100%);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  box-shadow: 0 0 12px rgba(0,0,0,.35);
}
.ms-fn-pivot {
  position: absolute; top: 50%; left: 50%; width: 22px; height: 22px;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle at 35% 30%, #ffe9b6, #b58a2e 60%, #6b4a14);
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0,0,0,.5);
}
.ms-fn-card {
  position: absolute; font-family: 'IM Fell English SC', serif; font-size: 30px;
  color: var(--ms-fn-ink); font-weight: 400; letter-spacing: .06em;
}
.ms-fn-card.ms-fn-n { top: 46px; left: 50%; transform: translateX(-50%); color: var(--ms-fn-stamp); font-weight: 700; }
.ms-fn-card.ms-fn-s { bottom: 46px; left: 50%; transform: translateX(-50%); }
.ms-fn-card.ms-fn-e { right: 46px; top: 50%; transform: translateY(-50%); }
.ms-fn-card.ms-fn-w { left: 46px; top: 50%; transform: translateY(-50%); }

.ms-fn-info .ms-fn-ey {
  font-family: 'IM Fell English SC', serif; font-size: 36px; color: var(--ms-fn-stamp);
  letter-spacing: .18em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 18px;
}
.ms-fn-info .ms-fn-ey::before {
  content: ''; width: 64px; height: 4px; background: var(--ms-fn-stamp);
}
.ms-fn-info .ms-fn-ttl {
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 128px; line-height: .92; color: var(--ms-fn-ink);
  letter-spacing: -.015em; margin-top: 6px;
  text-shadow: 2px 2px 0 rgba(0,0,0,.06);
}
.ms-fn-info .ms-fn-ttl em {
  font-style: italic; color: var(--ms-fn-stamp);
}
.ms-fn-info .ms-fn-sub {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 48px;
  color: var(--ms-fn-ink-2); margin-top: 6px; letter-spacing: .01em;
}

/* Center plate — wax seal vol/issue */
.ms-fn-seal {
  justify-self: center; position: relative; width: 340px; height: 200px;
  display: grid; place-items: center; text-align: center;
}
.ms-fn-seal::before {
  content: ''; position: absolute; left: 50%; top: -22px; transform: translateX(-50%) rotate(-8deg);
  width: 130px; height: 38px;
  background: var(--ms-fn-stamp);
  clip-path: polygon(15% 0, 85% 0, 100% 100%, 70% 60%, 50% 100%, 30% 60%, 0 100%);
  filter: drop-shadow(0 4px 0 var(--ms-fn-stamp-dk));
}
.ms-fn-disc {
  width: 204px; height: 204px; border-radius: 50%; position: relative;
  background:
    radial-gradient(circle at 38% 30%, rgba(255,255,255,.35), transparent 30%),
    radial-gradient(circle, var(--ms-fn-stamp) 0 60%, var(--ms-fn-stamp-dk) 100%);
  box-shadow:
    inset 0 -10px 22px rgba(0,0,0,.35),
    6px 8px 0 rgba(0,0,0,.18);
  display: grid; place-items: center;
  border: 4px solid var(--ms-fn-stamp-dk);
}
.ms-fn-disc::before {
  content: ''; position: absolute; inset: 18px; border-radius: 50%;
  border: 2px dashed rgba(255,236,196,.5);
}
.ms-fn-vol {
  font-family: 'IM Fell English SC', serif; color: #fff5d8; font-size: 30px;
  letter-spacing: .16em; line-height: 1; padding-top: 14px;
}
.ms-fn-num {
  font-family: 'DM Serif Display', serif; color: #fff5d8; font-size: 84px;
  line-height: 1; letter-spacing: -.02em;
}
.ms-fn-day {
  font-family: 'Caveat', cursive; color: #fff5d8; font-size: 34px;
  line-height: 1; padding-bottom: 14px; opacity: .92;
}

/* Right — weather + time + countdown tiles, like field-guide stamps */
.ms-fn-tiles { display: flex; gap: 24px; }
.ms-fn-tile {
  width: 230px; height: 200px; padding: 24px 26px; position: relative;
  background: #fff7e0;
  border: 4px solid var(--ms-fn-ink);
  box-shadow: 8px 9px 0 var(--ms-fn-ink), 0 0 0 8px var(--ms-fn-paper) inset;
  display: flex; flex-direction: column; justify-content: space-between;
  transform: rotate(-1deg);
}
.ms-fn-tile:nth-child(2) { transform: rotate(.8deg); }
.ms-fn-tile:nth-child(3) { transform: rotate(-.4deg); }
.ms-fn-tile .ms-fn-k {
  font-family: 'IM Fell English SC', serif; font-size: 28px; color: var(--ms-fn-ink-2);
  letter-spacing: .18em; text-transform: uppercase; line-height: 1;
}
.ms-fn-tile .ms-fn-v {
  font-family: 'DM Serif Display', serif; font-size: 104px; color: var(--ms-fn-ink);
  line-height: .9; letter-spacing: -.02em;
}
.ms-fn-tile .ms-fn-v.ms-fn-cool { color: var(--ms-fn-ink-blue); }
.ms-fn-tile .ms-fn-v.ms-fn-warm { color: var(--ms-fn-stamp); }
.ms-fn-tile .ms-fn-v.ms-fn-brass { color: var(--ms-fn-gold); }
.ms-fn-tile .ms-fn-cap {
  font-family: 'Caveat', cursive; font-size: 30px; color: var(--ms-fn-ink-2); line-height: 1;
}

/* ─── SPREAD ROW (left page + spine + right page) ─────── */
.ms-fn-spread {
  position: absolute; top: 320px; left: 64px; right: 64px; height: 1180px;
  display: grid; grid-template-columns: 1750px 60px 1fr; gap: 0;
  z-index: 2;
}

.ms-fn-page {
  position: relative; height: 100%;
  background: linear-gradient(180deg, var(--ms-fn-paper) 0%, var(--ms-fn-paper-edge) 100%);
  box-shadow:
    0 0 0 4px var(--ms-fn-ink),
    14px 18px 0 rgba(0,0,0,.22),
    inset 0 0 60px rgba(160,120,60,.12);
}
.ms-fn-page::before {
  content: ''; position: absolute; inset: 0;
  background-image: repeating-linear-gradient(180deg, transparent 0 71px, rgba(110, 80, 40, .22) 71px 73px);
  pointer-events: none;
}
.ms-fn-page::after {
  content: ''; position: absolute; top: 0; bottom: 0; width: 3px;
  background: var(--ms-fn-stamp); opacity: .55;
}
.ms-fn-page.ms-fn-left::after { left: 110px; }
.ms-fn-page.ms-fn-right::after { left: 60px; }

/* The spine — leather binding with stitching */
.ms-fn-spine {
  position: relative; height: 100%;
  background:
    linear-gradient(90deg,
      rgba(0,0,0,.45) 0%,
      rgba(0,0,0,.18) 30%,
      rgba(0,0,0,.10) 50%,
      rgba(0,0,0,.18) 70%,
      rgba(0,0,0,.45) 100%),
    linear-gradient(180deg, #6e4a14 0%, #3d2710 100%);
  box-shadow: inset 0 0 18px rgba(0,0,0,.55);
}
.ms-fn-spine::before {
  content: ''; position: absolute; left: 50%; top: 30px; bottom: 30px; width: 2px;
  transform: translateX(-50%);
  background: repeating-linear-gradient(180deg, #d8b370 0 12px, transparent 12px 22px);
}
.ms-fn-spine::after {
  content: ''; position: absolute; inset: 0;
  background-image:
    repeating-linear-gradient(180deg,
      transparent 0 44px,
      rgba(0,0,0,.35) 44px 80px,
      transparent 80px 110px);
}

/* ─── LEFT PAGE — botanical specimen + hero copy ───────── */
.ms-fn-left .ms-fn-inner {
  position: absolute; inset: 64px 64px 64px 150px;
  z-index: 1;
}
.ms-fn-left .ms-fn-pageno {
  position: absolute; top: 24px; right: 32px;
  font-family: 'IM Fell English SC', serif; font-size: 32px; color: var(--ms-fn-ink-2);
  letter-spacing: .18em;
  z-index: 1;
}

/* Coffee ring smudge */
.ms-fn-coffee {
  position: absolute; top: 42px; right: 160px; width: 240px; height: 240px;
  border-radius: 50%;
  border: 14px solid rgba(112, 70, 30, .22);
  pointer-events: none;
  box-shadow: inset 0 -6px 0 rgba(112, 70, 30, .16);
  transform: rotate(-12deg);
  z-index: 0;
}
.ms-fn-coffee::after {
  content: ''; position: absolute; left: -30px; top: 90px; width: 48px; height: 14px;
  border-radius: 50%;
  background: rgba(112, 70, 30, .18);
  transform: rotate(-25deg);
}

.ms-fn-specimen-row {
  display: grid; grid-template-columns: 360px 1fr; gap: 60px; align-items: flex-start;
  position: relative; z-index: 1;
}

/* Botanical specimen */
.ms-fn-specimen {
  position: relative; width: 340px; height: 520px;
  background: linear-gradient(180deg, #fbf3df 0%, #ead7ae 100%);
  border: 3px solid var(--ms-fn-ink);
  box-shadow: 6px 8px 0 rgba(0,0,0,.25);
  transform: rotate(-2.5deg);
  padding: 32px 28px;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.ms-fn-specimen::before, .ms-fn-specimen::after {
  content: ''; position: absolute;
  width: 130px; height: 42px;
  background:
    repeating-linear-gradient(45deg,
      var(--ms-fn-washi-blue) 0 8px,
      rgba(255,255,255,.4) 8px 12px,
      var(--ms-fn-washi-blue) 12px 22px);
  box-shadow: 0 2px 0 rgba(0,0,0,.08);
}
.ms-fn-specimen::before { top: -18px; left: -24px; transform: rotate(-12deg); }
.ms-fn-specimen::after {
  bottom: -14px; right: -22px; transform: rotate(8deg);
  background:
    repeating-linear-gradient(-45deg,
      var(--ms-fn-washi-coral) 0 8px,
      rgba(255,255,255,.4) 8px 12px,
      var(--ms-fn-washi-coral) 12px 22px);
}
.ms-fn-leaf {
  width: 260px; height: 320px; margin: 8px auto 0; position: relative;
}
.ms-fn-leaf svg { width: 100%; height: 100%; display: block; }
.ms-fn-latin {
  font-family: 'DM Serif Display', serif; font-style: italic; font-size: 38px;
  color: var(--ms-fn-ink-2); text-align: center; line-height: 1; margin-top: 18px;
}
.ms-fn-common {
  font-family: 'Caveat', cursive; font-size: 42px; color: var(--ms-fn-stamp);
  text-align: center; line-height: 1; margin-top: 8px;
}
.ms-fn-meta {
  font-family: 'IM Fell English SC', serif; font-size: 22px; color: var(--ms-fn-ink-2);
  text-align: center; letter-spacing: .16em; margin-top: 18px;
  border-top: 2px dashed rgba(0,0,0,.25); padding-top: 14px;
}

/* HERO copy block */
.ms-fn-hero-copy { position: relative; padding-top: 8px; min-width: 0; }
.ms-fn-chapter {
  font-family: 'IM Fell English SC', serif; font-size: 34px; color: var(--ms-fn-stamp);
  letter-spacing: .22em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 18px;
}
.ms-fn-chapter::before {
  content: ''; width: 54px; height: 4px; background: var(--ms-fn-stamp);
}
.ms-fn-h1 {
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 228px; line-height: .86; letter-spacing: -.025em;
  color: var(--ms-fn-ink); margin: 18px 0 0; text-wrap: balance;
}
.ms-fn-h1 em {
  font-style: italic; color: var(--ms-fn-stamp);
}
.ms-fn-h1 u {
  text-decoration: none;
  background: linear-gradient(transparent 70%, rgba(181,138,46,.55) 70% 92%, transparent 92%);
  padding: 0 10px;
}
.ms-fn-quillbar {
  margin-top: 32px; height: 28px; width: 70%;
  background:
    radial-gradient(ellipse 70% 100% at 0% 50%, var(--ms-fn-ink) 0 60%, transparent 70%),
    radial-gradient(ellipse 60% 100% at 100% 50%, var(--ms-fn-ink) 0 50%, transparent 70%),
    linear-gradient(90deg, var(--ms-fn-ink) 0%, var(--ms-fn-ink) 100%);
  clip-path: polygon(0 60%, 4% 30%, 14% 50%, 40% 35%, 60% 55%, 80% 35%, 96% 60%, 100% 70%, 80% 90%, 50% 75%, 25% 85%, 8% 70%);
  opacity: .9;
}
.ms-fn-lede {
  font-family: 'Work Sans', sans-serif; font-weight: 500;
  font-size: 46px; line-height: 1.32; color: var(--ms-fn-ink-2);
  margin-top: 36px; max-width: 1140px;
}
.ms-fn-lede em {
  font-style: normal; font-family: 'Caveat', cursive; font-weight: 700;
  color: var(--ms-fn-stamp); font-size: 54px; padding: 0 6px;
}
.ms-fn-signature {
  margin-top: 40px; display: flex; align-items: center; gap: 28px;
}
.ms-fn-scribble {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 64px;
  color: var(--ms-fn-ink-blue); line-height: 1; transform: rotate(-3deg);
}
.ms-fn-stamp {
  border: 4px solid var(--ms-fn-stamp); padding: 14px 24px; transform: rotate(-3deg);
  font-family: 'IM Fell English SC', serif; font-size: 30px; color: var(--ms-fn-stamp);
  letter-spacing: .16em; line-height: 1;
  box-shadow: inset 0 0 0 3px rgba(177,67,46,.22);
}
.ms-fn-stamp b {
  display: block; font-family: 'DM Serif Display', serif; font-style: italic;
  font-size: 36px; color: var(--ms-fn-stamp); letter-spacing: 0; margin-top: 4px;
}

/* ─── RIGHT PAGE — polaroid + countdown + agenda ─────── */
.ms-fn-right .ms-fn-inner-right {
  position: absolute; inset: 56px 60px 56px 100px;
  display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr;
  gap: 30px; z-index: 1;
}
.ms-fn-right .ms-fn-pageno {
  position: absolute; top: 24px; left: 32px;
  font-family: 'IM Fell English SC', serif; font-size: 32px; color: var(--ms-fn-ink-2);
  letter-spacing: .18em;
  z-index: 1;
}

/* Polaroid */
.ms-fn-polaroid {
  position: relative;
  background: #fffcf1; padding: 22px 22px 16px;
  border: 3px solid var(--ms-fn-ink);
  box-shadow: 10px 12px 0 rgba(0,0,0,.22);
  transform: rotate(-2.6deg);
}
.ms-fn-polaroid::before {
  content: ''; position: absolute; top: -30px; left: 50%; transform: translateX(-50%);
  width: 60px; height: 90px;
  background: radial-gradient(ellipse at 30% 30%, #e8e8ee 0%, #b0b0bb 50%, #6a6a72 100%);
  border-radius: 30px 30px 30px 30px / 40px 40px 40px 40px;
  clip-path: polygon(20% 0, 80% 0, 80% 70%, 50% 100%, 50% 50%, 70% 50%, 70% 20%, 30% 20%, 30% 80%, 50% 80%, 50% 100%, 20% 70%);
  box-shadow: 2px 4px 0 rgba(0,0,0,.25);
  z-index: 2;
}
.ms-fn-photo {
  height: 380px; position: relative;
  background: radial-gradient(ellipse 90% 70% at 50% 30%, #f2c69a 0%, #c98a52 60%, #6e4523 100%);
  border: 3px solid var(--ms-fn-ink);
  overflow: hidden;
}
.ms-fn-photo svg { width: 100%; height: 100%; display: block; }
.ms-fn-caption {
  margin-top: 18px; font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 48px; color: var(--ms-fn-ink); line-height: 1.05; text-align: center;
}
.ms-fn-caption .ms-fn-cap-ey {
  font-family: 'DM Serif Display', serif; font-style: italic; font-size: 36px;
  color: var(--ms-fn-stamp); display: block; line-height: 1; margin-bottom: 6px;
}
.ms-fn-caption .ms-fn-cap-name {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 54px;
  color: var(--ms-fn-ink); line-height: 1; display: block;
}
.ms-fn-caption span:not(.ms-fn-cap-ey):not(.ms-fn-cap-name) {
  display: block; font-family: 'Work Sans', sans-serif; font-weight: 600; font-size: 26px;
  color: var(--ms-fn-ink-2); margin-top: 6px; letter-spacing: .04em;
}

/* Countdown card */
.ms-fn-countdown {
  background: var(--ms-fn-stamp); color: #fbecc4;
  border: 4px solid var(--ms-fn-ink);
  box-shadow: 10px 12px 0 rgba(0,0,0,.25);
  padding: 28px 36px 32px;
  transform: rotate(1.6deg);
  position: relative;
  display: flex; flex-direction: column; justify-content: space-between;
}
.ms-fn-countdown::before {
  content: ''; position: absolute; top: -3px; left: 0; right: 0; height: 14px;
  background:
    radial-gradient(circle at 6px 0, transparent 6px, var(--ms-fn-stamp) 7px),
    radial-gradient(circle at 6px 14px, transparent 6px, var(--ms-fn-ink) 7px);
  background-size: 24px 14px;
  background-repeat: repeat-x;
}
.ms-fn-countdown::after {
  content: '★'; position: absolute; top: -30px; right: -20px;
  font-family: 'DM Serif Display', serif; font-size: 120px; color: var(--ms-fn-gold);
  transform: rotate(15deg);
  text-shadow: 4px 4px 0 var(--ms-fn-ink);
}
.ms-fn-cd-ey {
  font-family: 'IM Fell English SC', serif; font-size: 30px; color: #fde9b3;
  letter-spacing: .16em; text-transform: uppercase; line-height: 1;
  border-bottom: 3px dashed rgba(253,233,179,.5); padding-bottom: 14px;
}
.ms-fn-cd-num {
  font-family: 'DM Serif Display', serif; font-size: 248px; line-height: .88;
  color: #fff7d6; letter-spacing: -.04em; margin-top: 6px;
  text-shadow: 6px 6px 0 var(--ms-fn-ink);
}
.ms-fn-cd-num span:nth-child(2) {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 80px;
  color: var(--ms-fn-gold); vertical-align: 0.5em; margin-left: 12px;
  text-shadow: 3px 3px 0 var(--ms-fn-ink);
}
.ms-fn-cd-label {
  font-family: 'DM Serif Display', serif; font-style: italic;
  font-size: 48px; color: #fff7d6; line-height: 1; margin-top: 6px;
}
.ms-fn-cd-cap {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 36px;
  color: #fde9b3; line-height: 1.05; margin-top: 14px;
}

/* Agenda — taped notebook page across the bottom */
.ms-fn-agenda {
  grid-column: 1 / span 2;
  background: #fffcf1;
  border: 3px solid var(--ms-fn-ink);
  box-shadow: 10px 12px 0 rgba(0,0,0,.22);
  padding: 28px 40px 32px;
  position: relative;
  transform: rotate(-.4deg);
}
.ms-fn-agenda::before {
  content: ''; position: absolute; top: -20px; left: 50%; transform: translateX(-50%) rotate(-2deg);
  width: 220px; height: 46px;
  background:
    repeating-linear-gradient(45deg,
      var(--ms-fn-gold) 0 10px,
      rgba(255,255,255,.5) 10px 14px,
      var(--ms-fn-gold) 14px 24px);
  box-shadow: 0 3px 0 rgba(0,0,0,.1);
}
.ms-fn-agenda::after {
  content: ''; position: absolute; bottom: 0; right: 0; width: 60px; height: 60px;
  background: linear-gradient(135deg, transparent 50%, var(--ms-fn-paper-edge) 50%);
  border-left: 2px solid var(--ms-fn-ink-2);
  border-top: 2px solid var(--ms-fn-ink-2);
}
.ms-fn-agenda-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  border-bottom: 4px solid var(--ms-fn-ink); padding-bottom: 14px; margin-bottom: 18px;
}
.ms-fn-agenda-h2 {
  font-family: 'DM Serif Display', serif; font-size: 64px; color: var(--ms-fn-ink);
  margin: 0; line-height: 1; letter-spacing: -.01em;
}
.ms-fn-agenda-h2 em {
  font-style: italic; color: var(--ms-fn-stamp);
}
.ms-fn-agenda-day {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 42px; color: var(--ms-fn-ink-blue);
  line-height: 1;
}
.ms-fn-agenda-list {
  list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; grid-template-columns: 1fr 1fr; column-gap: 36px;
}
.ms-fn-agenda-li {
  display: grid; grid-template-columns: 130px 1fr auto; gap: 20px; align-items: baseline;
  padding-bottom: 10px; border-bottom: 1px dashed var(--ms-fn-paper-rule);
  line-height: 1.05;
}
.ms-fn-agenda-li:last-child, .ms-fn-agenda-li:nth-last-child(2) { border-bottom: 0; }
.ms-fn-agenda-li .ms-fn-t {
  font-family: 'DM Serif Display', serif; font-size: 38px; color: var(--ms-fn-stamp);
  letter-spacing: -.01em;
}
.ms-fn-agenda-li .ms-fn-c {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 34px;
  color: var(--ms-fn-ink); letter-spacing: -.005em;
}
.ms-fn-agenda-li .ms-fn-c span {
  display: block; font-family: 'Caveat', cursive; font-weight: 600; font-size: 30px;
  color: var(--ms-fn-ink-2); margin-top: 2px;
}
.ms-fn-agenda-li .ms-fn-x {
  font-family: 'IM Fell English SC', serif; font-size: 24px; color: var(--ms-fn-moss);
  letter-spacing: .14em; text-transform: uppercase;
}
.ms-fn-agenda-li.ms-fn-now {
  background: rgba(177,67,46,.08); padding-left: 14px; padding-right: 14px;
  margin-left: -14px; margin-right: -14px; border-left: 5px solid var(--ms-fn-stamp);
}
.ms-fn-agenda-li.ms-fn-done { opacity: .55; }
.ms-fn-agenda-li.ms-fn-done .ms-fn-c { text-decoration: line-through; }

/* ─── MARGINALIA ROW (4 cards as paper artifacts) ────── */
.ms-fn-margin {
  position: absolute; top: 1520px; left: 64px; right: 64px; height: 440px;
  display: grid; grid-template-columns: 1.05fr 1fr 1fr 1fr; gap: 30px;
  z-index: 2;
}
.ms-fn-card-base {
  background: #fffcf1; border: 3px solid var(--ms-fn-ink);
  box-shadow: 8px 10px 0 var(--ms-fn-shadow);
  padding: 24px 30px 26px; position: relative;
  display: flex; flex-direction: column;
}
.ms-fn-card-ey {
  font-family: 'IM Fell English SC', serif; font-size: 28px; letter-spacing: .18em;
  color: var(--ms-fn-stamp); text-transform: uppercase; line-height: 1;
}
.ms-fn-card-h3 {
  font-family: 'DM Serif Display', serif; font-size: 54px; color: var(--ms-fn-ink);
  line-height: 1; letter-spacing: -.01em; margin: 6px 0 14px;
}

/* Card 1 — LUNCH */
.ms-fn-lunch.ms-fn-card-base {
  background: #f0e0bd;
  transform: rotate(-1.2deg);
  border-style: solid;
}
.ms-fn-lunch::before {
  content: ''; position: absolute; top: -26px; left: 30px;
  width: 42px; height: 74px;
  background: radial-gradient(ellipse at 30% 30%, #e8e8ee 0%, #999aaa 60%, #555562 100%);
  clip-path: polygon(20% 0, 80% 0, 80% 75%, 50% 100%, 50% 55%, 70% 55%, 70% 22%, 30% 22%, 30% 78%, 50% 78%, 50% 100%, 20% 75%);
  box-shadow: 2px 3px 0 rgba(0,0,0,.25);
}
.ms-fn-lunch .ms-fn-card-h3 { color: var(--ms-fn-ink-blue); }
.ms-fn-entree {
  font-family: 'DM Serif Display', serif; font-style: italic;
  font-size: 62px; color: var(--ms-fn-ink); line-height: 1; letter-spacing: -.01em;
}
.ms-fn-sides {
  font-family: 'Work Sans', sans-serif; font-weight: 500; font-size: 28px;
  color: var(--ms-fn-ink-2); margin-top: 14px; line-height: 1.3;
}
.ms-fn-quote {
  margin-top: auto;
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 38px;
  color: var(--ms-fn-moss); line-height: 1.05;
  transform: rotate(-1.2deg); display: inline-block;
  border-top: 2px dashed var(--ms-fn-paper-rule); padding-top: 12px;
}
.ms-fn-quote::before { content: '"'; color: var(--ms-fn-stamp); }
.ms-fn-quote::after { content: '"'; color: var(--ms-fn-stamp); }

/* Card 2 — CLUBS */
.ms-fn-clubs { transform: rotate(.6deg); }
.ms-fn-clubs-ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.ms-fn-clubs-li {
  display: grid; grid-template-columns: 28px 1fr auto; gap: 18px; align-items: baseline;
  padding-bottom: 10px; border-bottom: 1px dashed var(--ms-fn-paper-rule);
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 32px; color: var(--ms-fn-ink);
  line-height: 1.05;
}
.ms-fn-clubs-li:last-child { border-bottom: 0; }
.ms-fn-clubs-li .ms-fn-dot {
  width: 22px; height: 22px; border-radius: 50%;
  border: 3px solid var(--ms-fn-ink); margin-top: 8px;
}
.ms-fn-clubs-li b { font-weight: 800; }
.ms-fn-clubs-li .ms-fn-where {
  display: block; font-family: 'Caveat', cursive; font-weight: 600;
  font-size: 28px; color: var(--ms-fn-ink-2); margin-top: 0;
}
.ms-fn-clubs-li .ms-fn-when {
  font-family: 'IM Fell English SC', serif; font-size: 24px; color: var(--ms-fn-ink-blue);
  letter-spacing: .1em;
}

/* Card 3 — BUSES */
.ms-fn-buses { transform: rotate(-.8deg); background: #fffcf1; }
.ms-fn-buses::after {
  content: ''; position: absolute; top: -18px; right: -14px;
  width: 120px; height: 36px;
  background:
    repeating-linear-gradient(45deg,
      var(--ms-fn-washi-blue) 0 8px,
      rgba(255,255,255,.5) 8px 12px,
      var(--ms-fn-washi-blue) 12px 22px);
  transform: rotate(8deg);
  box-shadow: 0 2px 0 rgba(0,0,0,.1);
}
.ms-fn-buses-ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.ms-fn-buses-li {
  display: grid; grid-template-columns: 88px 1fr auto; gap: 18px; align-items: baseline;
  padding: 8px 0;
  border-bottom: 1px dashed var(--ms-fn-paper-rule);
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 30px;
}
.ms-fn-buses-li:last-child { border-bottom: 0; }
.ms-fn-buses-li .ms-fn-bus-num {
  font-family: 'DM Serif Display', serif; font-size: 42px; color: var(--ms-fn-ink-blue);
  line-height: 1; letter-spacing: -.01em;
}
.ms-fn-buses-li .ms-fn-bus-rt b { display: block; color: var(--ms-fn-ink); font-weight: 700; line-height: 1.05; }
.ms-fn-buses-li .ms-fn-bus-rt span {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 26px;
  color: var(--ms-fn-ink-2);
}
.ms-fn-buses-li .ms-fn-bus-st {
  font-family: 'IM Fell English SC', serif; font-size: 24px; letter-spacing: .1em;
  padding: 4px 12px; border: 2px solid var(--ms-fn-ink); white-space: nowrap;
}
.ms-fn-buses-li .ms-fn-bus-st.ms-fn-on { color: var(--ms-fn-moss); border-color: var(--ms-fn-moss); background: rgba(94,110,52,.08); }
.ms-fn-buses-li .ms-fn-bus-st.ms-fn-late { color: var(--ms-fn-stamp); border-color: var(--ms-fn-stamp); background: rgba(177,67,46,.08); }
.ms-fn-buses-li .ms-fn-bus-st.ms-fn-sched { color: var(--ms-fn-ink-blue); border-color: var(--ms-fn-ink-blue); background: rgba(43,63,107,.06); }

/* Card 4 — SHOUTOUTS */
.ms-fn-shouts { transform: rotate(.4deg); background: #fef4d6; position: relative; overflow: visible; }
.ms-fn-shouts::before {
  content: ''; position: absolute; top: -50px; right: -30px;
  width: 130px; height: 70px;
  background: linear-gradient(to right, transparent 0 60%, var(--ms-fn-ink) 60% 64%, transparent 64% 100%);
  transform: rotate(-22deg);
}
.ms-fn-shouts::after {
  content: '✱'; position: absolute; top: -40px; right: -8px;
  font-size: 60px; color: var(--ms-fn-stamp); transform: rotate(15deg);
  text-shadow: 2px 2px 0 var(--ms-fn-ink);
}
.ms-fn-shouts-ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.ms-fn-shouts-li {
  display: grid; grid-template-columns: 60px 1fr; gap: 18px; align-items: center;
  padding-bottom: 10px; border-bottom: 1px dashed var(--ms-fn-paper-rule);
}
.ms-fn-shouts-li:last-child { border-bottom: 0; }
.ms-fn-shouts-li .ms-fn-ic {
  width: 54px; height: 54px; border-radius: 50%;
  background: var(--ms-fn-gold); border: 3px solid var(--ms-fn-ink);
  display: grid; place-items: center;
  font-family: 'DM Serif Display', serif; font-size: 30px; color: var(--ms-fn-ink);
}
.ms-fn-shouts-li .ms-fn-ic.ms-fn-s2 { background: var(--ms-fn-moss); color: #fff5d8; }
.ms-fn-shouts-li .ms-fn-ic.ms-fn-s3 { background: var(--ms-fn-ink-blue); color: #fff5d8; }
.ms-fn-shouts-li .ms-fn-ic.ms-fn-s4 { background: var(--ms-fn-stamp); color: #fff5d8; }
.ms-fn-shouts-li .ms-fn-name {
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 32px; color: var(--ms-fn-ink);
  line-height: 1.05;
}
.ms-fn-shouts-li .ms-fn-name span:last-child {
  display: block; font-family: 'Caveat', cursive; font-weight: 600;
  font-size: 30px; color: var(--ms-fn-ink-2); margin-top: 2px;
}

/* ─── TICKER ─────────────────────────────────────────── */
.ms-fn-ticker {
  position: absolute; bottom: 20px; left: 64px; right: 64px; height: 160px;
  background: var(--ms-fn-ink);
  color: #f6ecd2;
  border: 4px solid var(--ms-fn-ink);
  box-shadow: 10px 12px 0 var(--ms-fn-stamp);
  display: grid; grid-template-columns: auto 1fr; align-items: stretch;
  overflow: hidden;
  z-index: 2;
}
.ms-fn-ticker-tag {
  background: var(--ms-fn-stamp); color: #fff5d8;
  padding: 0 48px;
  display: flex; align-items: center; gap: 18px;
  font-family: 'DM Serif Display', serif; font-style: italic; font-size: 64px;
  letter-spacing: 0;
  border-right: 4px solid var(--ms-fn-ink);
  box-shadow: inset 0 -8px 0 rgba(0,0,0,.18);
}
.ms-fn-ticker-tag::before {
  content: '✎'; font-style: normal; font-size: 54px; color: var(--ms-fn-gold);
}
.ms-fn-feed {
  overflow: hidden; display: flex; align-items: center; padding-left: 40px;
}
.ms-fn-feed-inner {
  display: flex; gap: 70px; white-space: nowrap;
  font-family: 'Work Sans', sans-serif; font-weight: 600; font-size: 54px; color: #f6ecd2;
  letter-spacing: .02em;
  animation: msFnScroll 70s linear infinite;
}
.ms-fn-feed-inner span { display: inline-flex; align-items: center; }
.ms-fn-feed-inner span::after {
  content: '✦'; color: var(--ms-fn-gold); margin-left: 32px; font-size: 46px;
}
@keyframes msFnScroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

/* ─── Marginalia decorations layered on the spread ───── */
.ms-fn-blot {
  position: absolute; top: 380px; right: 140px; width: 90px; height: 90px;
  background: var(--ms-fn-ink-blue-dk);
  border-radius: 50% 60% 40% 50% / 60% 40% 60% 50%;
  transform: rotate(18deg);
  box-shadow: 24px 36px 0 rgba(26,44,82,.4);
  z-index: 3;
  opacity: .85;
}
.ms-fn-blot::after {
  content: ''; position: absolute; top: 80px; left: -40px; width: 30px; height: 30px;
  background: var(--ms-fn-ink-blue-dk); border-radius: 50%; opacity: .7;
}
`;
