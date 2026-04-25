"use client";

/**
 * MsPaperPortraitWidget — Middle-school lobby scene (PORTRAIT 2160×3840).
 *
 * APPROVED 2026-04-25 — matches scratch/design/paper-ms-portrait-v1.html.
 * Portrait sibling to MsPaperWidget.
 *
 * Vertical broadsheet metaphor — Playfair Display + DM Serif Display +
 * Source Serif 4 + DM Mono on warm newsprint cream. Three inks only:
 * ink black, paper cream, single editorial red.
 *
 * Layout (2160×3840, top inset 56, bottom inset 76, every gap 20px,
 * panel inset 64):
 *   WEATHER + TIME ROW   y   56 →  416   (h  360)  weather tiles + edition + clock
 *   MASTHEAD             y  436 →  836   (h  400)  "The Otter Daily" nameplate
 *   DATELINE RULE        y  856 →  874   (h   18)  thick-thin double rule
 *   INDICIA STRIP        y  894 →  954   (h   60)  vol/no · date · flag
 *   LEAD STORY           y  974 → 2354   (h 1380)  deptline + h1 + deck + body + halftone
 *   INDEX SIDEBAR        y 2374 → 3024   (h  650)  TOC + 7 agenda rows + stats footer
 *   DEPARTMENTS          y 3044 → 3604   (h  560)  Dining + Clubs + Shoutouts
 *   STOP-PRESS TICKER    y 3624 → 3764   (h  140)  scrolling bulletin
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsPaperPortraitConfig {
  // Weather cluster (top-left)
  'weather.label'?: string;
  'weather.high'?: string;
  'weather.low_label'?: string;
  'weather.low'?: string;
  'weather.sky_label'?: string;
  'weather.sky'?: string;
  // Edition rail (top-right)
  'edition.flag'?: string;
  'price.value'?: string;
  'price.note'?: string;
  'clock.day'?: string;
  'clock.date'?: string;
  // Masthead nameplate
  'masthead.kicker'?: string;
  'masthead.the'?: string;
  'masthead.mascot'?: string;
  'masthead.suffix'?: string;
  'masthead.tagline'?: string;
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
  'greeting.col3a'?: string;
  'greeting.pq'?: string;
  'greeting.pq_who'?: string;
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

export const DEFAULTS: Required<MsPaperPortraitConfig> = {
  'weather.label': 'High',
  'weather.high': '62',
  'weather.low_label': 'Low',
  'weather.low': '46',
  'weather.sky_label': "Today's Sky",
  'weather.sky': 'Clear & bright',
  'edition.flag': 'LIVE · 7:53 A.M.',
  'price.value': '5¢',
  'price.note': 'Free for the otters',
  'clock.day': 'Tuesday',
  'clock.date': 'April 21',
  'masthead.kicker': 'Westridge Middle · Morning Edition',
  'masthead.the': 'The',
  'masthead.mascot': 'Otter',
  'masthead.suffix': 'Daily',
  'masthead.tagline': 'All the news that fits the hallway · Est. 1962',
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
  'greeting.col3a':
    'Sign-ups for Field Day close this Friday at last bell. Two hundred and eighty-four otters are in. The remaining slots, the front office reports, will not last the week.',
  'greeting.pq': 'Bring a pencil, a journal, and a quiet bit of courage.',
  'greeting.pq_who': '— Mr. Nguyen, Eng. 7',
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
  'lunch.meta': '11:45 A.M.',
  'lunch.entree': 'Chicken & rice bowl.',
  'lunch.sides':
    'Roasted broccoli, garlic bread, fresh fruit, and the salad bar open all period long.',
  'lunch.tag1': 'VEG OPT',
  'lunch.tag2': 'GLUTEN-FREE',
  'lunch.tag3': 'DAIRY-FREE',
  'clubs.num': '§ 02',
  'clubs.dept_em': 'After',
  'clubs.dept': '/ Three.',
  'clubs.meta': '3:00 P.M.',
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
  'clubs.2.r': 'Greenhouse · plant rows',
  'clubs.2.w': '3:00',
  'clubs.2.note': 'wear boots',
  'shoutouts.num': '§ 03',
  'shoutouts.dept_em': 'Seen',
  'shoutouts.dept': '/ Around.',
  'shoutouts.meta': 'Hall monitors',
  'shoutouts.0.ic': '★',
  'shoutouts.0.t': 'Maya Rodriguez',
  'shoutouts.0.r': 'Turns 13 today — H.B.D.',
  'shoutouts.0.w': '7B',
  'shoutouts.0.note': 'homeroom',
  'shoutouts.1.ic': '+1',
  'shoutouts.1.t': 'Daniel K.',
  'shoutouts.1.r': 'Math olympiad — 3rd',
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

const pick = <K extends keyof Required<MsPaperPortraitConfig>>(
  cfg: MsPaperPortraitConfig,
  key: K,
): string => (cfg[key] ?? DEFAULTS[key]) as string;

export function MsPaperPortraitWidget({
  config,
}: {
  config?: MsPaperPortraitConfig;
}) {
  const cfg = config || {};

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: '#f3ebd6',
        backgroundImage: [
          'radial-gradient(rgba(120, 90, 50, .07) 1px, transparent 1.5px)',
          'radial-gradient(rgba(120, 90, 50, .04) 1px, transparent 1.5px)',
          'radial-gradient(ellipse 1500px 1700px at 0% 0%, rgba(232, 196, 120, .18), transparent 70%)',
          'radial-gradient(ellipse 1500px 1700px at 100% 100%, rgba(120, 90, 50, .12), transparent 70%)',
        ].join(', '),
        backgroundSize: '8px 8px, 17px 17px, auto, auto',
        backgroundPosition: '0 0, 6px 4px, 0 0, 0 0',
        color: '#0e0e10',
        fontFamily: "'Source Serif 4', Georgia, serif",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Faint horizontal fold line + edge vignette for "real paper" */}
      <div className="ms-pp-p-paperfx" aria-hidden="true" />

      {/* ─── WEATHER + TIME ROW ─────────────────────────────── */}
      <header className="ms-pp-p-wxrow">
        {/* LEFT: weather tile cluster (2 small + 1 wide) */}
        <div className="ms-pp-p-lefttiles" data-widget="weather-cluster">
          <div className="ms-pp-p-tile ms-pp-p-warm" data-widget="weather">
            <span className="ms-pp-p-k" data-field="weather.label">{pick(cfg, 'weather.label')}</span>
            <span className="ms-pp-p-v">
              <span data-field="weather.high">{pick(cfg, 'weather.high')}</span>
              <small>&deg;F</small>
            </span>
          </div>
          <div className="ms-pp-p-tile" data-widget="weather-low">
            <span className="ms-pp-p-k" data-field="weather.low_label">{pick(cfg, 'weather.low_label')}</span>
            <span className="ms-pp-p-v">
              <span data-field="weather.low">{pick(cfg, 'weather.low')}</span>
              <small>&deg;F</small>
            </span>
          </div>
          <div className="ms-pp-p-tile ms-pp-p-full" data-widget="weather-summary">
            <span className="ms-pp-p-k" data-field="weather.sky_label">{pick(cfg, 'weather.sky_label')}</span>
            <span className="ms-pp-p-v">
              <span data-field="weather.sky">{pick(cfg, 'weather.sky')}</span>
              <span className="ms-pp-p-arrow">&mdash; light SW wind</span>
            </span>
          </div>
        </div>

        {/* RIGHT: edition stamp + price + clock */}
        <div className="ms-pp-p-editrail">
          <div className="ms-pp-p-stamp" data-widget="edition">
            <span className="ms-pp-p-dot" aria-hidden="true" />
            <span data-field="edition.flag">{pick(cfg, 'edition.flag')}</span>
          </div>
          <div className="ms-pp-p-price" data-widget="price">
            <span data-field="price.value">{pick(cfg, 'price.value')}</span>
            <small data-field="price.note">{pick(cfg, 'price.note')}</small>
          </div>
          <div className="ms-pp-p-clock" data-widget="clock">
            <b data-field="clock.day">{pick(cfg, 'clock.day')}</b>
            {', '}
            <span data-field="clock.date">{pick(cfg, 'clock.date')}</span>
          </div>
        </div>
      </header>

      {/* ─── MASTHEAD ──────────────────────────────────────── */}
      <header className="ms-pp-p-mast" data-widget="masthead">
        <div className="ms-pp-p-ribbon" data-field="masthead.kicker">{pick(cfg, 'masthead.kicker')}</div>
        <div className="ms-pp-p-title">
          <span className="ms-pp-p-the" data-field="masthead.the">{pick(cfg, 'masthead.the')}</span>
          <span data-field="masthead.mascot">{pick(cfg, 'masthead.mascot')}</span>
          &nbsp;
          <span className="ms-pp-p-accent" data-field="masthead.suffix">{pick(cfg, 'masthead.suffix')}</span>
        </div>
        <div className="ms-pp-p-tagline" data-field="masthead.tagline">{pick(cfg, 'masthead.tagline')}</div>
      </header>

      {/* ─── DATELINE RULE ─────────────────────────────────── */}
      <div className="ms-pp-p-rule" aria-hidden="true" />

      {/* ─── INDICIA STRIP ─────────────────────────────────── */}
      <div className="ms-pp-p-indicia" data-widget="indicia">
        <span className="ms-pp-p-vol" data-field="indicia.vol">{pick(cfg, 'indicia.vol')}</span>
        <span className="ms-pp-p-date" data-field="indicia.date">{pick(cfg, 'indicia.date')}</span>
        <span className="ms-pp-p-pipe">|</span>
        <span className="ms-pp-p-red" data-field="indicia.flag">{pick(cfg, 'indicia.flag')}</span>
        <span className="ms-pp-p-pipe">|</span>
        <span data-field="indicia.run">{pick(cfg, 'indicia.run')}</span>
      </div>

      {/* ─── LEAD STORY ────────────────────────────────────── */}
      <article className="ms-pp-p-lead" data-widget="greeting">
        <div className="ms-pp-p-deptline">
          <span className="ms-pp-p-swatch" aria-hidden="true" />
          <span className="ms-pp-p-label" data-field="greeting.dept">{pick(cfg, 'greeting.dept')}</span>
          <span className="ms-pp-p-pipe-line" aria-hidden="true" />
          <span className="ms-pp-p-edition" data-field="greeting.edition">{pick(cfg, 'greeting.edition')}</span>
        </div>

        <h1 className="ms-pp-p-h1">
          <span className="ms-pp-p-small" data-field="greeting.kicker">{pick(cfg, 'greeting.kicker')}</span>
          <span data-field="greeting.headline1">{pick(cfg, 'greeting.headline1')}</span>
          {' '}
          <em data-field="greeting.headline2">{pick(cfg, 'greeting.headline2')}</em>
        </h1>

        <p className="ms-pp-p-deck" data-field="greeting.deck">{pick(cfg, 'greeting.deck')}</p>

        <div className="ms-pp-p-byline">
          <span>By <b data-field="greeting.byline">{pick(cfg, 'greeting.byline')}</b></span>
          <span className="ms-pp-p-pipe">|</span>
          <span data-field="greeting.dateline">{pick(cfg, 'greeting.dateline')}</span>
          <span className="ms-pp-p-pipe">|</span>
          <em data-field="greeting.tag">{pick(cfg, 'greeting.tag')}</em>
        </div>

        <div className="ms-pp-p-body">
          <div className="ms-pp-p-col ms-pp-p-first">
            <p data-field="greeting.lede">{pick(cfg, 'greeting.lede')}</p>
            <p data-field="greeting.col1b">{pick(cfg, 'greeting.col1b')}</p>

            <div className="ms-pp-p-pullquote">
              &ldquo;<span data-field="greeting.pq">{pick(cfg, 'greeting.pq')}</span>&rdquo;
              <span className="ms-pp-p-who" data-field="greeting.pq_who">{pick(cfg, 'greeting.pq_who')}</span>
            </div>
          </div>
          <div className="ms-pp-p-col">
            <p data-field="greeting.col2a">{pick(cfg, 'greeting.col2a')}</p>
            <p data-field="greeting.col3a">{pick(cfg, 'greeting.col3a')}</p>

            <div className="ms-pp-p-photo" data-widget="photo">
              <div className="ms-pp-p-frame" aria-hidden="true" />
              <div className="ms-pp-p-caption" data-field="photo.caption">
                <b>{pick(cfg, 'photo.caption')}</b>
                {', mascot, surveys the courtyard before first bell. '}
                <em>&mdash; Photograph by Yearbook Club</em>
              </div>
            </div>
          </div>
        </div>
      </article>

      {/* ─── INDEX SIDEBAR ─────────────────────────────────── */}
      <aside className="ms-pp-p-sidebar" data-widget="agenda">
        <div className="ms-pp-p-tochead">
          <div className="ms-pp-p-h">
            <span data-field="agenda.title">{pick(cfg, 'agenda.title')}</span>
            <em data-field="agenda.title_em">{pick(cfg, 'agenda.title_em')}</em>
          </div>
          <div className="ms-pp-p-day">
            <span data-field="agenda.day">{pick(cfg, 'agenda.day')}</span>
            <br />
            <span data-field="agenda.run">{pick(cfg, 'agenda.run')}</span>
          </div>
        </div>

        <div className="ms-pp-p-toc">
          {([0, 1, 2, 3, 4, 5, 6] as const).map((i) => {
            const rowClass = i === 1 ? 'ms-pp-p-now' : i === 0 ? 'ms-pp-p-done' : '';
            return (
              <div
                key={i}
                className={`ms-pp-p-row ${rowClass}`.trim()}
                data-widget={`agenda.${i}`}
              >
                <span className="ms-pp-p-p" data-field={`agenda.${i}.p`}>
                  {pick(cfg, `agenda.${i}.p` as keyof Required<MsPaperPortraitConfig>)}
                </span>
                <span className="ms-pp-p-what">
                  <span data-field={`agenda.${i}.t`}>
                    {pick(cfg, `agenda.${i}.t` as keyof Required<MsPaperPortraitConfig>)}
                  </span>
                  <span data-field={`agenda.${i}.r`}>
                    {pick(cfg, `agenda.${i}.r` as keyof Required<MsPaperPortraitConfig>)}
                  </span>
                </span>
                <span className="ms-pp-p-pg" data-field={`agenda.${i}.time`}>
                  {pick(cfg, `agenda.${i}.time` as keyof Required<MsPaperPortraitConfig>)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="ms-pp-p-stats">
          <div className="ms-pp-p-s ms-pp-p-featured" data-widget="countdown">
            <span className="ms-pp-p-k" data-field="countdown.label">{pick(cfg, 'countdown.label')}</span>
            <span className="ms-pp-p-v">
              <span data-field="countdown.value">{pick(cfg, 'countdown.value')}</span>
            </span>
            <span className="ms-pp-p-sub" data-field="countdown.sub">{pick(cfg, 'countdown.sub')}</span>
          </div>
          <div className="ms-pp-p-s" data-widget="attendance">
            <span className="ms-pp-p-k" data-field="attendance.label">{pick(cfg, 'attendance.label')}</span>
            <span className="ms-pp-p-v">
              <span data-field="attendance.value">{pick(cfg, 'attendance.value')}</span>
              <em data-field="attendance.unit">{pick(cfg, 'attendance.unit')}</em>
            </span>
            <span className="ms-pp-p-sub" data-field="attendance.sub">{pick(cfg, 'attendance.sub')}</span>
          </div>
        </div>
      </aside>

      {/* ─── DEPARTMENTS BAND ──────────────────────────────── */}
      <section className="ms-pp-p-depts">
        {/* DINING */}
        <div className="ms-pp-p-dept ms-pp-p-dining" data-widget="lunch">
          <div className="ms-pp-p-slug">
            <span className="ms-pp-p-num" data-field="lunch.num">{pick(cfg, 'lunch.num')}</span>
            <span className="ms-pp-p-name">
              <em data-field="lunch.dept_em">{pick(cfg, 'lunch.dept_em')}</em>
              <span data-field="lunch.dept">{pick(cfg, 'lunch.dept')}</span>
            </span>
            <span className="ms-pp-p-meta" data-field="lunch.meta">{pick(cfg, 'lunch.meta')}</span>
          </div>
          <div className="ms-pp-p-entree" data-field="lunch.entree">{pick(cfg, 'lunch.entree')}</div>
          <div className="ms-pp-p-sides" data-field="lunch.sides">{pick(cfg, 'lunch.sides')}</div>
          <div className="ms-pp-p-tags">
            <b data-field="lunch.tag1">{pick(cfg, 'lunch.tag1')}</b>
            <b data-field="lunch.tag2">{pick(cfg, 'lunch.tag2')}</b>
            <b className="ms-pp-p-red-tag" data-field="lunch.tag3">{pick(cfg, 'lunch.tag3')}</b>
          </div>
        </div>

        {/* AFTER 3 / CLUBS */}
        <div className="ms-pp-p-dept ms-pp-p-clubs" data-widget="clubs">
          <div className="ms-pp-p-slug">
            <span className="ms-pp-p-num" data-field="clubs.num">{pick(cfg, 'clubs.num')}</span>
            <span className="ms-pp-p-name">
              <em data-field="clubs.dept_em">{pick(cfg, 'clubs.dept_em')}</em>
              <span data-field="clubs.dept">{pick(cfg, 'clubs.dept')}</span>
            </span>
            <span className="ms-pp-p-meta" data-field="clubs.meta">{pick(cfg, 'clubs.meta')}</span>
          </div>
          <div className="ms-pp-p-list">
            {([0, 1, 2] as const).map((i) => {
              const icoClass = i === 0 ? 'ms-pp-p-ico-red' : i === 2 ? 'ms-pp-p-ico-cream' : '';
              return (
                <div key={i} className="ms-pp-p-it" data-widget={`clubs.${i}`}>
                  <div
                    className={`ms-pp-p-ico ${icoClass}`.trim()}
                    data-field={`clubs.${i}.ic`}
                  >
                    {pick(cfg, `clubs.${i}.ic` as keyof Required<MsPaperPortraitConfig>)}
                  </div>
                  <div className="ms-pp-p-info">
                    <div className="ms-pp-p-t" data-field={`clubs.${i}.t`}>
                      {pick(cfg, `clubs.${i}.t` as keyof Required<MsPaperPortraitConfig>)}
                    </div>
                    <div className="ms-pp-p-s-it" data-field={`clubs.${i}.r`}>
                      {pick(cfg, `clubs.${i}.r` as keyof Required<MsPaperPortraitConfig>)}
                    </div>
                  </div>
                  <div className="ms-pp-p-when">
                    <span data-field={`clubs.${i}.w`}>
                      {pick(cfg, `clubs.${i}.w` as keyof Required<MsPaperPortraitConfig>)}
                    </span>
                    <small data-field={`clubs.${i}.note`}>
                      {pick(cfg, `clubs.${i}.note` as keyof Required<MsPaperPortraitConfig>)}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* SEEN TODAY / SHOUTOUTS */}
        <div className="ms-pp-p-dept ms-pp-p-shoutouts" data-widget="shoutouts">
          <div className="ms-pp-p-slug">
            <span className="ms-pp-p-num" data-field="shoutouts.num">{pick(cfg, 'shoutouts.num')}</span>
            <span className="ms-pp-p-name">
              <em data-field="shoutouts.dept_em">{pick(cfg, 'shoutouts.dept_em')}</em>
              <span data-field="shoutouts.dept">{pick(cfg, 'shoutouts.dept')}</span>
            </span>
            <span className="ms-pp-p-meta" data-field="shoutouts.meta">{pick(cfg, 'shoutouts.meta')}</span>
          </div>
          <div className="ms-pp-p-list">
            {([0, 1, 2] as const).map((i) => {
              const icoClass = i === 0 ? 'ms-pp-p-ico-red' : i === 2 ? 'ms-pp-p-ico-cream' : '';
              return (
                <div key={i} className="ms-pp-p-it" data-widget={`shoutouts.${i}`}>
                  <div
                    className={`ms-pp-p-ico ${icoClass}`.trim()}
                    data-field={`shoutouts.${i}.ic`}
                  >
                    {pick(cfg, `shoutouts.${i}.ic` as keyof Required<MsPaperPortraitConfig>)}
                  </div>
                  <div className="ms-pp-p-info">
                    <div className="ms-pp-p-t" data-field={`shoutouts.${i}.t`}>
                      {pick(cfg, `shoutouts.${i}.t` as keyof Required<MsPaperPortraitConfig>)}
                    </div>
                    <div className="ms-pp-p-s-it" data-field={`shoutouts.${i}.r`}>
                      {pick(cfg, `shoutouts.${i}.r` as keyof Required<MsPaperPortraitConfig>)}
                    </div>
                  </div>
                  <div className="ms-pp-p-when">
                    <span data-field={`shoutouts.${i}.w`}>
                      {pick(cfg, `shoutouts.${i}.w` as keyof Required<MsPaperPortraitConfig>)}
                    </span>
                    <small data-field={`shoutouts.${i}.note`}>
                      {pick(cfg, `shoutouts.${i}.note` as keyof Required<MsPaperPortraitConfig>)}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── BULLETIN TICKER ─────────────────────────────── */}
      <div className="ms-pp-p-ticker" data-widget="ticker">
        <div className="ms-pp-p-tag" data-field="ticker.tag">{pick(cfg, 'ticker.tag')}</div>
        <div className="ms-pp-p-feed">
          <div className="ms-pp-p-feed-inner">
            {([0, 1, 2, 3, 4, 5, 6] as const).map((i) => (
              <span key={`a${i}`} data-field={`ticker.${i}`}>
                {pick(cfg, `ticker.${i}` as keyof Required<MsPaperPortraitConfig>)}
              </span>
            ))}
            {/* Duplicate for seamless scroll */}
            {([0, 1, 2, 3, 4, 5, 6] as const).map((i) => (
              <span key={`b${i}`} aria-hidden="true">
                {pick(cfg, `ticker.${i}` as keyof Required<MsPaperPortraitConfig>)}
              </span>
            ))}
          </div>
        </div>
        <div className="ms-pp-p-vol-end" data-field="ticker.endmark">{pick(cfg, 'ticker.endmark')}</div>
      </div>
    </HsStage>
  );
}

const CSS = `
.ms-pp-p-paperfx,
.ms-pp-p-wxrow, .ms-pp-p-wxrow *,
.ms-pp-p-mast, .ms-pp-p-mast *,
.ms-pp-p-rule,
.ms-pp-p-indicia, .ms-pp-p-indicia *,
.ms-pp-p-lead, .ms-pp-p-lead *,
.ms-pp-p-sidebar, .ms-pp-p-sidebar *,
.ms-pp-p-depts, .ms-pp-p-depts *,
.ms-pp-p-ticker, .ms-pp-p-ticker * {
  box-sizing: border-box;
}

/* Paper FX overlay — horizontal fold across centre + edge vignette */
.ms-pp-p-paperfx {
  position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background:
    linear-gradient(to bottom,
      transparent 49.85%,
      rgba(0,0,0,.06) 49.95%,
      rgba(0,0,0,.06) 50.05%,
      transparent 50.15%),
    radial-gradient(ellipse 1900px 3300px at 50% 50%, transparent 60%, rgba(60, 40, 20, .14) 100%);
}

/* ────────────────────────────────────────────────────────
   WEATHER + TIME ROW           y 56–416, h 360, inset 64
   ──────────────────────────────────────────────────────── */
.ms-pp-p-wxrow {
  position: absolute; top: 56px; left: 64px; right: 64px; height: 360px;
  display: grid; grid-template-columns: 1.05fr 1fr; column-gap: 32px;
  z-index: 2; overflow: hidden;
}

/* LEFT — weather tiles, 2 small + 1 wide */
.ms-pp-p-lefttiles {
  display: grid; grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 18px;
  overflow: hidden;
}
.ms-pp-p-tile {
  background: #ebe1c4;
  border: 4px solid #0e0e10;
  padding: 22px 26px;
  display: flex; flex-direction: column; gap: 8px;
  box-shadow: 6px 6px 0 #0e0e10;
  position: relative; overflow: hidden;
}
.ms-pp-p-tile.ms-pp-p-full { grid-column: 1 / -1; }
.ms-pp-p-tile .ms-pp-p-k {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 26px;
  letter-spacing: .26em; text-transform: uppercase; color: #5a5a62;
}
.ms-pp-p-tile .ms-pp-p-v {
  font-family: 'Playfair Display', serif; font-weight: 900;
  font-size: 110px; line-height: .9; color: #0e0e10;
  letter-spacing: -.02em;
  display: flex; align-items: baseline; gap: 12px;
}
.ms-pp-p-tile.ms-pp-p-warm .ms-pp-p-v { color: #c8201e; }
.ms-pp-p-tile .ms-pp-p-v small {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 28px;
  color: #2a2a30; letter-spacing: .04em;
}
.ms-pp-p-tile.ms-pp-p-full .ms-pp-p-v { font-size: 64px; }
.ms-pp-p-tile.ms-pp-p-full .ms-pp-p-v .ms-pp-p-arrow {
  color: #c8201e; font-family: 'Playfair Display', serif;
  font-style: italic; font-weight: 900;
}

/* RIGHT — edition stamp / price / clock */
.ms-pp-p-editrail {
  display: flex; flex-direction: column; align-items: stretch;
  justify-content: space-between; gap: 18px;
  padding: 6px 0; overflow: hidden;
}
.ms-pp-p-stamp {
  align-self: flex-end;
  display: inline-flex; align-items: center; gap: 18px;
  padding: 18px 32px;
  background: #0e0e10; color: #f3ebd6;
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 34px;
  letter-spacing: .26em; text-transform: uppercase;
  transform: rotate(-2deg);
  box-shadow: 8px 8px 0 #c8201e;
}
.ms-pp-p-stamp .ms-pp-p-dot {
  width: 22px; height: 22px; border-radius: 50%;
  background: #c8201e; animation: msPpPPulse 1.4s ease-out infinite;
}
@keyframes msPpPPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(200,32,30,.85); }
  60%      { box-shadow: 0 0 0 22px rgba(200,32,30,0); }
}
.ms-pp-p-price {
  align-self: flex-end;
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 124px; color: #0e0e10;
  line-height: .9; letter-spacing: -.02em;
  border-top: 4px solid #0e0e10;
  border-bottom: 4px solid #0e0e10;
  padding: 8px 24px 0;
  text-align: right;
}
.ms-pp-p-price small {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 24px;
  letter-spacing: .24em; text-transform: uppercase; color: #2a2a30;
  display: block; margin-top: 4px; padding-bottom: 6px;
}
.ms-pp-p-clock {
  align-self: flex-end;
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 32px;
  letter-spacing: .14em; color: #2a2a30;
}
.ms-pp-p-clock b { font-weight: 700; color: #0e0e10; }

/* ────────────────────────────────────────────────────────
   MASTHEAD                      y 436–836, h 400, inset 64
   ──────────────────────────────────────────────────────── */
.ms-pp-p-mast {
  position: absolute; top: 436px; left: 64px; right: 64px; height: 400px;
  display: flex; flex-direction: column; align-items: center;
  justify-content: center;
  z-index: 2; overflow: hidden;
}
.ms-pp-p-ribbon {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 32px;
  letter-spacing: .42em; text-transform: uppercase; color: #2a2a30;
  padding: 12px 28px;
  border-top: 4px double #0e0e10;
  border-bottom: 4px double #0e0e10;
  margin-bottom: 22px;
}
.ms-pp-p-title {
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 280px; line-height: .85;
  color: #0e0e10; letter-spacing: -.035em;
  text-shadow: 3px 3px 0 rgba(0,0,0,.06);
  white-space: nowrap;
}
.ms-pp-p-title .ms-pp-p-the {
  font-style: italic; font-weight: 400;
  font-size: 100px; vertical-align: 60px; margin-right: 18px;
  letter-spacing: 0;
}
.ms-pp-p-title .ms-pp-p-accent {
  color: #c8201e;
  text-decoration: underline;
  text-decoration-thickness: 8px;
  text-underline-offset: 18px;
  text-decoration-color: #c8201e;
}
.ms-pp-p-tagline {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 30px;
  letter-spacing: .34em; text-transform: uppercase; color: #5a5a62;
  margin-top: 24px;
}

/* ────────────────────────────────────────────────────────
   DATELINE RULE                 y 856–874, h 18
   ──────────────────────────────────────────────────────── */
.ms-pp-p-rule {
  position: absolute; left: 64px; right: 64px; top: 856px; height: 18px;
  z-index: 2;
  border-top: 8px solid #0e0e10;
  border-bottom: 2px solid #0e0e10;
}

/* ────────────────────────────────────────────────────────
   INDICIA STRIP                 y 894–954, h 60, inset 64
   ──────────────────────────────────────────────────────── */
.ms-pp-p-indicia {
  position: absolute; top: 894px; left: 64px; right: 64px; height: 60px;
  display: grid; grid-template-columns: auto 1fr auto auto auto;
  gap: 36px; align-items: center; z-index: 2; overflow: hidden;
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 28px;
  color: #2a2a30; letter-spacing: .12em;
}
.ms-pp-p-indicia .ms-pp-p-vol { font-weight: 700; color: #0e0e10; letter-spacing: .18em; }
.ms-pp-p-indicia .ms-pp-p-vol em { color: #c8201e; font-style: normal; font-weight: 700; }
.ms-pp-p-indicia .ms-pp-p-pipe { color: #5a5a62; }
.ms-pp-p-indicia .ms-pp-p-red { color: #c8201e; font-weight: 700; }
.ms-pp-p-indicia .ms-pp-p-date { font-weight: 500; }

/* ────────────────────────────────────────────────────────
   LEAD STORY                    y 974–2354, h 1380, inset 64
   ──────────────────────────────────────────────────────── */
.ms-pp-p-lead {
  position: absolute; top: 974px; left: 64px; right: 64px; height: 1380px;
  display: flex; flex-direction: column; z-index: 2; overflow: hidden;
  padding: 0;
}

.ms-pp-p-deptline {
  display: flex; align-items: center; gap: 24px; margin-bottom: 16px;
}
.ms-pp-p-deptline .ms-pp-p-swatch {
  width: 44px; height: 44px; background: #c8201e; flex-shrink: 0;
}
.ms-pp-p-deptline .ms-pp-p-label {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 32px;
  letter-spacing: .32em; text-transform: uppercase; color: #c8201e;
}
.ms-pp-p-deptline .ms-pp-p-pipe-line {
  flex: 1; height: 4px; background: #0e0e10;
}
.ms-pp-p-deptline .ms-pp-p-edition {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 28px;
  letter-spacing: .22em; text-transform: uppercase; color: #2a2a30;
}

.ms-pp-p-h1 {
  font-family: 'Playfair Display', serif; font-weight: 900;
  font-size: 296px; line-height: .86;
  color: #0e0e10; margin: 12px 0 22px;
  letter-spacing: -.035em;
}
.ms-pp-p-h1 em {
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; color: #c8201e; letter-spacing: -.025em;
}
.ms-pp-p-h1 .ms-pp-p-small {
  font-style: italic; font-weight: 400; font-size: 120px;
  color: #2a2a30; letter-spacing: -.01em; vertical-align: 50px;
  margin-right: 22px;
}

.ms-pp-p-deck {
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 400; font-size: 64px; line-height: 1.18;
  color: #2a2a30; margin: 0 0 24px;
  letter-spacing: -.005em;
}

.ms-pp-p-byline {
  display: flex; align-items: center; gap: 28px;
  padding: 16px 0;
  border-top: 3px solid #0e0e10;
  border-bottom: 1px solid #0e0e10;
  margin-bottom: 28px;
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 30px;
  color: #2a2a30; letter-spacing: .14em;
}
.ms-pp-p-byline b { color: #0e0e10; font-weight: 700; }
.ms-pp-p-byline em { color: #c8201e; font-style: normal; font-weight: 700; }
.ms-pp-p-byline .ms-pp-p-pipe { color: #5a5a62; }

/* Body: 2-col with the photo card sitting inside column 2 */
.ms-pp-p-body {
  display: grid; grid-template-columns: 1fr 1fr; gap: 44px;
  flex: 1;
  position: relative;
  overflow: hidden;
}
.ms-pp-p-body > .ms-pp-p-col {
  font-family: 'Source Serif 4', Georgia, serif;
  font-weight: 400; font-size: 42px; line-height: 1.32;
  color: #0e0e10; letter-spacing: 0;
  position: relative;
  padding-right: 32px;
  border-right: 2px solid #5a5a62;
  overflow: hidden;
}
.ms-pp-p-body > .ms-pp-p-col:last-child { border-right: 0; padding-right: 0; }
/* Drop cap on first column */
.ms-pp-p-body > .ms-pp-p-col.ms-pp-p-first::first-letter {
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 280px; line-height: .82;
  float: left;
  margin: 14px 22px -10px 0;
  color: #c8201e;
}
.ms-pp-p-body > .ms-pp-p-col.ms-pp-p-first p:first-of-type::first-line {
  font-family: 'Source Serif 4', serif; font-weight: 600;
  letter-spacing: .04em; text-transform: uppercase;
}
.ms-pp-p-body p { margin: 0 0 18px; }

/* Pull-quote — sits inside column 1 below the lede paragraphs */
.ms-pp-p-pullquote {
  margin-top: 22px;
  padding: 22px 0;
  border-top: 5px solid #0e0e10;
  border-bottom: 5px solid #0e0e10;
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 64px; line-height: 1.05;
  color: #0e0e10; letter-spacing: -.015em;
}
.ms-pp-p-pullquote .ms-pp-p-who {
  display: block;
  font-family: 'DM Mono', monospace; font-style: normal; font-weight: 500;
  font-size: 24px; letter-spacing: .26em; text-transform: uppercase;
  color: #c8201e; margin-top: 14px;
}

/* Halftone otter mascot photo card — placed inside column 2 */
.ms-pp-p-photo {
  background: #ebe1c4;
  border: 4px solid #0e0e10;
  padding: 22px 22px 16px;
  box-shadow: 10px 10px 0 #0e0e10;
  margin-top: 22px;
}
.ms-pp-p-photo .ms-pp-p-frame {
  position: relative;
  height: 380px;
  background: #0e0e10;
  overflow: hidden;
  background-image:
    radial-gradient(circle at 40% 35%, rgba(243,235,214,.78) 18%, transparent 19%),
    radial-gradient(rgba(255,255,255,.9) 1.6px, transparent 1.8px),
    radial-gradient(rgba(255,255,255,.6) 0.9px, transparent 1.1px);
  background-size: auto, 13px 13px, 8px 8px;
  background-position: 0 0, 0 0, 4px 3px;
}
.ms-pp-p-photo .ms-pp-p-frame::before {
  content: ''; position: absolute; bottom: 18px; left: 50%;
  width: 320px; height: 260px;
  transform: translateX(-50%);
  background:
    radial-gradient(ellipse 90px 100px at 50% 30%, rgba(40,30,20,.92) 70%, transparent 72%),
    radial-gradient(ellipse 140px 110px at 50% 80%, rgba(40,30,20,.92) 70%, transparent 72%);
}
.ms-pp-p-photo .ms-pp-p-frame::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,.06), transparent 60%);
}
.ms-pp-p-photo .ms-pp-p-caption {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 24px;
  line-height: 1.35; color: #2a2a30; letter-spacing: .02em;
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid #5a5a62;
}
.ms-pp-p-photo .ms-pp-p-caption b { color: #0e0e10; font-weight: 700; }

/* ────────────────────────────────────────────────────────
   INDEX SIDEBAR                 y 2374–3024, h 650, inset 64
   ──────────────────────────────────────────────────────── */
.ms-pp-p-sidebar {
  position: absolute; top: 2374px; left: 64px; right: 64px; height: 650px;
  background: #ebe1c4;
  border: 4px solid #0e0e10;
  box-shadow: 12px 12px 0 #0e0e10;
  padding: 28px 36px 24px;
  display: flex; flex-direction: column;
  z-index: 2; overflow: hidden;
}
.ms-pp-p-sidebar::before {
  content: ''; position: absolute; top: 0; right: 0;
  width: 70px; height: 70px;
  background: linear-gradient(225deg, #e2d6b1 50%, #0e0e10 50%);
  box-shadow: -2px 2px 0 #0e0e10;
}

.ms-pp-p-tochead {
  display: flex; align-items: baseline; justify-content: space-between;
  padding-bottom: 14px;
  border-bottom: 8px double #0e0e10;
  margin-bottom: 18px;
}
.ms-pp-p-tochead .ms-pp-p-h {
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 96px; line-height: 1;
  color: #0e0e10; letter-spacing: -.025em;
}
.ms-pp-p-tochead .ms-pp-p-h em { color: #c8201e; font-style: italic; }
.ms-pp-p-tochead .ms-pp-p-day {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 26px;
  letter-spacing: .26em; text-transform: uppercase; color: #2a2a30;
  text-align: right;
}

/* TOC list — 2-col grid for 7 schedule items */
.ms-pp-p-toc {
  display: grid; grid-template-columns: 1fr 1fr; column-gap: 36px; row-gap: 0;
  margin-bottom: 16px; flex: 1;
}
.ms-pp-p-row {
  display: grid; grid-template-columns: 78px 1fr auto;
  column-gap: 18px; align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed #5a5a62;
  position: relative;
  overflow: hidden;
}
.ms-pp-p-row.ms-pp-p-now {
  background: #0e0e10; color: #f3ebd6;
  margin: 4px -10px;
  padding: 10px 12px;
  border-bottom: 0;
}
.ms-pp-p-row.ms-pp-p-done { opacity: .55; }
.ms-pp-p-row .ms-pp-p-p {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 26px;
  color: #c8201e; letter-spacing: .08em; text-align: center;
  border: 3px solid #c8201e;
  padding: 4px 0;
  line-height: 1;
}
.ms-pp-p-row.ms-pp-p-now .ms-pp-p-p {
  color: #f3ebd6;
  background: #c8201e; border-color: #c8201e;
}
.ms-pp-p-row.ms-pp-p-done .ms-pp-p-p {
  color: #5a5a62; border-color: #5a5a62;
}
.ms-pp-p-row .ms-pp-p-what {
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 32px; color: #0e0e10; line-height: 1.05;
  letter-spacing: -.01em;
  overflow: hidden;
}
.ms-pp-p-row.ms-pp-p-now .ms-pp-p-what { color: #f3ebd6; }
.ms-pp-p-row .ms-pp-p-what span {
  display: block;
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 18px;
  color: #5a5a62; letter-spacing: .14em; text-transform: uppercase;
  margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ms-pp-p-row.ms-pp-p-now .ms-pp-p-what span { color: rgba(243,235,214,.7); }
.ms-pp-p-row .ms-pp-p-pg {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 22px;
  letter-spacing: .14em; color: #2a2a30;
  text-align: right;
  white-space: nowrap;
}
.ms-pp-p-row.ms-pp-p-now .ms-pp-p-pg { color: #f3ebd6; }

/* Stats footer — countdown + attendance */
.ms-pp-p-stats {
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
  margin-top: 12px;
  padding-top: 16px;
  border-top: 8px double #0e0e10;
}
.ms-pp-p-s {
  background: #f3ebd6;
  border: 3px solid #0e0e10;
  padding: 14px 20px;
  display: flex; flex-direction: column; gap: 4px;
  overflow: hidden;
}
.ms-pp-p-s.ms-pp-p-featured {
  background: #c8201e; color: #f3ebd6;
  border-color: #0e0e10;
}
.ms-pp-p-s .ms-pp-p-k {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 20px;
  letter-spacing: .22em; text-transform: uppercase; color: #2a2a30;
}
.ms-pp-p-s.ms-pp-p-featured .ms-pp-p-k { color: rgba(243,235,214,.85); }
.ms-pp-p-s .ms-pp-p-v {
  font-family: 'Playfair Display', serif; font-weight: 900;
  font-size: 80px; line-height: 1;
  color: #0e0e10; letter-spacing: -.03em;
}
.ms-pp-p-s .ms-pp-p-v em {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 22px;
  color: #5a5a62; font-style: normal;
  letter-spacing: .14em;
}
.ms-pp-p-s.ms-pp-p-featured .ms-pp-p-v { color: #f3ebd6; }
.ms-pp-p-s.ms-pp-p-featured .ms-pp-p-v em { color: rgba(243,235,214,.78); }
.ms-pp-p-s .ms-pp-p-sub {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 20px;
  color: #5a5a62; letter-spacing: .04em;
}
.ms-pp-p-s.ms-pp-p-featured .ms-pp-p-sub { color: rgba(243,235,214,.78); }

/* ────────────────────────────────────────────────────────
   DEPARTMENTS BAND              y 3044–3604, h 560, inset 64
   ──────────────────────────────────────────────────────── */
.ms-pp-p-depts {
  position: absolute; top: 3044px; left: 64px; right: 64px; height: 560px;
  display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 28px;
  z-index: 2; overflow: hidden;
}
.ms-pp-p-dept {
  background: #ebe1c4;
  border: 4px solid #0e0e10;
  box-shadow: 10px 10px 0 #0e0e10;
  padding: 22px 28px 20px;
  display: flex; flex-direction: column;
  position: relative;
  overflow: hidden;
}
.ms-pp-p-dept::before {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 8px;
  background: repeating-linear-gradient(45deg,
    #0e0e10 0 8px, transparent 8px 16px);
}

/* Department slug — broadsheet section header */
.ms-pp-p-dept .ms-pp-p-slug {
  display: grid; grid-template-columns: auto 1fr auto;
  column-gap: 16px; align-items: center;
  padding-bottom: 10px; border-bottom: 4px solid #0e0e10;
  margin-bottom: 14px;
}
.ms-pp-p-dept .ms-pp-p-slug .ms-pp-p-num {
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 56px; color: #c8201e;
  line-height: .9; letter-spacing: -.02em;
}
.ms-pp-p-dept .ms-pp-p-slug .ms-pp-p-name {
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 44px; line-height: .95; color: #0e0e10;
  letter-spacing: -.015em;
  overflow: hidden;
}
.ms-pp-p-dept .ms-pp-p-slug .ms-pp-p-name em {
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; color: #c8201e;
}
.ms-pp-p-dept .ms-pp-p-slug .ms-pp-p-meta {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 20px;
  letter-spacing: .2em; text-transform: uppercase; color: #2a2a30;
  text-align: right;
  white-space: nowrap;
}

/* DINING — menu */
.ms-pp-p-dept.ms-pp-p-dining .ms-pp-p-entree {
  font-family: 'Playfair Display', serif; font-weight: 900;
  font-size: 84px; line-height: .92; color: #0e0e10;
  letter-spacing: -.03em;
  margin-top: 8px;
}
.ms-pp-p-dept.ms-pp-p-dining .ms-pp-p-entree em {
  font-family: 'Playfair Display', serif; font-style: italic;
  color: #c8201e; font-weight: 900;
}
.ms-pp-p-dept.ms-pp-p-dining .ms-pp-p-sides {
  font-family: 'Source Serif 4', serif; font-weight: 400; font-style: italic;
  font-size: 32px; line-height: 1.25; color: #2a2a30;
  margin: 14px 0 16px; letter-spacing: 0;
}
.ms-pp-p-dept.ms-pp-p-dining .ms-pp-p-tags {
  display: flex; gap: 10px; flex-wrap: wrap;
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid #5a5a62;
}
.ms-pp-p-dept.ms-pp-p-dining .ms-pp-p-tags b {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 22px;
  background: #0e0e10; color: #f3ebd6;
  padding: 9px 16px; letter-spacing: .14em;
}
.ms-pp-p-dept.ms-pp-p-dining .ms-pp-p-tags b.ms-pp-p-red-tag { background: #c8201e; }

/* AFTER 3 / SEEN TODAY — list rows */
.ms-pp-p-dept .ms-pp-p-list { display: grid; gap: 10px; align-content: start; }
.ms-pp-p-dept .ms-pp-p-list .ms-pp-p-it {
  display: grid; grid-template-columns: 80px 1fr auto;
  column-gap: 18px; align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #5a5a62;
  overflow: hidden;
}
.ms-pp-p-dept .ms-pp-p-list .ms-pp-p-it:last-child { border-bottom: 0; }
.ms-pp-p-dept .ms-pp-p-list .ms-pp-p-it .ms-pp-p-ico {
  width: 72px; height: 72px;
  background: #f3ebd6;
  border: 4px solid #0e0e10;
  display: grid; place-items: center;
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 38px;
  color: #0e0e10; line-height: 1;
  box-shadow: 4px 4px 0 #0e0e10;
}
.ms-pp-p-dept .ms-pp-p-list .ms-pp-p-it .ms-pp-p-ico.ms-pp-p-ico-red { background: #c8201e; color: #f3ebd6; }
.ms-pp-p-dept .ms-pp-p-list .ms-pp-p-it .ms-pp-p-ico.ms-pp-p-ico-cream { background: #e2d6b1; }
.ms-pp-p-dept .ms-pp-p-list .ms-pp-p-it .ms-pp-p-info { overflow: hidden; }
.ms-pp-p-dept .ms-pp-p-list .ms-pp-p-it .ms-pp-p-info .ms-pp-p-t {
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 32px; line-height: 1.05; color: #0e0e10;
  letter-spacing: -.005em;
  overflow: hidden;
}
.ms-pp-p-dept .ms-pp-p-list .ms-pp-p-it .ms-pp-p-info .ms-pp-p-s-it {
  font-family: 'Source Serif 4', serif; font-weight: 400; font-style: italic;
  font-size: 22px; color: #2a2a30; margin-top: 3px;
  letter-spacing: 0;
  overflow: hidden;
}
.ms-pp-p-dept .ms-pp-p-list .ms-pp-p-it .ms-pp-p-when {
  font-family: 'Playfair Display', serif; font-weight: 900;
  font-size: 36px; color: #c8201e; letter-spacing: -.01em;
  line-height: 1; text-align: right;
  white-space: nowrap;
}
.ms-pp-p-dept .ms-pp-p-list .ms-pp-p-it .ms-pp-p-when small {
  display: block;
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 16px;
  letter-spacing: .14em; color: #5a5a62;
  margin-top: 5px;
}

/* ────────────────────────────────────────────────────────
   STOP-PRESS BULLETIN TICKER    y 3624–3764, h 140, inset 64
   ──────────────────────────────────────────────────────── */
.ms-pp-p-ticker {
  position: absolute; left: 64px; right: 64px; top: 3624px; height: 140px;
  background: #0e0e10; color: #f3ebd6;
  border: 4px solid #0e0e10;
  box-shadow: 10px 10px 0 #c8201e;
  display: grid; grid-template-columns: auto 1fr auto;
  align-items: stretch;
  overflow: hidden;
  z-index: 2;
}
.ms-pp-p-ticker .ms-pp-p-tag {
  background: #c8201e; color: #f3ebd6;
  padding: 0 36px;
  display: flex; align-items: center; gap: 18px;
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 56px; line-height: 1;
  letter-spacing: -.015em;
  border-right: 4px solid #0e0e10;
  flex-shrink: 0;
}
.ms-pp-p-ticker .ms-pp-p-tag::before {
  content: '★'; font-family: 'Source Serif 4', serif; font-style: normal;
  font-size: 48px; color: #f3ebd6;
}
.ms-pp-p-ticker .ms-pp-p-feed {
  overflow: hidden; display: flex; align-items: center;
  padding-left: 36px;
}
.ms-pp-p-ticker .ms-pp-p-feed-inner {
  display: flex; gap: 64px;
  font-family: 'DM Serif Display', serif; font-weight: 400;
  font-size: 52px; color: #f3ebd6; white-space: nowrap;
  letter-spacing: -.005em;
  animation: msPpPScroll 80s linear infinite;
}
.ms-pp-p-ticker .ms-pp-p-feed-inner span { display: inline-flex; align-items: center; gap: 28px; }
.ms-pp-p-ticker .ms-pp-p-feed-inner span::after {
  content: '§'; color: #c8201e; margin-left: 32px;
  font-family: 'Playfair Display', serif; font-style: italic;
  font-weight: 900; font-size: 48px;
}
.ms-pp-p-ticker .ms-pp-p-vol-end {
  background: #f3ebd6; color: #0e0e10;
  padding: 0 28px;
  display: flex; align-items: center;
  border-left: 4px solid #0e0e10;
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 26px;
  letter-spacing: .22em; text-transform: uppercase;
  white-space: nowrap;
  flex-shrink: 0;
}
@keyframes msPpPScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
`;
