import React, { useState, useEffect } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// MUSIC & ARTS THEME - Velvet Curtain, Spotlight, Elegant Neons
// ═══════════════════════════════════════════════════════════════════════════

export function MusicArtsText({ config, compact }: { config: any; compact?: boolean }) {
  const content = config.content || 'Music & Arts';
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8" style={{
      background: 'rgba(0,0,0,0.4)',
      backdropFilter: 'blur(10px)',
      borderBottom: '4px solid rgba(168, 85, 247, 0.4)',
      boxShadow: 'inset 0 -20px 40px rgba(168, 85, 247, 0.1)',
      containerType: 'size'
    }}>
      <h1 data-field="content" style={{
        fontSize: 'clamp(2rem, 15cqi, 8rem)',
        color: 'transparent',
        background: 'linear-gradient(90deg, #f0abfc 0%, #a855f7 100%)',
        WebkitBackgroundClip: 'text',
        fontFamily: '"Playfair Display", Georgia, serif',
        fontWeight: 700,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        textAlign: 'center',
        margin: 0,
        textShadow: '0 0 30px rgba(217, 70, 239, 0.5)',
        whiteSpace: 'pre-wrap' as const
      }}>
        {content}
      </h1>
    </div>
  );
}

export function MusicArtsCountdown({ config, compact }: { config: any; compact?: boolean }) {
  const [timeLeft, setTimeLeft] = useState({ d: 0, h: 0, m: 0, s: 0 });
  const label = config.label || 'Next Event';

  useEffect(() => {
    if (!config.targetDate) return;
    const target = new Date(config.targetDate).getTime();
    
    const update = () => {
      const now = new Date().getTime();
      const diff = target - now;
      if (diff <= 0) return setTimeLeft({ d: 0, h: 0, m: 0, s: 0 });
      setTimeLeft({
        d: Math.floor(diff / (1000 * 60 * 60 * 24)),
        h: Math.floor((diff / (1000 * 60 * 60)) % 24),
        m: Math.floor((diff / 1000 / 60) % 60),
        s: Math.floor((diff / 1000) % 60),
      });
    };
    
    update();
    const int = setInterval(update, 1000);
    return () => clearInterval(int);
  }, [config.targetDate]);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8" style={{
      background: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(10px)',
      borderLeft: '2px solid rgba(168, 85, 247, 0.3)',
      borderBottom: '2px solid rgba(168, 85, 247, 0.3)',
      containerType: 'size'
    }}>
      <div data-field="label" style={{
        color: '#f0abfc',
        fontFamily: 'Georgia, serif',
        textTransform: 'uppercase',
        letterSpacing: '0.2em',
        fontSize: 'clamp(1rem, 4cqi, 2rem)',
        marginBottom: '4cqh',
        opacity: 0.8,
        fontWeight: 'bold',
        whiteSpace: 'pre-wrap' as const
      }}>
        {label}
      </div>

      <div style={{ display: 'flex', gap: '3cqi', alignItems: 'baseline', width: '100%', justifyContent: 'center' }}>
        {[
          { v: timeLeft.d, l: 'Days' },
          { v: timeLeft.h, l: 'Hrs', showColon: true },
          { v: timeLeft.m, l: 'Min', showColon: true }
        ].map((item, i) => (
          <React.Fragment key={i}>
            {item.showColon && <span style={{ fontSize: 'clamp(2rem, 10cqi, 6rem)', color: '#d946ef', fontWeight: 'bold', animation: 'pulse 2s infinite' }}>:</span>}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              minWidth: '20cqi'
            }}>
              <span style={{ fontSize: 'clamp(3rem, 15cqi, 8rem)', fontFamily: 'monospace', color: '#fff', fontWeight: 'bold', textShadow: '0 0 20px rgba(255,255,255,0.6)' }}>
                {item.v.toString().padStart(2, '0')}
              </span>
              <span style={{ fontSize: 'clamp(0.8rem, 3cqi, 1.5rem)', color: '#e879f9', textTransform: 'uppercase', fontWeight: 'bold', letterSpacing: '0.15em', marginTop: '1cqh' }}>
                {item.l}
              </span>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export function MusicArtsRichText({ config, compact }: { config: any; compact?: boolean }) {
  return (
    <div className="absolute inset-0 p-8 flex flex-col items-center justify-center" style={{ containerType: 'size' }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'gradient(linear, left top, left bottom, from(rgba(88,28,135,0.4)), to(rgba(112,26,117,0.1)))',
        backdropFilter: 'blur(12px)', zIndex: 0
      }} />
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '2px', background: 'linear-gradient(90deg, transparent, #d946ef, transparent)', opacity: 0.5 }} />
      
      <div style={{
        position: 'relative', zIndex: 10,
        width: '100%', height: '100%',
        background: 'rgba(0,0,0,0.6)',
        border: '1px solid rgba(217,70,239,0.3)',
        borderRadius: '12px',
        padding: '6cqi',
        boxShadow: '0 0 40px rgba(217,70,239,0.15)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div 
          className="prose prose-invert max-w-none flex-1 overflow-hidden"
          style={{ fontSize: 'clamp(1.2rem, 5cqi, 2.5rem)', color: '#f3e8ff' }}
          dangerouslySetInnerHTML={{ __html: config.html || '<h3 style="color:#e879f9">Rehearsal Schedule</h3><p>Update with current schedule</p>' }}
        />
      </div>
    </div>
  );
}

export function MusicArtsSpotlight({ config, compact }: { config: any; compact?: boolean }) {
  return (
    <div className="absolute inset-0 p-8 flex items-center justify-center overflow-hidden" style={{ containerType: 'size' }}>
      {/* Spotlight effect */}
      <div style={{ position: 'absolute', top: '-40%', left: '50%', transform: 'translateX(-50%) rotate(15deg)', width: '30%', height: '200%', background: 'rgba(255,255,255,0.05)', filter: 'blur(40px)', zIndex: 0, pointerEvents: 'none' }} />
      
      <div style={{
        position: 'relative', zIndex: 10,
        background: 'linear-gradient(135deg, rgba(49,46,129,0.8), rgba(88,28,135,0.8))',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(192,132,252,0.3)',
        borderRadius: '24px',
        padding: '5cqi',
        display: 'flex',
        alignItems: 'center',
        gap: '6cqi',
        boxShadow: '0 0 50px rgba(139,92,246,0.3)',
        width: '100%',
        height: '100%'
      }}>
        <div style={{
          width: '35cqh', height: '35cqh',
          borderRadius: '50%',
          overflow: 'hidden',
          border: '4px solid #d946ef',
          boxShadow: '0 0 30px rgba(217,70,239,0.5)',
          flexShrink: 0,
          background: '#000'
        }}>
          {config.imageUrl ? (
            <img src={config.imageUrl} alt={config.staffName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15cqh', fontWeight: 'bold', color: '#d946ef', background: 'rgba(112,26,117,0.3)' }}>
              {config.staffName?.charAt(0) || '?'}
            </div>
          )}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{
            display: 'inline-block',
            padding: '1cqh 2cqi',
            background: 'rgba(217,70,239,0.2)',
            color: '#f0abfc',
            border: '1px solid rgba(217,70,239,0.4)',
            borderRadius: '999px',
            fontSize: 'clamp(0.8rem, 3cqi, 1.5rem)',
            fontWeight: 'bold',
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            marginBottom: '2cqh',
            alignSelf: 'flex-start'
          }}>
            {config.role || 'Featured Artist'}
          </div>
          <h2 style={{ fontSize: 'clamp(2rem, 10cqi, 5rem)', fontWeight: 'bold', color: '#fff', margin: '0 0 2cqh 0', letterSpacing: '0.05em', textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
            {config.staffName || 'Student Name'}
          </h2>
          <p style={{ fontSize: 'clamp(1.2rem, 5cqi, 2.5rem)', color: '#e9d5ff', fontStyle: 'italic', margin: 0, lineHeight: 1.5 }}>
            "{config.bio || 'Outstanding dedication to our program.'}"
          </p>
        </div>
      </div>
    </div>
  );
}

export function MusicArtsTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages = config.messages || ['Arts Ticker'];
  const text = messages.join('   🎵   ');
  return (
    <div className="absolute inset-0 flex items-center overflow-hidden" style={{
      background: '#000',
      boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.5)',
      borderTop: '1px solid rgba(112,26,117,0.5)'
    }}>
      {/* Neon line at top */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '2px', background: 'linear-gradient(90deg, transparent, #d946ef, transparent)', boxShadow: '0 0 15px rgba(217,70,239,1)' }} />
      
      <div style={{
        padding: '0 30px', height: '100%',
        background: 'linear-gradient(90deg, #4a044e, #2e1065)',
        color: '#fff', fontWeight: 'bold', textTransform: 'uppercase',
        letterSpacing: '0.15em', whiteSpace: 'nowrap', zIndex: 10,
        borderRight: '1px solid rgba(217,70,239,0.3)',
        display: 'flex', alignItems: 'center', gap: '15px'
      }}>
        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#e879f9', boxShadow: '0 0 10px #e879f9', animation: 'pulse 2s infinite' }}></span>
        Now Playing
      </div>
      <div style={{ flex: 1, position: 'relative', height: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
        <div style={{
          whiteSpace: 'nowrap', animation: 'musicTicker 30s linear infinite',
          fontSize: '3.5vh', fontWeight: 300, letterSpacing: '0.1em', color: '#e9d5ff',
          paddingLeft: '100%'
        }}>
          {text}   🎵   {text}
        </div>
      </div>
      <style>{`@keyframes musicTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}
