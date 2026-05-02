/**
 * Shared style system for the v2 widget pack.
 * ─────────────────────────────────────────────
 * Every v2 widget accepts a `style` object on its config. This module
 * resolves that object into concrete CSS values with sensible defaults,
 * so widget components can call `resolveStyle(c.style)` once and trust
 * the result.
 *
 * The point of this system is to give the template editor ONE consistent
 * set of fields it can render across every widget — fonts, sizes,
 * colors, alignment, padding, borders, shadows, animation. Per-widget
 * `Cfg` interfaces still expose widget-specific content fields
 * (e.g. periods, headlines, feeds), but every visual property the
 * Canva-style editor lets you tweak lives on `style`.
 */

export interface WidgetStyle {
  // Type
  fontFamily?: string;
  fontSize?: number | string;       // px when number; raw when string ("clamp(...)" allowed)
  fontWeight?: number | string;     // 100-900 or 'bold'
  fontStyle?: 'normal' | 'italic';
  letterSpacing?: number | string;
  lineHeight?: number | string;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textColor?: string;
  textShadow?: string;

  // Background
  bgColor?: string;
  bgGradient?: string;     // any CSS gradient string
  bgImage?: string;        // URL (no url() wrapper required)
  bgBlur?: number;         // px backdrop-filter blur

  // Box / position
  padding?: number | string;
  borderRadius?: number | string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  borderColor?: string;
  shadow?: string;         // any CSS box-shadow

  // Accent / highlight (the colored emphasis any widget might use)
  accentColor?: string;
  accentColor2?: string;
  highlightColor?: string;

  // Animation
  animationOn?: boolean;
  animationSpeed?: 'slow' | 'normal' | 'fast' | number; // number = seconds

  // Sub-element visibility (per-widget keys, e.g. 'showSeconds', 'showDate')
  show?: Record<string, boolean>;

  // Free passthrough — anything else gets shoved onto the root element style
  cssVars?: Record<string, string>;
}

export interface ResolvedStyle {
  font: {
    family: string;
    size: string;
    weight: string;
    style: string;
    letterSpacing: string;
    lineHeight: string;
    transform: string;
    align: 'left' | 'center' | 'right' | 'justify';
    color: string;
    shadow: string;
  };
  bg: {
    color: string;
    gradient: string;
    image: string;
    blur: number;
  };
  box: {
    padding: string;
    radius: string;
    border: string;
    shadow: string;
  };
  accent: {
    primary: string;
    secondary: string;
    highlight: string;
  };
  anim: {
    on: boolean;
    speed: 'slow' | 'normal' | 'fast' | number;
  };
  show: (key: string, defaultVal?: boolean) => boolean;
  cssVars: Record<string, string>;
}

const DEFAULTS: Required<Omit<WidgetStyle, 'show' | 'cssVars' | 'bgGradient' | 'bgImage' | 'textShadow'>> & {
  show: Record<string, boolean>;
  cssVars: Record<string, string>;
  bgGradient: string;
  bgImage: string;
  textShadow: string;
} = {
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  fontSize: 24,
  fontWeight: 500,
  fontStyle: 'normal',
  letterSpacing: 'normal',
  lineHeight: 1.3,
  textTransform: 'none',
  textAlign: 'left',
  textColor: '#0f172a',
  textShadow: 'none',
  bgColor: '#ffffff',
  bgGradient: '',
  bgImage: '',
  bgBlur: 0,
  padding: 24,
  borderRadius: 16,
  borderWidth: 0,
  borderStyle: 'solid',
  borderColor: '#e2e8f0',
  shadow: 'none',
  accentColor: '#6366f1',
  accentColor2: '#a855f7',
  highlightColor: '#fbbf24',
  animationOn: true,
  animationSpeed: 'normal',
  show: {},
  cssVars: {},
};

function px(v: number | string | undefined, fallback: string): string {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'number') return `${v}px`;
  return String(v);
}

export function resolveStyle(s?: WidgetStyle): ResolvedStyle {
  const x = { ...DEFAULTS, ...(s || {}) };
  return {
    font: {
      family: x.fontFamily,
      size: px(x.fontSize, '24px'),
      weight: String(x.fontWeight),
      style: x.fontStyle,
      letterSpacing: typeof x.letterSpacing === 'number' ? `${x.letterSpacing}px` : x.letterSpacing,
      lineHeight: String(x.lineHeight),
      transform: x.textTransform,
      align: x.textAlign,
      color: x.textColor,
      shadow: x.textShadow,
    },
    bg: {
      color: x.bgColor,
      gradient: x.bgGradient,
      image: x.bgImage,
      blur: x.bgBlur,
    },
    box: {
      padding: px(x.padding, '24px'),
      radius: px(x.borderRadius, '16px'),
      border: x.borderWidth > 0 ? `${x.borderWidth}px ${x.borderStyle} ${x.borderColor}` : 'none',
      shadow: x.shadow,
    },
    accent: {
      primary: x.accentColor,
      secondary: x.accentColor2,
      highlight: x.highlightColor,
    },
    anim: {
      on: !!x.animationOn,
      speed: x.animationSpeed,
    },
    show: (key, def = true) => {
      const v = (x.show || {})[key];
      return v === undefined ? def : !!v;
    },
    cssVars: x.cssVars || {},
  };
}

/**
 * Build a React style object for the OUTER widget frame from a resolved
 * style. Handles bg image vs gradient vs solid color collisions cleanly.
 */
export function frameStyle(r: ResolvedStyle): React.CSSProperties {
  const out: React.CSSProperties = {
    fontFamily: r.font.family,
    color: r.font.color,
    backgroundColor: r.bg.color,
    padding: r.box.padding,
    borderRadius: r.box.radius,
    border: r.box.border,
    boxShadow: r.box.shadow,
    overflow: 'hidden',
    width: '100%',
    height: '100%',
    position: 'relative',
    boxSizing: 'border-box',
    textAlign: r.font.align,
  };
  if (r.bg.image) {
    out.backgroundImage = r.bg.image.trim().startsWith('url(') ? r.bg.image : `url(${r.bg.image})`;
    out.backgroundSize = 'cover';
    out.backgroundPosition = 'center';
  } else if (r.bg.gradient) {
    out.backgroundImage = r.bg.gradient;
  }
  // Apply CSS vars
  for (const [k, v] of Object.entries(r.cssVars)) {
    (out as any)[k] = v;
  }
  return out;
}

/** Map animationSpeed (slow/normal/fast/number) → seconds with a base. */
export function animDurationSec(speed: ResolvedStyle['anim']['speed'], baseSec: number): number {
  if (typeof speed === 'number' && speed > 0) return speed;
  if (speed === 'slow') return baseSec * 1.8;
  if (speed === 'fast') return baseSec * 0.6;
  return baseSec;
}
