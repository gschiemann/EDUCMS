"use client";

/**
 * MsGreenhousePortraitWidget — Middle-school lobby scene (PORTRAIT 2160×3840).
 *
 * APPROVED 2026-04-25 — matches scratch/design/greenhouse-ms-portrait-v1.html.
 * Portrait sibling to MsGreenhouseWidget.
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsGreenhousePortraitConfig {
  // Top band — conservatory lockup
  'school.eye'?: string;
  'school.name'?: string;
  'school.name2'?: string;
  'school.latin'?: string;
  'school.day'?: string;
  'school.tag'?: string;
  // Top band — instrument gauges
  'weather.label'?: string;
  'weather.temp'?: string;
  'weather.cond'?: string;
  'clock.label'?: string;
  'clock.time'?: string;
  'clock.sub'?: string;
  'bloom.label'?: string;
  'bloom.value'?: string;
  'bloom.sub'?: string;
  // Hero — herbarium plate
  'greeting.acc'?: string;
  'greeting.acc2'?: string;
  'greeting.kicker'?: string;
  'greeting.h1'?: string;
  'greeting.h2'?: string;
  'greeting.h3'?: string;
  'greeting.h4'?: string;
  'greeting.lede'?: string;
  'greeting.sign'?: string;
  // Specimens index — today's periods
  'agenda.title'?: string;
  'agenda.date'?: string;
  'agenda.label'?: string;
  'agenda.0.t'?: string;
  'agenda.0.l'?: string;
  'agenda.0.r'?: string;
  'agenda.0.h'?: string;
  'agenda.0.s'?: string;
  'agenda.1.t'?: string;
  'agenda.1.l'?: string;
  'agenda.1.r'?: string;
  'agenda.1.h'?: string;
  'agenda.1.s'?: string;
  'agenda.2.t'?: string;
  'agenda.2.l'?: string;
  'agenda.2.r'?: string;
  'agenda.2.h'?: string;
  'agenda.2.s'?: string;
  'agenda.3.t'?: string;
  'agenda.3.l'?: string;
  'agenda.3.r'?: string;
  'agenda.3.h'?: string;
  'agenda.3.s'?: string;
  'agenda.4.t'?: string;
  'agenda.4.l'?: string;
  'agenda.4.r'?: string;
  'agenda.4.h'?: string;
  'agenda.4.s'?: string;
  'agenda.5.t'?: string;
  'agenda.5.l'?: string;
  'agenda.5.r'?: string;
  'agenda.5.h'?: string;
  'agenda.5.s'?: string;
  // Mid band — seed-packet club cards
  'club.0.dept'?: string;
  'club.0.lot'?: string;
  'club.0.t'?: string;
  'club.0.l'?: string;
  'club.0.r'?: string;
  'club.0.h'?: string;
  'club.0.tag'?: string;
  'club.1.dept'?: string;
  'club.1.lot'?: string;
  'club.1.t'?: string;
  'club.1.l'?: string;
  'club.1.r'?: string;
  'club.1.h'?: string;
  'club.1.tag'?: string;
  'club.2.dept'?: string;
  'club.2.lot'?: string;
  'club.2.t'?: string;
  'club.2.l'?: string;
  'club.2.r'?: string;
  'club.2.h'?: string;
  'club.2.tag'?: string;
  // Pinned announcement card
  'announcement.stamp'?: string;
  'announcement.headline'?: string;
  'announcement.message'?: string;
  // Countdown almanac
  'countdown.value'?: string;
  'countdown.unit'?: string;
  'countdown.kicker'?: string;
  'countdown.title'?: string;
  'countdown.title2'?: string;
  'countdown.title3'?: string;
  'countdown.sub'?: string;
  // Cafeteria signpost
  'lunch.eye'?: string;
  'lunch.title'?: string;
  'lunch.sides'?: string;
  'lunch.sides2'?: string;
  'lunch.b1'?: string;
  'lunch.b2'?: string;
  // Ticker
  'ticker.tag'?: string;
  'ticker.0'?: string;
  'ticker.1'?: string;
  'ticker.2'?: string;
  'ticker.3'?: string;
  'ticker.4'?: string;
  'ticker.5'?: string;
  'ticker.6'?: string;
}

export const DEFAULTS: Required<MsGreenhousePortraitConfig> = {
  'school.eye': 'The Lobby Conservatory',
  'school.name': 'Westridge ',
  'school.name2': 'Middle',
  'school.latin': 'Domus lutrae · ',
  'school.day': 'Day B',
  'school.tag': ' · Volume 142, Tuesday Edition',
  'weather.label': 'Outdoor',
  'weather.temp': '46°',
  'weather.cond': 'overcast · light wind',
  'clock.label': 'Hour',
  'clock.time': '7:53',
  'clock.sub': 'Tue · Apr 21',
  'bloom.label': 'Sun-up',
  'bloom.value': '6:21',
  'bloom.sub': '12h 47m of light',
  'greeting.acc': 'Plate XLII',
  'greeting.acc2': 'Accession Nº 1924-14\nCataloged: Mr. Nguyen, Curator',
  'greeting.kicker': "From the Curator's Desk · Morning Brief",
  'greeting.h1': 'Grow ',
  'greeting.h2': 'something',
  'greeting.h3': ' ',
  'greeting.h4': 'today.',
  'greeting.lede':
    "Something small. Say hello at your locker. Ask about the poetry prompt. Finish the math packet you've been putting off. Small things root first. That's how big things bloom.",
  'greeting.sign': 'the Westridge gardeners',
  'agenda.title': "Today's Specimens",
  'agenda.date': 'Tue · Apr 21',
  'agenda.label': 'Day B · 6 entries',
  'agenda.0.t': 'Math 7',
  'agenda.0.l': 'Algebra patelii · ',
  'agenda.0.r': 'Rm 214',
  'agenda.0.h': '8:05',
  'agenda.0.s': 'harvested',
  'agenda.1.t': 'English · Poetry',
  'agenda.1.l': 'Verba nguyenii · ',
  'agenda.1.r': 'Rm 108',
  'agenda.1.h': '9:00',
  'agenda.1.s': 'in bloom',
  'agenda.2.t': 'Science · Lab',
  'agenda.2.l': 'Methodus okaforii · ',
  'agenda.2.r': 'Rm 207',
  'agenda.2.h': '9:55',
  'agenda.2.s': 'budding',
  'agenda.3.t': 'PE · Mile Run',
  'agenda.3.l': 'Cursus reyesii · ',
  'agenda.3.r': 'Gym A',
  'agenda.3.h': '10:50',
  'agenda.3.s': 'germinating',
  'agenda.4.t': 'Lunch · A-Period',
  'agenda.4.l': 'Refectorium · ',
  'agenda.4.r': '7th grade',
  'agenda.4.h': '11:45',
  'agenda.4.s': 'seeded',
  'agenda.5.t': 'Social Studies',
  'agenda.5.l': 'Atlas mundi · ',
  'agenda.5.r': 'Rm 115',
  'agenda.5.h': '12:35',
  'agenda.5.s': 'dormant',
  'club.0.dept': 'After-School · Bed 1',
  'club.0.lot': '№ 014',
  'club.0.t': 'Robotics',
  'club.0.l': 'Mechanus juvenilis · build week',
  'club.0.r': 'Rm 207 · Mr. Becker',
  'club.0.h': 'Today · 3:00',
  'club.0.tag': 'rare cultivar',
  'club.1.dept': 'After-School · Bed 2',
  'club.1.lot': '№ 022',
  'club.1.t': 'Drama Auditions',
  'club.1.l': 'Theatrum vernale · "Echoes"',
  'club.1.r': 'Auditorium · Ms. Rivera',
  'club.1.h': 'Today · 3:15',
  'club.1.tag': 'heirloom',
  'club.2.dept': 'After-School · Bed 3',
  'club.2.lot': '№ 031',
  'club.2.t': 'Garden Club',
  'club.2.l': 'Hortus societas · seedling day',
  'club.2.r': 'Greenhouse · Ms. Park',
  'club.2.h': 'Today · 3:00',
  'club.2.tag': 'in season',
  'announcement.stamp': "Heads-up · Curator's Notice",
  'announcement.headline': 'Picture day — Thursday',
  'announcement.message':
    'Full uniform. Permission slips to the front office by Wed EOD. 6th grade goes first by homeroom. Bring your sunny face.',
  'countdown.value': '12',
  'countdown.unit': 'days',
  'countdown.kicker': 'Field Day · Almanac',
  'countdown.title': 'Sign-ups ',
  'countdown.title2': 'bloom',
  'countdown.title3': ' Friday.',
  'countdown.sub':
    '284 otters already in. Pass the word at lunch tables.',
  'lunch.eye': 'From the Cafeteria · Bed N° 4',
  'lunch.title': 'Chicken & Rice Bowl',
  'lunch.sides': 'broccoli · garlic bread · seasonal fruit · ',
  'lunch.sides2': 'salad bar open',
  'lunch.b1': 'veg ok',
  'lunch.b2': 'gf swap',
  'ticker.tag': 'Postscript —',
  'ticker.0': 'Bus 14 running +10 today',
  'ticker.1': 'Sub covering Rm B-12',
  'ticker.2': 'Spelling bee sign-ups end Friday',
  'ticker.3': '8th grade field-trip forms due tomorrow',
  'ticker.4': 'Library returns due this week',
  'ticker.5': 'Lost blue water bottle → front office',
  'ticker.6': 'Garden Club planting seedlings today',
};

/**
 * Pick a value from the merged config, falling back to DEFAULTS if the
 * caller passed an empty string. Mirrors the landscape sibling's
 * "empty string → use default" semantic.
 */
function pick<K extends keyof Required<MsGreenhousePortraitConfig>>(
  cfg: MsGreenhousePortraitConfig,
  key: K,
): string {
  const v = cfg[key];
  return (v === undefined || v === '' ? DEFAULTS[key] : v) as string;
}

export function MsGreenhousePortraitWidget({
  config,
}: {
  config?: MsGreenhousePortraitConfig;
}) {
  const cfg = config || {};

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: '#f0e7d2',
        backgroundImage: [
          'radial-gradient(ellipse 1700px 1300px at 18% 6%, rgba(214,169,63,.18), transparent 70%)',
          'radial-gradient(ellipse 1500px 1400px at 90% 95%, rgba(52,94,58,.20), transparent 70%)',
          'radial-gradient(ellipse 900px 700px at 8% 78%, rgba(184,90,58,.10), transparent 70%)',
          'radial-gradient(ellipse 700px 600px at 92% 38%, rgba(184,90,58,.08), transparent 70%)',
          'radial-gradient(rgba(31,42,28,.045) 1px, transparent 1.4px)',
        ].join(', '),
        backgroundSize: 'auto, auto, auto, auto, 22px 22px',
        fontFamily: "'Cormorant Garamond', 'IM Fell English', serif",
        color: '#1f2a1c',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Foxing/aging spots — randomly scattered tiny rust marks. */}
      <div className="ms-gh-p-foxing" aria-hidden="true" />
      {/* Conservatory glasshouse mullion arches at the top. */}
      <div className="ms-gh-p-mullions" aria-hidden="true" />

      {/* ─── Botanical corner decorations (hand-drawn ferns) ─── */}
      <div className="ms-gh-p-corner-fern ms-gh-p-tl" aria-hidden="true">
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <g fill="none" stroke="#345e3a" strokeWidth="2.4" strokeLinecap="round">
            <path d="M30 180 Q60 140 90 110 Q120 80 150 50" />
            <path d="M55 152 Q40 138 32 122" />
            <path d="M70 134 Q55 120 47 104" />
            <path d="M85 116 Q70 102 62 86" />
            <path d="M100 98 Q85 84 77 68" />
            <path d="M115 80 Q100 66 92 50" />
            <path d="M130 62 Q115 48 107 32" />
            <path d="M62 162 Q78 154 90 144" />
            <path d="M77 144 Q93 136 105 126" />
            <path d="M92 126 Q108 118 120 108" />
            <path d="M107 108 Q123 100 135 90" />
            <path d="M122 90 Q138 82 150 72" />
          </g>
          <g fill="#4f8b48" opacity=".9">
            <ellipse cx="38" cy="128" rx="14" ry="6" transform="rotate(-50 38 128)" />
            <ellipse cx="53" cy="110" rx="14" ry="6" transform="rotate(-50 53 110)" />
            <ellipse cx="68" cy="92" rx="14" ry="6" transform="rotate(-50 68 92)" />
            <ellipse cx="83" cy="74" rx="14" ry="6" transform="rotate(-50 83 74)" />
            <ellipse cx="98" cy="56" rx="13" ry="5.5" transform="rotate(-50 98 56)" />
            <ellipse cx="113" cy="38" rx="12" ry="5" transform="rotate(-50 113 38)" />
            <ellipse cx="68" cy="156" rx="14" ry="6" transform="rotate(40 68 156)" />
            <ellipse cx="83" cy="138" rx="14" ry="6" transform="rotate(40 83 138)" />
            <ellipse cx="98" cy="120" rx="14" ry="6" transform="rotate(40 98 120)" />
            <ellipse cx="113" cy="102" rx="13" ry="5.5" transform="rotate(40 113 102)" />
            <ellipse cx="128" cy="84" rx="12" ry="5" transform="rotate(40 128 84)" />
          </g>
        </svg>
      </div>

      <div className="ms-gh-p-corner-fern ms-gh-p-br" aria-hidden="true">
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <g fill="none" stroke="#345e3a" strokeWidth="2.4" strokeLinecap="round">
            <path d="M30 180 Q60 140 90 110 Q120 80 150 50" />
            <path d="M55 152 Q40 138 32 122" />
            <path d="M70 134 Q55 120 47 104" />
            <path d="M85 116 Q70 102 62 86" />
            <path d="M100 98 Q85 84 77 68" />
            <path d="M115 80 Q100 66 92 50" />
            <path d="M62 162 Q78 154 90 144" />
            <path d="M77 144 Q93 136 105 126" />
            <path d="M92 126 Q108 118 120 108" />
            <path d="M107 108 Q123 100 135 90" />
          </g>
          <g fill="#6f9b78" opacity=".85">
            <ellipse cx="38" cy="128" rx="14" ry="6" transform="rotate(-50 38 128)" />
            <ellipse cx="53" cy="110" rx="14" ry="6" transform="rotate(-50 53 110)" />
            <ellipse cx="68" cy="92" rx="14" ry="6" transform="rotate(-50 68 92)" />
            <ellipse cx="83" cy="74" rx="14" ry="6" transform="rotate(-50 83 74)" />
            <ellipse cx="98" cy="56" rx="13" ry="5.5" transform="rotate(-50 98 56)" />
            <ellipse cx="68" cy="156" rx="14" ry="6" transform="rotate(40 68 156)" />
            <ellipse cx="83" cy="138" rx="14" ry="6" transform="rotate(40 83 138)" />
            <ellipse cx="98" cy="120" rx="14" ry="6" transform="rotate(40 98 120)" />
            <ellipse cx="113" cy="102" rx="13" ry="5.5" transform="rotate(40 113 102)" />
          </g>
        </svg>
      </div>

      {/* ─── SEAL+ID BAND ────────────────────────────────────── */}
      <header className="ms-gh-p-top">
        <div className="ms-gh-p-seal" aria-hidden="true">
          <span className="ms-gh-p-est">EST · 1924</span>
          <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M50 88 L50 50"
              stroke="#345e3a"
              strokeWidth="3.5"
              strokeLinecap="round"
              fill="none"
            />
            <path d="M50 50 Q35 42 30 28 Q42 30 50 44" fill="#4f8b48" />
            <path d="M50 50 Q65 42 70 28 Q58 30 50 44" fill="#4f8b48" />
            <path d="M50 60 Q40 56 34 48 Q44 52 50 58" fill="#6f9b78" />
            <path d="M50 60 Q60 56 66 48 Q56 52 50 58" fill="#6f9b78" />
            <circle cx="50" cy="34" r="6" fill="#e8a55c" />
            <path d="M22 86 Q50 80 78 86 L78 92 Q50 95 22 92 Z" fill="#8c3f29" />
          </svg>
        </div>
        <div className="ms-gh-p-ident" data-widget="school">
          <div className="ms-gh-p-eyebrow">
            <span data-field="school.eye" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.eye')}</span>
          </div>
          <div className="ms-gh-p-name">
            <span data-field="school.name" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.name')}</span>
            <em data-field="school.name2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.name2')}</em>
          </div>
          <div className="ms-gh-p-latin">
            <span data-field="school.latin" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.latin')}</span>
            <b data-field="school.day" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.day')}</b>
            <span data-field="school.tag" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.tag')}</span>
          </div>
        </div>
      </header>

      {/* ─── GAUGES BAND ──────────────────────────────────────── */}
      <section className="ms-gh-p-instruments">
        <div className="ms-gh-p-gauge" data-widget="weather">
          <div className="ms-gh-p-lbl" data-field="weather.label" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'weather.label')}
          </div>
          <div className="ms-gh-p-val ms-gh-p-cool" data-field="weather.temp" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'weather.temp')}
          </div>
          <div className="ms-gh-p-ticks" aria-hidden="true" />
          <div className="ms-gh-p-sub" data-field="weather.cond" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'weather.cond')}
          </div>
        </div>
        <div className="ms-gh-p-gauge" data-widget="clock">
          <div className="ms-gh-p-lbl" data-field="clock.label" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'clock.label')}
          </div>
          <div className="ms-gh-p-val" data-field="clock.time" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'clock.time')}
          </div>
          <div className="ms-gh-p-ticks" aria-hidden="true" />
          <div className="ms-gh-p-sub" data-field="clock.sub" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'clock.sub')}
          </div>
        </div>
        <div className="ms-gh-p-gauge" data-widget="bloom">
          <div className="ms-gh-p-lbl" data-field="bloom.label" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'bloom.label')}
          </div>
          <div className="ms-gh-p-val ms-gh-p-warm" data-field="bloom.value" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'bloom.value')}
          </div>
          <div className="ms-gh-p-ticks" aria-hidden="true" />
          <div className="ms-gh-p-sub" data-field="bloom.sub" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'bloom.sub')}
          </div>
        </div>
      </section>

      {/* ─── HERBARIUM HERO PLATE ────────────────────────────── */}
      <section className="ms-gh-p-plate" data-widget="greeting">
        <div className="ms-gh-p-accession">
          <b data-field="greeting.acc" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.acc')}</b>
          <span data-field="greeting.acc2" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'greeting.acc2')
              .split('\n')
              .map((line, i, arr) => (
                <React.Fragment key={i}>
                  {line}
                  {i < arr.length - 1 ? <br /> : null}
                </React.Fragment>
              ))}
          </span>
        </div>
        <div className="ms-gh-p-chapter">
          <span className="ms-gh-p-ornament">❦</span>
          <span data-field="greeting.kicker" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.kicker')}</span>
        </div>
        <h1 className="ms-gh-p-h1">
          <span data-field="greeting.h1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h1')}</span>
          <em data-field="greeting.h2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h2')}</em>
          <span data-field="greeting.h3" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h3')}</span>
          <span className="ms-gh-p-accent" data-field="greeting.h4" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'greeting.h4')}
          </span>
        </h1>
        <p className="ms-gh-p-lede" data-field="greeting.lede" style={{ whiteSpace: 'pre-wrap' }}>
          {pick(cfg, 'greeting.lede')}
        </p>

        <div className="ms-gh-p-signoff">
          — with care,
          <br />
          <b data-field="greeting.sign" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.sign')}</b>
        </div>

        <div className="ms-gh-p-illos" aria-hidden="true">
          {/* Specimen 1: Monstera leaf */}
          <div className="ms-gh-p-specimen">
            <svg width="260" height="320" viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">
              <g>
                <path
                  d="M50 110 L50 60"
                  stroke="#345e3a"
                  strokeWidth="2.4"
                  fill="none"
                  strokeLinecap="round"
                />
                <path
                  d="M50 60 C 28 56, 18 38, 22 18 C 36 22, 48 30, 56 44 C 60 32, 68 22, 80 16 C 84 30, 78 50, 60 60 Z"
                  fill="#4f8b48"
                  stroke="#1f2a1c"
                  strokeWidth="1.5"
                />
                <ellipse cx="34" cy="32" rx="3.5" ry="6" fill="#f6eed9" />
                <ellipse cx="46" cy="44" rx="3" ry="5" fill="#f6eed9" />
                <ellipse cx="68" cy="34" rx="3.5" ry="5" fill="#f6eed9" />
                <path
                  d="M50 60 L36 28 M50 60 L48 22 M50 60 L66 28"
                  stroke="#1f2a1c"
                  strokeWidth="1"
                  fill="none"
                />
              </g>
            </svg>
            <div className="ms-gh-p-ill-latin">
              Monstera deliciosa
              <b>Patience</b>
            </div>
          </div>

          {/* Specimen 2: Fern */}
          <div className="ms-gh-p-specimen">
            <svg width="260" height="320" viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">
              <g>
                <path
                  d="M50 112 L50 56"
                  stroke="#345e3a"
                  strokeWidth="2.4"
                  fill="none"
                  strokeLinecap="round"
                />
                <g fill="none" stroke="#345e3a" strokeWidth="1.6">
                  <path d="M50 56 Q30 48 22 30" />
                  <path d="M50 56 Q70 48 78 30" />
                  <path d="M50 70 Q34 64 26 50" />
                  <path d="M50 70 Q66 64 74 50" />
                  <path d="M50 84 Q38 80 32 70" />
                  <path d="M50 84 Q62 80 68 70" />
                </g>
                <g fill="#6f9b78" stroke="#1f2a1c" strokeWidth=".7">
                  <ellipse cx="32" cy="36" rx="6" ry="2.5" transform="rotate(-30 32 36)" />
                  <ellipse cx="36" cy="50" rx="6" ry="2.5" transform="rotate(-25 36 50)" />
                  <ellipse cx="40" cy="62" rx="5" ry="2.4" transform="rotate(-20 40 62)" />
                  <ellipse cx="44" cy="74" rx="5" ry="2.2" transform="rotate(-15 44 74)" />
                  <ellipse cx="68" cy="36" rx="6" ry="2.5" transform="rotate(30 68 36)" />
                  <ellipse cx="64" cy="50" rx="6" ry="2.5" transform="rotate(25 64 50)" />
                  <ellipse cx="60" cy="62" rx="5" ry="2.4" transform="rotate(20 60 62)" />
                  <ellipse cx="56" cy="74" rx="5" ry="2.2" transform="rotate(15 56 74)" />
                </g>
              </g>
            </svg>
            <div className="ms-gh-p-ill-latin">
              Nephrolepis exaltata
              <b>Persistence</b>
            </div>
          </div>

          {/* Specimen 3: Sunflower in clay pot */}
          <div className="ms-gh-p-specimen">
            <svg width="280" height="320" viewBox="0 0 110 120" xmlns="http://www.w3.org/2000/svg">
              <g>
                <path
                  d="M38 100 L72 100 L66 116 L44 116 Z"
                  fill="#b85a3a"
                  stroke="#1f2a1c"
                  strokeWidth="1.5"
                />
                <rect
                  x="36"
                  y="96"
                  width="38"
                  height="6"
                  fill="#8c3f29"
                  stroke="#1f2a1c"
                  strokeWidth="1.2"
                />
                <path
                  d="M55 96 C 54 80, 56 60, 55 40"
                  stroke="#345e3a"
                  strokeWidth="2.4"
                  fill="none"
                  strokeLinecap="round"
                />
                <path
                  d="M55 78 Q35 72 28 56 Q42 64 55 70"
                  fill="#4f8b48"
                  stroke="#1f2a1c"
                  strokeWidth="1"
                />
                <path
                  d="M55 72 Q75 66 82 50 Q68 58 55 64"
                  fill="#4f8b48"
                  stroke="#1f2a1c"
                  strokeWidth="1"
                />
                <g transform="translate(55 32)">
                  <g fill="#e8a55c" stroke="#1f2a1c" strokeWidth=".8">
                    <ellipse cx="0" cy="-14" rx="5" ry="11" />
                    <ellipse cx="14" cy="0" rx="11" ry="5" />
                    <ellipse cx="0" cy="14" rx="5" ry="11" />
                    <ellipse cx="-14" cy="0" rx="11" ry="5" />
                    <ellipse cx="10" cy="-10" rx="9" ry="5" transform="rotate(-45 10 -10)" />
                    <ellipse cx="10" cy="10" rx="9" ry="5" transform="rotate(45 10 10)" />
                    <ellipse cx="-10" cy="-10" rx="9" ry="5" transform="rotate(45 -10 -10)" />
                    <ellipse cx="-10" cy="10" rx="9" ry="5" transform="rotate(-45 -10 10)" />
                  </g>
                  <circle r="6.5" fill="#8c3f29" stroke="#1f2a1c" strokeWidth="1" />
                  <g fill="#1f2a1c">
                    <circle cx="-2" cy="-2" r=".9" />
                    <circle cx="2" cy="-1" r=".9" />
                    <circle cx="-1" cy="2" r=".9" />
                    <circle cx="2" cy="3" r=".9" />
                  </g>
                </g>
              </g>
            </svg>
            <div className="ms-gh-p-ill-latin">
              Helianthus annuus
              <b>Courage</b>
            </div>
          </div>

          {/* Specimen 4: Lavender */}
          <div className="ms-gh-p-specimen">
            <svg width="260" height="320" viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">
              <g>
                <g stroke="#345e3a" strokeWidth="2" fill="none" strokeLinecap="round">
                  <path d="M30 116 C 32 90, 28 60, 36 30" />
                  <path d="M50 116 C 52 90, 48 60, 50 24" />
                  <path d="M70 116 C 68 90, 72 60, 64 30" />
                </g>
                <g fill="#7d4fa8" stroke="#1f2a1c" strokeWidth=".6">
                  <ellipse cx="36" cy="32" rx="4" ry="6" />
                  <ellipse cx="34" cy="44" rx="3.6" ry="5" />
                  <ellipse cx="50" cy="26" rx="4" ry="6" />
                  <ellipse cx="50" cy="40" rx="3.6" ry="5" />
                  <ellipse cx="64" cy="32" rx="4" ry="6" />
                  <ellipse cx="66" cy="44" rx="3.6" ry="5" />
                  <ellipse cx="40" cy="56" rx="3" ry="4" />
                  <ellipse cx="50" cy="54" rx="3" ry="4" />
                  <ellipse cx="60" cy="56" rx="3" ry="4" />
                </g>
              </g>
            </svg>
            <div className="ms-gh-p-ill-latin">
              Lavandula officinalis
              <b>Calm</b>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SPECIMENS INDEX (today's periods) ────────────────── */}
      <section className="ms-gh-p-index" data-widget="agenda">
        <div className="ms-gh-p-head">
          <div className="ms-gh-p-head-left">
            <div className="ms-gh-p-eye">Hortus Botanicus · Index</div>
            <h2 data-field="agenda.title" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.title')}</h2>
          </div>
          <div className="ms-gh-p-head-right">
            <span data-field="agenda.date" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.date')}</span>
            <b data-field="agenda.label" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.label')}</b>
          </div>
        </div>
        <div className="ms-gh-p-specimens">
          {(
            [
              { i: 0, num: 'i', cls: 'done' },
              { i: 1, num: 'ii', cls: 'now' },
              { i: 2, num: 'iii', cls: '' },
              { i: 3, num: 'iv', cls: '' },
              { i: 4, num: 'v', cls: '' },
              { i: 5, num: 'vi', cls: '' },
            ] as const
          ).map(({ i, num, cls }) => (
            <div
              key={i}
              className={`ms-gh-p-sp${cls ? ` ms-gh-p-${cls}` : ''}`}
              data-widget={`agenda.${i}`}
            >
              <div className="ms-gh-p-num">{num}</div>
              <div className="ms-gh-p-body">
                <div className="ms-gh-p-common" data-field={`agenda.${i}.t`} style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(
                    cfg,
                    `agenda.${i}.t` as keyof Required<MsGreenhousePortraitConfig>,
                  )}
                </div>
                <div className="ms-gh-p-sp-latin">
                  <span data-field={`agenda.${i}.l`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(
                      cfg,
                      `agenda.${i}.l` as keyof Required<MsGreenhousePortraitConfig>,
                    )}
                  </span>
                  <b data-field={`agenda.${i}.r`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(
                      cfg,
                      `agenda.${i}.r` as keyof Required<MsGreenhousePortraitConfig>,
                    )}
                  </b>
                </div>
              </div>
              <div className="ms-gh-p-when">
                <div className="ms-gh-p-t" data-field={`agenda.${i}.h`} style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(
                    cfg,
                    `agenda.${i}.h` as keyof Required<MsGreenhousePortraitConfig>,
                  )}
                </div>
                <div className="ms-gh-p-ph" data-field={`agenda.${i}.s`} style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(
                    cfg,
                    `agenda.${i}.s` as keyof Required<MsGreenhousePortraitConfig>,
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── CLUB PACKETS ────────────────────────────────────── */}
      <section className="ms-gh-p-clubs">
        {(
          [
            { i: 0, variant: '' },
            { i: 1, variant: 'terra' },
            { i: 2, variant: 'brass' },
          ] as const
        ).map(({ i, variant }) => (
          <div
            key={i}
            className={`ms-gh-p-packet${variant ? ` ms-gh-p-${variant}` : ''}`}
            data-widget={`club.${i}`}
          >
            <div className="ms-gh-p-band">
              <span className="ms-gh-p-dept" data-field={`club.${i}.dept`} style={{ whiteSpace: 'pre-wrap' }}>
                {pick(
                  cfg,
                  `club.${i}.dept` as keyof Required<MsGreenhousePortraitConfig>,
                )}
              </span>
              <span className="ms-gh-p-lot" data-field={`club.${i}.lot`} style={{ whiteSpace: 'pre-wrap' }}>
                {pick(
                  cfg,
                  `club.${i}.lot` as keyof Required<MsGreenhousePortraitConfig>,
                )}
              </span>
            </div>
            <div className="ms-gh-p-pbody">
              <div className="ms-gh-p-pcommon" data-field={`club.${i}.t`} style={{ whiteSpace: 'pre-wrap' }}>
                {pick(
                  cfg,
                  `club.${i}.t` as keyof Required<MsGreenhousePortraitConfig>,
                )}
              </div>
              <div className="ms-gh-p-platin" data-field={`club.${i}.l`} style={{ whiteSpace: 'pre-wrap' }}>
                {pick(
                  cfg,
                  `club.${i}.l` as keyof Required<MsGreenhousePortraitConfig>,
                )}
              </div>
              <div className="ms-gh-p-where" data-field={`club.${i}.r`} style={{ whiteSpace: 'pre-wrap' }}>
                {pick(
                  cfg,
                  `club.${i}.r` as keyof Required<MsGreenhousePortraitConfig>,
                )}
              </div>
            </div>
            <div className="ms-gh-p-foot">
              <div className="ms-gh-p-fwhen" data-field={`club.${i}.h`} style={{ whiteSpace: 'pre-wrap' }}>
                {pick(
                  cfg,
                  `club.${i}.h` as keyof Required<MsGreenhousePortraitConfig>,
                )}
              </div>
              <div className="ms-gh-p-tag" data-field={`club.${i}.tag`} style={{ whiteSpace: 'pre-wrap' }}>
                {pick(
                  cfg,
                  `club.${i}.tag` as keyof Required<MsGreenhousePortraitConfig>,
                )}
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* ─── ANNOUNCEMENT (pinned terracotta) ─────────────────── */}
      <section className="ms-gh-p-notice" data-widget="announcement">
        <span className="ms-gh-p-stamp" data-field="announcement.stamp" style={{ whiteSpace: 'pre-wrap' }}>
          {pick(cfg, 'announcement.stamp')}
        </span>
        <div className="ms-gh-p-notice-body">
          <h3 data-field="announcement.headline" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'announcement.headline')}
          </h3>
          <div className="ms-gh-p-msg" data-field="announcement.message" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'announcement.message')}
          </div>
        </div>
      </section>

      {/* ─── COUNTDOWN + SIGNPOST ROW ────────────────────────── */}
      <section className="ms-gh-p-bottom">
        <div className="ms-gh-p-almanac" data-widget="countdown">
          <div className="ms-gh-p-day">
            <div>
              <div className="ms-gh-p-n" data-field="countdown.value" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'countdown.value')}
              </div>
              <div className="ms-gh-p-u" data-field="countdown.unit" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'countdown.unit')}
              </div>
            </div>
          </div>
          <div className="ms-gh-p-info">
            <div className="ms-gh-p-eye2" data-field="countdown.kicker" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'countdown.kicker')}
            </div>
            <div className="ms-gh-p-tt">
              <span data-field="countdown.title" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'countdown.title')}
              </span>
              <em data-field="countdown.title2" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'countdown.title2')}
              </em>
              <span data-field="countdown.title3" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'countdown.title3')}
              </span>
            </div>
            <div className="ms-gh-p-ss" data-field="countdown.sub" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'countdown.sub')}
            </div>
          </div>
        </div>

        <div className="ms-gh-p-signpost" data-widget="lunch">
          <div className="ms-gh-p-stake" aria-hidden="true">
            <div className="ms-gh-p-label">
              <div className="ms-gh-p-st-lbl">Today's Plate</div>
              <div className="ms-gh-p-ico">N° 4</div>
            </div>
            <div className="ms-gh-p-pole" />
          </div>
          <div className="ms-gh-p-info">
            <div className="ms-gh-p-eye3" data-field="lunch.eye" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'lunch.eye')}
            </div>
            <div className="ms-gh-p-tt2" data-field="lunch.title" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'lunch.title')}
            </div>
            <div className="ms-gh-p-ss2">
              <span data-field="lunch.sides" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.sides')}</span>
              <b data-field="lunch.sides2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.sides2')}</b>
            </div>
          </div>
          <div className="ms-gh-p-badges">
            <span className="ms-gh-p-veg" data-field="lunch.b1" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'lunch.b1')}
            </span>
            <span className="ms-gh-p-gf" data-field="lunch.b2" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'lunch.b2')}
            </span>
          </div>
        </div>
      </section>

      {/* ─── TICKER (engraved brass plate) ────────────────────── */}
      <div className="ms-gh-p-ticker" data-widget="ticker">
        <div className="ms-gh-p-tag2" data-field="ticker.tag" style={{ whiteSpace: 'pre-wrap' }}>
          {pick(cfg, 'ticker.tag')}
        </div>
        <div className="ms-gh-p-feed">
          <div className="ms-gh-p-feed-inner">
            <span data-field="ticker.0" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.0')}</span>
            <span data-field="ticker.1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.1')}</span>
            <span data-field="ticker.2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.2')}</span>
            <span data-field="ticker.3" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.3')}</span>
            <span data-field="ticker.4" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.4')}</span>
            <span data-field="ticker.5" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.5')}</span>
            <span data-field="ticker.6" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.6')}</span>
            <span aria-hidden="true">{pick(cfg, 'ticker.0')}</span>
            <span aria-hidden="true">{pick(cfg, 'ticker.1')}</span>
            <span aria-hidden="true">{pick(cfg, 'ticker.2')}</span>
            <span aria-hidden="true">{pick(cfg, 'ticker.3')}</span>
            <span aria-hidden="true">{pick(cfg, 'ticker.4')}</span>
            <span aria-hidden="true">{pick(cfg, 'ticker.5')}</span>
            <span aria-hidden="true">{pick(cfg, 'ticker.6')}</span>
          </div>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — every pixel value matches scratch/design/greenhouse-ms-portrait-v1.html. */
const CSS = `
*, *::before, *::after { box-sizing: border-box; }

/* Foxing/aging spots — randomly scattered tiny rust marks across the
   taller canvas (mockup paints these on .stage::before; HsStage owns
   its own ::before so render as a dedicated layer). */
.ms-gh-p-foxing {
  position: absolute; inset: 0; pointer-events: none; opacity: .55; z-index: 0;
  background-image:
    radial-gradient(circle at 12% 8%, rgba(140,63,41,.18) 0 4px, transparent 5px),
    radial-gradient(circle at 23% 38%, rgba(140,63,41,.15) 0 5px, transparent 6px),
    radial-gradient(circle at 67% 6%, rgba(140,63,41,.12) 0 3px, transparent 4px),
    radial-gradient(circle at 84% 30%, rgba(140,63,41,.18) 0 6px, transparent 7px),
    radial-gradient(circle at 41% 22%, rgba(140,63,41,.10) 0 4px, transparent 5px),
    radial-gradient(circle at 92% 14%, rgba(140,63,41,.14) 0 4px, transparent 5px),
    radial-gradient(circle at 5% 25%, rgba(140,63,41,.14) 0 3px, transparent 4px),
    radial-gradient(circle at 56% 45%, rgba(140,63,41,.12) 0 5px, transparent 6px),
    radial-gradient(circle at 18% 64%, rgba(140,63,41,.16) 0 5px, transparent 6px),
    radial-gradient(circle at 78% 58%, rgba(140,63,41,.14) 0 4px, transparent 5px),
    radial-gradient(circle at 9% 88%, rgba(140,63,41,.14) 0 4px, transparent 5px),
    radial-gradient(circle at 88% 78%, rgba(140,63,41,.18) 0 5px, transparent 6px),
    radial-gradient(circle at 38% 92%, rgba(140,63,41,.10) 0 4px, transparent 5px),
    radial-gradient(circle at 60% 72%, rgba(140,63,41,.12) 0 3px, transparent 4px);
}
/* Conservatory glasshouse mullion arches at the top
   (mockup paints these on .stage::after). */
.ms-gh-p-mullions {
  position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: .10;
  background-image:
    linear-gradient(180deg, rgba(31,42,28,.4) 0 2px, transparent 2px 100%),
    repeating-linear-gradient(90deg, rgba(31,42,28,.2) 0 2px, transparent 2px 240px),
    repeating-linear-gradient(0deg, rgba(31,42,28,.2) 0 2px, transparent 2px 300px);
  background-size: 100% 80px, 100% 100%, 100% 100%;
  -webkit-mask: linear-gradient(180deg, #000 0%, transparent 14%);
  mask: linear-gradient(180deg, #000 0%, transparent 14%);
}

/* Botanical SVG decorations growing from corners */
.ms-gh-p-corner-fern { position: absolute; pointer-events: none; z-index: 0; }
.ms-gh-p-corner-fern.ms-gh-p-tl { top: -40px; left: -40px; width: 620px; height: 620px; transform: rotate(-8deg); opacity: .85; }
.ms-gh-p-corner-fern.ms-gh-p-br { bottom: -50px; right: -50px; width: 680px; height: 680px; transform: rotate(170deg); opacity: .78; }
.ms-gh-p-corner-fern svg { width: 100%; height: 100%; }

/* ─── SEAL+ID BAND ──────────────────────────────────────── */
/* y=64, h=360 — full-width centered school identity */
.ms-gh-p-top {
  position: absolute; top: 64px; left: 64px; right: 64px; height: 360px;
  display: grid; grid-template-columns: 320px 1fr; gap: 56px; align-items: center;
  padding: 16px 32px;
  overflow: hidden;
  z-index: 2;
}

/* Hand-drawn monogram seal: brass ring + sprout silhouette */
.ms-gh-p-seal {
  width: 320px; height: 320px; position: relative; flex-shrink: 0;
  background: #f6eed9;
  border-radius: 50%;
  border: 7px solid #345e3a;
  box-shadow:
    inset 0 0 0 20px #f6eed9,
    inset 0 0 0 23px #b8893c,
    8px 10px 0 #345e3a;
}
.ms-gh-p-seal::before {
  content: ''; position: absolute; inset: 34px; border-radius: 50%;
  border: 2px dashed rgba(31,42,28,.5);
}
.ms-gh-p-seal svg { position: absolute; inset: 46px; width: calc(100% - 92px); height: calc(100% - 92px); }
.ms-gh-p-est {
  position: absolute; top: -20px; left: 50%; transform: translateX(-50%);
  background: #345e3a; color: #f6eed9;
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 22px;
  letter-spacing: .26em; padding: 8px 18px; border-radius: 4px;
  text-transform: uppercase;
}

.ms-gh-p-ident { overflow: hidden; }
.ms-gh-p-ident .ms-gh-p-eyebrow {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 38px;
  letter-spacing: .32em; text-transform: uppercase; color: #b85a3a;
  display: flex; align-items: center; gap: 22px;
}
.ms-gh-p-ident .ms-gh-p-eyebrow::before {
  content: ''; width: 80px; height: 4px; background: #b85a3a; flex-shrink: 0;
}
.ms-gh-p-ident .ms-gh-p-name {
  font-family: 'Cormorant Garamond', serif; font-style: italic; font-weight: 700;
  font-size: 200px; line-height: .92; letter-spacing: -.02em;
  color: #1f2a1c; margin-top: 8px;
}
.ms-gh-p-ident .ms-gh-p-name em {
  font-style: italic; color: #345e3a;
}
.ms-gh-p-ident .ms-gh-p-latin {
  font-family: 'IM Fell English', serif; font-style: italic; font-weight: 400;
  font-size: 44px; color: #3a4a36; letter-spacing: .03em;
  margin-top: 14px;
}
.ms-gh-p-ident .ms-gh-p-latin b { color: #a23046; font-style: normal; font-weight: 700; }

/* ─── GAUGES BAND ───────────────────────────────────────── */
/* y=444, h=280 — three brass instruments side by side */
.ms-gh-p-instruments {
  position: absolute; top: 444px; left: 64px; right: 64px; height: 280px;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px;
  overflow: hidden;
  z-index: 2;
}
.ms-gh-p-gauge {
  background: radial-gradient(circle at 30% 28%, #f6eed9, #e7dcc1);
  border: 7px solid #b8893c;
  border-radius: 22px;
  box-shadow:
    inset 0 0 0 4px #f6eed9,
    inset 0 0 36px rgba(138,97,34,.18),
    8px 8px 0 #345e3a;
  padding: 30px 32px 24px;
  display: flex; flex-direction: column; justify-content: space-between;
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
}
.ms-gh-p-gauge::before {
  content: ''; position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  width: 130px; height: 8px; background: #8a6122; border-radius: 4px;
  box-shadow: 0 2px 0 rgba(0,0,0,.15);
}
.ms-gh-p-gauge .ms-gh-p-lbl {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 32px;
  letter-spacing: .22em; text-transform: uppercase; color: #3a4a36;
  text-align: center; margin-top: 18px;
}
.ms-gh-p-gauge .ms-gh-p-val {
  font-family: 'Cormorant Garamond', serif; font-weight: 700; font-style: italic;
  font-size: 130px; line-height: .9; color: #1f2a1c; text-align: center;
  letter-spacing: -.01em;
}
.ms-gh-p-gauge .ms-gh-p-val.ms-gh-p-warm { color: #b85a3a; }
.ms-gh-p-gauge .ms-gh-p-val.ms-gh-p-cool { color: #7fa8b8; }
.ms-gh-p-gauge .ms-gh-p-sub {
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 30px; color: #345e3a; text-align: center;
}
.ms-gh-p-gauge .ms-gh-p-ticks {
  position: absolute; left: 18px; right: 18px; bottom: 110px; height: 8px;
  background: repeating-linear-gradient(90deg, #8a6122 0 3px, transparent 3px 22px);
  opacity: .55;
}

/* ─── HERBARIUM HERO ───────────────────────────────────── */
/* y=744, h=1480 — main herbarium plate with 4 specimens at bottom */
.ms-gh-p-plate {
  position: absolute; top: 744px; left: 64px; right: 64px; height: 1480px;
  background: #f6eed9;
  border: 5px solid #1f2a1c;
  box-shadow:
    inset 0 0 0 22px #f6eed9,
    inset 0 0 0 25px #345e3a,
    16px 16px 0 #345e3a;
  padding: 76px 84px 56px;
  overflow: hidden;
  display: flex; flex-direction: column;
  z-index: 2;
  box-sizing: border-box;
}
/* Inner double-rule frame typical of herbarium sheets */
.ms-gh-p-plate::before {
  content: ''; position: absolute; inset: 42px;
  border: 2px solid #1f2a1c;
  pointer-events: none;
}
.ms-gh-p-plate::after {
  content: ''; position: absolute; inset: 54px;
  border: 0.5px solid #8a6122;
  pointer-events: none;
}
.ms-gh-p-accession {
  position: absolute; top: 80px; right: 96px;
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 32px; color: #3a4a36;
  transform: rotate(2deg);
  text-align: right; line-height: 1.3;
  z-index: 3;
}
.ms-gh-p-accession b {
  display: block; font-family: 'Work Sans', sans-serif; font-style: normal;
  font-weight: 800; font-size: 28px; letter-spacing: .18em;
  color: #b85a3a; text-transform: uppercase;
}
.ms-gh-p-chapter {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 36px;
  letter-spacing: .3em; text-transform: uppercase; color: #345e3a;
  display: inline-flex; align-items: center; gap: 26px;
  margin-bottom: 34px; position: relative; z-index: 2;
}
.ms-gh-p-chapter::before {
  content: ''; width: 110px; height: 4px; background: #345e3a;
}
.ms-gh-p-chapter .ms-gh-p-ornament { color: #a23046; font-size: 44px; line-height: 1; }
.ms-gh-p-h1 {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-size: 280px; line-height: .85; letter-spacing: -.025em;
  color: #1f2a1c; margin: 0; position: relative; z-index: 2;
  text-wrap: balance;
}
.ms-gh-p-h1 em {
  font-style: italic; color: #345e3a;
  background: linear-gradient(180deg, transparent 75%, rgba(232,165,92,.45) 75% 92%, transparent 92%);
  padding: 0 10px; border-radius: 4px;
}
.ms-gh-p-h1 .ms-gh-p-accent {
  color: #b85a3a; font-style: italic;
}
.ms-gh-p-lede {
  font-family: 'Cormorant Garamond', serif; font-weight: 500;
  font-size: 64px; line-height: 1.32; color: #3a4a36;
  margin-top: 50px; max-width: 1700px; position: relative; z-index: 2;
}
.ms-gh-p-lede em { color: #345e3a; font-weight: 600; font-style: italic; }

/* Bottom strip: hand-tinted botanical illustration row — 4 specimens */
.ms-gh-p-illos {
  position: absolute; left: 84px; right: 84px; bottom: 76px;
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 32px; z-index: 1;
}
.ms-gh-p-illos .ms-gh-p-specimen {
  display: flex; flex-direction: column; align-items: center; gap: 14px;
  flex: 1;
}
.ms-gh-p-illos svg { display: block; }
.ms-gh-p-illos .ms-gh-p-ill-latin {
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 34px; color: #3a4a36; letter-spacing: .04em;
  text-align: center; line-height: 1.2; max-width: 380px;
}
.ms-gh-p-illos .ms-gh-p-ill-latin b {
  display: block; font-family: 'Work Sans', sans-serif; font-style: normal;
  font-weight: 800; font-size: 24px; letter-spacing: .22em;
  color: #b85a3a; text-transform: uppercase; margin-top: 6px;
}

/* Handwritten cataloger note in bottom-right */
.ms-gh-p-signoff {
  position: absolute; bottom: 484px; right: 110px;
  font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 50px; color: #3a4a36;
  transform: rotate(-3deg);
  line-height: 1.1;
  z-index: 2;
  text-align: right;
}
.ms-gh-p-signoff b {
  display: block; font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 44px; color: #a23046;
  margin-top: 4px;
}

/* ─── SPECIMENS INDEX ──────────────────────────────────── */
/* y=2244, h=720 — vertical column of today's periods */
.ms-gh-p-index {
  position: absolute; top: 2244px; left: 64px; right: 64px; height: 720px;
  background: linear-gradient(180deg, #345e3a 0%, #2a4a2e 100%);
  color: #f6eed9;
  border: 5px solid #1f2a1c;
  box-shadow:
    inset 0 0 0 16px #345e3a,
    inset 0 0 0 19px #d6a93f,
    14px 14px 0 #1f2a1c;
  padding: 44px 56px 40px;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 22px;
  z-index: 2;
  box-sizing: border-box;
}
.ms-gh-p-index::before {
  content: ''; position: absolute; right: -100px; top: -100px;
  width: 420px; height: 420px; border-radius: 50%;
  background: radial-gradient(circle, rgba(214,169,63,.30), transparent 70%);
  pointer-events: none;
}
.ms-gh-p-index::after {
  content: ''; position: absolute; left: -90px; bottom: -90px;
  width: 320px; height: 320px; border-radius: 50%;
  background: radial-gradient(circle, rgba(232,165,92,.20), transparent 70%);
  pointer-events: none;
}
.ms-gh-p-head {
  padding-bottom: 22px; border-bottom: 3px solid #d6a93f;
  display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 30px;
  position: relative; z-index: 1;
}
.ms-gh-p-head .ms-gh-p-head-left .ms-gh-p-eye {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 30px;
  letter-spacing: .26em; text-transform: uppercase; color: #d6a93f;
}
.ms-gh-p-head .ms-gh-p-head-left h2 {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 110px; line-height: .9;
  color: #f6eed9; margin: 8px 0 0; letter-spacing: -.015em;
}
.ms-gh-p-head .ms-gh-p-head-right {
  text-align: right;
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 34px; color: #93b07c; line-height: 1.2;
}
.ms-gh-p-head .ms-gh-p-head-right b {
  color: #e8a55c; font-weight: 700; font-style: normal;
  display: block; font-family: 'Work Sans', sans-serif;
  font-size: 28px; letter-spacing: .18em; text-transform: uppercase;
}

/* Specimen list — six taxonomic cards in a tight column */
.ms-gh-p-specimens {
  display: grid; grid-template-rows: repeat(6, 1fr); gap: 8px;
  overflow: hidden;
  position: relative; z-index: 1;
  min-height: 0;
}
.ms-gh-p-sp {
  display: grid; grid-template-columns: 90px 1fr auto; gap: 26px; align-items: center;
  padding: 12px 24px;
  background: rgba(240,231,210,.06);
  border: 1.5px solid rgba(214,169,63,.45);
  border-left: 7px solid #93b07c;
  position: relative;
  overflow: hidden;
}
.ms-gh-p-sp.ms-gh-p-now {
  background: linear-gradient(90deg, rgba(232,165,92,.22), rgba(214,169,63,.12));
  border-color: #e8a55c;
  border-left: 7px solid #b85a3a;
  box-shadow: 0 0 0 2px rgba(232,165,92,.3);
}
.ms-gh-p-sp.ms-gh-p-done { opacity: .55; }
.ms-gh-p-sp.ms-gh-p-done::after {
  content: ''; position: absolute; left: 12px; right: 12px; top: 50%;
  height: 2px; background: #93b07c; transform: translateY(-50%);
  pointer-events: none; opacity: .5;
}
.ms-gh-p-sp .ms-gh-p-num {
  font-family: 'Cormorant Garamond', serif; font-style: italic;
  font-weight: 700; font-size: 72px; color: #d6a93f;
  line-height: 1; text-align: center;
}
.ms-gh-p-sp.ms-gh-p-now .ms-gh-p-num { color: #e8a55c; }
.ms-gh-p-sp .ms-gh-p-body { line-height: 1.05; min-width: 0; }
.ms-gh-p-sp .ms-gh-p-common {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-size: 52px; color: #f6eed9; letter-spacing: -.005em;
  line-height: 1.05;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ms-gh-p-sp .ms-gh-p-sp-latin {
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 30px; color: #93b07c; margin-top: 4px; letter-spacing: .03em;
  line-height: 1.1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ms-gh-p-sp .ms-gh-p-sp-latin b { font-style: normal; color: #e8a55c; font-weight: 700; }
.ms-gh-p-sp .ms-gh-p-when {
  text-align: right; line-height: 1.05; flex-shrink: 0;
}
.ms-gh-p-sp .ms-gh-p-when .ms-gh-p-t {
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 38px;
  color: #f6eed9; letter-spacing: .04em;
}
.ms-gh-p-sp .ms-gh-p-when .ms-gh-p-ph {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 20px;
  letter-spacing: .2em; text-transform: uppercase;
  color: #93b07c; margin-top: 4px;
}
.ms-gh-p-sp.ms-gh-p-now .ms-gh-p-when .ms-gh-p-ph { color: #e8a55c; }
.ms-gh-p-sp.ms-gh-p-now .ms-gh-p-when .ms-gh-p-t { color: #e8a55c; }
.ms-gh-p-sp.ms-gh-p-done .ms-gh-p-when .ms-gh-p-t { text-decoration: line-through; color: #93b07c; }

/* ─── CLUB PACKETS ─────────────────────────────────────── */
/* y=2984, h=320 — three seed-packet cards across */
.ms-gh-p-clubs {
  position: absolute; top: 2984px; left: 64px; right: 64px; height: 320px;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px;
  overflow: hidden;
  z-index: 2;
}
.ms-gh-p-packet {
  background: #f6eed9;
  border: 5px solid #1f2a1c;
  box-shadow: 10px 12px 0 #1f2a1c;
  padding: 0;
  display: grid; grid-template-rows: 86px 1fr auto;
  overflow: hidden;
  position: relative;
  box-sizing: border-box;
}
.ms-gh-p-packet .ms-gh-p-band {
  background: #345e3a; color: #f6eed9;
  padding: 14px 26px;
  display: flex; justify-content: space-between; align-items: center;
  border-bottom: 5px solid #1f2a1c;
  position: relative;
  overflow: hidden;
}
.ms-gh-p-packet.ms-gh-p-terra .ms-gh-p-band { background: #b85a3a; }
.ms-gh-p-packet.ms-gh-p-brass .ms-gh-p-band { background: #b8893c; color: #1f2a1c; }
.ms-gh-p-packet .ms-gh-p-band .ms-gh-p-dept {
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 22px;
  letter-spacing: .26em; text-transform: uppercase;
}
.ms-gh-p-packet .ms-gh-p-band .ms-gh-p-lot {
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 28px;
}
.ms-gh-p-packet .ms-gh-p-pbody {
  padding: 22px 30px 16px;
  display: flex; flex-direction: column; justify-content: center;
  position: relative;
  overflow: hidden;
}
.ms-gh-p-packet .ms-gh-p-pbody .ms-gh-p-pcommon {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 64px; line-height: .95;
  color: #1f2a1c; letter-spacing: -.015em;
}
.ms-gh-p-packet .ms-gh-p-pbody .ms-gh-p-platin {
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 28px; color: #345e3a; margin-top: 8px;
  line-height: 1.15;
}
.ms-gh-p-packet .ms-gh-p-pbody .ms-gh-p-where {
  font-family: 'Work Sans', sans-serif; font-weight: 600; font-size: 24px;
  color: #3a4a36; letter-spacing: .06em; margin-top: 10px;
}
.ms-gh-p-packet .ms-gh-p-foot {
  background: #e7dcc1; padding: 12px 28px;
  border-top: 2px dashed #1f2a1c;
  display: flex; justify-content: space-between; align-items: center;
}
.ms-gh-p-packet .ms-gh-p-foot .ms-gh-p-fwhen {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 36px; color: #b85a3a;
}
.ms-gh-p-packet .ms-gh-p-foot .ms-gh-p-tag {
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 18px;
  letter-spacing: .22em; text-transform: uppercase; color: #345e3a;
  background: #f6eed9; padding: 6px 13px;
  border: 2.5px solid #345e3a;
}

/* ─── ANNOUNCEMENT ─────────────────────────────────────── */
/* y=3324, h=180 — pinned terracotta notice */
.ms-gh-p-notice {
  position: absolute; top: 3324px; left: 64px; right: 64px; height: 180px;
  background: #b85a3a; color: #f6eed9;
  border: 5px solid #1f2a1c;
  box-shadow: 12px 12px 0 #1f2a1c;
  padding: 22px 36px;
  overflow: hidden;
  display: grid; grid-template-columns: auto 1fr auto; gap: 36px; align-items: center;
  z-index: 2;
  box-sizing: border-box;
}
.ms-gh-p-notice::before {
  content: ''; position: absolute; top: -16px; left: 50%; transform: translateX(-50%);
  width: 32px; height: 32px; border-radius: 50%;
  background: #b8893c;
  box-shadow:
    0 0 0 4px #1f2a1c,
    0 5px 0 #1f2a1c;
}
.ms-gh-p-notice::after {
  content: ''; position: absolute; right: -80px; bottom: -80px;
  width: 320px; height: 320px; border-radius: 50%;
  background: radial-gradient(circle, rgba(232,165,92,.45), transparent 70%);
  pointer-events: none;
}
.ms-gh-p-notice .ms-gh-p-stamp {
  display: inline-block;
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 24px;
  letter-spacing: .26em; text-transform: uppercase; color: #f6eed9;
  padding: 8px 20px; border: 3px solid #f6eed9;
  transform: rotate(-2deg);
  flex-shrink: 0;
  position: relative; z-index: 2;
}
.ms-gh-p-notice .ms-gh-p-notice-body {
  position: relative; z-index: 2;
  overflow: hidden;
}
.ms-gh-p-notice .ms-gh-p-notice-body h3 {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 64px; line-height: .95;
  color: #f6eed9; margin: 0 0 6px;
  letter-spacing: -.015em;
}
.ms-gh-p-notice .ms-gh-p-notice-body .ms-gh-p-msg {
  font-family: 'Cormorant Garamond', serif; font-weight: 500;
  font-size: 32px; line-height: 1.25; color: rgba(240,231,210,.92);
}
.ms-gh-p-notice .ms-gh-p-notice-body .ms-gh-p-msg b { color: #f6eed9; font-weight: 700; }

/* ─── COUNTDOWN + SIGNPOST ROW ─────────────────────────── */
/* y=3524, h=152 — almanac countdown + cafeteria signpost */
.ms-gh-p-bottom {
  position: absolute; top: 3524px; left: 64px; right: 64px; height: 152px;
  display: grid; grid-template-columns: 1fr 1.4fr; gap: 24px;
  overflow: hidden;
  z-index: 2;
}

/* Countdown — almanac plaque with big numeral */
.ms-gh-p-almanac {
  background: #f6eed9;
  border: 5px solid #1f2a1c;
  box-shadow: 10px 10px 0 #345e3a;
  padding: 16px 28px;
  display: grid; grid-template-columns: 110px 1fr; gap: 24px; align-items: center;
  position: relative; overflow: hidden;
  box-sizing: border-box;
}
.ms-gh-p-almanac::before {
  content: ''; position: absolute; left: 10px; top: 10px; right: 10px; bottom: 10px;
  border: 2px solid #345e3a; pointer-events: none;
}
.ms-gh-p-almanac .ms-gh-p-day {
  text-align: center;
  background: radial-gradient(circle at 40% 30%, #f6eed9, #e7dcc1);
  border: 4px solid #345e3a;
  border-radius: 50%;
  width: 110px; height: 110px;
  display: grid; place-items: center;
  box-shadow:
    inset 0 0 0 3px #f6eed9,
    inset 0 0 0 5px #d6a93f;
  position: relative;
}
.ms-gh-p-almanac .ms-gh-p-day::before {
  content: ''; position: absolute; inset: 9px; border-radius: 50%;
  border: 1px dashed rgba(31,42,28,.35);
}
.ms-gh-p-almanac .ms-gh-p-day .ms-gh-p-n {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 64px; line-height: .85;
  color: #b85a3a; letter-spacing: -.04em;
}
.ms-gh-p-almanac .ms-gh-p-day .ms-gh-p-u {
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 11px;
  letter-spacing: .3em; text-transform: uppercase; color: #3a4a36;
  margin-top: 1px;
}
.ms-gh-p-almanac .ms-gh-p-info { overflow: hidden; }
.ms-gh-p-almanac .ms-gh-p-info .ms-gh-p-eye2 {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 18px;
  letter-spacing: .28em; text-transform: uppercase; color: #345e3a;
}
.ms-gh-p-almanac .ms-gh-p-info .ms-gh-p-tt {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 38px; line-height: .96;
  color: #1f2a1c; margin-top: 2px; letter-spacing: -.018em;
}
.ms-gh-p-almanac .ms-gh-p-info .ms-gh-p-tt em { color: #b85a3a; font-style: italic; }
.ms-gh-p-almanac .ms-gh-p-info .ms-gh-p-ss {
  font-family: 'Cormorant Garamond', serif; font-weight: 500;
  font-size: 20px; color: #3a4a36; margin-top: 4px; line-height: 1.2;
  overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}

/* Cafeteria signpost — plant ID stake */
.ms-gh-p-signpost {
  background: #f6eed9;
  border: 5px solid #1f2a1c;
  box-shadow: 10px 10px 0 #1f2a1c;
  padding: 16px 28px;
  display: grid; grid-template-columns: 96px 1fr auto; gap: 22px; align-items: center;
  position: relative; overflow: hidden;
  box-sizing: border-box;
}
.ms-gh-p-signpost .ms-gh-p-stake {
  height: 110px; position: relative;
  display: flex; flex-direction: column; align-items: center;
}
.ms-gh-p-signpost .ms-gh-p-stake .ms-gh-p-label {
  background: #f6eed9;
  border: 3px solid #345e3a;
  border-radius: 12px 12px 4px 4px;
  padding: 6px 10px;
  text-align: center;
  box-shadow: 3px 3px 0 #345e3a;
}
.ms-gh-p-signpost .ms-gh-p-stake .ms-gh-p-label .ms-gh-p-st-lbl {
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 11px;
  letter-spacing: .26em; text-transform: uppercase; color: #345e3a;
}
.ms-gh-p-signpost .ms-gh-p-stake .ms-gh-p-label .ms-gh-p-ico {
  font-family: 'Cormorant Garamond', serif; font-style: italic;
  font-weight: 700; font-size: 36px; line-height: .9; color: #b85a3a; margin-top: 2px;
}
.ms-gh-p-signpost .ms-gh-p-stake .ms-gh-p-pole {
  width: 12px; flex: 1;
  background: linear-gradient(180deg, #b8893c 0%, #8a6122 100%);
  margin-top: -2px;
  box-shadow: inset -3px 0 0 rgba(0,0,0,.2);
}
.ms-gh-p-signpost .ms-gh-p-info { overflow: hidden; }
.ms-gh-p-signpost .ms-gh-p-info .ms-gh-p-eye3 {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 18px;
  letter-spacing: .26em; text-transform: uppercase; color: #b85a3a;
}
.ms-gh-p-signpost .ms-gh-p-info .ms-gh-p-tt2 {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 40px; line-height: .96; color: #1f2a1c;
  margin-top: 2px; letter-spacing: -.018em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ms-gh-p-signpost .ms-gh-p-info .ms-gh-p-ss2 {
  font-family: 'Cormorant Garamond', serif; font-weight: 500;
  font-size: 20px; color: #3a4a36; margin-top: 4px; line-height: 1.2;
  overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.ms-gh-p-signpost .ms-gh-p-info .ms-gh-p-ss2 b { color: #345e3a; font-weight: 700; }
.ms-gh-p-badges {
  display: flex; flex-direction: column; gap: 6px;
  flex-shrink: 0;
}
.ms-gh-p-badges span {
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 14px;
  letter-spacing: .2em; text-transform: uppercase;
  padding: 6px 11px; border: 2.5px solid #1f2a1c;
  background: #93b07c; color: #1f2a1c;
  text-align: center;
}
.ms-gh-p-badges span.ms-gh-p-gf { background: #d6a93f; }
.ms-gh-p-badges span.ms-gh-p-veg { background: #4f8b48; color: #f6eed9; }

/* ─── TICKER ─── engraved brass plate ─── */
/* y=3696, h=80 */
.ms-gh-p-ticker {
  position: absolute; top: 3696px; left: 64px; right: 64px; height: 80px;
  background: linear-gradient(180deg, #b8893c 0%, #8a6122 100%);
  border: 4px solid #1f2a1c;
  box-shadow: 8px 8px 0 #345e3a;
  display: flex; align-items: stretch;
  overflow: hidden; z-index: 2;
  box-sizing: border-box;
}
.ms-gh-p-ticker::before {
  content: ''; position: absolute; top: 6px; bottom: 6px; left: 6px; right: 6px;
  border: 1.5px solid rgba(31,42,28,.55); pointer-events: none;
}
.ms-gh-p-tag2 {
  background: #345e3a; color: #f6eed9;
  padding: 0 32px;
  display: flex; align-items: center; gap: 14px;
  font-family: 'Cormorant Garamond', serif; font-weight: 700; font-style: italic;
  font-size: 40px; letter-spacing: -.005em;
  border-right: 4px solid #1f2a1c;
  flex-shrink: 0;
  z-index: 1; position: relative;
}
.ms-gh-p-tag2::before {
  content: '❦'; color: #d6a93f; font-size: 32px;
}
.ms-gh-p-feed {
  flex: 1; overflow: hidden; display: flex; align-items: center;
  padding-left: 28px; position: relative; z-index: 1;
}
.ms-gh-p-feed-inner {
  display: flex; gap: 56px;
  font-family: 'Cormorant Garamond', serif; font-weight: 600;
  font-size: 36px; color: #1f2a1c;
  white-space: nowrap; letter-spacing: .005em;
  animation: msGhPScroll 60s linear infinite;
}
.ms-gh-p-feed-inner span { display: inline-flex; align-items: center; gap: 22px; }
.ms-gh-p-feed-inner span::after {
  content: '❧'; color: #8c3f29; font-size: 28px;
  margin-left: 14px;
}
@keyframes msGhPScroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
`;
