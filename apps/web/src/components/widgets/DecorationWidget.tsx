"use client";

/**
 * DecorationWidget — drag-and-drop animated decorations.
 *
 * Operator picks a `variant` (confetti, ribbon, balloons, clouds,
 * sparkles, ticker, neon-buzz, pulse-glow) from the Decorations
 * section in the Widgets palette. The widget auto-scales to fill
 * its zone — operators can resize freely. No data sources, no
 * external dependencies, no risk to existing widgets. CSS keyframes
 * + transform: scale, GPU-accelerated, 60fps on a Pi 4.
 *
 * Why this exists:
 *   The signature animations (rainbow ribbon slide, confetti fall,
 *   balloon rise, ticker scroll, neon buzz) used to be locked inside
 *   themed widgets like AnimatedWelcomeWidget — operators couldn't
 *   pull them into custom layouts. This widget extracts each as a
 *   resizable decoration that overlays any existing canvas.
 *
 * Z-index hint:
 *   Most variants look best at low zIndex (background ambient effects)
 *   but a few (confetti / sparkles) work at high zIndex as foreground
 *   spice. The operator decides via the existing zone z-index control.
 *
 * Performance:
 *   - Particle counts capped: confetti ≤ 80, sparkles ≤ 40, balloons ≤ 12.
 *     A Raspberry Pi 4 holds 60 fps with all three on screen at once.
 *   - All animations use `transform` + `opacity` (GPU-cheap) — never
 *     animate `left/top/width` (CPU layout thrash).
 *   - Each particle's keyframe is randomized at mount so the field
 *     doesn't look like a marching grid.
 *
 * Sizing:
 *   The widget queries its own bounding rect (no external scaler
 *   needed) and renders particles into that exact box. Resizing the
 *   zone re-paints automatically through ResizeObserver.
 *
 * APPROVED 2026-04-27 — drop-in friendly, 8 standalone variants.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { sceneCss } from './scene-css';

export type DecorationVariant =
  | 'confetti'
  | 'rainbow-ribbon'
  | 'balloons'
  | 'clouds'
  | 'sparkles'
  | 'ticker'
  | 'neon-buzz'
  | 'pulse-glow';

export interface DecorationConfig {
  variant?: DecorationVariant;
  // Per-variant tuning — all optional with sane defaults.
  count?: number;          // particle count (variants that have particles)
  speed?: number;          // 0.5 (slow) → 2 (fast)
  colors?: string[];       // override palette
  text?: string;           // ticker / neon variants
  glowColor?: string;      // pulse-glow / neon-buzz
  opacity?: number;        // 0–1 (default 1)
  /**
   * The picker sets this on the thumbnail mount. See THUMBNAIL MODE below —
   * it is not a style flag, it is "there is no time axis here".
   */
  _thumb?: boolean;
}

/**
 * ── THUMBNAIL MODE (2026-09-12) ──────────────────────────────────────
 * Operator: *"the confetti one isnt vidsible."* They were right, and the cause
 * is structural rather than cosmetic: SIX of these eight variants begin their
 * animation OUTSIDE the frame — confetti parked at `top: -10%` behind delays of
 * up to 4s, the ribbon at `translateX(-100%)`, balloons below the floor, clouds
 * at `left: -30%` on a 60–90s drift, the ticker off the right edge. On a wall
 * that is correct: the effect enters, and the operator watches it for minutes.
 * In a 185x116 picker tile it means the box is EMPTY at the moment anyone looks,
 * so the operator is asked to choose a decoration they have never seen.
 *
 * `_thumb` therefore renders a still, representative FRAME — every particle
 * already in the box, nothing animating. A thumbnail has no time axis; pretending
 * it does is how a tile ends up blank.
 *
 * Graded by `tools/widget-legibility/measure-tiles.mjs`, which screenshots each
 * tile and reports the fraction of the box actually painted. Pixels, not a DOM
 * proxy — a DOM walk counts the particles as "painted" whether or not a single
 * one is inside the frame, which is exactly how this shipped.
 */


const DEFAULT_CONFETTI_COLORS = ['#fbbf24', '#f472b6', '#a78bfa', '#34d399', '#60a5fa', '#fb7185'];
const DEFAULT_BALLOON_COLORS = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#fb7185'];
const DEFAULT_RIBBON_COLORS = ['#ef4444', '#f97316', '#fbbf24', '#22c55e', '#3b82f6', '#a855f7'];

/** Thumbnail-only ground per variant — see the note at the render site. */
const THUMB_GROUND: Record<string, string> = {
  confetti: 'linear-gradient(160deg,#312e81,#1e1b4b)',
  'rainbow-ribbon': 'linear-gradient(160deg,#0f172a,#1e293b)',
  balloons: 'linear-gradient(180deg,#e0f2fe,#f8fafc)',
  clouds: 'linear-gradient(180deg,#38bdf8,#bae6fd)',
  sparkles: 'linear-gradient(160deg,#1e1b4b,#312e81)',
  ticker: 'linear-gradient(160deg,#0f172a,#312e81)',
  'neon-buzz': 'linear-gradient(160deg,#0b1120,#1e1b4b)',
  'pulse-glow': 'linear-gradient(160deg,#0f172a,#1e293b)',
};

export function DecorationWidget({ config }: { config: DecorationConfig }) {
  // Normalize the variant — VariantPicker registrations namespace the
  // registry id as `decoration-${key}` (Wave B / editor-crush B3,
  // 2026-07-02) and handlePick writes that id into config.variant; the
  // legacy DECORATION_* palette path wrote the bare key. Either way this
  // widget switches on the unprefixed form — same pattern TouchPointWidget
  // established for `touch-*` ids.
  let rawVariant = String(config.variant || 'confetti');
  if (rawVariant.startsWith('decoration-')) rawVariant = rawVariant.slice('decoration-'.length);
  const variant = rawVariant as DecorationVariant;
  const speed = Math.max(0.25, Math.min(4, config.speed ?? 1));
  const opacity = Math.max(0, Math.min(1, config.opacity ?? 1));
  const thumb = config._thumb === true;

  // ResizeObserver — re-render when the zone changes size so particle
  // positions can be re-randomized to fill the new box. Without this,
  // a confetti widget resized small would render most particles outside
  // the viewport.
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="w-full h-full overflow-hidden relative pointer-events-none select-none"
      style={{ opacity }}
    >
      {/* Thumbnail ground. Every one of these variants is an OVERLAY — it is
          designed to sit on top of a board, so on the picker's own pale panel
          white clouds, gold sparkles and white ticker copy are invisible even
          when they render perfectly. The still frame supplies the surface the
          decoration expects; on a real zone the widget stays transparent, as
          an overlay must. */}
      {thumb && (
        <div
          className="absolute top-0 right-0 bottom-0 left-0"
          style={{ background: THUMB_GROUND[variant] || THUMB_GROUND.confetti }}
          aria-hidden
        />
      )}
      {variant === 'confetti'       && <ConfettiVariant       size={size} speed={speed} count={config.count} colors={config.colors} thumb={thumb} />}
      {variant === 'rainbow-ribbon' && <RibbonVariant         speed={speed} colors={config.colors} thumb={thumb} />}
      {variant === 'balloons'       && <BalloonsVariant       size={size} speed={speed} count={config.count} colors={config.colors} thumb={thumb} />}
      {variant === 'clouds'         && <CloudsVariant         size={size} speed={speed} thumb={thumb} />}
      {variant === 'sparkles'       && <SparklesVariant       size={size} speed={speed} count={config.count} thumb={thumb} />}
      {variant === 'ticker'         && <TickerVariant         size={size} speed={speed} text={config.text} colors={config.colors} thumb={thumb} />}
      {variant === 'neon-buzz'      && <NeonBuzzVariant       size={size} text={config.text} glowColor={config.glowColor} thumb={thumb} />}
      {variant === 'pulse-glow'     && <PulseGlowVariant      glowColor={config.glowColor} speed={speed} thumb={thumb} />}

      {/* Per-instance keyframes. Inlined here so the widget is fully
          self-contained — no global stylesheet dependency. The names
          are prefixed `dw-` to avoid collision with the existing
          themed-widget keyframes (`abw-*`, `mn-*`, `bb-*`, etc). */}
      <style>{sceneCss(`
        @keyframes dw-confettiFall {
          0%   { transform: translate3d(0, -10%, 0) rotate(0deg); opacity: 0; }
          10%  { opacity: 1; }
          100% { transform: translate3d(var(--dx, 0), 110%, 0) rotate(720deg); opacity: 0; }
        }
        @keyframes dw-balloonRise {
          0%   { transform: translate3d(0, 110%, 0) rotate(-2deg); }
          50%  { transform: translate3d(var(--dx, 0), 50%, 0) rotate(2deg); }
          100% { transform: translate3d(0, -20%, 0) rotate(-2deg); }
        }
        @keyframes dw-ribbonSlide {
          0%   { transform: translate3d(-100%, 0, 0); }
          100% { transform: translate3d(100%, 0, 0); }
        }
        @keyframes dw-cloudDrift {
          0%   { transform: translate3d(-30%, 0, 0); }
          100% { transform: translate3d(130%, 0, 0); }
        }
        @keyframes dw-sparkleTwinkle {
          0%, 100% { opacity: 0.1; transform: scale(0.6); }
          50%      { opacity: 1;   transform: scale(1.4); }
        }
        @keyframes dw-tickerScroll {
          0%   { transform: translate3d(100%, 0, 0); }
          100% { transform: translate3d(-100%, 0, 0); }
        }
        @keyframes dw-neonBuzz {
          0%, 100% { transform: translate(0, 0); text-shadow: 0 0 12px var(--neon, #f0abfc), 0 0 28px var(--neon, #f0abfc); }
          25%      { transform: translate(0.5px, -0.5px); }
          50%      { transform: translate(-0.5px, 0.5px); text-shadow: 0 0 6px var(--neon, #f0abfc), 0 0 18px var(--neon, #f0abfc); }
          75%      { transform: translate(0.5px, 0.5px); }
        }
        @keyframes dw-pulseGlow {
          0%, 100% { box-shadow: inset 0 0 30px 0 var(--glow, #fbbf2444),  0 0 0 0 var(--glow, #fbbf2444); opacity: 0.6; }
          50%      { box-shadow: inset 0 0 80px 20px var(--glow, #fbbf2466), 0 0 50px 10px var(--glow, #fbbf2466); opacity: 1; }
        }
      `)}</style>
    </div>
  );
}

// ─── Variants ────────────────────────────────────────────────────

function ConfettiVariant({ size, speed, count, colors, thumb }: { size: { w: number; h: number }; speed: number; count?: number; colors?: string[]; thumb?: boolean }) {
  const particles = useMemo(() => {
    const n = Math.max(10, Math.min(80, count ?? 60));
    const palette = colors?.length ? colors : DEFAULT_CONFETTI_COLORS;
    // Particle size scales with the box. A flat 6-16px is a snowstorm in a
    // thumbnail and invisible dust on a 2160px-tall wall — the same literal
    // pixel bug the 4K legibility sweep keeps finding in type.
    const unit = Math.max(60, Math.min(size.w || 0, size.h || 0) || 300);
    return Array.from({ length: n }, (_, i) => ({
      key: i,
      // Start at random horizontal position so the rain is even. Capped at 92%
      // because `left` positions the particle's LEFT edge — at 100% the whole
      // chip sits outside the box, which reads as a clipped mess on a still.
      left: Math.random() * 92,
      // Random horizontal drift so they don't all fall straight down
      dx: (Math.random() - 0.5) * 80,
      // Stagger start so the field doesn't pulse on/off in unison
      delay: Math.random() * 4,
      duration: (3.5 + Math.random() * 3) / speed,
      size: unit * (thumb ? 0.05 + Math.random() * 0.06 : 0.02 + Math.random() * 0.035),
      // A still frame needs every particle ALREADY in the box, spread down
      // its height — the animation is what normally puts them there.
      top: 4 + Math.random() * 88,
      color: palette[i % palette.length],
      rotate: Math.random() * 360,
      shape: Math.random() > 0.5 ? '50%' : '0%',
    }));
  }, [size.w, size.h, count, colors, speed, thumb]);

  return (
    <>
      {particles.map((p) => (
        <span
          key={p.key}
          className="absolute"
          style={{
            top: thumb ? `${p.top}%` : '-10%',
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.5,
            background: p.color,
            borderRadius: p.shape,
            ['--dx' as any]: `${p.dx}px`,
            transform: `rotate(${p.rotate}deg)`,
            animation: thumb ? undefined : `dw-confettiFall ${p.duration}s linear ${p.delay}s infinite`,
          }}
          aria-hidden
        />
      ))}
    </>
  );
}

function RibbonVariant({ speed, colors, thumb }: { speed: number; colors?: string[]; thumb?: boolean }) {
  const palette = colors?.length ? colors : DEFAULT_RIBBON_COLORS;
  const gradient = `linear-gradient(135deg, ${palette.join(', ')})`;
  // A still frame shows the sash where it belongs — parked across the middle.
  // Animating, it enters from `translateX(-100%)`, which is why the picker
  // showed a sliver hanging off the left edge instead of a ribbon.
  if (thumb) {
    return (
      <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center">
        <div className="absolute left-0 right-0 h-[34%]" style={{ background: gradient, opacity: 0.95 }} aria-hidden />
      </div>
    );
  }
  // Two stacked ribbons so the slide loop never has a visible reset.
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center">
      <div className="absolute left-0 right-0 h-[28%]" style={{ background: gradient, opacity: 0.85, animation: `dw-ribbonSlide ${10 / speed}s linear infinite` }} aria-hidden />
      <div className="absolute left-0 right-0 h-[28%]" style={{ background: gradient, opacity: 0.6, transform: 'translateX(-100%)', animation: `dw-ribbonSlide ${10 / speed}s linear ${5 / speed}s infinite` }} aria-hidden />
    </div>
  );
}

function BalloonsVariant({ size, speed, count, colors, thumb }: { size: { w: number; h: number }; speed: number; count?: number; colors?: string[]; thumb?: boolean }) {
  const balloons = useMemo(() => {
    const n = Math.max(3, Math.min(12, count ?? 8));
    const palette = colors?.length ? colors : DEFAULT_BALLOON_COLORS;
    // Was a flat 60-100px: four balloons taller than a 116px thumbnail, and
    // four specks on a 4K wall. Size follows the box.
    const unit = Math.max(80, Math.min(size.w || 0, size.h || 0) || 400);
    return Array.from({ length: n }, (_, i) => ({
      key: i,
      left: 8 + (i * (84 / n)) + (Math.random() - 0.5) * 5,
      dx: (Math.random() - 0.5) * 60,
      delay: Math.random() * 5,
      duration: (12 + Math.random() * 6) / speed,
      size: unit * (0.16 + Math.random() * 0.08),
      // Still frame: staggered heights mid-rise, so the tile reads as a
      // drifting cluster rather than a row parked on the ceiling.
      top: 8 + ((i * 37) % 45),
      color: palette[i % palette.length],
    }));
  }, [size.w, size.h, count, colors, speed]);

  return (
    <>
      {balloons.map((b) => (
        <div
          key={b.key}
          className="absolute"
          style={{
            top: thumb ? `${b.top}%` : 0,
            left: `${b.left}%`,
            width: b.size,
            height: b.size * 1.25,
            ['--dx' as any]: `${b.dx}px`,
            animation: thumb ? undefined : `dw-balloonRise ${b.duration}s ease-in-out ${b.delay}s infinite`,
          }}
          aria-hidden
        >
          {/* Balloon body — radial gradient for a "shiny" look. */}
          <div
            className="rounded-full w-full h-[80%]"
            style={{
              background: `radial-gradient(circle at 30% 30%, #ffffff80, ${b.color})`,
              boxShadow: `0 8px 16px ${b.color}40`,
            }}
          />
          {/* String — thin line. */}
          <div className="absolute left-1/2 -translate-x-1/2 w-px bg-slate-400/60" style={{ top: '78%', height: '22%' }} />
        </div>
      ))}
    </>
  );
}

function CloudsVariant({ size, speed, thumb }: { size: { w: number; h: number }; speed: number; thumb?: boolean }) {
  // Three clouds at different speeds + sizes for depth parallax. `x` is only
  // read in the still frame: animating, they all enter from -30%, which on a
  // 60-90s drift means a thumbnail catches an empty sky.
  const clouds = useMemo(() => [
    { y: 12, x: 6, scale: 1.0, duration: 60 / speed, delay: 0 },
    { y: 38, x: 46, scale: 0.7, duration: 90 / speed, delay: 8 },
    { y: 58, x: 22, scale: 1.3, duration: 75 / speed, delay: 20 },
  ], [speed]);
  return (
    <>
      {clouds.map((c, i) => (
        <svg
          key={i}
          viewBox="0 0 200 80"
          className="absolute"
          style={{
            top: `${c.y}%`,
            left: thumb ? `${c.x}%` : '-30%',
            width: `${(thumb ? 34 : 22) * c.scale}%`,
            height: 'auto',
            animation: thumb ? undefined : `dw-cloudDrift ${c.duration}s linear ${c.delay}s infinite`,
            opacity: 0.85,
          }}
          aria-hidden
        >
          <g fill="#ffffff">
            <ellipse cx="50" cy="50" rx="40" ry="22" />
            <ellipse cx="90" cy="40" rx="35" ry="28" />
            <ellipse cx="130" cy="50" rx="38" ry="22" />
          </g>
        </svg>
      ))}
    </>
  );
}

function SparklesVariant({ size, speed, count, thumb }: { size: { w: number; h: number }; speed: number; count?: number; thumb?: boolean }) {
  const sparkles = useMemo(() => {
    const n = Math.max(8, Math.min(40, count ?? 24));
    const unit = Math.max(60, Math.min(size.w || 0, size.h || 0) || 300);
    return Array.from({ length: n }, (_, i) => ({
      key: i,
      left: Math.random() * 92,
      top: Math.random() * 92,
      size: unit * (0.03 + Math.random() * 0.06),
      delay: Math.random() * 3,
      duration: (1.5 + Math.random() * 2) / speed,
      hue: 30 + Math.random() * 30, // gold-ish range
    }));
  }, [size.w, size.h, count, speed]);

  return (
    <>
      {sparkles.map((s) => (
        <div
          key={s.key}
          className="absolute"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            background: `radial-gradient(circle, hsl(${s.hue}, 100%, 75%) 0%, transparent 60%)`,
            borderRadius: '50%',
            // The twinkle spends half its cycle at opacity 0.1, so a still
            // frame catches most of the field nearly invisible. Freeze it bright.
            animation: thumb ? undefined : `dw-sparkleTwinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
            filter: 'blur(0.5px)',
          }}
          aria-hidden
        />
      ))}
    </>
  );
}

function TickerVariant({ size, speed, text, colors, thumb }: { size: { w: number; h: number }; speed: number; text?: string; colors?: string[]; thumb?: boolean }) {
  const display = text || 'Welcome to school! · Have a wonderful day · Stay curious · Be kind';
  const palette = colors?.length ? colors : ['#fff'];
  // `text-[6vmin]` read the VIEWPORT, not this widget's box — so the same
  // ticker rendered 42px inside a 185px picker tile and 130px inside a 200px-tall
  // zone on a 4K wall, overflowing both. Size follows the measured box; the
  // vmin fallback only covers the single frame before ResizeObserver reports.
  const box = Math.min(size.w || 0, size.h || 0);
  const fontSize = box ? Math.max(9, box * 0.42) : undefined;
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center overflow-hidden">
      <div
        className={`whitespace-nowrap font-black tracking-tight${fontSize ? '' : ' text-[6vmin]'}`}
        data-inline-edit-pause
        style={{
          color: palette[0],
          fontSize,
          // A still frame of a marquee that starts at translateX(100%) is an
          // empty box; park the copy in view instead.
          animation: thumb ? undefined : `dw-tickerScroll ${30 / speed}s linear infinite`,
          paddingLeft: thumb ? '0.4em' : undefined,
          textShadow: '0 2px 12px rgba(0,0,0,0.3)',
        }}
        aria-hidden
      >
        <span data-field="text">{display}</span>
        <span aria-hidden="true"> &nbsp;&nbsp;·&nbsp;&nbsp; {display}</span>
      </div>
    </div>
  );
}

function NeonBuzzVariant({ size, text, glowColor, thumb }: { size: { w: number; h: number }; text?: string; glowColor?: string; thumb?: boolean }) {
  const display = text || 'OPEN';
  const neon = glowColor || '#f0abfc';
  // Same viewport-unit fault as the ticker: `14vmin` is 98px in a 185px tile.
  const box = Math.min(size.w || 0, size.h || 0);
  const fontSize = box ? Math.max(11, box * 0.34) : undefined;
  return (
    <div
      className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center"
      style={{ ['--neon' as any]: neon }}
      aria-hidden
    >
      <span
        data-field="text"
        data-inline-edit-pause
        className={`font-black tracking-widest${fontSize ? '' : ' text-[14vmin]'}`}
        style={{
          color: '#fff',
          fontSize,
          // The buzz is a 0.18s jitter — meaningless in a still, and it makes
          // the glyph land a half-pixel off in a screenshot.
          animation: thumb ? undefined : 'dw-neonBuzz 0.18s linear infinite',
          textShadow: thumb ? `0 0 12px ${neon}, 0 0 28px ${neon}` : undefined,
          letterSpacing: '0.2em',
        }}
      >
        {display}
      </span>
    </div>
  );
}

function PulseGlowVariant({ glowColor, speed, thumb }: { glowColor?: string; speed: number; thumb?: boolean }) {
  const glow = glowColor || '#fbbf24';
  // Convert the hex into a hex-with-alpha by appending "44" and "66" so
  // CSS box-shadow can use the value directly without rgba math.
  const glowDim = `${glow}44`;
  const glowBright = `${glow}66`;
  return (
    <div
      className="absolute top-0 right-0 bottom-0 left-0 rounded-3xl"
      style={{
        ['--glow' as any]: glowDim,
        background: `radial-gradient(ellipse at center, ${thumb ? glowBright : glowDim} 0%, transparent 70%)`,
        // Frozen at the bright half of the breath, which is the frame worth showing.
        animation: thumb ? undefined : `dw-pulseGlow ${4 / speed}s ease-in-out infinite`,
        boxShadow: thumb ? `inset 0 0 80px 20px ${glowBright}` : undefined,
      }}
      aria-hidden
    >
      <style>{sceneCss(`
        :root { --glow-bright: ${glowBright}; }
      `)}</style>
    </div>
  );
}

// ─── Helper for the palette / properties panel ───────────────────

export const DECORATION_VARIANTS: Array<{
  key: DecorationVariant;
  label: string;
  hint: string;
  defaults: DecorationConfig;
}> = [
  { key: 'confetti',       label: 'Confetti',       hint: 'Falling colored particles. Great for celebrations.',     defaults: { variant: 'confetti', speed: 1, count: 60 } },
  { key: 'rainbow-ribbon', label: 'Rainbow Ribbon', hint: 'Animated gradient banner. Background sash.',             defaults: { variant: 'rainbow-ribbon', speed: 1 } },
  { key: 'balloons',       label: 'Balloons',       hint: 'Rising colored balloons. Birthday, party, year-end.',    defaults: { variant: 'balloons', speed: 1, count: 8 } },
  { key: 'clouds',         label: 'Clouds',         hint: 'Slow horizontal cloud drift. Sky-themed background.',    defaults: { variant: 'clouds', speed: 1 } },
  { key: 'sparkles',       label: 'Sparkles',       hint: 'Twinkling gold dust. Festive overlay.',                  defaults: { variant: 'sparkles', speed: 1, count: 24 } },
  { key: 'ticker',         label: 'Ticker',         hint: 'Scrolling text marquee. Big, fast, attention-grabbing.', defaults: { variant: 'ticker', speed: 1, text: 'Welcome · Have a wonderful day · Stay curious' } },
  { key: 'neon-buzz',      label: 'Neon Buzz',      hint: 'Buzzing neon-sign text. Adds character to lobbies.',     defaults: { variant: 'neon-buzz', text: 'OPEN', glowColor: '#f0abfc' } },
  { key: 'pulse-glow',     label: 'Pulse Glow',     hint: 'Breathing glow halo. Sits behind featured content.',     defaults: { variant: 'pulse-glow', speed: 1, glowColor: '#fbbf24' } },
];
