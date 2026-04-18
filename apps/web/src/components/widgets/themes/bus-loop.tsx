import React, { useEffect, useState } from 'react';
import { Clock, Calendar, AlertTriangle, CloudRain, Sun, Cloud, Snowflake, Bus } from 'lucide-react';

const BL = {
  bg: '#000000',
  panel: '#111111',
  yellow: '#FFCC00',
  red: '#FF3B30',
  green: '#32D74B',
  orange: '#FF9500',
  text: '#FFFFFF',
  textMuted: '#8E8E93',
  border: '#333333'
};

const BL_FONT = '"Share Tech Mono", "Courier New", Courier, monospace';
const BL_DISPLAY = '"Arial Black", Impact, system-ui, sans-serif';

export function BusLoopText({ config, compact }: { config: any; compact?: boolean }) {
  const content = config.content || 'BUS LOOP INFORMATION';
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4" style={{
      background: 'linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%)',
      border: '4px solid #333',
      borderBottom: `8px solid ${BL.yellow}`,
      borderRadius: '12px',
      boxShadow: 'inset 0 0 40px rgba(0,0,0,0.8), 0 10px 30px rgba(0,0,0,0.9)',
      containerType: 'size'
    }}>
      <h1 style={{
        fontFamily: BL_DISPLAY,
        fontSize: 'clamp(2rem, 15cqi, 8rem)',
        color: BL.yellow,
        textTransform: 'uppercase',
        textAlign: 'center',
        margin: 0,
        textShadow: '0 4px 20px rgba(255,204,0,0.4), 2px 2px 0 #000',
        letterSpacing: '0.05em'
      }}>
        {content}
      </h1>
    </div>
  );
}

export function BusLoopClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const h = now.getHours() % 12 || 12;
  const m = now.getMinutes().toString().padStart(2, '0');
  const ampm = now.getHours() >= 12 ? 'PM' : 'AM';

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{
      background: '#050505',
      border: '4px solid #222',
      borderBottom: `4px solid ${BL.yellow}`,
      borderRadius: '12px',
      boxShadow: 'inset 0 0 20px rgba(0,0,0,1), 0 10px 20px rgba(0,0,0,0.5)',
      containerType: 'size'
    }}>
      {/* LED grid overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '4px 4px', pointerEvents: 'none' }} />
      
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '2cqi', color: BL.yellow, position: 'relative', zIndex: 10 }}>
        <span style={{ fontFamily: BL_DISPLAY, fontSize: 'clamp(3rem, 25cqi, 10rem)', fontWeight: 900, textShadow: '0 0 20px rgba(255,204,0,0.6)' }}>
          {h}:{m}
        </span>
        <span style={{ fontFamily: BL_FONT, fontSize: 'clamp(1rem, 8cqi, 3rem)', fontWeight: 'bold' }}>
          {ampm}
        </span>
      </div>
    </div>
  );
}

export function BusLoopTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages = config.messages || ['BUS 42: ARRIVED', 'BUS 18: 5 MINS AWAY'];
  const text = messages.join('   ||   ');
  return (
    <div className="absolute inset-0 flex items-center overflow-hidden" style={{
      background: '#000',
      borderTop: '4px solid #222',
      borderBottom: '4px solid #222',
      boxShadow: 'inset 0 0 20px rgba(0,0,0,1)',
      containerType: 'size'
    }}>
      {/* LED grid overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(rgba(0,255,0,0.1) 1px, transparent 1px)', backgroundSize: '3px 3px', pointerEvents: 'none', zIndex: 10 }} />
      
      <div style={{
        whiteSpace: 'nowrap',
        animation: 'busTicker 20s linear infinite',
        display: 'flex', alignItems: 'center',
        paddingLeft: '100%',
        position: 'relative', zIndex: 5
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4cqi' }}>
          <Bus style={{ color: BL.yellow, width: '15cqh', height: '15cqh' }} />
          <span style={{ fontFamily: BL_FONT, fontSize: 'clamp(2rem, 15cqh, 8rem)', color: BL.green, fontWeight: 'bold', textShadow: `0 0 15px ${BL.green}` }}>
            {text}   ||   {text}
          </span>
        </div>
      </div>
      <style>{`@keyframes busTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}

export function BusLoopWeather({ config, compact }: { config: any; compact?: boolean }) {
  const t = config.tempF || 72;
  const c = (config.condition || 'Sunny').toLowerCase();
  let Icon = Sun;
  let color = BL.yellow;
  if (c.includes('rain')) { Icon = CloudRain; color = '#60a5fa'; }
  else if (c.includes('cloud')) { Icon = Cloud; color = '#94a3b8'; }
  else if (c.includes('snow')) { Icon = Snowflake; color = '#FFF'; }

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-4" style={{
      background: 'linear-gradient(135deg, #111 0%, #000 100%)',
      border: '2px solid #333',
      borderRadius: '12px',
      boxShadow: '0 10px 20px rgba(0,0,0,0.5)',
      containerType: 'size'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4cqi' }}>
        <Icon style={{ color, width: '15cqh', height: '15cqh', filter: `drop-shadow(0 0 10px ${color})` }} />
        <span style={{ fontFamily: BL_DISPLAY, fontSize: 'clamp(2rem, 20cqh, 8rem)', color: '#fff', fontWeight: 900 }}>
          {t}°
        </span>
      </div>
      <span style={{ fontFamily: BL_FONT, fontSize: 'clamp(0.8rem, 6cqh, 2rem)', color: BL.textMuted, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '2cqh' }}>
        {config.location || 'Springfield'}
      </span>
    </div>
  );
}

export function BusLoopAnnouncement({ config, compact }: { config: any; compact?: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{
      background: '#1a0505',
      border: `4px solid ${BL.red}`,
      borderRadius: '12px',
      boxShadow: `0 0 30px rgba(255,59,48,0.2), inset 0 0 20px rgba(0,0,0,0.8)`,
      containerType: 'size'
    }}>
      <div style={{
        background: BL.red,
        color: '#fff',
        fontFamily: BL_DISPLAY,
        fontSize: 'clamp(1rem, 6cqh, 2.5rem)',
        fontWeight: 900,
        textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2cqi',
        padding: '2cqh 0',
        boxShadow: '0 4px 10px rgba(0,0,0,0.5)'
      }}>
        <AlertTriangle style={{ width: '6cqh', height: '6cqh' }} />
        {config.badgeLabel || 'ALERT'}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '6cqi', textAlign: 'center' }}>
        <h2 style={{ fontFamily: BL_DISPLAY, fontSize: 'clamp(1.5rem, 8cqh, 3.5rem)', color: BL.red, textTransform: 'uppercase', fontWeight: 900, marginBottom: '2cqh', textShadow: '0 2px 10px rgba(255,59,48,0.4)' }}>
          {config.title || 'Attention'}
        </h2>
        <p style={{ fontFamily: BL_FONT, fontSize: 'clamp(1rem, 5cqh, 2rem)', color: '#fff', fontWeight: 'bold' }}>
          {config.message || 'Please remain seated until your bus is called.'}
        </p>
      </div>
    </div>
  );
}

export function BusLoopCalendar({ config, compact }: { config: any; compact?: boolean }) {
  const events = config.events || [];
  return (
    <div className="absolute inset-0 flex flex-col p-6" style={{
      background: 'linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%)',
      border: '2px solid #333',
      borderRadius: '12px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
      containerType: 'size'
    }}>
      <h2 style={{
        fontFamily: BL_DISPLAY, fontSize: 'clamp(1.2rem, 8cqh, 3rem)',
        color: BL.yellow, textTransform: 'uppercase', letterSpacing: '0.1em',
        borderBottom: '2px solid #333', paddingBottom: '2cqh', marginBottom: '3cqh'
      }}>
        AFTER-SCHOOL ACTIVITIES
      </h2>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2cqh', overflow: 'hidden' }}>
        {events.slice(0, 5).map((e: any, i: number) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: '3cqi',
            background: '#000', padding: '2cqh 3cqi', borderRadius: '6px',
            border: '1px solid #222'
          }}>
            <div style={{
              background: '#333', color: BL.yellow, padding: '1cqh 2cqi',
              borderRadius: '4px', fontFamily: BL_FONT, fontSize: 'clamp(0.8rem, 4cqh, 1.5rem)',
              fontWeight: 'bold'
            }}>
              {e.time || e.date}
            </div>
            <div style={{
              color: '#fff', fontFamily: BL_FONT, fontSize: 'clamp(1rem, 5cqh, 2rem)',
              fontWeight: 'bold', textTransform: 'uppercase', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis'
            }}>
              {e.title}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
