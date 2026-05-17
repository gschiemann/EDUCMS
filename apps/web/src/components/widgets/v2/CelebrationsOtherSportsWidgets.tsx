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

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

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

  return (
    <div style={frameStyle(r)}>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'repeating-linear-gradient(0deg, #0a3015 0 4px, #0d3a1a 4px 8px)' }} />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#ff00ff" />
      <Vignette />
      <svg viewBox="0 0 7680 480" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}>
        <path d="M 200 400 Q 3000 -800 6800 380" stroke="#00ffff" strokeWidth="28" fill="none" strokeDasharray="600" style={{ filter: 'drop-shadow(0 0 30px #00ffff)', animation: animOn ? 'celOtherSwoosh 1.5s ease-out infinite' : undefined }} />
      </svg>
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#00ffff" />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#ff00ff" />
      <SparkRain on={animOn} color="#00ffff" count={80} kf="celOtherSpark" />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'radial-gradient(ellipse at center, #5a3d1f 0%, #1a0d00 70%)' }} />
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.15, backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 3px, #d4a36a 3px 4px)' }} />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#00ffff" />
      <Vignette />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
        <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 440 / 480), lineHeight: 0.85, color: '#00ffff', textShadow: '0 0 60px #00ffff, 0 0 120px #00ffff, 0 0 200px #ff00ff' }}>3</div>
        <div>
          <div style={{ color: '#ff00ff', fontWeight: 800, fontSize: px(height, 60 / 480), letterSpacing: '0.14em', textShadow: '0 0 30px #ff00ff' }}>FROM DOWNTOWN</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 240 / 480), lineHeight: 1 }}>{player}</div>
        </div>
        <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 220 / 480), color: '#ffd23a', textShadow: '0 0 30px #ffd23a' }}>{threeCount}</div>
      </div>
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <StripeFly on={animOn} from="#dc2626" to="#000" kf="celOtherStripeFly" speedSec={2} />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#ff00aa" />
      <Vignette />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
        <div style={{ animation: animOn ? 'celOtherBassThump 0.4s infinite' : undefined }}>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 320 / 480), lineHeight: 0.85, color: '#ff00aa', textShadow: '0 0 60px #ff00aa, 0 0 120px #ff00aa, 0 0 200px #00ffff', letterSpacing: '-0.04em' }}>GOAL.</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#00ffff', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.14em', textShadow: '0 0 20px #00ffff' }}>LAMP IS LIT</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 240 / 480), lineHeight: 1 }}>{scorer}</div>
        </div>
      </div>
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

  return (
    <div style={frameStyle(r)}>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'radial-gradient(ellipse at center, #3a1d0d 0%, #1a0d05 70%)' }} />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'repeating-linear-gradient(90deg, #0a3a0d 0 4px, #0d3f10 4px 8px)' }} />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#00ff66" />
      <WordEcho on={animOn} word="GOAL!" color="#00ff66" size={260} height={height} />
      <Vignette />
      <div style={{ position: 'absolute', bottom: px(height, 30 / 480), left: px(height, 80 / 480), right: px(height, 80 / 480), display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', color: '#fff' }}>
        <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 80 / 480), color: '#ff00aa', textShadow: '0 0 20px #ff00aa' }}>{minute}</div>
        <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 160 / 480), color: '#00ffff', textShadow: '0 0 40px #00ffff' }}>{scorer}</div>
      </div>
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <Vignette />
      <svg viewBox="0 0 7680 480" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}>
        <rect x="0" y="200" width="7680" height="4" fill="#fff" opacity=".5" />
        <rect x="0" y="280" width="7680" height="4" fill="#fff" opacity=".5" />
        <path d="M 600 200 L 6900 380" stroke="#ffd23a" strokeWidth="18" fill="none" strokeDasharray="600" style={{ filter: 'drop-shadow(0 0 20px #ffd23a)', animation: animOn ? 'celOtherSwoosh 1s linear infinite' : undefined }} />
        <circle cx="6900" cy="380" r="32" fill="#ffd23a" />
      </svg>
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <NeonGrid on={animOn} color="#00ffff" />
      <Vignette />
      <svg viewBox="0 0 7680 480" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}>
        <path d="M 500 200 L 7000 380" stroke="#ff00ff" strokeWidth="24" fill="none" strokeDasharray="600" style={{ filter: 'drop-shadow(0 0 40px #ff00ff)', animation: animOn ? 'celOtherSwoosh 0.8s linear infinite' : undefined }} />
        <circle cx="7000" cy="380" r="60" fill="#00ffff" style={{ filter: 'drop-shadow(0 0 40px #00ffff)' }} />
      </svg>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
        <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 340 / 480), lineHeight: 0.9, color: '#00ffff', textShadow: '0 0 60px #00ffff, 0 0 120px #ff00ff' }}>ACE</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 160 / 480), color: '#ff00ff', textShadow: '0 0 30px #ff00ff' }}>{speed}</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{player}</div>
        </div>
      </div>
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <StripeFly on={animOn} from="#dc2626" to="#000" kf="celOtherStripeFly" speedSec={2} />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'radial-gradient(ellipse at center, #ffd23a22, transparent 60%)', animation: animOn ? 'celOtherPulse 1s infinite' : undefined }} />
      <SparkRain on={animOn} color="#ffd23a" count={100} kf="celOtherSpark" />
      <Vignette />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
        <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 300 / 480), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 80px #ffd23a, 0 0 160px #ffd23a44' }}>MATCH POINT</div>
        <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 280 / 480), color: '#fff', textShadow: '0 0 30px #fff' }}>{score}</div>
        <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 160 / 480), lineHeight: 1 }}>{player}</div>
      </div>
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <Vignette />
      <svg viewBox="0 0 7680 480" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}>
        <path d="M 6800 60 L 6800 420 M 6700 60 L 6900 60 M 6700 420 L 6900 420" stroke="#fff" strokeWidth="4" />
        <path d="M 700 120 Q 3500 60 6800 380" stroke="#ffd23a" strokeWidth="18" strokeDasharray="40 25" fill="none" style={{ animation: animOn ? 'celOtherSwoosh 1.4s linear infinite' : undefined }} />
      </svg>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', color: '#fff' }}>
        <div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.1em' }}>{shot} WINNER</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 300 / 480), lineHeight: 0.9, color: '#ffd23a', textShadow: '0 0 60px #ffd23a' }}>PAINTED IT.</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 140 / 480), lineHeight: 1 }}>{player} · {winners} winners</div>
        </div>
      </div>
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <StripeFly on={animOn} from="#003a14" to="#000" kf="celOtherStripeFly" speedSec={3} />
      <SparkRain on={animOn} color="#ffd23a" count={100} kf="celOtherSpark" />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <SparkRain on={animOn} color="#ffd23a" count={130} kf="celOtherSpark" />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <ArrowSweep on={animOn} color="#ffd23a" count={6} duration={1.8} kf="celOtherArrowSweep" />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <StripeFly on={animOn} from="#1a1500" to="#000" kf="celOtherStripeFly" speedSec={3} />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <SparkRain on={animOn} color="#ffd23a" count={120} kf="celOtherSpark" />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <SparkRain on={animOn} color="#ffd23a" count={200} kf="celOtherSpark" />
      <Vignette />
      <svg viewBox="0 0 7680 480" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}>
        <path d="M 400 380 Q 3500 -200 6900 280" stroke="#fff" strokeWidth="14" fill="none" strokeDasharray="20 30" style={{ animation: animOn ? 'celOtherSwoosh 2s linear infinite' : undefined }} />
        <circle cx="6900" cy="280" r="40" fill="#fff" />
        <line x1="6900" y1="280" x2="6900" y2="80" stroke="#dc2626" strokeWidth="8" />
        <polygon points="6900,80 7000,90 6900,110" fill="#dc2626" />
      </svg>
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

  return (
    <div style={frameStyle(r)}>
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <StripeFly on={animOn} from="#dc2626" to="#000" kf="celOtherStripeFly" speedSec={1.6} />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <SparkRain on={animOn} color="#ffd23a" count={200} kf="celOtherSpark" />
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'radial-gradient(ellipse at center, #ffd23a44 0%, transparent 60%)', animation: animOn ? 'celOtherPulse 1s infinite' : undefined }} />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <Vignette />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 60 / 480)}px`, display: 'flex', alignItems: 'center', color: '#fff' }}>
        <div style={{ flex: '0 0 22%', marginRight: px(height, 40 / 480) }}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 30 / 480), letterSpacing: '0.12em' }}>RESULTS</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 60 / 480), lineHeight: 1.05 }}>{event}</div>
        </div>
        {top.slice(0, 3).map((row, i) => (
          <div key={i} style={{ flex: 1, background: '#11161e', border: `2px solid ${medals[i]}`, borderRadius: 14, padding: '24px 26px', marginRight: i === 2 ? 0 : px(height, 40 / 480), animation: animOn ? `celOtherSlideR 0.4s ${i * 0.18}s both` : undefined }}>
            <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 80 / 480), color: medals[i], lineHeight: 1 }}>#{row.pos}</div>
            <div style={{ fontWeight: 800, fontSize: px(height, 46 / 480), lineHeight: 1.1 }}>{row.name}</div>
            <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 24 / 480) }}>{row.country}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 60 / 480), color: '#ffd23a' }}>{row.time}</div>
          </div>
        ))}
      </div>
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <SparkRain on={animOn} color="#22c55e" count={100} kf="celOtherSpark" />
      <Vignette />
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

  return (
    <div style={frameStyle(r)}>
      {animOn && <RibbonKeyframes />}
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'repeating-linear-gradient(0deg, #02143d 0 70px, #0a4a8a 70px 74px)' }} />
      <SparkRain on={animOn} color="#ffd23a" count={120} kf="celOtherSpark" />
      <Vignette />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 80 / 480)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
        <div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 54 / 480), letterSpacing: '0.14em' }}>WORLD RECORD!</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 200 / 480), lineHeight: 1 }}>{athlete}</div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 50 / 480) }}>{event}</div>
        </div>
        <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 280 / 480), color: '#ffd23a', textShadow: '0 0 60px #ffd23a' }}>{time}</div>
      </div>
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

  return (
    <div style={frameStyle(r)}>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'repeating-linear-gradient(0deg, #02143d 0 70px, #0a4a8a 70px 74px)' }} />
      <Vignette />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `0 ${px(height, 60 / 480)}px`, display: 'flex', alignItems: 'center', color: '#fff' }}>
        <div style={{ flex: '0 0 22%', marginRight: px(height, 40 / 480) }}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 30 / 480), letterSpacing: '0.12em' }}>FINAL</div>
          <div style={{ fontFamily: PJS, fontWeight: 800, fontSize: px(height, 80 / 480), lineHeight: 1 }}>{event}</div>
        </div>
        {top.slice(0, 3).map((row, i) => (
          <div key={i} style={{ flex: 1, background: '#0a2444', border: `2px solid ${medals[i]}`, borderRadius: 14, padding: '24px 26px', marginRight: i === 2 ? 0 : px(height, 40 / 480) }}>
            <div style={{ color: medals[i], fontWeight: 800, fontSize: px(height, 40 / 480), letterSpacing: '0.06em' }}>LANE {row.lane}</div>
            <div style={{ fontWeight: 800, fontSize: px(height, 50 / 480), lineHeight: 1.1 }}>{row.name}</div>
            <div style={{ fontFamily: JBM, fontWeight: 800, fontSize: px(height, 80 / 480), color: '#ffd23a' }}>{row.time}</div>
          </div>
        ))}
      </div>
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

  return (
    <div style={frameStyle(r)}>
      <Vignette />
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
    </div>
  );
}
