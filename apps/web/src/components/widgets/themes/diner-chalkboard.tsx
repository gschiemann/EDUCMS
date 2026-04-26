"use client";

/**
 * Diner Chalkboard — scene-integrated cafeteria theme.
 *
 * Widgets render AS scene elements on a chalkboard wall:
 *   - LUNCH_MENU → chalk-written menu items
 *   - TEXT       → chalk lettering header
 *   - CLOCK     → retro chrome diner clock
 *   - COUNTDOWN → chalk countdown on a small slate
 *   - TICKER    → neon-style scrolling sign
 *   - ANNOUNCEMENT → "daily special" tent card
 *   - IMAGE_CAROUSEL → polaroid food photos pinned to cork strip
 *   - CALENDAR  → chalk schedule on a mini board
 *   - STAFF_SPOTLIGHT → "Employee of the Month" framed photo
 *   - LOGO      → round diner badge
 *   - WEATHER   → small chalkboard sign
 */

import { useEffect, useState } from 'react';
import { resolveCountdownTarget } from '../countdown-utils';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '') : 'http://localhost:8080';
function resolveUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
  return `${API_BASE}${url}`;
}

// ─── Palette ────────────────────────────────────────────
export const DC = {
  board:       '#2C3E2D',
  boardDk:     '#1E2B1F',
  boardLt:     '#3A5240',
  chalk:       '#F0EDE5',
  chalkSoft:   'rgba(240,237,229,0.72)',
  chalkFaint:  'rgba(240,237,229,0.25)',
  neonRed:     '#FF6B6B',
  neonYellow:  '#FECA57',
  neonTeal:    '#00CEC9',
  wood:        '#8B6914',
  woodLight:   '#C49A3C',
  woodDark:    '#5C4A12',
  counter:     '#D4A76A',
  counterDk:   '#A67C3D',
  inkDark:     '#2D2D2D',
  warmWhite:   '#FFF8E7',
  red:         '#E74C3C',
  green:       '#27AE60',
};

export const DC_FONT_CHALK   = "var(--font-caveat), 'Segoe Script', cursive";
export const DC_FONT_DISPLAY = "var(--font-fredoka), ui-rounded, system-ui, sans-serif";

// ═══════════════════════════════════════════════════════════
// CHALK TEXT — header lettering on the chalkboard
// ═══════════════════════════════════════════════════════════
export function DinerChalkboardText({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const content = config.content || "Today's Menu";
  const align = (config.alignment || 'center') as 'left' | 'center' | 'right';
  return (
    <div className="absolute inset-0 overflow-hidden" style={{
      background: `
        radial-gradient(ellipse at 30% 40%, rgba(255,255,255,0.04) 0%, transparent 60%),
        radial-gradient(ellipse at 70% 70%, rgba(0,0,0,0.08) 0%, transparent 55%),
        linear-gradient(135deg, ${DC.board} 0%, ${DC.boardDk} 60%, #1A2A1C 100%)`,
      borderRadius: 8,
      boxShadow: 'inset 0 0 50px rgba(0,0,0,0.25)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '4% 6%',
    }}>
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: '12%',
        background: 'linear-gradient(180deg, transparent 0%, rgba(240,237,229,0.08) 100%)',
        pointerEvents: 'none',
      }} />
      <div data-field="content" style={{
        position: 'relative',
        fontFamily: DC_FONT_CHALK,
        fontSize: '4em',
        fontWeight: 700,
        color: DC.chalk,
        textAlign: align,
        lineHeight: 1.05,
        width: '100%',
        textShadow: `0 0 2px ${DC.chalkSoft}, 0 0 10px rgba(240,237,229,0.15), 1px 1px 0 rgba(0,0,0,0.15)`,
        letterSpacing: '0.02em',
        transform: 'rotate(-0.8deg)',
        animation: 'dc-chalkin 0.8s ease-out',
        whiteSpace: 'pre-wrap' as const
      }}>
        {content}
      </div>
      <style>{`@keyframes dc-chalkin { 0%{opacity:0;filter:blur(3px)} 100%{opacity:1;filter:blur(0)} }`}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// RETRO DINER CLOCK — chrome-framed round clock
// ═══════════════════════════════════════════════════════════
export function DinerChalkboardClock({ config }: { config: any }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const tz = config.timezone || undefined;
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(now);
  const h = parseInt(fmt({ hour: 'numeric', hour12: false }), 10) % 12;
  const m = parseInt(fmt({ minute: 'numeric' }), 10);
  const s = parseInt(fmt({ second: 'numeric' }), 10);
  const hourDeg = (h * 30) + (m * 0.5);
  const minDeg  = m * 6;
  const secDeg  = s * 6;

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-visible">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
        {/* Chrome outer ring */}
        <circle cx="50" cy="50" r="48" fill="#C0C0C0" stroke="#A0A0A0" strokeWidth="1" />
        <circle cx="50" cy="50" r="46" fill="#E8E8E8" stroke="#D0D0D0" strokeWidth="0.5" />
        {/* Face */}
        <circle cx="50" cy="50" r="42" fill={DC.warmWhite} stroke="#D0D0D0" strokeWidth="0.5" />
        {/* Hour markers */}
        {[...Array(12)].map((_, i) => {
          const a = (i * 30) * Math.PI / 180;
          const x1 = 50 + Math.sin(a) * 36;
          const y1 = 50 - Math.cos(a) * 36;
          const x2 = 50 + Math.sin(a) * 40;
          const y2 = 50 - Math.cos(a) * 40;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={DC.inkDark} strokeWidth={i % 3 === 0 ? 2.5 : 1} strokeLinecap="round" />;
        })}
        {/* Numerals */}
        <text x="50" y="16" textAnchor="middle" dominantBaseline="middle" fontSize="6" fontWeight="700" fontFamily={DC_FONT_DISPLAY} fill={DC.inkDark}>12</text>
        <text x="84" y="51" textAnchor="middle" dominantBaseline="middle" fontSize="6" fontWeight="700" fontFamily={DC_FONT_DISPLAY} fill={DC.inkDark}>3</text>
        <text x="50" y="86" textAnchor="middle" dominantBaseline="middle" fontSize="6" fontWeight="700" fontFamily={DC_FONT_DISPLAY} fill={DC.inkDark}>6</text>
        <text x="16" y="51" textAnchor="middle" dominantBaseline="middle" fontSize="6" fontWeight="700" fontFamily={DC_FONT_DISPLAY} fill={DC.inkDark}>9</text>
        {/* Diner name */}
        <text x="50" y="34" textAnchor="middle" dominantBaseline="middle" fontSize="3.5" fontWeight="600" fontFamily={DC_FONT_DISPLAY} fill={DC.red}>CAFETERIA</text>
        {/* Hands */}
        <line x1="50" y1="50" x2="50" y2="28" stroke={DC.inkDark} strokeWidth="3" strokeLinecap="round" transform={`rotate(${hourDeg} 50 50)`} />
        <line x1="50" y1="50" x2="50" y2="18" stroke={DC.inkDark} strokeWidth="2" strokeLinecap="round" transform={`rotate(${minDeg} 50 50)`} />
        <line x1="50" y1="55" x2="50" y2="14" stroke={DC.red} strokeWidth="1" strokeLinecap="round" transform={`rotate(${secDeg} 50 50)`} />
        {/* Center cap */}
        <circle cx="50" cy="50" r="3" fill="#C0C0C0" stroke="#A0A0A0" strokeWidth="0.5" />
        <circle cx="50" cy="50" r="1.5" fill={DC.red} />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// LUNCH MENU — chalk-written menu on the board
// ═══════════════════════════════════════════════════════════
export function DinerChalkboardLunchMenu({ config }: { config: any }) {
  const menu = config.menu || 'Monday: Pizza, Garden Salad, Fruit Cup\nTuesday: Chicken Tacos, Spanish Rice\nWednesday: Pasta Bar, Garlic Bread\nThursday: Grilled Chicken, Mashed Potatoes\nFriday: Burgers, Fries, Coleslaw';
  const lines = menu.split('\n').filter(Boolean);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{
      background: `
        radial-gradient(ellipse at 25% 30%, rgba(255,255,255,0.03) 0%, transparent 50%),
        linear-gradient(180deg, ${DC.board} 0%, ${DC.boardDk} 100%)`,
      borderRadius: 8,
      boxShadow: 'inset 0 0 40px rgba(0,0,0,0.2)',
      padding: '5% 6%',
      fontFamily: DC_FONT_CHALK,
      containerType: 'size',
    }}>
      {/* chalk underline decoration */}
      <div style={{ fontSize: 'clamp(16px, 12cqh, 48px)', fontWeight: 700, color: DC.neonYellow, fontFamily: DC_FONT_DISPLAY, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '2cqh',
        textShadow: `0 0 8px rgba(254,202,87,0.4), 0 0 2px ${DC.neonYellow}`, lineHeight: 1 }}>
        🍽️ Menu
      </div>
      <div style={{ width: '80%', height: '2px', background: DC.chalkFaint, marginBottom: '3cqh' }} />
      <div className="flex-1 flex flex-col justify-evenly" style={{ paddingRight: '2%' }}>
        {lines.map((line: string, i: number) => {
          const isToday = line.toLowerCase().startsWith(today.toLowerCase());
          const [day, ...rest] = line.split(':');
          
          // Total available height for items is ~65cqh. 
          // So each item gets (65 / lines.length) cqh total.
          const baseSize = Math.min(65 / Math.max(1, lines.length), 15);
          
          return (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column',
              padding: '0.5cqh 1cqi',
              borderLeft: isToday ? `3px solid ${DC.neonYellow}` : '3px solid transparent',
              background: isToday ? 'rgba(254,202,87,0.08)' : 'transparent',
              borderRadius: 4,
            }}>
              <span style={{ fontSize: `clamp(12px, min(${baseSize * 0.55}cqh, 5cqi), 40px)`, fontWeight: 700, color: isToday ? DC.neonYellow : DC.chalk,
                textShadow: isToday ? `0 0 6px rgba(254,202,87,0.3)` : `0 0 1px ${DC.chalkSoft}`, lineHeight: 1.1 }}>
                {day}
              </span>
              {rest.length > 0 && (
                <span style={{ fontSize: `clamp(10px, min(${baseSize * 0.35}cqh, 3cqi), 32px)`, fontWeight: 600, color: DC.chalkSoft, marginTop: '0.3cqh', lineHeight: 1.2 }}>
                  {rest.join(':').trim()}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// DAILY SPECIAL — tent card announcement
// ═══════════════════════════════════════════════════════════
export function DinerChalkboardAnnouncement({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const title = config.title || 'Daily Special!';
  const body = config.message || config.body || 'Ask about our featured dish today.';
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '5%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: `linear-gradient(180deg, ${DC.warmWhite} 0%, #F5E6C8 100%)`,
        boxShadow: '0 12px 28px rgba(0,0,0,0.2), inset 0 -4px 12px rgba(0,0,0,0.04)',
        borderRadius: 4,
        border: `3px solid ${DC.red}`,
        padding: '6% 7%',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        fontFamily: DC_FONT_DISPLAY,
        transform: 'rotate(-1.2deg)',
      }}>
        {/* Top red banner */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '18%',
          background: DC.red, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '2px 2px 0 0',
        }}>
          <span data-field="title" style={{ fontSize: '1.1em', fontWeight: 800, color: 'white', letterSpacing: '0.15em', textTransform: 'uppercase', whiteSpace: 'pre-wrap' as const }}>
            ⭐ {title}
          </span>
        </div>
        <div style={{ marginTop: '20%' }}>
          <div data-field="message" style={{ fontSize: '1.4em', fontWeight: 600, color: DC.inkDark, lineHeight: 1.35, whiteSpace: 'pre-wrap' as const }}>
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COUNTDOWN — chalk countdown on slate
// ═══════════════════════════════════════════════════════════
export function DinerChalkboardCountdown({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const resolved = resolveCountdownTarget(config, now);
  const target = resolved?.target ?? new Date(Date.now() + 3 * 60 * 60 * 1000);
  const label = config.label || resolved?.prefix || 'Next lunch in';
  const sublabel = config.mode === 'recurring' && resolved?.label ? resolved.label : '';
  const diff = Math.max(0, target.getTime() - now.getTime());
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{
      fontFamily: DC_FONT_CHALK, color: DC.chalk, textAlign: 'center', padding: '6%',
    }}>
      <div data-field="label" style={{ fontSize: '1.3em', fontWeight: 600, opacity: 0.85, textShadow: `1px 1px 0 rgba(0,0,0,0.12)`, whiteSpace: 'pre-wrap' as const }}>{label}</div>
      <div style={{ fontSize: '4em', fontWeight: 700, lineHeight: 0.95, textShadow: `0 0 1px ${DC.chalkSoft}, 1px 1px 0 rgba(0,0,0,0.15)` }}>
        {hours}:{mins.toString().padStart(2, '0')}
      </div>
      <div style={{ fontSize: '1.2em', fontWeight: 600, opacity: 0.75, fontFamily: DC_FONT_DISPLAY, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {hours > 0 ? 'hrs : min' : 'minutes'}
      </div>
      {sublabel && (
        <div style={{ fontSize: '0.95em', fontWeight: 600, opacity: 0.85, marginTop: '0.3em', textShadow: `1px 1px 0 rgba(0,0,0,0.12)` }}>
          ({sublabel})
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — neon-style scrolling sign
// ═══════════════════════════════════════════════════════════
export function DinerChalkboardTicker({ config }: { config: any }) {
  const messages: string[] = config.messages?.length ? config.messages : ['Eat your fruits and vegetables!'];
  const speed = config.speed === 'slow' ? 40 : config.speed === 'fast' ? 15 : 25;
  const text = messages.join('     ★     ');
  const repeated = `${text}     ★     ${text}`;
  return (
    <div className="absolute inset-0 overflow-hidden flex items-center" style={{
      background: `linear-gradient(90deg, rgba(30,43,31,0.95), rgba(44,62,45,0.95))`,
      borderTop: `2px solid ${DC.neonRed}`,
      borderBottom: `2px solid ${DC.neonRed}`,
      boxShadow: `inset 0 0 20px rgba(255,107,107,0.1)`,
    }}>
      <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-[#1E2B1F] to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-[#1E2B1F] to-transparent z-10 pointer-events-none" />
      <div style={{
        display: 'flex', whiteSpace: 'nowrap',
        animation: `dc-ticker ${speed}s linear infinite`,
      }}>
        <span style={{
          fontSize: '1em', fontWeight: 700, color: DC.neonYellow, paddingLeft: '100%',
          letterSpacing: '0.04em', fontFamily: DC_FONT_DISPLAY,
          textShadow: `0 0 8px rgba(254,202,87,0.5), 0 0 20px rgba(254,202,87,0.2)`,
        }}>
          {repeated}
        </span>
      </div>
      <style>{`@keyframes dc-ticker { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }`}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CALENDAR — chalk schedule on mini board
// ═══════════════════════════════════════════════════════════
export function DinerChalkboardCalendar({ config }: { config: any }) {
  const events = config.events || [
    { date: 'Mon', title: 'Taco Tuesday Prep' },
    { date: 'Wed', title: 'Pizza Day' },
    { date: 'Fri', title: 'Ice Cream Social' },
  ];
  return (
    <div className="absolute inset-0 flex flex-col" style={{
      background: `linear-gradient(180deg, ${DC.board} 0%, ${DC.boardDk} 100%)`,
      borderRadius: 8, boxShadow: 'inset 0 0 30px rgba(0,0,0,0.2)',
      padding: '5% 6%', fontFamily: DC_FONT_CHALK,
    }}>
      <div data-field="title" style={{ fontSize: '1.3em', fontWeight: 700, color: DC.neonTeal, fontFamily: DC_FONT_DISPLAY, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.4em',
        textShadow: `0 0 6px rgba(0,206,201,0.3)`, whiteSpace: 'pre-wrap' as const }}>
        📅 This Week
      </div>
      <div style={{ width: '60%', height: '2px', background: DC.chalkFaint, marginBottom: '0.5em' }} />
      {events.slice(0, 5).map((e: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '0.5em', marginBottom: '0.4em', fontSize: '1.3em', color: DC.chalk }}>
          <span style={{ color: DC.neonTeal, fontWeight: 700, textShadow: `0 0 4px rgba(0,206,201,0.2)` }}>•</span>
          <span style={{ fontWeight: 700, minWidth: '2.8em' }}>{e.date}</span>
          <span style={{ fontWeight: 600, opacity: 0.85 }}>{e.title}</span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF — "Employee of the Month" framed
// ═══════════════════════════════════════════════════════════
export function DinerChalkboardStaff({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const name = config.staffName || 'Chef Rodriguez';
  const role = config.role || 'Cafeteria Star';
  const bio = config.bio || 'Making lunches everyone loves!';
  const photoUrl: string | undefined = config.photoUrl || config.assetUrl;
  return (
    <div className="absolute inset-0 flex items-center justify-center p-[5%]" style={{ containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: DC.warmWhite,
        boxShadow: '0 14px 28px rgba(0,0,0,0.2)',
        padding: '5%', transform: 'rotate(1.5deg)',
        display: 'flex', flexDirection: 'column',
        fontFamily: DC_FONT_DISPLAY, border: `3px solid ${DC.counter}`,
        borderRadius: 4,
      }}>
        <div style={{ height: '55%', marginBottom: '4%', overflow: 'hidden', flexShrink: 0, borderRadius: 2 }}>
          {photoUrl ? (
            <img src={resolveUrl(photoUrl)} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ 
              width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', 
              border: '2px dashed #D5C9B1', borderRadius: 4, background: '#F8F4EA' 
            }}>
              <div style={{ fontSize: 'clamp(40px, 40cqh, 200px)', lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }}>👨‍🍳</div>
              <div style={{ fontSize: 'clamp(8px, 3.5cqh, 24px)', fontWeight: 700, color: '#B3A58E', marginTop: '3cqh', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Drop Photo
              </div>
            </div>
          )}
        </div>
        <div style={{ flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0 }}>
          <div data-field="role" style={{ fontSize: 'clamp(10px, 4cqh, 24px)', fontWeight: 800, color: DC.red, letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'pre-wrap' as const }}>⭐ {role}</div>
          <div data-field="staffName" style={{ fontSize: 'clamp(16px, 8cqh, 48px)', fontWeight: 800, color: DC.inkDark, lineHeight: 1.1, marginTop: '1cqh', whiteSpace: 'pre-wrap' as const }}>{name}</div>
          <div data-field="bio" style={{ fontSize: 'clamp(12px, 4.5cqh, 28px)', fontWeight: 600, color: DC.inkDark, opacity: 0.75, marginTop: '2cqh', fontStyle: 'italic', fontFamily: DC_FONT_CHALK, lineHeight: 1.2, whiteSpace: 'pre-wrap' as const }}>"{bio}"</div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// LOGO — round diner badge
// ═══════════════════════════════════════════════════════════
export function DinerChalkboardLogo({ config }: { config: any }) {
  const initials = (config.initials || (config.schoolName || 'Cafe').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()) || 'DC';
  const photoUrl = config.assetUrl || config.photoUrl;
  return (
    <div className="absolute inset-0 flex items-center justify-center p-[8%]" style={{ containerType: 'size' }}>
      <div style={{
        width: '85%', aspectRatio: '1', borderRadius: '50%', overflow: 'hidden',
        background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.3) 0%, transparent 50%), ${DC.red}`,
        border: `4px solid ${DC.warmWhite}`,
        boxShadow: '0 8px 18px rgba(0,0,0,0.22)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: DC.warmWhite, fontWeight: 800, fontSize: 'clamp(20px, 30cqh, 150px)',
        fontFamily: DC_FONT_DISPLAY,
        textShadow: '0 2px 4px rgba(0,0,0,0.25)',
      }}>
        {photoUrl ? (
          <img src={resolveUrl(photoUrl)} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'transparent' }} />
        ) : initials}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — small chalk sign
// ═══════════════════════════════════════════════════════════
export function DinerChalkboardWeather({ config }: { config: any }) {
  const temp = config.tempF || 72;
  const cond = config.condition || 'Sunny';
  const icon = cond.toLowerCase().includes('rain') ? '🌧️' : cond.toLowerCase().includes('cloud') ? '⛅' : cond.toLowerCase().includes('snow') ? '❄️' : '☀️';
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%' }}>
      <div style={{
        width: '100%', height: '100%',
        background: `linear-gradient(180deg, ${DC.board} 0%, ${DC.boardDk} 100%)`,
        border: `3px solid ${DC.woodLight}`, borderRadius: 8,
        boxShadow: '0 6px 14px rgba(0,0,0,0.18)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: DC_FONT_CHALK, color: DC.chalk,
        textShadow: `1px 1px 0 rgba(0,0,0,0.2)`, padding: '4%',
      }}>
        <div style={{ fontSize: '2.4em', lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>{icon}</div>
        <div style={{ fontSize: '2.2em', fontWeight: 700, lineHeight: 1, marginTop: '0.1em' }}>{temp}°</div>
        <div style={{ fontSize: '1.1em', fontWeight: 600, opacity: 0.85, marginTop: '0.05em' }}>{cond}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — food photos pinned to cork strip
// ═══════════════════════════════════════════════════════════
export function DinerChalkboardImageCarousel({ config }: { config: any }) {
  const urls: string[] = Array.isArray(config.urls) && config.urls.length > 0 ? config.urls : (config.assetUrl ? [config.assetUrl] : []);
  const [idx, setIdx] = useState(0);
  
  useEffect(() => {
    if (urls.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), config.intervalMs || 5000);
    return () => clearInterval(t);
  }, [urls.length, config.intervalMs]);

  return (
    <div className="absolute inset-0 flex items-center justify-center p-[4%]" style={{ containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: DC.warmWhite,
        boxShadow: '0 10px 20px rgba(0,0,0,0.18)',
        transform: 'rotate(-1deg)',
        padding: '4%', fontFamily: DC_FONT_CHALK,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        borderRadius: 4,
      }}>
        <div style={{ position: 'absolute', top: '-6px', left: '50%', transform: 'translateX(-50%) rotate(2deg)', width: '18%', height: '12px', background: 'rgba(255,107,107,0.6)' }} />
        <div style={{
          width: '92%', flex: 1, marginBottom: '2cqh',
          background: `linear-gradient(135deg, #F5E6C8 0%, #E8D5B0 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', borderRadius: 2
        }}>
          {urls.length > 0 ? (
            <img src={resolveUrl(urls[idx])} alt="Gallery" className="transition-opacity duration-500" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ fontSize: 'clamp(40px, 30cqh, 150px)' }}>📸</div>
          )}
        </div>
        <div data-field="title" style={{ fontSize: 'clamp(14px, 10cqh, 48px)', fontWeight: 700, color: DC.inkDark, lineHeight: 1, whiteSpace: 'pre-wrap' as const }}>{config.title || 'Food Gallery'}</div>
      </div>
    </div>
  );
}
