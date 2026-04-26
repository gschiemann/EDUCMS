"use client";

/**
 * MsPlaylistWidget — Middle-school lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-25 — matches scratch/design/playlist-ms-v2.html.
 * Reviewed by user, ported via HsStage scale pattern. DO NOT
 * regress to vw/% units. Every pixel size must match the mockup.
 *
 * Scene layout (panels arranged on a 3840×2160 stage):
 *   - appbar      → brand lockup + "Playing on …" device chip + meta tiles + avatar
 *   - hero        → 900×900 album cover tile + now-playing detail (eyebrow,
 *                   title, artist, chips, equalizer, progress bar, transports)
 *   - middle      → up-next queue (left, 2540px) + side rail (right):
 *                   featured spotlight card + recent/club charts + mini stats
 *   - bottom      → pinned alert (left 1300px) + ticker feed (right rest)
 *
 * Every panel that sets an explicit width relies on box-sizing: border-box
 * (single shared rule at the top of CSS). The .stage backdrop is painted
 * by HsStage stageStyle so the layered glow gradients reach edge-to-edge
 * without bleeding through the scaled wrapper.
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsPlaylistConfig {
  // App bar — brand
  'brand.eyebrow'?: string;
  'brand.suffix'?: string;
  'brand.day'?: string;
  'brand.date'?: string;
  'brand.volume'?: string;
  // App bar — device chip
  'device.label'?: string;
  'device.name'?: string;
  // App bar — meta tiles
  'clock.label'?: string;
  'clock.time'?: string;
  'weather.label'?: string;
  'weather.temp'?: string;
  'countdown.label'?: string;
  'countdown.value'?: string;
  'profile.initials'?: string;
  // Hero — album cover
  'cover.top'?: string;
  'cover.big'?: string;
  'cover.album'?: string;
  'cover.tracklen'?: string;
  // Hero — now-playing
  'now.eyebrow'?: string;
  'now.title-1'?: string;
  'now.title-2'?: string;
  'now.artist-name'?: string;
  'now.artist-room'?: string;
  'now.artist-grade'?: string;
  'now.chipE'?: string;
  'now.chip1'?: string;
  'now.chip2'?: string;
  'now.meta'?: string;
  'now.elapsed'?: string;
  'now.remaining'?: string;
  // Queue header
  'queue.dayLabel'?: string;
  'queue.dayLetter'?: string;
  'queue.date'?: string;
  'queue.pill'?: string;
  // Queue rows (4 rows)
  'queue.0.idx'?: string;
  'queue.0.art'?: string;
  'queue.0.title'?: string;
  'queue.0.artist'?: string;
  'queue.0.album'?: string;
  'queue.0.dur'?: string;
  'queue.1.idx'?: string;
  'queue.1.art'?: string;
  'queue.1.title'?: string;
  'queue.1.artist'?: string;
  'queue.1.album'?: string;
  'queue.1.dur'?: string;
  'queue.2.idx'?: string;
  'queue.2.art'?: string;
  'queue.2.title'?: string;
  'queue.2.artist'?: string;
  'queue.2.album'?: string;
  'queue.2.dur'?: string;
  'queue.3.idx'?: string;
  'queue.3.art'?: string;
  'queue.3.title'?: string;
  'queue.3.artist'?: string;
  'queue.3.album'?: string;
  'queue.3.dur'?: string;
  // Featured / spotlight
  'featured.eyebrow'?: string;
  'featured.title'?: string;
  'featured.art'?: string;
  'featured.name'?: string;
  'featured.desc'?: string;
  'featured.tag'?: string;
  // Recent / club charts
  'recent.eyebrow'?: string;
  'recent.title'?: string;
  'recent.0.t'?: string;
  'recent.0.s'?: string;
  'recent.0.w'?: string;
  'recent.1.t'?: string;
  'recent.1.s'?: string;
  'recent.1.w'?: string;
  'recent.2.t'?: string;
  'recent.2.s'?: string;
  'recent.2.w'?: string;
  'recent.3.t'?: string;
  'recent.3.s'?: string;
  'recent.3.w'?: string;
  // Stats card
  'stats.attendance.k'?: string;
  'stats.attendance.v'?: string;
  'stats.lunch.k'?: string;
  'stats.lunch.v'?: string;
  'stats.bus.k'?: string;
  'stats.bus.v'?: string;
  // Bottom alert
  'alert.ico'?: string;
  'alert.eyebrow'?: string;
  'alert.message'?: string;
  'alert.when'?: string;
  // Ticker
  'ticker.tag'?: string;
  'ticker.0'?: string;
  'ticker.1'?: string;
  'ticker.2'?: string;
  'ticker.3'?: string;
  'ticker.4'?: string;
  'ticker.5'?: string;
}

export const DEFAULTS: Required<MsPlaylistConfig> = {
  // Brand
  'brand.eyebrow': 'Westridge MS · Lobby Display',
  'brand.suffix': 'FM',
  'brand.day': 'DAY B',
  'brand.date': 'TUE APR 21',
  'brand.volume': 'VOL 147',
  // Device chip
  'device.label': 'Playing on',
  'device.name': 'Westridge MS · Main Lobby',
  // Meta tiles
  'clock.label': 'Local time',
  'clock.time': '7:53',
  'weather.label': 'Outside',
  'weather.temp': '46°',
  'countdown.label': 'Field Day',
  'countdown.value': '12d',
  'profile.initials': 'WM',
  // Cover
  'cover.top': 'Now Playing · Period 2',
  'cover.big': 'P2',
  'cover.album': 'Day B Rotation',
  'cover.tracklen': '8 tracks · 4h 35m',
  // Now playing
  'now.eyebrow': 'Live now · Period 2 · 31:12 in',
  'now.title-1': 'English',
  'now.title-2': 'Poetry Unit',
  'now.artist-name': 'Mr. Nguyen',
  'now.artist-room': 'Room 108',
  'now.artist-grade': '7th grade',
  'now.chipE': 'E',
  'now.chip1': 'Bring journal',
  'now.chip2': 'Workshop day',
  'now.meta': '50 min · repeats Thu',
  'now.elapsed': '31:12',
  'now.remaining': '-18:48',
  // Queue header
  'queue.dayLabel': 'DAY',
  'queue.dayLetter': 'B',
  'queue.date': 'TUE APR 21',
  'queue.pill': '6 in queue',
  // Queue rows
  'queue.0.idx': '3',
  'queue.0.art': 'SL',
  'queue.0.title': 'Science — lab day',
  'queue.0.artist': 'Ms. Okafor · 7th grade',
  'queue.0.album': 'Rm 207 · closed-toe shoes required',
  'queue.0.dur': '9:55',
  'queue.1.idx': '4',
  'queue.1.art': 'PE',
  'queue.1.title': 'PE — mile run',
  'queue.1.artist': 'Coach Reyes · gymnasium A',
  'queue.1.album': 'Lockers by 10:45 · sneakers',
  'queue.1.dur': '10:50',
  'queue.2.idx': '5',
  'queue.2.art': 'LU',
  'queue.2.title': 'Lunch — A period',
  'queue.2.artist': 'Cafeteria · 7th grade only',
  'queue.2.album': 'Chicken & rice bowl today',
  'queue.2.dur': '11:45',
  'queue.3.idx': '6',
  'queue.3.art': 'SS',
  'queue.3.title': 'Social Studies — map quiz',
  'queue.3.artist': 'Mr. Alvarez · Rm 115',
  'queue.3.album': 'Bring a #2 pencil · closed book',
  'queue.3.dur': '12:35',
  // Featured
  'featured.eyebrow': '★ Spotlight of the Week',
  'featured.title': 'Spring Band Concert',
  'featured.art': '🎺',
  'featured.name': '"Echoes" — 7th & 8th band',
  'featured.desc': 'Wed night · auditorium · doors 6:30',
  'featured.tag': 'WED · 7PM',
  // Recent
  'recent.eyebrow': "After School · Today's Top 5",
  'recent.title': 'Club Charts',
  'recent.0.t': 'Robotics Club',
  'recent.0.s': 'Rm 207 · returning champions',
  'recent.0.w': '3:00–4:30',
  'recent.1.t': 'Drama Auditions',
  'recent.1.s': 'Auditorium · "Into the Woods"',
  'recent.1.w': '3:15–4:30',
  'recent.2.t': 'Garden Club',
  'recent.2.s': 'Greenhouse · seedlings day',
  'recent.2.w': '3:00–4:00',
  'recent.3.t': 'Yearbook Staff',
  'recent.3.s': 'Comp lab B · final spreads',
  'recent.3.w': '3:00–4:00',
  // Stats
  'stats.attendance.k': 'Attendance',
  'stats.attendance.v': '96%',
  'stats.lunch.k': 'Lunch',
  'stats.lunch.v': 'A',
  'stats.bus.k': 'Buses',
  'stats.bus.v': '14↑10',
  // Alert
  'alert.ico': '!',
  'alert.eyebrow': 'Pinned · Schedule Change',
  'alert.message': 'Picture day moved to Thursday — full uniform, slips to office by Wed.',
  'alert.when': 'THU · ALL DAY',
  // Ticker
  'ticker.tag': 'Otter Radio',
  'ticker.0': 'Bus 14 running +10 minutes',
  'ticker.1': 'Ms. Park out today, sub in B-12',
  'ticker.2': 'Spelling bee sign-ups close Friday',
  'ticker.3': '8th grade field trip forms due tomorrow',
  'ticker.4': 'Library returns due this week',
  'ticker.5': 'Lost blue water bottle → front office',
};

const pick = <K extends keyof Required<MsPlaylistConfig>>(
  cfg: MsPlaylistConfig,
  key: K,
): string => {
  const v = cfg[key];
  return ((v === undefined || v === '') ? DEFAULTS[key] : v) as string;
};

export function MsPlaylistWidget({ config }: { config?: MsPlaylistConfig }) {
  const cfg = config || {};

  // Per-row queue art gradient styles (from mockup inline styles)
  const queueArtStyles: React.CSSProperties[] = [
    { background: 'linear-gradient(135deg,#6f8bff,#2e3a8a)' },
    { background: 'linear-gradient(135deg,#ff8a4a,#a33418)' },
    { background: 'linear-gradient(135deg,#ffc94d,#a67a10)' },
    { background: 'linear-gradient(135deg,#f23985,#6b1f3a)' },
  ];

  // Whether each track has the "E" explicit marker (rows 0 and 3 in mockup)
  const queueExplicit: boolean[] = [true, false, false, true];

  // Queue durations include a small "X min" sub-label inside the dur cell
  const queueDurSubs: string[] = ['50 min', '50 min', '45 min', '50 min'];

  return (
    <HsStage
      stageStyle={{
        background: '#050507',
        backgroundImage: [
          'radial-gradient(ellipse 1800px 1100px at 18% 8%,  rgba(30,215,96,.18), transparent 65%)',
          'radial-gradient(ellipse 1500px 900px  at 92% 92%, rgba(242,57,133,.10), transparent 70%)',
          'radial-gradient(ellipse 1200px 700px  at 50% 50%, rgba(111,139,255,.05), transparent 70%)',
        ].join(', '),
        color: '#f7f7fb',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Subtle film-grain noise overlay (matches .stage::before) */}
      <div className="ms-pl-grain" aria-hidden="true" />

      {/* ─── TOP APP BAR ─────────────────────────────────── */}
      <header className="ms-pl-appbar">
        <div className="ms-pl-brand" data-widget="brand">
          <div className="ms-pl-mark" aria-hidden="true" />
          <div className="ms-pl-brand-info">
            <div className="ms-pl-eye" data-field="brand.eyebrow" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'brand.eyebrow')}</div>
            <div className="ms-pl-name">
              {'Otter'}
              <span data-field="brand.suffix" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'brand.suffix')}</span>
            </div>
            <div className="ms-pl-sub">
              <span data-field="brand.day" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'brand.day')}</span>
              {' · '}
              <b data-field="brand.date" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'brand.date')}</b>
              {' · '}
              <span data-field="brand.volume" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'brand.volume')}</span>
            </div>
          </div>
        </div>

        <div className="ms-pl-device" data-widget="device">
          <div className="ms-pl-device-ico" aria-hidden="true" />
          <div className="ms-pl-device-info">
            <div className="ms-pl-device-k" data-field="device.label" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'device.label')}</div>
            <div className="ms-pl-device-v" data-field="device.name" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'device.name')}</div>
          </div>
        </div>

        <div className="ms-pl-meta-tiles">
          <div className="ms-pl-mt" data-widget="clock">
            <span className="ms-pl-mt-k" data-field="clock.label" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'clock.label')}</span>
            <span className="ms-pl-mt-v" data-field="clock.time" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'clock.time')}
              <sup>am</sup>
            </span>
          </div>
          <div className="ms-pl-mt" data-widget="weather">
            <span className="ms-pl-mt-k" data-field="weather.label" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'weather.label')}</span>
            <span className="ms-pl-mt-v ms-pl-cool" data-field="weather.temp" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'weather.temp')}</span>
          </div>
          <div className="ms-pl-mt" data-widget="countdown">
            <span className="ms-pl-mt-k" data-field="countdown.label" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'countdown.label')}</span>
            <span className="ms-pl-mt-v ms-pl-green" data-field="countdown.value" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'countdown.value')}</span>
          </div>
          <div className="ms-pl-avatar" data-widget="profile" data-field="profile.initials" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'profile.initials')}
          </div>
        </div>
      </header>

      {/* ─── HERO · NOW PLAYING ───────────────────────────── */}
      <section className="ms-pl-hero">
        {/* Album art tile */}
        <div className="ms-pl-cover" data-widget="cover">
          <div className="ms-pl-albumtxt">
            <div>
              <div className="ms-pl-cover-top" data-field="cover.top" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'cover.top')}</div>
            </div>
            <div className="ms-pl-cover-big" data-field="cover.big" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'cover.big')}</div>
            <div className="ms-pl-cover-row">
              <div className="ms-pl-cover-meta">
                <b data-field="cover.album" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'cover.album')}</b>
                <span data-field="cover.tracklen" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'cover.tracklen')}</span>
              </div>
              <div className="ms-pl-cover-heart" aria-hidden="true">♥</div>
            </div>
          </div>
        </div>

        {/* Now-playing detail column */}
        <div className="ms-pl-now" data-widget="now">
          <div className="ms-pl-now-eyebrow" data-field="now.eyebrow" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'now.eyebrow')}</div>

          <h1 className="ms-pl-now-h1">
            <span data-field="now.title-1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'now.title-1')}</span>
            {' — '}
            <em data-field="now.title-2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'now.title-2')}</em>
          </h1>

          <div className="ms-pl-now-artist" data-widget="now.artist">
            <b data-field="now.artist-name" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'now.artist-name')}</b>
            {' · '}
            <span data-field="now.artist-room" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'now.artist-room')}</span>
            {' · '}
            <span data-field="now.artist-grade" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'now.artist-grade')}</span>
          </div>

          <div className="ms-pl-chips">
            <span className="ms-pl-chip ms-pl-chip-exp" data-field="now.chipE" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'now.chipE')}</span>
            <span className="ms-pl-chip" data-field="now.chip1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'now.chip1')}</span>
            <span className="ms-pl-chip ms-pl-chip-green" data-field="now.chip2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'now.chip2')}</span>
            <span className="ms-pl-chip-meta" data-field="now.meta" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'now.meta')}</span>
          </div>

          <div className="ms-pl-eq" aria-hidden="true">
            <span /><span /><span /><span /><span /><span /><span />
            <span /><span /><span /><span /><span /><span /><span />
          </div>

          <div className="ms-pl-progress">
            <div className="ms-pl-track">
              <div className="ms-pl-fill" />
              <div className="ms-pl-knob" />
            </div>
            <div className="ms-pl-times">
              <span className="ms-pl-time-left" data-field="now.elapsed" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'now.elapsed')}</span>
              <span data-field="now.remaining" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'now.remaining')}</span>
            </div>
          </div>

          <div className="ms-pl-ctrls" aria-hidden="true">
            <div className="ms-pl-btn">⏮</div>
            <div className="ms-pl-btn ms-pl-btn-play">▶</div>
            <div className="ms-pl-btn">⏭</div>
          </div>
        </div>
      </section>

      {/* ─── MIDDLE · QUEUE + SIDE RAIL ───────────────────── */}
      <section className="ms-pl-middle">
        {/* Up Next queue */}
        <div className="ms-pl-queue" data-widget="queue">
          <div className="ms-pl-queue-head">
            <h2 className="ms-pl-queue-h2">
              {'Up Next '}
              <em>{`· Today's Rotation`}</em>
            </h2>
            <div className="ms-pl-queue-meta">
              <div className="ms-pl-queue-day">
                <span data-field="queue.dayLabel" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'queue.dayLabel')}</span>{' '}
                <b data-field="queue.dayLetter" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'queue.dayLetter')}</b>
                {' · '}
                <span data-field="queue.date" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'queue.date')}</span>
              </div>
              <div className="ms-pl-queue-pill" data-field="queue.pill" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'queue.pill')}</div>
            </div>
          </div>

          <div className="ms-pl-colhd">
            <span>#</span>
            <span>Track · Teacher</span>
            <span>Album · Where</span>
            <span className="ms-pl-r">Bell · Length</span>
          </div>

          <div className="ms-pl-list">
            {([0, 1, 2, 3] as const).map((i) => {
              const isUp = i === 0;
              return (
                <div
                  key={i}
                  className={`ms-pl-row${isUp ? ' ms-pl-row-up' : ''}`}
                  data-widget={`queue.${i}`}
                >
                  <span className="ms-pl-idx" data-field={`queue.${i}.idx`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `queue.${i}.idx` as keyof Required<MsPlaylistConfig>)}
                  </span>
                  <div className="ms-pl-trk">
                    <div className="ms-pl-art" style={queueArtStyles[i]} data-field={`queue.${i}.art`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `queue.${i}.art` as keyof Required<MsPlaylistConfig>)}
                    </div>
                    <div>
                      <div className="ms-pl-ti">
                        {queueExplicit[i] && <em>E</em>}
                        <span data-field={`queue.${i}.title`} style={{ whiteSpace: 'pre-wrap' }}>
                          {pick(cfg, `queue.${i}.title` as keyof Required<MsPlaylistConfig>)}
                        </span>
                      </div>
                      <div className="ms-pl-ar" data-field={`queue.${i}.artist`} style={{ whiteSpace: 'pre-wrap' }}>
                        {pick(cfg, `queue.${i}.artist` as keyof Required<MsPlaylistConfig>)}
                      </div>
                    </div>
                  </div>
                  <span className="ms-pl-alb" data-field={`queue.${i}.album`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `queue.${i}.album` as keyof Required<MsPlaylistConfig>)}
                  </span>
                  <span className="ms-pl-dur" data-field={`queue.${i}.dur`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `queue.${i}.dur` as keyof Required<MsPlaylistConfig>)}
                    <span>{queueDurSubs[i]}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Side rail */}
        <aside className="ms-pl-side">
          {/* Featured / spotlight */}
          <div className="ms-pl-card ms-pl-featured" data-widget="featured">
            <div className="ms-pl-card-ey" data-field="featured.eyebrow" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'featured.eyebrow')}</div>
            <h3 className="ms-pl-card-h3" data-field="featured.title" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'featured.title')}</h3>
            <div className="ms-pl-featured-row">
              <div className="ms-pl-featured-pic" data-field="featured.art" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'featured.art')}</div>
              <div className="ms-pl-featured-info">
                <div className="ms-pl-featured-t" data-field="featured.name" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'featured.name')}</div>
                <div className="ms-pl-featured-s" data-field="featured.desc" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'featured.desc')}</div>
                <span className="ms-pl-featured-tag" data-field="featured.tag" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'featured.tag')}</span>
              </div>
            </div>
          </div>

          {/* Recently / recommended */}
          <div className="ms-pl-card ms-pl-recent" data-widget="recent">
            <div className="ms-pl-recent-head">
              <div>
                <div className="ms-pl-card-ey" data-field="recent.eyebrow" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'recent.eyebrow')}</div>
                <h3 className="ms-pl-card-h3" data-field="recent.title" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'recent.title')}</h3>
              </div>
              <span className="ms-pl-recent-more">SEE ALL</span>
            </div>
            <div className="ms-pl-recent-list">
              {([0, 1, 2, 3] as const).map((i) => {
                const hot = i === 0 || i === 1;
                const num = i + 1;
                return (
                  <div key={i} className="ms-pl-it" data-widget={`recent.${i}`}>
                    <span className={`ms-pl-it-n${hot ? ' ms-pl-it-n-hot' : ''}`}>{num}</span>
                    <div className="ms-pl-it-body">
                      <div className="ms-pl-it-t" data-field={`recent.${i}.t`} style={{ whiteSpace: 'pre-wrap' }}>
                        {pick(cfg, `recent.${i}.t` as keyof Required<MsPlaylistConfig>)}
                      </div>
                      <div className="ms-pl-it-s" data-field={`recent.${i}.s`} style={{ whiteSpace: 'pre-wrap' }}>
                        {pick(cfg, `recent.${i}.s` as keyof Required<MsPlaylistConfig>)}
                      </div>
                    </div>
                    <span className="ms-pl-it-when" data-field={`recent.${i}.w`} style={{ whiteSpace: 'pre-wrap' }}>
                      {pick(cfg, `recent.${i}.w` as keyof Required<MsPlaylistConfig>)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mini stats card */}
          <div className="ms-pl-stats" data-widget="stats">
            <div className="ms-pl-cell" data-widget="stats.attendance">
              <span className="ms-pl-cell-k" data-field="stats.attendance.k" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'stats.attendance.k')}</span>
              <span className="ms-pl-cell-v ms-pl-green" data-field="stats.attendance.v" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'stats.attendance.v')}</span>
            </div>
            <div className="ms-pl-dv" />
            <div className="ms-pl-cell" data-widget="stats.lunch">
              <span className="ms-pl-cell-k" data-field="stats.lunch.k" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'stats.lunch.k')}</span>
              <span className="ms-pl-cell-v ms-pl-warm" data-field="stats.lunch.v" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'stats.lunch.v')}</span>
            </div>
            <div className="ms-pl-dv" />
            <div className="ms-pl-cell" data-widget="stats.bus">
              <span className="ms-pl-cell-k" data-field="stats.bus.k" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'stats.bus.k')}</span>
              <span className="ms-pl-cell-v" data-field="stats.bus.v" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'stats.bus.v')}</span>
            </div>
          </div>
        </aside>
      </section>

      {/* ─── BOTTOM · ALERT + TICKER ─────────────────────── */}
      <section className="ms-pl-bottom">
        <div className="ms-pl-alert" data-widget="alert">
          <div className="ms-pl-alert-ico" data-field="alert.ico" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'alert.ico')}</div>
          <div className="ms-pl-alert-body">
            <div className="ms-pl-alert-ey" data-field="alert.eyebrow" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'alert.eyebrow')}</div>
            <div className="ms-pl-alert-msg" data-field="alert.message" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'alert.message')}</div>
          </div>
          <div className="ms-pl-alert-when" data-field="alert.when" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'alert.when')}</div>
        </div>

        <div className="ms-pl-ticker" data-widget="ticker">
          <div className="ms-pl-ticker-badge" data-field="ticker.tag" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.tag')}</div>
          <div className="ms-pl-ticker-feed">
            <div className="ms-pl-ticker-inner">
              <span data-field="ticker.0" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.0')}</span>
              <span data-field="ticker.1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.1')}</span>
              <span data-field="ticker.2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.2')}</span>
              <span data-field="ticker.3" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.3')}</span>
              <span data-field="ticker.4" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.4')}</span>
              <span data-field="ticker.5" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.5')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.0')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.1')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.2')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.3')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.4')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.5')}</span>
            </div>
          </div>
        </div>
      </section>
    </HsStage>
  );
}

/** Inlined CSS — every pixel value matches scratch/design/playlist-ms-v2.html. */
const CSS = `
/* Shared box-sizing on every panel that sets explicit width.
   Without this the right column drifts past its intended edge. */
.ms-pl-appbar, .ms-pl-hero, .ms-pl-cover, .ms-pl-now,
.ms-pl-middle, .ms-pl-queue, .ms-pl-side, .ms-pl-card,
.ms-pl-stats, .ms-pl-bottom, .ms-pl-alert, .ms-pl-ticker,
.ms-pl-mt, .ms-pl-device,
.ms-pl-appbar *, .ms-pl-hero *, .ms-pl-middle *, .ms-pl-bottom * {
  box-sizing: border-box;
}

/* Subtle film-grain noise overlay — matches .stage::before */
.ms-pl-grain {
  position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: .4;
  background-image:
    radial-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
    radial-gradient(rgba(255,255,255,.012) 1px, transparent 1px);
  background-size: 3px 3px, 7px 7px;
  background-position: 0 0, 1px 2px;
  mix-blend-mode: screen;
}

/* ─── TOP APP BAR ────────────────────────────────────────── */
.ms-pl-appbar {
  position: absolute; top: 56px; left: 64px; right: 64px; height: 200px;
  background: linear-gradient(180deg, rgba(24,24,33,.85), rgba(24,24,33,.55));
  border: 1px solid #2a2a37;
  border-radius: 28px;
  backdrop-filter: blur(20px);
  padding: 28px 44px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 56px; align-items: center;
  z-index: 2;
}

/* Brand lockup */
.ms-pl-brand { display: flex; align-items: center; gap: 32px; }
.ms-pl-mark {
  width: 144px; height: 144px; border-radius: 50%; flex-shrink: 0;
  background:
    radial-gradient(circle at 35% 30%, #2bf07a, #1ed760 55%, #0e6e30 100%);
  box-shadow:
    0 0 0 4px rgba(30,215,96,.25),
    0 18px 50px rgba(30,215,96,.35),
    inset 0 -10px 20px rgba(0,0,0,.25);
  position: relative;
  display: grid; place-items: center;
}
.ms-pl-mark::before {
  /* Three sound-wave arcs */
  content: ''; position: absolute; inset: 28px;
  background:
    radial-gradient(circle at 40% 100%, transparent 36px, #000 36px, #000 41px, transparent 41px),
    radial-gradient(circle at 40% 100%, transparent 56px, #000 56px, #000 61px, transparent 61px),
    radial-gradient(circle at 40% 100%, transparent 76px, #000 76px, #000 81px, transparent 81px);
}
.ms-pl-brand-info .ms-pl-eye {
  font-family: 'JetBrains Mono', monospace; font-size: 26px; font-weight: 700;
  letter-spacing: .26em; text-transform: uppercase; color: #1ed760;
  display: inline-flex; align-items: center; gap: 14px;
}
.ms-pl-brand-info .ms-pl-eye::before {
  content: ''; width: 36px; height: 3px; background: #1ed760;
}
.ms-pl-brand-info .ms-pl-name {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 84px;
  color: #f7f7fb; line-height: 1; letter-spacing: -.03em;
  margin-top: 6px;
}
.ms-pl-brand-info .ms-pl-name span { color: #1ed760; }
.ms-pl-brand-info .ms-pl-sub {
  font-family: 'JetBrains Mono', monospace; font-size: 26px; font-weight: 500;
  color: #b3b3c7; letter-spacing: .14em; text-transform: uppercase;
  margin-top: 6px;
}
.ms-pl-brand-info .ms-pl-sub b { color: #ffc94d; font-weight: 700; }

/* Center — "Playing on …" device chip */
.ms-pl-device {
  justify-self: center;
  background: rgba(30,215,96,.10);
  border: 2px solid #1ed760;
  border-radius: 999px;
  padding: 22px 38px;
  display: flex; align-items: center; gap: 26px;
  box-shadow: 0 0 0 6px rgba(30,215,96,.06), inset 0 0 30px rgba(30,215,96,.08);
}
.ms-pl-device-ico {
  width: 64px; height: 64px; border-radius: 14px;
  background: linear-gradient(135deg, #1ed760, #169c45);
  display: grid; place-items: center; position: relative; flex-shrink: 0;
}
.ms-pl-device-ico::before, .ms-pl-device-ico::after {
  content: ''; position: absolute; left: 14px; right: 14px; border-radius: 6px;
  background: rgba(0,0,0,.55);
}
.ms-pl-device-ico::before { top: 12px; height: 16px; }
.ms-pl-device-ico::after  { top: 36px; height: 8px; right: 30px; }
.ms-pl-device-info .ms-pl-device-k {
  font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 700;
  letter-spacing: .26em; text-transform: uppercase; color: #1ed760;
  display: flex; align-items: center; gap: 10px;
}
.ms-pl-device-info .ms-pl-device-k::before {
  content: ''; width: 14px; height: 14px; border-radius: 50%; background: #1ed760;
  box-shadow: 0 0 0 4px rgba(30,215,96,.3);
  animation: msPlPulse 1.6s ease-in-out infinite;
}
@keyframes msPlPulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(30,215,96,.3); }
  50%      { box-shadow: 0 0 0 10px rgba(30,215,96,0); }
}
.ms-pl-device-info .ms-pl-device-v {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 42px;
  color: #f7f7fb; line-height: 1.05; letter-spacing: -.015em;
  margin-top: 4px;
}

/* Right — meta tiles + profile */
.ms-pl-meta-tiles { display: flex; gap: 20px; align-items: center; }
.ms-pl-mt {
  background: rgba(35,35,48,.7);
  border: 1px solid #2a2a37;
  border-radius: 18px;
  padding: 16px 24px;
  min-width: 168px;
  display: flex; flex-direction: column; gap: 4px;
}
.ms-pl-mt .ms-pl-mt-k {
  font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: #6e6e85;
}
.ms-pl-mt .ms-pl-mt-v {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 56px;
  color: #f7f7fb; line-height: 1; letter-spacing: -.02em;
}
.ms-pl-mt .ms-pl-mt-v.ms-pl-warm { color: #ffc94d; }
.ms-pl-mt .ms-pl-mt-v.ms-pl-cool { color: #6f8bff; }
.ms-pl-mt .ms-pl-mt-v.ms-pl-green { color: #1ed760; }
.ms-pl-mt .ms-pl-mt-v sup { font-size: 28px; vertical-align: super; }

.ms-pl-avatar {
  width: 96px; height: 96px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #ff8a4a, #f23985 55%, #6b1f3a);
  display: grid; place-items: center;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 38px; color: #fff;
  border: 4px solid #f7f7fb;
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
}

/* ─── HERO · NOW PLAYING ─────────────────────────────────── */
.ms-pl-hero {
  position: absolute; top: 276px; left: 64px; right: 64px; height: 1000px;
  background:
    radial-gradient(ellipse 1400px 800px at 18% 50%, rgba(30,215,96,.32), transparent 60%),
    linear-gradient(135deg, #0e2a1c 0%, #061812 50%, #02080a 100%);
  border: 1px solid rgba(30,215,96,.22);
  border-radius: 36px;
  padding: 50px 56px;
  display: grid;
  grid-template-columns: 900px 1fr;
  gap: 56px;
  overflow: hidden;
  z-index: 2;
}
.ms-pl-hero::before {
  /* Big emerald glow blob in the corner */
  content: ''; position: absolute; right: -260px; top: -260px;
  width: 900px; height: 900px; border-radius: 50%;
  background: radial-gradient(circle, rgba(30,215,96,.45), transparent 60%);
  pointer-events: none;
}
.ms-pl-hero::after {
  /* Magenta echo blob */
  content: ''; position: absolute; right: 220px; bottom: -220px;
  width: 600px; height: 600px; border-radius: 50%;
  background: radial-gradient(circle, rgba(242,57,133,.22), transparent 70%);
  pointer-events: none;
}

/* Album art tile — 900 × 900 */
.ms-pl-cover {
  width: 900px; height: 900px; border-radius: 28px;
  position: relative; overflow: hidden;
  background:
    radial-gradient(circle at 30% 25%, #2bf07a 0%, #1ed760 35%, #0e6e30 70%, #053c1a 100%);
  box-shadow:
    0 50px 120px rgba(0,0,0,.6),
    0 20px 50px rgba(30,215,96,.35),
    inset 0 0 0 1px rgba(255,255,255,.08);
}
.ms-pl-cover::before {
  /* Glossy highlight + paper grain */
  content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(circle at 22% 18%, rgba(255,255,255,.32), transparent 38%),
    radial-gradient(circle at 80% 80%, rgba(0,0,0,.45), transparent 52%),
    repeating-linear-gradient(45deg, rgba(255,255,255,.02) 0 2px, transparent 2px 5px);
}
.ms-pl-cover::after {
  /* Diagonal "tape" stripe across upper-right */
  content: ''; position: absolute; right: -180px; top: 60px; width: 800px; height: 80px;
  background: linear-gradient(90deg, transparent 0%, rgba(255,201,77,.95) 30%, rgba(255,201,77,.95) 70%, transparent 100%);
  transform: rotate(28deg); transform-origin: 50% 50%;
  box-shadow: 0 8px 30px rgba(0,0,0,.4);
  opacity: .85;
}
.ms-pl-albumtxt {
  position: absolute; inset: 0; padding: 64px;
  display: flex; flex-direction: column; justify-content: space-between;
  z-index: 1;
}
.ms-pl-cover-top {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px;
  letter-spacing: .26em; text-transform: uppercase;
  color: rgba(255,255,255,.85);
  display: flex; align-items: center; gap: 18px;
}
.ms-pl-cover-top::before {
  content: ''; width: 18px; height: 18px; border-radius: 50%; background: #fff;
  animation: msPlPulse 1.6s ease-in-out infinite;
}
.ms-pl-cover-big {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 360px;
  line-height: .82; color: #fff; letter-spacing: -.05em;
  text-shadow: 0 10px 40px rgba(0,0,0,.45);
}
.ms-pl-cover-row {
  display: flex; justify-content: space-between; align-items: flex-end; gap: 24px;
}
.ms-pl-cover-meta {
  font-family: 'Inter', system-ui, sans-serif; font-weight: 600; font-size: 30px;
  color: rgba(255,255,255,.92); letter-spacing: -.005em;
}
.ms-pl-cover-meta b {
  display: block;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 56px;
  letter-spacing: -.02em; line-height: 1; margin-bottom: 6px;
}
.ms-pl-cover-heart {
  width: 84px; height: 84px; border-radius: 50%;
  background: rgba(0,0,0,.45); border: 3px solid #fff;
  display: grid; place-items: center;
  font-size: 44px; color: #fff;
  backdrop-filter: blur(8px);
}

/* Now-playing right column */
.ms-pl-now { display: flex; flex-direction: column; min-width: 0; padding-top: 24px; }
.ms-pl-now-eyebrow {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px;
  letter-spacing: .26em; text-transform: uppercase; color: #1ed760;
  display: inline-flex; align-items: center; gap: 18px;
}
.ms-pl-now-eyebrow::before {
  content: ''; width: 18px; height: 18px; border-radius: 50%; background: #1ed760;
  animation: msPlPulse 1.6s ease-in-out infinite;
}
.ms-pl-now-h1 {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 184px;
  line-height: .88; color: #f7f7fb; margin: 22px 0 0;
  letter-spacing: -.035em; text-wrap: balance;
}
.ms-pl-now-h1 em { font-style: normal; color: #1ed760; }
.ms-pl-now-artist {
  font-family: 'Inter', system-ui, sans-serif; font-weight: 600; font-size: 56px;
  color: #b3b3c7; margin-top: 30px; line-height: 1.1;
  letter-spacing: -.005em;
}
.ms-pl-now-artist b { color: #f7f7fb; font-weight: 700; }

/* Chip row */
.ms-pl-chips {
  display: flex; gap: 16px; margin-top: 32px; flex-wrap: wrap; align-items: center;
}
.ms-pl-chip {
  background: rgba(255,255,255,.08); color: #f7f7fb;
  padding: 14px 28px; border-radius: 999px;
  font-family: 'Inter', system-ui, sans-serif; font-weight: 700; font-size: 30px;
  letter-spacing: -.005em;
  border: 1px solid rgba(255,255,255,.14);
}
.ms-pl-chip-exp {
  background: #f7f7fb; color: #000;
  width: 60px; height: 60px; padding: 0;
  display: grid; place-items: center;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 30px;
  border-radius: 12px; border: 0;
}
.ms-pl-chip-green {
  background: rgba(30,215,96,.18); border-color: #1ed760; color: #1ed760;
}
.ms-pl-chip-meta {
  font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 26px;
  color: #b3b3c7; letter-spacing: .12em; text-transform: uppercase;
  margin-left: 8px;
}

/* Equalizer bars */
.ms-pl-eq {
  display: flex; align-items: flex-end; gap: 10px; height: 90px;
  margin-top: 36px;
  transform-origin: bottom;
}
.ms-pl-eq span {
  width: 14px; background: #1ed760; border-radius: 4px;
  animation: msPlDance 1.1s ease-in-out infinite alternate;
  box-shadow: 0 0 16px rgba(30,215,96,.5);
  transform-origin: bottom;
}
.ms-pl-eq span:nth-child(1)  { animation-delay: -0.05s; height: 60%; }
.ms-pl-eq span:nth-child(2)  { animation-delay: -0.20s; height: 80%; }
.ms-pl-eq span:nth-child(3)  { animation-delay: -0.35s; height: 45%; }
.ms-pl-eq span:nth-child(4)  { animation-delay: -0.10s; height: 90%; }
.ms-pl-eq span:nth-child(5)  { animation-delay: -0.40s; height: 70%; }
.ms-pl-eq span:nth-child(6)  { animation-delay: -0.25s; height: 55%; }
.ms-pl-eq span:nth-child(7)  { animation-delay: -0.15s; height: 85%; }
.ms-pl-eq span:nth-child(8)  { animation-delay: -0.30s; height: 40%; }
.ms-pl-eq span:nth-child(9)  { animation-delay: -0.05s; height: 75%; }
.ms-pl-eq span:nth-child(10) { animation-delay: -0.45s; height: 50%; }
.ms-pl-eq span:nth-child(11) { animation-delay: -0.18s; height: 90%; }
.ms-pl-eq span:nth-child(12) { animation-delay: -0.32s; height: 65%; }
.ms-pl-eq span:nth-child(13) { animation-delay: -0.08s; height: 80%; }
.ms-pl-eq span:nth-child(14) { animation-delay: -0.22s; height: 45%; }
@keyframes msPlDance {
  from { transform: scaleY(.35); opacity: .7; }
  to   { transform: scaleY(1);   opacity: 1; }
}

/* Progress bar */
.ms-pl-progress { margin-top: auto; padding-top: 32px; }
.ms-pl-track {
  height: 18px; background: rgba(255,255,255,.16); border-radius: 999px;
  position: relative; overflow: visible;
}
.ms-pl-fill {
  position: absolute; inset: 0; width: 62%;
  background: linear-gradient(90deg, #169c45, #1ed760 80%, #4cffa1);
  border-radius: 999px;
  box-shadow: 0 0 24px rgba(30,215,96,.6);
}
.ms-pl-knob {
  position: absolute; left: 62%; top: 50%;
  width: 36px; height: 36px; border-radius: 50%; background: #fff;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 6px rgba(30,215,96,.32), 0 6px 18px rgba(0,0,0,.5);
}
.ms-pl-times {
  display: flex; justify-content: space-between; margin-top: 18px;
  font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 30px;
  color: #b3b3c7; letter-spacing: .04em;
}
.ms-pl-times .ms-pl-time-left { color: #f7f7fb; }

/* Transport controls */
.ms-pl-ctrls {
  display: flex; align-items: center; justify-content: flex-end;
  gap: 24px; margin-top: 24px;
}
.ms-pl-btn {
  width: 84px; height: 84px; border-radius: 50%;
  background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.14);
  display: grid; place-items: center;
  color: #f7f7fb; font-size: 40px; font-weight: 900;
}
.ms-pl-btn-play {
  width: 132px; height: 132px;
  background: #1ed760; color: #000;
  box-shadow: 0 0 0 8px rgba(30,215,96,.18), 0 18px 50px rgba(30,215,96,.45);
  border: 0;
  font-size: 56px;
}

/* ─── MIDDLE ROW · QUEUE + SIDE RAIL ─────────────────────── */
.ms-pl-middle {
  position: absolute; top: 1296px; left: 64px; right: 64px; height: 660px;
  display: grid; grid-template-columns: 2540px 1fr; gap: 20px;
  z-index: 2;
}

/* Up Next queue */
.ms-pl-queue {
  background: #181821;
  border: 1px solid #2a2a37;
  border-radius: 28px;
  padding: 24px 36px 16px;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.ms-pl-queue-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  padding-bottom: 14px; border-bottom: 2px solid #2a2a37;
}
.ms-pl-queue-h2 {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 64px;
  color: #f7f7fb; margin: 0; line-height: 1; letter-spacing: -.025em;
}
.ms-pl-queue-h2 em {
  font-style: normal; color: #1ed760;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900;
}
.ms-pl-queue-meta {
  display: flex; align-items: center; gap: 18px;
}
.ms-pl-queue-day {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .2em; text-transform: uppercase; color: #b3b3c7;
}
.ms-pl-queue-day b { color: #ffc94d; }
.ms-pl-queue-pill {
  background: rgba(30,215,96,.16); border: 1px solid #1ed760;
  color: #1ed760; padding: 8px 18px; border-radius: 999px;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .14em; text-transform: uppercase;
}

.ms-pl-colhd {
  display: grid;
  grid-template-columns: 80px 1fr 700px 180px;
  gap: 28px; align-items: center;
  padding: 16px 16px 10px;
  border-bottom: 1px solid #2a2a37;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 20px;
  color: #6e6e85; letter-spacing: .2em; text-transform: uppercase;
}
.ms-pl-colhd .ms-pl-r { text-align: right; }
.ms-pl-list { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
.ms-pl-row {
  display: grid;
  grid-template-columns: 80px 1fr 700px 180px;
  gap: 28px; align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(42,42,55,.55);
  position: relative;
}
.ms-pl-row:last-child { border-bottom: 0; }
.ms-pl-idx {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 34px;
  color: #6e6e85; text-align: center;
}
.ms-pl-trk {
  display: grid; grid-template-columns: 80px 1fr; gap: 20px; align-items: center;
  min-width: 0;
}
.ms-pl-art {
  width: 80px; height: 80px; border-radius: 12px;
  display: grid; place-items: center;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 38px; color: #fff;
  letter-spacing: -.02em; box-shadow: 0 6px 18px rgba(0,0,0,.4);
  position: relative; overflow: hidden;
}
.ms-pl-art::before {
  content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(circle at 28% 22%, rgba(255,255,255,.25), transparent 50%),
    radial-gradient(circle at 80% 85%, rgba(0,0,0,.32), transparent 55%);
}
.ms-pl-ti {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 36px;
  color: #f7f7fb; line-height: 1.05; letter-spacing: -.018em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-pl-ti em {
  display: inline-block; vertical-align: middle;
  background: #f7f7fb; color: #000;
  width: 28px; height: 28px; line-height: 28px; text-align: center;
  border-radius: 6px; font-size: 18px; font-style: normal;
  font-family: 'Inter', system-ui, sans-serif; font-weight: 900;
  margin-right: 12px; transform: translateY(-3px);
}
.ms-pl-ar {
  font-family: 'Inter', system-ui, sans-serif; font-weight: 500; font-size: 26px;
  color: #b3b3c7; margin-top: 4px; letter-spacing: -.005em;
}
.ms-pl-alb {
  font-family: 'Inter', system-ui, sans-serif; font-weight: 600; font-size: 28px;
  color: #b3b3c7; letter-spacing: -.005em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-pl-dur {
  font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 32px;
  color: #f7f7fb; text-align: right; letter-spacing: .04em;
}
.ms-pl-dur span {
  display: block;
  font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 500;
  color: #6e6e85; letter-spacing: .14em; text-transform: uppercase;
  margin-top: 4px;
}
/* Up-next row (current top of queue) — green left bar + tinted bg */
.ms-pl-row-up {
  background: linear-gradient(90deg, rgba(30,215,96,.14), transparent 60%);
}
.ms-pl-row-up::before {
  content: ''; position: absolute; left: 0; top: 16px; bottom: 16px; width: 6px;
  background: #1ed760; border-radius: 0 4px 4px 0;
}
.ms-pl-row-up .ms-pl-idx { color: #1ed760; }

/* ─── SIDE RAIL ──────────────────────────────────────────── */
.ms-pl-side {
  display: grid; grid-template-rows: auto 1fr auto; gap: 20px;
  min-height: 0;
}
.ms-pl-card {
  background: #181821; border: 1px solid #2a2a37;
  border-radius: 28px; padding: 24px 28px;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.ms-pl-card-ey {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  color: #1ed760; letter-spacing: .22em; text-transform: uppercase;
}
.ms-pl-card-h3 {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 48px;
  color: #f7f7fb; margin: 6px 0 0; letter-spacing: -.025em; line-height: 1;
}

/* Featured card — magenta gradient */
.ms-pl-featured {
  background:
    radial-gradient(circle at 80% 0%, rgba(242,57,133,.55), transparent 60%),
    linear-gradient(135deg, #2a0d22 0%, #14060f 100%);
  border-color: rgba(242,57,133,.4);
  position: relative;
  padding: 28px 30px;
}
.ms-pl-featured .ms-pl-card-ey { color: #f23985; }
.ms-pl-featured-row {
  display: grid; grid-template-columns: 144px 1fr; gap: 22px; align-items: center;
  margin-top: 16px;
}
.ms-pl-featured-pic {
  width: 144px; height: 144px; border-radius: 16px;
  background: linear-gradient(135deg, #ffb1cd, #f23985 50%, #6b1f3a);
  display: grid; place-items: center;
  font-size: 76px; line-height: 1;
  box-shadow: 0 12px 30px rgba(0,0,0,.5);
  position: relative; overflow: hidden;
}
.ms-pl-featured-pic::before {
  content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(circle at 28% 22%, rgba(255,255,255,.28), transparent 55%),
    radial-gradient(circle at 80% 80%, rgba(0,0,0,.35), transparent 55%);
}
.ms-pl-featured-t {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 42px;
  color: #f7f7fb; line-height: 1.05; letter-spacing: -.02em;
}
.ms-pl-featured-s {
  font-family: 'Inter', system-ui, sans-serif; font-weight: 500; font-size: 26px;
  color: #b3b3c7; margin-top: 8px; line-height: 1.25;
}
.ms-pl-featured-tag {
  display: inline-block; margin-top: 12px;
  background: #f23985; color: #fff;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  padding: 8px 18px; border-radius: 999px;
  letter-spacing: .18em; text-transform: uppercase;
}

/* Recently played list */
.ms-pl-recent { padding: 26px 30px; flex: 1; min-height: 0; }
.ms-pl-recent-head {
  display: flex; justify-content: space-between; align-items: baseline;
}
.ms-pl-recent-more {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 18px;
  color: #6e6e85; letter-spacing: .2em; text-transform: uppercase;
}
.ms-pl-recent-list {
  display: flex; flex-direction: column; gap: 12px; margin-top: 14px;
}
.ms-pl-it {
  display: grid; grid-template-columns: 64px 1fr auto; gap: 18px; align-items: center;
  padding: 6px 0;
}
.ms-pl-it-n {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 36px;
  color: #6e6e85; text-align: center; letter-spacing: -.02em;
}
.ms-pl-it-n-hot { color: #ffc94d; }
.ms-pl-it-body { min-width: 0; }
.ms-pl-it-t {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 800; font-size: 30px;
  color: #f7f7fb; line-height: 1.05; letter-spacing: -.015em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-pl-it-s {
  font-family: 'Inter', system-ui, sans-serif; font-weight: 500; font-size: 22px;
  color: #b3b3c7; margin-top: 4px; line-height: 1.2;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-pl-it-when {
  font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 22px;
  color: #b3b3c7; letter-spacing: .04em;
}

/* Mini stats card — clock / weather / countdown */
.ms-pl-stats {
  background: #181821;
  border: 1px solid #2a2a37;
  border-radius: 28px;
  padding: 20px 24px;
  display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; gap: 16px; align-items: center;
}
.ms-pl-cell {
  display: flex; flex-direction: column; gap: 4px;
}
.ms-pl-cell-k {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 18px;
  letter-spacing: .2em; text-transform: uppercase; color: #6e6e85;
}
.ms-pl-cell-v {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 46px;
  color: #f7f7fb; line-height: 1; letter-spacing: -.02em;
}
.ms-pl-cell-v.ms-pl-warm { color: #ffc94d; }
.ms-pl-cell-v.ms-pl-green { color: #1ed760; }
.ms-pl-dv { width: 1px; height: 60px; background: #2a2a37; }

/* ─── BOTTOM · ALERT + TICKER ────────────────────────────── */
.ms-pl-bottom {
  position: absolute; bottom: 20px; left: 64px; right: 64px; height: 144px;
  display: grid; grid-template-columns: 1300px 1fr; gap: 20px;
  z-index: 2;
}

.ms-pl-alert {
  background: #ffc94d; color: #181101;
  border-radius: 28px;
  padding: 0 32px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 24px; align-items: center;
  box-shadow: 0 12px 40px rgba(255,201,77,.25);
  overflow: hidden;
}
.ms-pl-alert-ico {
  width: 80px; height: 80px; border-radius: 18px; flex-shrink: 0;
  background: #181101; color: #ffc94d;
  display: grid; place-items: center;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 48px;
  box-shadow: inset 0 -4px 0 rgba(0,0,0,.3);
}
.ms-pl-alert-body { min-width: 0; }
.ms-pl-alert-ey {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .26em; text-transform: uppercase; color: rgba(24,17,1,.7);
}
.ms-pl-alert-msg {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 38px;
  color: #181101; line-height: 1.05; letter-spacing: -.018em; margin-top: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-pl-alert-when {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px;
  letter-spacing: .14em; text-transform: uppercase;
  background: #181101; color: #ffc94d;
  padding: 14px 22px; border-radius: 999px;
  flex-shrink: 0;
}

.ms-pl-ticker {
  background: #181821;
  border: 1px solid #2a2a37;
  border-radius: 28px;
  display: grid; grid-template-columns: auto 1fr; align-items: stretch;
  overflow: hidden;
}
.ms-pl-ticker-badge {
  background: #1ed760; color: #000;
  padding: 0 38px;
  display: flex; align-items: center; gap: 18px;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 38px;
  letter-spacing: -.01em;
  flex-shrink: 0;
}
.ms-pl-ticker-badge::before {
  content: ''; width: 18px; height: 18px; border-radius: 50%; background: #000;
  animation: msPlPulse 1.6s ease-in-out infinite;
}
.ms-pl-ticker-feed {
  overflow: hidden; display: flex; align-items: center;
  padding: 0 24px;
}
.ms-pl-ticker-inner {
  display: flex; gap: 56px;
  font-family: 'Inter', system-ui, sans-serif; font-weight: 600; font-size: 38px;
  color: #f7f7fb; white-space: nowrap;
  animation: msPlScroll 60s linear infinite;
  letter-spacing: -.005em;
}
.ms-pl-ticker-inner span { display: inline-flex; align-items: center; }
.ms-pl-ticker-inner span::after {
  content: '•'; color: #1ed760; margin-left: 56px; font-size: 38px;
}
@keyframes msPlScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
`;
