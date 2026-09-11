import React, { useState, useEffect } from 'react';
import { Cloud, CloudRain, Sun, Wind, Calendar as CalendarIcon, Info } from 'lucide-react';
import { useLiveWeather } from '../use-live-weather';
import { sceneCss } from '../scene-css';

// ═══════════════════════════════════════════════════════════════════════════
// LOBBY WELCOME THEME - Modern Glassmorphism & Architectural Elegance
// ═══════════════════════════════════════════════════════════════════════════

export function LobbyWelcomeLogo({ config }: { config: any }) {
  const url = config.url || '/placeholder.svg';
  
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center p-6" style={{
      background: 'rgba(255, 255, 255, 0.15)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.4)',
      borderRadius: '24px',
      boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
      containerType: 'size'
    }}>
      <div style={{
        width: '50cqh', height: '50cqh',
        background: 'rgba(255,255,255,0.8)',
        borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
        padding: '5cqh'
      }}>
        {config.url ? (
          <img src={url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <div style={{ fontSize: '25cqh' }}>🏢</div>
        )}
      </div>
    </div>
  );
}

export function LobbyWelcomeText({ config }: { config: any }) {
  const content = config.content || 'Welcome to our Campus';
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center p-8 text-center" style={{
      background: 'rgba(255, 255, 255, 0.25)',
      backdropFilter: 'blur(25px)',
      borderRadius: '24px',
      boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.1)',
      border: '1px solid rgba(255, 255, 255, 0.5)',
      containerType: 'size'
    }}>
      <div data-field="content" style={{
        fontSize: 'clamp(2rem, 12cqh, 6rem)',
        fontWeight: 300,
        color: '#1e293b',
        fontFamily: '"Inter", sans-serif',
        lineHeight: 1.2,
        letterSpacing: '-0.02em',
        whiteSpace: 'pre-wrap' as const
      }}>
        {content}
      </div>
    </div>
  );
}

export function LobbyWelcomeClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center" style={{
      background: 'linear-gradient(135deg, rgba(30, 64, 175, 0.8) 0%, rgba(17, 24, 39, 0.9) 100%)',
      backdropFilter: 'blur(16px)',
      borderRadius: '24px',
      color: 'white',
      border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: '0 15px 35px rgba(0,0,0,0.2)',
      containerType: 'size'
    }}>
      <div style={{ 
        fontSize: 'clamp(1rem, 6cqh, 2rem)', 
        fontWeight: 500, 
        color: '#93c5fd', 
        textTransform: 'uppercase', 
        letterSpacing: '0.15em', 
        marginBottom: '1cqh' 
      }}>
        {dateStr}
      </div>
      <div style={{ 
        fontSize: 'clamp(3rem, 28cqh, 8rem)', 
        fontWeight: 200, 
        fontFamily: '"Inter", sans-serif',
        letterSpacing: '-0.03em'
      }}>
        {timeStr}
      </div>
    </div>
  );
}

export function LobbyWelcomeWeather({ config, compact }: { config: any; compact?: boolean }) {
  // 2026-05-04 — was rendering a hard-coded "72°" + "Sunny & Clear"
  // string with no fetch path at all. Now reads live weather and
  // picks the right Lucide icon by condition keyword.
  const live = useLiveWeather(config);
  const condLower = live.condition.toLowerCase();
  const Icon = condLower.includes('rain') ? CloudRain
    : condLower.includes('cloud') ? Cloud
    : condLower.includes('wind') ? Wind
    : Sun;
  const iconColor = condLower.includes('rain') ? '#3b82f6'
    : condLower.includes('cloud') ? '#94a3b8'
    : '#f59e0b';
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center" style={{
      background: 'rgba(255, 255, 255, 0.2)',
      backdropFilter: 'blur(20px)',
      borderRadius: '24px',
      border: '1px solid rgba(255, 255, 255, 0.4)',
      boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.1)',
      containerType: 'size'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '3cqi' }}>
        <Icon color={iconColor} size="30cqh" />
        <div style={{
          fontSize: 'clamp(2rem, 25cqh, 6rem)',
          fontWeight: 300,
          color: '#1e293b',
          fontFamily: '"Inter", sans-serif'
        }}>
          {live.temp}°
        </div>
      </div>
      <div style={{ fontSize: 'clamp(1rem, 6cqh, 2rem)', color: '#475569', marginTop: '2cqh', fontWeight: 500 }}>
        {live.condition}
      </div>
    </div>
  );
}

export function LobbyWelcomeAnnouncement({ config, compact }: { config: any; compact?: boolean }) {
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex flex-col p-8" style={{
      background: 'rgba(255, 255, 255, 0.6)',
      backdropFilter: 'blur(30px)',
      borderRadius: '24px',
      boxShadow: '0 10px 40px rgba(0,0,0,0.08)',
      border: '1px solid rgba(255, 255, 255, 0.8)',
      borderLeft: '8px solid #3b82f6',
      containerType: 'size'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '3cqi', marginBottom: '4cqh' }}>
        <Info color="#3b82f6" size="8cqh" />
        <div data-field="title" style={{ fontSize: 'clamp(1.2rem, 6cqh, 2.5rem)', fontWeight: 600, color: '#1e293b', letterSpacing: '0.05em', whiteSpace: 'pre-wrap' as const }}>
          {config.title || 'CAMPUS ANNOUNCEMENT'}
        </div>
      </div>
      <div data-field="message" style={{ fontSize: 'clamp(1.5rem, 8cqh, 3.5rem)', fontWeight: 300, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap' as const }}>
        {config.message || 'Please ensure you have your visitor badge visible at all times while on campus grounds.'}
      </div>
    </div>
  );
}

// §19 (2026-09-11): kept verbatim as the FALLBACK so an unconfigured board
// renders exactly the three rows it always has. Keys renamed to the panel's
// own shape (date / time / title) so one render path serves both.
const LOBBY_DEFAULT_EVENTS = [
  { date: 'TODAY',    time: '2:30 PM', title: 'Campus Tour' },
  { date: 'TOMORROW', time: '9:00 AM', title: 'Guest Speaker: Dr. Smith' },
  { date: 'FRIDAY',   time: 'All Day', title: 'Spirit Wear Day' },
];

export function LobbyWelcomeCalendar({ config }: { config: any }) {
  // §19 (2026-09-11): this list was a hard-coded literal, so the Events editor
  // in Properties wrote into a void — a hotspot on it without this would be the
  // silent no-op the standard exists to stop. `events` is the key
  // PropertiesPanel writes for CALENDAR.
  const events = (Array.isArray(config.events) && config.events.length ? config.events : LOBBY_DEFAULT_EVENTS)
    .slice(0, Math.max(1, Math.min(12, config.maxEvents ?? LOBBY_DEFAULT_EVENTS.length)));
  return (
    // The whole widget IS the event list, so a contenteditable would commit one
    // flat string over the array and destroy every row. `data-field-jump` on the
    // existing root routes the click to the real Events editor instead — no
    // extra DOM node, so the layout is unchanged.
    <div data-field-jump="events" className="absolute top-0 right-0 bottom-0 left-0 flex flex-col p-8" style={{
      background: 'rgba(255, 255, 255, 0.15)',
      backdropFilter: 'blur(25px)',
      borderRadius: '24px',
      border: '1px solid rgba(255, 255, 255, 0.4)',
      boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.1)',
      containerType: 'size'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '3cqi', marginBottom: '6cqh', borderBottom: '1px solid rgba(0,0,0,0.1)', paddingBottom: '3cqh' }}>
        <CalendarIcon color="#2563eb" size="8cqh" />
        <div style={{ fontSize: 'clamp(1.2rem, 6cqh, 2.5rem)', fontWeight: 600, color: '#1e293b' }}>Upcoming Events</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4cqh' }}>
        {events.map((e: any, i: number) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '4cqi', background: 'rgba(255,255,255,0.4)', padding: '3cqh', borderRadius: '12px' }}>
            <div style={{ minWidth: '15cqi' }}>
              <div style={{ fontSize: 'clamp(0.8rem, 3cqh, 1.5rem)', fontWeight: 700, color: '#2563eb' }}>{e.date}</div>
              <div style={{ fontSize: 'clamp(0.8rem, 3cqh, 1.5rem)', color: '#64748b' }}>{e.time}</div>
            </div>
            <div style={{ fontSize: 'clamp(1rem, 4.5cqh, 2rem)', fontWeight: 500, color: '#1e293b' }}>{e.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LobbyWelcomeTicker({ config }: { config: any }) {
  const messages = config.messages?.length ? config.messages : ['Welcome to our Campus', 'Innovation starts here', 'Please sign in at the front desk'];
  const text = messages.join('   •   ');
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center overflow-hidden" style={{
      background: 'rgba(15, 23, 42, 0.9)',
      backdropFilter: 'blur(20px)',
      color: 'white'
    }}>
      {/* §19 (2026-09-11): this text is `config.messages.join('   •   ')`, so an
          inline contenteditable would commit one flat string over the whole
          array and wipe every row. `data-field-jump` routes the click to the
          real list editor instead — see enterFieldEdit in BuilderZone.tsx. */}
      <div data-field-jump="messages" style={{
        whiteSpace: 'nowrap',
        animation: 'lobbyTicker 30s linear infinite',
        fontSize: '4vh',
        fontWeight: 300,
        letterSpacing: '0.05em',
        paddingLeft: '100%',
        fontFamily: '"Inter", sans-serif'
      }}>
        {text}   •   {text}
      </div>
      <style>{sceneCss(`@keyframes lobbyTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`)}</style>
    </div>
  );
}
