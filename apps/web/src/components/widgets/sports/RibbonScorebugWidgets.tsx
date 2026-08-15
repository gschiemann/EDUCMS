'use client';

/**
 * Live RIBBON-board + SCOREBUG composite widgets.
 * ───────────────────────────────────────────────
 * Operator (2026-05-19): "there are no ribbon or score bug fucking
 * templates or widgets." Fixed — two live-bound composite widgets,
 * siblings of MainScoreboardWidget, for the other two sports surfaces:
 *
 *   RibbonScoreboardWidget — perimeter ribbon / fascia LED. A long-thin
 *     horizontal bar: score-follow anchor (home logo + abbr + score ·
 *     clock · period · score + abbr + logo away) on the left, a
 *     rotating sponsor / message reel on the right. Fluid: measures its
 *     zone height and sizes everything off it, so it works on any ribbon
 *     pixel-chain (1920×192 up to 11520×192 panel runs).
 *
 *   ScorebugWidget — broadcast / streaming overlay. Compact, transparent
 *     background, edge-positioned: [HOME abbr|score] · clock period ·
 *     [score|AWAY abbr], plus a per-sport situational line. Fixed
 *     natural 760×150 + transform:scale to fit, so it drops into OBS as
 *     a browser source at any size.
 *
 * Both read live game state from GameStateContext; both fall back to a
 * sample game in the builder. Brand-aware via flat config. Chromium-83
 * safe (long-hand sides, explicit margins, no inset shorthand, no
 * aspect-ratio).
 *
 * NO FAKE SCORES ON A LIVE BOARD (audit P1, 2026-06-13): the SAMPLE game
 * (EAGLES 62 / TIGERS 58 / 7:42 / Q3) is for the BUILDER ONLY. On a live
 * player surface (the GameStateProvider is mounted: `useGameState() !=
 * null`) that has no snapshot yet, the score / clock / period / abbr
 * render NEUTRAL ("—" / "—:—") — never SAMPLE's fabricated numbers, which
 * a crowd or broadcast viewer could mistake for the real game.
 */

import React, { useEffect, useRef, useState } from 'react';
import { findSport, formatScore } from '@cms/api-types';
import { useGameState, fmtClock, fmtSegment, type GameSnapshot } from './GameStateContext';
import { liveNeutral } from './cts-fields';
import { FitOneLine } from './FitOneLine';
import { sceneCss } from '../scene-css';

const STATUS_BG: Record<string, string> = {
  SCHEDULED: '#475569', PRE_GAME: '#d97706', LIVE: '#dc2626', HALFTIME: '#2563eb', FINAL: '#1e293b',
};

const SAMPLE: GameSnapshot = {
  id: 'sample', sport: 'basketball', status: 'LIVE', segment: 3,
  homeTeam: 'EAGLES', awayTeam: 'TIGERS', homeScore: 62, awayScore: 58,
  homeColor: '#4f46e5', awayColor: '#dc2626', homeLogoUrl: null, awayLogoUrl: null,
  clockMs: 7 * 60_000 + 42_000, clockRunning: true, clockUpdatedAt: new Date().toISOString(),
  stats: {}, serverTime: Date.now(),
};

function useMeasuredHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => setH(el.offsetHeight || 0);
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, h };
}

function useScaleToFit(w: number, hh: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const compute = () => { const cw = el.offsetWidth, ch = el.offsetHeight; if (cw <= 0 || ch <= 0) return; setScale(Math.min(cw / w, ch / hh)); };
    compute();
    const r = requestAnimationFrame(compute);
    const ro = new ResizeObserver(compute); ro.observe(el);
    return () => { cancelAnimationFrame(r); ro.disconnect(); };
  }, [w, hh]);
  return { ref, scale };
}

function abbr(name?: string) { return (name ?? '').trim().slice(0, 3).toUpperCase() || '—'; }

// ── RIBBON ───────────────────────────────────────────────────────────
export interface RibbonCfg {
  bgColor?: string;
  messages?: string[];
  sponsorText?: string;
}

export function RibbonScoreboardWidget({ config }: { config?: RibbonCfg }) {
  const c = config ?? {};
  const s = useGameState();
  // Live surface (provider present) with no snapshot → neutral, never the
  // SAMPLE board. Builder (no provider) → SAMPLE so the tile is alive.
  const isLiveNoData = s != null && !s.snapshot;
  const snap = s?.snapshot ?? SAMPLE;
  const clockMs = s?.snapshot ? s.liveClockMs : SAMPLE.clockMs;
  const def = findSport(snap.sport);
  const { ref, h } = useMeasuredHeight();
  const px = (f: number) => Math.max(8, Math.round((h || 192) * f));

  const homeColor = snap.homeColor || '#4f46e5';
  const awayColor = snap.awayColor || '#dc2626';
  // nofake-sweep (2026-07-03, docs/research/2026-07-02-sports-deep-pass/
  // 06-OVERNIGHT-REVIEW.md P1): this widget DOES gate score/clock/period/
  // abbr on isLiveNoData, but the reel was computed unconditionally — a
  // ribbon showing correct neutral dashes for score/clock still scrolled
  // fabricated 'YOUR SPONSOR HERE • GO TEAM! • NEXT HOME GAME FRI 7PM' to
  // the crowd. Gate it the same way: on a live surface with no messages/
  // sponsorText configured, render an empty reel (no divider text) instead
  // of the SAMPLE placeholder strings. Builder (no provider) keeps SAMPLE.
  const hasReelContent = (c.messages && c.messages.length > 0) || !!c.sponsorText;
  const reel = hasReelContent
    ? (c.messages && c.messages.length ? c.messages : [c.sponsorText || '']).join('     •     ')
    : (isLiveNoData ? '' : ['YOUR SPONSOR HERE', 'GO TEAM!', 'NEXT HOME GAME FRI 7PM'].join('     •     '));
  const hasClock = def && def.clock.type !== 'none';
  // What the score/abbr/clock/segment show: real on a live feed, sample
  // in the builder, neutral on a live board with no data.
  const homeScoreText = isLiveNoData ? liveNeutral('value') : formatScore(def, snap.homeScore);
  const awayScoreText = isLiveNoData ? liveNeutral('value') : formatScore(def, snap.awayScore);
  const homeAbbrText = isLiveNoData ? liveNeutral('value') : abbr(snap.homeTeam);
  const awayAbbrText = isLiveNoData ? liveNeutral('value') : abbr(snap.awayTeam);
  const clockText = isLiveNoData ? liveNeutral('clock') : fmtClock(clockMs);
  const segmentText = isLiveNoData ? '' : (def ? fmtSegment(snap.sport, snap.segment) : '');

  const TeamChip = ({ abbrText, scoreText, color, side }: { abbrText: string; scoreText: string; color: string; side: 'l' | 'r' }) => (
    <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
      {side === 'l' && <span style={{ width: px(0.5), height: px(0.5), borderRadius: '50%', background: color, marginRight: px(0.12), display: 'inline-block', flexShrink: 0 }} />}
      {/* abbr — 3 chars max, no overflow concern at px(0.4) */}
      <span style={{ fontWeight: 900, fontSize: px(0.4), letterSpacing: 1, flexShrink: 0 }}>{abbrText}</span>
      {/* score — bounded slot so 3-digit values (e.g. 138) fit the ribbon chip */}
      <div style={{ width: px(1.05), height: '100%', marginLeft: px(0.1), marginRight: px(0.1), flexShrink: 0 }}>
        <FitOneLine maxFontPx={px(0.62)} style={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
          {scoreText}
        </FitOneLine>
      </div>
      {side === 'r' && <span style={{ width: px(0.5), height: px(0.5), borderRadius: '50%', background: color, marginLeft: px(0.12), display: 'inline-block', flexShrink: 0 }} />}
    </div>
  );

  return (
    <div ref={ref} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: c.bgColor ?? '#05070d', color: '#fff', fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
      <style>{sceneCss(`@keyframes ribbonReel{from{transform:translateX(0)}to{transform:translateX(-50%)}}`)}</style>
      {/* score-follow anchor */}
      <div style={{ display: 'flex', alignItems: 'center', height: '100%', padding: `0 ${px(0.3)}px`, background: '#05070d', flexShrink: 0 }}>
        <TeamChip abbrText={homeAbbrText} scoreText={homeScoreText} color={homeColor} side="l" />
        {/* center clock+period — bounded width so long clock strings ("90:00+02:13") fit the ribbon anchor */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: `0 ${px(0.3)}px`, width: px(1.6), flexShrink: 0 }}>
          {hasClock && (
            <div style={{ width: '100%', height: px(0.5) }}>
              <FitOneLine
                maxFontPx={px(0.46)}
                style={{ fontWeight: 900, color: !isLiveNoData && snap.clockRunning ? '#fbbf24' : '#e2e8f0', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}
              >
                {clockText}
              </FitOneLine>
            </div>
          )}
          <span style={{ fontWeight: 700, fontSize: px(0.22), letterSpacing: 2, color: '#94a3b8', marginTop: px(0.04) }}>{segmentText}</span>
        </div>
        <TeamChip abbrText={awayAbbrText} scoreText={awayScoreText} color={awayColor} side="r" />
      </div>
      {/* divider */}
      <div style={{ width: 2, height: '60%', background: '#1e2638', flexShrink: 0 }} />
      {/* sponsor / message reel — empty (no marquee) on a live surface with nothing configured */}
      {reel && (
        <div style={{ flex: 1, overflow: 'hidden', height: '100%', display: 'flex', alignItems: 'center' }}>
          <div style={{ whiteSpace: 'nowrap', fontWeight: 800, fontSize: px(0.36), letterSpacing: 2, color: '#cbd5e1', animation: 'ribbonReel 18s linear infinite', display: 'inline-block' }}>
            {reel}{'     •     '}{reel}
          </div>
        </div>
      )}
    </div>
  );
}

// ── SCOREBUG (broadcast overlay) ─────────────────────────────────────
export interface ScorebugCfg {
  homeColor?: string;
  awayColor?: string;
  accent?: string;
  networkLabel?: string;
}

const NAT_W = 760, NAT_H = 150;

export function ScorebugWidget({ config }: { config?: ScorebugCfg }) {
  const c = config ?? {};
  const s = useGameState();
  // Live surface (provider present) with no snapshot → neutral, never the
  // SAMPLE board. Builder (no provider) → SAMPLE so the tile is alive.
  const isLiveNoData = s != null && !s.snapshot;
  const snap = s?.snapshot ?? SAMPLE;
  const clockMs = s?.snapshot ? s.liveClockMs : SAMPLE.clockMs;
  const def = findSport(snap.sport);
  const { ref, scale } = useScaleToFit(NAT_W, NAT_H);

  const homeColor = c.homeColor || snap.homeColor || '#4f46e5';
  const awayColor = c.awayColor || snap.awayColor || '#dc2626';
  const accent = c.accent || '#fbbf24';
  const hasClock = def && def.clock.type !== 'none';
  // What the score/clock/segment/situational show: real on a live feed,
  // sample in the builder, neutral on a live board with no data.
  const homeScoreText = isLiveNoData ? liveNeutral('value') : formatScore(def, snap.homeScore);
  const awayScoreText = isLiveNoData ? liveNeutral('value') : formatScore(def, snap.awayScore);
  const homeAbbrText = isLiveNoData ? liveNeutral('value') : abbr(snap.homeTeam);
  const awayAbbrText = isLiveNoData ? liveNeutral('value') : abbr(snap.awayTeam);
  const clockText = isLiveNoData ? liveNeutral('clock') : fmtClock(clockMs);
  const segmentText = isLiveNoData ? '' : (def ? fmtSegment(snap.sport, snap.segment) : '');
  // sport situational line (compact) — suppressed on a live board with no data.
  let sit = '';
  if (!isLiveNoData && def?.key === 'football') { const d = snap.stats?.down, dist = snap.stats?.distance; if (d) sit = `${['','1ST','2ND','3RD','4TH'][Number(d)] || ''} & ${Number(dist) === 0 ? 'GOAL' : (dist ?? '')}`; }
  else if (!isLiveNoData && (def?.key === 'baseball' || def?.key === 'softball')) { sit = `${snap.stats?.balls ?? 0}-${snap.stats?.strikes ?? 0}, ${snap.stats?.outs ?? 0} OUT`; }

  const TeamBlock = ({ abbrText, scoreText, color }: { abbrText: string; scoreText: string; color: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', height: 92 }}>
      <div style={{ width: 10, height: 92, background: color }} />
      <div style={{ background: 'rgba(15,18,26,0.96)', height: 92, display: 'flex', alignItems: 'center', padding: '0 18px' }}>
        <span style={{ fontWeight: 900, fontSize: 38, letterSpacing: 1, color: '#fff' }}>{abbrText}</span>
        <span style={{ fontWeight: 900, fontSize: 52, marginLeft: 18, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{scoreText}</span>
      </div>
    </div>
  );

  return (
    <div ref={ref} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'transparent' }}>
      <div style={{ width: NAT_W, height: NAT_H, flexShrink: 0, transform: scale > 0 ? `scale(${scale})` : 'scale(0)', transformOrigin: 'center center', fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'stretch', borderRadius: 10, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }}>
          <TeamBlock abbrText={homeAbbrText} scoreText={homeScoreText} color={homeColor} />
          {/* center clock/period */}
          <div style={{ background: 'rgba(5,7,13,0.96)', height: 92, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 22px', minWidth: 120 }}>
            {hasClock
              ? <span style={{ fontWeight: 900, fontSize: 34, color: !isLiveNoData && snap.clockRunning ? accent : '#e2e8f0', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{clockText}</span>
              : <span style={{ fontSize: 28 }}>{isLiveNoData ? '' : (def?.emoji ?? '•')}</span>}
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 2, color: '#94a3b8', marginTop: 4 }}>{segmentText}</span>
          </div>
          <TeamBlock abbrText={awayAbbrText} scoreText={awayScoreText} color={awayColor} />
        </div>
        {/* situational + network line */}
        {(sit || c.networkLabel) && (
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 8, background: 'rgba(15,18,26,0.92)', borderRadius: 6, padding: '4px 14px' }}>
            {sit && <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: 1, color: accent }}>{sit}</span>}
            {c.networkLabel && <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: 2, color: '#94a3b8', marginLeft: sit ? 14 : 0 }}>{c.networkLabel}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
