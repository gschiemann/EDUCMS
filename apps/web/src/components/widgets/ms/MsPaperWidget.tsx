"use client";

/**
 * MsPaperWidget — Middle-school lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-25 — matches scratch/design/paper-ms-v2.html.
 * Reviewed by user, ported via HsStage scale pattern. DO NOT
 * regress to vw/% units. Every pixel size must match the mockup.
 *
 * Vintage broadsheet newspaper metaphor. Three inks only — ink
 * black on cream newsprint with a single editorial red. Layout:
 *   MASTHEAD            y  56–360    weather + nameplate + edition
 *   INDICIA STRIP       y 380–420    vol/no · date · index
 *   LEAD STORY +        y 440–1400   above-the-fold + sidebar TOC
 *     INDEX SIDEBAR
 *   DEPARTMENTS         y 1420–1980  dining · after 3 · seen today
 *   BULLETIN TICKER     y 2000–2140  "stop press" scrolling
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsPaperConfig {
  // Weather cluster (top-left masthead)
  'weather.label'?: string;
  'weather.high'?: string;
  'weather.low_label'?: string;
  'weather.low'?: string;
  'weather.sky_label'?: string;
  'weather.sky'?: string;
  // Masthead nameplate
  'masthead.kicker'?: string;
  'masthead.the'?: string;
  'masthead.mascot'?: string;
  'masthead.suffix'?: string;
  'masthead.tagline'?: string;
  // Edition rail (top-right)
  'edition.flag'?: string;
  'price.value'?: string;
  'price.note'?: string;
  'clock.day'?: string;
  'clock.date'?: string;
  // Indicia strip
  'indicia.vol'?: string;
  'indicia.date'?: string;
  'indicia.flag'?: string;
  'indicia.run'?: string;
  // Lead story
  'greeting.dept'?: string;
  'greeting.edition'?: string;
  'greeting.kicker'?: string;
  'greeting.headline1'?: string;
  'greeting.headline2'?: string;
  'greeting.deck'?: string;
  'greeting.byline'?: string;
  'greeting.dateline'?: string;
  'greeting.tag'?: string;
  'greeting.lede'?: string;
  'greeting.col1b'?: string;
  'greeting.col2a'?: string;
  'greeting.pq'?: string;
  'greeting.pq_who'?: string;
  'greeting.col3a'?: string;
  // Photo
  'photo.caption'?: string;
  // Sidebar agenda head
  'agenda.title'?: string;
  'agenda.title_em'?: string;
  'agenda.day'?: string;
  'agenda.run'?: string;
  // Agenda rows (7)
  'agenda.0.p'?: string;
  'agenda.0.t'?: string;
  'agenda.0.r'?: string;
  'agenda.0.time'?: string;
  'agenda.1.p'?: string;
  'agenda.1.t'?: string;
  'agenda.1.r'?: string;
  'agenda.1.time'?: string;
  'agenda.2.p'?: string;
  'agenda.2.t'?: string;
  'agenda.2.r'?: string;
  'agenda.2.time'?: string;
  'agenda.3.p'?: string;
  'agenda.3.t'?: string;
  'agenda.3.r'?: string;
  'agenda.3.time'?: string;
  'agenda.4.p'?: string;
  'agenda.4.t'?: string;
  'agenda.4.r'?: string;
  'agenda.4.time'?: string;
  'agenda.5.p'?: string;
  'agenda.5.t'?: string;
  'agenda.5.r'?: string;
  'agenda.5.time'?: string;
  'agenda.6.p'?: string;
  'agenda.6.t'?: string;
  'agenda.6.r'?: string;
  'agenda.6.time'?: string;
  // Sidebar stats (countdown + attendance)
  'countdown.label'?: string;
  'countdown.value'?: string;
  'countdown.sub'?: string;
  'attendance.label'?: string;
  'attendance.value'?: string;
  'attendance.unit'?: string;
  'attendance.sub'?: string;
  // Departments — Dining
  'lunch.num'?: string;
  'lunch.dept_em'?: string;
  'lunch.dept'?: string;
  'lunch.meta'?: string;
  'lunch.entree'?: string;
  'lunch.sides'?: string;
  'lunch.tag1'?: string;
  'lunch.tag2'?: string;
  'lunch.tag3'?: string;
  // Departments — Clubs (After 3)
  'clubs.num'?: string;
  'clubs.dept_em'?: string;
  'clubs.dept'?: string;
  'clubs.meta'?: string;
  'clubs.0.ic'?: string;
  'clubs.0.t'?: string;
  'clubs.0.r'?: string;
  'clubs.0.w'?: string;
  'clubs.0.note'?: string;
  'clubs.1.ic'?: string;
  'clubs.1.t'?: string;
  'clubs.1.r'?: string;
  'clubs.1.w'?: string;
  'clubs.1.note'?: string;
  'clubs.2.ic'?: string;
  'clubs.2.t'?: string;
  'clubs.2.r'?: string;
  'clubs.2.w'?: string;
  'clubs.2.note'?: string;
  // Departments — Shoutouts (Seen Today)
  'shoutouts.num'?: string;
  'shoutouts.dept_em'?: string;
  'shoutouts.dept'?: string;
  'shoutouts.meta'?: string;
  'shoutouts.0.ic'?: string;
  'shoutouts.0.t'?: string;
  'shoutouts.0.r'?: string;
  'shoutouts.0.w'?: string;
  'shoutouts.0.note'?: string;
  'shoutouts.1.ic'?: string;
  'shoutouts.1.t'?: string;
  'shoutouts.1.r'?: string;
  'shoutouts.1.w'?: string;
  'shoutouts.1.note'?: string;
  'shoutouts.2.ic'?: string;
  'shoutouts.2.t'?: string;
  'shoutouts.2.r'?: string;
  'shoutouts.2.w'?: string;
  'shoutouts.2.note'?: string;
  // Bulletin ticker
  'ticker.tag'?: string;
  'ticker.0'?: string;
  'ticker.1'?: string;
  'ticker.2'?: string;
  'ticker.3'?: string;
  'ticker.4'?: string;
  'ticker.5'?: string;
  'ticker.6'?: string;
  'ticker.endmark'?: string;
}

export const DEFAULTS: Required<MsPaperConfig> = {
  'weather.label': 'High',
  'weather.high': '62',
  'weather.low_label': 'Low',
  'weather.low': '46',
  'weather.sky_label': "Today's Sky",
  'weather.sky': 'Clear & bright',
  'masthead.kicker': 'Westridge Middle · Morning Edition',
  'masthead.the': 'The',
  'masthead.mascot': 'Otter',
  'masthead.suffix': 'Daily',
  'masthead.tagline': 'All the news that fits the hallway · Est. 1962',
  'edition.flag': 'LIVE · 7:53 A.M.',
  'price.value': '5¢',
  'price.note': 'Free for the otters',
  'clock.day': 'Tuesday',
  'clock.date': 'April 21',
  'indicia.vol': 'Vol. CXLII · No. 138',
  'indicia.date': 'Tuesday, April 21, 2026 · Day B · Three sections, 22 pages',
  'indicia.flag': 'FIELD DAY in 12 days',
  'indicia.run': 'Print run: 1,217 otters',
  'greeting.dept': 'From the Office · Period 2 Edition',
  'greeting.edition': "Today's lead story",
  'greeting.kicker': 'Big day,',
  'greeting.headline1': 'Otters',
  'greeting.headline2': 'go forth.',
  'greeting.deck':
    'First bell rings 8:05 sharp. Mr. Nguyen has the journals stacked and the poetry workshop on the chalkboard — courage encouraged, pencils required.',
  'greeting.byline': 'The Front Office',
  'greeting.dateline': 'WESTRIDGE, MASS.',
  'greeting.tag': 'Filed 7:48 A.M.',
  'greeting.lede':
    "Today's lead is poetry. Period 2, room 108, journals out. Mr. Nguyen has been talking about this workshop since the first thaw, and he says he's bringing the good chalk — the kind that doesn't squeak. Morning attendance is already running ninety-eight percent before the bell, a quiet little record on the second-to-last Tuesday in April.",
  'greeting.col1b':
    'Down the hall, the cafeteria smells like garlic bread and possibility.',
  'greeting.col2a':
    'Period 3 lab rules apply — closed-toe shoes, hair tied back, goggles on the cart. Coach Reyes is calling the mile run for fourth period sharp at 10:50, weather says fifty-eight and climbing, and the field is dry for the first time this week.',
  'greeting.pq': 'Bring a pencil, a journal, and a quiet bit of courage.',
  'greeting.pq_who': '— Mr. Nguyen, Eng. 7',
  'greeting.col3a':
    'Sign-ups for Field Day close this Friday at last bell. Two hundred and eighty-four otters are in. The remaining slots, the front office reports, will not last the week.',
  'photo.caption': 'OTIS THE OTTER',
  'agenda.title': "Today's ",
  'agenda.title_em': 'Index.',
  'agenda.day': 'Day B',
  'agenda.run': '7 sections',
  'agenda.0.p': 'P1',
  'agenda.0.t': 'Mathematics',
  'agenda.0.r': 'Rm 214 · Ms. Patel',
  'agenda.0.time': '8:05',
  'agenda.1.p': 'P2',
  'agenda.1.t': 'English — Poetry',
  'agenda.1.r': 'Rm 108 · Mr. Nguyen',
  'agenda.1.time': '9:00',
  'agenda.2.p': 'P3',
  'agenda.2.t': 'Science — Lab',
  'agenda.2.r': 'Rm 207 · closed-toe shoes',
  'agenda.2.time': '9:55',
  'agenda.3.p': 'P4',
  'agenda.3.t': 'PE — Mile Run',
  'agenda.3.r': 'Gym A · Coach Reyes',
  'agenda.3.time': '10:50',
  'agenda.4.p': 'A',
  'agenda.4.t': 'Lunch',
  'agenda.4.r': 'Cafeteria · 7th grade',
  'agenda.4.time': '11:45',
  'agenda.5.p': 'P5',
  'agenda.5.t': 'Social Studies',
  'agenda.5.r': 'Rm 115 · map quiz',
  'agenda.5.time': '12:35',
  'agenda.6.p': 'P6',
  'agenda.6.t': 'Art — Prints',
  'agenda.6.r': 'Rm B-12 · sub today',
  'agenda.6.time': '1:30',
  'countdown.label': 'Days to Field Day',
  'countdown.value': '12',
  'countdown.sub': 'Sign-ups close Friday',
  'attendance.label': 'Otters Today',
  'attendance.value': '1,217',
  'attendance.unit': '/1,240',
  'attendance.sub': '98.2% · weekly high',
  'lunch.num': '§ 01',
  'lunch.dept_em': 'Dining',
  'lunch.dept': "/ Today's menu",
  'lunch.meta': 'Cafeteria · 11:45 A.M.',
  'lunch.entree': 'Chicken & rice bowl.',
  'lunch.sides':
    'Roasted broccoli, garlic bread, fresh fruit, and the salad bar open all period long.',
  'lunch.tag1': 'VEG OPT',
  'lunch.tag2': 'GLUTEN-FREE',
  'lunch.tag3': 'DAIRY-FREE',
  'clubs.num': '§ 02',
  'clubs.dept_em': 'After',
  'clubs.dept': "/ Three o'clock.",
  'clubs.meta': '3:00 P.M. start',
  'clubs.0.ic': 'R',
  'clubs.0.t': 'Robotics Club',
  'clubs.0.r': 'Rm 207 · Build week',
  'clubs.0.w': '3:00',
  'clubs.0.note': 'starts',
  'clubs.1.ic': 'D',
  'clubs.1.t': 'Drama Auditions',
  'clubs.1.r': 'Auditorium · spring play',
  'clubs.1.w': '3:15',
  'clubs.1.note': 'arrive 5 early',
  'clubs.2.ic': 'G',
  'clubs.2.t': 'Garden Club',
  'clubs.2.r': 'Greenhouse · plant the rows',
  'clubs.2.w': '3:00',
  'clubs.2.note': 'wear boots',
  'shoutouts.num': '§ 03',
  'shoutouts.dept_em': 'Seen',
  'shoutouts.dept': '/ Around campus.',
  'shoutouts.meta': 'Filed by hall monitors',
  'shoutouts.0.ic': '★',
  'shoutouts.0.t': 'Maya Rodriguez',
  'shoutouts.0.r': 'Turns 13 today — H.B.D.',
  'shoutouts.0.w': '7B',
  'shoutouts.0.note': 'homeroom',
  'shoutouts.1.ic': '+1',
  'shoutouts.1.t': 'Daniel K.',
  'shoutouts.1.r': 'Math olympiad — 3rd place',
  'shoutouts.1.w': '7th',
  'shoutouts.1.note': 'bronze',
  'shoutouts.2.ic': 'W',
  'shoutouts.2.t': "Ms. Chen's 7B",
  'shoutouts.2.r': 'Top homework streak this month',
  'shoutouts.2.w': '31',
  'shoutouts.2.note': 'days',
  'ticker.tag': 'Stop the presses',
  'ticker.0': 'Picture day Thursday — full uniform',
  'ticker.1': 'Bus 14 running ten minutes late',
  'ticker.2': 'Substitute covering Rm B-12',
  'ticker.3': 'Spelling bee sign-ups end Friday',
  'ticker.4': '8th grade field-trip forms due tomorrow',
  'ticker.5': 'Lost: blue water bottle with otter sticker — front office',
  'ticker.6': 'Library returns due this week',
  'ticker.endmark': '— 30 —',
};

const pick = <K extends keyof Required<MsPaperConfig>>(
  cfg: MsPaperConfig,
  key: K,
): string => (cfg[key] ?? DEFAULTS[key]) as string;

export function MsPaperWidget({ config }: { config: MsPaperConfig }) {
  const cfg = config || {};

  return (
    <HsStage
      stageStyle={{
        background: '#f3ebd6',
        backgroundImage: [
          'radial-gradient(rgba(120, 90, 50, .07) 1px, transparent 1.5px)',
          'radial-gradient(rgba(120, 90, 50, .04) 1px, transparent 1.5px)',
          'radial-gradient(ellipse 1800px 1100px at 0% 0%, rgba(232, 196, 120, .18), transparent 70%)',
          'radial-gradient(ellipse 1700px 1000px at 100% 100%, rgba(120, 90, 50, .12), transparent 70%)',
        ].join(', '),
        backgroundSize: '8px 8px, 17px 17px, auto, auto',
        backgroundPosition: '0 0, 6px 4px, 0 0, 0 0',
        color: '#0e0e10',
        fontFamily: "'Source Serif 4', Georgia, serif",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Faint horizontal fold line + edge vignette */}
      <div className="ms-pp-paperfx" aria-hidden="true" />

      {/* ─── MASTHEAD ──────────────────────────────────────── */}
      <header className="ms-pp-mast">
        {/* LEFT: weather + clock indicia */}
        <div className="ms-pp-lefttiles" data-widget="weather-cluster">
          <div className="ms-pp-tile ms-pp-warm" data-widget="weather">
            <span className="ms-pp-k" data-field="weather.label" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'weather.label')}</span>
            <span className="ms-pp-v">
              <span data-field="weather.high" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'weather.high')}</span>
              <small>&deg;F</small>
            </span>
          </div>
          <div className="ms-pp-tile" data-widget="weather-low">
            <span className="ms-pp-k" data-field="weather.low_label" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'weather.low_label')}</span>
            <span className="ms-pp-v">
              <span data-field="weather.low" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'weather.low')}</span>
              <small>&deg;F</small>
            </span>
          </div>
          <div className="ms-pp-tile ms-pp-full" data-widget="weather-summary">
            <span className="ms-pp-k" data-field="weather.sky_label" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'weather.sky_label')}</span>
            <span className="ms-pp-v">
              <span data-field="weather.sky" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'weather.sky')}</span>
              <span className="ms-pp-arrow">&mdash; light SW wind</span>
            </span>
          </div>
        </div>

        {/* CENTER: nameplate */}
        <div className="ms-pp-nameplate" data-widget="masthead">
          <div className="ms-pp-ribbon" data-field="masthead.kicker" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'masthead.kicker')}</div>
          <div className="ms-pp-title">
            <span className="ms-pp-the" data-field="masthead.the" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'masthead.the')}</span>
            <span data-field="masthead.mascot" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'masthead.mascot')}</span>
            &nbsp;
            <span className="ms-pp-accent" data-field="masthead.suffix" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'masthead.suffix')}</span>
          </div>
          <div className="ms-pp-tagline" data-field="masthead.tagline" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'masthead.tagline')}</div>
        </div>

        {/* RIGHT: edition stamp + time */}
        <div className="ms-pp-editrail">
          <div className="ms-pp-stamp" data-widget="edition">
            <span className="ms-pp-dot" aria-hidden="true" />
            <span data-field="edition.flag" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'edition.flag')}</span>
          </div>
          <div className="ms-pp-price" data-widget="price">
            <span data-field="price.value" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'price.value')}</span>
            <small data-field="price.note" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'price.note')}</small>
          </div>
          <div className="ms-pp-clock" data-widget="clock">
            <b data-field="clock.day" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'clock.day')}</b>
            {', '}
            <span data-field="clock.date" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'clock.date')}</span>
          </div>
        </div>
      </header>

      {/* ─── DATELINE RULE ─────────────────────────────────── */}
      <div className="ms-pp-rule" aria-hidden="true" />

      {/* ─── INDICIA STRIP ─────────────────────────────────── */}
      <div className="ms-pp-indicia" data-widget="indicia">
        <span className="ms-pp-vol" data-field="indicia.vol" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'indicia.vol')}</span>
        <span className="ms-pp-date" data-field="indicia.date" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'indicia.date')}</span>
        <span className="ms-pp-pipe">|</span>
        <span className="ms-pp-red" data-field="indicia.flag" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'indicia.flag')}</span>
        <span className="ms-pp-pipe">|</span>
        <span data-field="indicia.run" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'indicia.run')}</span>
      </div>

      {/* ─── UPPER CONTENT BAND ─────────────────────────────── */}
      <section className="ms-pp-upper">
        {/* ABOVE-THE-FOLD LEAD STORY */}
        <article className="ms-pp-lead" data-widget="greeting">
          <div className="ms-pp-deptline">
            <span className="ms-pp-swatch" aria-hidden="true" />
            <span className="ms-pp-label" data-field="greeting.dept" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.dept')}</span>
            <span className="ms-pp-pipe-line" aria-hidden="true" />
            <span className="ms-pp-edition" data-field="greeting.edition" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.edition')}</span>
          </div>

          <h1 className="ms-pp-h1">
            <span className="ms-pp-small" data-field="greeting.kicker" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.kicker')}</span>
            <span data-field="greeting.headline1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.headline1')}</span>
            {' '}
            <em data-field="greeting.headline2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.headline2')}</em>
          </h1>

          <p className="ms-pp-deck" data-field="greeting.deck" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.deck')}</p>

          <div className="ms-pp-byline">
            <span>By <b data-field="greeting.byline" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.byline')}</b></span>
            <span className="ms-pp-pipe">|</span>
            <span data-field="greeting.dateline" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.dateline')}</span>
            <span className="ms-pp-pipe">|</span>
            <em data-field="greeting.tag" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.tag')}</em>
          </div>

          <div className="ms-pp-body">
            <div className="ms-pp-col ms-pp-first">
              <p data-field="greeting.lede" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.lede')}</p>
              <p data-field="greeting.col1b" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.col1b')}</p>
            </div>
            <div className="ms-pp-col">
              <p data-field="greeting.col2a" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.col2a')}</p>

              <div className="ms-pp-pullquote">
                &ldquo;<span data-field="greeting.pq" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.pq')}</span>&rdquo;
                <span className="ms-pp-who" data-field="greeting.pq_who" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.pq_who')}</span>
              </div>
            </div>
            <div className="ms-pp-col">
              <p data-field="greeting.col3a" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.col3a')}</p>

              <div className="ms-pp-photo" data-widget="photo">
                <div className="ms-pp-frame" aria-hidden="true" />
                <div className="ms-pp-caption" data-field="photo.caption" style={{ whiteSpace: 'pre-wrap' }}>
                  <b>{pick(cfg, 'photo.caption')}</b>
                  {', mascot, surveys the courtyard before first bell. '}
                  <em>&mdash; Photograph by Yearbook Club</em>
                </div>
              </div>
            </div>
          </div>
        </article>

        {/* INDEX SIDEBAR */}
        <aside className="ms-pp-sidebar" data-widget="agenda">
          <div className="ms-pp-tochead">
            <div className="ms-pp-h">
              <span data-field="agenda.title" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.title')}</span>
              <em data-field="agenda.title_em" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.title_em')}</em>
            </div>
            <div className="ms-pp-day">
              <span data-field="agenda.day" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.day')}</span>
              <br />
              <span data-field="agenda.run" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'agenda.run')}</span>
            </div>
          </div>

          <div className="ms-pp-toc">
            {([0, 1, 2, 3, 4, 5, 6] as const).map((i) => {
              const rowClass = i === 1 ? 'ms-pp-now' : i === 0 ? 'ms-pp-done' : '';
              return (
                <div key={i} className={`ms-pp-row ${rowClass}`.trim()} data-widget={`agenda.${i}`}>
                  <span className="ms-pp-p" data-field={`agenda.${i}.p`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `agenda.${i}.p` as keyof Required<MsPaperConfig>)}
                  </span>
                  <span className="ms-pp-what">
                    <span data-field={`agenda.${i}.t`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `agenda.${i}.t` as keyof Required<MsPaperConfig>)}
                    </span>
                    <span data-field={`agenda.${i}.r`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `agenda.${i}.r` as keyof Required<MsPaperConfig>)}
                    </span>
                  </span>
                  <span className="ms-pp-pg" data-field={`agenda.${i}.time`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `agenda.${i}.time` as keyof Required<MsPaperConfig>)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="ms-pp-stats">
            <div className="ms-pp-s ms-pp-featured" data-widget="countdown">
              <span className="ms-pp-k" data-field="countdown.label" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'countdown.label')}</span>
              <span className="ms-pp-v">
                <span data-field="countdown.value" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'countdown.value')}</span>
              </span>
              <span className="ms-pp-sub" data-field="countdown.sub" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'countdown.sub')}</span>
            </div>
            <div className="ms-pp-s" data-widget="attendance">
              <span className="ms-pp-k" data-field="attendance.label" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'attendance.label')}</span>
              <span className="ms-pp-v">
                <span data-field="attendance.value" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'attendance.value')}</span>
                <em data-field="attendance.unit" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'attendance.unit')}</em>
              </span>
              <span className="ms-pp-sub" data-field="attendance.sub" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'attendance.sub')}</span>
            </div>
          </div>
        </aside>
      </section>

      {/* ─── DEPARTMENTS BAND ──────────────────────────────── */}
      <section className="ms-pp-depts">
        {/* DINING */}
        <div className="ms-pp-dept ms-pp-dining" data-widget="lunch">
          <div className="ms-pp-slug">
            <span className="ms-pp-num" data-field="lunch.num" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.num')}</span>
            <span className="ms-pp-name">
              <em data-field="lunch.dept_em" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.dept_em')}</em>
              <span data-field="lunch.dept" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.dept')}</span>
            </span>
            <span className="ms-pp-meta" data-field="lunch.meta" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.meta')}</span>
          </div>
          <div className="ms-pp-entree" data-field="lunch.entree" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.entree')}</div>
          <div className="ms-pp-sides" data-field="lunch.sides" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.sides')}</div>
          <div className="ms-pp-tags">
            <b data-field="lunch.tag1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.tag1')}</b>
            <b data-field="lunch.tag2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.tag2')}</b>
            <b className="ms-pp-red-tag" data-field="lunch.tag3" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lunch.tag3')}</b>
          </div>
        </div>

        {/* AFTER 3 / CLUBS */}
        <div className="ms-pp-dept ms-pp-clubs" data-widget="clubs">
          <div className="ms-pp-slug">
            <span className="ms-pp-num" data-field="clubs.num" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'clubs.num')}</span>
            <span className="ms-pp-name">
              <em data-field="clubs.dept_em" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'clubs.dept_em')}</em>
              <span data-field="clubs.dept" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'clubs.dept')}</span>
            </span>
            <span className="ms-pp-meta" data-field="clubs.meta" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'clubs.meta')}</span>
          </div>
          <div className="ms-pp-list">
            {([0, 1, 2] as const).map((i) => {
              const icoClass = i === 0 ? 'ms-pp-ico-red' : i === 2 ? 'ms-pp-ico-cream' : '';
              return (
                <div key={i} className="ms-pp-it" data-widget={`clubs.${i}`}>
                  <div className={`ms-pp-ico ${icoClass}`.trim()} data-field={`clubs.${i}.ic`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `clubs.${i}.ic` as keyof Required<MsPaperConfig>)}
                  </div>
                  <div className="ms-pp-info">
                    <div className="ms-pp-t" data-field={`clubs.${i}.t`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `clubs.${i}.t` as keyof Required<MsPaperConfig>)}
                    </div>
                    <div className="ms-pp-s-it" data-field={`clubs.${i}.r`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `clubs.${i}.r` as keyof Required<MsPaperConfig>)}
                    </div>
                  </div>
                  <div className="ms-pp-when">
                    <span data-field={`clubs.${i}.w`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `clubs.${i}.w` as keyof Required<MsPaperConfig>)}
                    </span>
                    <small data-field={`clubs.${i}.note`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `clubs.${i}.note` as keyof Required<MsPaperConfig>)}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* SEEN TODAY / SHOUTOUTS */}
        <div className="ms-pp-dept ms-pp-shoutouts" data-widget="shoutouts">
          <div className="ms-pp-slug">
            <span className="ms-pp-num" data-field="shoutouts.num" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'shoutouts.num')}</span>
            <span className="ms-pp-name">
              <em data-field="shoutouts.dept_em" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'shoutouts.dept_em')}</em>
              <span data-field="shoutouts.dept" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'shoutouts.dept')}</span>
            </span>
            <span className="ms-pp-meta" data-field="shoutouts.meta" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'shoutouts.meta')}</span>
          </div>
          <div className="ms-pp-list">
            {([0, 1, 2] as const).map((i) => {
              const icoClass = i === 0 ? 'ms-pp-ico-red' : i === 2 ? 'ms-pp-ico-cream' : '';
              return (
                <div key={i} className="ms-pp-it" data-widget={`shoutouts.${i}`}>
                  <div className={`ms-pp-ico ${icoClass}`.trim()} data-field={`shoutouts.${i}.ic`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `shoutouts.${i}.ic` as keyof Required<MsPaperConfig>)}
                  </div>
                  <div className="ms-pp-info">
                    <div className="ms-pp-t" data-field={`shoutouts.${i}.t`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `shoutouts.${i}.t` as keyof Required<MsPaperConfig>)}
                    </div>
                    <div className="ms-pp-s-it" data-field={`shoutouts.${i}.r`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `shoutouts.${i}.r` as keyof Required<MsPaperConfig>)}
                    </div>
                  </div>
                  <div className="ms-pp-when">
                    <span data-field={`shoutouts.${i}.w`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `shoutouts.${i}.w` as keyof Required<MsPaperConfig>)}
                    </span>
                    <small data-field={`shoutouts.${i}.note`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `shoutouts.${i}.note` as keyof Required<MsPaperConfig>)}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── BULLETIN TICKER ─────────────────────────────── */}
      <div className="ms-pp-ticker" data-widget="ticker">
        <div className="ms-pp-tag" data-field="ticker.tag" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.tag')}</div>
        <div className="ms-pp-feed">
          <div className="ms-pp-feed-inner">
            {([0, 1, 2, 3, 4, 5, 6] as const).map((i) => (
              <span key={`a${i}`} data-field={`ticker.${i}`} style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, `ticker.${i}` as keyof Required<MsPaperConfig>)}
              </span>
            ))}
            {/* Duplicate for seamless scroll */}
            {([0, 1, 2, 3, 4, 5, 6] as const).map((i) => (
              <span key={`b${i}`} aria-hidden="true">
                {pick(cfg, `ticker.${i}` as keyof Required<MsPaperConfig>)}
              </span>
            ))}
          </div>
        </div>
        <div className="ms-pp-vol-end" data-field="ticker.endmark" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.endmark')}</div>
      </div>
    </HsStage>
  );
}

const CSS = `
.ms-pp-mast, .ms-pp-mast *, .ms-pp-rule, .ms-pp-indicia, .ms-pp-indicia *,
.ms-pp-upper, .ms-pp-upper *, .ms-pp-depts, .ms-pp-depts *,
.ms-pp-ticker, .ms-pp-ticker *, .ms-pp-paperfx {
  box-sizing: border-box;
}

/* Faint horizontal fold line + edge vignette for "real paper" */
.ms-pp-paperfx {
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background:
    linear-gradient(to bottom, transparent 50%, rgba(0,0,0,.05) 50%, rgba(0,0,0,.05) 50.1%, transparent 50.2%),
    radial-gradient(ellipse at center, transparent 60%, rgba(60, 40, 20, .12) 100%);
}

/* ────────────────────────────────────────────────────────
   MASTHEAD                          y 56–360, inset 64
   ──────────────────────────────────────────────────────── */
.ms-pp-mast {
  position: absolute; top: 56px; left: 64px; right: 64px; height: 304px;
  display: grid; grid-template-columns: 660px 1fr 660px; column-gap: 40px;
  align-items: center; z-index: 2;
}

/* LEFT — weather index column */
.ms-pp-lefttiles {
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
  align-self: stretch; padding: 18px 0;
}
.ms-pp-tile {
  background: #ebe1c4;
  border: 4px solid #0e0e10;
  padding: 18px 22px;
  display: flex; flex-direction: column; gap: 8px;
  box-shadow: 5px 5px 0 #0e0e10;
  position: relative;
}
.ms-pp-tile.ms-pp-full { grid-column: 1 / -1; }
.ms-pp-tile .ms-pp-k {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 22px;
  letter-spacing: .26em; text-transform: uppercase; color: #5a5a62;
}
.ms-pp-tile .ms-pp-v {
  font-family: 'Playfair Display', serif; font-weight: 900;
  font-size: 76px; line-height: .9; color: #0e0e10;
  letter-spacing: -.02em;
  display: flex; align-items: baseline; gap: 10px;
}
.ms-pp-tile.ms-pp-warm .ms-pp-v { color: #c8201e; }
.ms-pp-tile .ms-pp-v small {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 22px;
  color: #2a2a30; letter-spacing: .04em;
}
.ms-pp-tile.ms-pp-full .ms-pp-v { font-size: 60px; }
.ms-pp-tile.ms-pp-full .ms-pp-v .ms-pp-arrow {
  color: #c8201e; font-family: 'Playfair Display', serif;
  font-style: italic; font-weight: 900;
}

/* CENTER — masthead title */
.ms-pp-nameplate {
  text-align: center;
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; height: 100%;
  position: relative;
}
.ms-pp-ribbon {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 26px;
  letter-spacing: .42em; text-transform: uppercase; color: #2a2a30;
  padding: 10px 22px;
  border-top: 3px double #0e0e10;
  border-bottom: 3px double #0e0e10;
  margin-bottom: 16px;
}
.ms-pp-title {
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 200px; line-height: .85;
  color: #0e0e10; letter-spacing: -.035em;
  text-shadow: 2px 2px 0 rgba(0,0,0,.06);
  white-space: nowrap;
}
.ms-pp-title .ms-pp-the {
  font-style: italic; font-weight: 400;
  font-size: 76px; vertical-align: 30px; margin-right: 12px;
  letter-spacing: 0;
}
.ms-pp-title .ms-pp-accent {
  color: #c8201e;
  text-decoration: underline;
  text-decoration-thickness: 6px;
  text-underline-offset: 12px;
  text-decoration-color: #c8201e;
}
.ms-pp-tagline {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 24px;
  letter-spacing: .34em; text-transform: uppercase; color: #5a5a62;
  margin-top: 18px;
}

/* RIGHT — edition / live pulse stack */
.ms-pp-editrail {
  display: flex; flex-direction: column; align-items: flex-end;
  justify-content: center; gap: 14px; align-self: stretch; padding: 18px 0;
}
.ms-pp-stamp {
  display: inline-flex; align-items: center; gap: 16px;
  padding: 16px 28px;
  background: #0e0e10; color: #f3ebd6;
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 28px;
  letter-spacing: .26em; text-transform: uppercase;
  transform: rotate(-2deg);
  box-shadow: 6px 6px 0 #c8201e;
}
.ms-pp-stamp .ms-pp-dot {
  width: 18px; height: 18px; border-radius: 50%;
  background: #c8201e; animation: msPpPulse 1.4s ease-out infinite;
}
@keyframes msPpPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(200,32,30,.85); }
  60%      { box-shadow: 0 0 0 18px rgba(200,32,30,0); }
}
.ms-pp-price {
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 92px; color: #0e0e10;
  line-height: .9; letter-spacing: -.02em;
  border-top: 3px solid #0e0e10;
  border-bottom: 3px solid #0e0e10;
  padding: 6px 18px 0;
}
.ms-pp-price small {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 22px;
  letter-spacing: .24em; text-transform: uppercase; color: #2a2a30;
  display: block; margin-top: 4px; padding-bottom: 4px;
}
.ms-pp-clock {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 28px;
  letter-spacing: .14em; color: #2a2a30;
}
.ms-pp-clock b { font-weight: 700; color: #0e0e10; }

/* ────────────────────────────────────────────────────────
   DATELINE RULE + INDICIA STRIP    y 360–420
   ──────────────────────────────────────────────────────── */
.ms-pp-rule {
  position: absolute; left: 64px; right: 64px; top: 360px; height: 18px; z-index: 2;
  border-top: 6px solid #0e0e10;
  border-bottom: 1px solid #0e0e10;
}
.ms-pp-indicia {
  position: absolute; top: 380px; left: 64px; right: 64px; height: 40px;
  display: grid; grid-template-columns: auto 1fr auto auto auto;
  gap: 36px; align-items: center; z-index: 2;
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 24px;
  color: #2a2a30; letter-spacing: .12em;
}
.ms-pp-indicia .ms-pp-vol { font-weight: 700; color: #0e0e10; letter-spacing: .18em; }
.ms-pp-indicia .ms-pp-vol em { color: #c8201e; font-style: normal; font-weight: 700; }
.ms-pp-indicia .ms-pp-pipe { color: #5a5a62; }
.ms-pp-indicia .ms-pp-red { color: #c8201e; font-weight: 700; }
.ms-pp-indicia .ms-pp-date { font-weight: 500; }

/* ────────────────────────────────────────────────────────
   UPPER CONTENT BAND               y 440–1400
   ──────────────────────────────────────────────────────── */
.ms-pp-upper {
  position: absolute; top: 440px; left: 64px; right: 64px; height: 960px;
  display: grid; grid-template-columns: 2480px 1fr; gap: 32px;
  z-index: 2;
}

/* ── LEAD STORY ─────────────────────────────────────────── */
.ms-pp-lead {
  position: relative; padding: 0; height: 100%;
  display: flex; flex-direction: column;
}
.ms-pp-deptline {
  display: flex; align-items: center; gap: 22px; margin-bottom: 14px;
}
.ms-pp-deptline .ms-pp-swatch {
  width: 36px; height: 36px; background: #c8201e;
  flex-shrink: 0;
}
.ms-pp-deptline .ms-pp-label {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 30px;
  letter-spacing: .32em; text-transform: uppercase; color: #c8201e;
}
.ms-pp-deptline .ms-pp-pipe-line {
  flex: 1; height: 4px; background: #0e0e10;
}
.ms-pp-deptline .ms-pp-edition {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 26px;
  letter-spacing: .22em; text-transform: uppercase; color: #2a2a30;
}

.ms-pp-h1 {
  font-family: 'Playfair Display', serif; font-weight: 900;
  font-size: 248px; line-height: .86;
  color: #0e0e10; margin: 8px 0 18px;
  letter-spacing: -.035em;
}
.ms-pp-h1 em {
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; color: #c8201e; letter-spacing: -.025em;
}
.ms-pp-h1 .ms-pp-small {
  font-style: italic; font-weight: 400; font-size: 92px;
  color: #2a2a30; letter-spacing: -.01em; vertical-align: 30px;
  margin-right: 18px;
}

.ms-pp-deck {
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 400; font-size: 50px; line-height: 1.15;
  color: #2a2a30; margin: 0 0 22px; max-width: 2380px;
  letter-spacing: -.005em;
}

.ms-pp-byline {
  display: flex; align-items: center; gap: 24px;
  padding: 14px 0;
  border-top: 2px solid #0e0e10;
  border-bottom: 1px solid #0e0e10;
  margin-bottom: 24px;
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 26px;
  color: #2a2a30; letter-spacing: .14em;
}
.ms-pp-byline b { color: #0e0e10; font-weight: 700; }
.ms-pp-byline em { color: #c8201e; font-style: normal; font-weight: 700; }
.ms-pp-byline .ms-pp-pipe { color: #5a5a62; }

/* Body: 3-column lede with drop-cap on column 1 */
.ms-pp-body {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 36px;
  flex: 1;
  position: relative;
}
.ms-pp-body > .ms-pp-col {
  font-family: 'Source Serif 4', Georgia, serif;
  font-weight: 400; font-size: 36px; line-height: 1.3;
  color: #0e0e10; letter-spacing: 0;
  position: relative;
  padding-right: 24px;
  border-right: 2px solid #5a5a62;
}
.ms-pp-body > .ms-pp-col:last-child { border-right: 0; padding-right: 0; }
.ms-pp-body > .ms-pp-col.ms-pp-first::first-letter {
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 240px; line-height: .82;
  float: left;
  margin: 12px 18px -10px 0;
  color: #c8201e;
}
.ms-pp-body > .ms-pp-col.ms-pp-first p:first-of-type::first-line {
  font-family: 'Source Serif 4', serif; font-weight: 600;
  letter-spacing: .04em; text-transform: uppercase;
}
.ms-pp-body p { margin: 0 0 14px; }

/* Pull quote — overrides into column 2 */
.ms-pp-pullquote {
  align-self: end; margin-top: 18px;
  padding: 18px 0;
  border-top: 4px solid #0e0e10;
  border-bottom: 4px solid #0e0e10;
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 56px; line-height: 1.05;
  color: #0e0e10; letter-spacing: -.015em;
}
.ms-pp-pullquote .ms-pp-who {
  display: block;
  font-family: 'DM Mono', monospace; font-style: normal; font-weight: 500;
  font-size: 22px; letter-spacing: .26em; text-transform: uppercase;
  color: #c8201e; margin-top: 12px;
}

/* Halftone otter mascot photo card */
.ms-pp-photo {
  align-self: end;
  background: #ebe1c4;
  border: 4px solid #0e0e10;
  padding: 18px 18px 14px;
  box-shadow: 8px 8px 0 #0e0e10;
  margin-top: 18px;
}
.ms-pp-photo .ms-pp-frame {
  position: relative;
  height: 320px;
  background: #0e0e10;
  overflow: hidden;
  background-image:
    radial-gradient(circle at 40% 35%, rgba(243,235,214,.78) 18%, transparent 19%),
    radial-gradient(rgba(255,255,255,.9) 1.6px, transparent 1.8px),
    radial-gradient(rgba(255,255,255,.6) 0.9px, transparent 1.1px);
  background-size: auto, 11px 11px, 7px 7px;
  background-position: 0 0, 0 0, 4px 3px;
}
.ms-pp-photo .ms-pp-frame::before {
  content: ''; position: absolute; bottom: 14px; left: 50%;
  width: 240px; height: 200px;
  transform: translateX(-50%);
  background:
    radial-gradient(ellipse 70px 80px at 50% 30%, rgba(40,30,20,.92) 70%, transparent 72%),
    radial-gradient(ellipse 110px 90px at 50% 80%, rgba(40,30,20,.92) 70%, transparent 72%);
}
.ms-pp-photo .ms-pp-frame::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,.06), transparent 60%);
}
.ms-pp-photo .ms-pp-caption {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 20px;
  line-height: 1.35; color: #2a2a30; letter-spacing: .02em;
  margin-top: 12px; padding-top: 10px;
  border-top: 1px solid #5a5a62;
}
.ms-pp-photo .ms-pp-caption b { color: #0e0e10; font-weight: 700; }

/* ── INDEX SIDEBAR ──────────────────────────────────────── */
.ms-pp-sidebar {
  background: #ebe1c4;
  border: 4px solid #0e0e10;
  box-shadow: 10px 10px 0 #0e0e10;
  padding: 28px 32px 20px;
  display: flex; flex-direction: column;
  height: 100%;
  position: relative;
}
.ms-pp-sidebar::before {
  content: ''; position: absolute; top: 0; right: 0;
  width: 60px; height: 60px;
  background: linear-gradient(225deg, #e2d6b1 50%, #0e0e10 50%);
  box-shadow: -2px 2px 0 #0e0e10;
}

.ms-pp-tochead {
  display: flex; align-items: baseline; justify-content: space-between;
  padding-bottom: 16px;
  border-bottom: 6px double #0e0e10;
  margin-bottom: 20px;
}
.ms-pp-tochead .ms-pp-h {
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 84px; line-height: 1;
  color: #0e0e10; letter-spacing: -.025em;
}
.ms-pp-tochead .ms-pp-h em { color: #c8201e; font-style: italic; }
.ms-pp-tochead .ms-pp-day {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .26em; text-transform: uppercase; color: #2a2a30;
  text-align: right;
}

/* TOC list */
.ms-pp-toc {
  display: grid; gap: 0;
  margin-bottom: 24px;
}
.ms-pp-row {
  display: grid; grid-template-columns: 78px 1fr auto;
  column-gap: 18px; align-items: center;
  padding: 12px 0;
  border-bottom: 1px dashed #5a5a62;
  position: relative;
}
.ms-pp-row:last-child { border-bottom: 0; }
.ms-pp-row.ms-pp-now {
  background: #0e0e10; color: #f3ebd6;
  margin: 6px -16px;
  padding: 14px 16px;
  border-bottom: 0;
}
.ms-pp-row.ms-pp-done { opacity: .55; }
.ms-pp-row .ms-pp-p {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 26px;
  color: #c8201e; letter-spacing: .08em; text-align: center;
  border: 3px solid #c8201e;
  padding: 4px 0;
  line-height: 1;
}
.ms-pp-row.ms-pp-now .ms-pp-p {
  color: #f3ebd6;
  background: #c8201e; border-color: #c8201e;
}
.ms-pp-row.ms-pp-done .ms-pp-p {
  color: #5a5a62; border-color: #5a5a62;
}
.ms-pp-row .ms-pp-what {
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 36px; color: #0e0e10; line-height: 1.05;
  letter-spacing: -.01em;
}
.ms-pp-row.ms-pp-now .ms-pp-what { color: #f3ebd6; }
.ms-pp-row .ms-pp-what span {
  display: block;
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 19px;
  color: #5a5a62; letter-spacing: .14em; text-transform: uppercase;
  margin-top: 3px;
}
.ms-pp-row.ms-pp-now .ms-pp-what span { color: rgba(243,235,214,.7); }
.ms-pp-row .ms-pp-pg {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 22px;
  letter-spacing: .14em; color: #2a2a30;
  text-align: right;
  white-space: nowrap;
}
.ms-pp-row.ms-pp-now .ms-pp-pg { color: #f3ebd6; }

/* Stats footer */
.ms-pp-stats {
  display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
  margin-top: auto;
  padding-top: 16px;
  border-top: 6px double #0e0e10;
}
.ms-pp-s {
  background: #f3ebd6;
  border: 3px solid #0e0e10;
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 4px;
}
.ms-pp-s.ms-pp-featured {
  background: #c8201e; color: #f3ebd6;
  border-color: #0e0e10;
}
.ms-pp-s .ms-pp-k {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 18px;
  letter-spacing: .22em; text-transform: uppercase; color: #2a2a30;
}
.ms-pp-s.ms-pp-featured .ms-pp-k { color: rgba(243,235,214,.85); }
.ms-pp-s .ms-pp-v {
  font-family: 'Playfair Display', serif; font-weight: 900;
  font-size: 84px; line-height: 1;
  color: #0e0e10; letter-spacing: -.03em;
}
.ms-pp-s .ms-pp-v em {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 22px;
  color: #5a5a62; font-style: normal;
  letter-spacing: .14em;
}
.ms-pp-s.ms-pp-featured .ms-pp-v { color: #f3ebd6; }
.ms-pp-s.ms-pp-featured .ms-pp-v em { color: rgba(243,235,214,.78); }
.ms-pp-s .ms-pp-sub {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 18px;
  color: #5a5a62; letter-spacing: .04em;
}
.ms-pp-s.ms-pp-featured .ms-pp-sub { color: rgba(243,235,214,.78); }

/* ────────────────────────────────────────────────────────
   DEPARTMENTS BAND               y 1420–1980
   ──────────────────────────────────────────────────────── */
.ms-pp-depts {
  position: absolute; top: 1420px; left: 64px; right: 64px; height: 560px;
  display: grid; grid-template-columns: 1.25fr 1fr 1fr; gap: 32px;
  z-index: 2;
}
.ms-pp-dept {
  background: #ebe1c4;
  border: 4px solid #0e0e10;
  box-shadow: 10px 10px 0 #0e0e10;
  padding: 24px 32px 22px;
  display: flex; flex-direction: column;
  position: relative;
  overflow: hidden;
}
.ms-pp-dept::before {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 8px;
  background: repeating-linear-gradient(45deg,
    #0e0e10 0 8px, transparent 8px 16px);
}

.ms-pp-dept .ms-pp-slug {
  display: grid; grid-template-columns: auto 1fr auto;
  column-gap: 16px; align-items: center;
  padding-bottom: 12px; border-bottom: 4px solid #0e0e10;
  margin-bottom: 18px;
}
.ms-pp-dept .ms-pp-slug .ms-pp-num {
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 64px; color: #c8201e;
  line-height: .9; letter-spacing: -.02em;
}
.ms-pp-dept .ms-pp-slug .ms-pp-name {
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 56px; line-height: .95; color: #0e0e10;
  letter-spacing: -.015em;
}
.ms-pp-dept .ms-pp-slug .ms-pp-name em {
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; color: #c8201e;
}
.ms-pp-dept .ms-pp-slug .ms-pp-meta {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 22px;
  letter-spacing: .22em; text-transform: uppercase; color: #2a2a30;
  text-align: right;
}

/* DINING — menu */
.ms-pp-dept.ms-pp-dining .ms-pp-entree {
  font-family: 'Playfair Display', serif; font-weight: 900;
  font-size: 88px; line-height: .92; color: #0e0e10;
  letter-spacing: -.03em;
  margin-top: 4px;
}
.ms-pp-dept.ms-pp-dining .ms-pp-entree em {
  font-family: 'Playfair Display', serif; font-style: italic;
  color: #c8201e; font-weight: 900;
}
.ms-pp-dept.ms-pp-dining .ms-pp-sides {
  font-family: 'Source Serif 4', serif; font-weight: 400; font-style: italic;
  font-size: 36px; line-height: 1.25; color: #2a2a30;
  margin: 16px 0 18px; letter-spacing: 0;
}
.ms-pp-dept.ms-pp-dining .ms-pp-tags {
  display: flex; gap: 12px; flex-wrap: wrap;
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid #5a5a62;
}
.ms-pp-dept.ms-pp-dining .ms-pp-tags b {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 24px;
  background: #0e0e10; color: #f3ebd6;
  padding: 10px 18px; letter-spacing: .14em;
}
.ms-pp-dept.ms-pp-dining .ms-pp-tags b.ms-pp-red-tag { background: #c8201e; }

/* AFTER 3 / SEEN TODAY — list rows */
.ms-pp-dept .ms-pp-list { display: grid; gap: 14px; align-content: start; }
.ms-pp-dept .ms-pp-list .ms-pp-it {
  display: grid; grid-template-columns: 92px 1fr auto;
  column-gap: 22px; align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid #5a5a62;
}
.ms-pp-dept .ms-pp-list .ms-pp-it:last-child { border-bottom: 0; }
.ms-pp-dept .ms-pp-list .ms-pp-it .ms-pp-ico {
  width: 84px; height: 84px;
  background: #f3ebd6;
  border: 4px solid #0e0e10;
  display: grid; place-items: center;
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 44px;
  color: #0e0e10; line-height: 1;
  box-shadow: 4px 4px 0 #0e0e10;
}
.ms-pp-dept .ms-pp-list .ms-pp-it .ms-pp-ico.ms-pp-ico-red { background: #c8201e; color: #f3ebd6; }
.ms-pp-dept .ms-pp-list .ms-pp-it .ms-pp-ico.ms-pp-ico-cream { background: #e2d6b1; }
.ms-pp-dept .ms-pp-list .ms-pp-it .ms-pp-info .ms-pp-t {
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 38px; line-height: 1.05; color: #0e0e10;
  letter-spacing: -.005em;
}
.ms-pp-dept .ms-pp-list .ms-pp-it .ms-pp-info .ms-pp-s-it {
  font-family: 'Source Serif 4', serif; font-weight: 400; font-style: italic;
  font-size: 26px; color: #2a2a30; margin-top: 4px;
  letter-spacing: 0;
}
.ms-pp-dept .ms-pp-list .ms-pp-it .ms-pp-when {
  font-family: 'Playfair Display', serif; font-weight: 900;
  font-size: 42px; color: #c8201e; letter-spacing: -.01em;
  line-height: 1; text-align: right;
  white-space: nowrap;
}
.ms-pp-dept .ms-pp-list .ms-pp-it .ms-pp-when small {
  display: block;
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 18px;
  letter-spacing: .14em; color: #5a5a62;
  margin-top: 6px;
}

/* ────────────────────────────────────────────────────────
   STOP-PRESS BULLETIN TICKER     y 2000–2140
   ──────────────────────────────────────────────────────── */
.ms-pp-ticker {
  position: absolute; left: 64px; right: 64px; bottom: 20px; height: 140px;
  background: #0e0e10; color: #f3ebd6;
  border: 4px solid #0e0e10;
  box-shadow: 10px 10px 0 #c8201e;
  display: grid; grid-template-columns: auto 1fr auto;
  align-items: stretch;
  overflow: hidden;
  z-index: 2;
}
.ms-pp-ticker .ms-pp-tag {
  background: #c8201e; color: #f3ebd6;
  padding: 0 36px;
  display: flex; align-items: center; gap: 18px;
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 56px; line-height: 1;
  letter-spacing: -.015em;
  border-right: 4px solid #0e0e10;
  flex-shrink: 0;
}
.ms-pp-ticker .ms-pp-tag::before {
  content: '★'; font-family: 'Source Serif 4', serif; font-style: normal;
  font-size: 48px; color: #f3ebd6;
}
.ms-pp-ticker .ms-pp-feed {
  overflow: hidden; display: flex; align-items: center;
  padding-left: 36px;
}
.ms-pp-ticker .ms-pp-feed-inner {
  display: flex; gap: 64px;
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 56px; color: #f3ebd6; white-space: nowrap;
  letter-spacing: -.005em;
  animation: msPpScroll 80s linear infinite;
}
.ms-pp-ticker .ms-pp-feed-inner span { display: inline-flex; align-items: center; gap: 28px; }
.ms-pp-ticker .ms-pp-feed-inner span::after {
  content: '§'; color: #c8201e; margin-left: 32px;
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 52px;
}
.ms-pp-ticker .ms-pp-vol-end {
  background: #f3ebd6; color: #0e0e10;
  padding: 0 28px;
  display: flex; align-items: center;
  border-left: 4px solid #0e0e10;
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 26px;
  letter-spacing: .22em; text-transform: uppercase;
  white-space: nowrap;
  flex-shrink: 0;
}
@keyframes msPpScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
`;
