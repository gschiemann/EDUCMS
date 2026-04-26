import React, { useState, useEffect } from 'react';
import { CalendarDays, Cloud, CloudRain, CloudSnow, CloudLightning, Sun, Wind, Droplets } from 'lucide-react';
import { fetchWeather, getWMO } from '../WidgetRenderer';

// ═══════════════════════════════════════════════════════════════════════════
// SUNSHINE ACADEMY THEME
// ═══════════════════════════════════════════════════════════════════════════

export function SunshineAcademyClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const h = config.format === '24h' ? now.getHours() : now.getHours() % 12 || 12;
  const m = now.getMinutes().toString().padStart(2, '0');
  const ampm = config.format === '24h' ? '' : now.getHours() >= 12 ? 'PM' : 'AM';
  
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ color: '#3A2E2A' }}>
      <div style={{ fontSize: compact ? '4em' : '8em', fontWeight: 900, lineHeight: 1, textShadow: '0 4px 12px rgba(255,255,255,0.6)' }}>
        {h}:{m}
      </div>
      {ampm && <div style={{ fontSize: compact ? '1.5em' : '2.5em', fontWeight: 800, marginLeft: '0.2em', marginTop: '0.8em', opacity: 0.8 }}>{ampm}</div>}
    </div>
  );
}

export function SunshineAcademyWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  
  useEffect(() => {
    fetchWeather(location, isCelsius).then(setWeather);
  }, [location, isCelsius]);

  if (!weather) return null;
  const wmo = getWMO(weather.weatherCode);
  const Icon = wmo.icon;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ color: '#3A2E2A', textShadow: '0 4px 12px rgba(255,255,255,0.6)' }}>
      <div className="flex items-center gap-4">
        <Icon style={{ width: compact ? '2em' : '4em', height: compact ? '2em' : '4em', color: wmo.iconColor, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.15))' }} />
        <div style={{ fontSize: compact ? '3em' : '6em', fontWeight: 900, lineHeight: 1 }}>{weather.temp}°</div>
      </div>
      <div style={{ fontSize: compact ? '0.9em' : '1.5em', fontWeight: 800, opacity: 0.8, marginTop: '0.2em', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {location}
      </div>
    </div>
  );
}

export function SunshineAcademyCountdown({ config, compact }: { config: any; compact?: boolean }) {
  const label = config.label || 'Event starts in';
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  
  const target = new Date(config.targetDate || new Date(Date.now() + 86400000 * 5));
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{
      background: 'rgba(255,252,245,0.88)', backdropFilter: 'blur(8px)',
      borderRadius: compact ? '12px' : '24px', padding: compact ? '10%' : '15%',
      boxShadow: '0 6px 24px rgba(90,70,50,0.12)', border: '2px solid rgba(255,220,180,0.5)', textAlign: 'center'
    }}>
      <div data-field="label" style={{ fontSize: compact ? '0.8em' : '1.2em', fontWeight: 800, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'pre-wrap' as const }}>{label}</div>
      <div style={{ fontSize: compact ? '3.5em' : '6em', fontWeight: 900, color: '#3A2E2A', lineHeight: 1, margin: '0.1em 0' }}>{days}</div>
      <div style={{ fontSize: compact ? '1em' : '1.4em', fontWeight: 700, color: '#7A6B63' }}>{days === 1 ? 'Day' : 'Days'}</div>
    </div>
  );
}

export function SunshineAcademyText({ config }: { config: any }) {
  const content = config.content || 'Your text here';
  return (
    <div className="absolute inset-0 flex items-center justify-center text-center p-4" style={{
      color: '#3A2E2A', fontSize: '3em', fontWeight: 900, textShadow: '0 4px 12px rgba(255,255,255,0.8)'
    }}>
      <div data-field="content" style={{ whiteSpace: 'pre-wrap' as const }}>
        {content}
      </div>
    </div>
  );
}

export function SunshineAcademyAnnouncement({ config, compact }: { config: any; compact?: boolean }) {
  const title = config.title || 'Important Update';
  const content = config.message || config.content || 'Content goes here...';
  
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div style={{
        width: '100%', height: '100%', borderRadius: compact ? '12px' : '24px',
        background: 'rgba(255,252,245,0.92)', backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 32px rgba(90,70,50,0.15), 0 2px 8px rgba(90,70,50,0.1)',
        border: '2px solid rgba(255,220,180,0.6)', padding: compact ? '1rem' : '2rem',
        display: 'flex', flexDirection: 'column', transform: 'rotate(-0.5deg)', position: 'relative'
      }}>
        <div style={{ position: 'absolute', top: '-8px', left: '50%', marginLeft: '-8px', width: '16px', height: '16px', borderRadius: '50%', background: 'linear-gradient(135deg, #FF6B6B, #EE5A5A)', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }} />
        <div data-field="title" style={{ fontSize: compact ? '1em' : '1.5em', fontWeight: 800, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5em', whiteSpace: 'pre-wrap' as const }}>{title}</div>
        <div data-field="message" style={{ fontSize: compact ? '1.5em' : '2.8em', fontWeight: 800, color: '#3A2E2A', lineHeight: 1.2, flex: 1, display: 'flex', alignItems: 'center', whiteSpace: 'pre-wrap' as const }}>{content}</div>
      </div>
    </div>
  );
}

export function SunshineAcademyTicker({ config }: { config: any }) {
  const messages = config.messages?.length ? config.messages : ['Welcome back, Sunshine Stars!', 'Picture day is this Friday!'];
  const text = messages.join('     *     ');
  return (
    <div className="absolute inset-0 flex items-center overflow-hidden" style={{ background: 'linear-gradient(90deg, #FF9A76, #FFBE88, #FF9A76)' }}>
      <div style={{ whiteSpace: 'nowrap', animation: 'tickerScroll 30s linear infinite', fontSize: '2em', fontWeight: 800, color: '#3A2E2A', paddingLeft: '100%' }}>
        {text}     *     {text}
      </div>
      <style>{`@keyframes tickerScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}

export function SunshineAcademyCalendar({ config, compact }: { config: any; compact?: boolean }) {
  const events = ['Art Show - Friday', 'Spirit Week - Next Mon', 'Book Fair - Oct 15', 'Fall Break - Oct 20'];
  return (
    <div className="absolute inset-0 flex flex-col p-4" style={{
      background: 'rgba(255,252,245,0.88)', backdropFilter: 'blur(8px)',
      borderRadius: compact ? '12px' : '24px', padding: compact ? '1rem' : '1.5rem',
      boxShadow: '0 6px 24px rgba(90,70,50,0.12)', border: '2px solid rgba(255,220,180,0.5)'
    }}>
      <div style={{ fontSize: compact ? '1em' : '1.2em', fontWeight: 800, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5em' }}>Upcoming Events</div>
      {events.map((evt, i) => (
        <div key={i} style={{
          fontSize: compact ? '1em' : '1.4em', fontWeight: 600, color: '#3A2E2A', padding: '0.4em 0',
          borderBottom: i < events.length - 1 ? '1px solid rgba(200,180,150,0.3)' : 'none',
          display: 'flex', alignItems: 'center', gap: '8px'
        }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: ['#FF6B6B','#4ECDC4','#FFD93D','#6C5CE7'][i], flexShrink: 0 }} />
          {evt}
        </div>
      ))}
    </div>
  );
}

export function SunshineAcademyStaffSpotlight({ config, compact }: { config: any; compact?: boolean }) {
  const staffName = config.staffName || 'Mrs. Johnson';
  const role = config.role || 'Teacher of the Week';
  const bio = config.bio || 'Inspiring 3rd graders every day with creativity and kindness!';
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div style={{
        width: '100%', height: '100%', background: 'white',
        borderRadius: compact ? '8px' : '16px', padding: compact ? '0.8rem' : '1.2rem',
        boxShadow: '0 8px 28px rgba(90,70,50,0.18), 0 2px 8px rgba(90,70,50,0.1)',
        transform: 'rotate(1.5deg)', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{
          flex: 1, borderRadius: compact ? '6px' : '10px', marginBottom: '0.8em',
          background: 'linear-gradient(135deg, #FFE0B2, #FFCCBC, #F8BBD0)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '4em'
        }}>
          *
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: compact ? '1.2em' : '1.8em', fontWeight: 900, color: '#3A2E2A' }}>{staffName}</div>
          <div style={{
            fontSize: compact ? '0.8em' : '1em', fontWeight: 700, color: 'white',
            background: 'linear-gradient(135deg, #F472B6, #EC4899)', borderRadius: '999px',
            padding: '4px 12px', display: 'inline-block', marginTop: '4px'
          }}>
            * {role}
          </div>
          <div style={{ fontSize: compact ? '0.9em' : '1.1em', fontWeight: 600, color: '#7A6B63', marginTop: '6px', lineHeight: 1.3 }}>{bio}</div>
        </div>
      </div>
    </div>
  );
}

export function SunshineAcademyImageCarousel({ config }: { config: any }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden" style={{
      borderRadius: '20px', background: 'linear-gradient(135deg, #E0F2FE, #DBEAFE, #EDE9FE)',
      boxShadow: '0 6px 24px rgba(90,70,50,0.12)', border: '4px solid white'
    }}>
      <div style={{ textAlign: 'center', color: '#7A6B63' }}>
        <div style={{ fontSize: '3em', marginBottom: '8px' }}>*</div>
        <div style={{ fontSize: '1.5em', fontWeight: 700 }}>School Photos</div>
        <div style={{ fontSize: '1em', fontWeight: 600, opacity: 0.7 }}>Add images to display here</div>
      </div>
    </div>
  );
}
