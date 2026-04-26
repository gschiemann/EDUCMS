"use client";

/**
 * MsGreenhouseWidget — Middle-school lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-25 — matches scratch/design/greenhouse-ms-v2.html.
 * Reviewed by user, ported via HsStage scale pattern. DO NOT
 * regress to vw/% units. Every pixel size must match the mockup.
 *
 * Scene layout (panels arranged on a 3840×2160 stage):
 *   - school        → top-band conservatory lockup (seal + name + latin tag)
 *   - weather/clock/bloom → top-band brass-rimmed instrument gauges (×3)
 *   - greeting      → herbarium plate hero card (left, 1840px wide)
 *   - agenda        → moss-green specimens index (right column, 6 entries)
 *   - club.0–2      → seed-packet club cards (3-up)
 *   - announcement  → terracotta pinned-up notice card
 *   - countdown     → almanac page with circular day numeral
 *   - lunch         → cafeteria signpost (plant-stake label + sides + diet badges)
 *   - ticker        → engraved brass plate scrolling news
 *
 * box-sizing: border-box on every panel that sets an explicit width is
 * load-bearing — the herbarium .plate (with 4px outer border + 18px inset
 * border + 64px horizontal padding) and the .index right column rely on
 * it to land on their intended edge.
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';
import { useLiveTemplateData, fmt } from '../lib/useLiveTemplateData';

export interface MsGreenhouseConfig {
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
  // Hero — specimens index (today's periods)
  'agenda.title'?: string;
  'agenda.date'?: string;
  'agenda.label'?: string;
  'agenda.count'?: string;
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
  // Mid band — pinned announcement card
  'announcement.stamp'?: string;
  'announcement.headline'?: string;
  'announcement.message'?: string;
  // Bottom — countdown almanac
  'countdown.value'?: string;
  'countdown.unit'?: string;
  'countdown.kicker'?: string;
  'countdown.title'?: string;
  'countdown.title2'?: string;
  'countdown.title3'?: string;
  'countdown.sub'?: string;
  // Bottom — cafeteria signpost
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

export const DEFAULTS: Required<MsGreenhouseConfig> = {
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
  'agenda.date': 'Tue · Apr 21 · ',
  'agenda.label': 'DAY B',
  'agenda.count': ' · 6 entries',
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
    '284 otters already in. Pass the word at lunch tables, hallways, anywhere.',
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
 * caller passed an empty string. Mirrors the arcade/atlas widgets'
 * pattern of "empty string → use default" — empty strings in the editor
 * mean "blank" but in the demo we want the demo copy.
 */
function pick<K extends keyof Required<MsGreenhouseConfig>>(
  cfg: MsGreenhouseConfig,
  key: K,
): string {
  const v = cfg[key];
  return (v === undefined || v === '' ? DEFAULTS[key] : v) as string;
}

export function MsGreenhouseWidget({ config, live }: { config?: MsGreenhouseConfig; live?: boolean }) {
  const cfg = config || {};

  // Live clock + weather. Operator-typed values still WIN — the hook
  // is the FALLBACK for fields the teacher hasn't customized.
  const { now, weather } = useLiveTemplateData({
    live,
    weatherLocation: (cfg as any).weatherLocation,
    weatherUnits: (cfg as any).weatherUnits,
    weatherOverride: cfg['weather.temp'],
  });

  const pick = <K extends keyof Required<MsGreenhouseConfig>>(key: K): string => {
    const v = cfg[key];
    if (v !== undefined && v !== '') return v as string;
    if (live) {
      if (key === 'clock.time') return fmt.time12NoSuffix(now);
      if (key === 'weather.temp' && weather) return `${weather.tempF}°`;
    }
    return DEFAULTS[key] as string;
  };

  return (
    <HsStage
      stageStyle={{
        background: '#f0e7d2',
        backgroundImage: [
          'radial-gradient(ellipse 1800px 1100px at 25% 8%, rgba(214,169,63,.18), transparent 70%)',
          'radial-gradient(ellipse 1500px 900px at 88% 92%, rgba(52,94,58,.18), transparent 70%)',
          'radial-gradient(ellipse 800px 600px at 5% 70%, rgba(184,90,58,.10), transparent 70%)',
          'radial-gradient(rgba(31,42,28,.045) 1px, transparent 1.4px)',
        ].join(', '),
        backgroundSize: 'auto, auto, auto, 22px 22px',
        fontFamily: "'Cormorant Garamond', 'IM Fell English', serif",
        color: '#1f2a1c',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Foxing/aging spots — the mockup paints these on .stage::before
          but HsStage owns its ::before; render as a dedicated layer. */}
      <div className="ms-gh-foxing" aria-hidden="true" />
      {/* Conservatory glasshouse mullion arches at the top */}
      <div className="ms-gh-mullions" aria-hidden="true" />

      {/* ─── Botanical corner decorations (hand-drawn ferns) ─── */}
      <div className="ms-gh-corner-fern ms-gh-tl" aria-hidden="true">
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

      <div className="ms-gh-corner-fern ms-gh-br" aria-hidden="true">
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

      {/* ─── TOP BAND ────────────────────────────────────── */}
      <header className="ms-gh-top">
        <div className="ms-gh-lockup" data-widget="school">
          <div className="ms-gh-seal" aria-hidden="true">
            <span className="ms-gh-est">EST · 1924</span>
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M50 88 L50 50"
                stroke="#345e3a"
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M50 50 Q35 42 30 28 Q42 30 50 44"
                fill="#4f8b48"
              />
              <path
                d="M50 50 Q65 42 70 28 Q58 30 50 44"
                fill="#4f8b48"
              />
              <path
                d="M50 60 Q40 56 34 48 Q44 52 50 58"
                fill="#6f9b78"
              />
              <path
                d="M50 60 Q60 56 66 48 Q56 52 50 58"
                fill="#6f9b78"
              />
              <circle cx="50" cy="34" r="6" fill="#e8a55c" />
              <path
                d="M22 86 Q50 80 78 86 L78 92 Q50 95 22 92 Z"
                fill="#8c3f29"
              />
            </svg>
          </div>
          <div className="ms-gh-ident">
            <div className="ms-gh-eyebrow">
              <span data-field="school.eye" style={{ whiteSpace: 'pre-wrap' }}>{pick('school.eye')}</span>
            </div>
            <div className="ms-gh-name">
              <span data-field="school.name" style={{ whiteSpace: 'pre-wrap' }}>{pick('school.name')}</span>
              <em data-field="school.name2" style={{ whiteSpace: 'pre-wrap' }}>{pick('school.name2')}</em>
            </div>
            <div className="ms-gh-latin">
              <span data-field="school.latin" style={{ whiteSpace: 'pre-wrap' }}>{pick('school.latin')}</span>
              <b data-field="school.day" style={{ whiteSpace: 'pre-wrap' }}>{pick('school.day')}</b>
              <span data-field="school.tag" style={{ whiteSpace: 'pre-wrap' }}>{pick('school.tag')}</span>
            </div>
          </div>
        </div>

        <div className="ms-gh-instruments">
          <div className="ms-gh-gauge" data-widget="weather">
            <div className="ms-gh-lbl" data-field="weather.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('weather.label')}
            </div>
            <div
              className="ms-gh-val ms-gh-cool"
              data-field="weather.temp"
             style={{ whiteSpace: 'pre-wrap' }}>
              {pick('weather.temp')}
            </div>
            <div className="ms-gh-ticks" aria-hidden="true" />
            <div className="ms-gh-sub" data-field="weather.cond" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('weather.cond')}
            </div>
          </div>
          <div className="ms-gh-gauge" data-widget="clock">
            <div className="ms-gh-lbl" data-field="clock.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('clock.label')}
            </div>
            <div className="ms-gh-val" data-field="clock.time" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('clock.time')}
            </div>
            <div className="ms-gh-ticks" aria-hidden="true" />
            <div className="ms-gh-sub" data-field="clock.sub" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('clock.sub')}
            </div>
          </div>
          <div className="ms-gh-gauge" data-widget="bloom">
            <div className="ms-gh-lbl" data-field="bloom.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('bloom.label')}
            </div>
            <div
              className="ms-gh-val ms-gh-warm"
              data-field="bloom.value"
             style={{ whiteSpace: 'pre-wrap' }}>
              {pick('bloom.value')}
            </div>
            <div className="ms-gh-ticks" aria-hidden="true" />
            <div className="ms-gh-sub" data-field="bloom.sub" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('bloom.sub')}
            </div>
          </div>
        </div>
      </header>

      {/* ─── HERO ROW ────────────────────────────────────── */}
      <section className="ms-gh-hero-row">
        {/* LEFT: Herbarium specimen plate */}
        <div className="ms-gh-plate" data-widget="greeting">
          <div className="ms-gh-accession">
            <b data-field="greeting.acc" style={{ whiteSpace: 'pre-wrap' }}>{pick('greeting.acc')}</b>
            <span data-field="greeting.acc2" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('greeting.acc2')
                .split('\n')
                .map((line, i, arr) => (
                  <React.Fragment key={i}>
                    {line}
                    {i < arr.length - 1 ? <br /> : null}
                  </React.Fragment>
                ))}
            </span>
          </div>
          <div className="ms-gh-chapter">
            <span className="ms-gh-ornament">❦</span>
            <span data-field="greeting.kicker" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('greeting.kicker')}
            </span>
          </div>
          <h1 className="ms-gh-h1">
            <span data-field="greeting.h1" style={{ whiteSpace: 'pre-wrap' }}>{pick('greeting.h1')}</span>
            <em data-field="greeting.h2" style={{ whiteSpace: 'pre-wrap' }}>{pick('greeting.h2')}</em>
            <span data-field="greeting.h3" style={{ whiteSpace: 'pre-wrap' }}>{pick('greeting.h3')}</span>
            <span className="ms-gh-accent" data-field="greeting.h4" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('greeting.h4')}
            </span>
          </h1>
          <p className="ms-gh-lede" data-field="greeting.lede" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('greeting.lede')}
          </p>

          <div className="ms-gh-signoff">
            — with care,
            <br />
            <b data-field="greeting.sign" style={{ whiteSpace: 'pre-wrap' }}>{pick('greeting.sign')}</b>
          </div>

          <div className="ms-gh-illos" aria-hidden="true">
            {/* Specimen 1: Monstera leaf */}
            <div className="ms-gh-specimen">
              <svg
                width="200"
                height="240"
                viewBox="0 0 100 120"
                xmlns="http://www.w3.org/2000/svg"
              >
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
              <div className="ms-gh-ill-latin">
                Monstera deliciosa
                <b>Patience</b>
              </div>
            </div>

            {/* Specimen 2: Coleus / fern */}
            <div className="ms-gh-specimen">
              <svg
                width="200"
                height="240"
                viewBox="0 0 100 120"
                xmlns="http://www.w3.org/2000/svg"
              >
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
              <div className="ms-gh-ill-latin">
                Nephrolepis exaltata
                <b>Persistence</b>
              </div>
            </div>

            {/* Specimen 3: Sunflower-style bloom in clay pot */}
            <div className="ms-gh-specimen">
              <svg
                width="220"
                height="240"
                viewBox="0 0 110 120"
                xmlns="http://www.w3.org/2000/svg"
              >
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
              <div className="ms-gh-ill-latin">
                Helianthus annuus
                <b>Courage</b>
              </div>
            </div>

            {/* Specimen 4: Lavender stalks */}
            <div className="ms-gh-specimen">
              <svg
                width="200"
                height="240"
                viewBox="0 0 100 120"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g>
                  <g
                    stroke="#345e3a"
                    strokeWidth="2"
                    fill="none"
                    strokeLinecap="round"
                  >
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
              <div className="ms-gh-ill-latin">
                Lavandula officinalis
                <b>Calm</b>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Specimens index (today's periods as taxonomic entries) */}
        <div className="ms-gh-index" data-widget="agenda">
          <div className="ms-gh-head">
            <div className="ms-gh-eye">Hortus Botanicus · Index</div>
            <h2 data-field="agenda.title" style={{ whiteSpace: 'pre-wrap' }}>{pick('agenda.title')}</h2>
            <div className="ms-gh-meta">
              <span data-field="agenda.date" style={{ whiteSpace: 'pre-wrap' }}>{pick('agenda.date')}</span>
              <b data-field="agenda.label" style={{ whiteSpace: 'pre-wrap' }}>{pick('agenda.label')}</b>
              <span data-field="agenda.count" style={{ whiteSpace: 'pre-wrap' }}>{pick('agenda.count')}</span>
            </div>
          </div>
          <div className="ms-gh-specimens">
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
                className={`ms-gh-sp${cls ? ` ms-gh-${cls}` : ''}`}
                data-widget={`agenda.${i}`}
              >
                <div className="ms-gh-num">{num}</div>
                <div className="ms-gh-body">
                  <div
                    className="ms-gh-common"
                    data-field={`agenda.${i}.t`}
                   style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(`agenda.${i}.t` as keyof Required<MsGreenhouseConfig>)}
                  </div>
                  <div className="ms-gh-sp-latin">
                    <span data-field={`agenda.${i}.l`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(`agenda.${i}.l` as keyof Required<MsGreenhouseConfig>)}
                    </span>
                    <b data-field={`agenda.${i}.r`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(`agenda.${i}.r` as keyof Required<MsGreenhouseConfig>)}
                    </b>
                  </div>
                </div>
                <div className="ms-gh-when">
                  <div className="ms-gh-t" data-field={`agenda.${i}.h`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(`agenda.${i}.h` as keyof Required<MsGreenhouseConfig>)}
                  </div>
                  <div
                    className="ms-gh-stage-pill"
                    data-field={`agenda.${i}.s`}
                   style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(`agenda.${i}.s` as keyof Required<MsGreenhouseConfig>)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── MID BAND: seed-packet club cards + announcement ─── */}
      <section className="ms-gh-mid">
        {(
          [
            { i: 0, variant: '' },
            { i: 1, variant: 'terra' },
            { i: 2, variant: 'brass' },
          ] as const
        ).map(({ i, variant }) => (
          <div
            key={i}
            className={`ms-gh-packet${variant ? ` ms-gh-${variant}` : ''}`}
            data-widget={`club.${i}`}
          >
            <div className="ms-gh-band">
              <span
                className="ms-gh-dept"
                data-field={`club.${i}.dept`}
               style={{ whiteSpace: 'pre-wrap' }}>
                {pick(`club.${i}.dept` as keyof Required<MsGreenhouseConfig>)}
              </span>
              <span
                className="ms-gh-lot"
                data-field={`club.${i}.lot`}
               style={{ whiteSpace: 'pre-wrap' }}>
                {pick(`club.${i}.lot` as keyof Required<MsGreenhouseConfig>)}
              </span>
            </div>
            <div className="ms-gh-pbody">
              <div
                className="ms-gh-pcommon"
                data-field={`club.${i}.t`}
               style={{ whiteSpace: 'pre-wrap' }}>
                {pick(`club.${i}.t` as keyof Required<MsGreenhouseConfig>)}
              </div>
              <div
                className="ms-gh-platin"
                data-field={`club.${i}.l`}
               style={{ whiteSpace: 'pre-wrap' }}>
                {pick(`club.${i}.l` as keyof Required<MsGreenhouseConfig>)}
              </div>
              <div
                className="ms-gh-where"
                data-field={`club.${i}.r`}
               style={{ whiteSpace: 'pre-wrap' }}>
                {pick(`club.${i}.r` as keyof Required<MsGreenhouseConfig>)}
              </div>
            </div>
            <div className="ms-gh-foot">
              <div
                className="ms-gh-fwhen"
                data-field={`club.${i}.h`}
               style={{ whiteSpace: 'pre-wrap' }}>
                {pick(`club.${i}.h` as keyof Required<MsGreenhouseConfig>)}
              </div>
              <div
                className="ms-gh-tag"
                data-field={`club.${i}.tag`}
               style={{ whiteSpace: 'pre-wrap' }}>
                {pick(`club.${i}.tag` as keyof Required<MsGreenhouseConfig>)}
              </div>
            </div>
          </div>
        ))}

        <div className="ms-gh-notice" data-widget="announcement">
          <span
            className="ms-gh-stamp"
            data-field="announcement.stamp"
           style={{ whiteSpace: 'pre-wrap' }}>
            {pick('announcement.stamp')}
          </span>
          <h3 data-field="announcement.headline" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('announcement.headline')}
          </h3>
          <div className="ms-gh-msg" data-field="announcement.message" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('announcement.message')}
          </div>
        </div>
      </section>

      {/* ─── BOTTOM ROW: countdown + cafeteria signpost ─── */}
      <section className="ms-gh-bottom">
        <div className="ms-gh-almanac" data-widget="countdown">
          <div className="ms-gh-day">
            <div>
              <div className="ms-gh-n" data-field="countdown.value" style={{ whiteSpace: 'pre-wrap' }}>
                {pick('countdown.value')}
              </div>
              <div className="ms-gh-u" data-field="countdown.unit" style={{ whiteSpace: 'pre-wrap' }}>
                {pick('countdown.unit')}
              </div>
            </div>
          </div>
          <div className="ms-gh-info">
            <div className="ms-gh-eye2" data-field="countdown.kicker" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('countdown.kicker')}
            </div>
            <div className="ms-gh-tt">
              <span data-field="countdown.title" style={{ whiteSpace: 'pre-wrap' }}>
                {pick('countdown.title')}
              </span>
              <em data-field="countdown.title2" style={{ whiteSpace: 'pre-wrap' }}>
                {pick('countdown.title2')}
              </em>
              <span data-field="countdown.title3" style={{ whiteSpace: 'pre-wrap' }}>
                {pick('countdown.title3')}
              </span>
            </div>
            <div className="ms-gh-ss" data-field="countdown.sub" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('countdown.sub')}
            </div>
          </div>
        </div>

        <div className="ms-gh-signpost" data-widget="lunch">
          <div className="ms-gh-stake" aria-hidden="true">
            <div className="ms-gh-label">
              <div className="ms-gh-st-lbl">Today's Plate</div>
              <div className="ms-gh-ico">N° 4</div>
            </div>
            <div className="ms-gh-pole" />
          </div>
          <div className="ms-gh-info">
            <div className="ms-gh-eye3" data-field="lunch.eye" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('lunch.eye')}
            </div>
            <div className="ms-gh-tt2" data-field="lunch.title" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('lunch.title')}
            </div>
            <div className="ms-gh-ss2">
              <span data-field="lunch.sides" style={{ whiteSpace: 'pre-wrap' }}>
                {pick('lunch.sides')}
              </span>
              <b data-field="lunch.sides2" style={{ whiteSpace: 'pre-wrap' }}>{pick('lunch.sides2')}</b>
            </div>
          </div>
          <div className="ms-gh-badges">
            <span className="ms-gh-veg" data-field="lunch.b1" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('lunch.b1')}
            </span>
            <span className="ms-gh-gf" data-field="lunch.b2" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('lunch.b2')}
            </span>
          </div>
        </div>
      </section>

      {/* ─── TICKER: engraved brass plate ─── */}
      <div className="ms-gh-ticker" data-widget="ticker">
        <div className="ms-gh-tag2" data-field="ticker.tag" style={{ whiteSpace: 'pre-wrap' }}>
          {pick('ticker.tag')}
        </div>
        <div className="ms-gh-feed">
          <div className="ms-gh-feed-inner">
            <span data-field="ticker.0" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.0')}</span>
            <span data-field="ticker.1" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.1')}</span>
            <span data-field="ticker.2" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.2')}</span>
            <span data-field="ticker.3" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.3')}</span>
            <span data-field="ticker.4" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.4')}</span>
            <span data-field="ticker.5" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.5')}</span>
            <span data-field="ticker.6" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.6')}</span>
            <span aria-hidden="true">{pick('ticker.0')}</span>
            <span aria-hidden="true">{pick('ticker.1')}</span>
            <span aria-hidden="true">{pick('ticker.2')}</span>
            <span aria-hidden="true">{pick('ticker.3')}</span>
            <span aria-hidden="true">{pick('ticker.4')}</span>
            <span aria-hidden="true">{pick('ticker.5')}</span>
            <span aria-hidden="true">{pick('ticker.6')}</span>
          </div>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — every pixel value matches scratch/design/greenhouse-ms-v2.html. */
const CSS = `
/* Box-sizing border-box on every panel that sets an explicit width. The
   herbarium .ms-gh-plate (with 4px outer border + 18px inset border +
   64px horizontal padding) and the .ms-gh-index right column rely on
   it to land on their intended edge. */
.ms-gh-plate, .ms-gh-index, .ms-gh-packet, .ms-gh-notice,
.ms-gh-almanac, .ms-gh-signpost, .ms-gh-ticker, .ms-gh-gauge {
  box-sizing: border-box;
}

/* Foxing/aging spots — randomly scattered tiny rust marks
   (mockup paints these on .stage::before; HsStage owns its own ::before). */
.ms-gh-foxing {
  position: absolute; inset: 0; pointer-events: none; opacity: .55; z-index: 0;
  background-image:
    radial-gradient(circle at 12% 18%, rgba(140,63,41,.18) 0 4px, transparent 5px),
    radial-gradient(circle at 23% 76%, rgba(140,63,41,.15) 0 5px, transparent 6px),
    radial-gradient(circle at 67% 12%, rgba(140,63,41,.12) 0 3px, transparent 4px),
    radial-gradient(circle at 84% 60%, rgba(140,63,41,.18) 0 6px, transparent 7px),
    radial-gradient(circle at 41% 44%, rgba(140,63,41,.10) 0 4px, transparent 5px),
    radial-gradient(circle at 92% 22%, rgba(140,63,41,.14) 0 4px, transparent 5px),
    radial-gradient(circle at 5% 50%, rgba(140,63,41,.14) 0 3px, transparent 4px),
    radial-gradient(circle at 56% 88%, rgba(140,63,41,.12) 0 5px, transparent 6px);
}
/* Conservatory glasshouse mullion arches at the top corners
   (mockup paints these on .stage::after). */
.ms-gh-mullions {
  position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: .10;
  background-image:
    linear-gradient(180deg, rgba(31,42,28,.4) 0 2px, transparent 2px 100%),
    repeating-linear-gradient(90deg, rgba(31,42,28,.2) 0 2px, transparent 2px 240px),
    repeating-linear-gradient(0deg, rgba(31,42,28,.2) 0 2px, transparent 2px 240px);
  background-size: 100% 80px, 100% 100%, 100% 100%;
  -webkit-mask: linear-gradient(180deg, #000 0%, transparent 18%);
  mask: linear-gradient(180deg, #000 0%, transparent 18%);
}

/* Botanical SVG decorations growing from corners */
.ms-gh-corner-fern { position: absolute; pointer-events: none; z-index: 0; }
.ms-gh-corner-fern.ms-gh-tl { top: -30px; left: -30px; width: 520px; height: 520px; transform: rotate(-8deg); opacity: .85; }
.ms-gh-corner-fern.ms-gh-br { bottom: -40px; right: -40px; width: 560px; height: 560px; transform: rotate(170deg); opacity: .78; }
.ms-gh-corner-fern svg { width: 100%; height: 100%; }

/* ─── TOP BAND ─────────────────────────────────────────── */
.ms-gh-top {
  position: absolute; top: 56px; left: 64px; right: 64px; height: 264px;
  display: grid; grid-template-columns: 1fr auto; gap: 44px; align-items: center;
  z-index: 2;
}

/* Conservatory lockup — ornate label cartouche */
.ms-gh-lockup {
  display: grid; grid-template-columns: 220px 1fr; gap: 36px; align-items: center;
}
/* Hand-drawn monogram seal: brass ring + sprout silhouette */
.ms-gh-seal {
  width: 220px; height: 220px; position: relative; flex-shrink: 0;
  background: #f6eed9;
  border-radius: 50%;
  border: 5px solid #345e3a;
  box-shadow:
    inset 0 0 0 14px #f6eed9,
    inset 0 0 0 16px #b8893c,
    6px 8px 0 #345e3a;
}
.ms-gh-seal::before {
  content: ''; position: absolute; inset: 24px; border-radius: 50%;
  border: 1.5px dashed rgba(31,42,28,.5);
}
.ms-gh-seal svg { position: absolute; inset: 32px; width: calc(100% - 64px); height: calc(100% - 64px); }
.ms-gh-est {
  position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
  background: #345e3a; color: #f6eed9;
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 16px;
  letter-spacing: .26em; padding: 6px 14px; border-radius: 4px;
  text-transform: uppercase;
}

.ms-gh-ident .ms-gh-eyebrow {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 28px;
  letter-spacing: .32em; text-transform: uppercase; color: #b85a3a;
  display: inline-flex; align-items: center; gap: 18px;
}
.ms-gh-ident .ms-gh-eyebrow::before,
.ms-gh-ident .ms-gh-eyebrow::after {
  content: ''; width: 70px; height: 3px; background: #b85a3a;
}
.ms-gh-ident .ms-gh-name {
  font-family: 'Cormorant Garamond', serif; font-style: italic; font-weight: 700;
  font-size: 138px; line-height: .92; letter-spacing: -.02em;
  color: #1f2a1c; margin-top: 4px;
}
.ms-gh-ident .ms-gh-name em {
  font-style: italic; color: #345e3a;
}
.ms-gh-ident .ms-gh-latin {
  font-family: 'IM Fell English', serif; font-style: italic; font-weight: 400;
  font-size: 32px; color: #3a4a36; letter-spacing: .03em;
  margin-top: 8px;
}
.ms-gh-ident .ms-gh-latin b { color: #a23046; font-style: normal; font-weight: 700; }

/* Right — brass-rimmed instrument gauges */
.ms-gh-instruments { display: flex; gap: 24px; }
.ms-gh-gauge {
  width: 220px; height: 224px;
  background: radial-gradient(circle at 30% 30%, #f6eed9, #e7dcc1);
  border: 6px solid #b8893c;
  border-radius: 18px;
  box-shadow:
    inset 0 0 0 3px #f6eed9,
    inset 0 0 28px rgba(138,97,34,.18),
    6px 6px 0 #345e3a;
  padding: 18px 20px 16px;
  display: flex; flex-direction: column; justify-content: space-between;
  position: relative;
}
.ms-gh-gauge::before {
  content: ''; position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  width: 90px; height: 6px; background: #8a6122; border-radius: 3px;
  box-shadow: 0 2px 0 rgba(0,0,0,.15);
}
.ms-gh-gauge .ms-gh-lbl {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 22px;
  letter-spacing: .22em; text-transform: uppercase; color: #3a4a36;
  text-align: center; margin-top: 16px;
}
.ms-gh-gauge .ms-gh-val {
  font-family: 'Cormorant Garamond', serif; font-weight: 700; font-style: italic;
  font-size: 86px; line-height: .9; color: #1f2a1c; text-align: center;
  letter-spacing: -.01em;
}
.ms-gh-gauge .ms-gh-val.ms-gh-warm { color: #b85a3a; }
.ms-gh-gauge .ms-gh-val.ms-gh-cool { color: #7fa8b8; }
.ms-gh-gauge .ms-gh-sub {
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 22px; color: #345e3a; text-align: center;
}
/* Tick marks on the gauge body */
.ms-gh-gauge .ms-gh-ticks {
  position: absolute; left: 14px; right: 14px; bottom: 92px; height: 6px;
  background: repeating-linear-gradient(90deg, #8a6122 0 2px, transparent 2px 18px);
  opacity: .55;
}

/* ─── HERO ROW: Herbarium plate (left) + Specimens index (right) ─── */
.ms-gh-hero-row {
  position: absolute; top: 340px; left: 64px; right: 64px; height: 1080px;
  display: grid; grid-template-columns: 1840px 1fr; gap: 32px;
  z-index: 2;
}

/* LEFT — Herbarium specimen plate */
.ms-gh-plate {
  background: #f6eed9;
  border: 4px solid #1f2a1c;
  box-shadow:
    inset 0 0 0 18px #f6eed9,
    inset 0 0 0 20px #345e3a,
    14px 14px 0 #345e3a;
  padding: 56px 64px;
  position: relative; overflow: hidden;
  display: flex; flex-direction: column;
}
/* Inner double-rule frame typical of herbarium sheets */
.ms-gh-plate::before {
  content: ''; position: absolute; inset: 34px;
  border: 1.5px solid #1f2a1c;
  pointer-events: none;
}
.ms-gh-plate::after {
  content: ''; position: absolute; inset: 42px;
  border: 0.5px solid #8a6122;
  pointer-events: none;
}
.ms-gh-accession {
  position: absolute; top: 60px; right: 64px;
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 26px; color: #3a4a36;
  transform: rotate(2deg);
  text-align: right; line-height: 1.3;
  z-index: 2;
}
.ms-gh-accession b {
  display: block; font-family: 'Work Sans', sans-serif; font-style: normal;
  font-weight: 800; font-size: 22px; letter-spacing: .18em;
  color: #b85a3a; text-transform: uppercase;
}
.ms-gh-chapter {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 30px;
  letter-spacing: .3em; text-transform: uppercase; color: #345e3a;
  display: inline-flex; align-items: center; gap: 22px;
  margin-bottom: 20px; position: relative; z-index: 2;
}
.ms-gh-chapter::before {
  content: ''; width: 90px; height: 3px; background: #345e3a;
}
.ms-gh-chapter .ms-gh-ornament { color: #a23046; font-size: 36px; line-height: 1; }
.ms-gh-h1 {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-size: 248px; line-height: .85; letter-spacing: -.025em;
  color: #1f2a1c; margin: 0; position: relative; z-index: 2;
  text-wrap: balance;
}
.ms-gh-h1 em {
  font-style: italic; color: #345e3a;
  background: linear-gradient(180deg, transparent 75%, rgba(232,165,92,.45) 75% 92%, transparent 92%);
  padding: 0 8px; border-radius: 4px;
}
.ms-gh-h1 .ms-gh-accent {
  color: #b85a3a; font-style: italic;
}
.ms-gh-lede {
  font-family: 'Cormorant Garamond', serif; font-weight: 500;
  font-size: 50px; line-height: 1.32; color: #3a4a36;
  margin-top: 36px; max-width: 1500px; position: relative; z-index: 2;
}
.ms-gh-lede em { color: #345e3a; font-weight: 600; font-style: italic; }
/* Bottom strip: hand-tinted botanical illustration row */
.ms-gh-illos {
  position: absolute; left: 64px; right: 64px; bottom: 56px;
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 40px; z-index: 1;
}
.ms-gh-specimen {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  flex: 1;
}
.ms-gh-specimen svg { display: block; }
.ms-gh-ill-latin {
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 26px; color: #3a4a36; letter-spacing: .04em;
  text-align: center; line-height: 1.2; max-width: 320px;
}
.ms-gh-ill-latin b {
  display: block; font-family: 'Work Sans', sans-serif; font-style: normal;
  font-weight: 800; font-size: 18px; letter-spacing: .22em;
  color: #b85a3a; text-transform: uppercase; margin-top: 4px;
}

/* Botanical name strip — handwritten cataloger note in bottom-right */
.ms-gh-signoff {
  position: absolute; bottom: 70px; right: 84px;
  font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 36px; color: #3a4a36;
  transform: rotate(-3deg);
  line-height: 1.1;
  z-index: 2;
}
.ms-gh-signoff b {
  display: block; font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 30px; color: #a23046;
  margin-top: 4px;
}

/* RIGHT — Specimen Index (today's agenda as taxonomy) */
.ms-gh-index {
  background: linear-gradient(180deg, #345e3a 0%, #2a4a2e 100%);
  color: #f6eed9;
  border: 4px solid #1f2a1c;
  box-shadow:
    inset 0 0 0 14px #345e3a,
    inset 0 0 0 16px #d6a93f,
    14px 14px 0 #1f2a1c;
  padding: 36px 36px 30px;
  position: relative; overflow: hidden;
  display: flex; flex-direction: column;
}
.ms-gh-index::before {
  content: ''; position: absolute; right: -90px; top: -90px;
  width: 360px; height: 360px; border-radius: 50%;
  background: radial-gradient(circle, rgba(214,169,63,.30), transparent 70%);
  pointer-events: none;
}
.ms-gh-head {
  padding-bottom: 18px; border-bottom: 2px solid #d6a93f;
  margin-bottom: 18px;
}
.ms-gh-head .ms-gh-eye {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 22px;
  letter-spacing: .26em; text-transform: uppercase; color: #d6a93f;
}
.ms-gh-head h2 {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 80px; line-height: .9;
  color: #f6eed9; margin: 6px 0 0; letter-spacing: -.015em;
}
.ms-gh-head .ms-gh-meta {
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 26px; color: #93b07c; margin-top: 8px;
}
.ms-gh-head .ms-gh-meta b { color: #e8a55c; font-weight: 700; font-style: normal; }
/* Specimen list — six taxonomic cards */
.ms-gh-specimens {
  flex: 1; display: flex; flex-direction: column; gap: 12px;
  overflow: hidden;
}
.ms-gh-sp {
  display: grid; grid-template-columns: 78px 1fr auto; gap: 18px; align-items: center;
  padding: 13px 16px;
  background: rgba(240,231,210,.06);
  border: 1.5px solid rgba(214,169,63,.45);
  border-left: 6px solid #93b07c;
  position: relative;
}
.ms-gh-sp.ms-gh-now {
  background: linear-gradient(90deg, rgba(232,165,92,.22), rgba(214,169,63,.12));
  border-color: #e8a55c;
  border-left: 6px solid #b85a3a;
  box-shadow: 0 0 0 2px rgba(232,165,92,.3);
}
.ms-gh-sp.ms-gh-done { opacity: .55; }
.ms-gh-sp.ms-gh-done::after {
  content: ''; position: absolute; left: 8px; right: 8px; top: 50%;
  height: 1.5px; background: #93b07c; transform: translateY(-50%);
  pointer-events: none; opacity: .5;
}
.ms-gh-num {
  font-family: 'Cormorant Garamond', serif; font-style: italic;
  font-weight: 700; font-size: 56px; color: #d6a93f;
  line-height: 1; text-align: center;
}
.ms-gh-sp.ms-gh-now .ms-gh-num { color: #e8a55c; }
.ms-gh-body { line-height: 1.05; }
.ms-gh-common {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-size: 38px; color: #f6eed9; letter-spacing: -.005em;
  line-height: 1.05;
}
.ms-gh-sp-latin {
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 22px; color: #93b07c; margin-top: 4px; letter-spacing: .03em;
  line-height: 1.1;
}
.ms-gh-sp-latin b { font-style: normal; color: #e8a55c; font-weight: 700; }
.ms-gh-when { text-align: right; line-height: 1.05; }
.ms-gh-when .ms-gh-t {
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 28px;
  color: #f6eed9; letter-spacing: .04em;
}
.ms-gh-when .ms-gh-stage-pill {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 16px;
  letter-spacing: .2em; text-transform: uppercase;
  color: #93b07c; margin-top: 4px;
  display: inline-block;
}
.ms-gh-sp.ms-gh-now .ms-gh-when .ms-gh-stage-pill { color: #e8a55c; }
.ms-gh-sp.ms-gh-now .ms-gh-when .ms-gh-t { color: #e8a55c; }
.ms-gh-sp.ms-gh-done .ms-gh-when .ms-gh-t { text-decoration: line-through; color: #93b07c; }

/* ─── MID BAND: seed-packet club cards + announcement ─── */
.ms-gh-mid {
  position: absolute; top: 1440px; left: 64px; right: 64px; height: 300px;
  display: grid; grid-template-columns: repeat(3, 1fr) 1.4fr; gap: 22px;
  z-index: 2;
}
/* Seed packet — vertically stacked, with botanical illustration band */
.ms-gh-packet {
  background: #f6eed9;
  border: 4px solid #1f2a1c;
  box-shadow: 8px 10px 0 #1f2a1c;
  padding: 0;
  display: grid; grid-template-rows: 92px 1fr auto;
  overflow: hidden;
  position: relative;
}
.ms-gh-band {
  background: #345e3a; color: #f6eed9;
  padding: 12px 22px;
  display: flex; justify-content: space-between; align-items: center;
  border-bottom: 4px solid #1f2a1c;
  position: relative;
}
.ms-gh-packet.ms-gh-terra .ms-gh-band { background: #b85a3a; }
.ms-gh-packet.ms-gh-brass .ms-gh-band { background: #b8893c; color: #1f2a1c; }
.ms-gh-band .ms-gh-dept {
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 20px;
  letter-spacing: .26em; text-transform: uppercase;
}
.ms-gh-band .ms-gh-lot {
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 24px;
}
.ms-gh-pbody {
  padding: 18px 24px 14px;
  display: flex; flex-direction: column; justify-content: center;
  position: relative;
}
.ms-gh-pcommon {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 56px; line-height: .95;
  color: #1f2a1c; letter-spacing: -.015em;
}
.ms-gh-platin {
  font-family: 'IM Fell English', serif; font-style: italic;
  font-size: 24px; color: #345e3a; margin-top: 6px;
  line-height: 1.15;
}
.ms-gh-where {
  font-family: 'Work Sans', sans-serif; font-weight: 600; font-size: 22px;
  color: #3a4a36; letter-spacing: .06em; margin-top: 8px;
}
.ms-gh-foot {
  background: #e7dcc1; padding: 10px 22px;
  border-top: 1.5px dashed #1f2a1c;
  display: flex; justify-content: space-between; align-items: center;
}
.ms-gh-fwhen {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 32px; color: #b85a3a;
}
.ms-gh-tag {
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 16px;
  letter-spacing: .22em; text-transform: uppercase; color: #345e3a;
  background: #f6eed9; padding: 5px 11px;
  border: 2px solid #345e3a;
}

/* Announcement — pinned-up notice card */
.ms-gh-notice {
  background: #b85a3a; color: #f6eed9;
  border: 4px solid #1f2a1c;
  box-shadow: 10px 10px 0 #1f2a1c;
  padding: 26px 32px;
  position: relative; overflow: hidden;
  display: flex; flex-direction: column; justify-content: center;
}
.ms-gh-notice::before {
  content: ''; position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
  width: 28px; height: 28px; border-radius: 50%;
  background: #b8893c;
  box-shadow:
    0 0 0 3px #1f2a1c,
    0 4px 0 #1f2a1c;
}
.ms-gh-notice::after {
  content: ''; position: absolute; right: -60px; bottom: -60px;
  width: 240px; height: 240px; border-radius: 50%;
  background: radial-gradient(circle, rgba(232,165,92,.45), transparent 70%);
  pointer-events: none;
}
.ms-gh-stamp {
  display: inline-block;
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 22px;
  letter-spacing: .26em; text-transform: uppercase; color: #f6eed9;
  padding: 7px 18px; border: 2.5px solid #f6eed9;
  transform: rotate(-2deg);
  align-self: flex-start;
}
.ms-gh-notice h3 {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 80px; line-height: .9;
  color: #f6eed9; margin: 14px 0 8px;
  letter-spacing: -.015em; position: relative; z-index: 2;
}
.ms-gh-msg {
  font-family: 'Cormorant Garamond', serif; font-weight: 500;
  font-size: 30px; line-height: 1.28; color: rgba(240,231,210,.92);
  position: relative; z-index: 2;
}
.ms-gh-msg b { color: #f6eed9; font-weight: 700; }

/* ─── BOTTOM ROW — countdown meter + lunch signpost ─── */
.ms-gh-bottom {
  position: absolute; top: 1760px; left: 64px; right: 64px; height: 240px;
  display: grid; grid-template-columns: 1.2fr 1.8fr; gap: 24px;
  z-index: 2;
}

/* Countdown — almanac page with big numeral */
.ms-gh-almanac {
  background: #f6eed9;
  border: 4px solid #1f2a1c;
  box-shadow: 10px 10px 0 #345e3a;
  padding: 22px 32px;
  display: grid; grid-template-columns: auto 1fr; gap: 28px; align-items: center;
  position: relative; overflow: hidden;
}
.ms-gh-almanac::before {
  content: ''; position: absolute; left: 14px; top: 14px; right: 14px; bottom: 14px;
  border: 1.5px solid #345e3a; pointer-events: none;
}
.ms-gh-day {
  text-align: center;
  background: radial-gradient(circle at 40% 30%, #f6eed9, #e7dcc1);
  border: 4px solid #345e3a;
  border-radius: 50%;
  width: 196px; height: 196px;
  display: grid; place-items: center;
  box-shadow:
    inset 0 0 0 4px #f6eed9,
    inset 0 0 0 6px #d6a93f;
  position: relative;
}
.ms-gh-day::before {
  content: ''; position: absolute; inset: 14px; border-radius: 50%;
  border: 1px dashed rgba(31,42,28,.35);
}
.ms-gh-day .ms-gh-n {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 132px; line-height: .85;
  color: #b85a3a; letter-spacing: -.04em;
}
.ms-gh-day .ms-gh-u {
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 14px;
  letter-spacing: .3em; text-transform: uppercase; color: #3a4a36;
  margin-top: 2px;
}
.ms-gh-info .ms-gh-eye2 {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 22px;
  letter-spacing: .28em; text-transform: uppercase; color: #345e3a;
}
.ms-gh-info .ms-gh-tt {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 70px; line-height: .92;
  color: #1f2a1c; margin-top: 4px; letter-spacing: -.018em;
}
.ms-gh-info .ms-gh-tt em { color: #b85a3a; font-style: italic; }
.ms-gh-info .ms-gh-ss {
  font-family: 'Cormorant Garamond', serif; font-weight: 500;
  font-size: 28px; color: #3a4a36; margin-top: 8px; line-height: 1.25;
}

/* Cafeteria signpost — plant ID stake */
.ms-gh-signpost {
  background: #f6eed9;
  border: 4px solid #1f2a1c;
  box-shadow: 10px 10px 0 #1f2a1c;
  padding: 22px 28px;
  display: grid; grid-template-columns: 144px 1fr auto; gap: 24px; align-items: center;
  position: relative; overflow: hidden;
}
.ms-gh-stake {
  height: 196px; position: relative;
  display: flex; flex-direction: column; align-items: center;
}
.ms-gh-stake .ms-gh-label {
  background: #f6eed9;
  border: 3px solid #345e3a;
  border-radius: 14px 14px 4px 4px;
  padding: 10px 14px;
  text-align: center;
  box-shadow: 4px 4px 0 #345e3a;
}
.ms-gh-stake .ms-gh-st-lbl {
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 14px;
  letter-spacing: .28em; text-transform: uppercase; color: #345e3a;
}
.ms-gh-stake .ms-gh-ico {
  font-family: 'Cormorant Garamond', serif; font-style: italic;
  font-weight: 700; font-size: 60px; line-height: .9; color: #b85a3a; margin-top: 2px;
}
.ms-gh-stake .ms-gh-pole {
  width: 14px; flex: 1; background: linear-gradient(180deg, #b8893c 0%, #8a6122 100%);
  margin-top: -2px;
  box-shadow: inset -3px 0 0 rgba(0,0,0,.2);
}
.ms-gh-signpost .ms-gh-info .ms-gh-eye3 {
  font-family: 'Work Sans', sans-serif; font-weight: 700; font-size: 22px;
  letter-spacing: .26em; text-transform: uppercase; color: #b85a3a;
}
.ms-gh-signpost .ms-gh-info .ms-gh-tt2 {
  font-family: 'Cormorant Garamond', serif; font-weight: 700;
  font-style: italic; font-size: 70px; line-height: .92; color: #1f2a1c;
  margin-top: 4px; letter-spacing: -.018em;
}
.ms-gh-signpost .ms-gh-info .ms-gh-ss2 {
  font-family: 'Cormorant Garamond', serif; font-weight: 500;
  font-size: 28px; color: #3a4a36; margin-top: 8px; line-height: 1.25;
}
.ms-gh-signpost .ms-gh-info .ms-gh-ss2 b { color: #345e3a; font-weight: 700; }
.ms-gh-badges {
  display: flex; flex-direction: column; gap: 8px;
}
.ms-gh-badges span {
  font-family: 'Work Sans', sans-serif; font-weight: 800; font-size: 18px;
  letter-spacing: .22em; text-transform: uppercase;
  padding: 8px 14px; border: 2.5px solid #1f2a1c;
  background: #93b07c; color: #1f2a1c;
  text-align: center;
}
.ms-gh-badges span.ms-gh-gf { background: #d6a93f; }
.ms-gh-badges span.ms-gh-veg { background: #4f8b48; color: #f6eed9; }

/* ─── TICKER ─── engraved brass plate ─── */
.ms-gh-ticker {
  position: absolute; top: 2020px; left: 64px; right: 64px; height: 120px;
  background: linear-gradient(180deg, #b8893c 0%, #8a6122 100%);
  border: 4px solid #1f2a1c;
  box-shadow: 10px 10px 0 #345e3a;
  display: flex; align-items: stretch;
  overflow: hidden; z-index: 2;
}
.ms-gh-ticker::before {
  content: ''; position: absolute; top: 8px; bottom: 8px; left: 8px; right: 8px;
  border: 1.5px solid rgba(31,42,28,.55); pointer-events: none;
}
.ms-gh-tag2 {
  background: #345e3a; color: #f6eed9;
  padding: 0 44px;
  display: flex; align-items: center; gap: 18px;
  font-family: 'Cormorant Garamond', serif; font-weight: 700; font-style: italic;
  font-size: 56px; letter-spacing: -.005em;
  border-right: 4px solid #1f2a1c;
  flex-shrink: 0;
  z-index: 1; position: relative;
}
.ms-gh-tag2::before {
  content: '❦'; color: #d6a93f; font-size: 48px;
}
.ms-gh-feed {
  flex: 1; overflow: hidden; display: flex; align-items: center;
  padding-left: 36px; position: relative; z-index: 1;
}
.ms-gh-feed-inner {
  display: flex; gap: 64px;
  font-family: 'Cormorant Garamond', serif; font-weight: 600;
  font-size: 50px; color: #1f2a1c;
  white-space: nowrap; letter-spacing: .005em;
  animation: msGhScroll 60s linear infinite;
}
.ms-gh-feed-inner span { display: inline-flex; align-items: center; gap: 28px; }
.ms-gh-feed-inner span::after {
  content: '❧'; color: #8c3f29; font-size: 38px;
  margin-left: 18px;
}
@keyframes msGhScroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
`;
