import React, { useState, useEffect } from 'react';
import { CalendarDays, Cloud, CloudRain, CloudSnow, CloudLightning, Sun, Wind, Droplets, Trophy, Activity, Flame } from 'lucide-react';
import { fetchWeather, getWMO } from '../WidgetRenderer';

// ═══════════════════════════════════════════════════════════════════════════
// GYM & PE THEME - High energy, neon greens, dark background, sports fonts
// ═══════════════════════════════════════════════════════════════════════════

export function GymPEText({ config }: { config: any }) {
  const content = config.content || 'PUSH YOUR LIMITS';
  return (
    <div className="absolute inset-0 flex items-center justify-center text-center p-4" style={{
      background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95))',
      border: '4px solid #3b82f6',
      borderRadius: '24px',
      boxShadow: '0 0 30px rgba(59, 130, 246, 0.6), inset 0 0 20px rgba(0,0,0,0.8)',
      overflow: 'hidden'
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '6px', background: '#60a5fa', boxShadow: '0 0 20px #60a5fa' }} />
      <div style={{
        color: '#f8fafc',
        fontSize: '4.5cqi', // Use container query inline size for perfectly responsive text
        fontWeight: 900,
        fontStyle: 'italic',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        textShadow: '4px 4px 0 #1d4ed8, -1px -1px 0 #60a5fa, 0 0 30px rgba(59,130,246,0.8)',
        width: '100%',
        padding: '0 20px',
        wordWrap: 'break-word'
      }}>
        {content}
      </div>
      <Flame className="absolute bottom-4 right-4 text-blue-500 opacity-20" size={100} />
    </div>
  );
}

export function GymPEWeather({ config, compact }: { config: any; compact?: boolean }) {
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
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{
      background: 'linear-gradient(180deg, #1e293b, #0f172a)',
      border: '3px solid #475569',
      borderRadius: compact ? '16px' : '32px',
      color: '#f8fafc',
      boxShadow: 'inset 0 0 40px rgba(0,0,0,0.8), 0 10px 20px rgba(0,0,0,0.5)'
    }}>
      <div style={{ fontSize: compact ? '1.2cqi' : '1.8cqi', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '0.5em' }}>
        OUTDOOR CONDITIONS
      </div>
      <div className="flex items-center gap-6">
        <Icon style={{ width: compact ? '2.5em' : '4em', height: compact ? '2.5em' : '4em', color: wmo.iconColor, filter: 'drop-shadow(0 0 15px rgba(255,255,255,0.2))' }} />
        <div style={{ fontSize: compact ? '4cqi' : '7cqi', fontWeight: 900, lineHeight: 1, fontFamily: 'monospace', textShadow: '0 0 20px rgba(255,255,255,0.2)' }}>
          {weather.temp}°
        </div>
      </div>
    </div>
  );
}

export function GymPEBellSchedule({ config, compact }: { config: any; compact?: boolean }) {
  const scheduleText = config.schedule || 'Period 1: 8:00 - 8:50\nPeriod 2: 8:55 - 9:45\nPeriod 3: 9:50 - 10:40\nLunch: 10:45 - 11:15\nPeriod 4: 11:20 - 12:10\nPeriod 5: 12:15 - 1:05\nPeriod 6: 1:10 - 2:00';
  const lines = scheduleText.split('\n').filter(Boolean).slice(0, 6); // Max 6 periods
  
  return (
    <div className="absolute inset-0 flex flex-col p-6" style={{
      background: 'linear-gradient(180deg, #0f172a, #020617)',
      borderRadius: compact ? '16px' : '24px',
      border: '2px solid #334155',
      borderLeft: '8px solid #22c55e',
      boxShadow: '0 10px 40px rgba(0,0,0,0.6)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5em' }}>
        <Activity color="#22c55e" size={compact ? 24 : 32} />
        <div style={{ fontSize: compact ? '1.5em' : '2.2em', fontWeight: 900, color: '#f8fafc', textTransform: 'uppercase', letterSpacing: '0.1em', textShadow: '0 0 15px rgba(34, 197, 94, 0.4)' }}>CLASS ROTATION</div>
      </div>
      
      <div className="flex-1 flex flex-col justify-around gap-2">
        {lines.map((line: string, i: number) => {
          const parts = line.split(':');
          const name = parts[0];
          const time = parts.slice(1).join(':').trim();
          
          return (
            <div key={i} style={{
              background: 'linear-gradient(90deg, rgba(34, 197, 94, 0.15), rgba(0,0,0,0.5))',
              padding: compact ? '0.8em 1.2em' : '1.2em 2em',
              borderRadius: '12px',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: 'inset 0 0 10px rgba(34, 197, 94, 0.05)'
            }}>
              <div style={{ color: '#e2e8f0', fontSize: compact ? '1.2em' : '1.6em', fontWeight: 800, textTransform: 'uppercase' }}>{name}</div>
              <div style={{ color: '#4ade80', fontFamily: 'monospace', fontSize: compact ? '1.4em' : '2em', fontWeight: 900, textShadow: '0 0 10px rgba(74, 222, 128, 0.5)' }}>{time}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GymPEAnnouncement({ config, compact }: { config: any; compact?: boolean }) {
  const title = config.title || 'LOCKER ROOM ALERT';
  const content = config.message || config.content || 'Please ensure all locks are secured before leaving for the weekend.';
  
  return (
    <div className="absolute inset-0 flex flex-col p-8" style={{
      background: '#0f172a',
      backgroundImage: 'radial-gradient(rgba(239, 68, 68, 0.15) 2px, transparent 2px)',
      backgroundSize: '30px 30px',
      borderRadius: compact ? '16px' : '24px',
      border: '4px solid #7f1d1d',
      boxShadow: 'inset 0 0 80px rgba(0,0,0,0.9), 0 10px 30px rgba(0,0,0,0.5)'
    }}>
      <div style={{
        background: 'linear-gradient(90deg, #ef4444, #b91c1c)',
        color: 'white',
        display: 'inline-flex',
        alignItems: 'center',
        padding: '12px 32px',
        borderRadius: '12px',
        fontSize: compact ? '1.2em' : '1.8em',
        fontWeight: 900,
        textTransform: 'uppercase',
        letterSpacing: '0.15em',
        alignSelf: 'flex-start',
        marginBottom: '1.5em',
        boxShadow: '0 4px 20px rgba(239,68,68,0.6)',
        border: '2px solid #fca5a5'
      }}>
        {title}
      </div>
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        fontSize: compact ? '2cqi' : '3.5cqi',
        fontWeight: 800,
        color: '#f8fafc',
        lineHeight: 1.4,
        textShadow: '0 4px 10px rgba(0,0,0,0.8)'
      }}>
        {content}
      </div>
    </div>
  );
}

export function GymPETicker({ config }: { config: any }) {
  const messages = config.messages?.length ? config.messages : ['FITNESSGRAM PACER TEST NEXT WEEK', 'DODGEBALL TOURNAMENT SIGNUPS OPEN', 'REMEMBER YOUR WATER BOTTLES'];
  const text = messages.join('   ///   ');
  return (
    <div className="absolute inset-0 flex items-center overflow-hidden" style={{
      background: 'linear-gradient(90deg, #16a34a, #22c55e, #16a34a)',
      borderTop: '6px solid #14532d',
      borderBottom: '6px solid #14532d',
      boxShadow: '0 0 30px rgba(34, 197, 94, 0.4)'
    }}>
      <div style={{ whiteSpace: 'nowrap', animation: 'gymTicker 20s linear infinite', fontSize: '5cqi', fontWeight: 900, fontStyle: 'italic', color: '#022c22', textTransform: 'uppercase', paddingLeft: '100%', textShadow: '2px 2px 0 rgba(255,255,255,0.3)' }}>
        {text}   ///   {text}
      </div>
      <style>{`@keyframes gymTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}
