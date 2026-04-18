import React, { useState, useEffect } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// LIBRARY QUIET THEME - Elegant Wood, Brass & Leather
// ═══════════════════════════════════════════════════════════════════════════

export function LibraryQuietText({ config, compact }: { config: any; compact?: boolean }) {
  const content = config.content || 'Media Center';
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8" style={{
      background: 'linear-gradient(180deg, #f8f4eb 0%, #e8dec3 100%)',
      borderRadius: '8px',
      border: '4px solid #4a2818',
      boxShadow: 'inset 0 0 20px rgba(0,0,0,0.1), 0 10px 30px rgba(0,0,0,0.5)',
      containerType: 'size'
    }}>
      <h1 style={{ 
        fontSize: 'clamp(2rem, 15cqi, 8rem)', 
        color: '#2a1610', 
        fontFamily: '"Playfair Display", Georgia, serif',
        textShadow: '1px 2px 0px rgba(255,255,255,0.8)',
        textAlign: 'center',
        margin: 0
      }}>
        {content}
      </h1>
    </div>
  );
}

export function LibraryQuietClock({ config, compact }: { config: any; compact?: boolean }) {
  const [time, setTime] = useState('');
  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
    update();
    const int = setInterval(update, 1000);
    return () => clearInterval(int);
  }, []);
  
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4" style={{
      background: '#2a1610',
      borderRadius: '8px',
      border: '3px solid #d4af37',
      boxShadow: '0 10px 25px rgba(0,0,0,0.6)',
      containerType: 'size'
    }}>
      <div style={{ 
        fontSize: 'clamp(2rem, 25cqi, 10rem)', 
        color: '#f8f4eb', 
        fontFamily: 'Georgia, serif', 
        letterSpacing: '0.05em' 
      }}>
        {time}
      </div>
    </div>
  );
}

export function LibraryQuietImage({ config, compact }: { config: any; compact?: boolean }) {
  return (
    <div className="absolute inset-0 p-6 flex flex-col items-center justify-center" style={{ containerType: 'size' }}>
      <div style={{
        background: '#fff',
        padding: '3cqh',
        paddingBottom: '12cqh',
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        transform: 'rotate(2deg)',
        borderRadius: '2px',
        width: '80cqi',
        height: '90cqh',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{
          flex: 1,
          border: '1px solid #e5e5e5',
          background: '#f5f5f5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}>
          {config.url ? (
            <img src={config.url} alt="Book" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ color: '#a8a29e', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: '5cqi' }}>Book of the Month</div>
          )}
        </div>
        <div style={{
          position: 'absolute',
          bottom: '3cqh',
          left: 0,
          width: '100%',
          textAlign: 'center',
          fontFamily: 'Georgia, serif',
          color: '#444',
          fontSize: '6cqh',
          letterSpacing: '0.05em'
        }}>
          Featured Title
        </div>
      </div>
    </div>
  );
}

export function LibraryQuietRichText({ config, compact }: { config: any; compact?: boolean }) {
  return (
    <div className="absolute inset-0 p-8 flex flex-col" style={{
      background: 'rgba(248, 244, 235, 0.9)',
      backdropFilter: 'blur(10px)',
      borderRadius: '8px',
      border: '1px solid #d4af37',
      borderTopWidth: '8px',
      boxShadow: '0 15px 35px rgba(0,0,0,0.3)',
      overflow: 'hidden',
      containerType: 'size'
    }}>
      <div 
        className="prose prose-stone max-w-none font-serif flex-1"
        style={{ color: '#2a1610', fontSize: 'clamp(1rem, 5cqi, 2.5rem)' }}
        dangerouslySetInnerHTML={{ __html: config.html || '<h3>Library Hours</h3><p>Quiet Study: 8:00 — 11:00 AM</p>' }}
      />
    </div>
  );
}

export function LibraryQuietLunch({ config, compact }: { config: any; compact?: boolean }) {
  const meal = config.meals?.[0] || { label: 'Today', items: ['Chef Salad', 'Tomato Soup'] };
  return (
    <div className="absolute inset-0 p-8 flex flex-col" style={{
      background: 'rgba(42, 22, 16, 0.9)',
      backdropFilter: 'blur(10px)',
      borderRadius: '8px',
      border: '2px solid #d4af37',
      boxShadow: '0 15px 35px rgba(0,0,0,0.4)',
      containerType: 'size'
    }}>
      <h3 style={{
        fontSize: 'clamp(1.5rem, 8cqi, 3rem)',
        fontFamily: 'Georgia, serif',
        color: '#d4af37',
        borderBottom: '1px solid rgba(212, 175, 55, 0.3)',
        paddingBottom: '2cqh',
        marginBottom: '4cqh',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        textAlign: 'center'
      }}>Cafe Express</h3>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3cqh', justifyContent: 'center', alignItems: 'center' }}>
        {meal.items.map((item: string, i: number) => (
          <div key={i} style={{ color: '#f8f4eb', fontFamily: 'Georgia, serif', fontSize: 'clamp(1.2rem, 6cqi, 2.5rem)', textAlign: 'center', width: '100%' }}>
            • {item}
          </div>
        ))}
        {meal.items.length === 0 && <div style={{ color: '#a8a29e', fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>Menu unavailable</div>}
      </div>
    </div>
  );
}

export function LibraryQuietTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages = config.messages || ['Please keep voices low.', 'Return books to the front desk.'];
  const text = messages.join('   ✦   ');
  return (
    <div className="absolute inset-0 flex items-center overflow-hidden" style={{
      background: '#1f100a',
      color: '#d4af37',
      borderTop: '2px solid #4a2818',
      borderBottom: '2px solid #4a2818'
    }}>
      <div style={{ padding: '0 30px', background: '#d4af37', color: '#1f100a', height: '100%', display: 'flex', alignItems: 'center', fontWeight: 'bold', fontFamily: 'Georgia, serif', textTransform: 'uppercase', letterSpacing: '0.1em', zIndex: 10 }}>
        Notes
      </div>
      <div style={{ flex: 1, position: 'relative', height: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
        <div style={{
          whiteSpace: 'nowrap',
          animation: 'libraryTicker 40s linear infinite',
          fontSize: '4vh',
          fontFamily: 'Georgia, serif',
          paddingLeft: '100%',
          letterSpacing: '0.05em'
        }}>
          {text}   ✦   {text}
        </div>
      </div>
      <style>{`@keyframes libraryTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}
