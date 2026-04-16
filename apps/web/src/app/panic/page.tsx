"use client";

import { useAppStore } from '@/lib/store';
import { ShieldAlert, WifiOff, Loader2, AlertTriangle, CheckCircle2, Megaphone, ChevronLeft } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { broadcastEmergency } from '@/actions/trigger-emergency';

export default function MobilePanicPage() {
  const router = useRouter();
  const { user, token } = useAppStore();
  const [phase, setPhase] = useState<'idle' | 'holding' | 'triggering' | 'triggered' | 'error'>('idle');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [mounted, setMounted] = useState(false);
  
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Authorization Check
  useEffect(() => {
    setMounted(true);
    if (!token) {
      router.push('/login?redirect=/panic');
    }
  }, [token, router]);

  if (!mounted || !user) return null;

  if (!user.canTriggerPanic && user.role !== 'SUPER_ADMIN' && user.role !== 'SCHOOL_ADMIN') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <WifiOff className="w-16 h-16 text-slate-700 mb-6" />
        <h1 className="text-2xl font-bold text-white mb-2">Unauthorized</h1>
        <p className="text-slate-400">Your account is not authorized to trigger mobile emergency overrides.</p>
      </div>
    );
  }

  const HOLD_DURATION_MS = 1500;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (phase === 'triggering' || phase === 'triggered') return;
    
    setPhase('holding');
    setProgress(0);

    const startTime = Date.now();
    
    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min((elapsed / HOLD_DURATION_MS) * 100, 100);
      setProgress(pct);
    }, 50);

    holdTimerRef.current = setTimeout(() => {
      fireEmergency();
    }, HOLD_DURATION_MS);
  };

  const cancelHold = () => {
    if (phase === 'triggering' || phase === 'triggered') return;
    setPhase('idle');
    setProgress(0);
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
  };

  const fireEmergency = async () => {
    setPhase('triggering');
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);

    try {
      const result = await broadcastEmergency({
        schoolId: user.tenantId,
        type: selectedType || 'lockdown',
        triggeredBy: user.id,
        token: token!
      });
      if (result?.error) throw new Error(result.error);
      setPhase('triggered');
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to connect. Ensure you have internet.');
      setPhase('error');
    }
  };

  const types = [
    { id: 'lockdown', name: 'Lockdown', icon: ShieldAlert, activeColor: 'bg-red-600 hover:bg-red-500', holdColor: 'bg-red-700', outline: 'stroke-red-600', shadow: 'drop-shadow-[0_0_15px_rgba(220,38,38,0.5)]', text: 'text-red-500' },
    { id: 'weather', name: 'Tornado', icon: AlertTriangle, activeColor: 'bg-amber-500 hover:bg-amber-400', holdColor: 'bg-amber-600', outline: 'stroke-amber-500', shadow: 'drop-shadow-[0_0_15px_rgba(245,158,11,0.5)]', text: 'text-amber-500' },
    { id: 'evacuate', name: 'Evacuate', icon: Megaphone, activeColor: 'bg-orange-500 hover:bg-orange-400', holdColor: 'bg-orange-600', outline: 'stroke-orange-500', shadow: 'drop-shadow-[0_0_15px_rgba(249,115,22,0.5)]', text: 'text-orange-500' },
  ];

  const activeConf = types.find(t => t.id === selectedType) || types[0];

  return (
    <div className="fixed inset-0 bg-slate-950 text-white flex flex-col items-center justify-center p-6 overscroll-none select-none">
      <div className="absolute top-6 left-6 right-6 flex justify-between items-center opacity-50">
        <ShieldAlert className="w-6 h-6" />
        <span className="text-xs font-bold uppercase tracking-widest">{user.email}</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm">
        
        {phase === 'error' ? (
          <div className="text-center animate-in zoom-in duration-300">
            <AlertTriangle className="w-24 h-24 text-red-500 mx-auto mb-6" />
            <h1 className="text-3xl font-black mb-2 text-red-500">FAILED</h1>
            <p className="text-slate-400 mb-8 max-w-[250px] mx-auto">{errorMsg}</p>
            <button onClick={() => setPhase('idle')} className="px-8 py-3 bg-slate-800 rounded-full font-bold uppercase tracking-wider text-sm">
              Try Again
            </button>
          </div>
        ) : phase === 'triggered' ? (
          <div className="text-center animate-in zoom-in duration-300">
            <div className="relative">
              <div className="absolute inset-0 bg-red-600 rounded-full animate-ping opacity-20 scale-150" />
              <CheckCircle2 className="w-24 h-24 text-red-500 mx-auto mb-6 relative z-10" />
            </div>
            <h1 className="text-3xl font-black mb-2 text-red-500 uppercase">Lockdown<br/>Broadcasted</h1>
            <p className="text-slate-400 mb-8 max-w-[250px] mx-auto">
              All screens are now locked to the emergency profile.
            </p>
          </div>
        ) : !selectedType ? (
          <div className="flex flex-col items-center justify-center text-center w-full animate-in fade-in slide-in-from-bottom-4 duration-300">
            <h1 className="text-3xl font-black mb-3">SELECT INCIDENT</h1>
            <p className="text-slate-400 text-sm mb-12 px-4 max-w-[280px]">
              Tap the specific emergency type to arm the trigger mechanism.
            </p>
            <div className="grid grid-cols-1 gap-4 w-full px-6">
              {types.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setSelectedType(type.id)}
                  className={`flex items-center gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 ${type.text} hover:bg-slate-800 active:scale-95 transition-all`}
                >
                  <type.icon className="w-8 h-8" />
                  <span className="text-lg font-bold uppercase tracking-wider text-white">
                    {type.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center w-full animate-in fade-in zoom-in-95 duration-300">
            <button 
              onClick={() => setSelectedType(null)}
              className="absolute top-6 left-6 flex items-center justify-center w-10 h-10 rounded-full bg-slate-900 text-slate-400"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <h1 className="text-3xl font-black mb-3 uppercase">{activeConf.name} TRIGGER</h1>
            <p className="text-slate-400 text-sm mb-16 px-4">
              Press and hold the button below until the ring fills entirely to instantly trigger a facility-wide override.
            </p>

            {/* Hold Button */}
            <div className="relative w-64 h-64 flex items-center justify-center mt-4">
              {/* Progress Ring */}
              <svg className={`absolute inset-0 w-full h-full -rotate-90 pointer-events-none ${activeConf.shadow}`}>
                <circle
                  cx="128" cy="128" r="120"
                  className="stroke-slate-800"
                  strokeWidth="8" fill="none"
                />
                <circle
                  cx="128" cy="128" r="120"
                  className={`${activeConf.outline} transition-all duration-75 easelinear`}
                  strokeWidth="10" fill="none"
                  strokeDasharray="754"
                  strokeDashoffset={754 - (754 * progress) / 100}
                  strokeLinecap="round"
                />
              </svg>

              {/* Central Button */}
              <button
                onPointerDown={handlePointerDown}
                onPointerUp={cancelHold}
                onPointerLeave={cancelHold}
                onContextMenu={e => e.preventDefault()}
                disabled={phase === 'triggering'}
                className={`
                  relative z-10 w-48 h-48 rounded-full shadow-[inset_0_-8px_0_rgba(0,0,0,0.2)] 
                  flex flex-col items-center justify-center transition-all duration-200 outline-none
                  ${phase === 'holding' ? `${activeConf.holdColor} scale-95 shadow-[inset_0_0_0_rgba(0,0,0,0)]` : activeConf.activeColor}
                  ${phase === 'triggering' ? '!bg-slate-800 opacity-50 cursor-not-allowed border outline-none border-slate-700' : ''}
                `}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                {phase === 'triggering' ? (
                  <Loader2 className="w-16 h-16 text-white animate-spin" />
                ) : (
                  <>
                    <activeConf.icon className="w-16 h-16 text-white/90 drop-shadow-md mb-2" />
                    <span className="font-bold text-white/90 uppercase tracking-widest text-sm drop-shadow-md">
                      {phase === 'holding' ? 'Holding...' : 'Hold'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
      
      {phase === 'triggered' && (
        <div className="absolute bottom-8 italic text-slate-500 text-xs text-center w-full px-8">
          The emergency must be cleared from a secure terminal by an administrator.
        </div>
      )}
    </div>
  );
}
