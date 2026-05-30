"use client";

/**
 * FitnessRecessWidget — 4K family-gym playground scene, 3840x2160.
 *
 * APPROVED 2026-05-03 — matches scratch/design/fitness/11-recess.html
 * Ported via HsStage transform:scale pattern. Every pixel size is FIXED
 * (matches the HTML mockup); DO NOT regress to vw/%.
 *
 * Visual DNA — friendly playground / kids-program aesthetic:
 *   - Sky-to-grass gradient (#5cc5ee -> #aae0f4 -> #7cc66c)
 *   - Crayon palette: sun #ffd23f, hot #ee5a3c, pink #ff8cb5, plum #7a4baa
 *   - Decorative sun + two clouds in the upper background
 *   - Fredoka display + Outfit body + JetBrains Mono labels
 *   - Massive "Recess Time!" title with thick ink drop shadow
 *   - 5-tile rounded grid (1.4fr / 1fr / 1fr columns x 2 rows)
 *     feature tile spans both rows; b/c tiles top right; d/ksched bottom
 *   - Bottom dark ink strip with sun-yellow badge
 *
 * Editable hotspots (data-field keys, dot notation):
 *   head.pre, head.t1, head.t2
 *   feature.tag, feature.t1, feature.t2, feature.ini, feature.who, feature.body, feature.meta
 *   b.tag, b.h, b.age, b.body, b.meta
 *   c.tag, c.h, c.age, c.body, c.meta
 *   d.tag, d.h, d.age, d.body, d.meta
 *   ksched.tag, ksched.h, ksched.t1..5, ksched.i1..5
 *   strip.tag, strip.message
 */

import { HsStage } from '../hs/HsStage';

export interface FitnessRecessConfig {
  // Gym logo — optional image for the header area
  gymLogoUrl?: string;
  // Header
  'head.pre'?: string;
  'head.t1'?: string;
  'head.t2'?: string;
  // Feature tile (Coach of the Week)
  'feature.tag'?: string;
  'feature.t1'?: string;
  'feature.t2'?: string;
  'feature.ini'?: string;
  'feature.who'?: string;
  'feature.body'?: string;
  'feature.meta'?: string;
  // Tile B — Family Swim
  'b.tag'?: string;
  'b.h'?: string;
  'b.age'?: string;
  'b.body'?: string;
  'b.meta'?: string;
  // Tile C — Spring Break Camp
  'c.tag'?: string;
  'c.h'?: string;
  'c.age'?: string;
  'c.body'?: string;
  'c.meta'?: string;
  // Tile D — Tiny Tots
  'd.tag'?: string;
  'd.h'?: string;
  'd.age'?: string;
  'd.body'?: string;
  'd.meta'?: string;
  // Tile E — Kids schedule
  'ksched.tag'?: string;
  'ksched.h'?: string;
  'ksched.t1'?: string;
  'ksched.i1'?: string;
  'ksched.t2'?: string;
  'ksched.i2'?: string;
  'ksched.t3'?: string;
  'ksched.i3'?: string;
  'ksched.t4'?: string;
  'ksched.i4'?: string;
  'ksched.t5'?: string;
  'ksched.i5'?: string;
  // Bottom strip
  'strip.tag'?: string;
  'strip.message'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  // Gym logo image upload (optional — falls back to text heading)
  'gymLogoUrl':     '',
  'head.pre':       '★ FAMILY GYM · DROP-IN OPEN ★',
  'head.t1':        'Recess ',
  'head.t2':        'Time!',

  'feature.tag':    '▸ COACH OF THE WEEK',
  'feature.t1':     'Coach ',
  'feature.t2':     'Maya!',
  'feature.ini':    'M',
  'feature.who':    '★ KIDS NINJA + TINY TUMBLERS',
  'feature.body':   '"My favorite part of the day is when a kid lands a cartwheel for the first time. Their face lights up like the whole world cracked open."',
  'feature.meta':   '▸ ASK FOR MAYA AT THE FRONT DESK',

  'b.tag':          '▸ THIS AFTERNOON',
  'b.h':            'FAMILY SWIM',
  'b.age':          'ALL AGES · POOL DECK',
  'b.body':         'Whole shallow end open. Toys + noodles. Lifeguards on duty.',
  'b.meta':         '▸ SAT/SUN · 12:00 — 3:00 PM',

  'c.tag':          '▸ SPRING BREAK CAMP',
  'c.h':            'NINJA WEEK!',
  'c.age':          'AGES 6 — 11',
  'c.body':         'Obstacle course, parkour basics, dodgeball. Lunch + snack included.',
  'c.meta':         '▸ MAR 25 — 29 · 9A — 3P · $185',

  'd.tag':          '▸ PARENT & ME',
  'd.h':            'TINY TOTS',
  'd.age':          'AGES 18m — 3y',
  'd.body':         'Wiggle, climb, sing. Bring sock feet + a snack. No registration needed.',
  'd.meta':         '▸ TUE/THU · 10:00 AM · GYM 2',

  'ksched.tag':     '▸ KID-OPEN PLAY · TODAY',
  'ksched.h':       'Free Play.',
  'ksched.t1':      '9:30A',
  'ksched.i1':      'Toddler tumble — gym 2',
  'ksched.t2':      '11:00A',
  'ksched.i2':      'Bounce house — gym 1',
  'ksched.t3':      '2:00P',
  'ksched.i3':      "Kids' wall climbs — bouldering",
  'ksched.t4':      '4:30P',
  'ksched.i4':      'After-school dodgeball — gym 1',
  'ksched.t5':      '6:00P',
  'ksched.i5':      'Family swim — pool deck',

  'strip.tag':      '★ TODAY',
  'strip.message':  'Free childcare during your workout — drop off at the Sunshine Room (max 2 hrs) · Spring Break sign-ups close Friday · Birthday parties book at the front desk',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessRecessConfig | undefined, key: keyof typeof DEFAULTS): string {
  return ((cfg as any)?.[key] as string | undefined) ?? DEFAULTS[key];
}

export function FitnessRecessWidget({ config }: { config?: FitnessRecessConfig }) {
  return (
    <HsStage
      stageClassName="fr-stage"
      stageStyle={{
        background: 'linear-gradient(180deg, #5cc5ee 0%, #aae0f4 60%, #7cc66c 100%)',
        color: '#1a1530',
        fontFamily: "'Fredoka', system-ui, sans-serif",
        fontWeight: 500,
      }}
    >
      <style>{CSS}</style>

      {/* Decorative sun + clouds */}
      <div className="fr-sun" />
      <div className="fr-cloud fr-c1" />
      <div className="fr-cloud fr-c2" />

      {/* Header */}
      <div className="fr-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {pick(config, 'gymLogoUrl') && (
          <img src={pick(config, 'gymLogoUrl')} alt="Gym logo" className="fr-gym-logo" />
        )}
        <div className="fr-preti" data-field="head.pre">{pick(config, 'head.pre')}</div>
        <h1 className="fr-h1">
          <span data-field="head.t1">{pick(config, 'head.t1')}</span>
          <em data-field="head.t2">{pick(config, 'head.t2')}</em>
        </h1>
      </div>

      {/* Tile grid */}
      <div className="fr-grid">

        {/* Feature tile (spans both rows) */}
        <div className="fr-tile fr-feature">
          <div className="fr-tag" data-field="feature.tag">{pick(config, 'feature.tag')}</div>
          <h3 className="fr-h3">
            <span data-field="feature.t1">{pick(config, 'feature.t1')}</span>
            <em data-field="feature.t2">{pick(config, 'feature.t2')}</em>
          </h3>
          <div className="fr-ph" data-field="feature.ini">{pick(config, 'feature.ini')}</div>
          <div className="fr-who" data-field="feature.who">{pick(config, 'feature.who')}</div>
          <div className="fr-body" data-field="feature.body">{pick(config, 'feature.body')}</div>
          <div className="fr-meta" data-field="feature.meta">{pick(config, 'feature.meta')}</div>
        </div>

        {/* Tile B — Family Swim */}
        <div className="fr-tile fr-b">
          <div className="fr-tag" data-field="b.tag">{pick(config, 'b.tag')}</div>
          <h3 className="fr-h3" data-field="b.h">{pick(config, 'b.h')}</h3>
          <span className="fr-age" data-field="b.age">{pick(config, 'b.age')}</span>
          <div className="fr-body" data-field="b.body">{pick(config, 'b.body')}</div>
          <div className="fr-meta" data-field="b.meta">{pick(config, 'b.meta')}</div>
        </div>

        {/* Tile C — Spring Break Camp */}
        <div className="fr-tile fr-c">
          <div className="fr-tag" data-field="c.tag">{pick(config, 'c.tag')}</div>
          <h3 className="fr-h3" data-field="c.h">{pick(config, 'c.h')}</h3>
          <span className="fr-age" data-field="c.age">{pick(config, 'c.age')}</span>
          <div className="fr-body" data-field="c.body">{pick(config, 'c.body')}</div>
          <div className="fr-meta" data-field="c.meta">{pick(config, 'c.meta')}</div>
        </div>

        {/* Tile D — Tiny Tots */}
        <div className="fr-tile fr-d">
          <div className="fr-tag" data-field="d.tag">{pick(config, 'd.tag')}</div>
          <h3 className="fr-h3" data-field="d.h">{pick(config, 'd.h')}</h3>
          <span className="fr-age" data-field="d.age">{pick(config, 'd.age')}</span>
          <div className="fr-body" data-field="d.body">{pick(config, 'd.body')}</div>
          <div className="fr-meta" data-field="d.meta">{pick(config, 'd.meta')}</div>
        </div>

        {/* Tile E — Kids schedule */}
        <div className="fr-tile fr-e fr-ksched">
          <div className="fr-tag" data-field="ksched.tag">{pick(config, 'ksched.tag')}</div>
          <h3 className="fr-h3 fr-ksched-h" data-field="ksched.h">{pick(config, 'ksched.h')}</h3>
          <div className="fr-item">
            <div className="fr-tm" data-field="ksched.t1">{pick(config, 'ksched.t1')}</div>
            <div className="fr-ti" data-field="ksched.i1">{pick(config, 'ksched.i1')}</div>
          </div>
          <div className="fr-item">
            <div className="fr-tm" data-field="ksched.t2">{pick(config, 'ksched.t2')}</div>
            <div className="fr-ti" data-field="ksched.i2">{pick(config, 'ksched.i2')}</div>
          </div>
          <div className="fr-item">
            <div className="fr-tm" data-field="ksched.t3">{pick(config, 'ksched.t3')}</div>
            <div className="fr-ti" data-field="ksched.i3">{pick(config, 'ksched.i3')}</div>
          </div>
          <div className="fr-item">
            <div className="fr-tm" data-field="ksched.t4">{pick(config, 'ksched.t4')}</div>
            <div className="fr-ti" data-field="ksched.i4">{pick(config, 'ksched.i4')}</div>
          </div>
          <div className="fr-item">
            <div className="fr-tm" data-field="ksched.t5">{pick(config, 'ksched.t5')}</div>
            <div className="fr-ti" data-field="ksched.i5">{pick(config, 'ksched.i5')}</div>
          </div>
        </div>

      </div>

      {/* Bottom strip */}
      <div className="fr-strip">
        <div className="fr-badge" data-field="strip.tag">{pick(config, 'strip.tag')}</div>
        <div className="fr-msg" data-field="strip.message">{pick(config, 'strip.message')}</div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Outfit:wght@400;700;900&family=Fredoka:wght@500;700&family=JetBrains+Mono:wght@500;700&display=swap');

.fr-sun {
  position: absolute; top: 120px; right: 200px;
  width: 380px; height: 380px; border-radius: 50%;
  background: #ffd23f;
  box-shadow: 0 0 0 30px rgba(255,210,63,.4), 0 0 0 70px rgba(255,210,63,.18);
}
.fr-cloud {
  position: absolute; background: #fff; border-radius: 80px;
  box-shadow: 0 0 0 14px rgba(255,255,255,.5);
}
.fr-c1 { top: 200px; left: 200px; width: 380px; height: 120px; }
.fr-c1::before {
  content: ''; position: absolute; top: -60px; left: 80px;
  width: 160px; height: 160px; background: #fff; border-radius: 50%;
}
.fr-c1::after {
  content: ''; position: absolute; top: -40px; left: 200px;
  width: 120px; height: 120px; background: #fff; border-radius: 50%;
}
.fr-c2 { top: 380px; left: 1400px; width: 300px; height: 90px; }
.fr-c2::before {
  content: ''; position: absolute; top: -50px; left: 60px;
  width: 130px; height: 130px; background: #fff; border-radius: 50%;
}

.fr-head {
  position: absolute; top: 120px; left: 120px;
}
.fr-gym-logo { height: 100px; width: auto; object-fit: contain; object-position: left top; margin-bottom: 16px; display: block; }
.fr-preti {
  font-family: 'Outfit'; font-weight: 900; font-size: 54px;
  letter-spacing: .18em; color: #1a1530;
  background: #ffd23f; padding: 14px 30px; border-radius: 30px;
  display: inline-block; box-shadow: 6px 6px 0 #1a1530;
}
.fr-h1 {
  font-family: 'Fredoka'; font-weight: 700; font-size: 380px;
  line-height: .85; letter-spacing: -.04em;
  color: #fffdf2; margin: 30px 0 0;
  text-shadow: 12px 12px 0 #1a1530;
}
.fr-h1 em { font-style: normal; color: #ee5a3c; }

.fr-grid {
  position: absolute; top: 920px; left: 120px; right: 120px; height: 1080px;
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 40px;
}

.fr-tile {
  background: #fffdf2; border: 10px solid #1a1530; border-radius: 50px;
  padding: 50px 56px;
  box-shadow: 14px 14px 0 #1a1530;
  position: relative;
}
.fr-feature { grid-row: 1 / span 2; background: #ee5a3c; color: #fffdf2; }
.fr-b { background: #7a4baa; color: #fffdf2; }
.fr-c { background: #ffd23f; }
.fr-d { background: #ff8cb5; }
.fr-e { background: #fffdf2; }

.fr-tag {
  font-family: 'Outfit'; font-weight: 900; font-size: 30px; letter-spacing: .22em;
}
.fr-h3 {
  font-family: 'Fredoka'; font-weight: 700; font-size: 130px;
  line-height: .85; letter-spacing: -.03em; margin: 14px 0 0;
}
.fr-h3 em { font-style: normal; }
.fr-feature .fr-h3 em { color: #ffd23f; }
.fr-body {
  font-family: 'Outfit'; font-weight: 700; font-size: 38px;
  line-height: 1.3; margin-top: 20px;
}
.fr-meta {
  font-family: 'JetBrains Mono'; font-weight: 700; font-size: 30px;
  letter-spacing: .18em; margin-top: 18px;
}
.fr-meta b { color: inherit; }

.fr-feature .fr-ph {
  width: 340px; height: 340px; border-radius: 50%; background: #ffd23f;
  margin: 24px auto 0; border: 10px solid #fffdf2;
  display: grid; place-items: center;
  font-family: 'Fredoka'; font-weight: 700; font-size: 200px; color: #1a1530;
}
.fr-feature .fr-who {
  font-family: 'Outfit'; font-weight: 900; font-size: 50px;
  text-align: center; letter-spacing: .06em; margin-top: 18px;
}

.fr-age {
  display: inline-block; padding: 10px 24px; border-radius: 30px;
  background: #1a1530; color: #fffdf2;
  font-family: 'JetBrains Mono'; font-weight: 700; font-size: 28px;
  letter-spacing: .18em; margin-top: 14px;
}

.fr-ksched-h {
  font-size: 74px !important;
  margin-bottom: 10px;
}
.fr-item {
  display: flex; align-items: baseline; gap: 18px; padding: 10px 0;
  border-bottom: 3px dashed #1a1530;
  font-family: 'Outfit'; font-weight: 700; font-size: 32px;
}
.fr-item:last-child { border-bottom: 0; }
.fr-tm {
  font-family: 'Fredoka'; font-weight: 700; font-size: 42px;
  color: #ee5a3c; flex: none; width: 170px;
}
.fr-ti { flex: 1; }

.fr-strip {
  position: absolute; left: 0; right: 0; bottom: 0; height: 160px;
  background: #1a1530; color: #fffdf2;
  display: flex; align-items: center; padding: 0 80px; gap: 60px;
  font-family: 'Fredoka'; font-weight: 700; font-size: 50px;
}
.fr-badge {
  background: #ffd23f; color: #1a1530; border-radius: 30px;
  padding: 14px 30px;
  font-family: 'Outfit'; font-weight: 900; font-size: 36px; letter-spacing: .18em;
}
.fr-msg { letter-spacing: -.01em; }
`;
