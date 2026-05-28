"use client";
/**
 * VenueOS · Celebration ribbons — remaining sports + retro/neon style
 * variants. Ported 1:1 from the celebrations-pack gallery.
 *
 * Every widget is a ribbon-aspect surface (16:1, 7680×480 design canvas).
 * Each fixed design pixel is converted to px(height, fixedPx / 480).
 */
import React from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';
import { useElementSize } from './_shared/useElementSize';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

/* ════════════════ aspect-aware layout helpers ════════════════
 * These widgets get triggered onto BOTH a wide LED ribbon (≈16:1) and
 * a near-16:9 scoreboard. The ribbon design is horizontal; in a squarer
 * zone the same horizontal layout crushes its elements together and the
 * text piles up. Each widget measures its own box (useElementSize) and
 * branches: wide → keep the ribbon layout; scene → a centered, stacked
 * layout sized off `height` and clamped by `width` so nothing overflows.
 */

/** At/above this width:height ratio → horizontal ribbon layout; below it
 *  (≈16:9 / squarer) → centered vertical scene. Default wide pre-measure. */
function isWide(width: number, height: number): boolean {
  return width > 0 ? width / Math.max(height, 1) >= 3.2 : true;
}

/** Scene-branch hero size — bounded by BOTH the box height and width so a
 *  big celebration word/number can never overflow a 16:9 zone on either
 *  axis. hFactor/wFactor tuned per widget when the hero is multi-line. */
function sceneHero(width: number, height: number, hFactor = 0.34, wFactor = 0.13): number {
  return Math.max(8, Math.round(Math.min(height * hFactor, width * wFactor)));
}

/** Scene-branch secondary text — sized off height, clamped by width via a
 *  rough glyph-advance estimate so a long label never runs past the box. */
function sceneText(width: number, height: number, hFactor: number, widthChars = 0): number {
  const byHeight = height * hFactor;
  const byWidth = widthChars > 0 ? (width * 0.92) / (widthChars * 0.62) : byHeight;
  return Math.max(8, Math.round(Math.min(byHeight, byWidth)));
}

/** Absolute, centered, column flow used by every scene branch. `margin`
 *  (never `gap`) separates the stacked lines — see CLAUDE.md rule #10. */
const sceneWrap: React.CSSProperties = {
  position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', textAlign: 'center', padding: '4%',
  boxSizing: 'border-box',
};

/* ════════════════ shared building blocks ════════════════ */

/** Burst of upward particles — ported from <SparkRain>. */
interface SparkRainProps { on: boolean; color: string; count: number; kf: string; }
function SparkRain({ on, color, count, kf }: SparkRainProps) {
  if (!on) return null;
  const items: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const left = (i * 96 + (i * 37) % 60) % 7680;
    const size = 6 + (i % 5) * 2;
    const delay = ((i % 12) * 0.08).toFixed(2);
    const dur = (1.6 + (i % 5) * 0.25).toFixed(2);
    items.push(
      <span key={i} style={{ position: 'absolute', left: `${(left / 7680) * 100}%`, bottom: 0, width: size, height: size, borderRadius: size, background: color, boxShadow: `0 0 12px ${color}`, animation: `${kf} ${dur}s ease-out ${delay}s infinite`, willChange: 'transform, opacity' }} />,
    );
  }
  return <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' }}>{items}</div>;
}

/** Big repeating stripe pattern — ported from <StripeFly>. */
interface StripeFlyProps { on: boolean; from: string; to: string; kf: string; speedSec: number; }
function StripeFly({ on, from, to, kf, speedSec }: StripeFlyProps) {
  return (
    <div aria-hidden style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
      backgroundImage: `repeating-linear-gradient(135deg, ${from} 0 100px, ${to} 100px 200px)`,
      animation: on ? `${kf} ${speedSec}s linear infinite` : undefined,
    }} />
  );
}

/** Animated arrows sweeping across — ported from <ArrowSweep>. */
interface ArrowSweepProps { on: boolean; color: string; count: number; duration: number; kf: string; }
function ArrowSweep({ on, color, count, duration, kf }: ArrowSweepProps) {
  const items: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    items.push(
      <div key={i} style={{ position: 'absolute', top: `${((60 + (i % 3) * 120) / 480) * 100}%`, left: 0, width: '3.6%', animation: on ? `${kf} ${duration}s linear ${i * 0.4}s infinite` : undefined }}>
        <svg width="100%" viewBox="0 0 280 60" preserveAspectRatio="xMidYMid meet"><polygon points="0,30 220,30 220,5 280,30 220,55 220,30" fill={color} opacity={0.4 + (i % 3) * 0.2} /></svg>
      </div>,
    );
  }
  return <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' }}>{items}</div>;
}

/** Repeating stadium word echoes — ported from <WordEcho>. */
interface WordEchoProps { on: boolean; word: string; color: string; size: number; height: number; }
function WordEcho({ on, word, color, size, height }: WordEchoProps) {
  const words: React.ReactNode[] = [];
  for (let i = 0; i < 8; i++) {
    words.push(
      <div key={i} style={{
        fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', fontWeight: 800, fontSize: px(height, size / 480), letterSpacing: '-0.04em',
        color: i === 0 ? color : `${color}${Math.max(0xa - i, 1).toString(16)}0`,
        textShadow: i === 0 ? `0 0 80px ${color}aa` : 'none',
        WebkitTextStroke: i > 1 ? `2px ${color}55` : undefined,
        WebkitTextFillColor: i > 1 ? 'transparent' : color,
        marginRight: px(height, 30 / 480),
      }}>{word}</div>,
    );
  }
  return (
    <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div style={{ display: 'flex', animation: on ? 'celOtherEchoFly 8s linear infinite' : undefined, willChange: 'transform' }}>{words}</div>
    </div>
  );
}

/** Split-flap baseboard — ported from <SplitFlap> (retro style). */
interface SplitFlapProps { children: string; size: number; color: string; height: number; }
function SplitFlap({ children, size, color, height }: SplitFlapProps) {
  return (
    <div style={{ display: 'inline-flex' }}>
      {String(children).split('').map((ch, i) => (
        <span key={i} style={{ background: '#0a0a0a', color, padding: '10px 18px', borderRadius: 8, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: 800, fontSize: px(height, size / 480), lineHeight: 1, borderBottom: `2px solid ${color}33`, boxShadow: `0 4px 0 #000, 0 0 30px ${color}66`, marginRight: i === String(children).length - 1 ? 0 : 8 }}>{ch}</span>
      ))}
    </div>
  );
}

/** Neon synthwave grid background — ported from <NeonGrid>. */
interface NeonGridProps { on: boolean; color: string; }
function NeonGrid({ on, color }: NeonGridProps) {
  return (
    <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: '#0a0014', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: `linear-gradient(${color}33 2px, transparent 2px), linear-gradient(90deg, ${color}33 2px, transparent 2px)`, backgroundSize: '80px 80px', animation: on ? 'celOtherGrid 4s linear infinite' : undefined }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40%', background: `linear-gradient(to top, ${color}66, transparent)` }} />
    </div>
  );
}

/** Shared vignette frame — ported from <Ribbon>. */
function Vignette() {
  return <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 200px rgba(0,0,0,.45)' }} />;
}

/** Shared keyframe block used across the ribbon celebrations. */
function RibbonKeyframes() {
  return (
    <style>{`
      @keyframes celOtherEchoFly { from { transform: translateX(0); } to { transform: translateX(-200px); } }
      @keyframes celOtherGrid { from { background-position: 0 0; } to { background-position: 200px 0; } }
      @keyframes celOtherSwoosh { 0% { stroke-dashoffset: 600; } 100% { stroke-dashoffset: 0; } }
      @keyframes celOtherPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
      @keyframes celOtherBlink { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
      @keyframes celOtherBassThump { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(1.04); } }
      @keyframes celOtherShake { 0%, 100% { transform: translate(0,0); } 10%, 30%, 50%, 70%, 90% { transform: translate(-8px,0); } 20%, 40%, 60%, 80% { transform: translate(8px,0); } }
      @keyframes celOtherPunchOut { 0% { transform: scale(2.4); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 70% { transform: scale(1); } 100% { transform: scale(1.06); } }
      @keyframes celOtherSlideL { 0% { transform: translateX(-1200px); opacity: 0; } 25% { opacity: 1; } 100% { transform: translateX(0); opacity: 1; } }
      @keyframes celOtherSlideR { 0% { transform: translateX(1200px); opacity: 0; } 25% { opacity: 1; } 100% { transform: translateX(0); opacity: 1; } }
      @keyframes celOtherSpark { 0% { transform: translateY(80px) scale(0); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(-560px) scale(.6); opacity: 0; } }
      @keyframes celOtherStripeFly { from { transform: translateX(0); } to { transform: translateX(-200px); } }
      @keyframes celOtherArrowSweep { 0% { transform: translateX(-300px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(7400px); opacity: 0; } }
    `}</style>
  );
}

const PJS = '"Plus Jakarta Sans", system-ui, sans-serif';
const JBM = '"JetBrains Mono", ui-monospace, monospace';

/* ═════════════════════════════════════════════════════════════
 *  RETRO + NEON variants for the big events
 * ════════════════════════════════════════════════════════════ */

/* ════════════════ BASEBALL · HOME RUN (RETRO) ════════════════ */

export interface BbHomeRunRetroCfg extends BaseCfg {
  player?: string;
  distance?: string;
}

export function BbHomeRunRetroWidget({ config, live = true, height = 480 }: WidgetProps<BbHomeRunRetroCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0d3a1a', textColor: '#ffd23a', accentColor: '#fff', borderColor: '#ffd23a', ...c.style });
  const player = c.player ?? 'BENCH';
  const distance = c.distance ?? '418 FT';
  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'repeating-linear-gradient(0deg, #0a3015 0 4px, #0d3a1a 4px 8px)' }} />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontFamily: JBM, fontWeight: 800, fontSize: px(height, 50 / 480), letterSpacing: '0.16em', borderBottom: '4px solid #ffd23a', paddingBottom: 8 }}>HOME · RUN</div>
            <div style={{ marginTop: px(height, 18 / 480) }}><SplitFlap size={160} color="#ffd23a" height={height}>HR</SplitFlap></div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#ffd23a', fontFamily: JBM, fontWeight: 800, fontSize: px(height, 42 / 480), letterSpacing: '0.1em' }}>BATTER</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1, color: '#fff' }}>{player}</div>
            <div style={{ marginTop: px(height, 16 / 480) }}><SplitFlap size={120} color="#fff" height={height}>{distance}</SplitFlap></div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 14), letterSpacing: '0.16em', borderBottom: '4px solid #ffd23a', paddingBottom: px(mh, 6 / 480) }}>HOME · RUN</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.30, 0.12), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.05) }}>{player}</div>
          <div style={{ color: '#ffd23a', fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.1, distance.length + 2), marginTop: px(mh, 0.035) }}>{distance}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ BASEBALL · HOME RUN (NEON) ════════════════ */

export interface BbHomeRunNeonCfg extends BaseCfg {
  player?: string;
  distance?: string;
}

export function BbHomeRunNeonWidget({ config, live = true, height = 480 }: WidgetProps<BbHomeRunNeonCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0014', textColor: '#ff00ff', accentColor: '#00ffff', borderColor: '#ff00ff', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'OHTANI';
  const distance = c.distance ?? '462 FT';
  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#ff00ff" />
      <Vignette />
      <svg viewBox="0 0 7680 480" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}>
        <path d="M 200 400 Q 3000 -800 6800 380" stroke="#00ffff" strokeWidth="28" fill="none" strokeDasharray="600" style={{ filter: 'drop-shadow(0 0 30px #00ffff)', animation: animOn ? 'celOtherSwoosh 1.5s ease-out infinite' : undefined }} />
      </svg>
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#00ffff', fontWeight: 800, fontSize: px(height, 50 / 480), letterSpacing: '0.16em', textShadow: '0 0 30px #00ffff' }}>+1 RUN · HOME RUN</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 260 / 480), lineHeight: 0.9, color: '#ff00ff', textShadow: '0 0 40px #ff00ff, 0 0 80px #ff00ff' }}>BOMB.</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 240 / 480), color: '#00ffff', textShadow: '0 0 40px #00ffff' }}>{distance}</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 140 / 480), color: '#fff' }}>{player}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#00ffff', fontWeight: 800, fontSize: sceneText(width, mh, 0.06, 18), letterSpacing: '0.12em', textShadow: '0 0 30px #00ffff' }}>+1 RUN · HOME RUN</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.32, 0.16), lineHeight: 0.9, color: '#ff00ff', textShadow: '0 0 40px #ff00ff, 0 0 80px #ff00ff', marginTop: px(mh, 0.03) }}>BOMB.</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.13, distance.length + 1), color: '#00ffff', textShadow: '0 0 40px #00ffff', marginTop: px(mh, 0.035) }}>{distance}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.1, player.length), color: '#fff', marginTop: px(mh, 0.02) }}>{player}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ BASEBALL · STRIKEOUT (NEON) ════════════════ */

export interface BbStrikeoutNeonCfg extends BaseCfg {
  pitcher?: string;
  kCount?: number;
}

export function BbStrikeoutNeonWidget({ config, live = true, height = 480 }: WidgetProps<BbStrikeoutNeonCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0014', textColor: '#00ffff', accentColor: '#ff00ff', borderColor: '#00ffff', ...c.style });
  const animOn = r.anim.on && live;
  const pitcher = c.pitcher ?? 'SKENES';
  const kCount = c.kCount ?? 13;

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);
  // Three Ks side-by-side — bound the glyph so the whole row fits the box.
  const kHero = sceneHero(width, mh, 0.4, 0.18);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#00ffff" />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div style={{ display: 'flex' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 380 / 480), lineHeight: 1, color: '#00ffff', textShadow: '0 0 30px #00ffff, 0 0 60px #00ffff, 0 0 120px #ff00ff', marginRight: i === 2 ? 0 : px(height, 50 / 480), animation: animOn ? `celOtherBlink 0.5s ${i * 0.18}s infinite` : undefined }}>K</div>
            ))}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#ff00ff', fontWeight: 800, fontSize: px(height, 48 / 480), letterSpacing: '0.14em', textShadow: '0 0 20px #ff00ff' }}>K · {kCount}</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 220 / 480), lineHeight: 1 }}>{pitcher}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ fontFamily: PJS, fontWeight: 800, fontSize: kHero, lineHeight: 1, color: '#00ffff', textShadow: '0 0 30px #00ffff, 0 0 60px #00ffff, 0 0 120px #ff00ff', marginRight: i === 2 ? 0 : px(mh, 0.04), animation: animOn ? `celOtherBlink 0.5s ${i * 0.18}s infinite` : undefined }}>K</div>
            ))}
          </div>
          <div style={{ color: '#ff00ff', fontWeight: 800, fontSize: sceneText(width, mh, 0.08, 10), letterSpacing: '0.14em', textShadow: '0 0 20px #ff00ff', marginTop: px(mh, 0.04) }}>K · {kCount}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.13, pitcher.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.02) }}>{pitcher}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ FOOTBALL · TOUCHDOWN (NEON) ════════════════ */

export interface FbTouchdownNeonCfg extends BaseCfg {
  player?: string;
  distance?: string;
}

export function FbTouchdownNeonWidget({ config, live = true, height = 480 }: WidgetProps<FbTouchdownNeonCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0014', textColor: '#ff00ff', accentColor: '#00ffff', borderColor: '#ff00ff', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'MAHOMES';
  const distance = c.distance ?? '48 YD';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);
  // Two-line hero ("TOUCH"/"DOWN!") — bound so BOTH lines fit the box.
  const hero = sceneHero(width, mh, 0.30, 0.16);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#ff00ff" />
      <SparkRain on={animOn} color="#00ffff" count={80} kf="celOtherSpark" />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 300 / 480), lineHeight: 0.85, color: '#ff00ff', textShadow: '0 0 60px #ff00ff, 0 0 120px #ff00ff', letterSpacing: '-0.04em' }}>TOUCH</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 300 / 480), lineHeight: 0.85, color: '#00ffff', textShadow: '0 0 60px #00ffff, 0 0 120px #00ffff', letterSpacing: '-0.04em' }}>DOWN!</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 220 / 480), color: '#00ffff', textShadow: '0 0 30px #00ffff' }}>+6 · {distance}</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{player}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.08, distance.length + 5), color: '#00ffff', textShadow: '0 0 30px #00ffff' }}>+6 · {distance}</div>
          <div style={{ marginTop: px(mh, 0.03) }}>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: hero, lineHeight: 0.86, color: '#ff00ff', textShadow: '0 0 60px #ff00ff, 0 0 120px #ff00ff', letterSpacing: '-0.04em' }}>TOUCH</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: hero, lineHeight: 0.86, color: '#00ffff', textShadow: '0 0 60px #00ffff, 0 0 120px #00ffff', letterSpacing: '-0.04em' }}>DOWN!</div>
          </div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.11, player.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.035) }}>{player}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ FOOTBALL · TOUCHDOWN (RETRO) ════════════════ */

export interface FbTouchdownRetroCfg extends BaseCfg {
  player?: string;
  distance?: string;
}

export function FbTouchdownRetroWidget({ config, live = true, height = 480 }: WidgetProps<FbTouchdownRetroCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a0d00', textColor: '#d4a36a', accentColor: '#ffd23a', borderColor: '#d4a36a', ...c.style });
  const player = c.player ?? 'PAYTON';
  const distance = c.distance ?? '12 YD';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'radial-gradient(ellipse at center, #5a3d1f 0%, #1a0d00 70%)' }} />
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.15, backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 3px, #d4a36a 3px 4px)' }} />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#d4a36a' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: px(height, 40 / 480), letterSpacing: '0.24em', borderTop: '2px solid #d4a36a', borderBottom: '2px solid #d4a36a', padding: '8px 0' }}>1972 NFL FILMS · ARENA SERIES</div>
            <div style={{ fontFamily: PJS, fontStyle: 'italic', fontWeight: 800, fontSize: px(height, 260 / 480), lineHeight: 0.95, letterSpacing: '-0.04em', textShadow: '0 6px 30px #000' }}>Touchdown.</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: JBM, fontWeight: 700, fontSize: px(height, 46 / 480), letterSpacing: '0.1em' }}>+6 · {distance}</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1, color: '#ffd23a' }}>{player}</div>
          </div>
        </div>
      ) : (
        <div style={{ ...sceneWrap, color: '#d4a36a' }}>
          <div style={{ fontWeight: 800, fontSize: sceneText(width, mh, 0.05, 28), letterSpacing: '0.18em', borderTop: '2px solid #d4a36a', borderBottom: '2px solid #d4a36a', padding: `${px(mh, 6 / 480)}px 0` }}>1972 NFL FILMS · ARENA SERIES</div>
          <div style={{ fontFamily: PJS, fontStyle: 'italic', fontWeight: 800, fontSize: sceneHero(width, mh, 0.32, 0.13), lineHeight: 0.95, letterSpacing: '-0.04em', textShadow: '0 6px 30px #000', marginTop: px(mh, 0.04) }}>Touchdown.</div>
          <div style={{ fontFamily: JBM, fontWeight: 700, fontSize: sceneText(width, mh, 0.08, distance.length + 5), letterSpacing: '0.1em', marginTop: px(mh, 0.035) }}>+6 · {distance}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.1, player.length), lineHeight: 1, color: '#ffd23a', marginTop: px(mh, 0.02) }}>{player}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ BASKETBALL · 3-POINTER (NEON) ════════════════ */

export interface BkThreeNeonCfg extends BaseCfg {
  player?: string;
  threeCount?: number;
}

export function BkThreeNeonWidget({ config, live = true, height = 480 }: WidgetProps<BkThreeNeonCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0014', textColor: '#00ffff', accentColor: '#ffd23a', borderColor: '#00ffff', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'CURRY';
  const threeCount = c.threeCount ?? 9;

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#00ffff" />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 440 / 480), lineHeight: 0.85, color: '#00ffff', textShadow: '0 0 60px #00ffff, 0 0 120px #00ffff, 0 0 200px #ff00ff' }}>3</div>
          <div>
            <div style={{ color: '#ff00ff', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.14em', textShadow: '0 0 30px #ff00ff' }}>FROM DOWNTOWN</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 240 / 480), lineHeight: 1 }}>{player}</div>
          </div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 220 / 480), color: '#ffd23a', textShadow: '0 0 30px #ffd23a' }}>{threeCount}</div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.36, 0.2), lineHeight: 0.85, color: '#00ffff', textShadow: '0 0 60px #00ffff, 0 0 120px #00ffff, 0 0 200px #ff00ff' }}>3</div>
          <div style={{ color: '#ff00ff', fontWeight: 800, fontSize: sceneText(width, mh, 0.06, 16), letterSpacing: '0.12em', textShadow: '0 0 30px #ff00ff', marginTop: px(mh, 0.025) }}>FROM DOWNTOWN</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.13, player.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.02) }}>{player}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.09, 6), color: '#ffd23a', textShadow: '0 0 30px #ffd23a', marginTop: px(mh, 0.02) }}>#{threeCount}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ BASKETBALL · 3-POINTER (RETRO) ════════════════ */

export interface BkThreeRetroCfg extends BaseCfg {
  player?: string;
  threeCount?: number;
}

export function BkThreeRetroWidget({ config, live = true, height = 480 }: WidgetProps<BkThreeRetroCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#000', textColor: '#fff', accentColor: '#ffd23a', borderColor: '#dc2626', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'BIRD';
  const threeCount = c.threeCount ?? 5;

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <StripeFly on={animOn} from="#dc2626" to="#000" kf="celOtherStripeFly" speedSec={2} />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div style={{ transform: 'skewX(-12deg)' }}>
            <div style={{ background: '#ffd23a', color: '#000', padding: '10px 24px', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.14em', display: 'inline-block' }}>SPLASH!</div>
            <div style={{ fontFamily: PJS, fontStyle: 'italic', fontWeight: 800, fontSize: px(height, 280 / 480), lineHeight: 0.9, color: '#fff', textShadow: '8px 8px 0 #dc2626' }}>THREE.</div>
          </div>
          <div style={{ textAlign: 'right', transform: 'skewX(-12deg)' }}>
            <div style={{ background: '#dc2626', color: '#fff', padding: '10px 24px', display: 'inline-block', fontWeight: 800, fontSize: px(height, 42 / 480), letterSpacing: '0.1em' }}>#{threeCount} TONIGHT</div>
            <div style={{ fontFamily: PJS, fontStyle: 'italic', fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1, color: '#ffd23a' }}>{player}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ background: '#ffd23a', color: '#000', padding: `${px(mh, 8 / 480)}px ${px(mh, 18 / 480)}px`, fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 9), letterSpacing: '0.12em', transform: 'skewX(-12deg)' }}>SPLASH!</div>
          <div style={{ fontFamily: PJS, fontStyle: 'italic', fontWeight: 800, fontSize: sceneHero(width, mh, 0.3, 0.16), lineHeight: 0.9, color: '#fff', textShadow: '8px 8px 0 #dc2626', transform: 'skewX(-12deg)', marginTop: px(mh, 0.03) }}>THREE.</div>
          <div style={{ fontFamily: PJS, fontStyle: 'italic', fontWeight: 800, fontSize: sceneText(width, mh, 0.11, player.length), lineHeight: 1, color: '#ffd23a', transform: 'skewX(-12deg)', marginTop: px(mh, 0.035) }}>{player}</div>
          <div style={{ background: '#dc2626', color: '#fff', padding: `${px(mh, 6 / 480)}px ${px(mh, 16 / 480)}px`, fontWeight: 800, fontSize: sceneText(width, mh, 0.06, 14), letterSpacing: '0.08em', transform: 'skewX(-12deg)', marginTop: px(mh, 0.02) }}>#{threeCount} TONIGHT</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ HOCKEY · GOAL (NEON) ════════════════ */

export interface HkGoalNeonCfg extends BaseCfg {
  scorer?: string;
}

export function HkGoalNeonWidget({ config, live = true, height = 480 }: WidgetProps<HkGoalNeonCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0014', textColor: '#ff00aa', accentColor: '#00ffff', borderColor: '#ff00aa', ...c.style });
  const animOn = r.anim.on && live;
  const scorer = c.scorer ?? 'PASTRNAK';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#ff00aa" />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div style={{ animation: animOn ? 'celOtherBassThump 0.4s infinite' : undefined }}>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 320 / 480), lineHeight: 0.85, color: '#ff00aa', textShadow: '0 0 60px #ff00aa, 0 0 120px #ff00aa, 0 0 200px #00ffff', letterSpacing: '-0.04em' }}>GOAL.</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#00ffff', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.14em', textShadow: '0 0 20px #00ffff' }}>LAMP IS LIT</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 240 / 480), lineHeight: 1 }}>{scorer}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ animation: animOn ? 'celOtherBassThump 0.4s infinite' : undefined }}>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.34, 0.18), lineHeight: 0.85, color: '#ff00aa', textShadow: '0 0 60px #ff00aa, 0 0 120px #ff00aa, 0 0 200px #00ffff', letterSpacing: '-0.04em' }}>GOAL.</div>
          </div>
          <div style={{ color: '#00ffff', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 12), letterSpacing: '0.14em', textShadow: '0 0 20px #00ffff', marginTop: px(mh, 0.035) }}>LAMP IS LIT</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.13, scorer.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.02) }}>{scorer}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ HOCKEY · GOAL (RETRO) ════════════════ */

export interface HkGoalRetroCfg extends BaseCfg {
  scorer?: string;
  period?: number;
}

export function HkGoalRetroWidget({ config, live = true, height = 480 }: WidgetProps<HkGoalRetroCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a0d05', textColor: '#ffd23a', accentColor: '#dc2626', borderColor: '#ffd23a', ...c.style });
  const scorer = c.scorer ?? 'HOWE';
  const period = c.period ?? 2;

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'radial-gradient(ellipse at center, #3a1d0d 0%, #1a0d05 70%)' }} />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#ffd23a' }}>
          <div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 40 / 480), letterSpacing: '0.2em', borderBottom: '4px solid #ffd23a' }}>HE SHOOTS · HE SCORES</div>
            <div style={{ marginTop: px(height, 16 / 480) }}><SplitFlap size={200} color="#ffd23a" height={height}>GOAL</SplitFlap></div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: JBM, fontWeight: 700, fontSize: px(height, 44 / 480), letterSpacing: '0.1em' }}>PERIOD {period}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 220 / 480), lineHeight: 1 }}>{scorer}</div>
          </div>
        </div>
      ) : (
        <div style={{ ...sceneWrap, color: '#ffd23a' }}>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.055, 22), letterSpacing: '0.16em', borderBottom: '4px solid #ffd23a', paddingBottom: px(mh, 6 / 480) }}>HE SHOOTS · HE SCORES</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.28, 0.13), lineHeight: 1, marginTop: px(mh, 0.04) }}>GOAL</div>
          <div style={{ fontFamily: JBM, fontWeight: 700, fontSize: sceneText(width, mh, 0.07, 10), letterSpacing: '0.1em', marginTop: px(mh, 0.035) }}>PERIOD {period}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.11, scorer.length), lineHeight: 1, marginTop: px(mh, 0.02) }}>{scorer}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ SOCCER · GOOOOAL (RETRO) ════════════════ */

export interface ScGoalRetroCfg extends BaseCfg {
  scorer?: string;
  minute?: string;
}

export function ScGoalRetroWidget({ config, live = true, height = 480 }: WidgetProps<ScGoalRetroCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a3a0d', textColor: '#fff', accentColor: '#ffd23a', borderColor: '#fff', ...c.style });
  const scorer = c.scorer ?? 'PELÉ';
  const minute = c.minute ?? "42'";

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'repeating-linear-gradient(90deg, #0a3a0d 0 4px, #0d3f10 4px 8px)' }} />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ fontFamily: JBM, fontWeight: 700, fontSize: px(height, 36 / 480), letterSpacing: '0.24em', opacity: 0.8 }}>WORLD CUP · LIVE FROM MEXICO</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 280 / 480), lineHeight: 0.95, letterSpacing: '-0.04em', textShadow: '8px 8px 0 #000' }}>GOOOOAL!</div>
          </div>
          <div style={{ background: '#000', padding: '24px 30px', borderRadius: 8, border: '3px solid #ffd23a' }}>
            <div style={{ fontFamily: JBM, fontWeight: 700, fontSize: px(height, 34 / 480), color: '#ffd23a' }}>{minute}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 120 / 480), color: '#fff' }}>{scorer}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ fontFamily: JBM, fontWeight: 700, fontSize: sceneText(width, mh, 0.05, 26), letterSpacing: '0.18em', opacity: 0.8, color: '#fff' }}>WORLD CUP · LIVE FROM MEXICO</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.3, 0.15), lineHeight: 0.95, letterSpacing: '-0.04em', textShadow: '8px 8px 0 #000', color: '#fff', marginTop: px(mh, 0.03) }}>GOOOOAL!</div>
          <div style={{ background: '#000', padding: `${px(mh, 10 / 480)}px ${px(mh, 22 / 480)}px`, borderRadius: 8, border: '3px solid #ffd23a', marginTop: px(mh, 0.04), display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontFamily: JBM, fontWeight: 700, fontSize: sceneText(width, mh, 0.06, 8), color: '#ffd23a' }}>{minute}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.12, scorer.length + 1), color: '#fff' }}>{scorer}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ SOCCER · GOOOOAL (NEON) ════════════════ */

export interface ScGoalNeonCfg extends BaseCfg {
  scorer?: string;
  minute?: string;
}

export function ScGoalNeonWidget({ config, live = true, height = 480 }: WidgetProps<ScGoalNeonCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0014', textColor: '#00ff66', accentColor: '#ff00aa', borderColor: '#00ff66', ...c.style });
  const animOn = r.anim.on && live;
  const scorer = c.scorer ?? 'MBAPPÉ';
  const minute = c.minute ?? "90'+3";

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#00ff66" />
      <WordEcho on={animOn} word="GOAL!" color="#00ff66" size={wide ? 260 : 360} height={wide ? height : Math.max(mh, 1)} />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', bottom: px(height, 30 / 480), left: px(height, 80 / 480), right: px(height, 80 / 480), display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', color: '#fff' }}>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 80 / 480), color: '#ff00aa', textShadow: '0 0 20px #ff00aa' }}>{minute}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 160 / 480), color: '#00ffff', textShadow: '0 0 40px #00ffff' }}>{scorer}</div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.22, 0.13), color: '#00ffff', textShadow: '0 0 40px #00ffff' }}>{scorer}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.12, minute.length + 1), color: '#ff00aa', textShadow: '0 0 20px #ff00aa', marginTop: px(mh, 0.04) }}>{minute}</div>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
 *  TENNIS — 5 celebrations
 * ════════════════════════════════════════════════════════════ */

/* ════════════════ TENNIS · ACE ════════════════ */

export interface TnAceCfg extends BaseCfg {
  player?: string;
  speed?: string;
  aces?: number;
}

export function TnAceWidget({ config, live = true, height = 480 }: WidgetProps<TnAceCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a4a8a', textColor: '#fff', accentColor: '#ffd23a', borderColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'ALCARAZ';
  const speed = c.speed ?? '141 MPH';
  const aces = c.aces ?? 8;

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <Vignette />
      <svg viewBox="0 0 7680 480" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}>
        <rect x="0" y="200" width="7680" height="4" fill="#fff" opacity=".5" />
        <rect x="0" y="280" width="7680" height="4" fill="#fff" opacity=".5" />
        <path d="M 600 200 L 6900 380" stroke="#ffd23a" strokeWidth="18" fill="none" strokeDasharray="600" style={{ filter: 'drop-shadow(0 0 20px #ffd23a)', animation: animOn ? 'celOtherSwoosh 1s linear infinite' : undefined }} />
        <circle cx="6900" cy="380" r="32" fill="#ffd23a" />
      </svg>
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.14em' }}>UNRETURNABLE!</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 280 / 480), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a' }}>ACE!</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 140 / 480), color: '#ffd23a' }}>{speed}</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 180 / 480), lineHeight: 1 }}>{player}</div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 34 / 480) }}>{aces} aces this match</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 14), letterSpacing: '0.14em' }}>UNRETURNABLE!</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.3, 0.16), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a', marginTop: px(mh, 0.02) }}>ACE!</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.11, player.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.035) }}>{player}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.08, speed.length + 1), color: '#ffd23a', marginTop: px(mh, 0.02) }}>{speed}</div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.05, 22), marginTop: px(mh, 0.015) }}>{aces} aces this match</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ TENNIS · ACE (NEON) ════════════════ */

export interface TnAceNeonCfg extends BaseCfg {
  player?: string;
  speed?: string;
}

export function TnAceNeonWidget({ config, live = true, height = 480 }: WidgetProps<TnAceNeonCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0014', textColor: '#00ffff', accentColor: '#ff00ff', borderColor: '#00ffff', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'SINNER';
  const speed = c.speed ?? '138 MPH';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#00ffff" />
      <Vignette />
      <svg viewBox="0 0 7680 480" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}>
        <path d="M 500 200 L 7000 380" stroke="#ff00ff" strokeWidth="24" fill="none" strokeDasharray="600" style={{ filter: 'drop-shadow(0 0 40px #ff00ff)', animation: animOn ? 'celOtherSwoosh 0.8s linear infinite' : undefined }} />
        <circle cx="7000" cy="380" r="60" fill="#00ffff" style={{ filter: 'drop-shadow(0 0 40px #00ffff)' }} />
      </svg>
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 340 / 480), lineHeight: 0.9, color: '#00ffff', textShadow: '0 0 60px #00ffff, 0 0 120px #ff00ff' }}>ACE</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 160 / 480), color: '#ff00ff', textShadow: '0 0 30px #ff00ff' }}>{speed}</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{player}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.34, 0.2), lineHeight: 0.9, color: '#00ffff', textShadow: '0 0 60px #00ffff, 0 0 120px #ff00ff' }}>ACE</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.1, speed.length + 1), color: '#ff00ff', textShadow: '0 0 30px #ff00ff', marginTop: px(mh, 0.035) }}>{speed}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.12, player.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.02) }}>{player}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ TENNIS · BREAK POINT WON ════════════════ */

export interface TnBreakPointCfg extends BaseCfg {
  player?: string;
  set?: number;
  score?: string;
}

export function TnBreakPointWidget({ config, live = true, height = 480 }: WidgetProps<TnBreakPointCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#dc2626', textColor: '#fff', accentColor: '#ffd23a', borderColor: '#fff', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'SWIATEK';
  const set = c.set ?? 1;
  const score = c.score ?? '4-3';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <StripeFly on={animOn} from="#dc2626" to="#000" kf="celOtherStripeFly" speedSec={2} />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.14em' }}>SERVE BROKEN!</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 240 / 480), lineHeight: 0.9, textShadow: '0 0 40px #000' }}>BREAK POINT</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 42 / 480) }}>SET {set}</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{player}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 100 / 480), color: '#ffd23a' }}>{score}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 14), letterSpacing: '0.14em' }}>SERVE BROKEN!</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.26, 0.12), lineHeight: 0.9, color: '#fff', textShadow: '0 0 40px #000', marginTop: px(mh, 0.025) }}>BREAK POINT</div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.06, 6), marginTop: px(mh, 0.035) }}>SET {set}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.11, player.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.015) }}>{player}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.08, score.length + 1), color: '#ffd23a', marginTop: px(mh, 0.015) }}>{score}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ TENNIS · MATCH POINT ════════════════ */

export interface TnMatchPointCfg extends BaseCfg {
  player?: string;
  score?: string;
}

export function TnMatchPointWidget({ config, live = true, height = 480 }: WidgetProps<TnMatchPointCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#000', textColor: '#ffd23a', accentColor: '#fff', borderColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'DJOKOVIC';
  const score = c.score ?? '40-30';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'radial-gradient(ellipse at center, #ffd23a22, transparent 60%)', animation: animOn ? 'celOtherPulse 1s infinite' : undefined }} />
      <SparkRain on={animOn} color="#ffd23a" count={100} kf="celOtherSpark" />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 300 / 480), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 80px #ffd23a, 0 0 160px #ffd23a44' }}>MATCH POINT</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 280 / 480), color: '#fff', textShadow: '0 0 30px #fff' }}>{score}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 160 / 480), lineHeight: 1 }}>{player}</div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.24, 0.11), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 80px #ffd23a, 0 0 160px #ffd23a44' }}>MATCH POINT</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.18, score.length + 1), color: '#fff', textShadow: '0 0 30px #fff', marginTop: px(mh, 0.03) }}>{score}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.1, player.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.025) }}>{player}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ TENNIS · WINNER ════════════════ */

export interface TnWinnerCfg extends BaseCfg {
  player?: string;
  shot?: string;
  winners?: number;
}

export function TnWinnerWidget({ config, live = true, height = 480 }: WidgetProps<TnWinnerCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a4a8a', textColor: '#fff', accentColor: '#ffd23a', borderColor: '#fff', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'GAUFF';
  const shot = c.shot ?? 'FOREHAND';
  const winners = c.winners ?? 24;

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <Vignette />
      <svg viewBox="0 0 7680 480" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}>
        <path d="M 6800 60 L 6800 420 M 6700 60 L 6900 60 M 6700 420 L 6900 420" stroke="#fff" strokeWidth="4" />
        <path d="M 700 120 Q 3500 60 6800 380" stroke="#ffd23a" strokeWidth="18" strokeDasharray="40 25" fill="none" style={{ animation: animOn ? 'celOtherSwoosh 1.4s linear infinite' : undefined }} />
      </svg>
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.1em' }}>{shot} WINNER</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 300 / 480), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a' }}>PAINTED IT.</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 140 / 480), lineHeight: 1 }}>{player} · {winners} winners</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, shot.length + 8), letterSpacing: '0.08em' }}>{shot} WINNER</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.28, 0.14), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a', marginTop: px(mh, 0.025) }}>PAINTED IT.</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.09, player.length + 12), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.035) }}>{player} · {winners} winners</div>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
 *  LACROSSE — 4 celebrations
 * ════════════════════════════════════════════════════════════ */

/* ════════════════ LACROSSE · GOAL ════════════════ */

export interface LxGoalCfg extends BaseCfg {
  scorer?: string;
  number?: string;
  score?: string;
}

export function LxGoalWidget({ config, live = true, height = 480 }: WidgetProps<LxGoalCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#003a14', textColor: '#fff', accentColor: '#ffd23a', borderColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const scorer = c.scorer ?? 'RAMBO';
  const number = c.number ?? '1';
  const score = c.score ?? '8-6';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <StripeFly on={animOn} from="#003a14" to="#000" kf="celOtherStripeFly" speedSec={3} />
      <SparkRain on={animOn} color="#ffd23a" count={100} kf="celOtherSpark" />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.14em' }}>STICKS UP!</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 300 / 480), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a' }}>GOAL!</div>
          </div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 340 / 480), color: '#ffd23a', textShadow: '0 0 80px #ffd23a' }}>#{number}</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{scorer}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 100 / 480), color: '#ffd23a' }}>{score}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 11), letterSpacing: '0.14em' }}>STICKS UP!</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.3, 0.16), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a', marginTop: px(mh, 0.02) }}>GOAL!</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.11, scorer.length + 5), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.035) }}>#{number} · {scorer}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.08, score.length + 1), color: '#ffd23a', marginTop: px(mh, 0.015) }}>{score}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ LACROSSE · BEHIND-THE-BACK GOAL ════════════════ */

export interface LxBehindTheBackCfg extends BaseCfg {
  player?: string;
  distance?: string;
}

export function LxBehindTheBackWidget({ config, live = true, height = 480 }: WidgetProps<LxBehindTheBackCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a0008', textColor: '#fff', accentColor: '#ffd23a', borderColor: '#dc2626', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'GAIT';
  const distance = c.distance ?? '10 YD';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <SparkRain on={animOn} color="#ffd23a" count={130} kf="celOtherSpark" />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#dc2626', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.14em' }}>HIGHLIGHT REEL</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a' }}>BEHIND-THE-BACK</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 220 / 480), lineHeight: 1 }}>{player}</div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 54 / 480) }}>{distance}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#dc2626', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 15), letterSpacing: '0.14em' }}>HIGHLIGHT REEL</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.16, 16), lineHeight: 0.95, color: '#ffd23a', textShadow: '0 0 60px #ffd23a', marginTop: px(mh, 0.025) }}>BEHIND-THE-BACK</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.12, player.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.035) }}>{player}</div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.08, distance.length + 1), marginTop: px(mh, 0.015) }}>{distance}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ LACROSSE · BIG SAVE ════════════════ */

export interface LxBigSaveCfg extends BaseCfg {
  goalie?: string;
  saves?: number;
}

export function LxBigSaveWidget({ config, live = true, height = 480 }: WidgetProps<LxBigSaveCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#001a0a', textColor: '#22d39b', accentColor: '#fff', borderColor: '#22d39b', ...c.style });
  const goalie = c.goalie ?? 'GAUDET';
  const saves = c.saves ?? 11;

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#22d39b', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.14em' }}>STONEWALL!</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 280 / 480), lineHeight: 0.9, color: '#22d39b', textShadow: '0 0 60px #22d39b' }}>BIG SAVE</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{goalie}</div>
            <div style={{ color: '#22d39b', fontWeight: 800, fontSize: px(height, 54 / 480) }}>{saves} SAVES TONIGHT</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#22d39b', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 11), letterSpacing: '0.14em' }}>STONEWALL!</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.28, 0.14), lineHeight: 0.9, color: '#22d39b', textShadow: '0 0 60px #22d39b', marginTop: px(mh, 0.025) }}>BIG SAVE</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.11, goalie.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.035) }}>{goalie}</div>
          <div style={{ color: '#22d39b', fontWeight: 800, fontSize: sceneText(width, mh, 0.06, 18), marginTop: px(mh, 0.015) }}>{saves} SAVES TONIGHT</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ LACROSSE · FACE-OFF WIN ════════════════ */

export interface LxFaceoffCfg extends BaseCfg {
  player?: string;
  winPct?: number;
}

export function LxFaceoffWidget({ config, live = true, height = 480 }: WidgetProps<LxFaceoffCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a1500', textColor: '#ffd23a', accentColor: '#22c55e', borderColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? "O'CONNOR";
  const winPct = c.winPct ?? 78;

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <ArrowSweep on={animOn} color="#ffd23a" count={6} duration={1.8} kf="celOtherArrowSweep" />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.12em' }}>WON THE X!</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 240 / 480), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a' }}>FACE-OFF</div>
          </div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 240 / 480), color: '#22c55e', textShadow: '0 0 50px #22c55e' }}>{winPct}%</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{player}</div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 34 / 480) }}>face-off rate</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 11), letterSpacing: '0.12em' }}>WON THE X!</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.24, 0.12), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a', marginTop: px(mh, 0.02) }}>FACE-OFF</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.16, 5), color: '#22c55e', textShadow: '0 0 50px #22c55e', marginTop: px(mh, 0.03) }}>{winPct}%</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.1, player.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.025) }}>{player}</div>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
 *  WRESTLING — 4 celebrations
 * ════════════════════════════════════════════════════════════ */

/* ════════════════ WRESTLING · PIN ════════════════ */

export interface WrPinCfg extends BaseCfg {
  winner?: string;
  loser?: string;
  weight?: string;
  time?: string;
}

export function WrPinWidget({ config, live = true, height = 480 }: WidgetProps<WrPinCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0a0a', textColor: '#fff', accentColor: '#dc2626', borderColor: '#dc2626', ...c.style });
  const animOn = r.anim.on && live;
  const winner = c.winner ?? 'JORDAN BURROUGHS';
  const weight = c.weight ?? '74 KG';
  const time = c.time ?? '1:47';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);
  // Three count-squares in a row — size each so the whole row fits.
  const sq = sceneHero(width, mh, 0.26, 0.16);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div style={{ display: 'flex', animation: animOn ? 'celOtherPunchOut 0.5s ease-out' : undefined }}>
            {[1, 2, 3].map(n => (
              <div key={n} style={{ width: px(height, 200 / 480), height: px(height, 200 / 480), borderRadius: 24, background: '#dc2626', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1, boxShadow: '0 0 50px #dc2626', marginRight: n === 3 ? 0 : px(height, 30 / 480), animation: animOn ? `celOtherBlink 0.4s ${(n - 1) * 0.18}s infinite` : undefined }}>{n}</div>
            ))}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#dc2626', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.14em' }}>PINNED · {time}</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 180 / 480), lineHeight: 1 }}>{winner}</div>
            <div style={{ color: '#dc2626', fontWeight: 800, fontSize: px(height, 46 / 480) }}>{weight}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ display: 'flex', justifyContent: 'center', animation: animOn ? 'celOtherPunchOut 0.5s ease-out' : undefined }}>
            {[1, 2, 3].map(n => (
              <div key={n} style={{ width: sq, height: sq, borderRadius: 16, background: '#dc2626', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: PJS, fontWeight: 800, fontSize: sq, lineHeight: 1, boxShadow: '0 0 50px #dc2626', marginRight: n === 3 ? 0 : px(mh, 0.03), animation: animOn ? `celOtherBlink 0.4s ${(n - 1) * 0.18}s infinite` : undefined }}>{n}</div>
            ))}
          </div>
          <div style={{ color: '#dc2626', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 14), letterSpacing: '0.14em', marginTop: px(mh, 0.035) }}>PINNED · {time}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.12, winner.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.02) }}>{winner}</div>
          <div style={{ color: '#dc2626', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, weight.length + 1), marginTop: px(mh, 0.015) }}>{weight}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ WRESTLING · TAKEDOWN ════════════════ */

export interface WrTakedownCfg extends BaseCfg {
  wrestler?: string;
  score?: string;
}

export function WrTakedownWidget({ config, live = true, height = 480 }: WidgetProps<WrTakedownCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0d0a00', textColor: '#ffd23a', accentColor: '#dc2626', borderColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const wrestler = c.wrestler ?? 'TAYLOR';
  const score = c.score ?? '7-2';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <StripeFly on={animOn} from="#1a1500" to="#000" kf="celOtherStripeFly" speedSec={3} />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.14em' }}>TAKEDOWN!</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 280 / 480), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a' }}>+2</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{wrestler}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 120 / 480), color: '#ffd23a' }}>{score}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 11), letterSpacing: '0.14em' }}>TAKEDOWN!</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.3, 0.16), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a', marginTop: px(mh, 0.02) }}>+2</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.11, wrestler.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.035) }}>{wrestler}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.08, score.length + 1), color: '#ffd23a', marginTop: px(mh, 0.015) }}>{score}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ WRESTLING · NEAR FALL ════════════════ */

export interface WrNearFallCfg extends BaseCfg {
  wrestler?: string;
  points?: number;
  score?: string;
}

export function WrNearFallWidget({ config, live = true, height = 480 }: WidgetProps<WrNearFallCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a0008', textColor: '#dc2626', accentColor: '#fff', borderColor: '#dc2626', ...c.style });
  const wrestler = c.wrestler ?? 'STEVESON';
  const points = c.points ?? 4;
  const score = c.score ?? '11-2';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#dc2626', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.14em' }}>NEAR FALL</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 280 / 480), lineHeight: 0.9, color: '#dc2626', textShadow: '0 0 60px #dc2626' }}>+{points} BACK</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{wrestler}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 120 / 480), color: '#dc2626' }}>{score}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#dc2626', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 10), letterSpacing: '0.14em' }}>NEAR FALL</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.2, 9), lineHeight: 0.9, color: '#dc2626', textShadow: '0 0 60px #dc2626', marginTop: px(mh, 0.02) }}>+{points} BACK</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.11, wrestler.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.035) }}>{wrestler}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.08, score.length + 1), color: '#dc2626', marginTop: px(mh, 0.015) }}>{score}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ WRESTLING · TECHNICAL FALL ════════════════ */

export interface WrTechFallCfg extends BaseCfg {
  winner?: string;
  lead?: string;
}

export function WrTechFallWidget({ config, live = true, height = 480 }: WidgetProps<WrTechFallCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a1500', textColor: '#ffd23a', accentColor: '#dc2626', borderColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const winner = c.winner ?? 'DAKE';
  const lead = c.lead ?? '17-2';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <SparkRain on={animOn} color="#ffd23a" count={120} kf="celOtherSpark" />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.14em' }}>MATCH OVER</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 240 / 480), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a' }}>TECH FALL</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{winner}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 140 / 480), color: '#ffd23a' }}>{lead}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 11), letterSpacing: '0.14em' }}>MATCH OVER</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.26, 0.13), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a', marginTop: px(mh, 0.025) }}>TECH FALL</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.11, winner.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.035) }}>{winner}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.09, lead.length + 1), color: '#ffd23a', marginTop: px(mh, 0.015) }}>{lead}</div>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
 *  GOLF — 3 celebrations
 * ════════════════════════════════════════════════════════════ */

/* ════════════════ GOLF · HOLE-IN-ONE ════════════════ */

export interface GfAceCfg extends BaseCfg {
  player?: string;
  hole?: number;
  yards?: number;
}

export function GfAceWidget({ config, live = true, height = 480 }: WidgetProps<GfAceCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0d3a1a', textColor: '#ffd23a', accentColor: '#fff', borderColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const player = c.player ?? 'WOODS';
  const hole = c.hole ?? 7;
  const yards = c.yards ?? 165;

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <SparkRain on={animOn} color="#ffd23a" count={200} kf="celOtherSpark" />
      <Vignette />
      <svg viewBox="0 0 7680 480" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}>
        <path d="M 400 380 Q 3500 -200 6900 280" stroke="#fff" strokeWidth="14" fill="none" strokeDasharray="20 30" style={{ animation: animOn ? 'celOtherSwoosh 2s linear infinite' : undefined }} />
        <circle cx="6900" cy="280" r="40" fill="#fff" />
        <line x1="6900" y1="280" x2="6900" y2="80" stroke="#dc2626" strokeWidth="8" />
        <polygon points="6900,80 7000,90 6900,110" fill="#dc2626" />
      </svg>
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.14em' }}>NEVER FORGET IT</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 240 / 480), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 80px #ffd23a' }}>HOLE-IN-ONE!</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 46 / 480) }}>HOLE {hole} · {yards} YD</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 240 / 480), lineHeight: 1 }}>{player}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 15), letterSpacing: '0.14em' }}>NEVER FORGET IT</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.21, 12), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 80px #ffd23a', marginTop: px(mh, 0.025) }}>HOLE-IN-ONE!</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.12, player.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.035) }}>{player}</div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.06, 16), marginTop: px(mh, 0.015) }}>HOLE {hole} · {yards} YD</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ GOLF · EAGLE ════════════════ */

export interface GfEagleCfg extends BaseCfg {
  player?: string;
  hole?: number;
  score?: string;
}

export function GfEagleWidget({ config, live = true, height = 480 }: WidgetProps<GfEagleCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a2d14', textColor: '#fff', accentColor: '#ffd23a', borderColor: '#fff', ...c.style });
  const player = c.player ?? 'SCHEFFLER';
  const score = c.score ?? '-7';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.14em' }}>EAGLE!</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 240 / 480), lineHeight: 0.95, textShadow: '0 0 40px #fff' }}>-2 ON 13</div>
          </div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 280 / 480), color: '#ffd23a', textShadow: '0 0 60px #ffd23a' }}>{score}</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{player}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.08, 7), letterSpacing: '0.14em' }}>EAGLE!</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.16, 9), lineHeight: 0.95, color: '#fff', textShadow: '0 0 40px #fff', marginTop: px(mh, 0.025) }}>-2 ON 13</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.28, 0.16), color: '#ffd23a', textShadow: '0 0 60px #ffd23a', marginTop: px(mh, 0.025) }}>{score}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.1, player.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.025) }}>{player}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ GOLF · BIRDIE ════════════════ */

export interface GfBirdieCfg extends BaseCfg {
  player?: string;
  hole?: number;
  score?: string;
}

export function GfBirdieWidget({ config, live = true, height = 480 }: WidgetProps<GfBirdieCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a4a24', textColor: '#ffd23a', accentColor: '#fff', borderColor: '#ffd23a', ...c.style });
  const player = c.player ?? 'MORIKAWA';
  const hole = c.hole ?? 5;
  const score = c.score ?? '-3';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.14em' }}>BIRDIE</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 240 / 480), color: '#ffd23a', textShadow: '0 0 40px #ffd23a' }}>-1</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 180 / 480), lineHeight: 1 }}>{player}</div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 48 / 480) }}>HOLE {hole} · TOURNEY {score}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.08, 7), letterSpacing: '0.14em' }}>BIRDIE</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.3, 0.16), color: '#ffd23a', textShadow: '0 0 40px #ffd23a', marginTop: px(mh, 0.02) }}>-1</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.11, player.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.035) }}>{player}</div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.06, 22), marginTop: px(mh, 0.015) }}>HOLE {hole} · TOURNEY {score}</div>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
 *  BOXING / MMA — 4 celebrations
 * ════════════════════════════════════════════════════════════ */

/* ════════════════ BOXING/MMA · KNOCKOUT ════════════════ */

export interface BxKnockoutCfg extends BaseCfg {
  winner?: string;
  round?: number;
  time?: string;
}

export function BxKnockoutWidget({ config, live = true, height = 480 }: WidgetProps<BxKnockoutCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a0008', textColor: '#fff', accentColor: '#ffd23a', borderColor: '#dc2626', ...c.style });
  const animOn = r.anim.on && live;
  const winner = c.winner ?? 'FURY';
  const round = c.round ?? 4;
  const time = c.time ?? '2:31';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <StripeFly on={animOn} from="#dc2626" to="#000" kf="celOtherStripeFly" speedSec={1.6} />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div style={{ animation: animOn ? 'celOtherShake 0.4s ease-in-out 2' : undefined }}>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.18em' }}>FIGHT OVER</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 380 / 480), lineHeight: 0.85, color: '#dc2626', textShadow: '0 0 80px #dc2626, 0 8px 30px #000', letterSpacing: '-0.04em' }}>KO!</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 46 / 480) }}>RD {round} · {time}</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 240 / 480), lineHeight: 1 }}>{winner}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ animation: animOn ? 'celOtherShake 0.4s ease-in-out 2' : undefined, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 11), letterSpacing: '0.16em' }}>FIGHT OVER</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.36, 0.2), lineHeight: 0.85, color: '#dc2626', textShadow: '0 0 80px #dc2626, 0 8px 30px #000', letterSpacing: '-0.04em', marginTop: px(mh, 0.02) }}>KO!</div>
          </div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 14), marginTop: px(mh, 0.035) }}>RD {round} · {time}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.12, winner.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.015) }}>{winner}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ BOXING/MMA · TKO ════════════════ */

export interface BxTkoCfg extends BaseCfg {
  winner?: string;
  round?: number;
}

export function BxTkoWidget({ config, live = true, height = 480 }: WidgetProps<BxTkoCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0008', textColor: '#ffd23a', accentColor: '#dc2626', borderColor: '#ffd23a', ...c.style });
  const winner = c.winner ?? 'USYK';
  const round = c.round ?? 6;

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#dc2626', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.14em' }}>REF STOPS IT</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 320 / 480), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 80px #ffd23a' }}>TKO</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 46 / 480) }}>ROUND {round}</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 220 / 480), lineHeight: 1 }}>{winner}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#dc2626', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 12), letterSpacing: '0.14em' }}>REF STOPS IT</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneHero(width, mh, 0.34, 0.18), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 80px #ffd23a', marginTop: px(mh, 0.02) }}>TKO</div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 9), marginTop: px(mh, 0.035) }}>ROUND {round}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.12, winner.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.015) }}>{winner}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ BOXING/MMA · KNOCKDOWN ════════════════ */

export interface BxKnockdownCfg extends BaseCfg {
  winner?: string;
  round?: number;
  count?: number;
}

export function BxKnockdownWidget({ config, live = true, height = 480 }: WidgetProps<BxKnockdownCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a0008', textColor: '#dc2626', accentColor: '#ffd23a', borderColor: '#dc2626', ...c.style });
  const animOn = r.anim.on && live;
  const winner = c.winner ?? 'CANELO';
  const round = c.round ?? 3;
  const count = c.count ?? 7;

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#dc2626', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.14em' }}>DOWN!</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 280 / 480), lineHeight: 0.9, color: '#dc2626', textShadow: '0 0 60px #dc2626' }}>KNOCKDOWN</div>
          </div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 300 / 480), color: '#ffd23a', textShadow: '0 0 60px #ffd23a', animation: animOn ? 'celOtherBassThump 0.5s infinite' : undefined }}>{count}</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 46 / 480) }}>RD {round}</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 180 / 480), lineHeight: 1 }}>{winner}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#dc2626', fontWeight: 800, fontSize: sceneText(width, mh, 0.08, 6), letterSpacing: '0.14em' }}>DOWN!</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.18, 10), lineHeight: 0.9, color: '#dc2626', textShadow: '0 0 60px #dc2626', marginTop: px(mh, 0.02) }}>KNOCKDOWN</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.22, 0.14), color: '#ffd23a', textShadow: '0 0 60px #ffd23a', animation: animOn ? 'celOtherBassThump 0.5s infinite' : undefined, marginTop: px(mh, 0.025) }}>{count}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.1, winner.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.025) }}>{winner}</div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.06, 7), marginTop: px(mh, 0.015) }}>RD {round}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ BOXING/MMA · END OF ROUND ════════════════ */

export interface BxEndOfRoundCfg extends BaseCfg {
  round?: number;
  p1?: string;
  p2?: string;
  p1Punches?: number;
  p2Punches?: number;
}

export function BxEndOfRoundWidget({ config, live = true, height = 480 }: WidgetProps<BxEndOfRoundCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a0d00', textColor: '#ffd23a', accentColor: '#fff', borderColor: '#ffd23a', ...c.style });
  const round = c.round ?? 6;
  const boxers = [
    { n: c.p1 ?? 'CANELO', v: c.p1Punches ?? 48 },
    { n: c.p2 ?? 'BIVOL', v: c.p2Punches ?? 31 },
  ];

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.14em' }}>END OF ROUND</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 300 / 480), lineHeight: 0.9, color: '#ffd23a' }}>{round}</div>
          </div>
          <div style={{ display: 'flex' }}>
            {boxers.map((b, i) => (
              <div key={i} style={{ textAlign: 'center', marginLeft: i === 0 ? 0 : px(height, 80 / 480) }}>
                <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 120 / 480), lineHeight: 1 }}>{b.n}</div>
                <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 120 / 480), color: '#ffd23a' }}>{b.v}</div>
                <div style={{ color: '#ffd23a', fontWeight: 700, fontSize: px(height, 24 / 480) }}>PUNCHES LANDED</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 13), letterSpacing: '0.14em' }}>END OF ROUND {round}</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: px(mh, 0.045) }}>
            {boxers.map((b, i) => (
              <div key={i} style={{ textAlign: 'center', marginLeft: i === 0 ? 0 : px(mh, 0.08), display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.11, b.n.length * 2 + 2), lineHeight: 1, color: '#fff' }}>{b.n}</div>
                <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.16, 8), color: '#ffd23a', marginTop: px(mh, 0.01) }}>{b.v}</div>
                <div style={{ color: '#ffd23a', fontWeight: 700, fontSize: sceneText(width, mh, 0.04, 30), marginTop: px(mh, 0.008) }}>PUNCHES LANDED</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
 *  TRACK & FIELD — 3 celebrations
 * ════════════════════════════════════════════════════════════ */

/* ════════════════ TRACK · WORLD RECORD ════════════════ */

export interface TrWorldRecordCfg extends BaseCfg {
  athlete?: string;
  event?: string;
  time?: string;
  country?: string;
}

export function TrWorldRecordWidget({ config, live = true, height = 480 }: WidgetProps<TrWorldRecordCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#000', textColor: '#ffd23a', accentColor: '#fff', borderColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const athlete = c.athlete ?? 'BOLT';
  const event = c.event ?? '100M';
  const time = c.time ?? '9.58s';
  const country = c.country ?? 'JAM';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <SparkRain on={animOn} color="#ffd23a" count={200} kf="celOtherSpark" />
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'radial-gradient(ellipse at center, #ffd23a44 0%, transparent 60%)', animation: animOn ? 'celOtherPulse 1s infinite' : undefined }} />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div style={{ animation: animOn ? 'celOtherSlideL 0.7s ease-out' : undefined }}>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.16em' }}>WORLD RECORD!</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 240 / 480), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 80px #ffd23a' }}>{event}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 340 / 480), color: '#ffd23a', textShadow: '0 0 80px #ffd23a' }}>{time}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 46 / 480) }}>{country}</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{athlete}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 14), letterSpacing: '0.14em' }}>WORLD RECORD!</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.13, event.length + 1), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 80px #ffd23a', marginTop: px(mh, 0.02) }}>{event}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.26, 0.14), color: '#ffd23a', textShadow: '0 0 80px #ffd23a', marginTop: px(mh, 0.025) }}>{time}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.1, athlete.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.025) }}>{athlete}</div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.05, country.length + 1), marginTop: px(mh, 0.012) }}>{country}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ TRACK · FINISH (TOP 3) ════════════════ */

export interface TrFinishEntry { pos: number; name: string; country: string; time: string; }
export interface TrFinishCfg extends BaseCfg {
  event?: string;
  top?: TrFinishEntry[];
}

export function TrFinishWidget({ config, live = true, height = 480 }: WidgetProps<TrFinishCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0a0a', textColor: '#fff', accentColor: '#ffd23a', borderColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const event = c.event ?? '400M FINAL';
  const top: TrFinishEntry[] = c.top ?? [
    { pos: 1, name: 'WARHOLM', country: 'NOR', time: '45.94' },
    { pos: 2, name: 'BENJAMIN', country: 'USA', time: '46.17' },
    { pos: 3, name: 'DOS SANTOS', country: 'BRA', time: '46.72' },
  ];
  const medals = ['#ffd23a', '#9aa3b2', '#cd7f32'];
  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);
  const rows = top.slice(0, 3);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 60 / 480)}px`, display: 'flex', alignItems: 'center', color: '#fff' }}>
          <div style={{ flex: '0 0 22%', marginRight: px(height, 40 / 480) }}>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 30 / 480), letterSpacing: '0.12em' }}>RESULTS</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 60 / 480), lineHeight: 1.05 }}>{event}</div>
          </div>
          {rows.map((row, i) => (
            <div key={i} style={{ flex: 1, background: '#11161e', border: `2px solid ${medals[i]}`, borderRadius: 14, padding: '24px 26px', marginRight: i === 2 ? 0 : px(height, 40 / 480), animation: animOn ? `celOtherSlideR 0.4s ${i * 0.18}s both` : undefined }}>
              <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 80 / 480), color: medals[i], lineHeight: 1 }}>#{row.pos}</div>
              <div style={{ fontWeight: 800, fontSize: px(height, 46 / 480), lineHeight: 1.1 }}>{row.name}</div>
              <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 24 / 480) }}>{row.country}</div>
              <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 60 / 480), color: '#ffd23a' }}>{row.time}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.05, 8), letterSpacing: '0.12em' }}>RESULTS</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.12, event.length + 1), lineHeight: 1.05, color: '#fff', marginTop: px(mh, 0.01) }}>{event}</div>
          <div style={{ display: 'flex', justifyContent: 'center', width: '100%', marginTop: px(mh, 0.04) }}>
            {rows.map((row, i) => (
              <div key={i} style={{ flex: 1, maxWidth: '31%', background: '#11161e', border: `2px solid ${medals[i]}`, borderRadius: 12, padding: `${px(mh, 0.03)}px ${px(mh, 0.025)}px`, marginRight: i === 2 ? 0 : px(width, 0.02), animation: animOn ? `celOtherSlideR 0.4s ${i * 0.18}s both` : undefined, boxSizing: 'border-box' }}>
                <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.09, 4), color: medals[i], lineHeight: 1 }}>#{row.pos}</div>
                <div style={{ fontWeight: 800, fontSize: sceneText(width, mh, 0.055, row.name.length + 1), lineHeight: 1.1, color: '#fff' }}>{row.name}</div>
                <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: sceneText(width, mh, 0.035, 5) }}>{row.country}</div>
                <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.07, row.time.length + 1), color: '#ffd23a' }}>{row.time}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ TRACK · PERSONAL BEST ════════════════ */

export interface TrPersonalBestCfg extends BaseCfg {
  athlete?: string;
  event?: string;
  time?: string;
  delta?: string;
}

export function TrPersonalBestWidget({ config, live = true, height = 480 }: WidgetProps<TrPersonalBestCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#001a08', textColor: '#22c55e', accentColor: '#fff', borderColor: '#22c55e', ...c.style });
  const animOn = r.anim.on && live;
  const athlete = c.athlete ?? 'RICHARDSON';
  const event = c.event ?? '100M';
  const time = c.time ?? '10.65';
  const delta = c.delta ?? '-0.18';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <SparkRain on={animOn} color="#22c55e" count={100} kf="celOtherSpark" />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#22c55e', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.14em' }}>PERSONAL BEST</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{athlete}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#22c55e', fontWeight: 800, fontSize: px(height, 40 / 480) }}>{event}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 300 / 480), color: '#22c55e', textShadow: '0 0 60px #22c55e', lineHeight: 0.9 }}>{time}</div>
          </div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 140 / 480), color: '#22c55e' }}>{delta}</div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#22c55e', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 14), letterSpacing: '0.14em' }}>PERSONAL BEST</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.12, athlete.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.02) }}>{athlete}</div>
          <div style={{ color: '#22c55e', fontWeight: 800, fontSize: sceneText(width, mh, 0.06, event.length + 1), marginTop: px(mh, 0.03) }}>{event}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.24, 0.15), color: '#22c55e', textShadow: '0 0 60px #22c55e', lineHeight: 0.9, marginTop: px(mh, 0.012) }}>{time}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.08, delta.length + 1), color: '#22c55e', marginTop: px(mh, 0.02) }}>{delta}</div>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
 *  SWIMMING — 3 celebrations
 * ════════════════════════════════════════════════════════════ */

/* ════════════════ SWIMMING · WORLD RECORD ════════════════ */

export interface SwRecordCfg extends BaseCfg {
  athlete?: string;
  event?: string;
  time?: string;
}

export function SwRecordWidget({ config, live = true, height = 480 }: WidgetProps<SwRecordCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#02143d', textColor: '#fff', accentColor: '#ffd23a', borderColor: '#ffd23a', ...c.style });
  const animOn = r.anim.on && live;
  const athlete = c.athlete ?? 'LEDECKY';
  const event = c.event ?? '1500M';
  const time = c.time ?? '15:20.48';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'repeating-linear-gradient(0deg, #02143d 0 70px, #0a4a8a 70px 74px)' }} />
      <SparkRain on={animOn} color="#ffd23a" count={120} kf="celOtherSpark" />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.14em' }}>WORLD RECORD!</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{athlete}</div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 50 / 480) }}>{event}</div>
          </div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 280 / 480), color: '#ffd23a', textShadow: '0 0 60px #ffd23a' }}>{time}</div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 14), letterSpacing: '0.14em' }}>WORLD RECORD!</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.12, athlete.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.02) }}>{athlete}</div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.06, event.length + 1), marginTop: px(mh, 0.025) }}>{event}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.24, 0.13), color: '#ffd23a', textShadow: '0 0 60px #ffd23a', marginTop: px(mh, 0.025) }}>{time}</div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ SWIMMING · RACE FINISH ════════════════ */

export interface SwFinishEntry { lane: number; name: string; time: string; }
export interface SwFinishCfg extends BaseCfg {
  event?: string;
  top?: SwFinishEntry[];
}

export function SwFinishWidget({ config, live = true, height = 480 }: WidgetProps<SwFinishCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#02143d', textColor: '#fff', accentColor: '#ffd23a', borderColor: '#fff', ...c.style });
  const event = c.event ?? '100M FREE';
  const top: SwFinishEntry[] = c.top ?? [
    { lane: 4, name: 'DRESSEL', time: '47.02' },
    { lane: 5, name: 'CHALMERS', time: '47.51' },
    { lane: 3, name: 'BRUSEMI', time: '47.78' },
  ];
  const medals = ['#ffd23a', '#9aa3b2', '#cd7f32'];
  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);
  const rows = top.slice(0, 3);

  return (
    <div ref={ref} style={frameStyle(r)}>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'repeating-linear-gradient(0deg, #02143d 0 70px, #0a4a8a 70px 74px)' }} />
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 60 / 480)}px`, display: 'flex', alignItems: 'center', color: '#fff' }}>
          <div style={{ flex: '0 0 22%', marginRight: px(height, 40 / 480) }}>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 30 / 480), letterSpacing: '0.12em' }}>FINAL</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 80 / 480), lineHeight: 1 }}>{event}</div>
          </div>
          {rows.map((row, i) => (
            <div key={i} style={{ flex: 1, background: '#0a2444', border: `2px solid ${medals[i]}`, borderRadius: 14, padding: '24px 26px', marginRight: i === 2 ? 0 : px(height, 40 / 480) }}>
              <div style={{ color: medals[i], fontWeight: 800, fontSize: px(height, 40 / 480), letterSpacing: '0.06em' }}>LANE {row.lane}</div>
              <div style={{ fontWeight: 800, fontSize: px(height, 50 / 480), lineHeight: 1.1 }}>{row.name}</div>
              <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 80 / 480), color: '#ffd23a' }}>{row.time}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.05, 7), letterSpacing: '0.12em' }}>FINAL</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.12, event.length + 1), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.01) }}>{event}</div>
          <div style={{ display: 'flex', justifyContent: 'center', width: '100%', marginTop: px(mh, 0.04) }}>
            {rows.map((row, i) => (
              <div key={i} style={{ flex: 1, maxWidth: '31%', background: '#0a2444', border: `2px solid ${medals[i]}`, borderRadius: 12, padding: `${px(mh, 0.03)}px ${px(mh, 0.025)}px`, marginRight: i === 2 ? 0 : px(width, 0.02), boxSizing: 'border-box' }}>
                <div style={{ color: medals[i], fontWeight: 800, fontSize: sceneText(width, mh, 0.045, 8), letterSpacing: '0.06em' }}>LANE {row.lane}</div>
                <div style={{ fontWeight: 800, fontSize: sceneText(width, mh, 0.06, row.name.length + 1), lineHeight: 1.1, color: '#fff' }}>{row.name}</div>
                <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.085, row.time.length + 1), color: '#ffd23a' }}>{row.time}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ SWIMMING · SPLIT MILESTONE ════════════════ */

export interface SwSplitCfg extends BaseCfg {
  athlete?: string;
  split?: string;
  vsWR?: string;
  lap?: number;
}

export function SwSplitWidget({ config, live = true, height = 480 }: WidgetProps<SwSplitCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a4a8a', textColor: '#fff', accentColor: '#22c55e', borderColor: '#ffd23a', ...c.style });
  const athlete = c.athlete ?? 'PHELPS';
  const split = c.split ?? '1:55.31';
  const vsWR = c.vsWR ?? '-0.42';
  const lap = c.lap ?? 3;

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  return (
    <div ref={ref} style={frameStyle(r)}>
      <Vignette />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.14em' }}>LAP {lap} SPLIT</div>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 160 / 480), lineHeight: 1 }}>{athlete}</div>
          </div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 280 / 480), color: '#ffd23a', textShadow: '0 0 60px #ffd23a' }}>{split}</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#22c55e', fontWeight: 800, fontSize: px(height, 46 / 480) }}>VS WR PACE</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 120 / 480), color: '#22c55e', textShadow: '0 0 40px #22c55e' }}>{vsWR}</div>
          </div>
        </div>
      ) : (
        <div style={sceneWrap}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 12), letterSpacing: '0.14em' }}>LAP {lap} SPLIT</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: sceneText(width, mh, 0.11, athlete.length), lineHeight: 1, color: '#fff', marginTop: px(mh, 0.02) }}>{athlete}</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.24, 0.14), color: '#ffd23a', textShadow: '0 0 60px #ffd23a', marginTop: px(mh, 0.03) }}>{split}</div>
          <div style={{ color: '#22c55e', fontWeight: 800, fontSize: sceneText(width, mh, 0.06, 11), marginTop: px(mh, 0.025) }}>VS WR PACE</div>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneText(width, mh, 0.1, vsWR.length + 1), color: '#22c55e', textShadow: '0 0 40px #22c55e', marginTop: px(mh, 0.012) }}>{vsWR}</div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * T1-5: STATUS-TRANSITION CINEMATICS
 * Three widgets fired automatically by the Sports engine on key
 * game-state changes so every surface gets a visual cue without
 * the operator remembering to press a button.
 * ══════════════════════════════════════════════════════════════════ */

/** Shared keyframe block injected once per render. */
function StatusKeyframes() {
  return (
    <style>{`
      @keyframes celStatusPulse  { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }
      @keyframes celStatusFadeUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
      @keyframes celStatusShine  { 0%{transform:translateX(-120%) skewX(-18deg)} 100%{transform:translateX(220%) skewX(-18deg)} }
      @keyframes celStatusFlash  { 0%,100%{opacity:1} 50%{opacity:0.25} }
      @keyframes celStatusRing   { from{transform:scale(0.6);opacity:0.9} to{transform:scale(2.4);opacity:0} }
      @keyframes celConfetti     { from{transform:translateY(-120%)} to{transform:translateY(110%)} }
    `}</style>
  );
}

/* ════════════════ HALFTIME BREAK ════════════════ */

export interface CelHalftimeCfg extends BaseCfg {
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: number;
  awayScore?: number;
  homeColor?: string;
  awayColor?: string;
}

/** ~4 s cinematic: team scores flanking a big HALFTIME headline. */
export function CelHalftimeWidget({ config }: WidgetProps<CelHalftimeCfg>) {
  const c = config ?? {};
  const homeTeam  = c.homeTeam  ?? 'EAGLES';
  const awayTeam  = c.awayTeam  ?? 'HAWKS';
  const homeScore = c.homeScore ?? 0;
  const awayScore = c.awayScore ?? 0;
  const homeColor = c.homeColor ?? '#2563eb';
  const awayColor = c.awayColor ?? '#dc2626';

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  const bg = 'linear-gradient(135deg,#0d0d1a 0%,#1a1a2e 60%,#0d0d1a 100%)';

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%', background: bg, overflow: 'hidden', fontFamily: PJS }}>
      <StatusKeyframes />
      {/* grid overlay */}
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px)', backgroundSize: '48px 48px', pointerEvents: 'none' }} />
      {/* shine sweep */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, width: '30%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)', animation: `celStatusShine 3s ease-in-out infinite`, pointerEvents: 'none' }} />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${px(mh, 80 / 480)}px` }}>
          {/* Home */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', animation: 'celStatusFadeUp 0.5s ease forwards' }}>
            <div style={{ color: homeColor, fontWeight: 800, fontSize: px(mh, 54 / 480), letterSpacing: '0.12em' }}>{homeTeam}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(mh, 260 / 480), color: '#fff', lineHeight: 0.9, textShadow: `0 0 80px ${homeColor}` }}>{homeScore}</div>
          </div>
          {/* Center headline */}
          <div style={{ textAlign: 'center', animation: 'celStatusFadeUp 0.6s ease forwards' }}>
            <div style={{ fontWeight: 900, fontSize: px(mh, 80 / 480), letterSpacing: '0.18em', background: 'linear-gradient(135deg,#ffd23a,#ff8c00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>HALFTIME</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: px(mh, 36 / 480), letterSpacing: '0.22em', marginTop: px(mh, 8 / 480) }}>BREAK · REST UP</div>
          </div>
          {/* Away */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', animation: 'celStatusFadeUp 0.5s ease forwards' }}>
            <div style={{ color: awayColor, fontWeight: 800, fontSize: px(mh, 54 / 480), letterSpacing: '0.12em' }}>{awayTeam}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(mh, 260 / 480), color: '#fff', lineHeight: 0.9, textShadow: `0 0 80px ${awayColor}` }}>{awayScore}</div>
          </div>
        </div>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: `0 ${px(mh, 0.05)}px` }}>
          <div style={{ fontWeight: 900, fontSize: sceneText(width, mh, 0.13, 8), letterSpacing: '0.18em', background: 'linear-gradient(135deg,#ffd23a,#ff8c00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>HALFTIME</div>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: px(mh, 0.04) }}>
            <div style={{ textAlign: 'center', marginRight: px(mh, 0.06) }}>
              <div style={{ color: homeColor, fontWeight: 800, fontSize: sceneText(width, mh, 0.055, homeTeam.length) }}>{homeTeam}</div>
              <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.22, 0.14), color: '#fff', textShadow: `0 0 60px ${homeColor}` }}>{homeScore}</div>
            </div>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 3) }}>·</div>
            <div style={{ textAlign: 'center', marginLeft: px(mh, 0.06) }}>
              <div style={{ color: awayColor, fontWeight: 800, fontSize: sceneText(width, mh, 0.055, awayTeam.length) }}>{awayTeam}</div>
              <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.22, 0.14), color: '#fff', textShadow: `0 0 60px ${awayColor}` }}>{awayScore}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ FINAL — GAME OVER ════════════════ */

export interface CelFinalCfg extends BaseCfg {
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: number;
  awayScore?: number;
  homeColor?: string;
  awayColor?: string;
  winner?: 'home' | 'away' | 'tie';
}

/** ~5 s cinematic: winner pulses with confetti, loser dims. */
export function CelFinalWidget({ config }: WidgetProps<CelFinalCfg>) {
  const c = config ?? {};
  const homeTeam  = c.homeTeam  ?? 'EAGLES';
  const awayTeam  = c.awayTeam  ?? 'HAWKS';
  const homeScore = c.homeScore ?? 0;
  const awayScore = c.awayScore ?? 0;
  const homeColor = c.homeColor ?? '#2563eb';
  const awayColor = c.awayColor ?? '#dc2626';
  const winner    = c.winner    ?? (homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'tie');

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  const winColor = winner === 'home' ? homeColor : winner === 'away' ? awayColor : '#ffd23a';
  const homeOpacity = winner === 'away' ? 0.38 : 1;
  const awayOpacity = winner === 'home' ? 0.38 : 1;

  // Confetti strips in winner color
  const confetti = Array.from({ length: 14 }, (_, i) => (
    <div key={i} style={{
      position: 'absolute',
      top: 0,
      left: `${(i / 14) * 100}%`,
      width: `${px(mh, 3 / 480)}px`,
      height: `${px(mh, 40 / 480)}px`,
      background: i % 2 === 0 ? winColor : '#ffd23a',
      opacity: 0.7,
      animation: `celConfetti ${1.2 + (i % 5) * 0.28}s linear ${(i % 7) * 0.18}s infinite`,
      borderRadius: 2,
    }} />
  ));

  const homeWins = winner === 'home';
  const awayWins = winner === 'away';

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%', background: 'radial-gradient(ellipse at center,#1a0a2e 0%,#0a0a14 70%)', overflow: 'hidden', fontFamily: PJS }}>
      <StatusKeyframes />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden', pointerEvents: 'none' }}>{confetti}</div>
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${px(mh, 80 / 480)}px` }}>
          {/* Home */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: homeOpacity, animation: homeWins ? 'celStatusPulse 1.2s ease infinite' : undefined }}>
            <div style={{ color: homeColor, fontWeight: 800, fontSize: px(mh, 54 / 480), letterSpacing: '0.12em' }}>{homeTeam}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(mh, 260 / 480), color: '#fff', lineHeight: 0.9, textShadow: homeWins ? `0 0 100px ${homeColor}` : 'none' }}>{homeScore}</div>
            {homeWins && <div style={{ color: homeColor, fontWeight: 800, fontSize: px(mh, 40 / 480), letterSpacing: '0.2em', marginTop: px(mh, 8 / 480) }}>WINNER</div>}
          </div>
          {/* Center */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 900, fontSize: px(mh, 90 / 480), letterSpacing: '0.18em', background: 'linear-gradient(135deg,#ffd23a,#ff8c00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>FINAL</div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 600, fontSize: px(mh, 34 / 480), letterSpacing: '0.22em', marginTop: px(mh, 6 / 480) }}>
              {winner === 'tie' ? 'TIED · GAME OVER' : 'GAME OVER'}
            </div>
          </div>
          {/* Away */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: awayOpacity, animation: awayWins ? 'celStatusPulse 1.2s ease infinite' : undefined }}>
            <div style={{ color: awayColor, fontWeight: 800, fontSize: px(mh, 54 / 480), letterSpacing: '0.12em' }}>{awayTeam}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(mh, 260 / 480), color: '#fff', lineHeight: 0.9, textShadow: awayWins ? `0 0 100px ${awayColor}` : 'none' }}>{awayScore}</div>
            {awayWins && <div style={{ color: awayColor, fontWeight: 800, fontSize: px(mh, 40 / 480), letterSpacing: '0.2em', marginTop: px(mh, 8 / 480) }}>WINNER</div>}
          </div>
        </div>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: `0 ${px(mh, 0.05)}px` }}>
          <div style={{ fontWeight: 900, fontSize: sceneText(width, mh, 0.15, 5), letterSpacing: '0.18em', background: 'linear-gradient(135deg,#ffd23a,#ff8c00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>FINAL</div>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: px(mh, 0.04) }}>
            <div style={{ textAlign: 'center', opacity: homeOpacity, marginRight: px(mh, 0.06), animation: homeWins ? 'celStatusPulse 1.2s ease infinite' : undefined }}>
              <div style={{ color: homeColor, fontWeight: 800, fontSize: sceneText(width, mh, 0.055, homeTeam.length) }}>{homeTeam}</div>
              <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.22, 0.14), color: '#fff', textShadow: homeWins ? `0 0 80px ${homeColor}` : 'none' }}>{homeScore}</div>
            </div>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 800, fontSize: sceneText(width, mh, 0.07, 3) }}>·</div>
            <div style={{ textAlign: 'center', opacity: awayOpacity, marginLeft: px(mh, 0.06), animation: awayWins ? 'celStatusPulse 1.2s ease infinite' : undefined }}>
              <div style={{ color: awayColor, fontWeight: 800, fontSize: sceneText(width, mh, 0.055, awayTeam.length) }}>{awayTeam}</div>
              <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: sceneHero(width, mh, 0.22, 0.14), color: '#fff', textShadow: awayWins ? `0 0 80px ${awayColor}` : 'none' }}>{awayScore}</div>
            </div>
          </div>
          {winner !== 'tie' && (
            <div style={{ color: winColor, fontWeight: 800, fontSize: sceneText(width, mh, 0.065, 6), letterSpacing: '0.22em', marginTop: px(mh, 0.04) }}>WINNER</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ════════════════ HORN / PERIOD END ════════════════ */

export interface CelHornCfg extends BaseCfg {
  segmentLabel?: string;
}

/**
 * ~1.5 s urgent burst: red shockwave rings + flashing HORN text.
 * `segmentLabel` comes from the CUE payload's `segmentLabel` field
 * (e.g. "Q1", "P2", "OT"). Math.ceil is not needed here because this
 * widget shows a segment name, not a live clock reading — the
 * 2026-05-27 clock-rounding rule applies to countdown digits only.
 */
export function CelHornWidget({ config }: WidgetProps<CelHornCfg>) {
  const c = config ?? {};
  const rawLabel   = String(c.segmentLabel ?? 'Q1').trim().toUpperCase();
  const segDisplay = rawLabel.endsWith('END') ? rawLabel : `${rawLabel} END`;

  const { ref, width, height: mh } = useElementSize<HTMLDivElement>();
  const wide = isWide(width, mh);

  const bg = 'radial-gradient(ellipse at center,#3b0a0a 0%,#0a0000 70%)';

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%', background: bg, overflow: 'hidden', fontFamily: PJS }}>
      <StatusKeyframes />
      {/* Shockwave rings */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: `${px(mh, 120 / 480)}px`, height: `${px(mh, 120 / 480)}px`, marginLeft: `-${px(mh, 60 / 480)}px`, marginTop: `-${px(mh, 60 / 480)}px`, border: '3px solid rgba(220,38,38,0.8)', borderRadius: '50%', animation: 'celStatusRing 1.2s ease-out infinite', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: `${px(mh, 120 / 480)}px`, height: `${px(mh, 120 / 480)}px`, marginLeft: `-${px(mh, 60 / 480)}px`, marginTop: `-${px(mh, 60 / 480)}px`, border: '2px solid rgba(220,38,38,0.5)', borderRadius: '50%', animation: 'celStatusRing 1.2s ease-out 0.4s infinite', pointerEvents: 'none' }} />
      {wide ? (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${px(mh, 80 / 480)}px` }}>
          <div style={{ fontWeight: 900, fontSize: px(mh, 200 / 480), letterSpacing: '0.06em', color: '#ef4444', animation: 'celStatusFlash 0.5s step-end 3' }}>HORN</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 800, fontSize: px(mh, 70 / 480), color: 'rgba(255,255,255,0.7)', letterSpacing: '0.14em' }}>{segDisplay}</div>
            <div style={{ fontWeight: 600, fontSize: px(mh, 44 / 480), color: 'rgba(255,255,255,0.4)', letterSpacing: '0.22em', marginTop: px(mh, 6 / 480) }}>PERIOD OVER</div>
          </div>
        </div>
      ) : (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontWeight: 900, fontSize: sceneText(width, mh, 0.26, 4), letterSpacing: '0.06em', color: '#ef4444', animation: 'celStatusFlash 0.5s step-end 3' }}>HORN</div>
          <div style={{ fontWeight: 800, fontSize: sceneText(width, mh, 0.1, segDisplay.length), color: 'rgba(255,255,255,0.8)', letterSpacing: '0.14em', marginTop: px(mh, 0.03) }}>{segDisplay}</div>
        </div>
      )}
    </div>
  );
}
