"use client";

/**
 * Middle School Hallway — scene-integrated hallway theme.
 *
 * Widgets render AS scene elements in a school hallway:
 *   - CLOCK           → LED digital wall clock hanging from ceiling
 *   - BELL_SCHEDULE   → Printed paper pinned to the corkboard
 *   - TICKER          → LED dot-matrix scrolling sign
 *   - ANNOUNCEMENT    → Brightly colored flyer taped to a locker
 *   - IMAGE_CAROUSEL  → Polaroid photos pinned to the corkboard
 *   - WEATHER         → Smartphone screen stuck on a locker
 *   - TEXT            → Printed banner paper
 *   - LOGO            → Vinyl decal sticker on a locker
 *   - STAFF_SPOTLIGHT → Framed "Staff of the Month" on the corkboard
 *   - COUNTDOWN       → LED digital countdown display
 */

import { useEffect, useState } from 'react';

// ─── Palette ────────────────────────────────────────────
export const MSH = {
  ledBg:       '#0A0A0A',
  ledRed:      '#FF2A2A',
  ledRedDim:   '#4A0808',
  ledOrange:   '#FF8C00',
  corkboard:   '#D4A76A',
  paperBg:     '#FDFBF7',
  paperLine:   '#E0E5EC',
  inkBlue:     '#1A5276',
  inkDark:     '#212F3D',
  flyerYellow: '#FFF176',
  flyerPink:   '#FF8A80',
  flyerBlue:   '#81D4FA',
  lockerBlue:  '#2E86C1',
  lockerSilver:'#BDC3C7',
  tapeOpacity: 'rgba(255,255,255,0.6)',
  pinRed:      '#E74C3C',
};

export const MSH_FONT_DIGITAL = "'Courier New', Courier, monospace"; // Fallback for LED, or a loaded digital font
export const MSH_FONT_PRINTED = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const MSH_FONT_MARKER  = "var(--font-caveat), 'Comic Sans MS', cursive";
export const MSH_FONT_BOLD    = "var(--font-fredoka), ui-rounded, system-ui, sans-serif";

// ═══════════════════════════════════════════════════════════
// LED CLOCK — Hanging digital clock
// ═══════════════════════════════════════════════════════════
export function MSHallClock({ config }: { config: any }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const tz = config.timezone || undefined;
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(now);
  
  const hRaw = fmt({ hour: 'numeric', hour12: config.format !== '24h' });
  const h = hRaw.replace(/ [AP]M/i, '');
  const m = fmt({ minute: '2-digit' });
  const s = config.showSeconds ? fmt({ second: '2-digit' }) : '';
  const ampm = config.format !== '24h' ? hRaw.slice(-2) : '';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{
      containerType: 'size',
      background: `linear-gradient(180deg, #1A1A1A 0%, #050505 100%)`,
      borderRadius: '8px',
      border: '4px solid #333',
      boxShadow: 'inset 0 0 20px rgba(0,0,0,0.8), 0 10px 20px rgba(0,0,0,0.4)',
      padding: '4%',
    }}>
      {/* Hanging rods extending to the ceiling */}
      <div style={{ position: 'absolute', bottom: '100%', left: '20%', width: '3cqw', minWidth: '4px', height: '2000px', background: 'linear-gradient(90deg, #7F8C8D 0%, #95A5A6 50%, #546067 100%)', zIndex: -1 }} />
      <div style={{ position: 'absolute', bottom: '100%', right: '20%', width: '3cqw', minWidth: '4px', height: '2000px', background: 'linear-gradient(90deg, #7F8C8D 0%, #95A5A6 50%, #546067 100%)', zIndex: -1 }} />

      {/* Glare effect */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '40%', background: 'linear-gradient(180deg, rgba(255,255,255,0.1) 0%, transparent 100%)', pointerEvents: 'none', borderRadius: '8px 8px 0 0' }} />
      
      <div style={{
        fontFamily: MSH_FONT_DIGITAL,
        color: MSH.ledRed,
        textShadow: `0 0 10px ${MSH.ledRed}, 0 0 20px rgba(255,42,42,0.4)`,
        display: 'flex', alignItems: 'baseline', gap: '0.5em',
        letterSpacing: '0.05em',
      }}>
        <div style={{ fontSize: 'min(25cqw, 40cqh)', fontWeight: 700, lineHeight: 1 }}>
          {h}<span style={{ opacity: now.getSeconds() % 2 === 0 ? 1 : 0.2 }}>:</span>{m}
        </div>
        {(s || ampm) && (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: '0.5em' }}>
            {s && <span style={{ fontSize: 'min(10cqw, 15cqh)', fontWeight: 700 }}>{s}</span>}
            {ampm && <span style={{ fontSize: 'min(6cqw, 10cqh)', fontWeight: 700, opacity: 0.8 }}>{ampm}</span>}
          </div>
        )}
      </div>
      {/* Faint background "88:88" for realism */}
      <div style={{
        position: 'absolute',
        fontFamily: MSH_FONT_DIGITAL,
        color: MSH.ledRedDim,
        fontSize: 'min(25cqw, 40cqh)', fontWeight: 700, lineHeight: 1,
        letterSpacing: '0.05em',
        zIndex: -1,
        display: 'flex', alignItems: 'baseline', gap: '0.5em',
      }}>
        <div>88:88</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// BELL SCHEDULE — Printed paper pinned to corkboard
// ═══════════════════════════════════════════════════════════
export function MSHallBellSchedule({ config }: { config: any }) {
  const schedule = config.schedule || 'Period 1: 8:00 - 8:50\nPeriod 2: 8:55 - 9:45\nPeriod 3: 9:50 - 10:40\nLunch: 10:45 - 11:15\nPeriod 4: 11:20 - 12:10\nPeriod 5: 12:15 - 1:05\nPeriod 6: 1:10 - 2:00';
  const lines = schedule.split('\n').filter(Boolean);
  
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: MSH.paperBg,
        boxShadow: '2px 4px 12px rgba(0,0,0,0.15)',
        transform: 'rotate(-1deg)',
        display: 'flex', flexDirection: 'column',
        fontFamily: MSH_FONT_PRINTED,
        color: MSH.inkDark,
        padding: '6% 8%',
      }}>
        {/* Red Pushpin */}
        <div style={{
          position: 'absolute', top: '1cqh', left: '50%', transform: 'translateX(-50%)',
          width: 'min(12px, 5cqw)', height: 'min(12px, 5cqw)', borderRadius: '50%',
          background: `radial-gradient(circle at 30% 30%, #FF8A80 0%, ${MSH.pinRed} 60%, #900C3F 100%)`,
          boxShadow: '1px 2px 4px rgba(0,0,0,0.3)',
          zIndex: 10,
        }} />
        
        <div data-field="title" style={{ fontSize: '9cqw', fontWeight: 800, textAlign: 'center', marginBottom: '6%', marginTop: '6%', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `2px solid ${MSH.inkDark}`, paddingBottom: '3%', lineHeight: 1.1, whiteSpace: 'pre-wrap' as const }}>
          Bell Schedule
        </div>
        
        <div className="flex-1 overflow-y-auto" style={{ paddingRight: '4%' }}>
          {lines.map((line: string, i: number) => {
            const [period, time] = line.split(': ');
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4%', fontSize: '5.5cqw', gap: '0.5em', lineHeight: 1.2 }}>
                <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{period || line}</span>
                {time && <span style={{ fontWeight: 500, color: '#555', whiteSpace: 'nowrap' }}>{time}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — LED Dot Matrix Scrolling Sign
// ═══════════════════════════════════════════════════════════
export function MSHallTicker({ config }: { config: any }) {
  const messages: string[] = config.messages?.length ? config.messages : ['Welcome to Middle School!'];
  const speed = config.speed === 'slow' ? 40 : config.speed === 'fast' ? 15 : 25;
  const text = messages.join('   ***   ');
  const repeated = `${text}   ***   ${text}`;
  
  return (
    <div className="absolute inset-0 overflow-hidden" style={{
      background: MSH.ledBg,
      borderTop: '2px solid #222', borderBottom: '2px solid #222',
      boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)',
      containerType: 'size',
    }}>
      {/* Dot matrix overlay texture */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(rgba(0,0,0,0.6) 1px, transparent 1px)',
        backgroundSize: '4px 4px',
      }} />
      <div style={{
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        whiteSpace: 'nowrap',
        display: 'flex',
        animation: `msh-ticker ${speed}s linear infinite`,
      }}>
        <span style={{
          fontSize: 'min(15cqw, 50cqh)', fontWeight: 700, color: MSH.ledOrange,
          paddingLeft: '100cqw',
          fontFamily: MSH_FONT_DIGITAL, letterSpacing: '0.1em',
          textShadow: `0 0 4px ${MSH.ledOrange}, 0 0 10px rgba(255,140,0,0.5)`,
        }}>
          {repeated}
        </span>
      </div>
      <style>{`@keyframes msh-ticker { 0%{transform:translate(0, -50%)} 100%{transform:translate(-50%, -50%)} }`}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT — Flyer taped to locker
// ═══════════════════════════════════════════════════════════
export function MSHallAnnouncement({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const title = config.title || 'Attention Students!';
  const message = config.message || config.body || 'Important information posted here.';
  
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: MSH.flyerYellow,
        boxShadow: '2px 3px 8px rgba(0,0,0,0.2)',
        transform: 'rotate(2deg)',
        padding: '8%',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        fontFamily: MSH_FONT_MARKER,
        color: MSH.inkDark,
        textAlign: 'center',
      }}>
        {/* Tape Top */}
        <div style={{
          position: 'absolute', top: '-8px', left: '50%', transform: 'translateX(-50%) rotate(-3deg)',
          width: '25%', height: '18px', background: MSH.tapeOpacity,
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)', backdropFilter: 'blur(1px)',
        }} />
        {/* Tape Bottom */}
        <div style={{
          position: 'absolute', bottom: '-8px', left: '40%', transform: 'rotate(4deg)',
          width: '20%', height: '18px', background: MSH.tapeOpacity,
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)', backdropFilter: 'blur(1px)',
        }} />
        
        <div style={{ fontSize: '22cqw', fontWeight: 700, marginBottom: '6%', lineHeight: 1.1 }}>
          {title}
        </div>
        <div style={{ fontSize: '16cqw', fontWeight: 600, lineHeight: 1.3, opacity: 0.9 }}>
          {message}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// IMAGE CAROUSEL — Polaroids pinned to corkboard
// ═══════════════════════════════════════════════════════════
export function MSHallImageCarousel({ config }: { config: any }) {
  const urls = config.assetUrls || [];
  const [idx, setIdx] = useState(0);
  const interval = config.intervalMs || 5000;

  useEffect(() => {
    if (urls.length < 2) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), interval);
    return () => clearInterval(t);
  }, [urls.length, interval]);

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '5%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: '#FFF',
        boxShadow: '2px 4px 15px rgba(0,0,0,0.2)',
        transform: 'rotate(-2deg)',
        padding: '4% 4% 12% 4%', // Polaroid thick bottom
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Pushpin */}
        <div style={{
          position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)',
          width: '12px', height: '12px', borderRadius: '50%',
          background: `radial-gradient(circle at 30% 30%, #81D4FA 0%, #2980B9 60%, #154360 100%)`,
          boxShadow: '1px 2px 4px rgba(0,0,0,0.3)',
          zIndex: 10,
        }} />
        
        <div style={{
          flex: 1, width: '100%', background: '#EAECEE',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}>
          {urls.length > 0 ? (
            <img src={urls[idx % urls.length]} alt="" className="w-full h-full object-cover transition-opacity duration-500" />
          ) : (
            <div style={{ fontSize: '3em' }}>📸</div>
          )}
        </div>
        
        <div style={{
          position: 'absolute', bottom: '3%', left: 0, right: 0,
          textAlign: 'center', fontFamily: MSH_FONT_MARKER, fontSize: '1.2em',
          color: MSH.inkDark, fontWeight: 600,
        }}>
          {config.title || 'Hallway Memories'}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// WEATHER — Smartphone screen stuck on locker
// ═══════════════════════════════════════════════════════════
export function MSHallWeather({ config }: { config: any }) {
  const temp = config.tempF || 68;
  const cond = config.condition || 'Clear';
  const icon = cond.toLowerCase().includes('rain') ? '🌧️' : cond.toLowerCase().includes('cloud') ? '⛅' : '☀️';
  
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '8%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: '#111',
        borderRadius: '16px',
        border: '3px solid #333',
        boxShadow: '4px 6px 12px rgba(0,0,0,0.3), inset 0 0 4px rgba(255,255,255,0.2)',
        padding: '6%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: MSH_FONT_PRINTED, color: '#FFF',
      }}>
        {/* Phone Notch/Camera */}
        <div style={{ position: 'absolute', top: '6px', left: '50%', transform: 'translateX(-50%)', width: '20%', height: '4px', background: '#222', borderRadius: '4px' }} />
        
        <div style={{ fontSize: 'min(40cqw, 2.5em)', lineHeight: 1, filter: 'drop-shadow(0 2px 8px rgba(255,255,255,0.2))' }}>{icon}</div>
        <div style={{ fontSize: 'min(30cqw, 2.2em)', fontWeight: 300, lineHeight: 1.1, marginTop: '5%' }}>{temp}°</div>
        <div style={{ fontSize: 'min(15cqw, 1em)', fontWeight: 500, color: '#AAA' }}>{cond}</div>
        
        {/* Magnet/Tape */}
        <div style={{
          position: 'absolute', top: '-12px', right: '-12px',
          width: '30px', height: '30px', borderRadius: '50%', background: '#E74C3C',
          boxShadow: 'inset -2px -2px 6px rgba(0,0,0,0.3), 2px 2px 4px rgba(0,0,0,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: '#C0392B' }} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — Printed banner
// ═══════════════════════════════════════════════════════════
export function MSHallText({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const content = config.content || 'School Spirit!';
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: '#FFF',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '4%', fontFamily: MSH_FONT_BOLD,
        color: MSH.lockerBlue, textAlign: 'center',
        border: '1px solid #EEE',
      }}>
        {/* Tape corners */}
        <div style={{ position: 'absolute', top: '-4px', left: '-4px', width: '20px', height: '12px', background: MSH.tapeOpacity, transform: 'rotate(-45deg)' }} />
        <div style={{ position: 'absolute', top: '-4px', right: '-4px', width: '20px', height: '12px', background: MSH.tapeOpacity, transform: 'rotate(45deg)' }} />
        <div style={{ position: 'absolute', bottom: '-4px', left: '-4px', width: '20px', height: '12px', background: MSH.tapeOpacity, transform: 'rotate(45deg)' }} />
        <div style={{ position: 'absolute', bottom: '-4px', right: '-4px', width: '20px', height: '12px', background: MSH.tapeOpacity, transform: 'rotate(-45deg)' }} />
        
        <div style={{ fontSize: '12cqw', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1.1 }}>
          {content}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COUNTDOWN — LED countdown module
// ═══════════════════════════════════════════════════════════
export function MSHallCountdown({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const label = config.label || 'Weekend starts in:';
  const target = config.targetDate ? new Date(config.targetDate) : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  
  const diff = Math.max(0, target.getTime() - now.getTime());
  const d = Math.floor(diff / (1000 * 60 * 60 * 24));
  const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const m = Math.floor((diff / 1000 / 60) % 60);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{
      background: '#1A1A1A', borderRadius: '6px', border: '2px solid #333',
      boxShadow: 'inset 0 0 15px rgba(0,0,0,0.8), 2px 4px 8px rgba(0,0,0,0.3)',
      padding: '4%', color: MSH.ledOrange, fontFamily: MSH_FONT_DIGITAL,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '1.2em', fontWeight: 600, color: '#AAA', marginBottom: '4%', fontFamily: MSH_FONT_PRINTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: '3.5em', fontWeight: 700, lineHeight: 1, textShadow: `0 0 8px ${MSH.ledOrange}` }}>
        {d}d {h.toString().padStart(2, '0')}h {m.toString().padStart(2, '0')}m
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF_SPOTLIGHT — Framed photo on corkboard
// ═══════════════════════════════════════════════════════════
export function MSHallStaff({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const name = config.staffName || 'Mr. Davis';
  const role = config.role || 'Teacher of the Month';
  const photoUrl = config.photoUrl || config.assetUrl;
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '4%', containerType: 'size' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: '#FFF',
        border: '6px solid #4A2311', // Dark wood frame
        boxShadow: '4px 6px 12px rgba(0,0,0,0.3), inset 0 0 10px rgba(0,0,0,0.2)',
        padding: '6%',
        display: 'flex', flexDirection: 'column',
        fontFamily: MSH_FONT_PRINTED,
      }}>
        {/* Pushpin at top center of frame */}
        <div style={{ position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)', width: '14px', height: '14px', borderRadius: '50%', background: `radial-gradient(circle at 30% 30%, #F4D03F 0%, #D4AC0D 60%, #7D6608 100%)`, boxShadow: '1px 2px 4px rgba(0,0,0,0.4)', zIndex: 10 }} />
        
        <div style={{ flex: 1, background: '#F4F6F6', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid #DDD' }}>
          {photoUrl ? (
            <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
          ) : (
            <div style={{ width: '100%', textAlign: 'center', fontSize: '3.5em' }}>👨‍🏫</div>
          )}
        </div>
        <div style={{ textAlign: 'center', marginTop: '6%' }}>
          <div style={{ fontSize: '10cqw', fontWeight: 800, color: MSH.inkDark, textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1.1 }}>{name}</div>
          <div style={{ fontSize: '6cqw', fontWeight: 600, color: '#777', marginTop: '1%' }}>{role}</div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// LOGO — Vinyl Decal Sticker
// ═══════════════════════════════════════════════════════════
export function MSHallLogo({ config }: { config: any }) {
  const initials = (config.schoolName || 'MS').split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '8%' }}>
      <div style={{
        width: '80%', aspectRatio: '1', borderRadius: '15%',
        background: `linear-gradient(135deg, ${MSH.flyerBlue} 0%, #2980B9 100%)`,
        border: '3px solid #FFF',
        boxShadow: '1px 2px 4px rgba(0,0,0,0.15)',
        display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center',
        color: '#FFF', fontWeight: 900, fontSize: '3.5em',
        fontFamily: MSH_FONT_BOLD,
        transform: 'rotate(-5deg)',
      }}>
        {/* Subtle sticker peel effect */}
        <div style={{ position: 'absolute', bottom: 0, right: 0, width: '15px', height: '15px', background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.4) 50%)', borderRadius: '0 0 12% 0' }} />
        {initials}
      </div>
    </div>
  );
}
