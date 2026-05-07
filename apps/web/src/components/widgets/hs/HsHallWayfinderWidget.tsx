"use client";

/**
 * HsHallWayfinderWidget — Airport-style departure directory for the
 * hallway, 3840×2160.
 *
 * APPROVED 2026-05-07 — matches scratch/design/hs-district/hs-district-pack/hall-wayfinder.html
 * Operator: "these need to be wired in for the highschools"
 *
 * Wayfinding kiosk treatment: hex/grid backdrop, header strip with
 * live clock + system status, an at-a-glance period bar with the
 * "next bell" countdown ring, five color-coded directional sign rows
 * (right / left / up / down) pointing the way to library, counseling,
 * cafeteria, gym, performing arts; a "you are here" floor plan with
 * pulsing dot, a 10-row room directory with status pips, and a
 * scrolling notices ticker.
 *
 * Editable widget regions wired through PropertiesPanel:
 *   - school          → mark + name + sub
 *   - clock           → "Local time" stat (label + live time)
 *   - status          → "All systems normal" pill
 *   - period          → period bar (badge / value / what / day /
 *                       nextK / nextV / ring)
 *   - sign0..sign4    → directional sign rows (arrow / label / name /
 *                       meta / room / floor)
 *   - map             → floor plan (title / "you are" / 7 room labels)
 *   - dir             → directory table (title / meta / 10 rows of
 *                       code / nm / t / s)
 *   - ticker          → bottom scrolling ticker
 *
 * Every CSS class name from the source HTML is preserved. Pixel sizes
 * are FIXED at 3840×2160 — DO NOT regress to vw / %. The HsStage
 * transform:scale wrapper handles sizing for any container.
 */

import { HsStage } from './HsStage';
import { useHsLiveClock } from './useHsLiveClock';

export interface HsHallWayfinderConfig {
  'school.initials'?: string;
  'school.name'?: string;
  'school.sub'?: string;
  'clock.label'?: string;
  'clock.time'?: string;
  'status.label'?: string;
  'period.badge'?: string;
  'period.value'?: string;
  'period.what'?: string;
  'period.day'?: string;
  'period.nextK'?: string;
  'period.nextV'?: string;
  'period.ring'?: string;
  'sign0.arrow'?: string;
  'sign0.label'?: string;
  'sign0.name'?: string;
  'sign0.meta'?: string;
  'sign0.room'?: string;
  'sign0.floor'?: string;
  'sign1.arrow'?: string;
  'sign1.label'?: string;
  'sign1.name'?: string;
  'sign1.meta'?: string;
  'sign1.room'?: string;
  'sign1.floor'?: string;
  'sign2.arrow'?: string;
  'sign2.label'?: string;
  'sign2.name'?: string;
  'sign2.meta'?: string;
  'sign2.room'?: string;
  'sign2.floor'?: string;
  'sign3.arrow'?: string;
  'sign3.label'?: string;
  'sign3.name'?: string;
  'sign3.meta'?: string;
  'sign3.room'?: string;
  'sign3.floor'?: string;
  'sign4.arrow'?: string;
  'sign4.label'?: string;
  'sign4.name'?: string;
  'sign4.meta'?: string;
  'sign4.room'?: string;
  'sign4.floor'?: string;
  'map.title'?: string;
  'map.you'?: string;
  'map.r1'?: string;
  'map.r2'?: string;
  'map.r3'?: string;
  'map.r4'?: string;
  'map.r5'?: string;
  'map.r6'?: string;
  'map.r7'?: string;
  'map.youlbl'?: string;
  'dir.title'?: string;
  'dir.meta'?: string;
  'dir.0.code'?: string;
  'dir.0.nm'?: string;
  'dir.0.t'?: string;
  'dir.0.s'?: string;
  'dir.1.code'?: string;
  'dir.1.nm'?: string;
  'dir.1.t'?: string;
  'dir.1.s'?: string;
  'dir.2.code'?: string;
  'dir.2.nm'?: string;
  'dir.2.t'?: string;
  'dir.2.s'?: string;
  'dir.3.code'?: string;
  'dir.3.nm'?: string;
  'dir.3.t'?: string;
  'dir.3.s'?: string;
  'dir.4.code'?: string;
  'dir.4.nm'?: string;
  'dir.4.t'?: string;
  'dir.4.s'?: string;
  'dir.5.code'?: string;
  'dir.5.nm'?: string;
  'dir.5.t'?: string;
  'dir.5.s'?: string;
  'dir.6.code'?: string;
  'dir.6.nm'?: string;
  'dir.6.t'?: string;
  'dir.6.s'?: string;
  'dir.7.code'?: string;
  'dir.7.nm'?: string;
  'dir.7.t'?: string;
  'dir.7.s'?: string;
  'dir.8.code'?: string;
  'dir.8.nm'?: string;
  'dir.8.t'?: string;
  'dir.8.s'?: string;
  'dir.9.code'?: string;
  'dir.9.nm'?: string;
  'dir.9.t'?: string;
  'dir.9.s'?: string;
  'ticker.tag'?: string;
  'ticker.message'?: string;
  'ticker.message2'?: string;
}

export const DEFAULTS: Required<HsHallWayfinderConfig> = {
  'school.initials': 'W',
  'school.name': 'Westridge High',
  'school.sub': 'Wayfinding · Main & B-wing',
  'clock.label': 'Local time',
  'clock.time': '10:24',
  'status.label': 'All systems normal',
  'period.badge': 'Now',
  'period.value': 'Period 3',
  'period.what': 'AP Lit · Ms. Han · Rm 218',
  'period.day': 'Wednesday · A-day · regular bell',
  'period.nextK': 'Bell in',
  'period.nextV': '14:32',
  'period.ring': 'P3',
  'sign0.arrow': '→',
  'sign0.label': 'This way · main hall',
  'sign0.name': 'Library & Commons',
  'sign0.meta': 'Open · printers · quiet study till 5pm',
  'sign0.room': 'B-201',
  'sign0.floor': 'Floor 2 · B-wing',
  'sign1.arrow': '→',
  'sign1.label': 'Past the trophy case',
  'sign1.name': 'Counseling Suite',
  'sign1.meta': 'Drop-in 9–11 · FAFSA help every Tue · Rm 102',
  'sign1.room': '102',
  'sign1.floor': 'Floor 1 · A-wing',
  'sign2.arrow': '←',
  'sign2.label': 'Left at the mural',
  'sign2.name': 'Cafeteria · Main',
  'sign2.meta': 'Lunch A 10:58 · Lunch B 11:42 · Lunch C 12:30',
  'sign2.room': 'CAF',
  'sign2.floor': 'Ground · C-wing',
  'sign3.arrow': '↑',
  'sign3.label': 'Stairwell ahead · up two',
  'sign3.name': 'Athletic Wing',
  'sign3.meta': 'Main gym · weight room · trainer · pool through D',
  'sign3.room': 'GYM',
  'sign3.floor': 'Floor 3 · D-wing',
  'sign4.arrow': '↓',
  'sign4.label': 'Down one · follow the violet line',
  'sign4.name': 'Performing Arts',
  'sign4.meta': 'Theater · choir · band · black box · scene shop',
  'sign4.room': 'PAC',
  'sign4.floor': 'Lower · E-wing',
  'map.title': 'You are here',
  'map.you': 'Main hall · between A & B',
  'map.r1': 'A-wing',
  'map.r2': 'Counsel',
  'map.r3': 'Commons / Library',
  'map.r4': 'Theater',
  'map.r5': 'Cafeteria',
  'map.r6': 'Office',
  'map.r7': 'B-wing classrooms',
  'map.youlbl': 'You · 1F',
  'dir.title': 'Directory',
  'dir.meta': "A–Z · today's status",
  'dir.0.code': '102',
  'dir.0.nm': 'Counseling Suite',
  'dir.0.t': '· A-wing 1F',
  'dir.0.s': 'Open · drop-in',
  'dir.1.code': '114',
  'dir.1.nm': 'Front Office & Attendance',
  'dir.1.t': '· main entrance',
  'dir.1.s': 'Open · 7–4',
  'dir.2.code': 'B-201',
  'dir.2.nm': 'Library & Media',
  'dir.2.t': '· B-wing 2F',
  'dir.2.s': 'Open · till 5pm',
  'dir.3.code': '214',
  'dir.3.nm': 'Engineering Lab',
  'dir.3.t': '· B-wing 2F',
  'dir.3.s': 'Class in session',
  'dir.4.code': '232',
  'dir.4.nm': 'Math Department',
  'dir.4.t': '· B-wing 2F',
  'dir.4.s': 'Office hours',
  'dir.5.code': '309',
  'dir.5.nm': 'World Languages',
  'dir.5.t': '· C-wing 3F',
  'dir.5.s': 'Class in session',
  'dir.6.code': 'PAC',
  'dir.6.nm': 'Performing Arts Theater',
  'dir.6.t': '· lower level',
  'dir.6.s': 'Closed · rehearsal',
  'dir.7.code': 'GYM',
  'dir.7.nm': 'Main Gymnasium',
  'dir.7.t': '· D-wing 3F',
  'dir.7.s': 'PE · period 3',
  'dir.8.code': 'CAF',
  'dir.8.nm': 'Cafeteria',
  'dir.8.t': '· C-wing ground',
  'dir.8.s': 'Opens 10:58',
  'dir.9.code': 'NRS',
  'dir.9.nm': 'Nurse · health office',
  'dir.9.t': '· A-wing 1F',
  'dir.9.s': 'Open · sign in',
  'ticker.tag': '★ Notices',
  'ticker.message':
    'Visitors please sign in at the front office and pick up a badge · Lockdown drill Thursday during 4th period · Bus 14 running 10 minutes late this afternoon · Senior portraits make-up day Friday in the studio · Wing C elevator out of service through Tuesday — use the B-wing lift · Found AirPods at the office · claim with student ID',
  'ticker.message2':
    'Visitors please sign in at the front office and pick up a badge · Lockdown drill Thursday during 4th period · Bus 14 running 10 minutes late this afternoon · Senior portraits make-up day Friday in the studio · Wing C elevator out of service through Tuesday — use the B-wing lift · Found AirPods at the office · claim with student ID',
};

const PRE: React.CSSProperties = { whiteSpace: 'pre-wrap' as const };

export function HsHallWayfinderWidget({ config, live }: { config?: HsHallWayfinderConfig; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsHallWayfinderConfig>;
  // Live "Local time" header stat — operator override wins.
  const now = useHsLiveClock(live !== false);
  const liveClock = c['clock.time'] === DEFAULTS['clock.time']
    ? now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : c['clock.time'];

  return (
    <HsStage stageStyle={{ background: '#0b0f17', color: '#f3f6fb', fontFamily: "'Archivo', sans-serif" }}>
      <style>{CSS}</style>
      {/* Grid + glow backdrop (matches stage::before in the mockup) */}
      <div className="hs-way-bg" />

      {/* HEADER STRIP */}
      <header className="hs-way-head">
        <div className="hs-way-brand">
          <div className="hs-way-mark" data-field="school.initials" style={PRE}>{c['school.initials']}</div>
          <div className="hs-way-who">
            <div className="hs-way-name" data-field="school.name" style={PRE}>{c['school.name']}</div>
            <div className="hs-way-sub" data-field="school.sub" style={PRE}>{c['school.sub']}</div>
          </div>
        </div>
        <div className="hs-way-right">
          <div className="hs-way-stat">
            <div className="hs-way-stat-k" data-field="clock.label" style={PRE}>{c['clock.label']}</div>
            <div className="hs-way-stat-v" data-field="clock.time" style={PRE}>{liveClock}</div>
          </div>
          <div className="hs-way-live">
            <span data-field="status.label" style={PRE}>{c['status.label']}</span>
          </div>
        </div>
      </header>

      {/* PERIOD BAR */}
      <section className="hs-way-period">
        <div className="hs-way-now">
          <span className="hs-way-badge" data-field="period.badge" style={PRE}>{c['period.badge']}</span>
          <span data-field="period.value" style={PRE}>{c['period.value']}</span>
        </div>
        <div className="hs-way-what">
          <span data-field="period.what" style={PRE}>{c['period.what']}</span>
          <span className="hs-way-what-sub" data-field="period.day" style={PRE}>{c['period.day']}</span>
        </div>
        <div className="hs-way-next">
          <div className="hs-way-next-k" data-field="period.nextK" style={PRE}>{c['period.nextK']}</div>
          <div className="hs-way-next-v" data-field="period.nextV" style={PRE}>{c['period.nextV']}</div>
        </div>
        <div className="hs-way-ring" data-field="period.ring" style={PRE}>{c['period.ring']}</div>
      </section>

      {/* DIRECTIONAL SIGNS */}
      <div className="hs-way-signs">
        <div className="hs-way-sign hs-way-right-arrow hs-way-c1">
          <div className="hs-way-arr" data-field="sign0.arrow" style={PRE}>{c['sign0.arrow']}</div>
          <div className="hs-way-body">
            <div className="hs-way-label" data-field="sign0.label" style={PRE}>{c['sign0.label']}</div>
            <div className="hs-way-name-big" data-field="sign0.name" style={PRE}>{c['sign0.name']}</div>
            <div className="hs-way-meta" data-field="sign0.meta" style={PRE}>{c['sign0.meta']}</div>
          </div>
          <div className="hs-way-room">
            <span data-field="sign0.room" style={PRE}>{c['sign0.room']}</span>
            <span className="hs-way-floor" data-field="sign0.floor" style={PRE}>{c['sign0.floor']}</span>
          </div>
        </div>

        <div className="hs-way-sign hs-way-right-arrow hs-way-c2">
          <div className="hs-way-arr" data-field="sign1.arrow" style={PRE}>{c['sign1.arrow']}</div>
          <div className="hs-way-body">
            <div className="hs-way-label" data-field="sign1.label" style={PRE}>{c['sign1.label']}</div>
            <div className="hs-way-name-big" data-field="sign1.name" style={PRE}>{c['sign1.name']}</div>
            <div className="hs-way-meta" data-field="sign1.meta" style={PRE}>{c['sign1.meta']}</div>
          </div>
          <div className="hs-way-room">
            <span data-field="sign1.room" style={PRE}>{c['sign1.room']}</span>
            <span className="hs-way-floor" data-field="sign1.floor" style={PRE}>{c['sign1.floor']}</span>
          </div>
        </div>

        <div className="hs-way-sign hs-way-left-arrow hs-way-c3">
          <div className="hs-way-arr" data-field="sign2.arrow" style={PRE}>{c['sign2.arrow']}</div>
          <div className="hs-way-body">
            <div className="hs-way-label" data-field="sign2.label" style={PRE}>{c['sign2.label']}</div>
            <div className="hs-way-name-big" data-field="sign2.name" style={PRE}>{c['sign2.name']}</div>
            <div className="hs-way-meta" data-field="sign2.meta" style={PRE}>{c['sign2.meta']}</div>
          </div>
          <div className="hs-way-room">
            <span data-field="sign2.room" style={PRE}>{c['sign2.room']}</span>
            <span className="hs-way-floor" data-field="sign2.floor" style={PRE}>{c['sign2.floor']}</span>
          </div>
        </div>

        <div className="hs-way-sign hs-way-up-arrow hs-way-c4">
          <div className="hs-way-arr" data-field="sign3.arrow" style={PRE}>{c['sign3.arrow']}</div>
          <div className="hs-way-body">
            <div className="hs-way-label" data-field="sign3.label" style={PRE}>{c['sign3.label']}</div>
            <div className="hs-way-name-big" data-field="sign3.name" style={PRE}>{c['sign3.name']}</div>
            <div className="hs-way-meta" data-field="sign3.meta" style={PRE}>{c['sign3.meta']}</div>
          </div>
          <div className="hs-way-room">
            <span data-field="sign3.room" style={PRE}>{c['sign3.room']}</span>
            <span className="hs-way-floor" data-field="sign3.floor" style={PRE}>{c['sign3.floor']}</span>
          </div>
        </div>

        <div className="hs-way-sign hs-way-down-arrow hs-way-c5">
          <div className="hs-way-arr" data-field="sign4.arrow" style={PRE}>{c['sign4.arrow']}</div>
          <div className="hs-way-body">
            <div className="hs-way-label" data-field="sign4.label" style={PRE}>{c['sign4.label']}</div>
            <div className="hs-way-name-big" data-field="sign4.name" style={PRE}>{c['sign4.name']}</div>
            <div className="hs-way-meta" data-field="sign4.meta" style={PRE}>{c['sign4.meta']}</div>
          </div>
          <div className="hs-way-room">
            <span data-field="sign4.room" style={PRE}>{c['sign4.room']}</span>
            <span className="hs-way-floor" data-field="sign4.floor" style={PRE}>{c['sign4.floor']}</span>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN — map + directory */}
      <aside className="hs-way-col">
        <div className="hs-way-map">
          <div className="hs-way-map-hdr">
            <h3 className="hs-way-map-h3" data-field="map.title" style={PRE}>{c['map.title']}</h3>
            <div className="hs-way-map-you" data-field="map.you" style={PRE}>{c['map.you']}</div>
          </div>
          <div className="hs-way-floorplan">
            <div className="hs-way-mroom hs-way-r1"><span data-field="map.r1" style={PRE}>{c['map.r1']}</span></div>
            <div className="hs-way-mroom hs-way-r2"><span data-field="map.r2" style={PRE}>{c['map.r2']}</span></div>
            <div className="hs-way-mroom hs-way-r3"><span data-field="map.r3" style={PRE}>{c['map.r3']}</span></div>
            <div className="hs-way-mroom hs-way-r4"><span data-field="map.r4" style={PRE}>{c['map.r4']}</span></div>
            <div className="hs-way-mroom hs-way-r5"><span data-field="map.r5" style={PRE}>{c['map.r5']}</span></div>
            <div className="hs-way-mroom hs-way-r6"><span data-field="map.r6" style={PRE}>{c['map.r6']}</span></div>
            <div className="hs-way-mroom hs-way-r7"><span data-field="map.r7" style={PRE}>{c['map.r7']}</span></div>
            <div className="hs-way-youdot" />
            <div className="hs-way-youlbl" data-field="map.youlbl" style={PRE}>{c['map.youlbl']}</div>
          </div>
        </div>

        <div className="hs-way-dir">
          <div className="hs-way-dir-hdr">
            <h3 className="hs-way-dir-h3" data-field="dir.title" style={PRE}>{c['dir.title']}</h3>
            <div className="hs-way-dir-meta" data-field="dir.meta" style={PRE}>{c['dir.meta']}</div>
          </div>
          <table className="hs-way-dir-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Department · location</th>
                <th className="hs-way-th-r">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="hs-way-td-code" data-field="dir.0.code" style={PRE}>{c['dir.0.code']}</td>
                <td>
                  <span data-field="dir.0.nm" style={PRE}>{c['dir.0.nm']}</span>{' '}
                  <span className="hs-way-td-t" data-field="dir.0.t" style={PRE}>{c['dir.0.t']}</span>
                </td>
                <td className="hs-way-td-r">
                  <span className="hs-way-td-dot" />
                  <span data-field="dir.0.s" style={PRE}>{c['dir.0.s']}</span>
                </td>
              </tr>
              <tr>
                <td className="hs-way-td-code" data-field="dir.1.code" style={PRE}>{c['dir.1.code']}</td>
                <td>
                  <span data-field="dir.1.nm" style={PRE}>{c['dir.1.nm']}</span>{' '}
                  <span className="hs-way-td-t" data-field="dir.1.t" style={PRE}>{c['dir.1.t']}</span>
                </td>
                <td className="hs-way-td-r">
                  <span className="hs-way-td-dot" />
                  <span data-field="dir.1.s" style={PRE}>{c['dir.1.s']}</span>
                </td>
              </tr>
              <tr>
                <td className="hs-way-td-code" data-field="dir.2.code" style={PRE}>{c['dir.2.code']}</td>
                <td>
                  <span data-field="dir.2.nm" style={PRE}>{c['dir.2.nm']}</span>{' '}
                  <span className="hs-way-td-t" data-field="dir.2.t" style={PRE}>{c['dir.2.t']}</span>
                </td>
                <td className="hs-way-td-r">
                  <span className="hs-way-td-dot" />
                  <span data-field="dir.2.s" style={PRE}>{c['dir.2.s']}</span>
                </td>
              </tr>
              <tr>
                <td className="hs-way-td-code" data-field="dir.3.code" style={PRE}>{c['dir.3.code']}</td>
                <td>
                  <span data-field="dir.3.nm" style={PRE}>{c['dir.3.nm']}</span>{' '}
                  <span className="hs-way-td-t" data-field="dir.3.t" style={PRE}>{c['dir.3.t']}</span>
                </td>
                <td className="hs-way-td-r">
                  <span className="hs-way-td-dot hs-way-td-dot-warn" />
                  <span data-field="dir.3.s" style={PRE}>{c['dir.3.s']}</span>
                </td>
              </tr>
              <tr>
                <td className="hs-way-td-code" data-field="dir.4.code" style={PRE}>{c['dir.4.code']}</td>
                <td>
                  <span data-field="dir.4.nm" style={PRE}>{c['dir.4.nm']}</span>{' '}
                  <span className="hs-way-td-t" data-field="dir.4.t" style={PRE}>{c['dir.4.t']}</span>
                </td>
                <td className="hs-way-td-r">
                  <span className="hs-way-td-dot" />
                  <span data-field="dir.4.s" style={PRE}>{c['dir.4.s']}</span>
                </td>
              </tr>
              <tr>
                <td className="hs-way-td-code" data-field="dir.5.code" style={PRE}>{c['dir.5.code']}</td>
                <td>
                  <span data-field="dir.5.nm" style={PRE}>{c['dir.5.nm']}</span>{' '}
                  <span className="hs-way-td-t" data-field="dir.5.t" style={PRE}>{c['dir.5.t']}</span>
                </td>
                <td className="hs-way-td-r">
                  <span className="hs-way-td-dot hs-way-td-dot-warn" />
                  <span data-field="dir.5.s" style={PRE}>{c['dir.5.s']}</span>
                </td>
              </tr>
              <tr>
                <td className="hs-way-td-code" data-field="dir.6.code" style={PRE}>{c['dir.6.code']}</td>
                <td>
                  <span data-field="dir.6.nm" style={PRE}>{c['dir.6.nm']}</span>{' '}
                  <span className="hs-way-td-t" data-field="dir.6.t" style={PRE}>{c['dir.6.t']}</span>
                </td>
                <td className="hs-way-td-r">
                  <span className="hs-way-td-dot hs-way-td-dot-bad" />
                  <span data-field="dir.6.s" style={PRE}>{c['dir.6.s']}</span>
                </td>
              </tr>
              <tr>
                <td className="hs-way-td-code" data-field="dir.7.code" style={PRE}>{c['dir.7.code']}</td>
                <td>
                  <span data-field="dir.7.nm" style={PRE}>{c['dir.7.nm']}</span>{' '}
                  <span className="hs-way-td-t" data-field="dir.7.t" style={PRE}>{c['dir.7.t']}</span>
                </td>
                <td className="hs-way-td-r">
                  <span className="hs-way-td-dot hs-way-td-dot-warn" />
                  <span data-field="dir.7.s" style={PRE}>{c['dir.7.s']}</span>
                </td>
              </tr>
              <tr>
                <td className="hs-way-td-code" data-field="dir.8.code" style={PRE}>{c['dir.8.code']}</td>
                <td>
                  <span data-field="dir.8.nm" style={PRE}>{c['dir.8.nm']}</span>{' '}
                  <span className="hs-way-td-t" data-field="dir.8.t" style={PRE}>{c['dir.8.t']}</span>
                </td>
                <td className="hs-way-td-r">
                  <span className="hs-way-td-dot" />
                  <span data-field="dir.8.s" style={PRE}>{c['dir.8.s']}</span>
                </td>
              </tr>
              <tr>
                <td className="hs-way-td-code" data-field="dir.9.code" style={PRE}>{c['dir.9.code']}</td>
                <td>
                  <span data-field="dir.9.nm" style={PRE}>{c['dir.9.nm']}</span>{' '}
                  <span className="hs-way-td-t" data-field="dir.9.t" style={PRE}>{c['dir.9.t']}</span>
                </td>
                <td className="hs-way-td-r">
                  <span className="hs-way-td-dot" />
                  <span data-field="dir.9.s" style={PRE}>{c['dir.9.s']}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>

      {/* TICKER */}
      <div className="hs-way-ticker">
        <div className="hs-way-ticker-tag">
          <span data-field="ticker.tag" style={PRE}>{c['ticker.tag']}</span>
        </div>
        <div className="hs-way-ticker-msg">
          <span data-field="ticker.message" style={PRE}>{c['ticker.message']}</span>
          <span>&nbsp;<span className="hs-way-ticker-star">◆</span>&nbsp;</span>
          <span data-field="ticker.message2" style={PRE}>{c['ticker.message2']}</span>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — keeps every pixel value identical to scratch/design/hs-district/hs-district-pack/hall-wayfinder.html. */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800;900&family=Archivo+Narrow:wght@500;700&family=JetBrains+Mono:wght@500;700&display=swap');

.hs-way-bg {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(1600px 1000px at 80% -10%, rgba(58,161,255,.10), transparent 60%),
    radial-gradient(1400px 900px at 5% 100%, rgba(255,216,61,.06), transparent 60%),
    linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px) 0 0/120px 120px,
    linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px) 0 0/120px 120px;
}

@keyframes hsWayBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: .25; } }
@keyframes hsWayScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes hsWayPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(34,211,154,.5); } 50% { box-shadow: 0 0 0 22px rgba(34,211,154,0); } }
@keyframes hsWayGlide { 0% { transform: translateX(-8px); } 50% { transform: translateX(8px); } 100% { transform: translateX(-8px); } }

.hs-way-head {
  position: absolute; top: 0; left: 0; right: 0; height: 200px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 80px; border-bottom: 1px solid rgba(255,255,255,.08); z-index: 5;
  background: linear-gradient(180deg, rgba(11,15,23,.92), rgba(11,15,23,.72) 70%, transparent);
}
.hs-way-brand { display: flex; align-items: center; gap: 32px; }
.hs-way-mark {
  width: 120px; height: 120px; background: #ffd83d; color: #0b0f17;
  display: grid; place-items: center;
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 60px; letter-spacing: -.02em;
  clip-path: polygon(0 0, 100% 0, 100% 80%, 80% 100%, 0 100%);
}
.hs-way-who { display: flex; flex-direction: column; line-height: 1; }
.hs-way-name {
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 84px;
  letter-spacing: -.02em; color: #f3f6fb; text-transform: uppercase;
}
.hs-way-sub {
  font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 26px;
  letter-spacing: .32em; color: #ffd83d; text-transform: uppercase; margin-top: 10px;
}
.hs-way-right { display: flex; align-items: center; gap: 24px; }
.hs-way-stat { display: flex; flex-direction: column; align-items: flex-end; line-height: 1; }
.hs-way-stat-k {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .24em; color: #9aa3b8; text-transform: uppercase;
}
.hs-way-stat-v {
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 80px;
  letter-spacing: -.02em; color: #f3f6fb; margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
.hs-way-stat-v::after {
  content: ''; display: inline-block; width: 14px; height: 14px;
  background: #ffd83d; border-radius: 50%; margin-left: 10px;
  animation: hsWayBlink 1.4s steps(2) infinite; vertical-align: middle;
}
.hs-way-live {
  padding: 14px 22px; background: rgba(34,211,154,.16); color: #22d39a;
  border: 2px solid rgba(34,211,154,.4);
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .22em; text-transform: uppercase;
  display: flex; align-items: center; gap: 14px; border-radius: 6px;
}
.hs-way-live::before {
  content: ''; width: 14px; height: 14px; border-radius: 50%;
  background: #22d39a; animation: hsWayPulse 1.8s ease-in-out infinite;
}

.hs-way-period {
  position: absolute; top: 200px; left: 0; right: 0; height: 160px;
  display: grid; grid-template-columns: auto 1fr auto auto; gap: 48px;
  align-items: center; padding: 0 80px;
  border-bottom: 1px solid rgba(255,255,255,.08);
  background: linear-gradient(90deg, rgba(255,216,61,.12), transparent 30%, transparent 70%, rgba(58,161,255,.10));
  z-index: 4;
}
.hs-way-now {
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 120px;
  line-height: .95; color: #ffd83d; letter-spacing: -.02em; text-transform: uppercase;
  display: flex; align-items: baseline; gap: 24px;
}
.hs-way-badge {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px;
  background: #ffd83d; color: #0b0f17; padding: 8px 14px;
  letter-spacing: .22em; line-height: 1; align-self: center;
}
.hs-way-what {
  font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 54px;
  color: #f3f6fb; letter-spacing: -.01em;
  display: flex; flex-direction: column; line-height: 1.05;
}
.hs-way-what-sub {
  font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 26px;
  color: #9aa3b8; letter-spacing: .18em; text-transform: uppercase; margin-top: 8px;
}
.hs-way-next { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.05; }
.hs-way-next-k {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  color: #9aa3b8; letter-spacing: .24em; text-transform: uppercase;
}
.hs-way-next-v {
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 54px;
  color: #f3f6fb; margin-top: 6px; letter-spacing: -.01em;
}
.hs-way-ring {
  width: 120px; height: 120px; border-radius: 50%; border: 8px solid #ffd83d;
  display: grid; place-items: center;
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 46px;
  color: #ffd83d; font-variant-numeric: tabular-nums;
}

.hs-way-signs {
  position: absolute; top: 380px; left: 80px; width: 1820px;
  display: flex; flex-direction: column; gap: 24px; z-index: 3;
}
.hs-way-sign {
  display: grid; grid-template-columns: 200px 1fr 220px;
  align-items: center; gap: 32px; padding: 36px 36px;
  background: linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.01));
  border-left: 8px solid #ffd83d; border-radius: 6px;
  position: relative; overflow: hidden;
}
.hs-way-sign::after {
  content: ''; position: absolute; right: -200px; top: 0; bottom: 0;
  width: 400px;
  background: radial-gradient(circle at 0 50%, rgba(255,216,61,.08), transparent 60%);
  pointer-events: none;
}
.hs-way-c1 { border-left-color: #ffd83d; }
.hs-way-c1 .hs-way-arr { background: #ffd83d; color: #0b0f17; }
.hs-way-c1 .hs-way-room { color: #ffd83d; }
.hs-way-c2 { border-left-color: #3aa1ff; }
.hs-way-c2 .hs-way-arr { background: #3aa1ff; color: #fff; }
.hs-way-c2 .hs-way-room { color: #3aa1ff; }
.hs-way-c2::after { background: radial-gradient(circle at 0 50%, rgba(58,161,255,.10), transparent 60%); }
.hs-way-c3 { border-left-color: #22d39a; }
.hs-way-c3 .hs-way-arr { background: #22d39a; color: #0b0f17; }
.hs-way-c3 .hs-way-room { color: #22d39a; }
.hs-way-c3::after { background: radial-gradient(circle at 0 50%, rgba(34,211,154,.10), transparent 60%); }
.hs-way-c4 { border-left-color: #ff5a5a; }
.hs-way-c4 .hs-way-arr { background: #ff5a5a; color: #fff; }
.hs-way-c4 .hs-way-room { color: #ff5a5a; }
.hs-way-c4::after { background: radial-gradient(circle at 0 50%, rgba(255,90,90,.10), transparent 60%); }
.hs-way-c5 { border-left-color: #c084fc; }
.hs-way-c5 .hs-way-arr { background: #c084fc; color: #fff; }
.hs-way-c5 .hs-way-room { color: #c084fc; }
.hs-way-c5::after { background: radial-gradient(circle at 0 50%, rgba(192,132,252,.12), transparent 60%); }

.hs-way-arr {
  width: 200px; height: 200px; display: grid; place-items: center;
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 180px;
  line-height: 1; letter-spacing: -.02em;
  clip-path: polygon(0 0, 75% 0, 100% 50%, 75% 100%, 0 100%);
  animation: hsWayGlide 3.6s ease-in-out infinite;
}
.hs-way-left-arrow .hs-way-arr {
  clip-path: polygon(25% 0, 100% 0, 100% 100%, 25% 100%, 0 50%);
  animation-direction: reverse;
}
.hs-way-up-arrow .hs-way-arr { clip-path: polygon(0 25%, 50% 0, 100% 25%, 100% 100%, 0 100%); }
.hs-way-down-arrow .hs-way-arr { clip-path: polygon(0 0, 100% 0, 100% 75%, 50% 100%, 0 75%); }

.hs-way-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.hs-way-label {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .28em; color: #9aa3b8; text-transform: uppercase;
}
.hs-way-name-big {
  /* 2026-05-07 — operator: "text on the left is getting off". Was
     108px which made "LIBRARY & COMMONS" overflow into the room
     column. 84px keeps the marquee feel + fits both lines of the
     longest destination ("CAFETERIA · MAIN", "PERFORMING ARTS"). */
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 84px;
  line-height: .95; color: #f3f6fb; letter-spacing: -.025em; text-transform: uppercase;
}
.hs-way-meta {
  font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 26px;
  color: #9aa3b8; letter-spacing: .16em; text-transform: uppercase; margin-top: 6px;
}
.hs-way-room {
  /* 2026-05-07 — was 140px which competed with the destination
     name; 108px reads as the secondary metadata it is. */
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 108px;
  line-height: 1; letter-spacing: -.03em; text-align: right;
  font-variant-numeric: tabular-nums;
}
.hs-way-floor {
  display: block; font-family: 'JetBrains Mono', monospace; font-weight: 500;
  font-size: 24px; color: #9aa3b8; letter-spacing: .24em; margin-top: 6px;
  text-transform: uppercase;
}

.hs-way-col {
  position: absolute; top: 380px; right: 80px; width: 1780px;
  display: flex; flex-direction: column; gap: 24px; z-index: 3;
}

.hs-way-map {
  height: 520px;
  background: linear-gradient(135deg, rgba(255,255,255,.04), rgba(255,255,255,.015));
  border: 1px solid rgba(255,255,255,.14); border-radius: 6px;
  padding: 32px 36px; position: relative; overflow: hidden;
}
.hs-way-map-hdr { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
.hs-way-map-h3 {
  margin: 0; font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 54px;
  letter-spacing: -.02em; color: #f3f6fb; text-transform: uppercase;
}
.hs-way-map-you {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .22em; color: #ffd83d; text-transform: uppercase;
  display: flex; align-items: center; gap: 12px;
}
.hs-way-map-you::before {
  content: ''; width: 16px; height: 16px; background: #ffd83d;
  border-radius: 50%; animation: hsWayBlink 1.4s steps(2) infinite;
}
.hs-way-floorplan {
  position: absolute; top: 120px; left: 36px; right: 36px; bottom: 36px;
  border: 2px solid rgba(255,255,255,.14); border-radius: 4px;
  background:
    repeating-linear-gradient(0deg, transparent 0 60px, rgba(255,255,255,.03) 60px 61px),
    repeating-linear-gradient(90deg, transparent 0 60px, rgba(255,255,255,.03) 60px 61px);
}
.hs-way-mroom {
  position: absolute; border: 2px solid rgba(255,255,255,.14); border-radius: 4px;
  /* 2026-05-07 — bumped 18px → 28px so map labels read at lobby distance. */
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px;
  color: #9aa3b8; display: grid; place-items: center; letter-spacing: .12em;
}
.hs-way-r1 { left: 0; top: 0; width: 18%; height: 48%; background: rgba(58,161,255,.08); color: #3aa1ff; border-color: rgba(58,161,255,.4); }
.hs-way-r2 { left: 18%; top: 0; width: 22%; height: 48%; background: rgba(34,211,154,.06); color: #22d39a; border-color: rgba(34,211,154,.4); }
.hs-way-r3 { left: 40%; top: 0; width: 30%; height: 48%; background: rgba(255,90,90,.06); color: #ff5a5a; border-color: rgba(255,90,90,.4); }
.hs-way-r4 { left: 70%; top: 0; width: 30%; height: 48%; background: rgba(192,132,252,.08); color: #c084fc; border-color: rgba(192,132,252,.4); }
.hs-way-r5 { left: 0; top: 48%; width: 32%; height: 52%; background: rgba(255,216,61,.06); color: #ffd83d; border-color: rgba(255,216,61,.4); }
.hs-way-r6 { left: 32%; top: 48%; width: 24%; height: 52%; background: rgba(255,255,255,.02); border-color: rgba(255,255,255,.18); }
.hs-way-r7 { left: 56%; top: 48%; width: 44%; height: 52%; background: rgba(58,161,255,.05); color: #3aa1ff; border-color: rgba(58,161,255,.3); }
.hs-way-youdot {
  position: absolute; left: 34%; top: 46%; width: 36px; height: 36px;
  background: #ffd83d; border-radius: 50%; border: 6px solid #0b0f17;
  box-shadow: 0 0 0 4px #ffd83d; animation: hsWayPulse 1.8s ease-in-out infinite; z-index: 2;
}
.hs-way-youlbl {
  position: absolute; left: calc(34% + 50px); top: calc(46% - 14px);
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .22em; color: #ffd83d; text-transform: uppercase; z-index: 2;
}

.hs-way-dir {
  flex: 1;
  background: linear-gradient(135deg, rgba(255,255,255,.04), rgba(255,255,255,.015));
  border: 1px solid rgba(255,255,255,.14); border-radius: 6px;
  padding: 28px 32px; display: flex; flex-direction: column; overflow: hidden;
}
.hs-way-dir-hdr {
  display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 1px solid rgba(255,255,255,.14); padding-bottom: 12px; margin-bottom: 8px;
}
.hs-way-dir-h3 {
  margin: 0; font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 48px;
  letter-spacing: -.02em; color: #f3f6fb; text-transform: uppercase;
}
.hs-way-dir-meta {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .22em; color: #9aa3b8; text-transform: uppercase;
}
.hs-way-dir-table { width: 100%; border-collapse: collapse; font-family: 'Archivo Narrow', sans-serif; }
.hs-way-dir-table th {
  /* 2026-05-07 — directory column heads bumped 22px → 30px. */
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px;
  letter-spacing: .22em; color: #5b6478; text-transform: uppercase;
  text-align: left; padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,.14);
}
.hs-way-th-r { text-align: right; }
.hs-way-dir-table td {
  /* 2026-05-07 — directory rows bumped 32px → 40px so room/dept
     names read clean from across a hallway. */
  padding: 16px 0; border-bottom: 1px dashed rgba(255,255,255,.07);
  font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 40px;
  color: #f3f6fb; letter-spacing: -.005em; font-variant-numeric: tabular-nums;
}
.hs-way-td-code { color: #ffd83d; }
.hs-way-td-t {
  /* 2026-05-07 — location column 24px → 32px. */
  font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 32px;
  color: #9aa3b8; text-transform: uppercase; letter-spacing: .12em;
}
.hs-way-td-r {
  /* 2026-05-07 — status column 22px → 30px. */
  text-align: right; color: #9aa3b8;
  font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 30px;
  letter-spacing: .18em; text-transform: uppercase;
}
.hs-way-dir-table tr:last-child td { border-bottom: 0; }
.hs-way-td-dot {
  display: inline-block; width: 14px; height: 14px; border-radius: 50%;
  background: #22d39a; margin-right: 14px; vertical-align: middle;
}
.hs-way-td-dot-warn { background: #ffd83d; }
.hs-way-td-dot-bad { background: #ff5a5a; }

.hs-way-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 96px;
  background: #ffd83d; color: #0b0f17;
  display: flex; align-items: center; overflow: hidden; z-index: 5;
}
.hs-way-ticker-tag {
  flex: 0 0 auto; background: #0b0f17; color: #ffd83d;
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 36px;
  padding: 0 40px; height: 100%; display: flex; align-items: center;
  letter-spacing: -.01em; text-transform: uppercase; gap: 18px;
}
.hs-way-ticker-tag::before {
  content: ''; width: 18px; height: 18px; background: #ffd83d;
  border-radius: 50%; animation: hsWayBlink 1.4s steps(2) infinite;
}
.hs-way-ticker-msg {
  font-family: 'Archivo', sans-serif; font-weight: 800; font-size: 36px;
  padding-left: 36px; white-space: nowrap; letter-spacing: .04em;
  text-transform: uppercase; animation: hsWayScroll 90s linear infinite;
}
.hs-way-ticker-star { margin: 0 22px; color: #0b0f17; opacity: .55; }
`;
