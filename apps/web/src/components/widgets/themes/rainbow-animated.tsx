"use client";

/**
 * rainbow-animated theme — every widget is its own component, sized to
 * its zone via the transform:scale-to-fit pattern, with the SAME exact
 * pixel-for-pixel design as the locked-in AnimatedWelcomeWidget
 * (commit dc80f51 / APPROVED 2026-04-19).
 *
 * Each component:
 *   - Has a fixed natural canvas (e.g. clock = 180×180px) with all
 *     interior sizes in absolute pixels — copied verbatim from the
 *     monolithic gold-standard component.
 *   - Wraps in a measuring container that scales the canvas to fit
 *     whatever zone the user drags it into.
 *   - Includes its own keyframe animations scoped via a unique class
 *     prefix so multiple themes can coexist without leaking.
 *
 * This is the multi-zone, individually-editable, drag-and-droppable
 * version of the locked-in monolith. Every piece is now a real zone
 * the user can select, move, resize, and edit independently in the
 * builder — exactly what was originally asked for.
 */

import { useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────
// Shared scale-to-fit hook — used by every component below
// ─────────────────────────────────────────────────────────────────
function useScaleToFit(naturalW: number, naturalH: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / naturalW, h / naturalH));
    };
    compute();
    const r1 = requestAnimationFrame(compute);
    const r2 = requestAnimationFrame(() => requestAnimationFrame(compute));
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); ro.disconnect(); };
  }, [naturalW, naturalH]);
  return { ref, scale };
}

// Wraps a fixed-size inner canvas in a centered measuring container
// Note: All text nodes within this theme use whiteSpace: 'pre-wrap' to preserve newlines
function ScaleWrap({ naturalW, naturalH, children, bg }: {
  naturalW: number; naturalH: number; children: React.ReactNode; bg?: string;
}) {
  const { ref, scale } = useScaleToFit(naturalW, naturalH);
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: bg || 'transparent',
      }}
    >
      <div
        style={{
          width: naturalW, height: naturalH,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Inject the keyframes once globally (idempotent)
function GlobalAnimations() {
  return (
    <style suppressHydrationWarning>{ANIM_CSS}</style>
  );
}

const ANIM_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;700&family=Caveat:wght@700&family=Patrick+Hand&display=swap');
@keyframes rar-bounceLogo {
  0%, 100% { transform: translateY(0) rotate(-4deg); }
  50% { transform: translateY(-12px) rotate(4deg); }
}
@keyframes rar-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.025); } }
@keyframes rar-gradientShift { from { background-position: 0% 50%; } to { background-position: 300% 50%; } }
@keyframes rar-wiggle {
  0%, 7%, 100% { transform: rotate(0deg); }
  1%, 5% { transform: rotate(-12deg); }
  3% { transform: rotate(12deg); }
}
@keyframes rar-spin { to { transform: rotate(360deg); } }
@keyframes rar-floatUp {
  0%, 100% { transform: translateY(0) rotate(-1deg); }
  50% { transform: translateY(-10px) rotate(1deg); }
}
@keyframes rar-shake {
  0%, 100% { transform: rotate(-8deg); }
  20%, 60% { transform: rotate(10deg); }
  40%, 80% { transform: rotate(-10deg); }
}
@keyframes rar-twinkle {
  0%, 100% { opacity: .25; transform: scale(.8) rotate(0deg); }
  50% { opacity: 1; transform: scale(1.2) rotate(20deg); }
}
@keyframes rar-bounceNum {
  0%, 100% { transform: scale(1) rotate(-3deg); }
  50% { transform: scale(1.06) rotate(3deg); }
}
@keyframes rar-slideX {
  0%, 100% { transform: rotate(-3deg) translateX(-4px); }
  50% { transform: rotate(-3deg) translateX(4px); }
}
@keyframes rar-bob {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50% { transform: translateY(-10px) rotate(3deg); }
}
@keyframes rar-scrollText {
  from { transform: translateX(100%); }
  to   { transform: translateX(-100%); }
}
.rar-stage { font-family: 'Fredoka', ui-rounded, system-ui, sans-serif; }
`;

// ─────────────────────────────────────────────────────────────────
// LOGO — bouncing emoji in white circle with yellow ring
// ─────────────────────────────────────────────────────────────────
export function RainbowAnimatedLogo({ config }: { config: any }) {
  const emoji = config.logoEmoji || config.emoji || '🍎';
  return (
    <ScaleWrap naturalW={180} naturalH={180}>
      <GlobalAnimations />
      <div className="rar-stage" style={{
        width: 180, height: 180, background: '#fff', borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 96,
        boxShadow: '0 6px 16px rgba(0,0,0,.18), inset 0 0 0 6px #fcd34d',
        animation: 'rar-bounceLogo 2.4s ease-in-out infinite',
      }}>{emoji}</div>
    </ScaleWrap>
  );
}

// ─────────────────────────────────────────────────────────────────
// TITLE BANNER — white card with pink dashed border, breathing scale,
// gradient-shifting headline
// ─────────────────────────────────────────────────────────────────
export function RainbowAnimatedTitle({ config }: { config: any }) {
  const title = config.content || config.title || 'Welcome, Friends!';
  const subtitle = config.subtitle || 'today is going to be amazing ✨';
  return (
    <ScaleWrap naturalW={1320} naturalH={180}>
      <GlobalAnimations />
      <div className="rar-stage" style={{
        width: 1320, height: 180,
        background: 'rgba(255,255,255,.85)', backdropFilter: 'blur(4px)',
        borderRadius: 28, padding: '28px 36px', textAlign: 'center',
        boxShadow: '0 8px 24px rgba(0,0,0,.12)',
        border: '5px dashed #ec4899',
        animation: 'rar-breathe 3.5s ease-in-out infinite',
        boxSizing: 'border-box',
      }}>
        <h1 style={{
          margin: 0, lineHeight: .95, fontWeight: 700, fontSize: 110,
          background: 'linear-gradient(90deg, #ec4899 0%, #f59e0b 33%, #10b981 66%, #6366f1 100%)',
          backgroundSize: '300% 100%',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          animation: 'rar-gradientShift 6s linear infinite',
        }}>{title}</h1>
        <div style={{ fontFamily: "'Caveat', cursive", fontSize: 44, color: '#92400e', marginTop: 6 }}>{subtitle}</div>
      </div>
    </ScaleWrap>
  );
}

// ─────────────────────────────────────────────────────────────────
// CLOCK — wiggling white circle with yellow ring
// ─────────────────────────────────────────────────────────────────
export function RainbowAnimatedClock({ config }: { config: any }) {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);
  const hh = ((now.getHours() + 11) % 12) + 1;
  const mm = now.getMinutes().toString().padStart(2, '0');
  const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
  return (
    <ScaleWrap naturalW={180} naturalH={180}>
      <GlobalAnimations />
      <div className="rar-stage" style={{
        width: 180, height: 180, background: '#fff', borderRadius: '50%', border: '10px solid #fcd34d',
        boxShadow: '0 6px 16px rgba(0,0,0,.2)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, animation: 'rar-wiggle 4s ease-in-out infinite',
        boxSizing: 'border-box',
      }}>
        <div style={{ fontSize: 56, color: '#be185d', lineHeight: 1 }}>{hh}:{mm}</div>
        <div style={{ fontSize: 28, color: '#92400e' }}>{ampm}</div>
      </div>
    </ScaleWrap>
  );
}

// ─────────────────────────────────────────────────────────────────
// WEATHER — sun with spinning rays + big temp face
// ─────────────────────────────────────────────────────────────────
export function RainbowAnimatedWeather({ config }: { config: any }) {
  const temp = config.weatherTemp || config.temp || '68°';
  const desc = config.weatherDesc || config.desc || '~ sunny + crisp ~';
  return (
    <ScaleWrap naturalW={320} naturalH={340}>
      <GlobalAnimations />
      <div className="rar-stage" style={{
        width: 320, height: 340, position: 'relative',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ position: 'relative', width: 260, height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            position: 'absolute', inset: -50, borderRadius: '50%',
            background: 'conic-gradient(from 0deg, transparent 0 18deg, #fcd34d 18deg 24deg, transparent 24deg 48deg, #fcd34d 48deg 54deg, transparent 54deg 78deg, #fcd34d 78deg 84deg, transparent 84deg 108deg, #fcd34d 108deg 114deg, transparent 114deg 138deg, #fcd34d 138deg 144deg, transparent 144deg 168deg, #fcd34d 168deg 174deg, transparent 174deg 198deg, #fcd34d 198deg 204deg, transparent 204deg 228deg, #fcd34d 228deg 234deg, transparent 234deg 258deg, #fcd34d 258deg 264deg, transparent 264deg 288deg, #fcd34d 288deg 294deg, transparent 294deg 318deg, #fcd34d 318deg 324deg, transparent 324deg 348deg, #fcd34d 348deg 354deg, transparent 354deg 360deg)',
            WebkitMask: 'radial-gradient(circle, transparent 130px, #000 130px, #000 165px, transparent 165px)',
            mask: 'radial-gradient(circle, transparent 130px, #000 130px, #000 165px, transparent 165px)',
            animation: 'rar-spin 18s linear infinite', opacity: .85,
          }} />
          <div style={{
            width: 230, height: 230, borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 70%, #d97706)',
            boxShadow: '0 0 60px rgba(251, 191, 36, .65), inset 0 -12px 20px rgba(180, 83, 9, .25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 76, color: '#7c2d12',
            textShadow: '0 2px 0 rgba(255,255,255,.4)',
          }}>{temp}</div>
        </div>
        <div style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 52, color: '#78350f', marginTop: 18, textAlign: 'center', textShadow: '0 2px 0 rgba(255,255,255,.7)' }}>{desc}</div>
      </div>
    </ScaleWrap>
  );
}

// ─────────────────────────────────────────────────────────────────
// ANNOUNCEMENT — cloud puff (no card!) + shaking megaphone + twinkling stars
// ─────────────────────────────────────────────────────────────────
export function RainbowAnimatedAnnouncement({ config }: { config: any }) {
  const label = config.announcementLabel || config.label || 'Big News';
  const message = config.message || config.announcementMessage || 'Book Fair starts Monday! 📚';
  return (
    <ScaleWrap naturalW={1100} naturalH={460}>
      <GlobalAnimations />
      <div className="rar-stage" style={{
        width: 1100, height: 460, position: 'relative',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center',
        padding: '50px 80px', boxSizing: 'border-box',
        animation: 'rar-floatUp 4s ease-in-out infinite',
      }}>
        {/* Cloud puff via overlapping circles + box-shadow */}
        <div style={{
          content: '', position: 'absolute', left: '50%', top: '50%',
          width: 280, height: 200, transform: 'translate(-50%, -50%)',
          background: '#fff', borderRadius: '50%',
          boxShadow:
            '-190px 30px 0 -10px #fff, -130px -50px 0 -8px #fff, -50px -90px 0 -2px #fff, 60px -90px 0 -4px #fff, 150px -50px 0 -8px #fff, 200px 30px 0 -10px #fff, 120px 70px 0 -6px #fff, 0 90px 0 -2px #fff, -120px 70px 0 -6px #fff, 0 0 0 4px #fcd34d, -190px 30px 0 -6px #fcd34d, -130px -50px 0 -4px #fcd34d, -50px -90px 0 2px #fcd34d, 60px -90px 0 0 #fcd34d, 150px -50px 0 -4px #fcd34d, 200px 30px 0 -6px #fcd34d, 120px 70px 0 -2px #fcd34d, 0 90px 0 2px #fcd34d, -120px 70px 0 -2px #fcd34d, 0 16px 32px rgba(0,0,0,.18)',
          zIndex: -1,
        }} />
        {/* Twinkling stars */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
          <span style={{ position: 'absolute', top: 50, left: 130, fontSize: 44, opacity: .9, animation: 'rar-twinkle 1.4s ease-in-out infinite' }}>⭐</span>
          <span style={{ position: 'absolute', top: 80, right: 140, fontSize: 44, opacity: .9, animation: 'rar-twinkle 1.4s ease-in-out infinite .3s' }}>✨</span>
          <span style={{ position: 'absolute', bottom: 80, left: 160, fontSize: 44, opacity: .9, animation: 'rar-twinkle 1.4s ease-in-out infinite .6s' }}>🌟</span>
          <span style={{ position: 'absolute', bottom: 60, right: 180, fontSize: 44, opacity: .9, animation: 'rar-twinkle 1.4s ease-in-out infinite .9s' }}>💫</span>
        </div>
        <div style={{ fontSize: 96, lineHeight: 1, animation: 'rar-shake 1.6s ease-in-out infinite', transformOrigin: '80% 80%' }}>📣</div>
        <div style={{ fontWeight: 700, fontSize: 28, letterSpacing: '.25em', color: '#b45309', textTransform: 'uppercase', marginTop: 12 }}>{label}</div>
        <div style={{ fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 90, color: '#be185d', lineHeight: 1.05, marginTop: 18, textShadow: '2px 2px 0 #fff', maxWidth: 800 }}>{message}</div>
      </div>
    </ScaleWrap>
  );
}

// ─────────────────────────────────────────────────────────────────
// COUNTDOWN — 12-point starburst with bouncing number
// ─────────────────────────────────────────────────────────────────
export function RainbowAnimatedCountdown({ config }: { config: any }) {
  const label = config.label || config.countdownLabel || 'Field Trip in';
  const num = config.countdownNumber ?? config.daysLeft ?? 3;
  const unit = config.countdownUnit || config.unit || 'days';
  return (
    <ScaleWrap naturalW={300} naturalH={300}>
      <GlobalAnimations />
      <div className="rar-stage" style={{ width: 300, height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <div style={{
          width: 280, height: 280,
          background: 'radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 75%, #d97706)',
          clipPath: 'polygon(50% 0%, 60% 12%, 75% 8%, 73% 23%, 88% 25%, 80% 38%, 96% 45%, 84% 55%, 96% 65%, 80% 70%, 88% 82%, 73% 80%, 75% 96%, 60% 88%, 50% 100%, 40% 88%, 25% 96%, 27% 80%, 12% 82%, 20% 70%, 4% 65%, 16% 55%, 4% 45%, 20% 38%, 12% 25%, 27% 23%, 25% 8%, 40% 12%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
          boxShadow: '0 12px 28px rgba(0,0,0,.18)',
          animation: 'rar-bounceNum 1.6s ease-in-out infinite',
        }}>
          <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: '.08em', color: '#7c2d12', textTransform: 'uppercase', maxWidth: 150, lineHeight: 1.1 }}>{label}</div>
          <div style={{ fontWeight: 700, fontSize: 84, lineHeight: .9, color: '#7c2d12', textShadow: '0 3px 0 rgba(255,255,255,.5)', margin: '6px 0' }}>{num}</div>
          <div style={{ fontFamily: "'Caveat', cursive", fontSize: 32, color: '#7c2d12' }}>{unit}</div>
        </div>
      </div>
    </ScaleWrap>
  );
}

// ─────────────────────────────────────────────────────────────────
// STAFF SPOTLIGHT — polaroid with washi-tape caption above
// ─────────────────────────────────────────────────────────────────
export function RainbowAnimatedStaff({ config }: { config: any }) {
  const photoUrl = config.assetUrl || config.photoUrl || config.teacherPhotoUrl;
  const emoji = config.teacherEmoji || config.emoji || '👩‍🏫';
  const name = config.staffName || config.teacherName || config.name || 'Mrs. Johnson';
  const role = config.role || config.teacherRole || 'Teacher of the Week';
  return (
    <ScaleWrap naturalW={280} naturalH={360}>
      <GlobalAnimations />
      <div className="rar-stage" style={{ width: 280, height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <div style={{
          background: '#fff', padding: '18px 18px 60px', width: 260, position: 'relative',
          boxShadow: '0 12px 24px rgba(0,0,0,.22)',
          transform: 'rotate(-3deg)',
          animation: 'rar-slideX 5s ease-in-out infinite',
          boxSizing: 'border-box',
        }}>
          {/* Washi tape banner with role caption */}
          <div style={{
            position: 'absolute', top: -22, left: '50%',
            transform: 'translateX(-50%) rotate(-3deg)',
            minWidth: '90%', padding: '8px 18px',
            background: 'repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 6px, transparent 6px 12px), #f9a8d4',
            boxShadow: '0 2px 6px rgba(0,0,0,.22)',
            fontWeight: 700, fontSize: 18, letterSpacing: '.14em', textTransform: 'uppercase',
            color: '#831843', textAlign: 'center',
            textShadow: '0 1px 0 rgba(255,255,255,.4)',
            whiteSpace: 'nowrap', zIndex: 2,
          }}>{role}</div>
          {/* Photo or emoji */}
          <div style={{
            width: '100%', aspectRatio: '1',
            background: 'linear-gradient(135deg, #fce7f3, #ddd6fe)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 120, overflow: 'hidden',
          }}>
            {photoUrl ? <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span>{emoji}</span>}
          </div>
          {/* Name */}
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 20, textAlign: 'center',
            fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize: 32, color: '#6d28d9', lineHeight: 1,
          }}>{name}</div>
        </div>
      </div>
    </ScaleWrap>
  );
}

// ─────────────────────────────────────────────────────────────────
// BIRTHDAYS — balloon cluster + cake + dynamic name list
// ─────────────────────────────────────────────────────────────────
export function RainbowAnimatedBirthdays({ config }: { config: any }) {
  const raw = config.birthdayNames ?? config.names;
  const list: string[] = Array.isArray(raw) ? raw.filter(Boolean)
    : (typeof raw === 'string' ? raw.split(/[,·\n]+/).map(s => s.trim()).filter(Boolean) : ['Maya', 'Eli', 'Sofia']);
  const fontSize = list.length <= 2 ? 56 : list.length <= 4 ? 44 : list.length <= 6 ? 36 : 30;
  return (
    <ScaleWrap naturalW={300} naturalH={360}>
      <GlobalAnimations />
      <div className="rar-stage" style={{
        width: 300, height: 360,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        position: 'relative', padding: 12, boxSizing: 'border-box',
      }}>
        <div style={{ position: 'relative', width: 200, height: 160, animation: 'rar-bob 1.4s ease-in-out infinite' }}>
          <div style={{ position: 'absolute', left: 10, top: 0, width: 70, height: 88, borderRadius: '50% 50% 48% 48%', background: '#f87171', boxShadow: 'inset -8px -10px 12px rgba(0,0,0,.18), 0 4px 8px rgba(0,0,0,.18)' }}>
            <div style={{ position: 'absolute', left: '50%', top: '100%', width: 1, height: 50, background: 'rgba(0,0,0,.4)', transform: 'translateX(-50%)' }} />
          </div>
          <div style={{ position: 'absolute', left: 60, top: 12, width: 64, height: 80, borderRadius: '50% 50% 48% 48%', background: '#fbbf24', transform: 'rotate(-6deg)', boxShadow: 'inset -8px -10px 12px rgba(0,0,0,.18), 0 4px 8px rgba(0,0,0,.18)' }}>
            <div style={{ position: 'absolute', left: '50%', top: '100%', width: 1, height: 50, background: 'rgba(0,0,0,.4)', transform: 'translateX(-50%)' }} />
          </div>
          <div style={{ position: 'absolute', left: 115, top: 0, width: 70, height: 88, borderRadius: '50% 50% 48% 48%', background: '#ec4899', boxShadow: 'inset -8px -10px 12px rgba(0,0,0,.18), 0 4px 8px rgba(0,0,0,.18)' }}>
            <div style={{ position: 'absolute', left: '50%', top: '100%', width: 1, height: 50, background: 'rgba(0,0,0,.4)', transform: 'translateX(-50%)' }} />
          </div>
          <div style={{ position: 'absolute', bottom: -12, left: '50%', transform: 'translateX(-50%)', fontSize: 50, lineHeight: 1 }}>🎂</div>
        </div>
        <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: '.12em', color: '#be185d', textTransform: 'uppercase', marginTop: 18, textShadow: '0 2px 0 rgba(255,255,255,.7)' }}>Today's Birthdays</div>
        <div style={{
          fontFamily: "'Caveat', cursive", fontWeight: 700, fontSize, color: '#831843',
          lineHeight: 1.05, textShadow: '0 2px 0 rgba(255,255,255,.7)', marginTop: 6, whiteSpace: 'nowrap',
        }}>{list.join(' · ')}</div>
      </div>
    </ScaleWrap>
  );
}

// ─────────────────────────────────────────────────────────────────
// TICKER — wavy yellow ribbon with pink stamp + scrolling text
// ─────────────────────────────────────────────────────────────────
export function RainbowAnimatedTicker({ config }: { config: any }) {
  const stamp = config.tickerStamp || config.label || 'SCHOOL NEWS';
  const raw = config.messages ?? config.tickerMessages;
  const list: string[] = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(/\n+/).filter(Boolean) : []);
  const text = list.length ? list.join('  ·  ') : 'Welcome back, Stars! · Picture day is Friday · Reading Challenge: 20 minutes a day';
  return (
    <ScaleWrap naturalW={1920} naturalH={110}>
      <GlobalAnimations />
      <div className="rar-stage" style={{
        width: 1920, height: 110,
        background: 'linear-gradient(90deg, #fcd34d, #fbbf24)',
        display: 'flex', alignItems: 'center', overflow: 'hidden',
        borderTop: '5px solid #ec4899',
        boxShadow: '0 -4px 12px rgba(0,0,0,.12)',
        clipPath: 'polygon(0% 16%, 5% 0%, 10% 16%, 15% 0%, 20% 16%, 25% 0%, 30% 16%, 35% 0%, 40% 16%, 45% 0%, 50% 16%, 55% 0%, 60% 16%, 65% 0%, 70% 16%, 75% 0%, 80% 16%, 85% 0%, 90% 16%, 95% 0%, 100% 16%, 100% 100%, 0% 100%)',
      }}>
        <div style={{
          flex: '0 0 auto', padding: '0 36px', height: '100%',
          background: '#ec4899', color: '#fff', display: 'flex', alignItems: 'center',
          fontWeight: 700, letterSpacing: '.15em', fontSize: 26,
          marginTop: 18, position: 'relative', zIndex: 2,
        }}>{stamp}</div>
        <div style={{ flex: 1, height: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center', marginTop: 18, position: 'relative' }}>
          <span style={{
            display: 'inline-block', fontWeight: 700, fontSize: 44, color: '#831843',
            whiteSpace: 'nowrap', paddingLeft: 60,
            animation: 'rar-scrollText 28s linear infinite', willChange: 'transform',
          }}>{text}</span>
        </div>
      </div>
    </ScaleWrap>
  );
}
