import React, { useState, useEffect } from 'react';
import { Shield, Bell } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// PRINCIPAL'S OFFICE THEME - Premium Mahogany & Gold Brass Plaque Aesthetic
// ═══════════════════════════════════════════════════════════════════════════

export function PrincipalsOfficeLogo({ config }: { config: any }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-6" style={{
      background: 'rgba(20, 10, 5, 0.6)',
      backdropFilter: 'blur(16px)',
      border: '2px solid rgba(212, 175, 55, 0.4)',
      borderRadius: '8px',
      boxShadow: '0 25px 50px -12px rgba(0,0,0,0.7), inset 0 0 20px rgba(212, 175, 55, 0.1)',
      containerType: 'size'
    }}>
      <div style={{
        width: '40cqh', height: '40cqh',
        background: 'linear-gradient(135deg, #FDE08B 0%, #D4AF37 40%, #AA7C11 100%)',
        borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center',
        marginBottom: '4cqh',
        boxShadow: '0 10px 30px rgba(0,0,0,0.6), inset 0 2px 10px rgba(255,255,255,0.6)',
        border: '3px solid #1a0f0a'
      }}>
        <Shield color="#1a0f0a" size="20cqh" strokeWidth={1.5} />
      </div>
      <div style={{ 
        fontSize: '12cqh', 
        fontWeight: 700, 
        color: '#FDE08B', 
        letterSpacing: '0.15em', 
        textAlign: 'center',
        fontFamily: 'Georgia, serif',
        textShadow: '0 2px 4px rgba(0,0,0,0.8)'
      }}>
        WASHINGTON
      </div>
      <div style={{ 
        fontSize: '5cqh', 
        fontWeight: 400, 
        color: '#D4AF37', 
        letterSpacing: '0.3em', 
        textTransform: 'uppercase', 
        marginTop: '2cqh',
        fontFamily: 'Arial, sans-serif'
      }}>
        HIGH SCHOOL
      </div>
    </div>
  );
}

export function PrincipalsOfficeText({ config }: { config: any }) {
  const content = config.content || 'Welcome to the Main Office';
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center" style={{
      background: 'linear-gradient(145deg, #e6cd82 0%, #c49e41 45%, #a67c1e 100%)',
      borderRadius: '6px',
      boxShadow: '0 20px 40px rgba(0,0,0,0.5), inset 0 2px 5px rgba(255,255,255,0.6), inset 0 -2px 10px rgba(0,0,0,0.4)',
      border: '4px solid #3d2314',
      containerType: 'size'
    }}>
      {/* Inner engrave styling */}
      <div className="absolute inset-2 border-2 border-dashed border-[#8a631c] opacity-40 rounded-sm pointer-events-none" />
      
      <div style={{
        fontSize: 'clamp(2rem, 15cqi, 6rem)',
        fontWeight: 400,
        color: '#2b180d',
        fontFamily: 'Georgia, serif',
        lineHeight: 1.3,
        textShadow: '0 1px 1px rgba(255,255,255,0.3)',
        padding: '0 5cqi'
      }}>
        {content}
      </div>
      <div style={{ width: '30cqi', height: '2px', background: '#5c3a21', marginTop: '6cqh', opacity: 0.6 }} />
    </div>
  );
}

export function PrincipalsOfficeClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{
      background: 'rgba(20, 10, 5, 0.7)',
      backdropFilter: 'blur(12px)',
      borderRadius: '8px',
      color: '#FDE08B',
      border: '1px solid rgba(212, 175, 55, 0.3)',
      boxShadow: '0 15px 35px rgba(0,0,0,0.6)',
      containerType: 'size'
    }}>
      <div style={{ 
        fontSize: 'clamp(1rem, 6cqi, 2rem)', 
        fontWeight: 600, 
        color: '#D4AF37', 
        textTransform: 'uppercase', 
        letterSpacing: '0.15em', 
        marginBottom: '2cqh' 
      }}>
        {dateStr}
      </div>
      <div style={{ 
        fontSize: 'clamp(3rem, 25cqi, 10rem)', 
        fontWeight: 300, 
        fontFamily: 'Georgia, serif',
        textShadow: '0 4px 15px rgba(212, 175, 55, 0.3)'
      }}>
        {timeStr}
      </div>
    </div>
  );
}

export function PrincipalsOfficeAnnouncement({ config, compact }: { config: any; compact?: boolean }) {
  const title = config.title || 'NOTICE';
  const content = config.message || config.content || 'Please sign in at the front desk upon arrival.';
  
  return (
    <div className="absolute inset-0 flex flex-col p-8" style={{
      background: '#fcfaf5', // Cream paper texture
      borderRadius: '4px',
      boxShadow: '0 20px 40px rgba(0,0,0,0.5), inset 0 0 60px rgba(212, 175, 55, 0.05)',
      border: '10px solid #2b180d', // Thick dark wood frame
      outline: '2px solid #D4AF37', // Gold inner lip
      outlineOffset: '-10px',
      containerType: 'size'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4cqi', marginBottom: '4cqh', borderBottom: '2px solid #e0d5c1', paddingBottom: '3cqh' }}>
        <Bell color="#8a2be2" size="8cqh" style={{ color: '#8c2425' }} />
        <div style={{ 
          fontSize: 'clamp(1.5rem, 8cqi, 3rem)', 
          fontWeight: 700, 
          color: '#2b180d', 
          letterSpacing: '0.1em',
          fontFamily: 'Georgia, serif'
        }}>
          {title}
        </div>
      </div>
      <div style={{ 
        fontSize: 'clamp(1.2rem, 6cqi, 2.5rem)', 
        fontWeight: 400, 
        color: '#4a3326', 
        lineHeight: 1.6, 
        fontFamily: 'Georgia, serif' 
      }}>
        {content}
      </div>
    </div>
  );
}

export function PrincipalsOfficeRichText({ config }: { config: any }) {
  const content = config.html || '<h2>Office Hours</h2><p>Monday - Friday: 7:30 AM - 4:00 PM</p>';
  return (
    <div className="absolute inset-0 p-8 flex flex-col" style={{
      background: 'rgba(30, 18, 12, 0.85)',
      backdropFilter: 'blur(20px)',
      borderRadius: '8px',
      borderLeft: '6px solid #D4AF37',
      borderRight: '1px solid rgba(212,175,55,0.2)',
      borderTop: '1px solid rgba(212,175,55,0.2)',
      borderBottom: '1px solid rgba(212,175,55,0.2)',
      boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
      overflow: 'hidden',
      containerType: 'size'
    }}>
      <div className="prose prose-lg max-w-none flex-grow" style={{ 
        color: '#e2e8f0',
        fontSize: 'clamp(1rem, 5cqi, 2rem)'
      }} dangerouslySetInnerHTML={{ __html: content }} />
    </div>
  );
}

export function PrincipalsOfficeTicker({ config }: { config: any }) {
  const messages = config.messages?.length ? config.messages : ['Welcome to Washington High School', 'Excellence in Education', 'Please Silence Your Cell Phones'];
  const text = messages.join('   ✦   ');
  return (
    <div className="absolute inset-0 flex items-center overflow-hidden" style={{
      background: 'linear-gradient(90deg, #110906 0%, #2a180f 50%, #110906 100%)',
      color: '#FDE08B',
      borderTop: '3px solid #D4AF37',
      borderBottom: '3px solid #D4AF37',
      boxShadow: '0 0 20px rgba(212, 175, 55, 0.15)'
    }}>
      <div style={{ 
        whiteSpace: 'nowrap', 
        animation: 'officeTicker 40s linear infinite', 
        fontSize: '4vh', 
        fontWeight: 400, 
        letterSpacing: '0.1em', 
        paddingLeft: '100%', 
        fontFamily: 'Georgia, serif',
        textShadow: '0 0 10px rgba(253, 224, 139, 0.3)'
      }}>
        {text}   ✦   {text}
      </div>
      <style>{`@keyframes officeTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}
