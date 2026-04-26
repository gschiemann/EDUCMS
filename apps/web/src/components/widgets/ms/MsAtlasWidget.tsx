"use client";

/**
 * MsAtlasWidget — Middle-school lobby scene, 3840×2160 (Atlas / cartographic theme).
 *
 * APPROVED 2026-04-25 — matches scratch/design/atlas-ms-v2.html.
 * Reviewed by user, ported via HsStage scale pattern. DO NOT
 * regress to vw/% units. Every pixel size must match the mockup.
 *
 * Scene layout (panels arranged on a 3840×2160 stage):
 *   - top         → compass lockup + center date banner + 3 weather/time tiles
 *   - hero-row    → travel poster (left) + campus map SVG with 4 numbered pins (right)
 *   - lines       → "Today's Routes" — 4 transit-style line cards (Morning / Afternoon / Lunch / Clubs)
 *   - bottom      → destination spotlight + scrolling news ticker
 *
 * box-sizing: border-box on every panel that sets an explicit width is
 * load-bearing — the .poster panel (1750px wide with 80px horizontal
 * padding + 5px borders) and the .lines panel (right-anchored with 44px
 * padding + 5px border) both rely on it to land on their intended edge.
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsAtlasConfig {
  // Top band — brand
  'brand.eye'?: string;
  'brand.name'?: string;
  'brand.sub'?: string;
  'brand.subDay'?: string;
  // Top band — center date banner
  'banner.label'?: string;
  'banner.date'?: string;
  'banner.stamp'?: string;
  // Top band — meta tiles
  'meta.temp.label'?: string;
  'meta.temp.value'?: string;
  'meta.sky.label'?: string;
  'meta.sky.value'?: string;
  'meta.time.label'?: string;
  'meta.time.value'?: string;
  // Hero — poster
  'poster.chapter'?: string;
  'poster.h1.go'?: string;
  'poster.h1.em'?: string;
  'poster.h1.mark'?: string;
  'poster.lede'?: string;
  'poster.dest.0'?: string;
  'poster.dest.1'?: string;
  'poster.dest.2'?: string;
  'poster.dest.3'?: string;
  // Hero — map
  'map.title'?: string;
  'map.scale.label'?: string;
  'map.scale.value'?: string;
  'map.pin.0.tag'?: string;
  'map.pin.1.tag'?: string;
  'map.pin.2.tag'?: string;
  'map.pin.3.tag'?: string;
  'map.legend.0'?: string;
  'map.legend.1'?: string;
  'map.legend.2'?: string;
  'map.legend.3'?: string;
  'map.legend.compass'?: string;
  // Lines — header
  'lines.title.go'?: string;
  'lines.title.em'?: string;
  'lines.meta'?: string;
  // Lines — Morning (gold)
  'lines.morning.badge'?: string;
  'lines.morning.name'?: string;
  'lines.morning.periods'?: string;
  'lines.morning.stop.0'?: string;
  'lines.morning.stop.1'?: string;
  'lines.morning.stop.2'?: string;
  'lines.morning.next.title'?: string;
  'lines.morning.next.sub'?: string;
  'lines.morning.status'?: string;
  // Lines — Afternoon (red)
  'lines.afternoon.badge'?: string;
  'lines.afternoon.name'?: string;
  'lines.afternoon.periods'?: string;
  'lines.afternoon.stop.0'?: string;
  'lines.afternoon.stop.1'?: string;
  'lines.afternoon.stop.2'?: string;
  'lines.afternoon.next.title'?: string;
  'lines.afternoon.next.sub'?: string;
  'lines.afternoon.status'?: string;
  // Lines — Lunch (blue)
  'lines.lunch.badge'?: string;
  'lines.lunch.name'?: string;
  'lines.lunch.periods'?: string;
  'lines.lunch.stop.0'?: string;
  'lines.lunch.stop.1'?: string;
  'lines.lunch.stop.2'?: string;
  'lines.lunch.next.title'?: string;
  'lines.lunch.next.sub'?: string;
  'lines.lunch.status'?: string;
  // Lines — Clubs (green)
  'lines.clubs.badge'?: string;
  'lines.clubs.name'?: string;
  'lines.clubs.periods'?: string;
  'lines.clubs.stop.0'?: string;
  'lines.clubs.stop.1'?: string;
  'lines.clubs.stop.2'?: string;
  'lines.clubs.next.title'?: string;
  'lines.clubs.next.sub'?: string;
  'lines.clubs.status'?: string;
  // Bottom — destination spotlight
  'spot.eyebrow'?: string;
  'spot.title'?: string;
  'spot.sub'?: string;
  // Bottom — ticker
  'ticker.tag'?: string;
  'ticker.0'?: string;
  'ticker.1'?: string;
  'ticker.2'?: string;
  'ticker.3'?: string;
  'ticker.4'?: string;
  'ticker.5'?: string;
}

export const DEFAULTS: Required<MsAtlasConfig> = {
  // Top band — brand
  'brand.eye': 'Middle School Atlas',
  'brand.name': 'WESTRIDGE.MS',
  'brand.sub': '42.3601° N · 71.0589° W · ',
  'brand.subDay': 'DAY B',
  // Top band — center date banner
  'banner.label': 'Entry · Volume 07',
  'banner.date': 'Tuesday, Apr 21',
  'banner.stamp': 'Field Day · 12 days out',
  // Top band — meta tiles
  'meta.temp.label': 'Temp',
  'meta.temp.value': '46°',
  'meta.sky.label': 'Sky',
  'meta.sky.value': '☀',
  'meta.time.label': 'Time',
  'meta.time.value': '07:53',
  // Hero — poster
  'poster.chapter': 'Chapter 147 · Morning Edition',
  'poster.h1.go': 'Go ',
  'poster.h1.em': 'forth,',
  'poster.h1.mark': 'Otters.',
  'poster.lede':
    'Today’s journey assembles at 08:05. Pack pencil, journal, and a quiet bit of courage. Mr. Nguyen awaits in Room 108 — the poetry workshop has a new chapter for you.',
  'poster.dest.0': 'Rm 108 · Poetry',
  'poster.dest.1': 'Gym A · Mile Run',
  'poster.dest.2': 'Lib · Sign-ups Close Fri',
  'poster.dest.3': 'Aud · Drama Auditions',
  // Hero — map
  'map.title': 'Campus Map',
  'map.scale.label': 'Scale',
  'map.scale.value': '1in : 50ft',
  'map.pin.0.tag': 'RM 108 · POETRY',
  'map.pin.1.tag': 'GYM A · MILE RUN',
  'map.pin.2.tag': 'DRAMA AUDITIONS',
  'map.pin.3.tag': 'LUNCH · A PERIOD',
  'map.legend.0': 'Today’s stops',
  'map.legend.1': 'PE',
  'map.legend.2': 'Dining',
  'map.legend.3': 'Activities',
  'map.legend.compass': '↑ N',
  // Lines — header
  'lines.title.go': 'Today’s ',
  'lines.title.em': 'Routes',
  'lines.meta': '4 lines · 22 stops · on schedule',
  // Lines — Morning
  'lines.morning.badge': 'AM',
  'lines.morning.name': 'Morning Line',
  'lines.morning.periods': 'P1 · P2 · P3',
  'lines.morning.stop.0': 'MATH',
  'lines.morning.stop.1': 'ENG',
  'lines.morning.stop.2': 'SCI',
  'lines.morning.next.title': 'Now arriving',
  'lines.morning.next.sub': 'Rm 108 · Mr. Nguyen',
  'lines.morning.status': 'On time',
  // Lines — Afternoon
  'lines.afternoon.badge': 'PM',
  'lines.afternoon.name': 'Afternoon Line',
  'lines.afternoon.periods': 'P4 · P5 · P6',
  'lines.afternoon.stop.0': 'PE',
  'lines.afternoon.stop.1': 'SS',
  'lines.afternoon.stop.2': 'ART',
  'lines.afternoon.next.title': 'Next departure',
  'lines.afternoon.next.sub': 'Gym A · Mile run · 10:50',
  'lines.afternoon.status': '10:50',
  // Lines — Lunch
  'lines.lunch.badge': 'LN',
  'lines.lunch.name': 'Lunch Line',
  'lines.lunch.periods': 'A · B · C Period',
  'lines.lunch.stop.0': '7TH',
  'lines.lunch.stop.1': '8TH',
  'lines.lunch.stop.2': '6TH',
  'lines.lunch.next.title': 'Chicken & rice',
  'lines.lunch.next.sub': 'A-period · 7th grade · 11:45',
  'lines.lunch.status': '11:45',
  // Lines — Clubs
  'lines.clubs.badge': 'CL',
  'lines.clubs.name': 'Clubs Line',
  'lines.clubs.periods': 'After School',
  'lines.clubs.stop.0': 'ROB',
  'lines.clubs.stop.1': 'DRM',
  'lines.clubs.stop.2': 'BND',
  'lines.clubs.next.title': 'Robotics build week',
  'lines.clubs.next.sub': 'Rm 207 · 3:00 · rare loot',
  'lines.clubs.status': 'On time',
  // Bottom — destination spotlight
  'spot.eyebrow': 'Destination Today',
  'spot.title': 'Picture Day — Thu',
  'spot.sub': 'Full uniform · permission slips to front office by Wed',
  // Bottom — ticker
  'ticker.tag': 'NEWS',
  'ticker.0': 'Bus 14 running +10',
  'ticker.1': 'Sub covering Rm B-12',
  'ticker.2': 'Spelling bee sign-ups end Friday',
  'ticker.3': '8th grade field trip forms due tomorrow',
  'ticker.4': 'Library returns due this week',
  'ticker.5': 'Lost blue water bottle → front office',
};

/**
 * Pick a value from the merged config, falling back to DEFAULTS if the
 * caller passed an empty string. Mirrors the arcade widget's pattern of
 * "empty string → use default" — empty strings in the editor mean
 * "blank" but in the demo we want the demo copy.
 */
function pick<K extends keyof Required<MsAtlasConfig>>(
  cfg: MsAtlasConfig,
  key: K,
): string {
  const v = cfg[key];
  return (v === undefined || v === '' ? DEFAULTS[key] : v) as string;
}

export function MsAtlasWidget({ config }: { config?: MsAtlasConfig }) {
  const cfg = config || {};

  // Status pill class is per-line — bake the mockup's choices in once.
  const lineStatusClass = {
    morning: 'on',
    afternoon: 'soon',
    lunch: 'soon',
    clubs: 'on',
  } as const;

  // Stop "now" highlight position per line, again from the mockup.
  const lineNowIndex = {
    morning: 1,
    afternoon: -1,
    lunch: -1,
    clubs: -1,
  } as const;

  // Helper to render one route card (transit-line style)
  type LineKey = 'morning' | 'afternoon' | 'lunch' | 'clubs';
  const renderRoute = (key: LineKey, badgeColor: 'gold' | 'red' | 'blue' | 'green') => {
    const stops: Array<0 | 1 | 2> = [0, 1, 2];
    return (
      <div className="ms-atl-route" data-widget={`lines.${key}`} key={key}>
        <div className="ms-atl-label">
          <div className={`ms-atl-badge ms-atl-${badgeColor}`} data-field={`lines.${key}.badge`} style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, `lines.${key}.badge` as keyof Required<MsAtlasConfig>)}
          </div>
          <div className="ms-atl-name">
            <span data-field={`lines.${key}.name`} style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, `lines.${key}.name` as keyof Required<MsAtlasConfig>)}
            </span>
            <span data-field={`lines.${key}.periods`} style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, `lines.${key}.periods` as keyof Required<MsAtlasConfig>)}
            </span>
          </div>
        </div>
        <div className="ms-atl-stops">
          {stops.map((i) => {
            const cls = `ms-atl-st${lineNowIndex[key] === i ? ' ms-atl-now' : ''}`;
            return (
              <div className={cls} key={i}>
                <div className="ms-atl-dot" />
                <div
                  className="ms-atl-lb"
                  data-field={`lines.${key}.stop.${i}`}
                 style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, `lines.${key}.stop.${i}` as keyof Required<MsAtlasConfig>)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="ms-atl-detail">
          <div className="ms-atl-next">
            <span data-field={`lines.${key}.next.title`} style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, `lines.${key}.next.title` as keyof Required<MsAtlasConfig>)}
            </span>
            <span data-field={`lines.${key}.next.sub`} style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, `lines.${key}.next.sub` as keyof Required<MsAtlasConfig>)}
            </span>
          </div>
          <div
            className={`ms-atl-status ms-atl-${lineStatusClass[key]}`}
            data-field={`lines.${key}.status`}
           style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, `lines.${key}.status` as keyof Required<MsAtlasConfig>)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <HsStage
      stageStyle={{
        background: '#f4ecd8',
        backgroundImage:
          'radial-gradient(rgba(11,18,32,.055) 1.2px, transparent 1.2px), radial-gradient(ellipse 1600px 900px at 30% 0%, rgba(224,167,38,.10), transparent 70%), radial-gradient(ellipse 1400px 800px at 100% 100%, rgba(46,110,208,.08), transparent 70%)',
        backgroundSize: '28px 28px, auto, auto',
        fontFamily: "'Work Sans', system-ui, sans-serif",
        color: '#0b1220',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Faint contour-line decoration drifting across the stage
          (the HTML mockup paints this on .stage::before; our HsStage
          already owns its ::before, so we use a dedicated div). */}
      <div className="ms-atl-contour" aria-hidden="true" />

      {/* ─── TOP BAND ────────────────────────────────────── */}
      <header className="ms-atl-top">
        <div className="ms-atl-brand" data-widget="brand">
          <div className="ms-atl-compass" aria-hidden="true">
            <div className="ms-atl-s-needle" />
            <span className="ms-atl-cardinal ms-atl-n">N</span>
            <span className="ms-atl-cardinal ms-atl-s">S</span>
            <span className="ms-atl-cardinal ms-atl-e">E</span>
            <span className="ms-atl-cardinal ms-atl-w">W</span>
          </div>
          <div className="ms-atl-info">
            <div className="ms-atl-eye" data-field="brand.eye" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'brand.eye')}
            </div>
            <div className="ms-atl-bname" data-field="brand.name" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'brand.name')}
            </div>
            <div className="ms-atl-bsub">
              <span data-field="brand.sub" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'brand.sub')}</span>
              <b data-field="brand.subDay" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'brand.subDay')}</b>
            </div>
          </div>
        </div>

        <div className="ms-atl-center-banner" data-widget="banner">
          <div className="ms-atl-cb-label" data-field="banner.label" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'banner.label')}
          </div>
          <div className="ms-atl-cb-date" data-field="banner.date" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'banner.date')}
          </div>
          <span className="ms-atl-cb-stamp" data-field="banner.stamp" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'banner.stamp')}
          </span>
        </div>

        <div className="ms-atl-meta-tiles">
          <div className="ms-atl-mt" data-widget="meta.temp">
            <span className="ms-atl-mt-k" data-field="meta.temp.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'meta.temp.label')}
            </span>
            <span className="ms-atl-mt-v ms-atl-cool" data-field="meta.temp.value" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'meta.temp.value')}
            </span>
          </div>
          <div className="ms-atl-mt" data-widget="meta.sky">
            <span className="ms-atl-mt-k" data-field="meta.sky.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'meta.sky.label')}
            </span>
            <span className="ms-atl-mt-v ms-atl-sun" data-field="meta.sky.value" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'meta.sky.value')}
            </span>
          </div>
          <div className="ms-atl-mt" data-widget="meta.time">
            <span className="ms-atl-mt-k" data-field="meta.time.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'meta.time.label')}
            </span>
            <span className="ms-atl-mt-v" data-field="meta.time.value" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'meta.time.value')}
            </span>
          </div>
        </div>
      </header>

      {/* ─── HERO ROW ────────────────────────────────────── */}
      <section className="ms-atl-hero-row">
        {/* LEFT: Travel poster */}
        <div className="ms-atl-poster" data-widget="poster">
          <div className="ms-atl-chapter" data-field="poster.chapter" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'poster.chapter')}
          </div>
          <h1 className="ms-atl-poster-h1">
            <span data-field="poster.h1.go" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'poster.h1.go')}</span>
            <em data-field="poster.h1.em" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'poster.h1.em')}</em>
            <br />
            <span className="ms-atl-mark" data-field="poster.h1.mark" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'poster.h1.mark')}
            </span>
          </h1>
          <p className="ms-atl-lede" data-field="poster.lede" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'poster.lede')}
          </p>
          <div className="ms-atl-dests">
            <span className="ms-atl-dest">
              <span className="ms-atl-pin" />
              <span data-field="poster.dest.0" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'poster.dest.0')}</span>
            </span>
            <span className="ms-atl-dest">
              <span className="ms-atl-pin ms-atl-gold" />
              <span data-field="poster.dest.1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'poster.dest.1')}</span>
            </span>
            <span className="ms-atl-dest">
              <span className="ms-atl-pin ms-atl-blue" />
              <span data-field="poster.dest.2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'poster.dest.2')}</span>
            </span>
            <span className="ms-atl-dest">
              <span className="ms-atl-pin ms-atl-green" />
              <span data-field="poster.dest.3" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'poster.dest.3')}</span>
            </span>
          </div>
        </div>

        {/* RIGHT: Campus map */}
        <div className="ms-atl-map" data-widget="map">
          <div className="ms-atl-map-head">
            <h3 className="ms-atl-map-h3" data-field="map.title" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'map.title')}
            </h3>
            <div className="ms-atl-scale">
              <span data-field="map.scale.label" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'map.scale.label')}</span>{' '}
              <span className="ms-atl-bar" />{' '}
              <span data-field="map.scale.value" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'map.scale.value')}</span>
            </div>
          </div>
          <div className="ms-atl-map-canvas">
            {/* Building floorplan SVG, cartoonish but clear. Decorative. */}
            <svg viewBox="0 0 900 600" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              {/* base grass */}
              <rect x="0" y="0" width="900" height="600" fill="#ece3cc" />
              {/* courtyards / water */}
              <rect x="360" y="260" width="180" height="120" fill="#b9d8dc" stroke="#0b1220" strokeWidth="3" />
              <text x="450" y="330" textAnchor="middle" fontFamily="Work Sans" fontWeight="800" fontSize="22" fill="#0b1220">COURTYARD</text>

              {/* Main academic wing (top) */}
              <rect x="80" y="50" width="740" height="160" fill="#fff" stroke="#0b1220" strokeWidth="4" />
              <line x1="80" y1="130" x2="820" y2="130" stroke="#0b1220" strokeWidth="2" strokeDasharray="6 6" />
              <text x="120" y="92" fontFamily="Work Sans" fontWeight="900" fontSize="22" fill="#0b1220">NORTH WING · CLASSROOMS</text>
              <text x="140" y="170" fontFamily="DM Mono" fontWeight="700" fontSize="18" fill="#2f3e52" letterSpacing="2">Rm 201 · 202 · 203 · 204 · 205 · 206 · 207 · 208 · 209 · 210</text>

              {/* Left wing (Gym A) */}
              <rect x="80" y="240" width="220" height="260" fill="#fff" stroke="#0b1220" strokeWidth="4" />
              <text x="190" y="360" textAnchor="middle" fontFamily="Work Sans" fontWeight="900" fontSize="32" fill="#0b1220">GYM&nbsp;A</text>
              <text x="190" y="400" textAnchor="middle" fontFamily="DM Mono" fontWeight="700" fontSize="16" fill="#2f3e52">mile run · PE</text>

              {/* Right wing (Auditorium) */}
              <rect x="600" y="240" width="220" height="260" fill="#fff" stroke="#0b1220" strokeWidth="4" />
              <text x="710" y="360" textAnchor="middle" fontFamily="Work Sans" fontWeight="900" fontSize="30" fill="#0b1220">AUDITORIUM</text>
              <text x="710" y="400" textAnchor="middle" fontFamily="DM Mono" fontWeight="700" fontSize="16" fill="#2f3e52">drama · band</text>

              {/* Cafeteria (bottom) */}
              <rect x="220" y="430" width="460" height="130" fill="#fff" stroke="#0b1220" strokeWidth="4" />
              <text x="450" y="485" textAnchor="middle" fontFamily="Work Sans" fontWeight="900" fontSize="30" fill="#0b1220">CAFETERIA</text>
              <text x="450" y="520" textAnchor="middle" fontFamily="DM Mono" fontWeight="700" fontSize="16" fill="#2f3e52">7th grade · A-period</text>

              {/* Connecting corridors */}
              <rect x="300" y="210" width="300" height="50" fill="#f4ecd8" stroke="#0b1220" strokeWidth="3" />
              <rect x="300" y="380" width="60" height="50" fill="#f4ecd8" stroke="#0b1220" strokeWidth="3" />
              <rect x="540" y="380" width="60" height="50" fill="#f4ecd8" stroke="#0b1220" strokeWidth="3" />
            </svg>

            {/* Pin labels overlay — left/top percentages tied to the
                fixed-pixel .ms-atl-map-canvas container, mirroring the
                mockup verbatim. */}
            <div className="ms-atl-pin-label" style={{ left: '16%', top: '28%' }}>
              <span className="ms-atl-pl-badge" style={{ background: '#d64c34' }}>1</span>
              <span className="ms-atl-pl-tag" data-field="map.pin.0.tag" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'map.pin.0.tag')}
              </span>
            </div>
            <div className="ms-atl-pin-label" style={{ left: '22%', top: '60%' }}>
              <span className="ms-atl-pl-badge" style={{ background: '#e0a726', color: '#0b1220' }}>2</span>
              <span className="ms-atl-pl-tag" data-field="map.pin.1.tag" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'map.pin.1.tag')}
              </span>
            </div>
            <div className="ms-atl-pin-label" style={{ left: '76%', top: '56%' }}>
              <span className="ms-atl-pl-badge" style={{ background: '#3a8d5d' }}>3</span>
              <span className="ms-atl-pl-tag" data-field="map.pin.2.tag" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'map.pin.2.tag')}
              </span>
            </div>
            <div className="ms-atl-pin-label" style={{ left: '50%', top: '80%' }}>
              <span className="ms-atl-pl-badge" style={{ background: '#2e6ed0' }}>4</span>
              <span className="ms-atl-pl-tag" data-field="map.pin.3.tag" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'map.pin.3.tag')}
              </span>
            </div>
          </div>
          <div className="ms-atl-map-legend">
            <div className="ms-atl-items">
              <span className="ms-atl-it">
                <span className="ms-atl-sw" style={{ background: '#d64c34' }} />
                <span data-field="map.legend.0" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'map.legend.0')}</span>
              </span>
              <span className="ms-atl-it">
                <span className="ms-atl-sw" style={{ background: '#e0a726' }} />
                <span data-field="map.legend.1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'map.legend.1')}</span>
              </span>
              <span className="ms-atl-it">
                <span className="ms-atl-sw" style={{ background: '#2e6ed0' }} />
                <span data-field="map.legend.2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'map.legend.2')}</span>
              </span>
              <span className="ms-atl-it">
                <span className="ms-atl-sw" style={{ background: '#3a8d5d' }} />
                <span data-field="map.legend.3" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'map.legend.3')}</span>
              </span>
            </div>
            <span data-field="map.legend.compass" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'map.legend.compass')}</span>
          </div>
        </div>
      </section>

      {/* ─── LINES ROW (4 subway routes) ─────────────────── */}
      <section className="ms-atl-lines" data-widget="lines">
        <div className="ms-atl-lines-head">
          <h2 className="ms-atl-lines-h2">
            <span data-field="lines.title.go" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lines.title.go')}</span>
            <em data-field="lines.title.em" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'lines.title.em')}</em>
          </h2>
          <div className="ms-atl-lines-meta" data-field="lines.meta" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'lines.meta')}
          </div>
        </div>
        <div className="ms-atl-grid">
          {renderRoute('morning', 'gold')}
          {renderRoute('afternoon', 'red')}
          {renderRoute('lunch', 'blue')}
          {renderRoute('clubs', 'green')}
        </div>
      </section>

      {/* ─── BOTTOM ROW — destination spotlight + ticker ── */}
      <section className="ms-atl-bottom">
        <div className="ms-atl-dest-spot" data-widget="spot">
          <div className="ms-atl-spot-pin" aria-hidden="true" />
          <div className="ms-atl-spot-info">
            <div className="ms-atl-ey" data-field="spot.eyebrow" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'spot.eyebrow')}
            </div>
            <div className="ms-atl-spot-t" data-field="spot.title" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'spot.title')}
            </div>
            <div className="ms-atl-spot-s" data-field="spot.sub" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'spot.sub')}
            </div>
          </div>
        </div>

        <div className="ms-atl-ticker-row" data-widget="ticker">
          <div className="ms-atl-ticker-badge" data-field="ticker.tag" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'ticker.tag')}
          </div>
          <div className="ms-atl-feed">
            <div className="ms-atl-feed-inner">
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
        </div>
      </section>
    </HsStage>
  );
}

/** Inlined CSS — every pixel value matches scratch/design/atlas-ms-v2.html.
 *  The mockup's scale wrapper boilerplate (.viewport / .stage-outer /
 *  .stage / fit() script) is replaced by HsStage; everything else is
 *  ported verbatim with a `ms-atl-` prefix. */
const CSS = `
/* Box-sizing border-box on every panel that sets an explicit width.
   The .ms-atl-poster panel (1750px wide with 80px horizontal padding +
   5px borders) and the .ms-atl-lines panel (right-anchored with 44px
   padding + 5px border) both rely on it to land on their intended edge. */
.ms-atl-top, .ms-atl-top *, .ms-atl-top *::before, .ms-atl-top *::after,
.ms-atl-hero-row, .ms-atl-hero-row *, .ms-atl-hero-row *::before, .ms-atl-hero-row *::after,
.ms-atl-lines, .ms-atl-lines *, .ms-atl-lines *::before, .ms-atl-lines *::after,
.ms-atl-bottom, .ms-atl-bottom *, .ms-atl-bottom *::before, .ms-atl-bottom *::after,
.ms-atl-contour {
  box-sizing: border-box;
}

/* Faint contour-line decoration drifting across the stage. */
.ms-atl-contour {
  position: absolute; inset: 0; pointer-events: none; opacity: .18; z-index: 0;
  background-image:
    radial-gradient(circle at 78% 68%, transparent 280px, rgba(11,18,32,.3) 281px, transparent 285px),
    radial-gradient(circle at 78% 68%, transparent 340px, rgba(11,18,32,.3) 341px, transparent 345px),
    radial-gradient(circle at 78% 68%, transparent 400px, rgba(11,18,32,.3) 401px, transparent 405px),
    radial-gradient(circle at 78% 68%, transparent 460px, rgba(11,18,32,.3) 461px, transparent 465px),
    radial-gradient(circle at 22% 22%, transparent 180px, rgba(11,18,32,.25) 181px, transparent 185px),
    radial-gradient(circle at 22% 22%, transparent 240px, rgba(11,18,32,.25) 241px, transparent 245px);
}

/* ─── TOP BAND ─────────────────────────────────────────── */
.ms-atl-top {
  position: absolute; top: 56px; left: 64px; right: 64px; height: 264px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 56px; align-items: center;
  z-index: 2;
}

/* Compass lockup on the left */
.ms-atl-brand { display: flex; align-items: center; gap: 44px; }
.ms-atl-compass {
  width: 220px; height: 220px; position: relative; flex-shrink: 0;
  background: #fff;
  border: 5px solid #0b1220;
  border-radius: 50%;
  box-shadow: 8px 8px 0 #0b1220;
}
.ms-atl-compass::before {
  content: ''; position: absolute; inset: 20px; border-radius: 50%;
  border: 2px dashed rgba(11,18,32,.45);
}
.ms-atl-compass::after {
  content: ''; position: absolute; top: 18px; left: 50%;
  width: 0; height: 0; transform: translateX(-50%);
  border: 28px solid transparent; border-bottom-color: #d64c34; border-top: 0;
}
.ms-atl-s-needle {
  position: absolute; bottom: 18px; left: 50%;
  width: 0; height: 0; transform: translateX(-50%);
  border: 28px solid transparent; border-top-color: #0b1220; border-bottom: 0;
}
.ms-atl-cardinal {
  position: absolute; font-family: 'Work Sans', system-ui, sans-serif;
  font-weight: 900; font-size: 32px; color: #0b1220;
  letter-spacing: .04em;
}
.ms-atl-cardinal.ms-atl-n { top: -48px; left: 50%; transform: translateX(-50%); }
.ms-atl-cardinal.ms-atl-s { bottom: -48px; left: 50%; transform: translateX(-50%); color: #2f3e52; }
.ms-atl-cardinal.ms-atl-e { right: -44px; top: 50%; transform: translateY(-50%); color: #2f3e52; }
.ms-atl-cardinal.ms-atl-w { left: -44px; top: 50%; transform: translateY(-50%); color: #2f3e52; }

.ms-atl-info .ms-atl-eye {
  font-family: 'DM Mono', monospace; font-size: 28px; font-weight: 700;
  letter-spacing: .22em; text-transform: uppercase; color: #d64c34;
  display: inline-flex; align-items: center; gap: 14px;
}
.ms-atl-info .ms-atl-eye::before {
  content: ''; width: 48px; height: 3px; background: #d64c34;
}
.ms-atl-info .ms-atl-bname {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 112px;
  color: #0b1220; line-height: .92; letter-spacing: -.03em;
  margin-top: 8px;
}
.ms-atl-info .ms-atl-bsub {
  font-family: 'DM Mono', monospace; font-size: 32px; font-weight: 500;
  color: #2f3e52; letter-spacing: .16em; text-transform: uppercase;
  margin-top: 12px;
}
.ms-atl-info .ms-atl-bsub b { color: #d64c34; font-weight: 700; }

/* Center — big date / day banner */
.ms-atl-center-banner {
  justify-self: center;
  text-align: center;
  padding: 10px 0;
}
.ms-atl-cb-label {
  font-family: 'DM Mono', monospace; font-size: 26px; font-weight: 700;
  letter-spacing: .28em; text-transform: uppercase; color: #2f3e52;
}
.ms-atl-cb-date {
  font-family: 'Playfair Display', serif; font-style: italic; font-weight: 900;
  font-size: 120px; color: #0b1220; line-height: 1; letter-spacing: -.02em;
  margin-top: 4px;
}
.ms-atl-cb-stamp {
  display: inline-block; margin-top: 14px;
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 800; font-size: 24px;
  letter-spacing: .18em; text-transform: uppercase; color: #d64c34;
  padding: 8px 22px; border: 3px solid #d64c34; border-radius: 999px;
  transform: rotate(-2deg);
}

/* Right — weather + time tiles */
.ms-atl-meta-tiles { display: flex; gap: 18px; }
.ms-atl-mt {
  width: 180px; padding: 20px 22px;
  background: #fff; border: 4px solid #0b1220;
  box-shadow: 6px 6px 0 #0b1220;
  display: flex; flex-direction: column; gap: 4px;
}
.ms-atl-mt-k {
  font-family: 'DM Mono', monospace; font-size: 18px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: #2f3e52;
}
.ms-atl-mt-v {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 68px;
  color: #0b1220; line-height: 1; letter-spacing: -.02em;
}
.ms-atl-mt-v.ms-atl-warm { color: #d64c34; }
.ms-atl-mt-v.ms-atl-cool { color: #2e6ed0; }
.ms-atl-mt-v.ms-atl-sun  { color: #e0a726; }

/* ─── HERO ROW (left poster + right map) ──────────────── */
.ms-atl-hero-row {
  position: absolute; top: 340px; left: 64px; right: 64px; height: 1080px;
  display: grid; grid-template-columns: 1750px 1fr; gap: 40px;
  z-index: 2;
}

/* LEFT — Travel poster */
.ms-atl-poster {
  background: #fff; border: 5px solid #0b1220;
  box-shadow: 12px 12px 0 #0b1220;
  padding: 72px 80px;
  display: flex; flex-direction: column; justify-content: center;
  position: relative; overflow: hidden;
}
.ms-atl-poster::before {
  content: ''; position: absolute; inset: 20px;
  border: 2px solid #0b1220; pointer-events: none;
}
.ms-atl-poster::after {
  content: ''; position: absolute; right: -120px; bottom: -120px;
  width: 520px; height: 520px; border-radius: 50%;
  background: radial-gradient(circle, rgba(224,167,38,.22), transparent 70%);
  pointer-events: none;
}
.ms-atl-chapter {
  font-family: 'DM Mono', monospace; font-size: 34px; font-weight: 700;
  letter-spacing: .26em; text-transform: uppercase; color: #d64c34;
  margin-bottom: 24px;
  display: inline-flex; align-items: center; gap: 20px;
}
.ms-atl-chapter::before {
  content: ''; width: 60px; height: 4px; background: #d64c34;
}
.ms-atl-poster-h1 {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900;
  font-size: 208px; line-height: .88; letter-spacing: -.035em;
  color: #0b1220; margin: 0;
  text-wrap: balance;
}
.ms-atl-poster-h1 em {
  font-style: italic; color: #d64c34;
  font-family: 'Playfair Display', serif; font-weight: 900;
}
.ms-atl-poster-h1 .ms-atl-mark { color: #2e6ed0; }
.ms-atl-lede {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 500;
  font-size: 48px; line-height: 1.3;
  color: #2f3e52; margin-top: 44px; max-width: 1400px;
}
.ms-atl-dests {
  margin-top: 56px; display: flex; gap: 20px; flex-wrap: wrap;
}
.ms-atl-dest {
  display: inline-flex; align-items: center; gap: 14px;
  padding: 14px 26px;
  background: #ece3cc; border: 3px solid #0b1220;
  border-radius: 999px;
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 800; font-size: 32px;
  color: #0b1220; letter-spacing: -.005em;
}
.ms-atl-dest .ms-atl-pin {
  width: 28px; height: 36px; border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  background: #d64c34;
  clip-path: polygon(50% 100%, 0 40%, 0 20%, 50% 0, 100% 20%, 100% 40%);
  position: relative;
}
.ms-atl-dest .ms-atl-pin.ms-atl-gold  { background: #e0a726; }
.ms-atl-dest .ms-atl-pin.ms-atl-blue  { background: #2e6ed0; }
.ms-atl-dest .ms-atl-pin.ms-atl-green { background: #3a8d5d; }

/* RIGHT — Campus map */
.ms-atl-map {
  background: #fff; border: 5px solid #0b1220;
  box-shadow: 12px 12px 0 #0b1220;
  position: relative; overflow: hidden;
  padding: 28px 30px 32px;
}
.ms-atl-map-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding-bottom: 18px; border-bottom: 3px solid #0b1220;
}
.ms-atl-map-h3 {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 60px;
  color: #0b1220; margin: 0; letter-spacing: -.02em; line-height: 1;
}
.ms-atl-scale {
  font-family: 'DM Mono', monospace; font-size: 20px; font-weight: 500;
  letter-spacing: .16em; text-transform: uppercase; color: #2f3e52;
  display: inline-flex; align-items: center; gap: 10px;
}
.ms-atl-scale .ms-atl-bar {
  display: inline-block; width: 90px; height: 10px;
  border: 2px solid #0b1220;
  background: repeating-linear-gradient(90deg, #0b1220 0 10px, #fff 10px 20px);
}
.ms-atl-map-canvas {
  position: relative; margin-top: 18px; height: calc(100% - 140px);
  background: #ece3cc;
  border: 2px solid #0b1220;
}
.ms-atl-map-canvas svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ms-atl-pin-label {
  position: absolute;
  display: inline-flex; align-items: center; gap: 10px;
  transform: translate(-50%, -50%);
}
.ms-atl-pl-badge {
  width: 68px; height: 68px; border-radius: 50%;
  display: grid; place-items: center;
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 30px;
  color: #fff; border: 4px solid #0b1220;
  box-shadow: 3px 3px 0 #0b1220;
}
.ms-atl-pl-tag {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 800; font-size: 24px;
  color: #0b1220; background: #fff;
  padding: 5px 12px; border: 3px solid #0b1220;
  white-space: nowrap;
}
.ms-atl-map-legend {
  margin-top: 14px;
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 12px; border-top: 2px solid #0b1220;
  font-family: 'DM Mono', monospace; font-size: 20px; font-weight: 500;
  letter-spacing: .1em; color: #2f3e52;
}
.ms-atl-map-legend .ms-atl-items { display: flex; gap: 24px; flex-wrap: wrap; }
.ms-atl-map-legend .ms-atl-it { display: inline-flex; align-items: center; gap: 10px; }
.ms-atl-map-legend .ms-atl-it .ms-atl-sw { width: 22px; height: 22px; border: 2px solid #0b1220; border-radius: 50%; }

/* ─── LINES ROW (4 subway routes) ─────────────────────── */
.ms-atl-lines {
  position: absolute; top: 1440px; left: 64px; right: 64px; height: 480px;
  background: #fff; border: 5px solid #0b1220;
  box-shadow: 12px 12px 0 #0b1220;
  padding: 32px 44px;
  z-index: 2;
}
.ms-atl-lines-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  padding-bottom: 20px; border-bottom: 3px solid #0b1220;
  margin-bottom: 24px;
}
.ms-atl-lines-h2 {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 72px;
  color: #0b1220; margin: 0; letter-spacing: -.02em; line-height: 1;
}
.ms-atl-lines-h2 em {
  font-family: 'Playfair Display', serif; font-style: italic;
  color: #d64c34; font-weight: 900;
}
.ms-atl-lines-meta {
  font-family: 'DM Mono', monospace; font-size: 24px; font-weight: 500;
  letter-spacing: .18em; text-transform: uppercase; color: #2f3e52;
}
.ms-atl-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px;
}
.ms-atl-route {
  display: flex; flex-direction: column; gap: 14px;
  padding: 22px 24px;
  background: #f4ecd8;
  border: 3px solid #0b1220;
  box-shadow: 4px 4px 0 rgba(11,18,32,.25);
}
.ms-atl-label {
  display: flex; align-items: center; gap: 16px;
}
.ms-atl-route .ms-atl-badge {
  width: 78px; height: 78px; border-radius: 50%;
  display: grid; place-items: center;
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 36px;
  color: #fff; border: 4px solid #0b1220;
  letter-spacing: .02em;
  flex-shrink: 0;
}
.ms-atl-route .ms-atl-badge.ms-atl-gold  { background: #e0a726; color: #0b1220; }
.ms-atl-route .ms-atl-badge.ms-atl-red   { background: #d64c34; }
.ms-atl-route .ms-atl-badge.ms-atl-blue  { background: #2e6ed0; }
.ms-atl-route .ms-atl-badge.ms-atl-green { background: #3a8d5d; }
.ms-atl-route .ms-atl-name {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 40px;
  color: #0b1220; line-height: 1; letter-spacing: -.01em;
}
.ms-atl-route .ms-atl-name span:nth-child(2) {
  display: block;
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 20px;
  letter-spacing: .14em; text-transform: uppercase; color: #2f3e52;
  margin-top: 6px;
}
.ms-atl-stops {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 6px;
  border-top: 2px solid #0b1220; border-bottom: 2px solid #0b1220;
  position: relative;
}
.ms-atl-stops::before {
  content: ''; position: absolute; left: 22px; right: 22px; top: 50%;
  height: 5px; background: #0b1220; transform: translateY(-50%);
}
.ms-atl-st {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  position: relative; z-index: 1; min-width: 60px;
}
.ms-atl-st .ms-atl-dot {
  width: 22px; height: 22px; border-radius: 50%;
  background: #fff; border: 4px solid #0b1220;
}
.ms-atl-st.ms-atl-now .ms-atl-dot {
  background: #0b1220; box-shadow: 0 0 0 4px #f4ecd8, 0 0 0 7px #0b1220;
}
.ms-atl-st .ms-atl-lb {
  font-family: 'DM Mono', monospace; font-size: 18px; font-weight: 700;
  letter-spacing: .08em; color: #2f3e52;
}
.ms-atl-st.ms-atl-now .ms-atl-lb { color: #d64c34; }
.ms-atl-detail {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 4px;
}
.ms-atl-next {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 700; font-size: 24px;
  color: #0b1220; line-height: 1.3;
}
.ms-atl-next span:nth-child(2) {
  display: block;
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 16px;
  letter-spacing: .12em; text-transform: uppercase; color: #2f3e52;
  margin-top: 4px;
}
.ms-atl-status {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 800; font-size: 22px;
  padding: 8px 16px; border: 3px solid #0b1220;
  letter-spacing: .06em; text-transform: uppercase;
}
.ms-atl-status.ms-atl-on   { background: #d7eadb; color: #1f6a3f; }
.ms-atl-status.ms-atl-late { background: #fadcd4; color: #9b2f18; }
.ms-atl-status.ms-atl-soon { background: #dfe9f9; color: #264f99; }

/* ─── BOTTOM BAND — destination spotlight + ticker ────── */
.ms-atl-bottom {
  position: absolute; bottom: 20px; left: 64px; right: 64px; height: 200px;
  display: grid; grid-template-columns: 1fr 2fr; gap: 24px;
  z-index: 2;
}

.ms-atl-dest-spot {
  background: #0b1220; color: #f4ecd8;
  border: 5px solid #0b1220;
  box-shadow: 10px 10px 0 #e0a726;
  padding: 26px 32px;
  display: grid; grid-template-columns: auto 1fr; gap: 28px; align-items: center;
}
.ms-atl-spot-pin {
  width: 110px; height: 142px;
  background: #d64c34;
  clip-path: polygon(50% 100%, 0 40%, 0 20%, 50% 0, 100% 20%, 100% 40%);
  display: grid; place-items: center;
  position: relative;
}
.ms-atl-spot-pin::after {
  content: ''; width: 38px; height: 38px; border-radius: 50%;
  background: #f4ecd8; position: absolute; top: 26px;
}
.ms-atl-spot-info .ms-atl-ey {
  font-family: 'DM Mono', monospace; font-size: 20px; font-weight: 700;
  letter-spacing: .24em; text-transform: uppercase; color: #e0a726;
}
.ms-atl-spot-info .ms-atl-spot-t {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 56px;
  color: #f4ecd8; margin-top: 4px; line-height: 1; letter-spacing: -.015em;
}
.ms-atl-spot-info .ms-atl-spot-s {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 500; font-size: 28px;
  color: rgba(244,236,216,.8); margin-top: 8px;
}

.ms-atl-ticker-row {
  background: #f4ecd8; border: 5px solid #0b1220;
  box-shadow: 10px 10px 0 #0b1220;
  display: grid; grid-template-columns: auto 1fr; align-items: stretch;
  overflow: hidden;
}
.ms-atl-ticker-badge {
  background: #e0a726; color: #0b1220;
  padding: 0 38px;
  display: flex; align-items: center; gap: 20px;
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 38px;
  letter-spacing: .02em;
  border-right: 5px solid #0b1220;
}
.ms-atl-ticker-badge::before {
  content: '★'; color: #0b1220; font-size: 36px;
}
.ms-atl-feed {
  overflow: hidden; display: flex; align-items: center;
  padding-left: 32px;
}
.ms-atl-feed-inner {
  display: flex; gap: 64px;
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 600; font-size: 40px;
  color: #0b1220; white-space: nowrap;
  animation: msAtlScroll 60s linear infinite;
}
.ms-atl-feed-inner span { display: inline-flex; align-items: center; gap: 20px; }
.ms-atl-feed-inner span::after {
  content: '•'; color: #d64c34; margin-left: 32px;
}
@keyframes msAtlScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
`;
