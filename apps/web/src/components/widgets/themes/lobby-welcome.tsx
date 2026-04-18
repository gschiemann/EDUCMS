import React, { useState, useEffect } from 'react';
import { Cloud, CloudRain, Sun, Wind, Calendar as CalendarIcon, Info } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// LOBBY WELCOME THEME - Modern Glassmorphism & Architectural Elegance
// ═══════════════════════════════════════════════════════════════════════════

export function LobbyWelcomeLogo({ config }: { config: any }) {
  const url = config.url || '/placeholder.svg';
  
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-6" style={{
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
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center" style={{
      background: 'rgba(255, 255, 255, 0.25)',
      backdropFilter: 'blur(25px)',
      borderRadius: '24px',
      boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.1)',
      border: '1px solid rgba(255, 255, 255, 0.5)',
      containerType: 'size'
    }}>
      <div style={{
        fontSize: 'clamp(2rem, 12cqh, 6rem)',
        fontWeight: 300,
        color: '#1e293b',
        fontFamily: '"Inter", sans-serif',
        lineHeight: 1.2,
        letterSpacing: '-0.02em'
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
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{
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
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{
      background: 'rgba(255, 255, 255, 0.2)',
      backdropFilter: 'blur(20px)',
      borderRadius: '24px',
      border: '1px solid rgba(255, 255, 255, 0.4)',
      boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.1)',
      containerType: 'size'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '3cqi' }}>
        <Sun color="#f59e0b" size="30cqh" />
        <div style={{ 
          fontSize: 'clamp(2rem, 25cqh, 6rem)', 
          fontWeight: 300, 
          color: '#1e293b',
          fontFamily: '"Inter", sans-serif'
        }}>
          72°
        </div>
      </div>
      <div style={{ fontSize: 'clamp(1rem, 6cqh, 2rem)', color: '#475569', marginTop: '2cqh', fontWeight: 500 }}>
        Sunny & Clear
      </div>
    </div>
  );
}

export function LobbyWelcomeAnnouncement({ config, compact }: { config: any; compact?: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col p-8" style={{
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
        <div style={{ fontSize: 'clamp(1.2rem, 6cqh, 2.5rem)', fontWeight: 600, color: '#1e293b', letterSpacing: '0.05em' }}>
          {config.title || 'CAMPUS ANNOUNCEMENT'}
        </div>
      </div>
      <div style={{ fontSize: 'clamp(1.5rem, 8cqh, 3.5rem)', fontWeight: 300, color: '#334155', lineHeight: 1.5 }}>
        {config.message || 'Please ensure you have your visitor badge visible at all times while on campus grounds.'}
      </div>
    </div>
  );
}

export function LobbyWelcomeCalendar({ config }: { config: any }) {
  return (
    <div className="absolute inset-0 flex flex-col p-8" style={{
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
        {[
          { day: 'TODAY', time: '2:30 PM', event: 'Campus Tour' },
          { day: 'TOMORROW', time: '9:00 AM', event: 'Guest Speaker: Dr. Smith' },
          { day: 'FRIDAY', time: 'All Day', event: 'Spirit Wear Day' }
        ].map((e, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '4cqi', background: 'rgba(255,255,255,0.4)', padding: '3cqh', borderRadius: '12px' }}>
            <div style={{ minWidth: '15cqi' }}>
              <div style={{ fontSize: 'clamp(0.8rem, 3cqh, 1.5rem)', fontWeight: 700, color: '#2563eb' }}>{e.day}</div>
              <div style={{ fontSize: 'clamp(0.8rem, 3cqh, 1.5rem)', color: '#64748b' }}>{e.time}</div>
            </div>
            <div style={{ fontSize: 'clamp(1rem, 4.5cqh, 2rem)', fontWeight: 500, color: '#1e293b' }}>{e.event}</div>
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
    <div className="absolute inset-0 flex items-center overflow-hidden" style={{
      background: 'rgba(15, 23, 42, 0.9)',
      backdropFilter: 'blur(20px)',
      color: 'white'
    }}>
      <div style={{ 
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
      <style>{`@keyframes lobbyTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}
