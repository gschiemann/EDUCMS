"use client";

/**
 * FitnessVaultWidget — 4K CrossFit-style box / WOD board, 3840x2160 (Vault theme).
 *
 * APPROVED 2026-05-03 — matches scratch/design/fitness/14-vault.html
 * Ported via HsStage transform:scale pattern. Every pixel size is
 * FIXED (matches the HTML mockup); DO NOT regress to vw/%.
 *
 * Visual DNA — industrial concrete + safety-orange + chalk text:
 *   - Charcoal concrete base (#2a2a2c -> #0e0e10) with grain texture
 *   - Safety-orange #ff6a1a + chalk #f4f0e6 + warn-yellow #ffd23f accents
 *   - Archivo Black display + Bebas Neue + JetBrains Mono labels + Caveat (chalk-script) body
 *   - Hazard stripes top
 *   - Big "The Vault." identity + day/cycle stamp
 *   - Whiteboard panel: WOD name + chalk-style body + scaling box (left)
 *     and live leaderboard rows with RX/SC chips + times (right)
 *   - Foundation strip with 5 numeric stats
 *   - Bottom orange strap with NEXT tag + schedule message
 */

import { HsStage } from '../hs/HsStage';
import { sanitizeWidgetHtml } from '@/lib/sanitize-html';
import { sceneCss } from '../scene-css';

export interface FitnessVaultConfig {
  // Gym logo — optional image that replaces the text logo in the header
  gymLogoUrl?: string;
  // Header
  'head.t1'?: string;
  'head.t2'?: string;
  'head.num'?: string;
  // Whiteboard - left (WOD)
  'left.stamp'?: string;
  'left.t1'?: string;
  'left.t2'?: string;
  'left.body'?: string;
  'left.scaleLab'?: string;
  'left.scaleBody'?: string;
  // Whiteboard - right (leaderboard)
  'right.h'?: string;
  'right.n1'?: string;
  'right.x1'?: string;
  'right.t1'?: string;
  'right.n2'?: string;
  'right.x2'?: string;
  'right.t2'?: string;
  'right.n3'?: string;
  'right.x3'?: string;
  'right.t3'?: string;
  'right.n4'?: string;
  'right.x4'?: string;
  'right.t4'?: string;
  'right.n5'?: string;
  'right.x5'?: string;
  'right.t5'?: string;
  'right.n6'?: string;
  'right.x6'?: string;
  'right.t6'?: string;
  'right.n7'?: string;
  'right.x7'?: string;
  'right.t7'?: string;
  'right.n8'?: string;
  'right.x8'?: string;
  'right.t8'?: string;
  // Foundation strip
  'found.b1'?: string;
  'found.l1'?: string;
  'found.b2'?: string;
  'found.l2'?: string;
  'found.b3'?: string;
  'found.l3'?: string;
  'found.b4'?: string;
  'found.l4'?: string;
  'found.b5'?: string;
  'found.l5'?: string;
  // Bottom strap
  'strap.tag'?: string;
  'strap.message'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  // Gym logo image upload (optional — falls back to text logo)
  'gymLogoUrl':     '',
  'head.t1':        'The ',
  'head.t2':        'Vault.',
  'head.num':       '▸ DAY 078 · CYCLE 04 · WK 11',
  'left.stamp':     '★ WOD · TUE 03·18 · 6:00 AM',
  'left.t1':        '"Diane ',
  'left.t2':        'Eats."',
  'left.body':      '21–15–9<br>Deadlifts <em>(225/155)</em><br>Handstand push-ups<br><br><em>Time cap — 12:00.</em><br>Score = total time. Post to whiteboard.',
  'left.scaleLab':  '▸ SCALING / SUBSTITUTIONS',
  'left.scaleBody': 'DL — drop weight to a fast 9-rep set. HSPU — pike push-ups on a 20" box, or DB push press 35/25 to maintain shoulder load.',
  'right.h':        '★ 6:00 AM HEAT · LIVE BOARD',
  'right.n1':       'Mara Lin',
  'right.x1':       'RX',
  'right.t1':       '7:14',
  'right.n2':       'Devontae K.',
  'right.x2':       'RX',
  'right.t2':       '8:02',
  'right.n3':       'Sasha P.',
  'right.x3':       'SC',
  'right.t3':       '8:48',
  'right.n4':       'Hiro T.',
  'right.x4':       'RX',
  'right.t4':       '9:21',
  'right.n5':       'Penny A.',
  'right.x5':       'SC',
  'right.t5':       '9:55',
  'right.n6':       'Conor D.',
  'right.x6':       'RX',
  'right.t6':       '10:18',
  'right.n7':       'Bea O.',
  'right.x7':       'SC',
  'right.t7':       '10:42',
  'right.n8':       'Theo K.',
  'right.x8':       'RX',
  'right.t8':       '11:30',
  'found.b1':       '142',
  'found.l1':       'MEMBERS · ACTIVE',
  'found.b2':       '6',
  'found.l2':       'CLASSES · TODAY',
  'found.b3':       '2',
  'found.l3':       'COACHES · ON DECK',
  'found.b4':       '68°',
  'found.l4':       'FLOOR TEMP',
  'found.b5':       '12',
  'found.l5':       'DAYS TO OPEN',
  'strap.tag':      '★ NEXT',
  'strap.message':  '7:30A — STRENGTH (BACK SQUAT 5×3) ★ 9:00A — OPEN GYM ★ NOON — WOD REPEAT ★ 5:30P — OLY CLINIC',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessVaultConfig | undefined, key: keyof typeof DEFAULTS): string {
  return ((cfg as any)?.[key] as string | undefined) ?? DEFAULTS[key];
}

// SC chip rows are indices 3,5,7 (1-indexed) — 3,5,7 of 8 — i.e. row indices 3, 5, 7
function rxClass(value: string): string {
  return value.trim().toUpperCase() === 'SC' ? 'fv-rx fv-rx-scale' : 'fv-rx';
}

export function FitnessVaultWidget({ config }: { config?: FitnessVaultConfig }) {
  const headNum = pick(config, 'head.num');
  // Allow rich head.num value with <b> wrapping the highlighted token.
  // The HTML used "▸ DAY <b>078</b> · CYCLE 04 · WK 11" — we render as plain text
  // since DEFAULTS holds the flat string; WYSIWYG editing should preserve <b> via
  // dangerouslySetInnerHTML if the operator includes inline HTML.
  return (
    <HsStage stageClassName="fv-stage" stageStyle={{ background: '#13100c', color: '#f4f0e6', fontFamily: "'Outfit', sans-serif" }}>
      <style>{sceneCss(CSS)}</style>

      {/* Hazard stripes top */}
      <div className="fv-haz" />

      {/* Header */}
      <div className="fv-head">
        <div className="fv-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {pick(config, 'gymLogoUrl') ? (
            <img src={pick(config, 'gymLogoUrl')} alt="Gym logo" className="fv-gym-logo" />
          ) : (
            <>
              <span data-field="head.t1">{pick(config, 'head.t1')}</span>
              <em data-field="head.t2">{pick(config, 'head.t2')}</em>
            </>
          )}
        </div>
        <div className="fv-num" data-field="head.num" dangerouslySetInnerHTML={{ __html: sanitizeWidgetHtml(headNum) }} />
      </div>

      {/* Whiteboard */}
      <div className="fv-board">
        <div className="fv-left">
          <div className="fv-stamp" data-field="left.stamp">{pick(config, 'left.stamp')}</div>
          <div className="fv-name">
            <span data-field="left.t1">{pick(config, 'left.t1')}</span>
            <em data-field="left.t2">{pick(config, 'left.t2')}</em>
          </div>
          <div className="fv-body" data-field="left.body" dangerouslySetInnerHTML={{ __html: sanitizeWidgetHtml(pick(config, 'left.body')) }} />
          <div className="fv-scale">
            <b data-field="left.scaleLab">{pick(config, 'left.scaleLab')}</b>
            <div className="fv-body" data-field="left.scaleBody">{pick(config, 'left.scaleBody')}</div>
          </div>
        </div>
        <div className="fv-right">
          <h3 data-field="right.h">{pick(config, 'right.h')}</h3>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
            const nm = pick(config, `right.n${i}` as keyof typeof DEFAULTS);
            const rx = pick(config, `right.x${i}` as keyof typeof DEFAULTS);
            const tm = pick(config, `right.t${i}` as keyof typeof DEFAULTS);
            return (
              <div className="fv-row" key={i}>
                <div className="fv-nm" data-field={`right.n${i}`}>{nm}</div>
                <div className={rxClass(rx)} data-field={`right.x${i}`}>{rx}</div>
                <div className="fv-tm" data-field={`right.t${i}`}>{tm}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Foundation strip */}
      <div className="fv-found">
        <div className="fv-b">
          <b data-field="found.b1">{pick(config, 'found.b1')}</b>
          <span data-field="found.l1">{pick(config, 'found.l1')}</span>
        </div>
        <div className="fv-div" />
        <div className="fv-b">
          <b data-field="found.b2">{pick(config, 'found.b2')}</b>
          <span data-field="found.l2">{pick(config, 'found.l2')}</span>
        </div>
        <div className="fv-div" />
        <div className="fv-b">
          <b data-field="found.b3">{pick(config, 'found.b3')}</b>
          <span data-field="found.l3">{pick(config, 'found.l3')}</span>
        </div>
        <div className="fv-div" />
        <div className="fv-b">
          <b data-field="found.b4">{pick(config, 'found.b4')}</b>
          <span data-field="found.l4">{pick(config, 'found.l4')}</span>
        </div>
        <div className="fv-div" />
        <div className="fv-b">
          <b data-field="found.b5">{pick(config, 'found.b5')}</b>
          <span data-field="found.l5">{pick(config, 'found.l5')}</span>
        </div>
      </div>

      {/* Bottom strap */}
      <div className="fv-strap">
        <div className="fv-tag" data-field="strap.tag">{pick(config, 'strap.tag')}</div>
        <div data-field="strap.message">{pick(config, 'strap.message')}</div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Bebas+Neue&family=JetBrains+Mono:wght@500;700&family=Outfit:wght@400;700;900&family=Caveat:wght@400;700&display=swap');

.fv-stage {
  background:
    radial-gradient(1200px 800px at 80% 90%, rgba(255,106,26,.10), transparent 60%),
    linear-gradient(135deg, #2a2a2c 0%, #1a1a1c 60%, #0e0e10 100%);
}
.fv-stage::before {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  pointer-events: none;
  opacity: .5;
  background-image:
    radial-gradient(circle at 20% 30%, rgba(255,255,255,.04) 0, transparent 20%),
    radial-gradient(circle at 70% 60%, rgba(255,255,255,.03) 0, transparent 25%),
    radial-gradient(circle at 90% 10%, rgba(0,0,0,.2) 0, transparent 30%);
}

.fv-haz {
  position: absolute; top: 0; left: 0; right: 0; height: 40px;
  background: repeating-linear-gradient(135deg, #ff6a1a 0 50px, #1f1f22 50px 100px);
}

.fv-head {
  position: absolute; top: 60px; left: 80px; right: 80px;
  padding: 30px 0 0;
  display: flex; justify-content: space-between; align-items: flex-end;
}
.fv-lg {
  font-family: 'Archivo Black'; font-size: 200px; line-height: .85;
  letter-spacing: -.04em; color: #f4f0e6;
}
.fv-lg em { font-style: normal; color: #ff6a1a; }
.fv-gym-logo { height: 100px; width: auto; object-fit: contain; object-position: left center; }
.fv-num {
  font-family: 'JetBrains Mono'; font-size: 36px; letter-spacing: .32em;
  color: #8a8a8a; border: 3px solid #ff6a1a; padding: 14px 24px;
}
.fv-num b { color: #ff6a1a; }

.fv-board {
  position: absolute; top: 340px; left: 80px; right: 80px; bottom: 280px;
  background: #1a3530; border: 18px solid #1f1f22; padding: 60px 80px;
  box-shadow: inset 0 0 0 4px rgba(0,0,0,.5), 0 30px 80px rgba(0,0,0,.7);
  display: grid; grid-template-columns: 1.2fr 1fr; gap: 60px;
}
.fv-board::before {
  content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0; pointer-events: none; opacity: .4;
  background-image:
    radial-gradient(circle at 30% 70%, rgba(255,255,255,.08) 0, transparent 35%),
    radial-gradient(circle at 80% 20%, rgba(255,255,255,.06) 0, transparent 30%);
}

.fv-left { font-family: 'Caveat', cursive; font-weight: 700; }
.fv-stamp {
  font-family: 'JetBrains Mono'; font-size: 32px; letter-spacing: .3em;
  color: #ff6a1a; border-bottom: 3px solid #f4f0e6; padding-bottom: 14px;
}
.fv-name {
  font-family: 'Archivo Black'; font-size: 230px; line-height: .85;
  letter-spacing: -.03em; color: #f4f0e6; margin-top: 24px;
}
.fv-name em { font-style: normal; color: #ff6a1a; }
.fv-body {
  font-family: 'Caveat'; font-weight: 700; font-size: 80px; line-height: 1.05;
  color: #f4f0e6; margin-top: 30px; max-width: 1200px;
}
.fv-body em { font-style: normal; color: #ffd23f; }
.fv-scale {
  margin-top: 40px; padding: 24px 32px; border: 3px dashed #f4f0e6;
}
.fv-scale b {
  font-family: 'JetBrains Mono'; font-weight: 700; font-size: 30px;
  letter-spacing: .18em; color: #ff6a1a; display: block; margin-bottom: 8px;
}
.fv-scale .fv-body { font-size: 50px; margin-top: 0; }

.fv-right { display: flex; flex-direction: column; gap: 30px; }
.fv-right h3 {
  font-family: 'JetBrains Mono'; font-size: 32px; letter-spacing: .28em;
  color: #ff6a1a; margin: 0 0 16px; padding-bottom: 14px;
  border-bottom: 2px solid #f4f0e6;
}
.fv-row {
  display: flex; gap: 20px; padding: 14px 0; align-items: center;
  border-bottom: 2px dashed rgba(244,240,230,.3);
  font-family: 'Caveat'; font-weight: 700; font-size: 54px;
}
.fv-row:last-child { border-bottom: 0; }
.fv-nm { flex: 1; color: #f4f0e6; }
.fv-tm {
  font-family: 'Archivo Black'; font-size: 50px; color: #ff6a1a;
  letter-spacing: -.02em;
}
.fv-rx {
  font-family: 'JetBrains Mono'; font-size: 24px; letter-spacing: .2em;
  padding: 4px 10px; border: 1px solid #ffd23f; color: #ffd23f;
}
.fv-rx-scale { color: #8a8a8a; border-color: #8a8a8a; }

.fv-found {
  position: absolute; left: 0; right: 0; bottom: 140px; height: 140px;
  background: #1f1f22;
  display: flex; align-items: center; padding: 0 80px; gap: 60px;
  border-top: 6px solid #ff6a1a; border-bottom: 6px solid #ff6a1a;
}
.fv-b { display: flex; align-items: baseline; gap: 14px; }
.fv-b b {
  font-family: 'Archivo Black'; font-size: 80px; color: #ff6a1a; line-height: 1;
}
.fv-b span {
  font-family: 'Bebas Neue'; font-size: 36px; letter-spacing: .18em; color: #8a8a8a;
}
.fv-div {
  width: 2px; align-self: stretch; background: #8a8a8a; opacity: .4;
}

.fv-strap {
  position: absolute; bottom: 0; left: 0; right: 0; height: 140px;
  background: #ff6a1a; color: #000;
  display: flex; align-items: center; padding: 0 80px; gap: 40px;
  font-family: 'Archivo Black'; font-size: 60px; letter-spacing: -.02em;
}
.fv-tag {
  background: #000; color: #ff6a1a; padding: 14px 30px;
  font-family: 'JetBrains Mono'; font-size: 32px; letter-spacing: .24em; flex: none;
}
`;
