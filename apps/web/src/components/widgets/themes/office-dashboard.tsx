import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Users, Calendar, AlertTriangle, Building, CheckCircle2 } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// OFFICE DASHBOARD THEME - Clean, corporate, premium glassmorphism
// ═══════════════════════════════════════════════════════════════════════════

export function OfficeDashboardLogo({ config, compact }: { config: any; compact?: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center p-6" style={{
      background: 'rgba(255, 255, 255, 0.85)',
      backdropFilter: 'blur(20px)',
      borderRadius: '16px',
      boxShadow: '0 8px 32px rgba(31, 38, 135, 0.1)',
      border: '1px solid rgba(255, 255, 255, 0.8)',
      containerType: 'size'
    }}>
      <div style={{ 
        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', 
        padding: '2cqh', 
        borderRadius: '12px', 
        marginRight: '3cqi', 
        boxShadow: '0 10px 20px rgba(59,130,246,0.3)' 
      }}>
        <Building color="white" style={{ width: '12cqh', height: '12cqh' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontSize: 'clamp(1rem, 5cqh, 3rem)', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          {config.schoolName || 'CENTRAL ADMINISTRATION'}
        </div>
        <div style={{ fontSize: 'clamp(0.8rem, 3cqh, 1.5rem)', fontWeight: 500, color: '#64748b', marginTop: '1cqh' }}>
          Real-time Operations Dashboard
        </div>
      </div>
    </div>
  );
}

export function OfficeDashboardText({ config, compact }: { config: any; compact?: boolean }) {
  const content = config.content || 'Welcome to the Central Office';
  return (
    <div className="absolute inset-0 flex items-center p-8 overflow-hidden" style={{
      background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)',
      borderRadius: '16px',
      boxShadow: '0 15px 30px rgba(30,58,138,0.3), inset 0 0 0 1px rgba(255,255,255,0.1)',
      color: 'white',
      containerType: 'size'
    }}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width: '50%',
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.05))',
        pointerEvents: 'none'
      }} />
      <div style={{
        fontSize: 'clamp(2rem, 12cqi, 6rem)',
        fontWeight: 700,
        lineHeight: 1.1,
        letterSpacing: '-0.02em',
        textShadow: '0 4px 20px rgba(0,0,0,0.3)',
        position: 'relative',
        zIndex: 10
      }}>
        {content}
      </div>
      <LayoutDashboard style={{ position: 'absolute', right: '-5cqi', opacity: 0.1, width: '60cqh', height: '60cqh' }} />
    </div>
  );
}

export function OfficeDashboardClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  
  return (
    <div className="absolute inset-0 flex flex-col justify-center p-6" style={{
      background: 'rgba(255, 255, 255, 0.95)',
      backdropFilter: 'blur(20px)',
      borderRadius: '16px',
      boxShadow: '0 10px 40px rgba(15,23,42,0.08)',
      border: '1px solid rgba(255, 255, 255, 0.8)',
      borderLeft: '6px solid #2563eb',
      containerType: 'size'
    }}>
      <div style={{ fontSize: 'clamp(2rem, 25cqi, 8rem)', fontWeight: 800, color: '#0f172a', lineHeight: 1, letterSpacing: '-0.05em' }}>
        {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </div>
      <div style={{ fontSize: 'clamp(0.8rem, 6cqi, 2rem)', fontWeight: 600, color: '#64748b', marginTop: '1cqh', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
      </div>
    </div>
  );
}

export function OfficeDashboardAnnouncement({ config, compact }: { config: any; compact?: boolean }) {
  const title = config.title || 'SYSTEM STATUS';
  const content = config.message || config.content || 'All network systems operating normally.';
  const priority = config.priority || 'normal';
  
  const styles: Record<string, any> = {
    normal: { bg: '#f0fdf4', text: '#15803d', icon: CheckCircle2, border: '#bbf7d0', glow: 'rgba(21,128,61,0.1)' },
    high: { bg: '#fffbeb', text: '#b45309', icon: AlertTriangle, border: '#fde68a', glow: 'rgba(180,83,9,0.1)' },
    urgent: { bg: '#fef2f2', text: '#b91c1c', icon: AlertTriangle, border: '#fca5a5', glow: 'rgba(185,28,28,0.1)' }
  };
  const s = styles[priority] || styles.normal;
  const Icon = s.icon;

  return (
    <div className="absolute inset-0 flex flex-col p-6" style={{
      background: 'rgba(255,255,255,0.95)',
      borderRadius: '16px',
      boxShadow: `0 10px 40px rgba(15,23,42,0.08), inset 0 0 0 1px ${s.border}`,
      borderTop: `6px solid ${s.text}`,
      containerType: 'size',
      overflow: 'hidden'
    }}>
      <div style={{ position: 'absolute', top: 0, right: 0, width: '150px', height: '150px', background: s.glow, filter: 'blur(40px)', borderRadius: '50%', pointerEvents: 'none' }} />
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '2cqi', marginBottom: '2cqh', color: s.text }}>
        <Icon style={{ width: '8cqh', height: '8cqh' }} />
        <div style={{ fontSize: 'clamp(1rem, 6cqh, 2.5rem)', fontWeight: 800, letterSpacing: '0.1em' }}>{title}</div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 'clamp(1.2rem, 10cqh, 4rem)', fontWeight: 600, color: '#1e293b', lineHeight: 1.3 }}>
        {content}
      </div>
    </div>
  );
}

export function OfficeDashboardStaff({ config, compact }: { config: any; compact?: boolean }) {
  const name = config.staffName || 'Dr. Emily Chen';
  const role = config.role || 'Superintendent';
  
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center" style={{
      background: 'rgba(255,255,255,0.95)',
      borderRadius: '16px',
      boxShadow: '0 10px 40px rgba(15,23,42,0.08)',
      border: '1px solid rgba(255,255,255,0.8)',
      containerType: 'size'
    }}>
      <div style={{
        width: '35cqh', height: '35cqh',
        background: '#f1f5f9',
        borderRadius: '50%',
        marginBottom: '3cqh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '3px solid #e2e8f0',
        boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
        overflow: 'hidden'
      }}>
        {config.imageUrl ? (
           <img src={config.imageUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
           <Users color="#94a3b8" style={{ width: '15cqh', height: '15cqh' }} />
        )}
      </div>
      <div style={{ fontSize: 'clamp(1.5rem, 8cqi, 3rem)', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>{name}</div>
      <div style={{ fontSize: 'clamp(1rem, 5cqi, 2rem)', fontWeight: 600, color: '#2563eb', marginTop: '1cqh', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{role}</div>
    </div>
  );
}

export function OfficeDashboardCalendar({ config, compact }: { config: any; compact?: boolean }) {
  const events = config.events || ['Board Meeting - 3:00 PM', 'Budget Review - 4:30 PM'];
  return (
    <div className="absolute inset-0 flex flex-col p-6" style={{
      background: 'rgba(255,255,255,0.95)',
      borderRadius: '16px',
      boxShadow: '0 10px 40px rgba(15,23,42,0.08)',
      border: '1px solid rgba(255,255,255,0.8)',
      containerType: 'size'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '2cqi', marginBottom: '2cqh', color: '#64748b', borderBottom: '1px solid #e2e8f0', paddingBottom: '2cqh' }}>
        <Calendar style={{ width: '8cqh', height: '8cqh' }} />
        <div style={{ fontSize: 'clamp(1rem, 6cqh, 2rem)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Today's Agenda</div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2cqh', overflow: 'hidden' }}>
        {events.slice(0, 4).map((evt: any, i: number) => {
           const timeStr = typeof evt === 'string' ? evt.split('-')[1]?.trim() : (evt.time || '');
           const titleStr = typeof evt === 'string' ? evt.split('-')[0]?.trim() : (evt.title || evt);
           return (
             <div key={i} style={{
               display: 'flex', alignItems: 'center', gap: '3cqi',
               padding: '2cqh 3cqi', background: '#f8fafc', borderRadius: '8px',
               border: '1px solid #e2e8f0', borderLeft: '4px solid #3b82f6'
             }}>
               {timeStr && <div style={{ fontSize: 'clamp(0.8rem, 4cqh, 1.5rem)', fontWeight: 700, color: '#3b82f6', whiteSpace: 'nowrap' }}>{timeStr}</div>}
               <div style={{ fontSize: 'clamp(1rem, 5cqh, 2rem)', fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleStr}</div>
             </div>
           );
        })}
      </div>
    </div>
  );
}

export function OfficeDashboardTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages = config.messages?.length ? config.messages : ['All systems operational.', 'Quarterly reports due Friday.', 'Staff meeting at 9AM.'];
  const text = messages.join('   •   ');
  return (
    <div className="absolute inset-0 flex items-center overflow-hidden" style={{
      background: '#0f172a',
      color: '#f8fafc',
      boxShadow: 'inset 0 4px 10px rgba(0,0,0,0.5)',
      containerType: 'size'
    }}>
      <div style={{ padding: '0 4cqi', height: '100%', background: '#1e293b', borderRight: '1px solid #334155', display: 'flex', alignItems: 'center', zIndex: 10, fontSize: 'clamp(1rem, 40cqh, 2.5rem)', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        UPDATES
      </div>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
        <div style={{ whiteSpace: 'nowrap', animation: 'dashTicker 30s linear infinite', fontSize: 'clamp(1.2rem, 50cqh, 3rem)', fontWeight: 500, paddingLeft: '100%' }}>
          {text}   •   {text}
        </div>
      </div>
      <style>{`@keyframes dashTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}
