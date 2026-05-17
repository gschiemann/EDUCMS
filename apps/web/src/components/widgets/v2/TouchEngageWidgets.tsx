"use client";
/**
 * VenueOS · Touch & engagement widgets — photo booth, sign-in pad,
 * language picker, accessibility tray, NPS feedback, trivia, spin-to-win,
 * directory search, wayfinding floor map, donation thermometer.
 */
import React from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

/* ════════════════ PHOTO BOOTH ════════════════ */

export interface PhotoBoothCfg extends BaseCfg {
  frames?: string[];
  countdownSec?: number;
  deliveries?: string[];
  brandOverlay?: string | null;
}

function PhotoFrame({ label, active, height }: { label: string; active?: boolean; height: number }) {
  return (
    <div style={{
      background: active ? '#1f1742' : '#11161e',
      border: active ? `2px solid #7b5cff` : '1px solid #1c2230',
      borderRadius: px(height, 0.013),
      padding: `${px(height, 0.017)}px ${px(height, 0.013)}px`,
      textAlign: 'center', color: '#fff', fontWeight: 700, fontSize: px(height, 0.022),
    }}>
      <div style={{ height: px(height, 0.074), background: '#0006', borderRadius: px(height, 0.0074), marginBottom: px(height, 0.0093) }} />
      {label}
    </div>
  );
}

export function PhotoBoothWidget({ config, live = true, height = 480 }: WidgetProps<PhotoBoothCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0b0c0e', textColor: '#fff', accentColor: '#7b5cff', ...c.style });
  const frames = c.frames ?? ['Polaroid', 'Strip', 'Grid 4', 'Single'];
  const countdownSec = c.countdownSec ?? 3;

  return (
    <div style={frameStyle(r)}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        padding: '7.4%', display: 'grid', gridTemplateColumns: '1.2fr 1fr', color: '#fff',
      }}>
        <div style={{
          background: '#11161e', border: '1px solid #1c2230', borderRadius: px(height, 0.022),
          position: 'relative', overflow: 'hidden', marginRight: '3%',
        }}>
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'linear-gradient(135deg,#3955d1,#7b5cff)', opacity: .6 }} />
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: px(height, 0.185) }}>📸</div>
          {/* Countdown ring */}
          <div style={{
            position: 'absolute', top: px(height, 0.028), right: px(height, 0.028),
            background: '#0006', padding: `${px(height, 0.013)}px ${px(height, 0.0185)}px`,
            borderRadius: px(height, 0.013), color: '#fff', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: px(height, 0.03),
          }}>{String(countdownSec).padStart(2, '0')}</div>
          {/* Frame chrome */}
          <div style={{ position: 'absolute', left: px(height, 0.028), bottom: px(height, 0.028), color: '#fff', fontWeight: 700, fontSize: px(height, 0.022) }}>● LIVE PREVIEW · 4032×3024</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div>
            <div style={{ color: '#7b5cff', fontWeight: 700, fontSize: px(height, 0.026), letterSpacing: '0.08em' }}>STEP 2 OF 3</div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.089), lineHeight: 1.0, letterSpacing: '-0.02em' }}>Strike a pose!</div>
            <div style={{ color: '#cfd8e3', fontWeight: 600, fontSize: px(height, 0.028), marginTop: px(height, 0.013) }}>We&rsquo;ll take 4 photos in a row.</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', marginTop: px(height, 0.022) }}>
            {frames.slice(0, 4).map((f, i) => (
              <div key={i} style={{ marginRight: i % 2 === 0 ? px(height, 0.0148) : 0, marginBottom: px(height, 0.0148) }}>
                <PhotoFrame label={f} active={i === 0} height={height} />
              </div>
            ))}
          </div>
          <button style={{
            marginTop: 'auto', background: '#7b5cff', color: '#fff', border: 0, borderRadius: px(height, 0.0167),
            padding: px(height, 0.0278), fontWeight: 800, fontSize: px(height, 0.039), cursor: 'pointer',
          }}>
            START · tap to begin
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ VISITOR SIGN-IN PAD ════════════════ */

export interface SignInPadCfg extends BaseCfg {
  fields?: string[];
  visitTypes?: string[];
  notifyVia?: string[];
  printBadge?: boolean;
  takePhoto?: boolean;
  nda?: boolean;
}

function SignInField({ label, value, height }: { label: string; value: string; height: number }) {
  return (
    <div style={{ marginBottom: px(height, 0.0185) }}>
      <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.02), letterSpacing: '0.06em' }}>{label.toUpperCase()}</div>
      <div style={{
        marginTop: px(height, 0.0074), background: '#fafaf7', border: '1px solid #e7e6e1',
        borderRadius: px(height, 0.013), padding: `${px(height, 0.022)}px ${px(height, 0.02)}px`,
        color: '#0b0c0e', fontWeight: 700, fontSize: px(height, 0.035),
      }}>{value}</div>
    </div>
  );
}

export function SignInPadWidget({ config, live = true, height = 480 }: WidgetProps<SignInPadCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fdfaf3', textColor: '#0b0c0e', accentColor: '#3955d1', ...c.style });
  const visitTypes = c.visitTypes ?? ['Meeting', 'Interview', 'Delivery', 'Vendor', 'Tour', 'Other'];

  return (
    <div style={frameStyle(r)}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        padding: '7.4%', display: 'flex', flexDirection: 'column',
      }}>
        <div>
          <div style={{ color: '#3955d1', fontWeight: 700, fontSize: px(height, 0.028), letterSpacing: '0.08em' }}>STEP 1 · WHO ARE YOU?</div>
          <div style={{ color: '#0b0c0e', fontWeight: 800, fontSize: px(height, 0.102), letterSpacing: '-0.02em' }}>Welcome — sign in</div>
        </div>
        <div style={{ flex: 1, marginTop: px(height, 0.028), display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div style={{
            background: '#fff', border: '1px solid #e7e6e1', borderRadius: px(height, 0.022),
            padding: px(height, 0.037), display: 'flex', flexDirection: 'column', marginRight: px(height, 0.037),
          }}>
            <SignInField label="Full name" value="Alex Morgan" height={height} />
            <SignInField label="Company" value="Acme Robotics" height={height} />
            <SignInField label="Meeting with" value="Dana Stevens" height={height} />
            <SignInField label="Email" value="alex@acme.io" height={height} />
          </div>
          <div style={{
            background: '#fff', border: '1px solid #e7e6e1', borderRadius: px(height, 0.022),
            padding: px(height, 0.037), display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.022), letterSpacing: '0.06em', marginBottom: px(height, 0.0185) }}>VISIT TYPE</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              {visitTypes.map((t, i) => (
                <div key={t} style={{
                  background: t === 'Meeting' ? '#3955d1' : '#fafaf7',
                  color: t === 'Meeting' ? '#fff' : '#0b0c0e', border: '1px solid #e7e6e1',
                  padding: `${px(height, 0.022)}px ${px(height, 0.0167)}px`, borderRadius: px(height, 0.013),
                  fontWeight: 700, fontSize: px(height, 0.026), textAlign: 'center',
                  marginRight: i % 2 === 0 ? px(height, 0.013) : 0, marginBottom: px(height, 0.013),
                }}>{t}</div>
              ))}
            </div>
            <div style={{ marginTop: px(height, 0.013), color: '#74767d', fontWeight: 600, fontSize: px(height, 0.0204) }}>By signing in you accept the visitor agreement.</div>
            <button style={{
              marginTop: 'auto', background: '#0b0c0e', color: '#fff', border: 0, borderRadius: px(height, 0.0167),
              padding: px(height, 0.022), fontWeight: 800, fontSize: px(height, 0.033),
            }}>Sign in &amp; notify host →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ LANGUAGE PICKER ════════════════ */

export interface LanguageOption { english: string; native: string; flag: string; code: string; }
export interface LanguagePickerCfg extends BaseCfg {
  languages?: LanguageOption[];
  idleResetSec?: number;
}

const DEFAULT_LANGS: LanguageOption[] = [
  { english: 'English', native: 'English', flag: '🇺🇸', code: 'en' },
  { english: 'Spanish', native: 'Español', flag: '🇪🇸', code: 'es' },
  { english: 'Chinese', native: '中文', flag: '🇨🇳', code: 'zh' },
  { english: 'French', native: 'Français', flag: '🇫🇷', code: 'fr' },
  { english: 'German', native: 'Deutsch', flag: '🇩🇪', code: 'de' },
  { english: 'Arabic', native: 'العربية', flag: '🇸🇦', code: 'ar' },
  { english: 'Vietnamese', native: 'Tiếng Việt', flag: '🇻🇳', code: 'vi' },
  { english: 'Korean', native: '한국어', flag: '🇰🇷', code: 'ko' },
  { english: 'Japanese', native: '日本語', flag: '🇯🇵', code: 'ja' },
];

export function LanguagePickerWidget({ config, live = true, height = 480 }: WidgetProps<LanguagePickerCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fff', textColor: '#0b0c0e', accentColor: '#3955d1', ...c.style });
  const langs = c.languages ?? DEFAULT_LANGS;

  return (
    <div style={frameStyle(r)}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        padding: '7.4%', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#3955d1', fontWeight: 700, fontSize: px(height, 0.028), letterSpacing: '0.06em' }}>SELECT LANGUAGE · ELIGE IDIOMA · 选择语言</div>
          <div style={{ color: '#0b0c0e', fontWeight: 800, fontSize: px(height, 0.081), marginTop: px(height, 0.0074), letterSpacing: '-0.02em' }}>Tap your language</div>
        </div>
        <div style={{ flex: 1, marginTop: px(height, 0.037), display: 'grid', gridTemplateColumns: 'repeat(3,1fr)' }}>
          {langs.slice(0, 9).map((l, i) => (
            <div key={i} style={{
              background: '#fafaf7', border: '2px solid #e7e6e1', borderRadius: px(height, 0.0167),
              padding: px(height, 0.0278), display: 'flex', alignItems: 'center',
              marginRight: i % 3 !== 2 ? px(height, 0.022) : 0, marginBottom: px(height, 0.022),
            }}>
              <div style={{ fontSize: px(height, 0.074), marginRight: px(height, 0.022) }}>{l.flag}</div>
              <div>
                <div style={{ color: '#0b0c0e', fontWeight: 700, fontSize: px(height, 0.041) }}>{l.native}</div>
                <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.0204) }}>{l.english}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ ACCESSIBILITY TRAY ════════════════ */

export interface AccessibilityTrayCfg extends BaseCfg {
  controls?: string[];
  idleResetSec?: number;
}

function AccessibilityRow({ title, right, options, height }: { title: string; right: string; options: string[]; height: number }) {
  return (
    <div style={{
      background: '#fafaf7', border: '1px solid #e7e6e1', borderRadius: px(height, 0.0167),
      padding: `${px(height, 0.024)}px ${px(height, 0.0278)}px`, display: 'flex', alignItems: 'center',
      marginBottom: px(height, 0.0167),
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ color: '#0b0c0e', fontWeight: 700, fontSize: px(height, 0.03) }}>{title}</div>
        <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.0185) }}>{right}</div>
      </div>
      <div style={{ display: 'flex' }}>
        {options.map((o, i) => (
          <div key={i} style={{
            background: i === 1 ? '#3955d1' : '#fff', color: i === 1 ? '#fff' : '#0b0c0e',
            border: '1px solid #e7e6e1', padding: `${px(height, 0.013)}px ${px(height, 0.0204)}px`,
            borderRadius: px(height, 0.011), fontWeight: 700, fontSize: px(height, 0.022),
            marginRight: i === options.length - 1 ? 0 : px(height, 0.0093),
          }}>{o}</div>
        ))}
      </div>
    </div>
  );
}

export function AccessibilityTrayWidget({ config, live = true, height = 480 }: WidgetProps<AccessibilityTrayCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fff', textColor: '#0b0c0e', accentColor: '#3955d1', ...c.style });

  return (
    <div style={frameStyle(r)}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        padding: '7.4%', display: 'grid', gridTemplateColumns: '1fr 1fr',
      }}>
        <div style={{ marginRight: px(height, 0.055) }}>
          <div style={{ color: '#3955d1', fontWeight: 700, fontSize: px(height, 0.026), letterSpacing: '0.06em' }}>ACCESSIBILITY</div>
          <div style={{ color: '#0b0c0e', fontWeight: 800, fontSize: px(height, 0.081), letterSpacing: '-0.02em' }}>Make this easier for you</div>
          <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.028), marginTop: px(height, 0.013) }}>These changes only affect this screen.</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <AccessibilityRow title="Text size" right="Large" options={['A', 'A', 'A', 'A']} height={height} />
          <AccessibilityRow title="Contrast" right="High" options={['Default', 'High', 'Inverted']} height={height} />
          <AccessibilityRow title="Read aloud" right="On" options={['Off', 'On']} height={height} />
          <AccessibilityRow title="Lower the screen" right="Off" options={['Off', 'On']} height={height} />
          <AccessibilityRow title="Simple mode" right="Off" options={['Off', 'On']} height={height} />
        </div>
      </div>
    </div>
  );
}

/* ════════════════ FEEDBACK / NPS (SMILEY) ════════════════ */

export interface NpsSmileyCfg extends BaseCfg {
  question?: string;
  scale?: number;
  webhookUrl?: string;
  followUp?: boolean;
  idleResetSec?: number;
}

export function NpsSmileyWidget({ config, live = true, height = 480 }: WidgetProps<NpsSmileyCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0b0c0e', textColor: '#fff', accentColor: '#7b5cff', ...c.style });
  const faces = [
    { score: 1, e: '😡', label: 'Bad' },
    { score: 2, e: '🙁', label: 'Okay' },
    { score: 3, e: '😐', label: 'Neutral' },
    { score: 4, e: '🙂', label: 'Good' },
    { score: 5, e: '😍', label: 'Great' },
  ];

  return (
    <div style={frameStyle(r)}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        padding: '7.4%', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center', color: '#fff', textAlign: 'center',
      }}>
        <div style={{ color: '#7b5cff', fontWeight: 700, fontSize: px(height, 0.028), letterSpacing: '0.08em' }}>QUICK FEEDBACK</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.111), letterSpacing: '-0.02em', lineHeight: 1.0, marginTop: px(height, 0.013) }}>{c.question || 'How was your visit?'}</div>
        <div style={{ display: 'flex', marginTop: px(height, 0.055) }}>
          {faces.map((f, i) => (
            <button key={f.score} style={{
              background: '#11161e', border: '2px solid #1c2230', borderRadius: px(height, 0.022),
              padding: `${px(height, 0.0278)}px ${px(height, 0.035)}px`, display: 'flex', flexDirection: 'column',
              alignItems: 'center', cursor: 'pointer', marginRight: i === faces.length - 1 ? 0 : px(height, 0.0278),
            }}>
              <div style={{ fontSize: px(height, 0.111), marginBottom: px(height, 0.013) }}>{f.e}</div>
              <div style={{ color: '#cfd8e3', fontWeight: 700, fontSize: px(height, 0.022) }}>{f.label}</div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: px(height, 0.046), color: '#74767d', fontWeight: 600, fontSize: px(height, 0.022) }}>Anonymous · one tap · takes 2 seconds</div>
      </div>
    </div>
  );
}

/* ════════════════ TRIVIA GAME ════════════════ */

export interface TriviaGameCfg extends BaseCfg {
  deck?: string;
  timeSec?: number;
  rounds?: number;
  mode?: string;
  question?: string;
  options?: string[];
}

export function TriviaGameWidget({ config, live = true, height = 480 }: WidgetProps<TriviaGameCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a1042', textColor: '#ffd54a', accentColor: '#7c4dff', ...c.style });
  const q = c.question || 'Which planet is closest to the Sun?';
  const options = c.options || ['Venus', 'Mercury', 'Mars', 'Jupiter'];

  return (
    <div style={frameStyle(r)}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        padding: '7.4%', color: '#fff', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ marginRight: px(height, 0.0278) }}>
            <div style={{ color: '#ffd54a', fontWeight: 700, fontSize: px(height, 0.028), letterSpacing: '0.08em' }}>TRIVIA · ROUND 3</div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.074), letterSpacing: '-0.02em', marginTop: px(height, 0.0056) }}>{q}</div>
          </div>
          <div style={{
            background: '#2a1f5e', border: '2px solid #ffd54a', borderRadius: px(height, 0.0148),
            padding: `${px(height, 0.0167)}px ${px(height, 0.026)}px`, display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            <div style={{ color: '#ffd54a', fontWeight: 700, fontSize: px(height, 0.0185), letterSpacing: '0.06em' }}>TIME</div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.059), color: '#fff', lineHeight: 1 }}>14</div>
          </div>
        </div>
        <div style={{ flex: 1, marginTop: px(height, 0.037), display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          {options.slice(0, 4).map((o, i) => (
            <div key={i} style={{
              background: '#2a1f5e', border: '2px solid #5d4cc1', borderRadius: px(height, 0.022),
              padding: px(height, 0.037), display: 'flex', alignItems: 'center',
              marginRight: i % 2 === 0 ? px(height, 0.022) : 0, marginBottom: px(height, 0.022),
            }}>
              <div style={{
                width: px(height, 0.081), height: px(height, 0.081), borderRadius: px(height, 0.0185),
                background: '#ffd54a', color: '#1a1042', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontWeight: 800, fontSize: px(height, 0.046), marginRight: px(height, 0.0278),
                flexShrink: 0,
              }}>{String.fromCharCode(65 + i)}</div>
              <div style={{ flex: 1, fontWeight: 700, fontSize: px(height, 0.048) }}>{o}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ SPIN-TO-WIN WHEEL ════════════════ */

export interface SpinPrize { label: string; color: string; }
export interface SpinToWinCfg extends BaseCfg {
  prizes?: SpinPrize[];
  lockoutMethod?: string;
  cooldownHrs?: number;
  qrFollowUp?: boolean;
  intro?: string;
}

const DEFAULT_PRIZES: SpinPrize[] = [
  { label: '10% OFF', color: '#dc2626' },
  { label: 'FREE DRINK', color: '#f59e0b' },
  { label: 'TRY AGAIN', color: '#a3a3a3' },
  { label: 'BUY 1 GET 1', color: '#22c55e' },
  { label: '15% OFF', color: '#3955d1' },
  { label: 'FREE DESSERT', color: '#7c3aed' },
  { label: '5% OFF', color: '#0ea5e9' },
  { label: 'GRAND PRIZE', color: '#ffd54a' },
];

export function SpinToWinWidget({ config, live = true, height = 480 }: WidgetProps<SpinToWinCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fff7ee', textColor: '#dc2626', accentColor: '#a87432', ...c.style });
  const prizes = c.prizes ?? DEFAULT_PRIZES;
  const wheelSize = px(height, 0.74);
  const dur = animDurationSec(r.anim.speed, 6);

  return (
    <div style={frameStyle(r)}>
      {live && r.anim.on && (
        <style>{`@keyframes touchengage_spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      )}
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        padding: '7.4%', display: 'grid', gridTemplateColumns: '1.1fr 1fr', alignItems: 'center',
      }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: px(height, 0.046) }}>
          <svg
            viewBox="-100 -100 200 200"
            width={wheelSize}
            height={wheelSize}
            style={live && r.anim.on ? { animation: `touchengage_spin ${dur}s linear infinite` } : undefined}
          >
            {prizes.slice(0, 8).map((p, i) => {
              const a1 = (i / prizes.length) * 2 * Math.PI - Math.PI / 2;
              const a2 = ((i + 1) / prizes.length) * 2 * Math.PI - Math.PI / 2;
              const x1 = Math.cos(a1) * 100, y1 = Math.sin(a1) * 100;
              const x2 = Math.cos(a2) * 100, y2 = Math.sin(a2) * 100;
              const mid = (a1 + a2) / 2;
              return (
                <g key={i}>
                  <path d={`M0,0 L${x1},${y1} A100,100 0 0,1 ${x2},${y2} Z`} fill={p.color} />
                  <text
                    x={Math.cos(mid) * 60}
                    y={Math.sin(mid) * 60}
                    fontSize="9"
                    fontWeight="700"
                    fill="#fff"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${(mid * 180 / Math.PI) + 90} ${Math.cos(mid) * 60} ${Math.sin(mid) * 60})`}
                  >{p.label}</text>
                </g>
              );
            })}
            <circle r="10" fill="#0b0c0e" />
          </svg>
          <div style={{ position: 'absolute', top: px(height, -0.028), fontSize: px(height, 0.055), transform: 'rotate(180deg)' }}>▼</div>
        </div>
        <div>
          <div style={{ color: '#a87432', fontWeight: 700, fontSize: px(height, 0.028), letterSpacing: '0.08em' }}>{c.intro || 'TONIGHT’S GIVEAWAY'}</div>
          <div style={{ fontWeight: 800, fontSize: px(height, 0.111), letterSpacing: '-0.02em', color: '#1a1410', lineHeight: 1 }}>Spin to win!</div>
          <div style={{ color: '#594631', fontWeight: 600, fontSize: px(height, 0.03), marginTop: px(height, 0.0167) }}>One spin per guest. Tap the wheel.</div>
          <button style={{
            marginTop: px(height, 0.0278), background: '#dc2626', color: '#fff', border: 0, borderRadius: px(height, 0.0167),
            padding: `${px(height, 0.0278)}px ${px(height, 0.055)}px`, fontWeight: 800, fontSize: px(height, 0.044),
          }}>TAP TO SPIN →</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ DIRECTORY SEARCH ════════════════ */

export interface DirectoryEntry { name: string; title: string; where: string; color: string; }
export interface DirectorySearchCfg extends BaseCfg {
  searchOf?: string;
  categories?: string[];
  source?: string;
  showPhotos?: boolean;
  directionsAction?: string;
  entries?: DirectoryEntry[];
}

const DEFAULT_DIR: DirectoryEntry[] = [
  { name: 'Dr. Aisha Pereira', title: 'Cardiology', where: 'Heart Institute · 4-North', color: '#13a6ad' },
  { name: 'Dr. Marcus Chen', title: 'Cardiology', where: 'Heart Institute · 4-North', color: '#3955d1' },
  { name: 'Dr. Lila Park', title: 'Cardiology', where: 'East Tower · 2-South', color: '#dc2626' },
];

export function DirectorySearchWidget({ config, live = true, height = 480 }: WidgetProps<DirectorySearchCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fff', textColor: '#0b0c0e', accentColor: '#3955d1', ...c.style });
  const entries = c.entries ?? DEFAULT_DIR;
  const chips = ['Cardiology', 'Pediatrics', 'Orthopedics', 'Family Medicine', 'Radiology', 'Dermatology', 'OB-GYN'];

  return (
    <div style={frameStyle(r)}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        padding: '7.4%', display: 'grid', gridTemplateColumns: '1fr 1fr',
      }}>
        <div style={{ marginRight: px(height, 0.037) }}>
          <div style={{ color: '#3955d1', fontWeight: 700, fontSize: px(height, 0.028), letterSpacing: '0.08em' }}>DIRECTORY</div>
          <div style={{ color: '#0b0c0e', fontWeight: 800, fontSize: px(height, 0.093), letterSpacing: '-0.02em' }}>Find a {c.searchOf || 'doctor'}</div>
          <div style={{
            marginTop: px(height, 0.022), background: '#fafaf7', border: '2px solid #e7e6e1', borderRadius: px(height, 0.0167),
            padding: `${px(height, 0.024)}px ${px(height, 0.0278)}px`, display: 'flex', alignItems: 'center',
          }}>
            <div style={{ fontSize: px(height, 0.031), marginRight: px(height, 0.0167) }}>🔍</div>
            <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.031) }}>Search by name or specialty…</div>
          </div>
          <div style={{ marginTop: px(height, 0.022), display: 'flex', flexWrap: 'wrap' }}>
            {chips.map((t, i) => (
              <span key={i} style={{
                background: i === 0 ? '#3955d1' : '#fff', color: i === 0 ? '#fff' : '#404249',
                border: '1px solid #e7e6e1', padding: `${px(height, 0.013)}px ${px(height, 0.0185)}px`,
                borderRadius: 999, fontWeight: 700, fontSize: px(height, 0.022),
                marginRight: px(height, 0.0093), marginBottom: px(height, 0.0093),
              }}>{t}</span>
            ))}
          </div>
        </div>
        <div style={{
          background: '#fafaf7', border: '1px solid #e7e6e1', borderRadius: px(height, 0.022),
          padding: px(height, 0.0296), display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.02), letterSpacing: '0.06em', marginBottom: px(height, 0.0167) }}>3 MATCHES</div>
          {entries.slice(0, 3).map((d, i) => (
            <div key={i} style={{
              background: '#fff', border: '1px solid #e7e6e1', borderRadius: px(height, 0.0148),
              padding: `${px(height, 0.022)}px ${px(height, 0.024)}px`, display: 'flex', alignItems: 'center',
              marginBottom: px(height, 0.0167),
            }}>
              <div style={{
                width: px(height, 0.074), height: px(height, 0.074), borderRadius: '50%',
                background: d.color, color: '#fff', fontWeight: 800, fontSize: px(height, 0.0278),
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: px(height, 0.0185), flexShrink: 0,
              }}>{d.name.split(' ').map(x => x[0]).slice(0, 2).join('')}</div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#0b0c0e', fontWeight: 700, fontSize: px(height, 0.0278) }}>{d.name}</div>
                <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.0185) }}>{d.title} · {d.where}</div>
              </div>
              <div style={{
                background: '#3955d1', color: '#fff', padding: `${px(height, 0.011)}px ${px(height, 0.0167)}px`,
                borderRadius: px(height, 0.0093), fontWeight: 700, fontSize: px(height, 0.0185),
              }}>Directions →</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ WAYFINDING FLOOR MAP ════════════════ */

export interface WayfindingFloorMapCfg extends BaseCfg {
  floors?: number[];
  currentFloor?: number;
  youAreHere?: { x: number; y: number };
  destinations?: unknown[];
  mapAsset?: string | null;
  allowSendToPhone?: boolean;
}

export function WayfindingFloorMapWidget({ config, live = true, height = 480 }: WidgetProps<WayfindingFloorMapCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0b0c0e', textColor: '#fff', accentColor: '#7b5cff', ...c.style });
  const floors = c.floors ?? [1, 2, 3, 4, 5];
  const currentFloor = c.currentFloor ?? 2;

  return (
    <div style={frameStyle(r)}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        padding: '5.5%', display: 'grid', gridTemplateColumns: '1fr 18.75%',
      }}>
        <div style={{
          background: '#11161e', border: '1px solid #1c2230', borderRadius: px(height, 0.0167),
          position: 'relative', overflow: 'hidden', marginRight: px(height, 0.0278),
        }}>
          {/* Schematic floorplan */}
          <svg viewBox="0 0 1000 600" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
            <rect x="40" y="60" width="280" height="180" rx="8" fill="#1c2230" stroke="#39455d" />
            <rect x="340" y="60" width="220" height="180" rx="8" fill="#1c2230" stroke="#39455d" />
            <rect x="580" y="60" width="380" height="180" rx="8" fill="#1c2230" stroke="#39455d" />
            <rect x="40" y="320" width="380" height="240" rx="8" fill="#1c2230" stroke="#39455d" />
            <rect x="440" y="320" width="280" height="240" rx="8" fill="#1c2230" stroke="#39455d" />
            <rect x="740" y="320" width="220" height="240" rx="8" fill="#1c2230" stroke="#39455d" />
            <text x="180" y="155" fill="#9aa3b2" fontSize="18" textAnchor="middle">Lobby</text>
            <text x="450" y="155" fill="#9aa3b2" fontSize="18" textAnchor="middle">Reception</text>
            <text x="770" y="155" fill="#9aa3b2" fontSize="18" textAnchor="middle">Cardiology</text>
            <text x="230" y="445" fill="#9aa3b2" fontSize="18" textAnchor="middle">Imaging</text>
            <text x="580" y="445" fill="#9aa3b2" fontSize="18" textAnchor="middle">Pharmacy</text>
            <text x="850" y="445" fill="#9aa3b2" fontSize="18" textAnchor="middle">Café</text>
            {/* Route */}
            <path d="M 180,500 L 180,400 L 580,400 L 580,150" stroke="#7b5cff" strokeWidth="6" strokeDasharray="14 10" fill="none" />
            <circle cx="180" cy="500" r="14" fill="#22c55e" />
            <circle cx="580" cy="150" r="14" fill="#dc2626" />
          </svg>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: px(height, 0.0148) }}>
            <div style={{ color: '#7b5cff', fontWeight: 700, fontSize: px(height, 0.022), letterSpacing: '0.08em' }}>WAYFINDING</div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.05), lineHeight: 1, letterSpacing: '-0.02em' }}>You are here<br /><span style={{ color: '#22c55e' }}>● Lobby</span></div>
          </div>
          <div style={{
            background: '#11161e', border: '1px solid #1c2230', borderRadius: px(height, 0.0148),
            padding: `${px(height, 0.0167)}px ${px(height, 0.0204)}px`, marginBottom: px(height, 0.0148),
          }}>
            <div style={{ color: '#9aa3b2', fontSize: px(height, 0.0167), fontWeight: 700, letterSpacing: '0.06em' }}>FLOOR</div>
            <div style={{ display: 'flex', marginTop: px(height, 0.0074) }}>
              {floors.map((f, i) => (
                <div key={f} style={{
                  flex: 1, padding: `${px(height, 0.013)}px 0`, textAlign: 'center', borderRadius: px(height, 0.0093),
                  background: f === currentFloor ? '#7b5cff' : '#1c2230', color: '#fff', fontWeight: 700, fontSize: px(height, 0.022),
                  marginRight: i === floors.length - 1 ? 0 : px(height, 0.0074),
                }}>{f}</div>
              ))}
            </div>
          </div>
          <div style={{
            background: '#11161e', border: '1px solid #1c2230', borderRadius: px(height, 0.0148),
            padding: `${px(height, 0.0167)}px ${px(height, 0.0204)}px`, color: '#fff', marginBottom: px(height, 0.0148),
          }}>
            <div style={{ color: '#9aa3b2', fontSize: px(height, 0.0167), fontWeight: 700, letterSpacing: '0.06em' }}>DESTINATION</div>
            <div style={{ fontWeight: 700, fontSize: px(height, 0.026), marginTop: px(height, 0.0056) }}>● Cardiology · Suite 412</div>
            <div style={{ color: '#9aa3b2', fontSize: px(height, 0.0167), fontWeight: 600, marginTop: px(height, 0.0037) }}>3 min walk · elevator B</div>
          </div>
          <div style={{
            marginTop: 'auto', background: '#22c55e', color: '#0b0c0e', borderRadius: px(height, 0.013),
            padding: `${px(height, 0.022)}px ${px(height, 0.024)}px`, fontWeight: 800, fontSize: px(height, 0.026), textAlign: 'center',
          }}>Send to my phone →</div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ DONATION THERMOMETER (universal) ════════════════ */

export interface DonationThermometerCfg extends BaseCfg {
  label?: string;
  title?: string;
  goal?: number;
  raised?: number;
  donors?: number;
  daysLeft?: number;
  qrLabel?: string;
  qrUrl?: string;
  source?: string;
}

export function DonationThermometerWidget({ config, live = true, height = 480 }: WidgetProps<DonationThermometerCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fdfaf3', textColor: '#dc2626', accentColor: '#dc2626', ...c.style });
  const goal = c.goal ?? 50000;
  const raised = c.raised ?? 32800;
  const pct = Math.min(1, raised / goal);

  return (
    <div style={frameStyle(r)}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        padding: '7.4%', display: 'flex', flexDirection: 'column',
      }}>
        <div>
          <div style={{ color: '#dc2626', fontWeight: 700, fontSize: px(height, 0.028), letterSpacing: '0.08em' }}>{(c.label || 'FUNDRAISER').toUpperCase()}</div>
          <div style={{ color: '#0b0c0e', fontWeight: 800, fontSize: px(height, 0.102), letterSpacing: '-0.02em' }}>{c.title || 'Help us build the playground'}</div>
        </div>
        <div style={{ flex: 1, marginTop: px(height, 0.0278), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ marginRight: px(height, 0.074) }}>
            <div style={{ display: 'flex', alignItems: 'baseline' }}>
              <div style={{ color: '#dc2626', fontWeight: 800, fontSize: px(height, 0.185), letterSpacing: '-0.04em', lineHeight: 1, marginRight: px(height, 0.0185) }}>{Math.round(pct * 100)}%</div>
              <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.031) }}>of goal</div>
            </div>
            <div style={{ marginTop: px(height, 0.0167), color: '#0b0c0e', fontWeight: 800, fontSize: px(height, 0.059) }}>${raised.toLocaleString()}</div>
            <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.028) }}>of ${goal.toLocaleString()} goal</div>
            <div style={{ marginTop: px(height, 0.022), height: px(height, 0.03), background: '#efeeea', borderRadius: px(height, 0.0148), overflow: 'hidden' }}>
              <div style={{ width: `${pct * 100}%`, height: '100%', background: 'linear-gradient(90deg, #ff6b7a, #dc2626)' }} />
            </div>
            <div style={{ color: '#74767d', fontSize: px(height, 0.022), fontWeight: 600, marginTop: px(height, 0.013) }}>{c.donors ?? 246} donors · {c.daysLeft ?? 14} days left</div>
          </div>
          <div style={{
            background: '#fff', border: '1px solid #e7e6e1', borderRadius: px(height, 0.022),
            padding: px(height, 0.0278), display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            <div style={{ width: px(height, 0.278), height: px(height, 0.278), background: 'repeating-conic-gradient(#000 0% 10%, #fff 0% 20%)', borderRadius: px(height, 0.0093), marginBottom: px(height, 0.013) }} />
            <div style={{ color: '#0b0c0e', fontWeight: 700, fontSize: px(height, 0.022) }}>{c.qrLabel || 'donate.school.org'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
