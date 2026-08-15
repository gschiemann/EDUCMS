"use client";

/**
 * FitnessCornermanWidget — 4K boxing/MMA fight-night scene, 3840x2160.
 *
 * APPROVED 2026-05-03 — matches scratch/design/fitness/10-cornerman.html
 * Ported via HsStage transform:scale pattern. Every pixel size is FIXED
 * (matches the HTML mockup); DO NOT regress to vw/%.
 *
 * Visual DNA — boxing-poster aesthetic:
 *   - Red gradient (#c8202a -> #7a0a12) base + halftone + distress overlays
 *   - Yellow ink (#fae62c) on red, cream (#f4ead3) panels
 *   - Archivo Black + Bebas Neue display + Outfit body + JetBrains Mono labels
 *   - Top yellow strap with star separators
 *   - Massive FIGHT NIGHT hero with stroke + drop shadow
 *   - Round timer card (top right) and Weigh-In card (top left)
 *   - Center cream VS card with two corners + huge "VS" middle
 *   - Bottom yellow undercard marquee
 *
 * Editable hotspots (data-field keys, dot notation):
 *   strap.l, strap.r
 *   hero.pre, hero.t1, hero.t2
 *   weigh.l, weigh.n1..5, weigh.v1..5
 *   round.l, round.t, round.r, round.ph
 *   vs.lab1, vs.t1a, vs.t2a, vs.nick1, vs.l1a, vs.v1a, vs.l2a, vs.v2a, vs.l3a, vs.v3a
 *   vs.big, vs.meta
 *   vs.lab2, vs.t1b, vs.t2b, vs.nick2, vs.l1b, vs.v1b, vs.l2b, vs.v2b, vs.l3b, vs.v3b
 *   mq.tag, mq.message
 */

import { HsStage } from '../hs/HsStage';
import { sceneCss } from '../scene-css';

export interface FitnessCornermanConfig {
  // Fighter photos — optional images for the VS card portraits
  fighterAPhotoUrl?: string;
  fighterBPhotoUrl?: string;
  // Gym logo image (optional)
  gymLogoUrl?: string;
  // Top strap
  'strap.l'?: string;
  'strap.r'?: string;
  // Hero
  'hero.pre'?: string;
  'hero.t1'?: string;
  'hero.t2'?: string;
  // Weigh-in
  'weigh.l'?: string;
  'weigh.n1'?: string;
  'weigh.v1'?: string;
  'weigh.n2'?: string;
  'weigh.v2'?: string;
  'weigh.n3'?: string;
  'weigh.v3'?: string;
  'weigh.n4'?: string;
  'weigh.v4'?: string;
  'weigh.n5'?: string;
  'weigh.v5'?: string;
  // Round
  'round.l'?: string;
  'round.t'?: string;
  'round.r'?: string;
  'round.ph'?: string;
  // VS — corner A (red)
  'vs.lab1'?: string;
  'vs.t1a'?: string;
  'vs.t2a'?: string;
  'vs.nick1'?: string;
  'vs.l1a'?: string;
  'vs.v1a'?: string;
  'vs.l2a'?: string;
  'vs.v2a'?: string;
  'vs.l3a'?: string;
  'vs.v3a'?: string;
  // VS — middle
  'vs.big'?: string;
  'vs.meta'?: string;
  // VS — corner B (blue)
  'vs.lab2'?: string;
  'vs.t1b'?: string;
  'vs.t2b'?: string;
  'vs.nick2'?: string;
  'vs.l1b'?: string;
  'vs.v1b'?: string;
  'vs.l2b'?: string;
  'vs.v2b'?: string;
  'vs.l3b'?: string;
  'vs.v3b'?: string;
  // Marquee
  'mq.tag'?: string;
  'mq.message'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  // Fighter photo uploads (optional — corners render colored blocks when unset)
  'fighterAPhotoUrl': '',
  'fighterBPhotoUrl': '',
  // Gym logo image upload (optional)
  'gymLogoUrl':       '',
  'strap.l':    '★ NORTHGATE BOXING CLUB — EST. 1962',
  'strap.r':    'FIGHT NIGHT MARCH 22 — DOORS 6P',

  'hero.pre':   'SATURDAY NIGHT · 12 ROUNDS · TITLE ON THE LINE',
  'hero.t1':    'FIGHT ',
  'hero.t2':    'NIGHT.',

  'weigh.l':    '▸ WEIGH-IN — FRI 6P',
  'weigh.n1':   'FEATHER',
  'weigh.v1':   '126.0',
  'weigh.n2':   'LIGHT',
  'weigh.v2':   '134.4',
  'weigh.n3':   'WELTER',
  'weigh.v3':   '146.8',
  'weigh.n4':   'MIDDLE',
  'weigh.v4':   '159.6',
  'weigh.n5':   'HEAVY',
  'weigh.v5':   '214.0',

  'round.l':    '▸ SPARRING ROOM A · ROUND',
  'round.t':    '02:14',
  'round.r':    'R 4 / 6',
  'round.ph':   '★ 1 MIN REST · 6oz GLOVES · NO HEAD',

  'vs.lab1':    '▸ RED CORNER · 18-2',
  'vs.t1a':     'Anya ',
  'vs.t2a':     'Marek.',
  'vs.nick1':   '"the architect"',
  'vs.l1a':     'REC',
  'vs.v1a':     '18-2',
  'vs.l2a':     'KO',
  'vs.v2a':     '11',
  'vs.l3a':     'REACH',
  'vs.v3a':     '68"',

  'vs.big':     'VS',
  'vs.meta':    '★ NORTHGATE LIGHTWEIGHT TITLE\nSAT 3/22 · 8:00 PM\n★ ALL TICKETS $25 · BENEFIT',

  'vs.lab2':    '▸ BLUE CORNER · 16-1',
  'vs.t1b':     'Demi ',
  'vs.t2b':     'Sosa.',
  'vs.nick2':   '"the southside hammer"',
  'vs.l1b':     'REC',
  'vs.v1b':     '16-1',
  'vs.l2b':     'KO',
  'vs.v2b':     '13',
  'vs.l3b':     'REACH',
  'vs.v3b':     '66"',

  'mq.tag':     '★ UNDERCARD',
  'mq.message': 'ROSALES vs PARK · WELTER · 6R ★ DELANEY vs OBI · MIDDLE · 4R ★ AMATEUR SHOWCASE — 3 BOUTS · DOORS 5:30P · NORTHGATE FIELDHOUSE',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessCornermanConfig | undefined, key: keyof typeof DEFAULTS): string {
  return ((cfg as any)?.[key] as string | undefined) ?? DEFAULTS[key];
}

export function FitnessCornermanWidget({ config }: { config?: FitnessCornermanConfig }) {
  const vsMeta = pick(config, 'vs.meta');
  const metaLines = vsMeta.split('\n');
  const metaTop = metaLines[0] ?? '';
  const metaMid = metaLines[1] ?? '';
  const metaBot = metaLines.slice(2).join(' ');

  return (
    <HsStage
      stageClassName="fn-stage"
      stageStyle={{
        background:
          'radial-gradient(900px 700px at 18% 20%, rgba(250,230,44,.08), transparent 65%), linear-gradient(135deg, #c8202a 0%, #7a0a12 100%)',
        color: '#f4ead3',
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      <style>{sceneCss(CSS)}</style>

      {/* Top strap */}
      <div className="fn-strap">
        <span data-field="strap.l">{pick(config, 'strap.l')}</span>
        <span className="fn-star">{'★'}</span>
        <span data-field="strap.r">{pick(config, 'strap.r')}</span>
      </div>

      {/* Hero title */}
      <div className="fn-hero">
        <div className="fn-pre" data-field="hero.pre">{pick(config, 'hero.pre')}</div>
        <h1 className="fn-h1">
          <span data-field="hero.t1">{pick(config, 'hero.t1')}</span>
          <em data-field="hero.t2">{pick(config, 'hero.t2')}</em>
        </h1>
      </div>

      {/* Weigh-in (top-left) */}
      <div className="fn-weigh">
        <div className="fn-l" data-field="weigh.l">{pick(config, 'weigh.l')}</div>
        <div className="fn-row"><span data-field="weigh.n1">{pick(config, 'weigh.n1')}</span><b data-field="weigh.v1">{pick(config, 'weigh.v1')}</b></div>
        <div className="fn-row"><span data-field="weigh.n2">{pick(config, 'weigh.n2')}</span><b data-field="weigh.v2">{pick(config, 'weigh.v2')}</b></div>
        <div className="fn-row"><span data-field="weigh.n3">{pick(config, 'weigh.n3')}</span><b data-field="weigh.v3">{pick(config, 'weigh.v3')}</b></div>
        <div className="fn-row"><span data-field="weigh.n4">{pick(config, 'weigh.n4')}</span><b data-field="weigh.v4">{pick(config, 'weigh.v4')}</b></div>
        <div className="fn-row"><span data-field="weigh.n5">{pick(config, 'weigh.n5')}</span><b data-field="weigh.v5">{pick(config, 'weigh.v5')}</b></div>
      </div>

      {/* Round timer (top-right) */}
      <div className="fn-round">
        <div className="fn-l" data-field="round.l">{pick(config, 'round.l')}</div>
        <div className="fn-t" data-field="round.t">{pick(config, 'round.t')}</div>
        <div className="fn-r" data-field="round.r">{pick(config, 'round.r')}</div>
        <div className="fn-ph" data-field="round.ph">{pick(config, 'round.ph')}</div>
      </div>

      {/* VS card */}
      <div className="fn-vs">
        <div className="fn-corner fn-corner-a">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {pick(config, 'fighterAPhotoUrl') && (
            <img src={pick(config, 'fighterAPhotoUrl')} alt="Fighter A" className="fn-fighter-photo" />
          )}
          <div className="fn-lab" data-field="vs.lab1">{pick(config, 'vs.lab1')}</div>
          <div className="fn-nm">
            <span data-field="vs.t1a">{pick(config, 'vs.t1a')}</span>
            <em data-field="vs.t2a">{pick(config, 'vs.t2a')}</em>
          </div>
          <div className="fn-nick" data-field="vs.nick1">{pick(config, 'vs.nick1')}</div>
          <div className="fn-stats">
            <div className="fn-s">
              <div className="fn-sl" data-field="vs.l1a">{pick(config, 'vs.l1a')}</div>
              <div className="fn-sv" data-field="vs.v1a">{pick(config, 'vs.v1a')}</div>
            </div>
            <div className="fn-s">
              <div className="fn-sl" data-field="vs.l2a">{pick(config, 'vs.l2a')}</div>
              <div className="fn-sv" data-field="vs.v2a">{pick(config, 'vs.v2a')}</div>
            </div>
            <div className="fn-s">
              <div className="fn-sl" data-field="vs.l3a">{pick(config, 'vs.l3a')}</div>
              <div className="fn-sv" data-field="vs.v3a">{pick(config, 'vs.v3a')}</div>
            </div>
          </div>
        </div>

        <div className="fn-mid">
          <div className="fn-vsbig" data-field="vs.big">{pick(config, 'vs.big')}</div>
          <div className="fn-meta" data-field="vs.meta">
            <span>{metaTop}</span>
            <b>{metaMid}</b>
            <span>{metaBot}</span>
          </div>
        </div>

        <div className="fn-corner fn-corner-b">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {pick(config, 'fighterBPhotoUrl') && (
            <img src={pick(config, 'fighterBPhotoUrl')} alt="Fighter B" className="fn-fighter-photo" />
          )}
          <div className="fn-lab" data-field="vs.lab2">{pick(config, 'vs.lab2')}</div>
          <div className="fn-nm">
            <span data-field="vs.t1b">{pick(config, 'vs.t1b')}</span>
            <em data-field="vs.t2b">{pick(config, 'vs.t2b')}</em>
          </div>
          <div className="fn-nick" data-field="vs.nick2">{pick(config, 'vs.nick2')}</div>
          <div className="fn-stats">
            <div className="fn-s">
              <div className="fn-sl" data-field="vs.l1b">{pick(config, 'vs.l1b')}</div>
              <div className="fn-sv" data-field="vs.v1b">{pick(config, 'vs.v1b')}</div>
            </div>
            <div className="fn-s">
              <div className="fn-sl" data-field="vs.l2b">{pick(config, 'vs.l2b')}</div>
              <div className="fn-sv" data-field="vs.v2b">{pick(config, 'vs.v2b')}</div>
            </div>
            <div className="fn-s">
              <div className="fn-sl" data-field="vs.l3b">{pick(config, 'vs.l3b')}</div>
              <div className="fn-sv" data-field="vs.v3b">{pick(config, 'vs.v3b')}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom undercard marquee */}
      <div className="fn-mq">
        <div className="fn-mq-tag" data-field="mq.tag">{pick(config, 'mq.tag')}</div>
        <div className="fn-mq-msg" data-field="mq.message">{pick(config, 'mq.message')}</div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@500;700&family=Outfit:wght@400;700;900&family=Bebas+Neue&display=swap');

.fn-stage::before {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  pointer-events: none;
  opacity: .35;
  background-image: radial-gradient(circle at center, rgba(0,0,0,.6) 1px, transparent 1.6px);
  background-size: 14px 14px;
  mix-blend-mode: multiply;
}
.fn-stage::after {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  pointer-events: none;
  background-image:
    repeating-linear-gradient(102deg, transparent 0 80px, rgba(255,255,255,.04) 80px 82px),
    repeating-linear-gradient(8deg, transparent 0 200px, rgba(0,0,0,.04) 200px 204px);
}

.fn-strap {
  position: absolute; top: 0; left: 0; right: 0; height: 120px;
  background: #fae62c; color: #0a0a0a;
  display: flex; align-items: center; padding: 0 80px;
  font-family: 'Archivo Black'; font-size: 60px; letter-spacing: .04em;
  border-bottom: 6px solid #0a0a0a;
}
.fn-star { color: #c8202a; margin: 0 24px; }

.fn-hero {
  position: absolute; top: 160px; left: 0; right: 0;
  padding: 40px 80px; text-align: center;
}
.fn-pre {
  font-family: 'JetBrains Mono'; font-size: 42px; letter-spacing: .5em;
  color: #fae62c; text-transform: uppercase;
}
.fn-h1 {
  font-family: 'Archivo Black'; font-size: 480px; line-height: .78;
  letter-spacing: -.05em; margin: 14px 0 0; color: #fae62c;
  -webkit-text-stroke: 8px #0a0a0a;
  text-shadow: 16px 16px 0 #0a0a0a;
}
.fn-h1 em {
  font-style: normal; color: #f4ead3;
  -webkit-text-stroke: 8px #7a0a12;
}

.fn-weigh {
  position: absolute; top: 160px; left: 80px; width: 520px;
  background: #0a0a0a; color: #f4ead3; padding: 30px 40px;
  border: 6px solid #fae62c;
}
.fn-weigh .fn-l {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .28em;
  color: #fae62c;
}
.fn-row {
  display: flex; justify-content: space-between; padding: 10px 0;
  border-bottom: 1px solid #333;
  font-family: 'Bebas Neue'; font-size: 36px; letter-spacing: .06em;
}
.fn-row:last-child { border-bottom: 0; }
.fn-row b { font-family: 'JetBrains Mono'; font-weight: 700; color: #fae62c; }

.fn-round {
  position: absolute; top: 160px; right: 80px; width: 520px;
  background: #0a0a0a; color: #fae62c; padding: 30px 40px;
  border: 6px solid #fae62c;
}
.fn-round .fn-l {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .28em;
}
.fn-round .fn-r {
  font-family: 'Archivo Black'; font-size: 120px; line-height: .85; margin-top: 6px;
}
.fn-round .fn-t {
  font-family: 'Archivo Black'; font-size: 160px; line-height: .85; color: #fae62c;
}
.fn-round .fn-ph {
  font-family: 'Bebas Neue'; font-size: 54px; letter-spacing: .06em; color: #f4ead3;
}

.fn-vs {
  position: absolute; top: 1080px; left: 120px; right: 120px; height: 780px;
  background: #f4ead3; color: #0a0a0a;
  border: 10px solid #0a0a0a;
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: stretch;
  padding: 60px 60px;
  box-shadow: 0 40px 120px rgba(0,0,0,.5);
}
.fn-vs::before, .fn-vs::after {
  content: ''; position: absolute; width: 80px; height: 80px;
  border: 8px solid #c8202a;
}
.fn-vs::before { top: 24px; left: 24px; border-right: 0; border-bottom: 0; }
.fn-vs::after { bottom: 24px; right: 24px; border-left: 0; border-top: 0; }

.fn-corner {
  display: flex; flex-direction: column; gap: 24px; padding: 0 30px;
}
.fn-fighter-photo { width: 100%; height: 280px; object-fit: cover; object-position: center top; border-radius: 8px; margin-bottom: 8px; }
.fn-lab {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .28em;
  color: #c8202a;
}
.fn-nm {
  font-family: 'Archivo Black'; font-size: 170px; line-height: .85;
  letter-spacing: -.03em; color: #0a0a0a;
}
.fn-nm em { font-style: normal; color: #c8202a; }
.fn-nick {
  font-family: 'Bebas Neue'; font-size: 60px; letter-spacing: .04em;
  color: #7a0a12; margin-top: -8px; font-style: italic;
}
.fn-stats { display: flex; gap: 32px; margin-top: 14px; }
.fn-s { }
.fn-sl {
  font-family: 'JetBrains Mono'; font-size: 24px; letter-spacing: .18em; color: #666;
}
.fn-sv {
  font-family: 'Archivo Black'; font-size: 60px; line-height: .85;
}
.fn-corner-b {
  text-align: right; align-items: flex-end;
}

.fn-mid {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 0 50px;
}
.fn-vsbig {
  font-family: 'Archivo Black'; font-size: 280px; line-height: .85; color: #c8202a;
  -webkit-text-stroke: 6px #0a0a0a;
  text-shadow: 10px 10px 0 #fae62c;
}
.fn-meta {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .22em;
  color: #0a0a0a; margin-top: 14px; text-align: center; line-height: 1.4;
  display: flex; flex-direction: column; gap: 6px;
}
.fn-meta b {
  display: block; font-family: 'Archivo Black'; font-size: 74px;
  letter-spacing: .04em; color: #c8202a;
}

.fn-mq {
  position: absolute; left: 0; right: 0; bottom: 0; height: 100px;
  background: #fae62c; color: #0a0a0a;
  display: flex; align-items: center; gap: 36px; overflow: hidden;
  font-family: 'Archivo Black'; font-size: 54px;
  border-top: 6px solid #0a0a0a;
}
.fn-mq-tag {
  background: #0a0a0a; color: #fae62c;
  padding: 12px 26px; margin-left: 24px; flex: none;
  font-size: 38px; letter-spacing: .18em;
}
.fn-mq-msg {
  white-space: nowrap;
  animation: fn-mq-scroll 60s linear infinite;
}
@keyframes fn-mq-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
`;
