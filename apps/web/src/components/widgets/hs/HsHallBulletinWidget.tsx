"use client";

/**
 * HsHallBulletinWidget — Editorial hallway "bulletin" board, 3840×2160.
 *
 * APPROVED 2026-05-07 — matches scratch/design/hs-district/hs-district-pack/hall-bulletin.html
 * Operator: "these need to be wired in for the highschools"
 *
 * Newspaper-front-page treatment for the corridor: a hand-set masthead,
 * editorial spotlight photo with a stamped "tickets" seal, two boxed
 * announcement cards (brand + dark), an after-school clubs index, a
 * full-period bell rail with the current period highlighted, and a
 * scrolling notices ticker. Designed to read at hallway distance and
 * survive the kid who stops three feet away with a granola bar.
 *
 * Editable widget regions wired through PropertiesPanel:
 *   - school          → seal initials + est line
 *   - masthead        → publication title + subtitle
 *   - issue           → issue label + date + volume line
 *   - clock           → "Right now" tile (label + live time)
 *   - bellnow         → "Period" tile (label + value)
 *   - weather         → "Outside" tile (label + temp)
 *   - countdown       → "Homecoming in" brand tile (label + value)
 *   - spotlight       → editorial hero (badge, stamp k/v/sub, where,
 *                       credit, eyebrow, headline, lede, 4 meta items)
 *   - ann1            → brand-color announcement card
 *   - ann2            → dark announcement card
 *   - clubs           → after-school grid (title + meta + 7 rows)
 *   - bell            → bell rail (label + day + 8 periods)
 *   - ticker          → bottom scrolling notices
 *
 * Every CSS class name from the source HTML is preserved. Pixel sizes
 * are FIXED at 3840×2160 — DO NOT regress to vw / %. The HsStage
 * transform:scale wrapper handles sizing for any container.
 */

import { HsStage } from './HsStage';
import { useHsLiveClock } from './useHsLiveClock';

export interface HsHallBulletinConfig {
  'school.initials'?: string;
  'school.est'?: string;
  'masthead.title'?: string;
  'masthead.sub'?: string;
  'issue.label'?: string;
  'issue.date'?: string;
  'issue.vol'?: string;
  'clock.label'?: string;
  'clock.time'?: string;
  'bellnow.label'?: string;
  'bellnow.value'?: string;
  'weather.label'?: string;
  'weather.temp'?: string;
  'countdown.label'?: string;
  'countdown.value'?: string;
  'spotlight.badge'?: string;
  'spotlight.stamp.k'?: string;
  'spotlight.stamp.v'?: string;
  'spotlight.stamp.sub'?: string;
  'spotlight.where'?: string;
  'spotlight.credit'?: string;
  'spotlight.eyebrow'?: string;
  'spotlight.headline'?: string;
  'spotlight.lede'?: string;
  'spotlight.meta1.k'?: string;
  'spotlight.meta1.v'?: string;
  'spotlight.meta2.k'?: string;
  'spotlight.meta2.v'?: string;
  'spotlight.meta3.k'?: string;
  'spotlight.meta3.v'?: string;
  'spotlight.meta4.k'?: string;
  'spotlight.meta4.v'?: string;
  'ann1.tag'?: string;
  'ann1.headline'?: string;
  'ann1.body'?: string;
  'ann1.when'?: string;
  'ann1.where'?: string;
  'ann2.tag'?: string;
  'ann2.headline'?: string;
  'ann2.body'?: string;
  'ann2.when'?: string;
  'ann2.where'?: string;
  'clubs.title'?: string;
  'clubs.meta'?: string;
  'clubs.0.n'?: string;
  'clubs.0.nm'?: string;
  'clubs.0.sub'?: string;
  'clubs.0.t'?: string;
  'clubs.0.r'?: string;
  'clubs.1.n'?: string;
  'clubs.1.nm'?: string;
  'clubs.1.sub'?: string;
  'clubs.1.t'?: string;
  'clubs.1.r'?: string;
  'clubs.2.n'?: string;
  'clubs.2.nm'?: string;
  'clubs.2.sub'?: string;
  'clubs.2.t'?: string;
  'clubs.2.r'?: string;
  'clubs.3.n'?: string;
  'clubs.3.nm'?: string;
  'clubs.3.sub'?: string;
  'clubs.3.t'?: string;
  'clubs.3.r'?: string;
  'clubs.4.n'?: string;
  'clubs.4.nm'?: string;
  'clubs.4.sub'?: string;
  'clubs.4.t'?: string;
  'clubs.4.r'?: string;
  'clubs.5.n'?: string;
  'clubs.5.nm'?: string;
  'clubs.5.sub'?: string;
  'clubs.5.t'?: string;
  'clubs.5.r'?: string;
  'clubs.6.n'?: string;
  'clubs.6.nm'?: string;
  'clubs.6.sub'?: string;
  'clubs.6.t'?: string;
  'clubs.6.r'?: string;
  'bell.label'?: string;
  'bell.day'?: string;
  'bell.0.p'?: string;
  'bell.0.n'?: string;
  'bell.0.t'?: string;
  'bell.1.p'?: string;
  'bell.1.n'?: string;
  'bell.1.t'?: string;
  'bell.2.p'?: string;
  'bell.2.n'?: string;
  'bell.2.t'?: string;
  'bell.3.p'?: string;
  'bell.3.n'?: string;
  'bell.3.t'?: string;
  'bell.4.p'?: string;
  'bell.4.n'?: string;
  'bell.4.t'?: string;
  'bell.5.p'?: string;
  'bell.5.n'?: string;
  'bell.5.t'?: string;
  'bell.6.p'?: string;
  'bell.6.n'?: string;
  'bell.6.t'?: string;
  'bell.7.p'?: string;
  'bell.7.n'?: string;
  'bell.7.t'?: string;
  'ticker.tag'?: string;
  'ticker.message'?: string;
  'ticker.message2'?: string;
}

export const DEFAULTS: Required<HsHallBulletinConfig> = {
  'school.initials': 'WHS',
  'school.est': 'EST. 1956',
  'masthead.title': 'The Bulletin',
  'masthead.sub': 'Westridge High · daily edition',
  'issue.label': 'Tuesday Morning',
  'issue.date': 'Oct. 14',
  'issue.vol': 'Vol. 68 · No. 41',
  'clock.label': 'Right now',
  'clock.time': '8:42',
  'bellnow.label': 'Period',
  'bellnow.value': '2nd',
  'weather.label': 'Outside · Sunny',
  'weather.temp': '61°',
  'countdown.label': 'Homecoming in',
  'countdown.value': '9 days',
  'spotlight.badge': "Today's spotlight",
  'spotlight.stamp.k': 'Tickets',
  'spotlight.stamp.v': '$8',
  'spotlight.stamp.sub': 'Cash · Card · GoFan',
  'spotlight.where': 'Performing arts theater',
  'spotlight.credit': 'Photo · L. Romero · Yearbook',
  'spotlight.eyebrow': 'Theater Department presents',
  'spotlight.headline': 'Our Town opens Friday — three nights only.',
  'spotlight.lede':
    "A full company of 28 student actors, six weeks of rehearsal, and a hand-painted New Hampshire skyline. Mr. Avila's senior cast closes the season with Thornton Wilder's American classic.",
  'spotlight.meta1.k': 'Curtain',
  'spotlight.meta1.v': '7:30 pm',
  'spotlight.meta2.k': 'Run time',
  'spotlight.meta2.v': '2h 10m',
  'spotlight.meta3.k': 'Director',
  'spotlight.meta3.v': 'D. Avila',
  'spotlight.meta4.k': 'Tickets',
  'spotlight.meta4.v': 'whs.gofan',
  'ann1.tag': 'Breaking · this week',
  'ann1.headline': 'Senior cap-and-gown orders close Friday at 3 pm.',
  'ann1.body':
    'Last call. Order forms are with Ms. Patel in the front office, or scan the QR poster outside the counseling suite. Late orders add a $35 rush fee.',
  'ann1.when': 'Fri · Oct 17 · 3:00 pm',
  'ann1.where': '· Front office, Rm 102',
  'ann2.tag': 'From the Principal',
  'ann2.headline': 'Late-bus passes back online — sign up by 9:00 am.',
  'ann2.body':
    'Activity buses resume their full schedule today. Grab a pass from your coach or club advisor by first period; routes load curbside at 5:45.',
  'ann2.when': 'Daily · M–Th',
  'ann2.where': '· Curb · Door 7',
  'clubs.title': 'Today after school',
  'clubs.meta': '12 clubs · 4 sports',
  'clubs.0.n': '01',
  'clubs.0.nm': 'Robotics — build night',
  'clubs.0.sub': 'Coach Reyes · all grades welcome',
  'clubs.0.t': '3:30 — 6:00',
  'clubs.0.r': 'Eng. lab · 214',
  'clubs.1.n': '02',
  'clubs.1.nm': 'Model UN',
  'clubs.1.sub': 'Position-paper workshop · Berlin committee',
  'clubs.1.t': '3:15 — 4:45',
  'clubs.1.r': 'Library · the round room',
  'clubs.2.n': '03',
  'clubs.2.nm': 'Black Student Union',
  'clubs.2.sub': 'Open mic prep · sign up at the door',
  'clubs.2.t': '3:30 — 5:00',
  'clubs.2.r': 'Black box · Rm 118',
  'clubs.3.n': '04',
  'clubs.3.nm': 'Math Team',
  'clubs.3.sub': 'AMC tune-up · pizza on Mr. Han',
  'clubs.3.t': '3:30 — 5:00',
  'clubs.3.r': 'Rm 232',
  'clubs.4.n': '05',
  'clubs.4.nm': 'GSA',
  'clubs.4.sub': 'Spirit-week sign making · all are welcome',
  'clubs.4.t': '3:15 — 4:30',
  'clubs.4.r': 'Rm 309',
  'clubs.5.n': '06',
  'clubs.5.nm': 'Jazz Band',
  'clubs.5.sub': 'Sectionals · trumpets & rhythm',
  'clubs.5.t': '3:30 — 5:30',
  'clubs.5.r': 'Band room',
  'clubs.6.n': '07',
  'clubs.6.nm': 'Yearbook',
  'clubs.6.sub': 'Senior portraits make-up day',
  'clubs.6.t': '3:00 — 6:00',
  'clubs.6.r': 'Rm 245 · studio',
  'bell.label': "Today's bells",
  'bell.day': 'A · regular',
  'bell.0.p': 'P1',
  'bell.0.n': 'Period 1',
  'bell.0.t': '7:50–8:38',
  'bell.1.p': 'P2 · now',
  'bell.1.n': 'Period 2',
  'bell.1.t': '8:42–9:30',
  'bell.2.p': 'P3',
  'bell.2.n': 'Period 3',
  'bell.2.t': '9:34–10:22',
  'bell.3.p': 'P4',
  'bell.3.n': 'Advisory',
  'bell.3.t': '10:26–10:54',
  'bell.4.p': 'P5',
  'bell.4.n': 'Lunch A',
  'bell.4.t': '10:58–11:34',
  'bell.5.p': 'P6',
  'bell.5.n': 'Period 4',
  'bell.5.t': '11:38–12:26',
  'bell.6.p': 'P7',
  'bell.6.n': 'Period 5',
  'bell.6.t': '12:30–1:18',
  'bell.7.p': 'P8',
  'bell.7.n': 'Period 6',
  'bell.7.t': '1:22–2:30',
  'ticker.tag': 'In other news',
  'ticker.message':
    'Picture-day retakes Thursday in the gym lobby · Varsity volleyball at Lakeside 6 pm — fan bus loads at 4:45 · FAFSA help every Tuesday in the counseling suite · Lost & found cleared Friday — claim your hoodie · Senior class meeting Wednesday during advisory · Library extended hours through midterms — open till 5',
  'ticker.message2':
    'Picture-day retakes Thursday in the gym lobby · Varsity volleyball at Lakeside 6 pm — fan bus loads at 4:45 · FAFSA help every Tuesday in the counseling suite · Lost & found cleared Friday — claim your hoodie · Senior class meeting Wednesday during advisory · Library extended hours through midterms — open till 5',
};

const PRE: React.CSSProperties = { whiteSpace: 'pre-wrap' as const };

export function HsHallBulletinWidget({ config, live }: { config?: HsHallBulletinConfig; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsHallBulletinConfig>;
  // Live "Right now" clock — operator override wins. Replaces the hardcoded
  // "8:42" placeholder so each demo wall shows real time.
  const now = useHsLiveClock(live !== false);
  const liveClock = c['clock.time'] === DEFAULTS['clock.time']
    ? now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : c['clock.time'];

  return (
    <HsStage stageStyle={{ background: '#f4ede0', color: '#161310', fontFamily: "'Inter', sans-serif" }}>
      <style>{CSS}</style>
      {/* Paper grain overlay (matches stage::before in the mockup) */}
      <div className="hs-bull-grain" />

      {/* MASTHEAD */}
      <header className="hs-bull-mast">
        <div className="hs-bull-mast-left">
          <div className="hs-bull-seal">
            <div>
              <span data-field="school.initials" style={PRE}>{c['school.initials']}</span>
              <span className="hs-bull-seal-est" data-field="school.est" style={PRE}>{c['school.est']}</span>
            </div>
          </div>
          <h1 className="hs-bull-title">
            <span data-field="masthead.title" style={PRE}>{c['masthead.title']}</span>
            <span className="hs-bull-title-sub" data-field="masthead.sub" style={PRE}>{c['masthead.sub']}</span>
          </h1>
        </div>
        <div className="hs-bull-mast-right">
          <div className="hs-bull-issue" data-field="issue.label" style={PRE}>{c['issue.label']}</div>
          <div className="hs-bull-date" data-field="issue.date" style={PRE}>{c['issue.date']}</div>
          <div className="hs-bull-vol" data-field="issue.vol" style={PRE}>{c['issue.vol']}</div>
        </div>
      </header>

      <div className="hs-bull-fold" />

      {/* TOP CHIPS */}
      <section className="hs-bull-chips">
        <div className="hs-bull-chip hs-bull-chip-lit">
          <div className="hs-bull-chip-k" data-field="clock.label" style={PRE}>{c['clock.label']}</div>
          <div className="hs-bull-chip-v hs-bull-chip-dot" data-field="clock.time" style={PRE}>{liveClock}</div>
        </div>
        <div className="hs-bull-chip">
          <div className="hs-bull-chip-k" data-field="bellnow.label" style={PRE}>{c['bellnow.label']}</div>
          <div className="hs-bull-chip-v" data-field="bellnow.value" style={PRE}>{c['bellnow.value']}</div>
        </div>
        <div className="hs-bull-chip">
          <div className="hs-bull-chip-k" data-field="weather.label" style={PRE}>{c['weather.label']}</div>
          <div className="hs-bull-chip-v" data-field="weather.temp" style={PRE}>{c['weather.temp']}</div>
        </div>
        <div className="hs-bull-chip hs-bull-chip-brand">
          <div className="hs-bull-chip-k" data-field="countdown.label" style={PRE}>{c['countdown.label']}</div>
          <div className="hs-bull-chip-v" data-field="countdown.value" style={PRE}>{c['countdown.value']}</div>
        </div>
      </section>

      {/* HERO SPOTLIGHT */}
      <article className="hs-bull-hero">
        <div className="hs-bull-photo">
          <div className="hs-bull-badge">
            <span data-field="spotlight.badge" style={PRE}>{c['spotlight.badge']}</span>
          </div>
          <div className="hs-bull-stamp">
            <div>
              <span data-field="spotlight.stamp.k" style={PRE}>{c['spotlight.stamp.k']}</span>
              <span className="hs-bull-stamp-big" data-field="spotlight.stamp.v" style={PRE}>{c['spotlight.stamp.v']}</span>
              <span data-field="spotlight.stamp.sub" style={PRE}>{c['spotlight.stamp.sub']}</span>
            </div>
          </div>
          <div className="hs-bull-caption-floor">
            <div className="hs-bull-pill" data-field="spotlight.where" style={PRE}>{c['spotlight.where']}</div>
            <div className="hs-bull-pill" data-field="spotlight.credit" style={PRE}>{c['spotlight.credit']}</div>
          </div>
        </div>
        <div className="hs-bull-body">
          <div className="hs-bull-eyebrow">
            <span data-field="spotlight.eyebrow" style={PRE}>{c['spotlight.eyebrow']}</span>
          </div>
          <h1 className="hs-bull-h1" data-field="spotlight.headline" style={PRE}>{c['spotlight.headline']}</h1>
          <p className="hs-bull-lede" data-field="spotlight.lede" style={PRE}>{c['spotlight.lede']}</p>
          <div className="hs-bull-meta">
            <div className="hs-bull-meta-it">
              <div className="hs-bull-meta-k" data-field="spotlight.meta1.k" style={PRE}>{c['spotlight.meta1.k']}</div>
              <div className="hs-bull-meta-v" data-field="spotlight.meta1.v" style={PRE}>{c['spotlight.meta1.v']}</div>
            </div>
            <div className="hs-bull-meta-it">
              <div className="hs-bull-meta-k" data-field="spotlight.meta2.k" style={PRE}>{c['spotlight.meta2.k']}</div>
              <div className="hs-bull-meta-v" data-field="spotlight.meta2.v" style={PRE}>{c['spotlight.meta2.v']}</div>
            </div>
            <div className="hs-bull-meta-it">
              <div className="hs-bull-meta-k" data-field="spotlight.meta3.k" style={PRE}>{c['spotlight.meta3.k']}</div>
              <div className="hs-bull-meta-v" data-field="spotlight.meta3.v" style={PRE}>{c['spotlight.meta3.v']}</div>
            </div>
            <div className="hs-bull-meta-it">
              <div className="hs-bull-meta-k" data-field="spotlight.meta4.k" style={PRE}>{c['spotlight.meta4.k']}</div>
              <div className="hs-bull-meta-v hs-bull-meta-v-brand" data-field="spotlight.meta4.v" style={PRE}>{c['spotlight.meta4.v']}</div>
            </div>
          </div>
        </div>
      </article>

      {/* RIGHT COLUMN */}
      <aside className="hs-bull-col">
        <div className="hs-bull-ann hs-bull-ann-brand">
          <div className="hs-bull-ann-tag" data-field="ann1.tag" style={PRE}>{c['ann1.tag']}</div>
          <h2 className="hs-bull-ann-h2" data-field="ann1.headline" style={PRE}>{c['ann1.headline']}</h2>
          <p className="hs-bull-ann-p" data-field="ann1.body" style={PRE}>{c['ann1.body']}</p>
          <div className="hs-bull-ann-when">
            <span data-field="ann1.when" style={PRE}>{c['ann1.when']}</span>
            <span className="hs-bull-ann-where" data-field="ann1.where" style={PRE}>{c['ann1.where']}</span>
          </div>
        </div>

        <div className="hs-bull-ann hs-bull-ann-dark">
          <div className="hs-bull-ann-tag" data-field="ann2.tag" style={PRE}>{c['ann2.tag']}</div>
          <h2 className="hs-bull-ann-h2" data-field="ann2.headline" style={PRE}>{c['ann2.headline']}</h2>
          <p className="hs-bull-ann-p" data-field="ann2.body" style={PRE}>{c['ann2.body']}</p>
          <div className="hs-bull-ann-when">
            <span data-field="ann2.when" style={PRE}>{c['ann2.when']}</span>
            <span className="hs-bull-ann-where" data-field="ann2.where" style={PRE}>{c['ann2.where']}</span>
          </div>
        </div>

        <div className="hs-bull-clubs">
          <div className="hs-bull-clubs-hdr">
            <h3 className="hs-bull-clubs-h3" data-field="clubs.title" style={PRE}>{c['clubs.title']}</h3>
            <div className="hs-bull-clubs-meta" data-field="clubs.meta" style={PRE}>{c['clubs.meta']}</div>
          </div>
          <ul className="hs-bull-clubs-ul">
            <li className="hs-bull-clubs-li">
              <div className="hs-bull-clubs-n" data-field="clubs.0.n" style={PRE}>{c['clubs.0.n']}</div>
              <div className="hs-bull-clubs-nm">
                <span data-field="clubs.0.nm" style={PRE}>{c['clubs.0.nm']}</span>
                <span className="hs-bull-clubs-sub" data-field="clubs.0.sub" style={PRE}>{c['clubs.0.sub']}</span>
              </div>
              <div className="hs-bull-clubs-when">
                <span data-field="clubs.0.t" style={PRE}>{c['clubs.0.t']}</span>
                <span className="hs-bull-clubs-rm" data-field="clubs.0.r" style={PRE}>{c['clubs.0.r']}</span>
              </div>
            </li>
            <li className="hs-bull-clubs-li">
              <div className="hs-bull-clubs-n" data-field="clubs.1.n" style={PRE}>{c['clubs.1.n']}</div>
              <div className="hs-bull-clubs-nm">
                <span data-field="clubs.1.nm" style={PRE}>{c['clubs.1.nm']}</span>
                <span className="hs-bull-clubs-sub" data-field="clubs.1.sub" style={PRE}>{c['clubs.1.sub']}</span>
              </div>
              <div className="hs-bull-clubs-when">
                <span data-field="clubs.1.t" style={PRE}>{c['clubs.1.t']}</span>
                <span className="hs-bull-clubs-rm" data-field="clubs.1.r" style={PRE}>{c['clubs.1.r']}</span>
              </div>
            </li>
            <li className="hs-bull-clubs-li">
              <div className="hs-bull-clubs-n" data-field="clubs.2.n" style={PRE}>{c['clubs.2.n']}</div>
              <div className="hs-bull-clubs-nm">
                <span data-field="clubs.2.nm" style={PRE}>{c['clubs.2.nm']}</span>
                <span className="hs-bull-clubs-sub" data-field="clubs.2.sub" style={PRE}>{c['clubs.2.sub']}</span>
              </div>
              <div className="hs-bull-clubs-when">
                <span data-field="clubs.2.t" style={PRE}>{c['clubs.2.t']}</span>
                <span className="hs-bull-clubs-rm" data-field="clubs.2.r" style={PRE}>{c['clubs.2.r']}</span>
              </div>
            </li>
            <li className="hs-bull-clubs-li">
              <div className="hs-bull-clubs-n" data-field="clubs.3.n" style={PRE}>{c['clubs.3.n']}</div>
              <div className="hs-bull-clubs-nm">
                <span data-field="clubs.3.nm" style={PRE}>{c['clubs.3.nm']}</span>
                <span className="hs-bull-clubs-sub" data-field="clubs.3.sub" style={PRE}>{c['clubs.3.sub']}</span>
              </div>
              <div className="hs-bull-clubs-when">
                <span data-field="clubs.3.t" style={PRE}>{c['clubs.3.t']}</span>
                <span className="hs-bull-clubs-rm" data-field="clubs.3.r" style={PRE}>{c['clubs.3.r']}</span>
              </div>
            </li>
            <li className="hs-bull-clubs-li">
              <div className="hs-bull-clubs-n" data-field="clubs.4.n" style={PRE}>{c['clubs.4.n']}</div>
              <div className="hs-bull-clubs-nm">
                <span data-field="clubs.4.nm" style={PRE}>{c['clubs.4.nm']}</span>
                <span className="hs-bull-clubs-sub" data-field="clubs.4.sub" style={PRE}>{c['clubs.4.sub']}</span>
              </div>
              <div className="hs-bull-clubs-when">
                <span data-field="clubs.4.t" style={PRE}>{c['clubs.4.t']}</span>
                <span className="hs-bull-clubs-rm" data-field="clubs.4.r" style={PRE}>{c['clubs.4.r']}</span>
              </div>
            </li>
            <li className="hs-bull-clubs-li">
              <div className="hs-bull-clubs-n" data-field="clubs.5.n" style={PRE}>{c['clubs.5.n']}</div>
              <div className="hs-bull-clubs-nm">
                <span data-field="clubs.5.nm" style={PRE}>{c['clubs.5.nm']}</span>
                <span className="hs-bull-clubs-sub" data-field="clubs.5.sub" style={PRE}>{c['clubs.5.sub']}</span>
              </div>
              <div className="hs-bull-clubs-when">
                <span data-field="clubs.5.t" style={PRE}>{c['clubs.5.t']}</span>
                <span className="hs-bull-clubs-rm" data-field="clubs.5.r" style={PRE}>{c['clubs.5.r']}</span>
              </div>
            </li>
            <li className="hs-bull-clubs-li">
              <div className="hs-bull-clubs-n" data-field="clubs.6.n" style={PRE}>{c['clubs.6.n']}</div>
              <div className="hs-bull-clubs-nm">
                <span data-field="clubs.6.nm" style={PRE}>{c['clubs.6.nm']}</span>
                <span className="hs-bull-clubs-sub" data-field="clubs.6.sub" style={PRE}>{c['clubs.6.sub']}</span>
              </div>
              <div className="hs-bull-clubs-when">
                <span data-field="clubs.6.t" style={PRE}>{c['clubs.6.t']}</span>
                <span className="hs-bull-clubs-rm" data-field="clubs.6.r" style={PRE}>{c['clubs.6.r']}</span>
              </div>
            </li>
          </ul>
        </div>
      </aside>

      {/* BELL RAIL */}
      <section className="hs-bull-rail">
        <div className="hs-bull-rail-lbl">
          <div className="hs-bull-rail-k" data-field="bell.label" style={PRE}>{c['bell.label']}</div>
          <div className="hs-bull-rail-v" data-field="bell.day" style={PRE}>{c['bell.day']}</div>
        </div>
        <ul className="hs-bull-rail-ul">
          <li className="hs-bull-rail-li">
            <div className="hs-bull-rail-p" data-field="bell.0.p" style={PRE}>{c['bell.0.p']}</div>
            <div className="hs-bull-rail-nm" data-field="bell.0.n" style={PRE}>{c['bell.0.n']}</div>
            <div className="hs-bull-rail-t" data-field="bell.0.t" style={PRE}>{c['bell.0.t']}</div>
          </li>
          <li className="hs-bull-rail-li hs-bull-rail-now">
            <div className="hs-bull-rail-p" data-field="bell.1.p" style={PRE}>{c['bell.1.p']}</div>
            <div className="hs-bull-rail-nm" data-field="bell.1.n" style={PRE}>{c['bell.1.n']}</div>
            <div className="hs-bull-rail-t" data-field="bell.1.t" style={PRE}>{c['bell.1.t']}</div>
          </li>
          <li className="hs-bull-rail-li">
            <div className="hs-bull-rail-p" data-field="bell.2.p" style={PRE}>{c['bell.2.p']}</div>
            <div className="hs-bull-rail-nm" data-field="bell.2.n" style={PRE}>{c['bell.2.n']}</div>
            <div className="hs-bull-rail-t" data-field="bell.2.t" style={PRE}>{c['bell.2.t']}</div>
          </li>
          <li className="hs-bull-rail-li">
            <div className="hs-bull-rail-p" data-field="bell.3.p" style={PRE}>{c['bell.3.p']}</div>
            <div className="hs-bull-rail-nm" data-field="bell.3.n" style={PRE}>{c['bell.3.n']}</div>
            <div className="hs-bull-rail-t" data-field="bell.3.t" style={PRE}>{c['bell.3.t']}</div>
          </li>
          <li className="hs-bull-rail-li">
            <div className="hs-bull-rail-p" data-field="bell.4.p" style={PRE}>{c['bell.4.p']}</div>
            <div className="hs-bull-rail-nm" data-field="bell.4.n" style={PRE}>{c['bell.4.n']}</div>
            <div className="hs-bull-rail-t" data-field="bell.4.t" style={PRE}>{c['bell.4.t']}</div>
          </li>
          <li className="hs-bull-rail-li">
            <div className="hs-bull-rail-p" data-field="bell.5.p" style={PRE}>{c['bell.5.p']}</div>
            <div className="hs-bull-rail-nm" data-field="bell.5.n" style={PRE}>{c['bell.5.n']}</div>
            <div className="hs-bull-rail-t" data-field="bell.5.t" style={PRE}>{c['bell.5.t']}</div>
          </li>
          <li className="hs-bull-rail-li">
            <div className="hs-bull-rail-p" data-field="bell.6.p" style={PRE}>{c['bell.6.p']}</div>
            <div className="hs-bull-rail-nm" data-field="bell.6.n" style={PRE}>{c['bell.6.n']}</div>
            <div className="hs-bull-rail-t" data-field="bell.6.t" style={PRE}>{c['bell.6.t']}</div>
          </li>
          <li className="hs-bull-rail-li">
            <div className="hs-bull-rail-p" data-field="bell.7.p" style={PRE}>{c['bell.7.p']}</div>
            <div className="hs-bull-rail-nm" data-field="bell.7.n" style={PRE}>{c['bell.7.n']}</div>
            <div className="hs-bull-rail-t" data-field="bell.7.t" style={PRE}>{c['bell.7.t']}</div>
          </li>
        </ul>
      </section>

      {/* TICKER */}
      <div className="hs-bull-ticker">
        <div className="hs-bull-ticker-tag" data-field="ticker.tag" style={PRE}>{c['ticker.tag']}</div>
        <div className="hs-bull-ticker-msg">
          <span data-field="ticker.message" style={PRE}>{c['ticker.message']}</span>
          <span>&nbsp;&nbsp;<span className="hs-bull-ticker-star">★</span>&nbsp;&nbsp;</span>
          <span data-field="ticker.message2" style={PRE}>{c['ticker.message2']}</span>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — keeps every pixel value identical to scratch/design/hs-district/hs-district-pack/hall-bulletin.html. */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap');

.hs-bull-grain {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(1200px 800px at 18% 12%, rgba(0,0,0,.04), transparent 60%),
    radial-gradient(1400px 1000px at 85% 88%, rgba(0,0,0,.05), transparent 60%),
    repeating-linear-gradient(0deg, rgba(0,0,0,.018) 0 1px, transparent 1px 3px);
}

@keyframes hsBullBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: .25; } }
@keyframes hsBullScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }

.hs-bull-mast {
  position: absolute; top: 60px; left: 80px; right: 80px;
  display: flex; justify-content: space-between; align-items: flex-end;
  border-bottom: 6px solid #161310; padding-bottom: 24px; z-index: 4;
}
.hs-bull-mast-left { display: flex; align-items: flex-end; gap: 36px; }
.hs-bull-seal {
  width: 160px; height: 160px; background: #161310; color: #f4ede0;
  display: grid; place-items: center; text-align: center; line-height: 1;
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 64px; letter-spacing: -.01em;
}
.hs-bull-seal-est {
  display: block; font-family: 'JetBrains Mono', monospace; font-weight: 500;
  font-size: 28px; color: #caa14a; letter-spacing: .22em; margin-top: 8px;
}
.hs-bull-title {
  margin: 0;
  font-family: 'Fraunces', serif; font-weight: 900; font-style: italic;
  font-size: 200px; line-height: .85; letter-spacing: -.025em; color: #161310;
}
.hs-bull-title-sub {
  display: block; font-family: 'JetBrains Mono', monospace; font-style: normal;
  font-weight: 500; font-size: 30px; color: #b8331f; letter-spacing: .32em;
  text-transform: uppercase; margin-top: 14px;
}
.hs-bull-mast-right { display: flex; flex-direction: column; align-items: flex-end; gap: 14px; padding-bottom: 8px; }
.hs-bull-issue { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px; letter-spacing: .24em; color: #5a544a; text-transform: uppercase; }
.hs-bull-date { font-family: 'Fraunces', serif; font-weight: 900; font-size: 84px; line-height: .9; color: #161310; letter-spacing: -.01em; }
.hs-bull-vol { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 24px; letter-spacing: .2em; color: #5a544a; text-transform: uppercase; }

.hs-bull-fold {
  position: absolute; top: 300px; left: 80px; right: 80px; height: 6px; background: #161310; z-index: 2;
}
.hs-bull-fold::before, .hs-bull-fold::after {
  content: ''; position: absolute; top: -7px; width: 20px; height: 20px;
  background: #b8331f; border-radius: 50%;
}
.hs-bull-fold::before { left: -10px; }
.hs-bull-fold::after { right: -10px; }

.hs-bull-chips {
  position: absolute; top: 340px; left: 80px; right: 80px;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; z-index: 3;
}
.hs-bull-chip {
  background: #ebe1cf; border: 3px solid #161310; padding: 24px 32px;
  display: flex; align-items: center; justify-content: space-between; gap: 24px;
}
.hs-bull-chip-k { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px; letter-spacing: .22em; text-transform: uppercase; color: #5a544a; line-height: 1; }
.hs-bull-chip-v { font-family: 'Fraunces', serif; font-weight: 900; font-size: 96px; line-height: 1; color: #161310; letter-spacing: -.02em; white-space: nowrap; }
.hs-bull-chip-lit { background: #161310; border-color: #161310; }
.hs-bull-chip-lit .hs-bull-chip-k { color: #caa14a; }
.hs-bull-chip-lit .hs-bull-chip-v { color: #f4ede0; }
.hs-bull-chip-brand { background: #b8331f; border-color: #7a1f12; }
.hs-bull-chip-brand .hs-bull-chip-k { color: rgba(255,255,255,.7); }
.hs-bull-chip-brand .hs-bull-chip-v { color: #fff; }
.hs-bull-chip-dot::after {
  content: ''; display: inline-block; width: 18px; height: 18px;
  background: #b8331f; border-radius: 50%; margin-left: 14px;
  vertical-align: middle; animation: hsBullBlink 1.4s steps(2) infinite;
}

.hs-bull-hero {
  position: absolute; top: 560px; left: 80px; width: 2280px; height: 1240px;
  background: #fff; border: 3px solid #161310; display: flex; flex-direction: column; z-index: 3;
}
.hs-bull-photo {
  flex: 1; background: linear-gradient(135deg, #3d2a1e 0%, #7a4a2a 50%, #a8703a 100%);
  position: relative; overflow: hidden; border-bottom: 3px solid #161310;
}
.hs-bull-photo::before {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(45deg, transparent 0 80px, rgba(255,255,255,.04) 80px 82px);
}
.hs-bull-photo::after {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(ellipse 1400px 800px at 30% 40%, rgba(255,236,196,.18), transparent 60%);
}
.hs-bull-badge {
  position: absolute; top: 32px; left: 32px; background: #b8331f; color: #fff;
  padding: 14px 28px; font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 30px; letter-spacing: .22em; text-transform: uppercase;
  display: flex; align-items: center; gap: 14px; z-index: 2;
}
.hs-bull-badge::before {
  content: ''; width: 18px; height: 18px; background: #fff;
  border-radius: 50%; animation: hsBullBlink 1.4s steps(2) infinite;
}
.hs-bull-stamp {
  position: absolute; top: 48px; right: 48px; width: 240px; height: 240px;
  border: 6px solid #fff; border-radius: 50%; display: grid; place-items: center;
  text-align: center; color: #fff; font-family: 'JetBrains Mono', monospace;
  font-weight: 700; line-height: 1.05; font-size: 30px; letter-spacing: .16em;
  text-transform: uppercase; transform: rotate(-8deg);
  background: rgba(184,51,31,.4); backdrop-filter: blur(2px); z-index: 2;
}
.hs-bull-stamp-big {
  font-family: 'Fraunces', serif; font-weight: 900; font-style: italic;
  font-size: 88px; line-height: 1; letter-spacing: -.02em;
  display: block; margin: 6px 0 10px; text-transform: none;
}
.hs-bull-caption-floor {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; align-items: flex-end; justify-content: space-between;
  padding: 32px 40px; background: linear-gradient(0deg, rgba(0,0,0,.55), transparent);
  color: #fff; z-index: 2;
}
.hs-bull-pill {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .22em; text-transform: uppercase;
  background: #fff; color: #161310; padding: 8px 18px;
}

.hs-bull-body { padding: 48px 56px 56px; display: flex; flex-direction: column; gap: 18px; }
.hs-bull-eyebrow {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px;
  letter-spacing: .32em; text-transform: uppercase; color: #b8331f;
  display: flex; align-items: center; gap: 18px;
}
.hs-bull-eyebrow::before, .hs-bull-eyebrow::after {
  content: ''; height: 3px; flex: 0 0 60px; background: #b8331f;
}
.hs-bull-eyebrow::after { flex: 1; }
.hs-bull-h1 {
  margin: 0; font-family: 'Fraunces', serif; font-weight: 900; font-style: italic;
  font-size: 200px; line-height: .85; letter-spacing: -.03em; color: #161310;
}
.hs-bull-lede {
  font-family: 'Fraunces', serif; font-weight: 700; font-size: 48px;
  line-height: 1.2; color: #5a544a; max-width: 2000px; margin: 0;
}
.hs-bull-meta { display: flex; gap: 48px; margin-top: 8px; border-top: 3px solid #161310; padding-top: 24px; }
.hs-bull-meta-it { display: flex; flex-direction: column; gap: 4px; }
.hs-bull-meta-k { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px; letter-spacing: .22em; text-transform: uppercase; color: #5a544a; }
.hs-bull-meta-v { font-family: 'Fraunces', serif; font-weight: 900; font-size: 48px; line-height: 1; color: #161310; letter-spacing: -.01em; }
.hs-bull-meta-v-brand { color: #b8331f; }

.hs-bull-col {
  position: absolute; top: 560px; right: 80px; width: 1340px; height: 1240px;
  display: flex; flex-direction: column; gap: 24px; z-index: 3;
}

.hs-bull-ann { background: #fff; border: 3px solid #161310; padding: 32px 36px; position: relative; flex: 0 0 auto; }
.hs-bull-ann-dark { background: #161310; color: #f4ede0; border-color: #161310; }
.hs-bull-ann-brand { background: #b8331f; color: #fff; border-color: #7a1f12; }
.hs-bull-ann-tag {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .24em; text-transform: uppercase; color: #b8331f;
  display: inline-flex; align-items: center; gap: 14px; margin-bottom: 16px;
}
.hs-bull-ann-dark .hs-bull-ann-tag { color: #caa14a; }
.hs-bull-ann-brand .hs-bull-ann-tag { color: #ffd9b3; }
.hs-bull-ann-tag::before { content: ''; width: 36px; height: 6px; background: currentColor; }
.hs-bull-ann-h2 {
  margin: 0; font-family: 'Fraunces', serif; font-weight: 900; font-style: italic;
  font-size: 88px; line-height: .9; letter-spacing: -.02em; color: inherit;
}
.hs-bull-ann-p {
  margin: 18px 0 0; font-family: 'Inter', sans-serif; font-weight: 500;
  font-size: 28px; line-height: 1.35; color: #5a544a;
}
.hs-bull-ann-dark .hs-bull-ann-p { color: rgba(244,237,224,.78); }
.hs-bull-ann-brand .hs-bull-ann-p { color: rgba(255,255,255,.85); }
.hs-bull-ann-when {
  margin-top: 18px; display: flex; gap: 24px; align-items: center;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .18em; text-transform: uppercase; color: #161310;
}
.hs-bull-ann-dark .hs-bull-ann-when { color: #caa14a; }
.hs-bull-ann-brand .hs-bull-ann-when { color: #fff; }
.hs-bull-ann-where { color: #5a544a; }
.hs-bull-ann-dark .hs-bull-ann-where { color: rgba(244,237,224,.6); }
.hs-bull-ann-brand .hs-bull-ann-where { color: rgba(255,255,255,.7); }

.hs-bull-clubs { flex: 1; background: #fff; border: 3px solid #161310; padding: 28px 32px; display: flex; flex-direction: column; }
.hs-bull-clubs-hdr { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 3px solid #161310; padding-bottom: 14px; margin-bottom: 14px; }
.hs-bull-clubs-h3 { margin: 0; font-family: 'Fraunces', serif; font-weight: 900; font-style: italic; font-size: 60px; line-height: 1; color: #161310; letter-spacing: -.02em; }
.hs-bull-clubs-meta { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px; letter-spacing: .22em; text-transform: uppercase; color: #5a544a; }
.hs-bull-clubs-ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; flex: 1; }
.hs-bull-clubs-li {
  display: grid; grid-template-columns: 88px 1fr auto; align-items: center;
  gap: 18px; padding: 14px 0; border-bottom: 1px dashed #d8cdb6;
}
.hs-bull-clubs-li:last-child { border-bottom: 0; }
.hs-bull-clubs-n { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px; color: #b8331f; letter-spacing: .18em; }
.hs-bull-clubs-nm { font-family: 'Fraunces', serif; font-weight: 900; font-size: 36px; line-height: 1.05; color: #161310; letter-spacing: -.01em; }
.hs-bull-clubs-sub { display: block; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 30px; color: #5a544a; letter-spacing: 0; margin-top: 2px; }
.hs-bull-clubs-when { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px; letter-spacing: .18em; color: #161310; text-transform: uppercase; text-align: right; white-space: nowrap; }
.hs-bull-clubs-rm { display: block; color: #5a544a; font-weight: 500; margin-top: 2px; }

.hs-bull-rail {
  position: absolute; left: 80px; right: 80px; bottom: 160px; height: 200px;
  background: #161310; color: #f4ede0; display: flex; align-items: stretch;
  border: 3px solid #161310; z-index: 3;
}
.hs-bull-rail-lbl { flex: 0 0 320px; background: #b8331f; display: flex; flex-direction: column; justify-content: center; padding: 0 36px; color: #fff; }
.hs-bull-rail-k { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px; letter-spacing: .22em; text-transform: uppercase; color: #ffd9b3; }
.hs-bull-rail-v { font-family: 'Fraunces', serif; font-weight: 900; font-style: italic; font-size: 72px; line-height: .9; color: #fff; margin-top: 4px; letter-spacing: -.02em; }
.hs-bull-rail-ul { flex: 1; list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(8, 1fr); }
.hs-bull-rail-li {
  position: relative; display: flex; flex-direction: column; justify-content: center;
  padding: 0 24px; border-right: 1px solid rgba(244,237,224,.15);
}
.hs-bull-rail-li:last-child { border-right: 0; }
.hs-bull-rail-now { background: rgba(202,161,74,.15); }
.hs-bull-rail-now::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 6px; background: #caa14a; }
.hs-bull-rail-p { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px; letter-spacing: .22em; text-transform: uppercase; color: #caa14a; }
.hs-bull-rail-nm { font-family: 'Fraunces', serif; font-weight: 900; font-size: 36px; line-height: 1; color: #f4ede0; margin-top: 4px; letter-spacing: -.01em; }
.hs-bull-rail-t { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 30px; color: rgba(244,237,224,.65); margin-top: 4px; letter-spacing: .06em; }
.hs-bull-rail-now .hs-bull-rail-nm { color: #fff; }
.hs-bull-rail-now .hs-bull-rail-t { color: #caa14a; }

.hs-bull-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 80px;
  background: #161310; color: #f4ede0; display: flex; align-items: center;
  overflow: hidden; z-index: 5; border-top: 6px solid #b8331f;
}
.hs-bull-ticker-tag {
  flex: 0 0 auto; background: #b8331f; color: #fff;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px;
  padding: 0 36px; height: 100%; display: flex; align-items: center;
  letter-spacing: .22em; text-transform: uppercase;
}
.hs-bull-ticker-msg {
  font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 28px;
  padding-left: 36px; white-space: nowrap; letter-spacing: .18em;
  text-transform: uppercase; color: #f4ede0;
  animation: hsBullScroll 80s linear infinite;
}
.hs-bull-ticker-star { color: #caa14a; margin: 0 18px; }
`;
