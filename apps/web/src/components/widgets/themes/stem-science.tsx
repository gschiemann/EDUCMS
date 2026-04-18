import React, { useState, useEffect } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// STEM SCIENCE THEME - Cyberpunk / Futuristic Lab
// ═══════════════════════════════════════════════════════════════════════════

export function StemScienceText({ config, compact }: { config: any; compact?: boolean }) {
  const content = config.content || 'STEM Lab';
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8" style={{
      background: 'rgba(2, 6, 23, 0.7)',
      backdropFilter: 'blur(12px)',
      border: '2px solid rgba(6, 182, 212, 0.3)',
      borderBottomWidth: '4px',
      borderBottomColor: '#06b6d4',
      boxShadow: '0 10px 30px rgba(0,0,0,0.8), inset 0 0 20px rgba(6,182,212,0.1)',
      containerType: 'size'
    }}>
      <h1 style={{ 
        fontSize: 'clamp(2rem, 15cqi, 8rem)', 
        color: 'transparent',
        background: 'linear-gradient(90deg, #67e8f9 0%, #3b82f6 100%)',
        WebkitBackgroundClip: 'text',
        fontFamily: '"Share Tech Mono", "Courier New", monospace',
        fontWeight: 700,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        textAlign: 'center',
        margin: 0,
        textShadow: '0 0 20px rgba(6,182,212,0.4)'
      }}>
        <span style={{ color: '#06b6d4', marginRight: '4cqi', opacity: 0.7 }}>{"//"}</span>
        {content}
      </h1>
    </div>
  );
}

export function StemScienceCountdown({ config, compact }: { config: any; compact?: boolean }) {
  const [timeLeft, setTimeLeft] = useState({ d: 0, h: 0, m: 0, s: 0 });
  const label = config.label || 'Project Deadline';

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
      background: 'rgba(2, 6, 23, 0.7)',
      backdropFilter: 'blur(12px)',
      borderLeft: '4px solid #06b6d4',
      borderBottom: '2px solid rgba(6,182,212,0.3)',
      boxShadow: 'inset 0 0 30px rgba(6,182,212,0.05)',
      containerType: 'size'
    }}>
      {/* Tech accents */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '20px', height: '20px', borderTop: '2px solid #22d3ee', borderLeft: '2px solid #22d3ee', opacity: 0.8 }} />
      <div style={{ position: 'absolute', bottom: 0, right: 0, width: '20px', height: '20px', borderBottom: '2px solid #22d3ee', borderRight: '2px solid #22d3ee', opacity: 0.8 }} />
      
      <div style={{
        color: '#22d3ee',
        fontFamily: '"Share Tech Mono", monospace',
        textTransform: 'uppercase',
        letterSpacing: '0.2em',
        fontSize: 'clamp(1rem, 4cqi, 2rem)',
        marginBottom: '6cqh',
        display: 'flex',
        alignItems: 'center',
        gap: '2cqi'
      }}>
        <div style={{ width: '2cqi', height: '2cqi', background: '#06b6d4', animation: 'pulse 2s infinite' }} />
        {label}
      </div>

      <div style={{ display: 'flex', gap: '3cqi', alignItems: 'baseline', width: '100%', justifyContent: 'center' }}>
        {[
          { v: timeLeft.d, l: 'Days' },
          { v: timeLeft.h, l: 'Hrs', showColon: true },
          { v: timeLeft.m, l: 'Min', showColon: true }
        ].map((item, i) => (
          <React.Fragment key={i}>
            {item.showColon && <span style={{ fontSize: 'clamp(2rem, 10cqi, 6rem)', color: '#06b6d4', fontWeight: 'bold' }}>:</span>}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              background: 'rgba(8, 47, 73, 0.4)',
              padding: '3cqi',
              borderRadius: '4px',
              border: '1px solid rgba(6,182,212,0.3)',
              minWidth: '22cqi'
            }}>
              <span style={{ fontSize: 'clamp(2.5rem, 12cqi, 7rem)', fontFamily: '"Share Tech Mono", monospace', color: '#cffafe', fontWeight: 'bold', textShadow: '0 0 10px rgba(6,182,212,0.5)' }}>
                {item.v.toString().padStart(2, '0')}
              </span>
              <span style={{ fontSize: 'clamp(0.8rem, 3cqi, 1.5rem)', color: '#06b6d4', textTransform: 'uppercase', fontWeight: 'bold', letterSpacing: '0.1em', marginTop: '1cqh', fontFamily: '"Share Tech Mono", monospace' }}>
                {item.l}
              </span>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export function StemScienceRichText({ config, compact }: { config: any; compact?: boolean }) {
  return (
    <div className="absolute inset-0 p-8 flex flex-col" style={{ containerType: 'size' }}>
      <div style={{
        background: 'rgba(2, 6, 23, 0.85)',
        backdropFilter: 'blur(20px)',
        borderRadius: '8px',
        border: '1px solid rgba(6, 182, 212, 0.4)',
        boxShadow: '0 0 40px rgba(6,182,212,0.15)',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Terminal header */}
        <div style={{
          height: '6cqh', minHeight: '30px', background: 'rgba(8, 47, 73, 0.8)',
          borderBottom: '1px solid rgba(6,182,212,0.5)',
          display: 'flex', alignItems: 'center', padding: '0 4cqi', gap: '1.5cqi'
        }}>
          <div style={{ width: '1.5cqi', height: '1.5cqi', borderRadius: '50%', background: '#ef4444' }} />
          <div style={{ width: '1.5cqi', height: '1.5cqi', borderRadius: '50%', background: '#eab308' }} />
          <div style={{ width: '1.5cqi', height: '1.5cqi', borderRadius: '50%', background: '#22c55e' }} />
          <div style={{ fontSize: 'clamp(0.8rem, 2.5cqi, 1.5rem)', fontFamily: '"Share Tech Mono", monospace', color: '#0284c7', marginLeft: '2cqi', letterSpacing: '0.1em' }}>
            FACT_DB_CONNECTION: ESTABLISHED
          </div>
        </div>
        
        <div style={{ padding: '6cqi', flex: 1, overflow: 'hidden' }}>
          <div 
            className="prose prose-invert max-w-none prose-headings:font-mono prose-headings:text-cyan-300 prose-p:text-slate-300 prose-p:font-sans"
            style={{ fontSize: 'clamp(1rem, 4cqi, 2rem)' }}
            dangerouslySetInnerHTML={{ __html: config.html || '<h2>Fact of the Day</h2><p>Data loading...</p>' }}
          />
        </div>
      </div>
    </div>
  );
}

export function StemScienceImageCarousel({ config, compact }: { config: any; compact?: boolean }) {
  return (
    <div className="absolute inset-0 p-8 flex flex-col" style={{ containerType: 'size' }}>
      <div style={{
        background: 'rgba(2, 6, 23, 0.85)',
        backdropFilter: 'blur(20px)',
        borderRadius: '8px',
        border: '1px solid rgba(6, 182, 212, 0.4)',
        boxShadow: '0 0 40px rgba(6,182,212,0.15)',
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        padding: '2cqi'
      }}>
        {/* Tech scanline overlay */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none',
          background: 'linear-gradient(rgba(6,182,212,0.05) 1px, transparent 1px)',
          backgroundSize: '100% 4px'
        }} />
        
        <div style={{
          width: '100%', height: '100%', background: 'rgba(8, 47, 73, 0.3)',
          borderRadius: '4px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', overflow: 'hidden'
        }}>
          <div style={{ position: 'absolute', inset: '2cqi', border: '1px solid rgba(6,182,212,0.2)', borderRadius: '4px', pointerEvents: 'none', zIndex: 20 }} />
          
          <div style={{ color: '#0369a1', fontFamily: '"Share Tech Mono", monospace', fontSize: 'clamp(1.2rem, 5cqi, 2.5rem)', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: '2cqi' }}>
            <span style={{ animation: 'spin 2s linear infinite', display: 'inline-block' }}>⚙️</span>
            AWAITING_VISUAL_DATA
          </div>
        </div>
      </div>
    </div>
  );
}

export function StemScienceTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages = config.messages || ['Safety goggles required beyond this point.'];
  const text = messages.join('   ||   ');
  return (
    <div className="absolute inset-0 flex items-center overflow-hidden" style={{
      background: 'rgba(2, 6, 23, 0.95)',
      boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.8)',
      borderTop: '1px solid #164e63'
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '1px', background: 'rgba(6,182,212,0.3)' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '1px', background: 'rgba(6,182,212,0.1)' }} />
      
      <div style={{
        padding: '0 30px', height: '100%', background: 'rgba(8, 47, 73, 0.9)',
        color: '#22d3ee', fontFamily: '"Share Tech Mono", monospace', fontWeight: 'bold',
        textTransform: 'uppercase', letterSpacing: '0.1em', whiteSpace: 'nowrap', zIndex: 10,
        borderRight: '1px solid #155e75', boxShadow: '4px 0 15px rgba(6,182,212,0.15)',
        display: 'flex', alignItems: 'center', gap: '15px'
      }}>
        <span style={{ color: '#facc15' }}>⚠</span>
        SYS_ALERT
      </div>
      <div style={{ flex: 1, position: 'relative', height: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
        <div style={{
          whiteSpace: 'nowrap', animation: 'stemTicker 30s linear infinite',
          fontSize: '3.5vh', fontFamily: '"Share Tech Mono", monospace', letterSpacing: '0.1em', color: '#cffafe',
          paddingLeft: '100%'
        }}>
          {text}   ||   {text}
        </div>
      </div>
      <style>{`@keyframes stemTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}
