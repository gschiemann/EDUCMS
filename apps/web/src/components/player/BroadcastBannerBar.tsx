'use client';

/**
 * The INFO / WARN broadcast banner bar (2026-11-01), ONE component for the
 * live player (`EmergencyOverlay`) and the composer preview, so what the
 * sender sees is what the screen draws.
 *
 * Sender options (`BannerOptions`, @cms/api-types):
 *   - colour: any hex; the text colour is chosen for WCAG contrast.
 *   - static: centred text, at most 2 lines, shrunk to a floor to fit; a
 *     message too long for that keeps shrinking rather than be clipped by
 *     the overlay's height cap (`StaticText`).
 *   - scroll: a seamless marquee (the text repeated end to end until it
 *     fills the bar twice; the track slides half its copies, then loops),
 *     slow / normal / fast — one stage width every 48 s / 30 s / 20 s
 *     (2026-11-23, slowed), timed by the distance the track really travels
 *     so a short message moves exactly as fast as a long one.
 *   - size (2026-11-23): small / medium / large text, a fraction of the stage
 *     width (`bannerFontPx`); medium is the size every banner with options
 *     drew before. The bar's height follows the font (it is content-sized);
 *     the overlay still caps it at 40% of the canvas.
 *
 * Without options the bar renders EXACTLY as before (left-aligned text-xl) -
 * that is also what an older player does with a message that carries the new
 * field.
 *
 * Chromium-83 safe (apps/web/CLAUDE.md rule 10): no `inset`, no flex `gap` (margins
 * instead), transform animation only.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type Ref } from 'react';
import { AlertTriangle, Megaphone } from 'lucide-react';
import {
  bannerFontPx,
  bannerLoopSeconds,
  bannerSizeOf,
  readableTextOn,
  sanitizeBannerOptions,
  type BannerOptions,
  type BannerSize,
} from '@cms/api-types';

export const BANNER_SEVERITY_STYLES = {
  INFO: {
    bg: 'bg-yellow-400',
    solidBg: '#facc15',
    border: 'border-yellow-600',
    text: 'text-slate-900',
    icon: Megaphone,
    animate: '',
  },
  WARN: {
    bg: 'bg-orange-500',
    solidBg: '#f97316',
    border: 'border-orange-700',
    text: 'text-white',
    icon: AlertTriangle,
    animate: '',
  },
} as const;

export type BannerSeverity = keyof typeof BANNER_SEVERITY_STYLES;

/** The sender's colour as inline paint, or null for the severity's own colours. */
export function bannerPaint(options: BannerOptions | null): { background: string; color: string } | null {
  if (!options?.color) return null;
  return { background: options.color, color: readableTextOn(options.color).text };
}

const KEYFRAMES =
  '@keyframes edu-banner-marquee{from{transform:translate3d(0,0,0)}to{transform:translate3d(-50%,0,0)}}';

/**
 * The height the bar gives its text column, in CSS px: the bar's padding box
 * less its vertical padding. Infinity when it cannot be measured (no parent,
 * no layout - jsdom), so the never-clip pass below changes nothing there.
 */
function textRoom(el: HTMLElement): number {
  const bar = el.parentElement;
  if (!bar) return Infinity;
  const cs = getComputedStyle(bar);
  const room = bar.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  return room > 0 ? room : Infinity;
}

/**
 * Static: centred, at most 2 lines, shrunk (never below the size's `floor`)
 * to fit - and then NEVER CLIPPED.
 *
 * 2026-11-23 (review): the overlay caps the bar at 40% of the canvas and the
 * bar centres its text column with overflow hidden, so text taller than the
 * cap lost its FIRST and LAST lines equally. Medium and Small never reach the
 * cap at any length the API accepts (2,000 characters) on a 1280, 1920 or
 * 3840 stage, but Large at its own floor did from about 1,300 characters at
 * 1920 (measured: 2,000 characters lost ~3 lines at each end). So after the
 * 2-line pass, while the text is still taller than the room the bar gives it,
 * it keeps shrinking - past its own floor, down to the smallest floor of any
 * size (small's) - so no size ever shows less of a message than Medium does.
 * On a bar that is not height-capped the room IS the text, and nothing moves.
 */
function StaticText({ text, stageWidth, size }: { text: string; stageWidth: number; size: BannerSize }) {
  const ref = useRef<HTMLDivElement>(null);
  const { base, floor } = bannerFontPx(size, stageWidth);
  const lastFloor = Math.min(floor, bannerFontPx('small', stageWidth).floor);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let px = base;
    el.style.fontSize = `${px}px`;
    // line-height is 1.25; two lines plus a hair of slack.
    while (px > floor && el.scrollHeight > px * 1.25 * 2 + 2) {
      px = Math.max(floor, px - 2);
      el.style.fontSize = `${px}px`;
    }
    // Never clipped: a hair of slack for sub-pixel rounding.
    const room = textRoom(el);
    while (px > lastFloor && el.scrollHeight > room + 1) {
      px = Math.max(lastFloor, px - 1);
      el.style.fontSize = `${px}px`;
    }
  }, [text, base, floor, lastFloor]);
  return (
    <div
      ref={ref}
      data-banner-text="static"
      data-banner-size={size}
      className="flex-1 min-w-0 font-bold ml-4 text-center whitespace-pre-wrap break-words"
      style={{ lineHeight: 1.25 }}
    >
      {text}
    </div>
  );
}

/** Scroll: seamless marquee. N even copies; the track moves -50% = N/2 copies. */
function ScrollText({ text, stageWidth, speed, size }: { text: string; stageWidth: number; speed: BannerOptions['speed']; size: BannerSize }) {
  const clipRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<{ copies: number; seconds: number }>({ copies: 2, seconds: 20 });
  const fontPx = bannerFontPx(size, stageWidth).base;
  useLayoutEffect(() => {
    const clip = clipRef.current;
    const copy = copyRef.current;
    if (!clip || !copy) return;
    const measure = () => {
      const copyW = copy.offsetWidth;
      if (copyW <= 0) return;
      const perCopy = Math.max(1, Math.ceil(clip.offsetWidth / copyW));
      // One loop slides -50% of the track = perCopy copies: time THAT distance
      // (timing one copy ran a short message perCopy times too fast).
      const next = { copies: perCopy * 2, seconds: bannerLoopSeconds(perCopy * copyW, stageWidth, speed) };
      setFit((prev) => (prev.copies === next.copies && prev.seconds === next.seconds ? prev : next));
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(clip);
    return () => observer?.disconnect();
  }, [text, stageWidth, speed, fontPx]);
  const copies = [];
  for (let i = 0; i < fit.copies; i += 1) {
    copies.push(
      <span
        key={i}
        ref={i === 0 ? copyRef : undefined}
        aria-hidden={i === 0 ? undefined : true}
        style={{ display: 'inline-block', paddingRight: '4em' }}
      >
        {text.replace(/\s*\n\s*/g, '   ')}
      </span>,
    );
  }
  return (
    <div
      ref={clipRef}
      data-banner-text="scroll"
      data-banner-speed={speed}
      data-banner-size={size}
      data-banner-seconds={fit.seconds}
      className="flex-1 min-w-0 font-bold ml-4"
      style={{ overflow: 'hidden', whiteSpace: 'nowrap', fontSize: fontPx, lineHeight: 1.25 }}
    >
      <style>{KEYFRAMES}</style>
      <div
        data-banner-track=""
        style={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          willChange: 'transform',
          animation: `edu-banner-marquee ${fit.seconds}s linear infinite`,
        }}
      >
        {copies}
      </div>
    </div>
  );
}

export interface BroadcastBannerBarProps {
  severity: BannerSeverity;
  text: string;
  /** Raw options (sanitised here); null / undefined = today's look. */
  options?: unknown;
  /** Width of the canvas the bar is drawn on, in CSS px (drives font + speed). */
  stageWidth: number;
  barRef?: Ref<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
  rootProps?: HTMLAttributes<HTMLDivElement> & Record<string, unknown>;
}

export function BroadcastBannerBar({ severity, text, options, stageWidth, barRef, className = '', style, rootProps }: BroadcastBannerBarProps) {
  const sev = BANNER_SEVERITY_STYLES[severity] ?? BANNER_SEVERITY_STYLES.WARN;
  const Icon = sev.icon;
  const opts = sanitizeBannerOptions(options);
  const paint = bannerPaint(opts);
  const width = stageWidth > 0 ? stageWidth : 1920;
  return (
    <div
      ref={barRef}
      {...rootProps}
      className={`${sev.bg} ${sev.text} border-b-4 ${sev.border} ${sev.animate} px-8 py-4 flex items-center shadow-2xl overflow-hidden ${className}`}
      style={{
        backgroundColor: paint?.background ?? sev.solidBg,
        ...(paint ? { color: paint.color, borderColor: 'rgba(0,0,0,0.25)' } : {}),
        ...style,
      }}
    >
      <Icon className="w-8 h-8 flex-shrink-0" />
      {opts ? (
        opts.mode === 'scroll' ? (
          <ScrollText text={text} stageWidth={width} speed={opts.speed} size={bannerSizeOf(opts)} />
        ) : (
          <StaticText text={text} stageWidth={width} size={bannerSizeOf(opts)} />
        )
      ) : (
        /* ml-4 stands in for a parent flex GAP (Chrome 84+ only). min-w-0 lets
           the text column shrink below its content width so wrapping kicks in
           on a narrow ribbon instead of overflowing the flex row. */
        <div className="flex-1 min-w-0 text-xl font-bold leading-snug ml-4 whitespace-pre-wrap break-words">{text}</div>
      )}
    </div>
  );
}
