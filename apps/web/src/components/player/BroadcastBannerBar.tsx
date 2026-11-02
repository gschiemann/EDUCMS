'use client';

/**
 * The INFO / WARN broadcast banner bar (2026-11-01), ONE component for the
 * live player (`EmergencyOverlay`) and the composer preview, so what the
 * sender sees is what the screen draws.
 *
 * Sender options (`BannerOptions`, @cms/api-types):
 *   - colour: any hex; the text colour is chosen for WCAG contrast.
 *   - static: centred text, at most 2 lines, shrunk to a floor to fit.
 *   - scroll: a seamless marquee (the text repeated end to end, the track
 *     slides exactly one copy then loops), slow / normal / fast.
 *
 * Without options the bar renders EXACTLY as before (left-aligned text-xl) -
 * that is also what an older player does with a message that carries the new
 * field.
 *
 * Chromium-83 safe (CLAUDE.md rule 10): no `inset`, no flex `gap` (margins
 * instead), transform animation only.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type Ref } from 'react';
import { AlertTriangle, Megaphone } from 'lucide-react';
import {
  BANNER_SPEED_STAGES_PER_MIN,
  readableTextOn,
  sanitizeBannerOptions,
  type BannerOptions,
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

/** Static: centred, at most 2 lines, shrunk (never below `floor`) to fit. */
function StaticText({ text, stageWidth }: { text: string; stageWidth: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const base = Math.max(20, Math.min(120, Math.round(stageWidth * 0.022)));
  const floor = Math.max(14, Math.min(60, Math.round(stageWidth * 0.0115)));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = base;
    el.style.fontSize = `${size}px`;
    // line-height is 1.25; two lines plus a hair of slack.
    while (size > floor && el.scrollHeight > size * 1.25 * 2 + 2) {
      size -= 2;
      el.style.fontSize = `${size}px`;
    }
  }, [text, base, floor]);
  return (
    <div
      ref={ref}
      data-banner-text="static"
      className="flex-1 min-w-0 font-bold ml-4 text-center whitespace-pre-wrap break-words"
      style={{ lineHeight: 1.25 }}
    >
      {text}
    </div>
  );
}

/** Scroll: seamless marquee. N even copies; the track moves -50% = N/2 copies. */
function ScrollText({ text, stageWidth, speed }: { text: string; stageWidth: number; speed: BannerOptions['speed'] }) {
  const clipRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<{ copies: number; seconds: number }>({ copies: 2, seconds: 20 });
  const size = Math.max(20, Math.min(120, Math.round(stageWidth * 0.022)));
  useLayoutEffect(() => {
    const clip = clipRef.current;
    const copy = copyRef.current;
    if (!clip || !copy) return;
    const measure = () => {
      const copyW = copy.offsetWidth;
      if (copyW <= 0) return;
      const perCopy = Math.max(1, Math.ceil(clip.offsetWidth / copyW));
      const pxPerSecond = (stageWidth * BANNER_SPEED_STAGES_PER_MIN[speed]) / 60;
      const next = { copies: perCopy * 2, seconds: Math.max(4, Math.round((copyW / pxPerSecond) * 10) / 10) };
      setFit((prev) => (prev.copies === next.copies && prev.seconds === next.seconds ? prev : next));
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(clip);
    return () => observer?.disconnect();
  }, [text, stageWidth, speed, size]);
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
      className="flex-1 min-w-0 font-bold ml-4"
      style={{ overflow: 'hidden', whiteSpace: 'nowrap', fontSize: size, lineHeight: 1.25 }}
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
          <ScrollText text={text} stageWidth={width} speed={opts.speed} />
        ) : (
          <StaticText text={text} stageWidth={width} />
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
