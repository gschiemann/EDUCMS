"use client";

/**
 * MsFieldnotesPortraitWidget — Middle-school lobby scene (PORTRAIT 2160×3840).
 *
 * APPROVED 2026-04-25 — matches scratch/design/fieldnotes-ms-portrait-v1.html.
 * Portrait sibling to MsFieldnotesWidget.
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsFieldnotesPortraitConfig {
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
  // Page number
  'pageno.l'?: string;
  // Hero copy
  'greeting.chapter'?: string;
  'greeting.h1a'?: string;
  'greeting.h1b'?: string;
  'greeting.h1c'?: string;
  'greeting.h1d'?: string;
  'greeting.lede'?: string;
  'greeting.scribble'?: string;
  'greeting.stampname'?: string;
  // Specimen card
  'specimen.latin'?: string;
  'specimen.common'?: string;
  'specimen.meta'?: string;
  // Polaroid spotlight
  'spotlight.ey'?: string;
  'spotlight.name'?: string;
  'spotlight.note'?: string;
  // Countdown
  'countdown.num'?: string;
  'countdown.unit'?: string;
  'countdown.ey'?: string;
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

export const DEFAULTS: Required<MsFieldnotesPortraitConfig> = {
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
  'weather.cap': 'clear · light SW wind',
  'clock.k': 'Right Now',
  'clock.v': '7:53',
  'clock.cap': 'first bell at 8:05',
  'bell.k': 'Day',
  'bell.v': 'B',
  'bell.cap': 'rotation — 7 periods',
  // Page number
  'pageno.l': '— pg. 284 —',
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
  // Specimen
  'specimen.latin': 'Lutra schoolus',
  'specimen.common': '"the everyday otter"',
  'specimen.meta': 'Pressed · 21 Apr · pg. 284',
  // Polaroid
  'spotlight.ey': 'Specimen of the Day',
  'spotlight.name': 'Mr. Nguyen, P2 English',
  'spotlight.note': 'Room 108 · poetry workshop · birthdays today: 2',
  // Countdown
  'countdown.num': '12',
  'countdown.unit': 'days',
  'countdown.ey': 'FIELD DAY · sign-ups close',
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
  'lunch.sides':
    'Roasted broccoli · garlic bread · seasonal fruit. Salad bar all period. Veg + GF on request.',
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
  'shouts.1.note': '3rd · regional math olympiad',
  'shouts.2.ic': '7B',
  'shouts.2.name': "Ms. Chen's class",
  'shouts.2.note': '14-day homework streak',
  'shouts.3.ic': '📚',
  'shouts.3.name': 'Library crew',
  'shouts.3.note': '100 books read · this quarter',
  // Ticker
  'ticker.tag': 'P.S.',
  'ticker.0': 'Picture day moved to Thursday — full uniform — slips due Wed',
  'ticker.1': 'Sub in rm B-12 today — Mr. Diaz',
  'ticker.2': 'Spelling bee sign-ups end Friday',
  'ticker.3': 'Yearbook photos need names + grade',
  'ticker.4': '8th graders — field trip forms due tomorrow',
  'ticker.5': 'Lost blue water bottle → front office',
};

const pick = <K extends keyof Required<MsFieldnotesPortraitConfig>>(
  cfg: MsFieldnotesPortraitConfig,
  key: K,
): string => (cfg[key] ?? DEFAULTS[key]) as string;

export function MsFieldnotesPortraitWidget({
  config,
}: {
  config?: MsFieldnotesPortraitConfig;
}) {
  const cfg = config || {};

  // Bus status pill class — per-row, baked from the mockup choices.
  const busStClass = ['on', 'late', 'sched', 'on'] as const;
  // Club dot colors — per-row, baked from the mockup inline styles.
  const clubDotColor = [
    'var(--ms-fn-p-ink-blue)',
    'var(--ms-fn-p-stamp)',
    'var(--ms-fn-p-moss)',
    'var(--ms-fn-p-gold)',
  ] as const;
  // Shoutout icon variant per row.
  const shoutClass = ['', 's2', 's3', 's4'] as const;

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background:
          'radial-gradient(ellipse 1500px 2000px at 50% 50%, rgba(255,236,196,.07), transparent 70%), radial-gradient(ellipse 900px 1200px at 8% 96%, rgba(0,0,0,.20), transparent 70%), radial-gradient(ellipse 800px 1100px at 92% 4%, rgba(0,0,0,.16), transparent 70%), radial-gradient(ellipse 600px 800px at 88% 60%, rgba(120,70,30,.14), transparent 70%), #d8c39c',
        backgroundColor: '#d8c39c',
        fontFamily: "'Work Sans', system-ui, sans-serif",
        color: '#1e1a14',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Stage-level kraft-paper noise overlay (mockup .stage::before) */}
      <div className="ms-fn-p-stage-noise" aria-hidden="true" />
      {/* Stage-level foxing stains (mockup .stage::after) */}
      <div className="ms-fn-p-stage-foxing" aria-hidden="true" />

      {/* Decorative kraft-paper layers */}
      <div className="ms-fn-p-leather-spine" aria-hidden="true" />
      <div className="ms-fn-p-coffee" aria-hidden="true" />
      <div className="ms-fn-p-blot" aria-hidden="true" />
      <div className="ms-fn-p-scribble-note" aria-hidden="true">
        try the cinnamon roll
      </div>

      {/* ─── 1. MASTHEAD ─────────────────────────────────────── */}
      <header className="ms-fn-p-panel ms-fn-p-mast">
        <div className="ms-fn-p-compass" aria-hidden="true">
          <span className="ms-fn-p-card ms-fn-p-n">N</span>
          <span className="ms-fn-p-card ms-fn-p-s">S</span>
          <span className="ms-fn-p-card ms-fn-p-e">E</span>
          <span className="ms-fn-p-card ms-fn-p-w">W</span>
          <span className="ms-fn-p-pivot" />
        </div>
        <div className="ms-fn-p-info" data-widget="school">
          <div className="ms-fn-p-ey">
            <span data-field="school.ey" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.ey')}</span>
          </div>
          <div className="ms-fn-p-ttl">
            <span data-field="school.name" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.name')}</span>{' '}
            <em data-field="school.amp" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.amp')}</em>{' '}
            <span data-field="school.mascot" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.mascot')}</span>
          </div>
          <div className="ms-fn-p-sub" data-field="school.sub" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'school.sub')}
          </div>
        </div>
        <div className="ms-fn-p-seal" data-widget="brand">
          <div className="ms-fn-p-disc">
            <div className="ms-fn-p-vol" data-field="brand.vol" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'brand.vol')}
            </div>
            <div className="ms-fn-p-num" data-field="brand.num" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'brand.num')}
            </div>
            <div className="ms-fn-p-day" data-field="brand.day" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'brand.day')}
            </div>
          </div>
        </div>
      </header>

      {/* ─── 2. STAMPS ───────────────────────────────────────── */}
      <section className="ms-fn-p-panel ms-fn-p-stamps">
        <div className="ms-fn-p-tile" data-widget="weather">
          <span className="ms-fn-p-k" data-field="weather.k" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'weather.k')}
          </span>
          <span className="ms-fn-p-v ms-fn-p-cool" data-field="weather.v" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'weather.v')}
          </span>
          <span className="ms-fn-p-cap" data-field="weather.cap" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'weather.cap')}
          </span>
        </div>
        <div className="ms-fn-p-tile" data-widget="clock">
          <span className="ms-fn-p-k" data-field="clock.k" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'clock.k')}
          </span>
          <span className="ms-fn-p-v" data-field="clock.v" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'clock.v')}
          </span>
          <span className="ms-fn-p-cap" data-field="clock.cap" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'clock.cap')}
          </span>
        </div>
        <div className="ms-fn-p-tile" data-widget="bell">
          <span className="ms-fn-p-k" data-field="bell.k" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'bell.k')}
          </span>
          <span className="ms-fn-p-v ms-fn-p-warm" data-field="bell.v" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'bell.v')}
          </span>
          <span className="ms-fn-p-cap" data-field="bell.cap" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'bell.cap')}
          </span>
        </div>
      </section>

      {/* ─── 3. HERO ─────────────────────────────────────────── */}
      <section className="ms-fn-p-panel ms-fn-p-hero" data-widget="greeting">
        <span className="ms-fn-p-pageno">
          <span data-field="pageno.l" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'pageno.l')}</span>
        </span>
        <div className="ms-fn-p-chapter" data-field="greeting.chapter" style={{ whiteSpace: 'pre-wrap' }}>
          {pick(cfg, 'greeting.chapter')}
        </div>
        <h1 className="ms-fn-p-h1">
          <span data-field="greeting.h1a" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h1a')}</span>{' '}
          <em data-field="greeting.h1b" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h1b')}</em>
          <br />
          <u data-field="greeting.h1c" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h1c')}</u>{' '}
          <span data-field="greeting.h1d" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h1d')}</span>
        </h1>
        <div className="ms-fn-p-quillbar" aria-hidden="true" />
        <p className="ms-fn-p-lede" data-field="greeting.lede" style={{ whiteSpace: 'pre-wrap' }}>
          {pick(cfg, 'greeting.lede')}
        </p>
        <div className="ms-fn-p-signature">
          <span className="ms-fn-p-scribble" data-field="greeting.scribble" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'greeting.scribble')}
          </span>
          <span className="ms-fn-p-stamp">
            Approved by
            <br />
            <b data-field="greeting.stampname" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.stampname')}</b>
          </span>
        </div>
      </section>

      {/* ─── 4. DUO — specimen + polaroid ────────────────────── */}
      <section className="ms-fn-p-panel ms-fn-p-duo">
        <div className="ms-fn-p-specimen" data-widget="specimen">
          <div className="ms-fn-p-leaf" aria-hidden="true">
            <svg viewBox="0 0 260 320" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="ms-fn-p-leafg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7d8a3a" />
                  <stop offset="100%" stopColor="#4a5520" />
                </linearGradient>
              </defs>
              <path
                d="M130 305 C 132 240, 132 170, 130 100"
                stroke="#3b2a14"
                strokeWidth="4"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M130 100
                   C 60 90, 25 130, 35 175
                   C 42 220, 95 250, 130 245
                   C 165 250, 218 220, 225 175
                   C 235 130, 200 90, 130 100 Z"
                fill="url(#ms-fn-p-leafg)"
                stroke="#1e1a14"
                strokeWidth="3.5"
              />
              <path
                d="M130 100 L 130 245
                   M130 130 L 75 160 M130 150 L 60 180 M130 170 L 65 200 M130 190 L 80 220 M130 210 L 100 235
                   M130 130 L 185 160 M130 150 L 200 180 M130 170 L 195 200 M130 190 L 180 220 M130 210 L 160 235"
                stroke="#1e1a14"
                strokeWidth="1.5"
                fill="none"
                opacity=".55"
              />
              <ellipse cx="80" cy="60" rx="22" ry="28" fill="#a36a28" stroke="#1e1a14" strokeWidth="3" />
              <path
                d="M58 50 Q 80 34 102 50 L 102 64 Q 80 56 58 64 Z"
                fill="#5b3d10"
                stroke="#1e1a14"
                strokeWidth="2.5"
              />
              <line x1="80" y1="34" x2="80" y2="20" stroke="#1e1a14" strokeWidth="3" />
              <ellipse cx="170" cy="48" rx="18" ry="24" fill="#b87a35" stroke="#1e1a14" strokeWidth="3" />
              <path
                d="M152 40 Q 170 28 188 40 L 188 52 Q 170 44 152 52 Z"
                fill="#5b3d10"
                stroke="#1e1a14"
                strokeWidth="2.5"
              />
              <path
                d="M210 215 C 235 210, 245 230, 235 250 C 220 260, 200 245, 205 225 Z"
                fill="#6e7a36"
                stroke="#1e1a14"
                strokeWidth="2.5"
              />
            </svg>
          </div>
          <div className="ms-fn-p-latin" data-field="specimen.latin" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'specimen.latin')}
          </div>
          <div className="ms-fn-p-common" data-field="specimen.common" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'specimen.common')}
          </div>
          <div className="ms-fn-p-meta" data-field="specimen.meta" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'specimen.meta')}
          </div>
        </div>

        <div className="ms-fn-p-polaroid" data-widget="spotlight">
          <div className="ms-fn-p-photo" aria-hidden="true">
            <svg
              viewBox="0 0 260 380"
              xmlns="http://www.w3.org/2000/svg"
              preserveAspectRatio="xMidYMid slice"
            >
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
              <path
                d="M112 200 Q 130 215 148 200"
                stroke="#3a2410"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="ms-fn-p-caption">
            <span className="ms-fn-p-cap-ey" data-field="spotlight.ey" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'spotlight.ey')}
            </span>
            <span className="ms-fn-p-cap-name" data-field="spotlight.name" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'spotlight.name')}
            </span>
            <span className="ms-fn-p-cap-note" data-field="spotlight.note" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'spotlight.note')}
            </span>
          </div>
        </div>
      </section>

      {/* ─── 5. COUNTDOWN ────────────────────────────────────── */}
      <section className="ms-fn-p-panel ms-fn-p-countdown" data-widget="countdown">
        <div className="ms-fn-p-num-block">
          <span className="ms-fn-p-num" data-field="countdown.num" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'countdown.num')}
          </span>
          <span className="ms-fn-p-unit" data-field="countdown.unit" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'countdown.unit')}
          </span>
        </div>
        <div className="ms-fn-p-text-block">
          <div className="ms-fn-p-cd-ey" data-field="countdown.ey" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'countdown.ey')}
          </div>
          <div className="ms-fn-p-cd-label" data-field="countdown.label" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'countdown.label')}
          </div>
          <div className="ms-fn-p-cd-cap" data-field="countdown.cap" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'countdown.cap')}
          </div>
        </div>
      </section>

      {/* ─── 6. AGENDA ───────────────────────────────────────── */}
      <section className="ms-fn-p-panel ms-fn-p-agenda" data-widget="agenda">
        <div className="ms-fn-p-agenda-head">
          <h2 className="ms-fn-p-agenda-h2">
            <span data-field="agenda.h" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.h')}</span>{' '}
            <em data-field="agenda.h2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.h2')}</em>
          </h2>
          <div className="ms-fn-p-agenda-day" data-field="agenda.day" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'agenda.day')}
          </div>
        </div>
        <ul className="ms-fn-p-agenda-list">
          {([0, 1, 2, 3, 4, 5, 6] as const).map((i) => {
            const liClass = i === 0 ? 'ms-fn-p-done' : i === 1 ? 'ms-fn-p-now' : '';
            const xStyle: React.CSSProperties =
              i === 1 ? { color: 'var(--ms-fn-p-stamp)' } : {};
            return (
              <li
                key={i}
                className={`ms-fn-p-agenda-li ${liClass}`.trim()}
                data-widget={`agenda.${i}`}
              >
                <span className="ms-fn-p-t" data-field={`agenda.${i}.t`} style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, `agenda.${i}.t` as keyof Required<MsFieldnotesPortraitConfig>)}
                </span>
                <span className="ms-fn-p-c">
                  <span data-field={`agenda.${i}.c`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `agenda.${i}.c` as keyof Required<MsFieldnotesPortraitConfig>)}
                  </span>{' '}
                  <span className="ms-fn-p-r" data-field={`agenda.${i}.r`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `agenda.${i}.r` as keyof Required<MsFieldnotesPortraitConfig>)}
                  </span>
                </span>
                <span className="ms-fn-p-x" style={{ ...xStyle, whiteSpace: 'pre-wrap' as const }} data-field={`agenda.${i}.x`}>
                  {pick(cfg, `agenda.${i}.x` as keyof Required<MsFieldnotesPortraitConfig>)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ─── 7. LUNCH ────────────────────────────────────────── */}
      <section className="ms-fn-p-panel ms-fn-p-lunch" data-widget="lunch">
        <div className="ms-fn-p-title-block">
          <div className="ms-fn-p-lunch-ey" data-field="lunch.ey" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'lunch.ey')}
          </div>
          <h3 className="ms-fn-p-lunch-h" data-field="lunch.h" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'lunch.h')}
          </h3>
        </div>
        <div className="ms-fn-p-menu-block">
          <div className="ms-fn-p-entree" data-field="lunch.entree" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'lunch.entree')}
          </div>
          <div className="ms-fn-p-sides" data-field="lunch.sides" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'lunch.sides')}
          </div>
        </div>
        <div className="ms-fn-p-quote" data-field="lunch.quote" style={{ whiteSpace: 'pre-wrap' }}>
          {pick(cfg, 'lunch.quote')}
        </div>
      </section>

      {/* ─── 8. DUO2 — clubs + buses ─────────────────────────── */}
      <section className="ms-fn-p-panel ms-fn-p-duo2">
        <div className="ms-fn-p-clubs" data-widget="clubs">
          <div className="ms-fn-p-clubs-ey" data-field="clubs.ey" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'clubs.ey')}
          </div>
          <h3 className="ms-fn-p-clubs-h" data-field="clubs.h" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'clubs.h')}
          </h3>
          <ul className="ms-fn-p-clubs-ul">
            {([0, 1, 2, 3] as const).map((i) => (
              <li key={i} className="ms-fn-p-clubs-li" data-widget={`clubs.${i}`}>
                <span className="ms-fn-p-dot" style={{ background: clubDotColor[i] }} />
                <span>
                  <b data-field={`clubs.${i}.n`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `clubs.${i}.n` as keyof Required<MsFieldnotesPortraitConfig>)}
                  </b>
                  <span className="ms-fn-p-where" data-field={`clubs.${i}.r`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `clubs.${i}.r` as keyof Required<MsFieldnotesPortraitConfig>)}
                  </span>
                </span>
                <span className="ms-fn-p-when" data-field={`clubs.${i}.w`} style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, `clubs.${i}.w` as keyof Required<MsFieldnotesPortraitConfig>)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="ms-fn-p-buses" data-widget="buses">
          <div className="ms-fn-p-buses-ey" data-field="buses.ey" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'buses.ey')}
          </div>
          <h3 className="ms-fn-p-buses-h" data-field="buses.h" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'buses.h')}
          </h3>
          <ul className="ms-fn-p-buses-ul">
            {([0, 1, 2, 3] as const).map((i) => (
              <li key={i} className="ms-fn-p-buses-li" data-widget={`buses.${i}`}>
                <span className="ms-fn-p-bus-num" data-field={`buses.${i}.num`} style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, `buses.${i}.num` as keyof Required<MsFieldnotesPortraitConfig>)}
                </span>
                <span className="ms-fn-p-bus-rt">
                  <b data-field={`buses.${i}.rt`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `buses.${i}.rt` as keyof Required<MsFieldnotesPortraitConfig>)}
                  </b>
                  <span data-field={`buses.${i}.note`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `buses.${i}.note` as keyof Required<MsFieldnotesPortraitConfig>)}
                  </span>
                </span>
                <span
                  className={`ms-fn-p-bus-st ms-fn-p-${busStClass[i]}`}
                  data-field={`buses.${i}.st`}
                 style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, `buses.${i}.st` as keyof Required<MsFieldnotesPortraitConfig>)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── 9. SHOUTOUTS ────────────────────────────────────── */}
      <section className="ms-fn-p-panel ms-fn-p-shouts" data-widget="shouts">
        <div className="ms-fn-p-shouts-head">
          <span className="ms-fn-p-shouts-ey" data-field="shouts.ey" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'shouts.ey')}
          </span>
          <h3 className="ms-fn-p-shouts-h" data-field="shouts.h" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'shouts.h')}
          </h3>
        </div>
        <ul className="ms-fn-p-shouts-ul">
          {([0, 1, 2, 3] as const).map((i) => {
            const klass = shoutClass[i] ? `ms-fn-p-${shoutClass[i]}` : '';
            return (
              <li key={i} className="ms-fn-p-shouts-li" data-widget={`shouts.${i}`}>
                <span className={`ms-fn-p-ic ${klass}`.trim()} data-field={`shouts.${i}.ic`} style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, `shouts.${i}.ic` as keyof Required<MsFieldnotesPortraitConfig>)}
                </span>
                <span className="ms-fn-p-name">
                  <span data-field={`shouts.${i}.name`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `shouts.${i}.name` as keyof Required<MsFieldnotesPortraitConfig>)}
                  </span>
                  <span data-field={`shouts.${i}.note`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `shouts.${i}.note` as keyof Required<MsFieldnotesPortraitConfig>)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ─── 10. TICKER ──────────────────────────────────────── */}
      <footer className="ms-fn-p-panel ms-fn-p-ticker" data-widget="ticker">
        <div className="ms-fn-p-ticker-tag">
          <span data-field="ticker.tag" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.tag')}</span>
        </div>
        <div className="ms-fn-p-feed">
          <div className="ms-fn-p-feed-inner">
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

/** Inlined CSS — every pixel value matches scratch/design/fieldnotes-ms-portrait-v1.html.
 *  The mockup's scale wrapper boilerplate (.viewport / .stage-outer /
 *  .stage / fit() script) is replaced by HsStage; everything else is
 *  ported verbatim with a `ms-fn-p-` prefix. */
const CSS = `
*, *::before, *::after { box-sizing: border-box; }

:root {
  --ms-fn-p-kraft: #d8c39c;
  --ms-fn-p-kraft-deep: #b89870;
  --ms-fn-p-paper: #f6ecd2;
  --ms-fn-p-paper-edge: #e6d6b3;
  --ms-fn-p-paper-rule: #b9a070;
  --ms-fn-p-ink: #1e1a14;
  --ms-fn-p-ink-2: #4a3f2f;
  --ms-fn-p-ink-blue: #2b3f6b;
  --ms-fn-p-ink-blue-dk: #1a2c52;
  --ms-fn-p-stamp: #b1432e;
  --ms-fn-p-stamp-dk: #8a311e;
  --ms-fn-p-moss: #5e6e34;
  --ms-fn-p-gold: #b58a2e;
  --ms-fn-p-sepia: rgba(70, 45, 18, .15);
  --ms-fn-p-washi-blue: #6b8fb5;
  --ms-fn-p-washi-coral: #cf8870;
  --ms-fn-p-shadow: rgba(40, 22, 8, .35);
}

/* Stage kraft-paper noise overlay (mockup .stage::before) */
.ms-fn-p-stage-noise {
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    radial-gradient(rgba(60,38,12,.16) 1px, transparent 1.5px),
    radial-gradient(rgba(120,90,50,.10) 1px, transparent 2px);
  background-size: 11px 11px, 23px 23px;
  background-position: 0 0, 5px 7px;
  mix-blend-mode: multiply;
  opacity: .65;
}
/* Foxing stains overlay (mockup .stage::after) */
.ms-fn-p-stage-foxing {
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    radial-gradient(circle at 92% 18%, rgba(120,70,30,.18) 0 80px, transparent 120px),
    radial-gradient(circle at 6% 42%, rgba(120,70,30,.14) 0 60px, transparent 110px),
    radial-gradient(circle at 95% 78%, rgba(140,90,40,.12) 0 100px, transparent 160px),
    radial-gradient(circle at 4% 88%, rgba(120,70,30,.16) 0 70px, transparent 130px);
  mix-blend-mode: multiply;
}

/* Leather spine fragment running down the right edge */
.ms-fn-p-leather-spine {
  position: absolute; top: 0; bottom: 0; right: 0; width: 30px;
  z-index: 1; pointer-events: none;
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
.ms-fn-p-leather-spine::before {
  content: ''; position: absolute; left: 50%; top: 30px; bottom: 30px; width: 2px;
  transform: translateX(-50%);
  background: repeating-linear-gradient(180deg, #d8b370 0 14px, transparent 14px 26px);
}

/* Coffee ring smudge — top-left corner accent */
.ms-fn-p-coffee {
  position: absolute; top: 36px; left: 80px; width: 240px; height: 240px;
  border-radius: 50%;
  border: 14px solid rgba(112, 70, 30, .20);
  pointer-events: none;
  box-shadow: inset 0 -6px 0 rgba(112, 70, 30, .14);
  transform: rotate(-12deg);
  z-index: 1;
}
.ms-fn-p-coffee::after {
  content: ''; position: absolute; left: -30px; top: 90px; width: 48px; height: 14px;
  border-radius: 50%;
  background: rgba(112, 70, 30, .18);
  transform: rotate(-25deg);
}

/* Ink blot — between hero and duo row, mid-stage */
.ms-fn-p-blot {
  position: absolute; top: 1340px; right: 120px; width: 90px; height: 90px;
  background: var(--ms-fn-p-ink-blue-dk);
  border-radius: 50% 60% 40% 50% / 60% 40% 60% 50%;
  transform: rotate(18deg);
  box-shadow: 24px 36px 0 rgba(26,44,82,.4);
  z-index: 5;
  opacity: .85;
  pointer-events: none;
}
.ms-fn-p-blot::after {
  content: ''; position: absolute; top: 80px; left: -40px; width: 30px; height: 30px;
  background: var(--ms-fn-p-ink-blue-dk); border-radius: 50%; opacity: .7;
}

/* Hand-written marginal note next to hero */
.ms-fn-p-scribble-note {
  position: absolute; top: 1290px; left: 120px;
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 54px;
  color: var(--ms-fn-p-ink-blue); transform: rotate(-3deg); line-height: 1;
  z-index: 5; pointer-events: none;
}
.ms-fn-p-scribble-note::before {
  content: '↳'; color: var(--ms-fn-p-stamp); font-size: 60px; padding-right: 14px;
}

/* ═══ PANEL BASE ═══ */
.ms-fn-p-panel {
  position: absolute; left: 64px; right: 64px;
  overflow: hidden;
  z-index: 3;
}

/* ─── 1. MASTHEAD (y=40, h=360) ─── */
.ms-fn-p-mast {
  top: 40px; height: 360px;
  display: grid; grid-template-columns: 320px 1fr 340px; gap: 48px; align-items: center;
}
.ms-fn-p-compass {
  width: 300px; height: 300px; flex-shrink: 0; position: relative;
  border-radius: 50%;
  background:
    radial-gradient(circle at 35% 30%, #f6deaa 0%, #d6a85c 35%, #9a6e22 70%, #5b3d10 100%);
  box-shadow:
    inset 0 0 0 8px #6e4a14,
    inset 0 0 0 16px #c8923d,
    inset 0 -22px 48px rgba(0,0,0,.45),
    14px 16px 0 rgba(0,0,0,.18),
    0 8px 32px rgba(0,0,0,.4);
}
.ms-fn-p-compass::before {
  content: ''; position: absolute; inset: 46px;
  border-radius: 50%;
  background:
    repeating-conic-gradient(from -90deg, var(--ms-fn-p-ink) 0 1.5deg, transparent 1.5deg 30deg),
    radial-gradient(circle, #f6ecd2 0%, #e3d2a8 75%, #c5a672 100%);
  box-shadow: inset 0 0 0 4px var(--ms-fn-p-ink-2);
}
.ms-fn-p-compass::after {
  content: ''; position: absolute; top: 50%; left: 50%; width: 18px; height: 210px;
  transform: translate(-50%,-50%) rotate(-22deg);
  background:
    linear-gradient(180deg, var(--ms-fn-p-stamp) 0 50%, var(--ms-fn-p-ink) 50% 100%);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  box-shadow: 0 0 14px rgba(0,0,0,.35);
}
.ms-fn-p-pivot {
  position: absolute; top: 50%; left: 50%; width: 30px; height: 30px;
  transform: translate(-50%,-50%);
  background: radial-gradient(circle at 35% 30%, #ffe9b6, #b58a2e 60%, #6b4a14);
  border-radius: 50%;
  box-shadow: 0 3px 6px rgba(0,0,0,.5);
}
.ms-fn-p-card {
  position: absolute; font-family: 'IM Fell English SC', serif; font-size: 38px;
  color: var(--ms-fn-p-ink); font-weight: 400; letter-spacing: .06em;
}
.ms-fn-p-card.ms-fn-p-n { top: 60px; left: 50%; transform: translateX(-50%); color: var(--ms-fn-p-stamp); font-weight: 700; }
.ms-fn-p-card.ms-fn-p-s { bottom: 60px; left: 50%; transform: translateX(-50%); }
.ms-fn-p-card.ms-fn-p-e { right: 60px; top: 50%; transform: translateY(-50%); }
.ms-fn-p-card.ms-fn-p-w { left: 60px; top: 50%; transform: translateY(-50%); }

.ms-fn-p-info { padding: 0 8px; }
.ms-fn-p-info .ms-fn-p-ey {
  font-family: 'IM Fell English SC', serif; font-size: 42px; color: var(--ms-fn-p-stamp);
  letter-spacing: .18em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 22px;
}
.ms-fn-p-info .ms-fn-p-ey::before {
  content: ''; width: 84px; height: 5px; background: var(--ms-fn-p-stamp);
}
.ms-fn-p-info .ms-fn-p-ttl {
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 148px; line-height: .92; color: var(--ms-fn-p-ink);
  letter-spacing: -.015em; margin-top: 8px;
  text-shadow: 3px 3px 0 rgba(0,0,0,.06);
}
.ms-fn-p-info .ms-fn-p-ttl em {
  font-style: italic; color: var(--ms-fn-p-stamp);
}
.ms-fn-p-info .ms-fn-p-sub {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 54px;
  color: var(--ms-fn-p-ink-2); margin-top: 10px; letter-spacing: .01em;
}

/* Wax seal — entry number stamp */
.ms-fn-p-seal {
  justify-self: end; position: relative; width: 340px; height: 340px;
  display: grid; place-items: center; text-align: center;
}
.ms-fn-p-seal::before {
  content: ''; position: absolute; left: 50%; top: -8px; transform: translateX(-50%) rotate(-8deg);
  width: 150px; height: 44px;
  background: var(--ms-fn-p-stamp);
  clip-path: polygon(15% 0, 85% 0, 100% 100%, 70% 60%, 50% 100%, 30% 60%, 0 100%);
  filter: drop-shadow(0 4px 0 var(--ms-fn-p-stamp-dk));
  z-index: 1;
}
.ms-fn-p-disc {
  width: 280px; height: 280px; border-radius: 50%;
  background:
    radial-gradient(circle at 38% 30%, rgba(255,255,255,.35), transparent 30%),
    radial-gradient(circle, var(--ms-fn-p-stamp) 0 60%, var(--ms-fn-p-stamp-dk) 100%);
  box-shadow:
    inset 0 -14px 28px rgba(0,0,0,.35),
    8px 10px 0 rgba(0,0,0,.18);
  display: grid; place-items: center;
  border: 5px solid var(--ms-fn-p-stamp-dk);
  position: relative;
}
.ms-fn-p-disc::before {
  content: ''; position: absolute; inset: 22px; border-radius: 50%;
  border: 3px dashed rgba(255,236,196,.5);
}
.ms-fn-p-vol {
  font-family: 'IM Fell English SC', serif; color: #fff5d8; font-size: 34px;
  letter-spacing: .16em; line-height: 1; padding-top: 18px;
}
.ms-fn-p-num {
  font-family: 'DM Serif Display', serif; color: #fff5d8; font-size: 120px;
  line-height: 1; letter-spacing: -.02em;
}
.ms-fn-p-day {
  font-family: 'Caveat', cursive; color: #fff5d8; font-size: 40px;
  line-height: 1; padding-bottom: 18px; opacity: .92;
}

/* ─── 2. STAMPS row (y=420, h=260) ─── */
.ms-fn-p-stamps {
  top: 420px; height: 260px;
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 36px;
}
.ms-fn-p-tile {
  padding: 28px 32px; position: relative;
  background: #fff7e0;
  border: 5px solid var(--ms-fn-p-ink);
  box-shadow: 10px 12px 0 var(--ms-fn-p-ink), 0 0 0 10px var(--ms-fn-p-paper) inset;
  display: flex; flex-direction: column; justify-content: space-between;
  transform: rotate(-1deg);
}
.ms-fn-p-tile:nth-child(2) { transform: rotate(.8deg); }
.ms-fn-p-tile:nth-child(3) { transform: rotate(-.4deg); }
.ms-fn-p-tile .ms-fn-p-k {
  font-family: 'IM Fell English SC', serif; font-size: 34px; color: var(--ms-fn-p-ink-2);
  letter-spacing: .18em; text-transform: uppercase; line-height: 1;
}
.ms-fn-p-tile .ms-fn-p-v {
  font-family: 'DM Serif Display', serif; font-size: 128px; color: var(--ms-fn-p-ink);
  line-height: .9; letter-spacing: -.02em;
}
.ms-fn-p-tile .ms-fn-p-v.ms-fn-p-cool { color: var(--ms-fn-p-ink-blue); }
.ms-fn-p-tile .ms-fn-p-v.ms-fn-p-warm { color: var(--ms-fn-p-stamp); }
.ms-fn-p-tile .ms-fn-p-v.ms-fn-p-brass { color: var(--ms-fn-p-gold); }
.ms-fn-p-tile .ms-fn-p-cap {
  font-family: 'Caveat', cursive; font-size: 36px; color: var(--ms-fn-p-ink-2); line-height: 1;
}

/* ─── 3. HERO (y=700, h=680) ─── */
.ms-fn-p-hero {
  top: 700px; height: 680px;
  background: linear-gradient(180deg, var(--ms-fn-p-paper) 0%, var(--ms-fn-p-paper-edge) 100%);
  border: 4px solid var(--ms-fn-p-ink);
  box-shadow:
    14px 18px 0 rgba(0,0,0,.22),
    inset 0 0 80px rgba(160,120,60,.12);
  padding: 56px 80px 48px 200px;
}
.ms-fn-p-hero::before {
  content: ''; position: absolute; inset: 0;
  background-image:
    repeating-linear-gradient(180deg, transparent 0 79px, rgba(110, 80, 40, .22) 79px 81px);
  pointer-events: none;
}
.ms-fn-p-hero::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: 140px; width: 4px;
  background: var(--ms-fn-p-stamp); opacity: .55;
}
.ms-fn-p-hero .ms-fn-p-pageno {
  position: absolute; top: 24px; right: 36px;
  font-family: 'IM Fell English SC', serif; font-size: 34px; color: var(--ms-fn-p-ink-2);
  letter-spacing: .18em;
  z-index: 2;
}
.ms-fn-p-hero .ms-fn-p-chapter {
  font-family: 'IM Fell English SC', serif; font-size: 38px; color: var(--ms-fn-p-stamp);
  letter-spacing: .22em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 22px;
  position: relative; z-index: 2;
}
.ms-fn-p-hero .ms-fn-p-chapter::before {
  content: ''; width: 64px; height: 5px; background: var(--ms-fn-p-stamp);
}
.ms-fn-p-hero .ms-fn-p-h1 {
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 240px; line-height: .86; letter-spacing: -.025em;
  color: var(--ms-fn-p-ink); margin: 18px 0 0; text-wrap: balance;
  position: relative; z-index: 2;
}
.ms-fn-p-hero .ms-fn-p-h1 em {
  font-style: italic; color: var(--ms-fn-p-stamp);
}
.ms-fn-p-hero .ms-fn-p-h1 u {
  text-decoration: none;
  background: linear-gradient(transparent 70%, rgba(181,138,46,.55) 70% 92%, transparent 92%);
  padding: 0 12px;
}
.ms-fn-p-hero .ms-fn-p-quillbar {
  margin-top: 26px; height: 30px; width: 60%;
  background:
    radial-gradient(ellipse 70% 100% at 0% 50%, var(--ms-fn-p-ink) 0 60%, transparent 70%),
    radial-gradient(ellipse 60% 100% at 100% 50%, var(--ms-fn-p-ink) 0 50%, transparent 70%),
    linear-gradient(90deg, var(--ms-fn-p-ink) 0%, var(--ms-fn-p-ink) 100%);
  clip-path: polygon(0 60%, 4% 30%, 14% 50%, 40% 35%, 60% 55%, 80% 35%, 96% 60%, 100% 70%, 80% 90%, 50% 75%, 25% 85%, 8% 70%);
  opacity: .9;
  position: relative; z-index: 2;
}
.ms-fn-p-hero .ms-fn-p-lede {
  font-family: 'Work Sans', sans-serif; font-weight: 500;
  font-size: 54px; line-height: 1.32; color: var(--ms-fn-p-ink-2);
  margin-top: 30px; max-width: 1700px;
  position: relative; z-index: 2;
}
.ms-fn-p-hero .ms-fn-p-lede em {
  font-style: normal; font-family: 'Caveat', cursive; font-weight: 700;
  color: var(--ms-fn-p-stamp); font-size: 62px; padding: 0 6px;
}
.ms-fn-p-hero .ms-fn-p-signature {
  margin-top: 36px; display: flex; align-items: center; gap: 36px;
  position: relative; z-index: 2;
}
.ms-fn-p-hero .ms-fn-p-signature .ms-fn-p-scribble {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 76px;
  color: var(--ms-fn-p-ink-blue); line-height: 1; transform: rotate(-3deg);
}
.ms-fn-p-hero .ms-fn-p-signature .ms-fn-p-stamp {
  border: 5px solid var(--ms-fn-p-stamp); padding: 16px 28px; transform: rotate(-3deg);
  font-family: 'IM Fell English SC', serif; font-size: 34px; color: var(--ms-fn-p-stamp);
  letter-spacing: .16em; line-height: 1;
  box-shadow: inset 0 0 0 3px rgba(177,67,46,.22);
}
.ms-fn-p-hero .ms-fn-p-signature .ms-fn-p-stamp b {
  display: block; font-family: 'DM Serif Display', serif; font-style: italic;
  font-size: 42px; color: var(--ms-fn-p-stamp); letter-spacing: 0; margin-top: 6px;
}

/* ─── 4. DUO row (y=1400, h=600) ─── */
.ms-fn-p-duo {
  top: 1400px; height: 600px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 40px;
  overflow: visible;
}
.ms-fn-p-specimen {
  position: relative;
  background: linear-gradient(180deg, #fbf3df 0%, #ead7ae 100%);
  border: 4px solid var(--ms-fn-p-ink);
  box-shadow: 8px 10px 0 rgba(0,0,0,.25);
  transform: rotate(-2deg);
  padding: 36px 32px 32px;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.ms-fn-p-specimen::before, .ms-fn-p-specimen::after {
  content: ''; position: absolute;
  width: 160px; height: 50px;
  background:
    repeating-linear-gradient(45deg,
      var(--ms-fn-p-washi-blue) 0 10px,
      rgba(255,255,255,.4) 10px 14px,
      var(--ms-fn-p-washi-blue) 14px 26px);
  box-shadow: 0 2px 0 rgba(0,0,0,.08);
}
.ms-fn-p-specimen::before { top: -24px; left: -30px; transform: rotate(-12deg); }
.ms-fn-p-specimen::after {
  bottom: -18px; right: -26px; transform: rotate(8deg);
  background:
    repeating-linear-gradient(-45deg,
      var(--ms-fn-p-washi-coral) 0 10px,
      rgba(255,255,255,.4) 10px 14px,
      var(--ms-fn-p-washi-coral) 14px 26px);
}
.ms-fn-p-specimen .ms-fn-p-leaf {
  width: 380px; height: 360px; margin: 8px auto 0; position: relative;
}
.ms-fn-p-specimen .ms-fn-p-leaf svg { width: 100%; height: 100%; display: block; }
.ms-fn-p-specimen .ms-fn-p-latin {
  font-family: 'DM Serif Display', serif; font-style: italic; font-size: 48px;
  color: var(--ms-fn-p-ink-2); text-align: center; line-height: 1; margin-top: 24px;
}
.ms-fn-p-specimen .ms-fn-p-common {
  font-family: 'Caveat', cursive; font-size: 54px; color: var(--ms-fn-p-stamp);
  text-align: center; line-height: 1; margin-top: 10px;
}
.ms-fn-p-specimen .ms-fn-p-meta {
  font-family: 'IM Fell English SC', serif; font-size: 28px; color: var(--ms-fn-p-ink-2);
  text-align: center; letter-spacing: .16em; margin-top: 18px;
  border-top: 2px dashed rgba(0,0,0,.25); padding-top: 14px;
}

/* Polaroid */
.ms-fn-p-polaroid {
  position: relative;
  background: #fffcf1; padding: 28px 28px 22px;
  border: 4px solid var(--ms-fn-p-ink);
  box-shadow: 12px 14px 0 rgba(0,0,0,.22);
  transform: rotate(2.4deg);
  display: flex; flex-direction: column;
}
.ms-fn-p-polaroid::before {
  content: ''; position: absolute; top: -36px; left: 50%; transform: translateX(-50%);
  width: 64px; height: 96px;
  background:
    radial-gradient(ellipse at 30% 30%, #e8e8ee 0%, #b0b0bb 50%, #6a6a72 100%);
  border-radius: 32px 32px 32px 32px / 42px 42px 42px 42px;
  clip-path: polygon(20% 0, 80% 0, 80% 70%, 50% 100%, 50% 50%, 70% 50%, 70% 20%, 30% 20%, 30% 80%, 50% 80%, 50% 100%, 20% 70%);
  box-shadow: 2px 4px 0 rgba(0,0,0,.25);
  z-index: 2;
}
.ms-fn-p-polaroid .ms-fn-p-photo {
  height: 380px; position: relative;
  background:
    radial-gradient(ellipse 90% 70% at 50% 30%, #f2c69a 0%, #c98a52 60%, #6e4523 100%);
  border: 4px solid var(--ms-fn-p-ink);
  overflow: hidden;
}
.ms-fn-p-polaroid .ms-fn-p-photo svg { width: 100%; height: 100%; display: block; }
.ms-fn-p-polaroid .ms-fn-p-caption {
  margin-top: 18px; padding: 0 8px;
  font-family: 'Caveat', cursive; font-weight: 700;
  color: var(--ms-fn-p-ink); line-height: 1.05; text-align: center;
}
.ms-fn-p-polaroid .ms-fn-p-cap-ey {
  font-family: 'DM Serif Display', serif; font-style: italic; font-size: 40px;
  color: var(--ms-fn-p-stamp); display: block; line-height: 1; margin-bottom: 8px;
}
.ms-fn-p-polaroid .ms-fn-p-cap-name {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 62px;
  color: var(--ms-fn-p-ink); line-height: 1; display: block;
}
.ms-fn-p-polaroid .ms-fn-p-cap-note {
  display: block; font-family: 'Work Sans', sans-serif; font-weight: 600; font-size: 30px;
  color: var(--ms-fn-p-ink-2); margin-top: 8px; letter-spacing: .04em;
}

/* ─── 5. COUNTDOWN (y=2020, h=240) ─── */
.ms-fn-p-countdown {
  top: 2020px; height: 240px;
  background: var(--ms-fn-p-stamp); color: #fbecc4;
  border: 5px solid var(--ms-fn-p-ink);
  box-shadow: 12px 14px 0 rgba(0,0,0,.25);
  padding: 28px 56px 32px;
  transform: rotate(.6deg);
  display: grid; grid-template-columns: auto 1fr; gap: 48px; align-items: center;
  overflow: visible;
}
.ms-fn-p-countdown::before {
  content: ''; position: absolute; top: -3px; left: 0; right: 0; height: 14px;
  background:
    radial-gradient(circle at 6px 0, transparent 6px, var(--ms-fn-p-stamp) 7px),
    radial-gradient(circle at 6px 14px, transparent 6px, var(--ms-fn-p-ink) 7px);
  background-size: 24px 14px;
  background-repeat: repeat-x;
}
.ms-fn-p-countdown::after {
  content: '★'; position: absolute; top: -46px; right: 32px;
  font-family: 'DM Serif Display'; font-size: 160px; color: var(--ms-fn-p-gold);
  transform: rotate(15deg);
  text-shadow: 5px 5px 0 var(--ms-fn-p-ink);
  line-height: 1;
}
.ms-fn-p-countdown .ms-fn-p-num-block {
  display: flex; align-items: baseline; gap: 14px;
  font-family: 'DM Serif Display', serif; line-height: .88;
  color: #fff7d6; letter-spacing: -.04em;
  text-shadow: 5px 5px 0 var(--ms-fn-p-ink);
}
.ms-fn-p-countdown .ms-fn-p-num {
  font-size: 200px;
}
.ms-fn-p-countdown .ms-fn-p-unit {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 72px;
  color: var(--ms-fn-p-gold);
  text-shadow: 3px 3px 0 var(--ms-fn-p-ink);
}
.ms-fn-p-countdown .ms-fn-p-text-block {
  display: flex; flex-direction: column; gap: 10px;
}
.ms-fn-p-countdown .ms-fn-p-cd-ey {
  font-family: 'IM Fell English SC', serif; font-size: 32px; color: #fde9b3;
  letter-spacing: .16em; text-transform: uppercase; line-height: 1;
  border-bottom: 3px dashed rgba(253,233,179,.5); padding-bottom: 10px;
}
.ms-fn-p-countdown .ms-fn-p-cd-label {
  font-family: 'DM Serif Display', serif; font-style: italic;
  font-size: 54px; color: #fff7d6; line-height: 1;
}
.ms-fn-p-countdown .ms-fn-p-cd-cap {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 38px;
  color: #fde9b3; line-height: 1.1;
}

/* ─── 6. AGENDA (y=2280, h=520) ─── */
.ms-fn-p-agenda {
  top: 2280px; height: 520px;
  background: #fffcf1;
  border: 4px solid var(--ms-fn-p-ink);
  box-shadow: 12px 14px 0 rgba(0,0,0,.22);
  padding: 30px 56px 36px;
  transform: rotate(-.3deg);
}
.ms-fn-p-agenda::before {
  content: ''; position: absolute; top: -22px; left: 50%; transform: translateX(-50%) rotate(-2deg);
  width: 280px; height: 52px;
  background:
    repeating-linear-gradient(45deg,
      var(--ms-fn-p-gold) 0 12px,
      rgba(255,255,255,.5) 12px 16px,
      var(--ms-fn-p-gold) 16px 28px);
  box-shadow: 0 3px 0 rgba(0,0,0,.1);
  z-index: 2;
}
.ms-fn-p-agenda::after {
  content: ''; position: absolute; bottom: 0; right: 0; width: 64px; height: 64px;
  background: linear-gradient(135deg, transparent 50%, var(--ms-fn-p-paper-edge) 50%);
  border-left: 2px solid var(--ms-fn-p-ink-2);
  border-top: 2px solid var(--ms-fn-p-ink-2);
}
.ms-fn-p-agenda .ms-fn-p-agenda-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  border-bottom: 5px solid var(--ms-fn-p-ink); padding-bottom: 14px; margin-bottom: 14px;
}
.ms-fn-p-agenda .ms-fn-p-agenda-h2 {
  font-family: 'DM Serif Display', serif; font-size: 74px; color: var(--ms-fn-p-ink);
  margin: 0; line-height: 1; letter-spacing: -.01em;
}
.ms-fn-p-agenda .ms-fn-p-agenda-h2 em {
  font-style: italic; color: var(--ms-fn-p-stamp);
}
.ms-fn-p-agenda .ms-fn-p-agenda-day {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 48px; color: var(--ms-fn-p-ink-blue);
  line-height: 1;
}
.ms-fn-p-agenda .ms-fn-p-agenda-list {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: 8px;
}
.ms-fn-p-agenda .ms-fn-p-agenda-li {
  display: grid; grid-template-columns: 180px 1fr auto; gap: 30px; align-items: baseline;
  padding-bottom: 8px; border-bottom: 1px dashed var(--ms-fn-p-paper-rule);
  line-height: 1.05;
}
.ms-fn-p-agenda .ms-fn-p-agenda-li:last-child { border-bottom: 0; padding-bottom: 0; }
.ms-fn-p-agenda .ms-fn-p-agenda-li .ms-fn-p-t {
  font-family: 'DM Serif Display', serif; font-size: 48px; color: var(--ms-fn-p-stamp);
  letter-spacing: -.01em;
}
.ms-fn-p-agenda .ms-fn-p-agenda-li .ms-fn-p-c {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 42px;
  color: var(--ms-fn-p-ink); letter-spacing: -.005em;
  display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap;
}
.ms-fn-p-agenda .ms-fn-p-agenda-li .ms-fn-p-c span.ms-fn-p-r {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 34px;
  color: var(--ms-fn-p-ink-2);
}
.ms-fn-p-agenda .ms-fn-p-agenda-li .ms-fn-p-x {
  font-family: 'IM Fell English SC', serif; font-size: 28px; color: var(--ms-fn-p-moss);
  letter-spacing: .14em; text-transform: uppercase;
}
.ms-fn-p-agenda .ms-fn-p-agenda-li.ms-fn-p-now {
  background: rgba(177,67,46,.08); padding: 6px 14px;
  margin-left: -14px; margin-right: -14px;
  border-left: 6px solid var(--ms-fn-p-stamp);
  border-bottom: 1px dashed var(--ms-fn-p-paper-rule);
}
.ms-fn-p-agenda .ms-fn-p-agenda-li.ms-fn-p-done { opacity: .55; }
.ms-fn-p-agenda .ms-fn-p-agenda-li.ms-fn-p-done .ms-fn-p-c span:first-child { text-decoration: line-through; }

/* ─── 7. LUNCH (y=2820, h=240) ─── */
.ms-fn-p-lunch {
  top: 2820px; height: 240px;
  background: #f0e0bd;
  border: 4px solid var(--ms-fn-p-ink);
  box-shadow: 10px 12px 0 var(--ms-fn-p-shadow);
  padding: 28px 36px;
  transform: rotate(-.8deg);
  display: grid; grid-template-columns: 380px 1fr 460px; gap: 40px; align-items: center;
  overflow: visible;
}
.ms-fn-p-lunch::before {
  content: ''; position: absolute; top: -30px; left: 60px;
  width: 46px; height: 80px;
  background: radial-gradient(ellipse at 30% 30%, #e8e8ee 0%, #999aaa 60%, #555562 100%);
  clip-path: polygon(20% 0, 80% 0, 80% 75%, 50% 100%, 50% 55%, 70% 55%, 70% 22%, 30% 22%, 30% 78%, 50% 78%, 50% 100%, 20% 75%);
  box-shadow: 2px 3px 0 rgba(0,0,0,.25);
  z-index: 2;
}
.ms-fn-p-lunch .ms-fn-p-title-block .ms-fn-p-lunch-ey {
  font-family: 'IM Fell English SC', serif; font-size: 30px; letter-spacing: .18em;
  color: var(--ms-fn-p-stamp); text-transform: uppercase; line-height: 1;
}
.ms-fn-p-lunch .ms-fn-p-title-block .ms-fn-p-lunch-h {
  font-family: 'DM Serif Display', serif; font-size: 64px; color: var(--ms-fn-p-ink-blue);
  line-height: 1; letter-spacing: -.01em; margin: 8px 0 0;
}
.ms-fn-p-lunch .ms-fn-p-entree {
  font-family: 'DM Serif Display', serif; font-style: italic;
  font-size: 60px; color: var(--ms-fn-p-ink); line-height: 1; letter-spacing: -.01em;
}
.ms-fn-p-lunch .ms-fn-p-sides {
  font-family: 'Work Sans'; font-weight: 500; font-size: 30px;
  color: var(--ms-fn-p-ink-2); margin-top: 14px; line-height: 1.3;
}
.ms-fn-p-lunch .ms-fn-p-quote {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 42px;
  color: var(--ms-fn-p-moss); line-height: 1.1;
  transform: rotate(-1.2deg); display: inline-block;
  border-top: 2px dashed var(--ms-fn-p-paper-rule); padding-top: 14px;
  border-bottom: 2px dashed var(--ms-fn-p-paper-rule); padding-bottom: 14px;
  text-align: right;
}
.ms-fn-p-lunch .ms-fn-p-quote::before { content: '"'; color: var(--ms-fn-p-stamp); }
.ms-fn-p-lunch .ms-fn-p-quote::after { content: '"'; color: var(--ms-fn-p-stamp); }

/* ─── 8. DUO2 — clubs + buses (y=3080, h=300) ─── */
.ms-fn-p-duo2 {
  top: 3080px; height: 300px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 36px;
  overflow: visible;
}
.ms-fn-p-clubs, .ms-fn-p-buses {
  background: #fffcf1; border: 4px solid var(--ms-fn-p-ink);
  box-shadow: 8px 10px 0 var(--ms-fn-p-shadow);
  padding: 22px 30px 24px; position: relative;
  overflow: hidden;
}
.ms-fn-p-clubs { transform: rotate(.6deg); }
.ms-fn-p-buses { transform: rotate(-.6deg); }
.ms-fn-p-clubs .ms-fn-p-clubs-ey, .ms-fn-p-buses .ms-fn-p-buses-ey {
  font-family: 'IM Fell English SC', serif; font-size: 28px; letter-spacing: .18em;
  color: var(--ms-fn-p-stamp); text-transform: uppercase; line-height: 1;
}
.ms-fn-p-clubs .ms-fn-p-clubs-h, .ms-fn-p-buses .ms-fn-p-buses-h {
  font-family: 'DM Serif Display', serif; font-size: 48px; color: var(--ms-fn-p-ink);
  line-height: 1; letter-spacing: -.01em; margin: 6px 0 12px;
}
.ms-fn-p-clubs .ms-fn-p-clubs-ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.ms-fn-p-clubs .ms-fn-p-clubs-li {
  display: grid; grid-template-columns: 28px 1fr auto; gap: 18px; align-items: baseline;
  padding-bottom: 6px; border-bottom: 1px dashed var(--ms-fn-p-paper-rule);
  font-family: 'Work Sans'; font-weight: 700; font-size: 30px; color: var(--ms-fn-p-ink);
  line-height: 1.05;
}
.ms-fn-p-clubs .ms-fn-p-clubs-li:last-child { border-bottom: 0; }
.ms-fn-p-clubs .ms-fn-p-clubs-li .ms-fn-p-dot {
  width: 22px; height: 22px; border-radius: 50%;
  border: 3px solid var(--ms-fn-p-ink); margin-top: 8px;
}
.ms-fn-p-clubs .ms-fn-p-clubs-li b { font-weight: 800; }
.ms-fn-p-clubs .ms-fn-p-clubs-li .ms-fn-p-where {
  display: block; font-family: 'Caveat', cursive; font-weight: 600;
  font-size: 26px; color: var(--ms-fn-p-ink-2);
}
.ms-fn-p-clubs .ms-fn-p-clubs-li .ms-fn-p-when {
  font-family: 'IM Fell English SC', serif; font-size: 24px; color: var(--ms-fn-p-ink-blue);
  letter-spacing: .1em;
}

.ms-fn-p-buses::after {
  content: ''; position: absolute; top: -18px; right: -14px;
  width: 140px; height: 40px;
  background:
    repeating-linear-gradient(45deg,
      var(--ms-fn-p-washi-blue) 0 10px,
      rgba(255,255,255,.5) 10px 14px,
      var(--ms-fn-p-washi-blue) 14px 26px);
  transform: rotate(8deg);
  box-shadow: 0 2px 0 rgba(0,0,0,.1);
  z-index: 2;
}
.ms-fn-p-buses .ms-fn-p-buses-ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.ms-fn-p-buses .ms-fn-p-buses-li {
  display: grid; grid-template-columns: 96px 1fr auto; gap: 18px; align-items: baseline;
  padding: 5px 0;
  border-bottom: 1px dashed var(--ms-fn-p-paper-rule);
  font-family: 'Work Sans'; font-weight: 700; font-size: 28px;
}
.ms-fn-p-buses .ms-fn-p-buses-li:last-child { border-bottom: 0; }
.ms-fn-p-buses .ms-fn-p-buses-li .ms-fn-p-bus-num {
  font-family: 'DM Serif Display', serif; font-size: 42px; color: var(--ms-fn-p-ink-blue);
  line-height: 1; letter-spacing: -.01em;
}
.ms-fn-p-buses .ms-fn-p-buses-li .ms-fn-p-bus-rt b { display: block; color: var(--ms-fn-p-ink); font-weight: 700; line-height: 1.05; }
.ms-fn-p-buses .ms-fn-p-buses-li .ms-fn-p-bus-rt span {
  font-family: 'Caveat', cursive; font-weight: 600; font-size: 24px;
  color: var(--ms-fn-p-ink-2);
}
.ms-fn-p-buses .ms-fn-p-buses-li .ms-fn-p-bus-st {
  font-family: 'IM Fell English SC', serif; font-size: 22px; letter-spacing: .1em;
  padding: 3px 12px; border: 2px solid var(--ms-fn-p-ink); white-space: nowrap;
}
.ms-fn-p-buses .ms-fn-p-buses-li .ms-fn-p-bus-st.ms-fn-p-on { color: var(--ms-fn-p-moss); border-color: var(--ms-fn-p-moss); background: rgba(94,110,52,.08); }
.ms-fn-p-buses .ms-fn-p-buses-li .ms-fn-p-bus-st.ms-fn-p-late { color: var(--ms-fn-p-stamp); border-color: var(--ms-fn-p-stamp); background: rgba(177,67,46,.08); }
.ms-fn-p-buses .ms-fn-p-buses-li .ms-fn-p-bus-st.ms-fn-p-sched { color: var(--ms-fn-p-ink-blue); border-color: var(--ms-fn-p-ink-blue); background: rgba(43,63,107,.06); }

/* ─── 9. SHOUTOUTS (y=3400, h=220) ─── */
.ms-fn-p-shouts {
  top: 3400px; height: 220px;
  background: #fef4d6; border: 4px solid var(--ms-fn-p-ink);
  box-shadow: 8px 10px 0 var(--ms-fn-p-shadow);
  padding: 22px 32px 24px;
  transform: rotate(.3deg);
  overflow: visible;
}
.ms-fn-p-shouts::before {
  content: ''; position: absolute; top: -44px; right: -22px;
  width: 120px; height: 60px;
  background:
    linear-gradient(to right, transparent 0 60%, var(--ms-fn-p-ink) 60% 64%, transparent 64% 100%);
  transform: rotate(-22deg);
  z-index: 2;
}
.ms-fn-p-shouts::after {
  content: '✱'; position: absolute; top: -36px; right: -2px;
  font-size: 64px; color: var(--ms-fn-p-stamp); transform: rotate(15deg);
  text-shadow: 2px 2px 0 var(--ms-fn-p-ink);
  z-index: 3;
}
.ms-fn-p-shouts .ms-fn-p-shouts-head {
  display: flex; align-items: baseline; gap: 24px; margin-bottom: 10px;
}
.ms-fn-p-shouts .ms-fn-p-shouts-head .ms-fn-p-shouts-ey {
  font-family: 'IM Fell English SC', serif; font-size: 26px; letter-spacing: .18em;
  color: var(--ms-fn-p-stamp); text-transform: uppercase; line-height: 1;
}
.ms-fn-p-shouts .ms-fn-p-shouts-head .ms-fn-p-shouts-h {
  font-family: 'DM Serif Display', serif; font-size: 44px; color: var(--ms-fn-p-ink);
  line-height: 1; letter-spacing: -.01em; margin: 0;
}
.ms-fn-p-shouts .ms-fn-p-shouts-ul {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: 6px 40px; grid-template-columns: 1fr 1fr;
}
.ms-fn-p-shouts .ms-fn-p-shouts-li {
  display: grid; grid-template-columns: 60px 1fr; gap: 18px; align-items: center;
  padding-bottom: 4px; border-bottom: 1px dashed var(--ms-fn-p-paper-rule);
}
.ms-fn-p-shouts .ms-fn-p-shouts-li:nth-last-child(-n+2) { border-bottom: 0; }
.ms-fn-p-shouts .ms-fn-p-shouts-li .ms-fn-p-ic {
  width: 54px; height: 54px; border-radius: 50%;
  background: var(--ms-fn-p-gold); border: 3px solid var(--ms-fn-p-ink);
  display: grid; place-items: center;
  font-family: 'DM Serif Display'; font-size: 30px; color: var(--ms-fn-p-ink);
}
.ms-fn-p-shouts .ms-fn-p-shouts-li .ms-fn-p-ic.ms-fn-p-s2 { background: var(--ms-fn-p-moss); color: #fff5d8; }
.ms-fn-p-shouts .ms-fn-p-shouts-li .ms-fn-p-ic.ms-fn-p-s3 { background: var(--ms-fn-p-ink-blue); color: #fff5d8; }
.ms-fn-p-shouts .ms-fn-p-shouts-li .ms-fn-p-ic.ms-fn-p-s4 { background: var(--ms-fn-p-stamp); color: #fff5d8; }
.ms-fn-p-shouts .ms-fn-p-shouts-li .ms-fn-p-name {
  font-family: 'Work Sans'; font-weight: 800; font-size: 28px; color: var(--ms-fn-p-ink);
  line-height: 1.05;
}
.ms-fn-p-shouts .ms-fn-p-shouts-li .ms-fn-p-name span {
  display: block; font-family: 'Caveat', cursive; font-weight: 600;
  font-size: 26px; color: var(--ms-fn-p-ink-2); margin-top: 2px;
}

/* ─── 10. TICKER (y=3640, h=160) ─── */
.ms-fn-p-ticker {
  top: 3640px; height: 160px;
  background: var(--ms-fn-p-ink);
  color: #f6ecd2;
  border: 5px solid var(--ms-fn-p-ink);
  box-shadow: 10px 12px 0 var(--ms-fn-p-stamp);
  display: grid; grid-template-columns: auto 1fr; align-items: stretch;
  overflow: hidden;
}
.ms-fn-p-ticker .ms-fn-p-ticker-tag {
  background: var(--ms-fn-p-stamp); color: #fff5d8;
  padding: 0 56px;
  display: flex; align-items: center; gap: 22px;
  font-family: 'DM Serif Display', serif; font-style: italic; font-size: 74px;
  letter-spacing: 0;
  border-right: 5px solid var(--ms-fn-p-ink);
  box-shadow: inset 0 -10px 0 rgba(0,0,0,.18);
}
.ms-fn-p-ticker .ms-fn-p-ticker-tag::before {
  content: '✎'; font-style: normal; font-size: 64px; color: var(--ms-fn-p-gold);
}
.ms-fn-p-ticker .ms-fn-p-feed {
  overflow: hidden; display: flex; align-items: center; padding-left: 48px;
}
.ms-fn-p-ticker .ms-fn-p-feed-inner {
  display: flex; gap: 80px; white-space: nowrap;
  font-family: 'Work Sans'; font-weight: 600; font-size: 60px; color: #f6ecd2;
  letter-spacing: .02em;
  animation: msFnPScroll 70s linear infinite;
}
.ms-fn-p-ticker .ms-fn-p-feed-inner span { display: inline-flex; align-items: center; }
.ms-fn-p-ticker .ms-fn-p-feed-inner span::after {
  content: '✦'; color: var(--ms-fn-p-gold); margin-left: 36px; font-size: 50px;
}
@keyframes msFnPScroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
`;
