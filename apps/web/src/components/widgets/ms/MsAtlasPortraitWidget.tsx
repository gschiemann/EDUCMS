"use client";

/**
 * MsAtlasPortraitWidget — Middle-school lobby scene (PORTRAIT 2160×3840).
 *
 * APPROVED 2026-04-25 — matches scratch/design/atlas-ms-portrait-v1.html.
 * Portrait sibling to MsAtlasWidget. Reviewed by user, ported via
 * HsStage scale pattern. DO NOT regress to vw/% units.
 *
 * Scene layout (2160×3840 stage, edge inset = 64px, every gap = 20px):
 *   - top         (y=  80,  h= 460) compass + school lockup horizontal
 *   - date-strip  (y= 560,  h= 240) center date banner + 3 meta tiles
 *   - poster      (y= 820,  h= 840) "Go forth, Otters." hero + dest pills
 *   - almanac     (y=1680,  h= 700) sun + 6 weather cells + quote ribbon
 *   - routes      (y=2400,  h= 940) 4 transit cards stacked vertically
 *   - spotlight   (y=3360,  h= 220) "Destination Today" feature
 *   - ticker-row  (y=3600,  h= 140) bottom news bar
 *
 * box-sizing: border-box on every panel that sets explicit width/padding +
 * border combinations is load-bearing — the .ms-atl-p-poster panel
 * (left:64/right:64 + 80px×96px padding + 6px borders) and the routes
 * stack rely on it to land on their intended edges.
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsAtlasPortraitConfig {
  // Top band — brand
  'brand.eye'?: string;
  'brand.name'?: string;
  'brand.sub'?: string;
  'brand.subDay'?: string;
  // Date strip — center banner
  'banner.label'?: string;
  'banner.date'?: string;
  'banner.stamp'?: string;
  // Date strip — meta tiles
  'meta.temp.label'?: string;
  'meta.temp.value'?: string;
  'meta.sky.label'?: string;
  'meta.sky.value'?: string;
  'meta.time.label'?: string;
  'meta.time.value'?: string;
  // Hero poster
  'poster.chapter'?: string;
  'poster.h1.go'?: string;
  'poster.h1.em'?: string;
  'poster.h1.mark'?: string;
  'poster.lede'?: string;
  'poster.dest.0'?: string;
  'poster.dest.1'?: string;
  'poster.dest.2'?: string;
  'poster.dest.3'?: string;
  // Almanac
  'almanac.title.go'?: string;
  'almanac.title.em'?: string;
  'almanac.vol'?: string;
  'almanac.sky.label'?: string;
  'almanac.sky.headline'?: string;
  'almanac.sky.sub'?: string;
  'almanac.cell.0.k'?: string;
  'almanac.cell.0.v'?: string;
  'almanac.cell.1.k'?: string;
  'almanac.cell.1.v'?: string;
  'almanac.cell.2.k'?: string;
  'almanac.cell.2.v'?: string;
  'almanac.cell.3.k'?: string;
  'almanac.cell.3.v'?: string;
  'almanac.cell.4.k'?: string;
  'almanac.cell.4.v'?: string;
  'almanac.cell.5.k'?: string;
  'almanac.cell.5.v'?: string;
  'almanac.quote.body'?: string;
  'almanac.quote.cite'?: string;
  'almanac.quote.stamp'?: string;
  // Routes — header
  'routes.title.go'?: string;
  'routes.title.em'?: string;
  'routes.meta'?: string;
  // Routes — Morning (gold)
  'routes.morning.badge'?: string;
  'routes.morning.name'?: string;
  'routes.morning.periods'?: string;
  'routes.morning.stop.0'?: string;
  'routes.morning.stop.1'?: string;
  'routes.morning.stop.2'?: string;
  'routes.morning.next.title'?: string;
  'routes.morning.next.sub'?: string;
  'routes.morning.status'?: string;
  // Routes — Afternoon (red)
  'routes.afternoon.badge'?: string;
  'routes.afternoon.name'?: string;
  'routes.afternoon.periods'?: string;
  'routes.afternoon.stop.0'?: string;
  'routes.afternoon.stop.1'?: string;
  'routes.afternoon.stop.2'?: string;
  'routes.afternoon.next.title'?: string;
  'routes.afternoon.next.sub'?: string;
  'routes.afternoon.status'?: string;
  // Routes — Lunch (blue)
  'routes.lunch.badge'?: string;
  'routes.lunch.name'?: string;
  'routes.lunch.periods'?: string;
  'routes.lunch.stop.0'?: string;
  'routes.lunch.stop.1'?: string;
  'routes.lunch.stop.2'?: string;
  'routes.lunch.next.title'?: string;
  'routes.lunch.next.sub'?: string;
  'routes.lunch.status'?: string;
  // Routes — Clubs (green)
  'routes.clubs.badge'?: string;
  'routes.clubs.name'?: string;
  'routes.clubs.periods'?: string;
  'routes.clubs.stop.0'?: string;
  'routes.clubs.stop.1'?: string;
  'routes.clubs.stop.2'?: string;
  'routes.clubs.next.title'?: string;
  'routes.clubs.next.sub'?: string;
  'routes.clubs.status'?: string;
  // Spotlight
  'spot.eyebrow'?: string;
  'spot.title'?: string;
  'spot.sub'?: string;
  // Ticker
  'ticker.tag'?: string;
  'ticker.0'?: string;
  'ticker.1'?: string;
  'ticker.2'?: string;
  'ticker.3'?: string;
  'ticker.4'?: string;
  'ticker.5'?: string;
}

export const DEFAULTS: Required<MsAtlasPortraitConfig> = {
  // Top band — brand
  'brand.eye': 'Middle School Atlas',
  'brand.name': 'WESTRIDGE.MS',
  'brand.sub': '42.3601° N · 71.0589° W · ',
  'brand.subDay': 'DAY B',
  // Date strip — center banner
  'banner.label': 'Entry · Volume 07',
  'banner.date': 'Tuesday, Apr 21',
  'banner.stamp': 'Field Day · 12 days out',
  // Date strip — meta tiles
  'meta.temp.label': 'Temp',
  'meta.temp.value': '46°',
  'meta.sky.label': 'Sky',
  'meta.sky.value': '☀',
  'meta.time.label': 'Time',
  'meta.time.value': '07:53',
  // Hero poster
  'poster.chapter': 'Chapter 147 · Morning Edition',
  'poster.h1.go': 'Go ',
  'poster.h1.em': 'forth,',
  'poster.h1.mark': 'Otters.',
  'poster.lede':
    'Today’s journey assembles at 08:05. Pack pencil, journal, and a quiet bit of courage. Mr. Nguyen awaits in Room 108 — the poetry workshop has a new chapter for you.',
  'poster.dest.0': 'Rm 108 · Poetry',
  'poster.dest.1': 'Gym A · Mile Run',
  'poster.dest.2': 'Lib · Sign-ups Close Fri',
  'poster.dest.3': 'Aud · Drama Auditions',
  // Almanac
  'almanac.title.go': 'Today’s ',
  'almanac.title.em': 'Almanac',
  'almanac.vol': 'School-Agnostic · No Setup Required',
  'almanac.sky.label': 'Sky · Tuesday',
  'almanac.sky.headline': 'Crisp & Clear',
  'almanac.sky.sub': 'Light easterly breeze · light jacket weather',
  'almanac.cell.0.k': 'Sunrise',
  'almanac.cell.0.v': '6:14a',
  'almanac.cell.1.k': 'Sunset',
  'almanac.cell.1.v': '7:32p',
  'almanac.cell.2.k': 'High',
  'almanac.cell.2.v': '62°',
  'almanac.cell.3.k': 'Low',
  'almanac.cell.3.v': '41°',
  'almanac.cell.4.k': 'Sky',
  'almanac.cell.4.v': 'Clear',
  'almanac.cell.5.k': 'Moon',
  'almanac.cell.5.v': 'Waxing',
  'almanac.quote.body':
    'Not all who wander are lost — some are simply looking for Room 108.',
  'almanac.quote.cite': '— Today’s field note',
  'almanac.quote.stamp': 'Vol 07',
  // Routes — header
  'routes.title.go': 'Today’s ',
  'routes.title.em': 'Routes',
  'routes.meta': '4 lines · 22 stops · on schedule',
  // Routes — Morning
  'routes.morning.badge': 'AM',
  'routes.morning.name': 'Morning Line',
  'routes.morning.periods': 'P1 · P2 · P3',
  'routes.morning.stop.0': 'MATH',
  'routes.morning.stop.1': 'ENG',
  'routes.morning.stop.2': 'SCI',
  'routes.morning.next.title': 'Now arriving',
  'routes.morning.next.sub': 'Rm 108 · Mr. Nguyen',
  'routes.morning.status': 'On time',
  // Routes — Afternoon
  'routes.afternoon.badge': 'PM',
  'routes.afternoon.name': 'Afternoon Line',
  'routes.afternoon.periods': 'P4 · P5 · P6',
  'routes.afternoon.stop.0': 'PE',
  'routes.afternoon.stop.1': 'SS',
  'routes.afternoon.stop.2': 'ART',
  'routes.afternoon.next.title': 'Next departure',
  'routes.afternoon.next.sub': 'Gym A · Mile run · 10:50',
  'routes.afternoon.status': '10:50',
  // Routes — Lunch
  'routes.lunch.badge': 'LN',
  'routes.lunch.name': 'Lunch Line',
  'routes.lunch.periods': 'A · B · C Period',
  'routes.lunch.stop.0': '7TH',
  'routes.lunch.stop.1': '8TH',
  'routes.lunch.stop.2': '6TH',
  'routes.lunch.next.title': 'Chicken & rice',
  'routes.lunch.next.sub': 'A-period · 7th grade · 11:45',
  'routes.lunch.status': '11:45',
  // Routes — Clubs
  'routes.clubs.badge': 'CL',
  'routes.clubs.name': 'Clubs Line',
  'routes.clubs.periods': 'After School',
  'routes.clubs.stop.0': 'ROB',
  'routes.clubs.stop.1': 'DRM',
  'routes.clubs.stop.2': 'BND',
  'routes.clubs.next.title': 'Robotics build week',
  'routes.clubs.next.sub': 'Rm 207 · 3:00 · rare loot',
  'routes.clubs.status': 'On time',
  // Spotlight
  'spot.eyebrow': 'Destination Today',
  'spot.title': 'Picture Day — Thu',
  'spot.sub': 'Full uniform · permission slips to front office by Wed',
  // Ticker
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
 * caller passed undefined or empty string. Mirrors landscape sibling.
 */
const pick = <K extends keyof Required<MsAtlasPortraitConfig>>(
  cfg: MsAtlasPortraitConfig,
  key: K,
): string => {
  const v = cfg[key];
  return (v === undefined || v === '' ? DEFAULTS[key] : v) as string;
};

export function MsAtlasPortraitWidget({ config }: { config?: MsAtlasPortraitConfig }) {
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

  type RouteKey = 'morning' | 'afternoon' | 'lunch' | 'clubs';
  const renderRoute = (
    key: RouteKey,
    badgeColor: 'gold' | 'red' | 'blue' | 'green',
  ) => {
    const stops: Array<0 | 1 | 2> = [0, 1, 2];
    return (
      <div className="ms-atl-p-route" data-widget={`routes.${key}`} key={key}>
        <div className="ms-atl-p-label">
          <div
            className={`ms-atl-p-badge ms-atl-p-${badgeColor}`}
            data-field={`routes.${key}.badge`}
           style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, `routes.${key}.badge` as keyof Required<MsAtlasPortraitConfig>)}
          </div>
          <div className="ms-atl-p-name">
            <span data-field={`routes.${key}.name`} style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, `routes.${key}.name` as keyof Required<MsAtlasPortraitConfig>)}
            </span>
            <span data-field={`routes.${key}.periods`} style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, `routes.${key}.periods` as keyof Required<MsAtlasPortraitConfig>)}
            </span>
          </div>
        </div>
        <div className="ms-atl-p-center">
          <div className="ms-atl-p-stops">
            {stops.map((i) => {
              const cls = `ms-atl-p-st${lineNowIndex[key] === i ? ' ms-atl-p-now' : ''}`;
              return (
                <div className={cls} key={i}>
                  <div className="ms-atl-p-dot" />
                  <div
                    className="ms-atl-p-lb"
                    data-field={`routes.${key}.stop.${i}`}
                   style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(
                      cfg,
                      `routes.${key}.stop.${i}` as keyof Required<MsAtlasPortraitConfig>,
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="ms-atl-p-next">
            <span
              className="ms-atl-p-next-title"
              data-field={`routes.${key}.next.title`}
             style={{ whiteSpace: 'pre-wrap' }}>
              {pick(
                cfg,
                `routes.${key}.next.title` as keyof Required<MsAtlasPortraitConfig>,
              )}
            </span>
            <span
              className="ms-atl-p-next-sub"
              data-field={`routes.${key}.next.sub`}
             style={{ whiteSpace: 'pre-wrap' }}>
              {pick(
                cfg,
                `routes.${key}.next.sub` as keyof Required<MsAtlasPortraitConfig>,
              )}
            </span>
          </div>
        </div>
        <div
          className={`ms-atl-p-status ms-atl-p-${lineStatusClass[key]}`}
          data-field={`routes.${key}.status`}
         style={{ whiteSpace: 'pre-wrap' }}>
          {pick(cfg, `routes.${key}.status` as keyof Required<MsAtlasPortraitConfig>)}
        </div>
      </div>
    );
  };

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: '#f4ecd8',
        backgroundImage:
          'radial-gradient(rgba(11,18,32,.055) 1.4px, transparent 1.4px), radial-gradient(ellipse 1400px 1200px at 0% 0%, rgba(224,167,38,.12), transparent 70%), radial-gradient(ellipse 1400px 1200px at 100% 100%, rgba(46,110,208,.08), transparent 70%)',
        backgroundSize: '32px 32px, auto, auto',
        fontFamily: "'Work Sans', system-ui, sans-serif",
        color: '#0b1220',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Faint contour-line decoration drifting across the stage
          (the HTML mockup paints this on .stage::before; HsStage owns
          its own ::before, so we use a dedicated div). */}
      <div className="ms-atl-p-contour" aria-hidden="true" />

      {/* ─── TOP BAND — compass + school lockup ─────────────── */}
      <header className="ms-atl-p-panel ms-atl-p-top" data-widget="brand">
        <div className="ms-atl-p-compass-wrap">
          <div className="ms-atl-p-compass" aria-hidden="true">
            <div className="ms-atl-p-s-needle" />
            <span className="ms-atl-p-cardinal ms-atl-p-n">N</span>
            <span className="ms-atl-p-cardinal ms-atl-p-s">S</span>
            <span className="ms-atl-p-cardinal ms-atl-p-e">E</span>
            <span className="ms-atl-p-cardinal ms-atl-p-w">W</span>
          </div>
        </div>
        <div className="ms-atl-p-info">
          <div className="ms-atl-p-eye" data-field="brand.eye" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'brand.eye')}
          </div>
          <div className="ms-atl-p-bname" data-field="brand.name" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'brand.name')}
          </div>
          <div className="ms-atl-p-bsub">
            <span data-field="brand.sub" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'brand.sub')}</span>
            <b data-field="brand.subDay" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'brand.subDay')}</b>
          </div>
        </div>
      </header>

      {/* ─── DATE STRIP — center date banner + meta tiles ───── */}
      <section className="ms-atl-p-panel ms-atl-p-date-strip" data-widget="banner">
        <div className="ms-atl-p-center-banner">
          <div className="ms-atl-p-cb-label" data-field="banner.label" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'banner.label')}
          </div>
          <div className="ms-atl-p-cb-date" data-field="banner.date" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'banner.date')}
          </div>
          <span className="ms-atl-p-cb-stamp" data-field="banner.stamp" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'banner.stamp')}
          </span>
        </div>
        <div className="ms-atl-p-meta-tiles">
          <div className="ms-atl-p-mt" data-widget="meta.temp">
            <span className="ms-atl-p-mt-k" data-field="meta.temp.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'meta.temp.label')}
            </span>
            <span
              className="ms-atl-p-mt-v ms-atl-p-cool"
              data-field="meta.temp.value"
             style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'meta.temp.value')}
            </span>
          </div>
          <div className="ms-atl-p-mt" data-widget="meta.sky">
            <span className="ms-atl-p-mt-k" data-field="meta.sky.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'meta.sky.label')}
            </span>
            <span
              className="ms-atl-p-mt-v ms-atl-p-sun"
              data-field="meta.sky.value"
             style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'meta.sky.value')}
            </span>
          </div>
          <div className="ms-atl-p-mt" data-widget="meta.time">
            <span className="ms-atl-p-mt-k" data-field="meta.time.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'meta.time.label')}
            </span>
            <span className="ms-atl-p-mt-v" data-field="meta.time.value" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'meta.time.value')}
            </span>
          </div>
        </div>
      </section>

      {/* ─── HERO POSTER ─────────────────────────────────────── */}
      <section className="ms-atl-p-panel ms-atl-p-poster" data-widget="poster">
        <div className="ms-atl-p-chapter" data-field="poster.chapter" style={{ whiteSpace: 'pre-wrap' }}>
          {pick(cfg, 'poster.chapter')}
        </div>
        <h1 className="ms-atl-p-poster-h1">
          <span data-field="poster.h1.go" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'poster.h1.go')}</span>
          <em data-field="poster.h1.em" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'poster.h1.em')}</em>
          <br />
          <span className="ms-atl-p-mark" data-field="poster.h1.mark" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'poster.h1.mark')}
          </span>
        </h1>
        <p className="ms-atl-p-lede" data-field="poster.lede" style={{ whiteSpace: 'pre-wrap' }}>
          {pick(cfg, 'poster.lede')}
        </p>
        <div className="ms-atl-p-dests">
          <span className="ms-atl-p-dest">
            <span className="ms-atl-p-pin" />
            <span data-field="poster.dest.0" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'poster.dest.0')}</span>
          </span>
          <span className="ms-atl-p-dest">
            <span className="ms-atl-p-pin ms-atl-p-gold" />
            <span data-field="poster.dest.1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'poster.dest.1')}</span>
          </span>
          <span className="ms-atl-p-dest">
            <span className="ms-atl-p-pin ms-atl-p-blue" />
            <span data-field="poster.dest.2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'poster.dest.2')}</span>
          </span>
          <span className="ms-atl-p-dest">
            <span className="ms-atl-p-pin ms-atl-p-green" />
            <span data-field="poster.dest.3" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'poster.dest.3')}</span>
          </span>
        </div>
      </section>

      {/* ─── ALMANAC — sun + 6 weather cells + quote ─────────── */}
      <section className="ms-atl-p-panel ms-atl-p-almanac" data-widget="almanac">
        <div className="ms-atl-p-alm-head">
          <h3 className="ms-atl-p-alm-h3">
            <span data-field="almanac.title.go" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'almanac.title.go')}</span>
            <em data-field="almanac.title.em" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'almanac.title.em')}</em>
          </h3>
          <div className="ms-atl-p-vol" data-field="almanac.vol" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'almanac.vol')}
          </div>
        </div>
        <div className="ms-atl-p-alm-hero">
          <div className="ms-atl-p-alm-sun" aria-hidden="true">
            <div className="ms-atl-p-core" />
          </div>
          <div>
            <div className="ms-atl-p-alm-sky-label" data-field="almanac.sky.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'almanac.sky.label')}
            </div>
            <div
              className="ms-atl-p-alm-sky-headline"
              data-field="almanac.sky.headline"
             style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'almanac.sky.headline')}
            </div>
            <div className="ms-atl-p-alm-sky-sub" data-field="almanac.sky.sub" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'almanac.sky.sub')}
            </div>
          </div>
        </div>
        <div className="ms-atl-p-alm-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="ms-atl-p-alm-cell" key={i}>
              <span
                className="ms-atl-p-alm-k"
                data-field={`almanac.cell.${i}.k`}
               style={{ whiteSpace: 'pre-wrap' }}>
                {pick(
                  cfg,
                  `almanac.cell.${i}.k` as keyof Required<MsAtlasPortraitConfig>,
                )}
              </span>
              <span
                className="ms-atl-p-alm-v"
                data-field={`almanac.cell.${i}.v`}
               style={{ whiteSpace: 'pre-wrap' }}>
                {pick(
                  cfg,
                  `almanac.cell.${i}.v` as keyof Required<MsAtlasPortraitConfig>,
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="ms-atl-p-alm-quote">
          <span className="ms-atl-p-marks" aria-hidden="true">
            “
          </span>
          <span className="ms-atl-p-quote-body">
            <span data-field="almanac.quote.body" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'almanac.quote.body')}
            </span>
            <cite data-field="almanac.quote.cite" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'almanac.quote.cite')}
            </cite>
          </span>
          <span className="ms-atl-p-quote-stamp" data-field="almanac.quote.stamp" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'almanac.quote.stamp')}
          </span>
        </div>
      </section>

      {/* ─── ROUTES — 4 transit cards stacked vertically ─────── */}
      <section className="ms-atl-p-panel ms-atl-p-routes" data-widget="routes">
        <div className="ms-atl-p-routes-head">
          <h2 className="ms-atl-p-routes-h2">
            <span data-field="routes.title.go" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'routes.title.go')}</span>
            <em data-field="routes.title.em" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'routes.title.em')}</em>
          </h2>
          <div className="ms-atl-p-routes-meta" data-field="routes.meta" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'routes.meta')}
          </div>
        </div>
        <div className="ms-atl-p-stack">
          {renderRoute('morning', 'gold')}
          {renderRoute('afternoon', 'red')}
          {renderRoute('lunch', 'blue')}
          {renderRoute('clubs', 'green')}
        </div>
      </section>

      {/* ─── SPOTLIGHT — destination today ───────────────────── */}
      <section className="ms-atl-p-panel ms-atl-p-spotlight" data-widget="spot">
        <div className="ms-atl-p-spot-pin" aria-hidden="true" />
        <div className="ms-atl-p-spot-info">
          <div className="ms-atl-p-spot-ey" data-field="spot.eyebrow" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'spot.eyebrow')}
          </div>
          <div className="ms-atl-p-spot-t" data-field="spot.title" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'spot.title')}
          </div>
          <div className="ms-atl-p-spot-s" data-field="spot.sub" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'spot.sub')}
          </div>
        </div>
      </section>

      {/* ─── TICKER — bottom news bar ───────────────────────── */}
      <section className="ms-atl-p-panel ms-atl-p-ticker-row" data-widget="ticker">
        <div className="ms-atl-p-ticker-badge" data-field="ticker.tag" style={{ whiteSpace: 'pre-wrap' }}>
          {pick(cfg, 'ticker.tag')}
        </div>
        <div className="ms-atl-p-feed">
          <div className="ms-atl-p-feed-inner">
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
      </section>
    </HsStage>
  );
}

/** Inlined CSS — every pixel value matches scratch/design/atlas-ms-portrait-v1.html.
 *  The mockup's scale wrapper boilerplate (.viewport / .stage-outer /
 *  .stage / fit() script) is replaced by HsStage; everything else is
 *  ported verbatim with a `ms-atl-p-` prefix. */
const CSS = `
/* Box-sizing: border-box on every panel and descendant. The .panel rule
   in the mockup applies to all panels; portrait poster + almanac + routes
   panels rely on it to land on the intended edge with explicit padding +
   border combinations. */
.ms-atl-p-panel, .ms-atl-p-panel *, .ms-atl-p-panel *::before, .ms-atl-p-panel *::after,
.ms-atl-p-contour {
  box-sizing: border-box;
}

/* Faint contour-line decoration — two centers (upper-right + lower-left),
   sized for portrait. Mirrors the mockup's .stage::before; HsStage owns
   its own ::before so we use a dedicated div. */
.ms-atl-p-contour {
  position: absolute; inset: 0; pointer-events: none; opacity: .16; z-index: 0;
  background-image:
    radial-gradient(circle at 82% 22%, transparent 320px, rgba(11,18,32,.30) 322px, transparent 328px),
    radial-gradient(circle at 82% 22%, transparent 400px, rgba(11,18,32,.30) 402px, transparent 408px),
    radial-gradient(circle at 82% 22%, transparent 480px, rgba(11,18,32,.30) 482px, transparent 488px),
    radial-gradient(circle at 82% 22%, transparent 560px, rgba(11,18,32,.30) 562px, transparent 568px),
    radial-gradient(circle at 18% 78%, transparent 280px, rgba(11,18,32,.25) 282px, transparent 288px),
    radial-gradient(circle at 18% 78%, transparent 360px, rgba(11,18,32,.25) 362px, transparent 368px),
    radial-gradient(circle at 18% 78%, transparent 440px, rgba(11,18,32,.25) 442px, transparent 448px);
}

/* ─── PANEL DEFAULTS ───────────────────────────────────── */
/* Every panel inherits inset 64px left/right, overflow hidden, and
   position absolute. Heights and tops are explicit per panel. */
.ms-atl-p-panel { position: absolute; left: 64px; right: 64px; overflow: hidden; z-index: 2; }

/* ─── TOP BAND (y=80, h=460) ───────────────────────────── */
/* Horizontal lockup: compass on the left, school-name + eyebrow + sub
   filling the rest. No background — sits directly on paper. */
.ms-atl-p-top {
  top: 80px; height: 460px;
  display: grid; grid-template-columns: 360px 1fr; gap: 56px; align-items: center;
}

.ms-atl-p-compass-wrap { display: flex; align-items: center; justify-content: center; height: 100%; }
.ms-atl-p-compass {
  width: 360px; height: 360px; position: relative; flex-shrink: 0;
  background: #fff;
  border: 8px solid #0b1220;
  border-radius: 50%;
  box-shadow: 14px 14px 0 #0b1220;
}
.ms-atl-p-compass::before {                    /* dashed inner ring */
  content: ''; position: absolute; inset: 32px; border-radius: 50%;
  border: 3px dashed rgba(11,18,32,.45);
}
.ms-atl-p-compass::after {                     /* north needle */
  content: ''; position: absolute; top: 28px; left: 50%;
  width: 0; height: 0; transform: translateX(-50%);
  border: 44px solid transparent; border-bottom-color: #d64c34; border-top: 0;
}
.ms-atl-p-s-needle {                           /* south needle */
  position: absolute; bottom: 28px; left: 50%;
  width: 0; height: 0; transform: translateX(-50%);
  border: 44px solid transparent; border-top-color: #0b1220; border-bottom: 0;
}
.ms-atl-p-cardinal {
  position: absolute; font-family: 'Work Sans', system-ui, sans-serif;
  font-weight: 900; font-size: 52px; color: #0b1220;
  letter-spacing: .04em;
}
.ms-atl-p-cardinal.ms-atl-p-n { top: -76px; left: 50%; transform: translateX(-50%); }
.ms-atl-p-cardinal.ms-atl-p-s { bottom: -76px; left: 50%; transform: translateX(-50%); color: #2f3e52; }
.ms-atl-p-cardinal.ms-atl-p-e { right: -68px; top: 50%; transform: translateY(-50%); color: #2f3e52; }
.ms-atl-p-cardinal.ms-atl-p-w { left: -68px; top: 50%; transform: translateY(-50%); color: #2f3e52; }

.ms-atl-p-info {
  display: flex; flex-direction: column; justify-content: center; gap: 0;
}
.ms-atl-p-eye {
  font-family: 'DM Mono', monospace; font-size: 42px; font-weight: 700;
  letter-spacing: .24em; text-transform: uppercase; color: #d64c34;
  display: inline-flex; align-items: center; gap: 22px;
}
.ms-atl-p-eye::before {
  content: ''; width: 80px; height: 5px; background: #d64c34;
}
.ms-atl-p-bname {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 220px;
  color: #0b1220; line-height: .9; letter-spacing: -.035em;
  margin-top: 16px;
}
.ms-atl-p-bsub {
  font-family: 'DM Mono', monospace; font-size: 44px; font-weight: 500;
  color: #2f3e52; letter-spacing: .16em; text-transform: uppercase;
  margin-top: 24px;
}
.ms-atl-p-bsub b { color: #d64c34; font-weight: 700; }

/* ─── DATE STRIP (y=560, h=240) ────────────────────────── */
/* Center date banner on the left, three meta tiles on the right.
   This is the "Tuesday, Apr 21" block + Temp/Sky/Time. */
.ms-atl-p-date-strip {
  top: 560px; height: 240px;
  display: grid; grid-template-columns: 1fr auto; gap: 40px; align-items: center;
}
.ms-atl-p-center-banner {
  display: flex; flex-direction: column; justify-content: center;
  padding: 0 8px;
}
.ms-atl-p-cb-label {
  font-family: 'DM Mono', monospace; font-size: 36px; font-weight: 700;
  letter-spacing: .26em; text-transform: uppercase; color: #2f3e52;
}
.ms-atl-p-cb-date {
  font-family: 'Playfair Display', serif; font-style: italic; font-weight: 900;
  font-size: 156px; color: #0b1220; line-height: 1; letter-spacing: -.02em;
  margin-top: 6px;
}
.ms-atl-p-cb-stamp {
  align-self: flex-start;
  margin-top: 16px;
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 800; font-size: 32px;
  letter-spacing: .18em; text-transform: uppercase; color: #d64c34;
  padding: 10px 28px; border: 4px solid #d64c34; border-radius: 999px;
  transform: rotate(-2deg);
}

.ms-atl-p-meta-tiles { display: flex; gap: 24px; align-items: center; }
.ms-atl-p-mt {
  width: 200px; height: 200px;
  padding: 24px 26px;
  background: #fff; border: 5px solid #0b1220;
  box-shadow: 8px 8px 0 #0b1220;
  display: flex; flex-direction: column; justify-content: space-between;
}
.ms-atl-p-mt-k {
  font-family: 'DM Mono', monospace; font-size: 24px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: #2f3e52;
}
.ms-atl-p-mt-v {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 96px;
  color: #0b1220; line-height: 1; letter-spacing: -.02em;
}
.ms-atl-p-mt-v.ms-atl-p-warm { color: #d64c34; }
.ms-atl-p-mt-v.ms-atl-p-cool { color: #2e6ed0; }
.ms-atl-p-mt-v.ms-atl-p-sun  { color: #e0a726; }

/* ─── HERO POSTER (y=820, h=840) ───────────────────────── */
/* Full-width travel poster — headline gets the full canvas in
   portrait. */
.ms-atl-p-poster {
  top: 820px; height: 840px;
  background: #fff; border: 6px solid #0b1220;
  box-shadow: 16px 16px 0 #0b1220;
  padding: 80px 96px;
  display: flex; flex-direction: column; justify-content: center;
}
.ms-atl-p-poster::before {
  content: ''; position: absolute; inset: 24px;
  border: 3px solid #0b1220; pointer-events: none;
}
.ms-atl-p-poster::after {
  content: ''; position: absolute; right: -160px; bottom: -160px;
  width: 700px; height: 700px; border-radius: 50%;
  background: radial-gradient(circle, rgba(224,167,38,.24), transparent 70%);
  pointer-events: none;
}
.ms-atl-p-chapter {
  font-family: 'DM Mono', monospace; font-size: 44px; font-weight: 700;
  letter-spacing: .26em; text-transform: uppercase; color: #d64c34;
  margin-bottom: 24px;
  display: inline-flex; align-items: center; gap: 28px;
}
.ms-atl-p-chapter::before {
  content: ''; width: 80px; height: 6px; background: #d64c34;
}
.ms-atl-p-poster-h1 {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900;
  font-size: 280px; line-height: .88; letter-spacing: -.035em;
  color: #0b1220; margin: 0;
  text-wrap: balance;
}
.ms-atl-p-poster-h1 em {
  font-style: italic; color: #d64c34;
  font-family: 'Playfair Display', serif; font-weight: 900;
}
.ms-atl-p-poster-h1 .ms-atl-p-mark { color: #2e6ed0; }
.ms-atl-p-lede {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 500;
  font-size: 60px; line-height: 1.28;
  color: #2f3e52; margin-top: 40px; max-width: 1700px;
}
.ms-atl-p-dests {
  margin-top: 40px; display: flex; gap: 22px; flex-wrap: wrap;
}
.ms-atl-p-dest {
  display: inline-flex; align-items: center; gap: 18px;
  padding: 18px 32px;
  background: #ece3cc; border: 4px solid #0b1220;
  border-radius: 999px;
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 800; font-size: 40px;
  color: #0b1220; letter-spacing: -.005em;
}
.ms-atl-p-dest .ms-atl-p-pin {
  width: 38px; height: 48px;
  background: #d64c34;
  clip-path: polygon(50% 100%, 0 40%, 0 20%, 50% 0, 100% 20%, 100% 40%);
}
.ms-atl-p-dest .ms-atl-p-pin.ms-atl-p-gold  { background: #e0a726; }
.ms-atl-p-dest .ms-atl-p-pin.ms-atl-p-blue  { background: #2e6ed0; }
.ms-atl-p-dest .ms-atl-p-pin.ms-atl-p-green { background: #3a8d5d; }

/* ─── ALMANAC (y=1680, h=700) ──────────────────────────── */
/* School-agnostic block: sun + 6 weather cells + quote.
   Reorganized for portrait — sun on the left, big sky headline,
   6 cells in a 3×2 grid, quote ribbon at the bottom. */
.ms-atl-p-almanac {
  top: 1680px; height: 700px;
  background: #fff; border: 6px solid #0b1220;
  box-shadow: 16px 16px 0 #0b1220;
  padding: 36px 50px 36px;
  display: flex; flex-direction: column;
}
.ms-atl-p-almanac::before {
  /* Faint compass-rose watermark */
  content: ''; position: absolute; right: -160px; top: -160px;
  width: 600px; height: 600px; border-radius: 50%;
  background:
    conic-gradient(from 0deg, transparent 0 80deg, rgba(11,18,32,.04) 80deg 100deg, transparent 100deg 170deg, rgba(11,18,32,.04) 170deg 190deg, transparent 190deg 260deg, rgba(11,18,32,.04) 260deg 280deg, transparent 280deg 350deg, rgba(11,18,32,.04) 350deg 360deg);
  pointer-events: none;
}
.ms-atl-p-alm-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding-bottom: 22px; border-bottom: 4px solid #0b1220;
}
.ms-atl-p-alm-h3 {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 84px;
  color: #0b1220; margin: 0; letter-spacing: -.02em; line-height: 1;
}
.ms-atl-p-alm-h3 em {
  font-family: 'Playfair Display', serif; font-style: italic;
  color: #2e6ed0; font-weight: 900;
}
.ms-atl-p-vol {
  font-family: 'DM Mono', monospace; font-size: 28px; font-weight: 500;
  letter-spacing: .18em; text-transform: uppercase; color: #2f3e52;
}

/* Sun + sky condition headline */
.ms-atl-p-alm-hero {
  margin-top: 24px;
  padding: 22px 28px;
  background: linear-gradient(180deg, #fff8e0 0%, #fff 70%);
  border: 4px solid #0b1220;
  display: grid; grid-template-columns: 240px 1fr; gap: 36px; align-items: center;
  flex-shrink: 0;
}
.ms-atl-p-alm-sun {
  width: 240px; height: 240px; position: relative;
  display: grid; place-items: center;
}
.ms-atl-p-alm-sun .ms-atl-p-core {
  width: 150px; height: 150px; border-radius: 50%;
  background: radial-gradient(circle at 38% 38%, #ffe089 0%, #f5b54b 60%, #d99129 100%);
  border: 5px solid #0b1220;
  box-shadow: 5px 5px 0 #0b1220;
  z-index: 2;
}
.ms-atl-p-alm-sun::before {
  content: ''; position: absolute; inset: 0;
  background: conic-gradient(from 0deg,
    #0b1220 0deg 4deg, transparent 4deg 30deg,
    #0b1220 30deg 34deg, transparent 34deg 60deg,
    #0b1220 60deg 64deg, transparent 64deg 90deg,
    #0b1220 90deg 94deg, transparent 94deg 120deg,
    #0b1220 120deg 124deg, transparent 124deg 150deg,
    #0b1220 150deg 154deg, transparent 154deg 180deg,
    #0b1220 180deg 184deg, transparent 184deg 210deg,
    #0b1220 210deg 214deg, transparent 214deg 240deg,
    #0b1220 240deg 244deg, transparent 244deg 270deg,
    #0b1220 270deg 274deg, transparent 274deg 300deg,
    #0b1220 300deg 304deg, transparent 304deg 330deg,
    #0b1220 330deg 334deg, transparent 334deg 360deg);
  -webkit-mask: radial-gradient(circle, transparent 90px, #000 91px);
          mask: radial-gradient(circle, transparent 90px, #000 91px);
}
.ms-atl-p-alm-sky-label {
  font-family: 'DM Mono', monospace; font-size: 26px; font-weight: 500;
  letter-spacing: .2em; text-transform: uppercase; color: #d64c34;
}
.ms-atl-p-alm-sky-headline {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 110px;
  color: #0b1220; margin: 6px 0 4px; letter-spacing: -.02em; line-height: .95;
}
.ms-atl-p-alm-sky-sub {
  font-family: 'Playfair Display', serif; font-style: italic; font-weight: 900;
  font-size: 44px; color: #2f3e52;
}

/* Almanac data grid — 6 cells in 3 columns × 2 rows */
.ms-atl-p-alm-grid {
  margin-top: 20px;
  display: grid; grid-template-columns: 1fr 1fr 1fr;
  border: 4px solid #0b1220; background: #ece3cc;
  flex-shrink: 0;
}
.ms-atl-p-alm-cell {
  padding: 18px 22px; border-right: 3px solid #0b1220; border-bottom: 3px solid #0b1220;
  display: flex; flex-direction: column; gap: 4px;
}
.ms-atl-p-alm-cell:nth-child(3n) { border-right: 0; }
.ms-atl-p-alm-cell:nth-last-child(-n+3) { border-bottom: 0; }
.ms-atl-p-alm-cell .ms-atl-p-alm-k {
  font-family: 'DM Mono', monospace; font-size: 24px; font-weight: 500;
  letter-spacing: .18em; text-transform: uppercase; color: #2f3e52;
}
.ms-atl-p-alm-cell .ms-atl-p-alm-v {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 64px;
  color: #0b1220; letter-spacing: -.01em; line-height: 1;
}

/* Quote ribbon at the bottom */
.ms-atl-p-alm-quote {
  margin-top: auto; padding-top: 18px; border-top: 4px dashed #0b1220;
  display: grid; grid-template-columns: auto 1fr auto; gap: 26px; align-items: center;
}
.ms-atl-p-alm-quote .ms-atl-p-marks {
  font-family: 'Playfair Display', serif; font-style: italic; font-weight: 900;
  font-size: 120px; color: #e0a726; line-height: .65;
}
.ms-atl-p-alm-quote .ms-atl-p-quote-body {
  font-family: 'Playfair Display', serif; font-style: italic; font-weight: 900;
  font-size: 38px; line-height: 1.22; color: #0b1220;
}
.ms-atl-p-alm-quote .ms-atl-p-quote-body cite {
  display: block; margin-top: 6px;
  font-family: 'DM Mono', monospace; font-style: normal; font-weight: 500;
  font-size: 22px; letter-spacing: .15em; text-transform: uppercase; color: #2f3e52;
}
.ms-atl-p-alm-quote .ms-atl-p-quote-stamp {
  border: 4px solid #d64c34; color: #d64c34;
  padding: 10px 18px; transform: rotate(4deg);
  font-family: 'DM Mono', monospace; font-size: 22px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase;
}

/* ─── ROUTES (y=2400, h=940) ───────────────────────────── */
/* 4 transit cards stacked vertically. Each card is now horizontal —
   badge + name on the left, stops in the middle, status on the right.
   Massively more readable than the squished 4-across grid. */
.ms-atl-p-routes {
  top: 2400px; height: 940px;
  background: #fff; border: 6px solid #0b1220;
  box-shadow: 16px 16px 0 #0b1220;
  padding: 32px 50px;
  display: flex; flex-direction: column;
}
.ms-atl-p-routes-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  padding-bottom: 18px; border-bottom: 4px solid #0b1220;
  margin-bottom: 18px; flex-shrink: 0;
}
.ms-atl-p-routes-h2 {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 88px;
  color: #0b1220; margin: 0; letter-spacing: -.02em; line-height: 1;
}
.ms-atl-p-routes-h2 em {
  font-family: 'Playfair Display', serif; font-style: italic;
  color: #d64c34; font-weight: 900;
}
.ms-atl-p-routes-meta {
  font-family: 'DM Mono', monospace; font-size: 28px; font-weight: 500;
  letter-spacing: .18em; text-transform: uppercase; color: #2f3e52;
}
.ms-atl-p-stack {
  display: flex; flex-direction: column; gap: 14px;
  flex: 1; min-height: 0;
}
.ms-atl-p-route {
  flex: 1;
  padding: 14px 20px;
  background: #f4ecd8;
  border: 4px solid #0b1220;
  box-shadow: 5px 5px 0 rgba(11,18,32,.25);
  display: grid;
  grid-template-columns: 460px 1fr 240px;
  gap: 24px; align-items: center;
}

/* Left: badge + line name + period sub */
.ms-atl-p-label {
  display: flex; align-items: center; gap: 22px; min-width: 0;
}
.ms-atl-p-badge {
  width: 110px; height: 110px; border-radius: 50%;
  display: grid; place-items: center;
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 48px;
  color: #fff; border: 5px solid #0b1220;
  letter-spacing: .02em;
  flex-shrink: 0;
  box-shadow: 4px 4px 0 #0b1220;
}
.ms-atl-p-badge.ms-atl-p-gold  { background: #e0a726; color: #0b1220; }
.ms-atl-p-badge.ms-atl-p-red   { background: #d64c34; }
.ms-atl-p-badge.ms-atl-p-blue  { background: #2e6ed0; }
.ms-atl-p-badge.ms-atl-p-green { background: #3a8d5d; }
.ms-atl-p-name {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 56px;
  color: #0b1220; line-height: 1; letter-spacing: -.01em;
  min-width: 0; overflow: hidden;
}
.ms-atl-p-name span:nth-child(2) {
  display: block;
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 22px;
  letter-spacing: .14em; text-transform: uppercase; color: #2f3e52;
  margin-top: 8px;
}

/* Middle: stops with rail + next-up ride detail */
.ms-atl-p-center {
  display: flex; flex-direction: column; gap: 8px;
  min-width: 0;
}
.ms-atl-p-stops {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 14px;
  border-top: 3px solid #0b1220; border-bottom: 3px solid #0b1220;
  position: relative;
}
.ms-atl-p-stops::before {
  content: ''; position: absolute; left: 32px; right: 32px; top: 50%;
  height: 6px; background: #0b1220; transform: translateY(-50%);
}
.ms-atl-p-st {
  display: flex; flex-direction: row; align-items: center; gap: 12px;
  position: relative; z-index: 1;
  background: #f4ecd8; padding: 4px 8px;
}
.ms-atl-p-st .ms-atl-p-dot {
  width: 26px; height: 26px; border-radius: 50%;
  background: #fff; border: 5px solid #0b1220;
  flex-shrink: 0;
}
.ms-atl-p-st.ms-atl-p-now .ms-atl-p-dot {
  background: #0b1220; box-shadow: 0 0 0 4px #f4ecd8, 0 0 0 8px #0b1220;
}
.ms-atl-p-st .ms-atl-p-lb {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 36px;
  letter-spacing: .04em; color: #2f3e52;
}
.ms-atl-p-st.ms-atl-p-now .ms-atl-p-lb { color: #d64c34; }
.ms-atl-p-next {
  display: flex; align-items: baseline; gap: 16px;
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 700; font-size: 30px;
  color: #0b1220; line-height: 1.2;
  padding: 0 4px;
}
.ms-atl-p-next .ms-atl-p-next-title {
  font-weight: 800; color: #0b1220;
}
.ms-atl-p-next .ms-atl-p-next-sub {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 22px;
  letter-spacing: .12em; text-transform: uppercase; color: #2f3e52;
}

/* Right: status pill, vertically centered */
.ms-atl-p-status {
  justify-self: end;
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 800; font-size: 34px;
  padding: 14px 24px; border: 4px solid #0b1220;
  letter-spacing: .06em; text-transform: uppercase;
  text-align: center;
  min-width: 220px;
}
.ms-atl-p-status.ms-atl-p-on   { background: #d7eadb; color: #1f6a3f; }
.ms-atl-p-status.ms-atl-p-late { background: #fadcd4; color: #9b2f18; }
.ms-atl-p-status.ms-atl-p-soon { background: #dfe9f9; color: #264f99; }

/* ─── SPOTLIGHT (y=3360, h=220) ────────────────────────── */
.ms-atl-p-spotlight {
  top: 3360px; height: 220px;
  background: #0b1220; color: #f4ecd8;
  border: 6px solid #0b1220;
  box-shadow: 12px 12px 0 #e0a726;
  padding: 28px 40px;
  display: grid; grid-template-columns: auto 1fr; gap: 40px; align-items: center;
}
.ms-atl-p-spot-pin {
  width: 130px; height: 168px;
  background: #d64c34;
  clip-path: polygon(50% 100%, 0 40%, 0 20%, 50% 0, 100% 20%, 100% 40%);
  display: grid; place-items: center;
  position: relative;
  flex-shrink: 0;
}
.ms-atl-p-spot-pin::after {
  content: ''; width: 46px; height: 46px; border-radius: 50%;
  background: #f4ecd8; position: absolute; top: 32px;
}
.ms-atl-p-spot-info .ms-atl-p-spot-ey {
  font-family: 'DM Mono', monospace; font-size: 28px; font-weight: 700;
  letter-spacing: .24em; text-transform: uppercase; color: #e0a726;
}
.ms-atl-p-spot-info .ms-atl-p-spot-t {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 76px;
  color: #f4ecd8; margin-top: 6px; line-height: 1; letter-spacing: -.015em;
}
.ms-atl-p-spot-info .ms-atl-p-spot-s {
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 500; font-size: 36px;
  color: rgba(244,236,216,.82); margin-top: 10px;
}

/* ─── TICKER (y=3600, h=140) ───────────────────────────── */
.ms-atl-p-ticker-row {
  top: 3600px; height: 140px;
  background: #f4ecd8; border: 6px solid #0b1220;
  box-shadow: 12px 12px 0 #0b1220;
  display: grid; grid-template-columns: auto 1fr; align-items: stretch;
}
.ms-atl-p-ticker-badge {
  background: #e0a726; color: #0b1220;
  padding: 0 48px;
  display: flex; align-items: center; gap: 22px;
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 900; font-size: 48px;
  letter-spacing: .02em;
  border-right: 6px solid #0b1220;
}
.ms-atl-p-ticker-badge::before {
  content: '★'; color: #0b1220; font-size: 44px;
}
.ms-atl-p-feed {
  overflow: hidden; display: flex; align-items: center;
  padding-left: 40px;
}
.ms-atl-p-feed-inner {
  display: flex; gap: 72px;
  font-family: 'Work Sans', system-ui, sans-serif; font-weight: 600; font-size: 48px;
  color: #0b1220; white-space: nowrap;
  animation: msAtlPScroll 60s linear infinite;
}
.ms-atl-p-feed-inner span { display: inline-flex; align-items: center; gap: 24px; }
.ms-atl-p-feed-inner span::after {
  content: '•'; color: #d64c34; margin-left: 36px;
}
@keyframes msAtlPScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
`;
