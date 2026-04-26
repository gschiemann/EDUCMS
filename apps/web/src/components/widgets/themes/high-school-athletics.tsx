import { useState, useEffect } from 'react';
import { Trophy, Flame, ChevronRight } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// HIGH SCHOOL ATHLETICS JUMBOTRON THEME
// A dark, high-energy sports arena aesthetic. Uses heavy metallic textures,
// glowing LED matrices, bright neons (red, gold, blue), and aggressive
// slanted typography (Impact/Oswald style) to create hype.
// ═══════════════════════════════════════════════════════════════════════════

const ATHLETICS = {
  bgDark: '#0B0F19',
  bgGlass: 'rgba(15, 23, 42, 0.75)',
  neonRed: '#EF4444',
  neonBlue: '#3B82F6',
  neonGold: '#F59E0B',
  fontDisplay: '"Oswald", "Impact", "Arial Black", sans-serif',
  fontMatrix: '"Share Tech Mono", "Courier New", monospace',
};

// ═══════════════════════════════════════════════════════════
// LOGO — Glowing Metallic Badge
// ═══════════════════════════════════════════════════════════
export function AthleticsLogo({ config }: { config: any }) {
  const hasImage = !!config.assetUrl;
  
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ padding: '2cqw', containerType: 'size' }}>
      <div className="relative w-full h-full flex items-center justify-center">
        {/* Hexagonal glowing backplate */}
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)',
          clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
          border: `4px solid ${ATHLETICS.neonBlue}`,
          boxShadow: `0 0 40px ${ATHLETICS.neonBlue}`,
        }} />
        <div className="absolute inset-[4%] bg-slate-900 flex items-center justify-center p-8" style={{
          clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
          backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(255,255,255,0.03) 5px, rgba(255,255,255,0.03) 10px)`
        }}>
          {hasImage ? (
             <img src={config.assetUrl} alt="Logo" className="w-full h-full object-contain" />
          ) : (
            <span data-field="initials" className="relative text-white font-black italic tracking-tighter leading-none" style={{
              fontSize: '40cqh',
              fontFamily: ATHLETICS.fontDisplay,
              textShadow: `0 0 20px ${ATHLETICS.neonBlue}, 3px 3px 0 #000`,
              whiteSpace: 'pre-wrap' as const
            }}>
              {config.initials || 'HS'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// COUNTDOWN — Huge LED Segmented Display
// ═══════════════════════════════════════════════════════════
export function AthleticsCountdown({ config, compact }: { config: any; compact?: boolean } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const [timeLeft, setTimeLeft] = useState({ d: 0, h: 0, m: 0, s: 0 });

  useEffect(() => {
    if (!config.targetDate) return;
    const update = () => {
      const now = new Date().getTime();
      const target = new Date(config.targetDate).getTime();
      const diff = target - now;
      if (diff <= 0) {
        setTimeLeft({ d: 0, h: 0, m: 0, s: 0 });
        return;
      }
      setTimeLeft({
        d: Math.floor(diff / (1000 * 60 * 60 * 24)),
        h: Math.floor((diff / (1000 * 60 * 60)) % 24),
        m: Math.floor((diff / 1000 / 60) % 60),
        s: Math.floor((diff / 1000) % 60),
      });
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [config.targetDate]);

  const label = config.label || 'TIP-OFF IN';
  const showDays = config.showDays !== false;

  return (
    <div className="absolute inset-0 flex flex-col justify-between" style={{ padding: '2cqw', containerType: 'size' }}>
      <div className="w-full flex justify-center mb-1">
        <div className="bg-red-600/20 px-6 py-1 rounded-sm border border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.3)] flex items-center justify-center">
          <span data-field="label" className="text-red-500 font-bold tracking-widest uppercase italic leading-none" style={{ fontSize: '15cqh', fontFamily: ATHLETICS.fontDisplay, whiteSpace: 'pre-wrap' as const }}>
            {label}
          </span>
        </div>
      </div>
      
      <div className="flex-1 w-full bg-black border-4 border-slate-800 rounded-lg flex items-center justify-center p-2 relative overflow-hidden">
        {/* Subtle LED grid background */}
        <div className="absolute inset-0" style={{
          backgroundImage: 'radial-gradient(rgba(255,0,0,0.1) 1px, transparent 1px)',
          backgroundSize: '4px 4px'
        }} />
        
        <div className="flex gap-2 relative z-10 w-full h-full">
          {showDays && <TimeBox value={timeLeft.d} label="DAYS" />}
          <TimeBox value={timeLeft.h} label="HRS" />
          <TimeBox value={timeLeft.m} label="MIN" />
          {!showDays && <TimeBox value={timeLeft.s} label="SEC" />}
        </div>
      </div>
    </div>
  );
}

function TimeBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] rounded border border-slate-800/50 relative overflow-hidden">
      <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-black/80 z-20 -translate-y-1/2" /> {/* Digit split line */}
      <span className="text-red-500 leading-none z-10 drop-shadow-[0_0_12px_rgba(239,68,68,0.8)]" style={{
        fontFamily: ATHLETICS.fontMatrix,
        fontSize: '40cqmin',
        fontWeight: 'bold',
        fontVariantNumeric: 'tabular-nums'
      }}>
        {value.toString().padStart(2, '0')}
      </span>
      <span className="text-red-800/80 font-black tracking-widest mt-1 z-10" style={{ fontSize: '15cqmin', fontFamily: ATHLETICS.fontDisplay }}>
        {label}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SCORE CARD / RECAP — Sleek dark glassmorphic matchup card
// ═══════════════════════════════════════════════════════════
export function AthleticsAnnouncement({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const title = config.title || 'FINAL SCORE';
  // Parse message like "EAGLES: 42\nRIVALS: 28"
  const msg = config.message || 'TEAM A: 0\nTEAM B: 0';
  const lines = msg.split('\n').filter(Boolean);
  const teamA = lines[0] || 'HOME: 0';
  const teamB = lines[1] || 'AWAY: 0';

  return (
    <div className="absolute inset-0 flex flex-col justify-between overflow-hidden rounded-xl border border-slate-700/50 shadow-2xl" style={{ 
      background: ATHLETICS.bgGlass,
      backdropFilter: 'blur(16px)',
      padding: '4cqw',
      containerType: 'size'
    }}>
      {/* Decorative top stripe */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-white to-red-500" />
      
      <div className="flex items-center justify-center gap-2 mb-2 pb-2 border-b border-white/10 shrink-0">
        <Trophy className="text-yellow-400 shrink-0" style={{ width: '15cqh', height: '15cqh' }} />
        <h2 className="text-white font-black italic tracking-wider uppercase truncate leading-none" style={{ fontSize: '18cqh', fontFamily: ATHLETICS.fontDisplay }}>
          {title}
        </h2>
      </div>

      <div className="flex-1 flex flex-col gap-2 min-h-0">
        <ScoreRow text={teamA} isHome={true} />
        <ScoreRow text={teamB} isHome={false} />
      </div>
    </div>
  );
}

function ScoreRow({ text, isHome }: { text: string; isHome: boolean }) {
  const [name, score] = text.split(':').map(s => s.trim());
  const colorClass = isHome ? 'text-blue-400 drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]' : 'text-slate-300';
  const bgClass = isHome ? 'bg-blue-900/20 border-blue-500/30' : 'bg-slate-800/40 border-slate-700';

  return (
    <div className={`flex-1 min-h-0 flex items-center justify-between px-6 rounded-lg border ${bgClass}`}>
      <span className="text-white font-bold italic uppercase truncate leading-none" style={{ fontSize: '12cqmin', fontFamily: ATHLETICS.fontDisplay }}>
        {name || 'TEAM'}
      </span>
      <span className={`font-black tabular-nums leading-none ${colorClass}`} style={{ fontSize: '18cqmin', fontFamily: ATHLETICS.fontMatrix }}>
        {score || '0'}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TEXT — Metallic Hype
// ═══════════════════════════════════════════════════════════
export function AthleticsText({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const content = config.content || 'MAKE SOME NOISE!';
  return (
    <div className="absolute inset-0 flex items-center justify-center p-2 text-center overflow-hidden" style={{ containerType: 'size' }}>
      <h1 className="font-black uppercase italic leading-none whitespace-normal break-words" style={{
        fontSize: '25cqmin',
        fontFamily: ATHLETICS.fontDisplay,
        background: 'linear-gradient(to bottom, #FFF 0%, #A0AABF 50%, #64748B 51%, #1E293B 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        filter: `drop-shadow(0 0 15px rgba(255,255,255,0.2)) drop-shadow(4px 4px 0 #000)`,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {content}
      </h1>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TICKER — LED Dot Matrix
// ═══════════════════════════════════════════════════════════
export function AthleticsTicker({ config }: { config: any }) {
  const messages = config.messages || ['GO EAGLES!'];
  const speed = config.speed === 'fast' ? 10 : config.speed === 'slow' ? 30 : 20;
  
  return (
    <div className="absolute inset-0 bg-black border-y-4 border-[#111] overflow-hidden flex items-center" style={{ containerType: 'size' }}>
      {/* Matrix dots overlay */}
      <div className="absolute inset-0 z-20 pointer-events-none mix-blend-multiply opacity-80" style={{
        backgroundImage: 'radial-gradient(#000 1px, transparent 1px)',
        backgroundSize: '3px 3px'
      }} />
      <div className="absolute inset-0 z-20 pointer-events-none mix-blend-screen opacity-10" style={{
        backgroundImage: 'linear-gradient(rgba(255,0,0,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,0,0,0.2) 1px, transparent 1px)',
        backgroundSize: '3px 3px'
      }} />
      
      <div className="whitespace-nowrap flex items-center" style={{ animation: `scroll-left ${speed}s linear infinite` }}>
        {messages.map((m: string, i: number) => (
          <div key={i} className="inline-flex items-center mx-8">
            <Flame className="text-red-500 mr-4" style={{ width: '40cqh', height: '40cqh', filter: 'drop-shadow(0 0 8px red)' }} />
            <span className="text-red-500 font-bold uppercase tracking-widest drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]" style={{
              fontSize: '45cqh',
              fontFamily: ATHLETICS.fontMatrix,
            }}>
              {m}
            </span>
          </div>
        ))}
        {/* Duplicate for seamless loop */}
        {messages.map((m: string, i: number) => (
          <div key={`dup-${i}`} className="inline-flex items-center mx-8">
            <Flame className="text-red-500 mr-4" style={{ width: '40cqh', height: '40cqh', filter: 'drop-shadow(0 0 8px red)' }} />
            <span className="text-red-500 font-bold uppercase tracking-widest drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]" style={{
              fontSize: '45cqh',
              fontFamily: ATHLETICS.fontMatrix,
            }}>
              {m}
            </span>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes scroll-left {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
