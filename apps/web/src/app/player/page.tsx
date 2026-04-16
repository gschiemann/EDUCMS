"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { MonitorPlay, Wifi, WifiOff, AlertTriangle, Loader2, Settings, CheckCircle2, HardDrive, Cpu, Server, Network, Play, Monitor, Info, Power } from 'lucide-react';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';

function getApiRoot(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const apiParam = params.get('api');
    if (apiParam) {
      // Save to localStorage so it persists across refreshes
      localStorage.setItem('edu_api_root', apiParam.replace(/\/api\/v1\/?$/, ''));
      return apiParam.replace(/\/api\/v1\/?$/, '');
    }
    const saved = localStorage.getItem('edu_api_root');
    if (saved) return saved;
  }
  const env = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
  return env.replace('/api/v1', '');
}

// Generate a stable device fingerprint using the browser
function getDeviceFingerprint(): string {
  const key = 'edu_device_fp';
  
  // Allow overriding fingerprint via URL for testing previously paired devices
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get('deviceId');
    if (idParam) {
      localStorage.setItem(key, idParam);
      return idParam;
    }
  }

  let fp = localStorage.getItem(key);
  if (!fp) {
    fp = `device-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    localStorage.setItem(key, fp);
  }
  return fp;
}

function getDeviceInfo() {
  const ua = navigator.userAgent;
  let os = 'Unknown';
  if (/android/i.test(ua)) os = 'Android';
  else if (/ipad|iphone|ipod/i.test(ua)) os = 'iOS';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/cros/i.test(ua)) os = 'Chrome OS';

  let browser = 'Unknown';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/chrome/i.test(ua)) browser = 'Chrome';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';

  return {
    resolution: `${window.screen.width}×${window.screen.height}`,
    osInfo: os,
    browserInfo: `${browser} ${navigator.language}`,
    userAgent: ua,
  };
}

type Phase = 'registering' | 'pairing' | 'connecting' | 'playing' | 'offline' | 'emergency';

export default function PlayerPage() {
  const [phase, setPhase] = useState<Phase>('registering');
  const [storageInfo, setStorageInfo] = useState({ used: '1.2 GB', total: '32 GB', percent: 4 });

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(({ usage, quota }) => {
        if (usage && quota) {
          setStorageInfo({
             used: (usage / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
             total: (quota / (1024 * 1024 * 1024)).toFixed(0) + ' GB',
             percent: Math.round((usage / quota) * 100)
          });
        }
      });
    }
  }, []);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [screenId, setScreenId] = useState<string | null>(null);
  const [screenName, setScreenName] = useState<string>('');
  const [playlist, setPlaylist] = useState<any>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // ─── Phase 1: Register device ───
  useEffect(() => {
    if (phase !== 'registering') return;

    const register = async () => {
      try {
        const fp = getDeviceFingerprint();
        const deviceInfo = getDeviceInfo();

        const res = await fetch(`${getApiRoot()}/api/v1/screens/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceFingerprint: fp, ...deviceInfo }),
        });

        if (!res.ok) throw new Error('Registration failed');
        const data = await res.json();

        setScreenId(data.screenId);
        setScreenName(data.name);

        if (data.paired) {
          // Already paired — go straight to connecting
          setPhase('connecting');
        } else {
          // Show pairing code
          setPairingCode(data.pairingCode);
          setPhase('pairing');
        }
      } catch (e: any) {
        setError(e.message);
        setPhase('offline');
      }
    };

    register();
  }, [phase]);

  // ─── Phase 2: Poll while showing pairing code ───
  useEffect(() => {
    if (phase !== 'pairing') return;

    const fp = getDeviceFingerprint();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${getApiRoot()}/api/v1/screens/status/${fp}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.paired) {
          setScreenName(data.name);
          setScreenId(data.screenId);
          setPhase('connecting');
        }
      } catch { /* ignore polling errors */ }
    }, 3000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [phase]);

  // ─── Phase 3: Fetch playlist content ───
  const fetchContent = useCallback(async () => {
    if (!screenId) return;

    try {
      // Login as admin to get content (simplified — production would use device JWT)
      const loginRes = await fetch(`${getApiRoot()}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@springfield.edu', password: 'admin123' }),
      });

      if (!loginRes.ok) throw new Error('Auth failed');
      const { access_token } = await loginRes.json();

      // 1. Try to fetch the specific device manifest (what it is officially scheduled to play)
      const manifestRes = await fetch(`${getApiRoot()}/api/v1/screens/${screenId}/manifest`, {
        headers: { 'Authorization': `Bearer ${access_token}` },
      });

      if (manifestRes.ok) {
        const manifest = await manifestRes.json();
        if (manifest.playlists && manifest.playlists.length > 0) {
          const mp = manifest.playlists[0];

          // Check if this is a template-based playlist
          if (mp.template) {
            const formattedPlaylist = {
              name: mp.template.name || 'Template Content',
              template: mp.template,
              items: [],
            };
            setPlaylist(formattedPlaylist);
            setCurrentIndex(0);
            setPhase('playing');
            setLastSync(new Date().toLocaleTimeString());
            return;
          }

          // Regular media playlist
          const formattedPlaylist = {
            name: 'Scheduled Content',
            items: mp.items.map((item: any) => ({
              id: item.url,
              durationMs: item.duration_ms,
              sequenceOrder: item.sequence,
              asset: { fileUrl: item.url, mimeType: item.url.match(/\.(mp4|webm)$/i) ? 'video/mp4' : 'image/jpeg' }
            }))
          };
          setPlaylist(formattedPlaylist);
          setCurrentIndex(0);
          setPhase('playing');
          setLastSync(new Date().toLocaleTimeString());
          return;
        }
      }

      // If we reach here, we have no active schedule/playlist mapped from the manifest
      setPlaylist(null);
      setCurrentIndex(0);
      setPhase('playing');
      setLastSync(new Date().toLocaleTimeString());
    } catch (e: any) {
      setError(e.message);
      setPhase('offline');
    }
  }, [screenId]);

  useEffect(() => {
    if (phase === 'connecting') fetchContent();
  }, [phase, fetchContent]);

  // ─── Realtime WebSocket Connection ───
  useEffect(() => {
    if (phase !== 'playing') return;

    const wsUrl = getApiRoot().replace(/^http/, 'ws') + '/realtime';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      const token = `dev_${screenId}_00000000-0000-0000-0000-000000000002`;
      ws.send(JSON.stringify({
        event: 'HELLO',
        data: { token }
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'SYNC' || msg.type === 'OVERRIDE') {
          fetchContent();
        }
      } catch (e) {}
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [phase, screenId, fetchContent]);

  // ─── Cycle through slides ───
  useEffect(() => {
    if (phase !== 'playing' || !playlist?.items?.length) return;

    const sorted = [...playlist.items].sort((a: any, b: any) => a.sequenceOrder - b.sequenceOrder);
    
    // Core slide scheduler logic
    const isItemValid = (item: any) => {
      if (!item.daysOfWeek && !item.timeStart && !item.timeEnd) return true;
      const now = new Date();
      if (item.daysOfWeek) {
        const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        if (!item.daysOfWeek.includes(dayMap[now.getDay()])) return false;
      }
      if (item.timeStart && item.timeEnd) {
        const [sh, sm] = item.timeStart.split(':').map(Number);
        const [eh, em] = item.timeEnd.split(':').map(Number);
        const currentMins = now.getHours() * 60 + now.getMinutes();
        const startMins = sh * 60 + sm;
        const endMins = eh * 60 + em;
        if (currentMins < startMins || currentMins > endMins) return false;
      }
      return true;
    };

    // Find the next VALID index, up to a full cycle search
    let nextIndex = currentIndex % sorted.length;
    let found = false;
    for (let i = 0; i < sorted.length; i++) {
      if (isItemValid(sorted[nextIndex])) {
        found = true;
        break;
      }
      nextIndex = (nextIndex + 1) % sorted.length;
    }

    if (!found) {
      // Entire playlist is locked right now! Fallback loop retry every 30s
      timerRef.current = setTimeout(() => setCurrentIndex(prev => prev + 1), 30000);
      return;
    }

    // If we skipped invalid slides to arrive at nextIndex, update state immediately
    if (nextIndex !== (currentIndex % sorted.length)) {
      setCurrentIndex(nextIndex);
      return;
    }

    const item = sorted[nextIndex];
    if (item?.asset?.mimeType?.startsWith('video/')) {
      // For videos, do NOT set a timer. Let the <video onEnded> execute the sequence increment naturally.
      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }

    const duration = item?.durationMs || 10000;
    timerRef.current = setTimeout(() => {
      setCurrentIndex(prev => prev + 1);
    }, duration);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [phase, playlist, currentIndex]);

  // ─── Render: Registering ───
  if (phase === 'registering') {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
        <p className="text-xl text-white font-medium">Registering device...</p>
      </div>
    );
  }

  // ─── Render: Pairing Code Screen ───
  if (phase === 'pairing') {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex flex-col items-center justify-center">
        <div className="text-center max-w-lg px-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 mb-6">
            <MonitorPlay className="w-10 h-10 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">EduSignage Player</h1>
          <p className="text-slate-400 mb-8">Enter this code in your CMS dashboard to pair this screen</p>

          {/* Big pairing code */}
          <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl px-12 py-8 mb-8 shadow-2xl shadow-indigo-500/10">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-[0.3em] mb-3">Pairing Code</p>
            <p className="text-6xl font-black text-white tracking-[0.3em] font-mono">
              {pairingCode}
            </p>
          </div>

          {/* Device info */}
          <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-4 text-left space-y-2">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Device Info</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500">Resolution: </span>
                <span className="text-slate-300 font-medium">{typeof window !== 'undefined' ? `${window.screen.width}×${window.screen.height}` : ''}</span>
              </div>
              <div>
                <span className="text-slate-500">Browser: </span>
                <span className="text-slate-300 font-medium">{typeof window !== 'undefined' ? (navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Other') : ''}</span>
              </div>
              <div>
                <span className="text-slate-500">Platform: </span>
                <span className="text-slate-300 font-medium">{typeof navigator !== 'undefined' ? navigator.platform : ''}</span>
              </div>
              <div>
                <span className="text-slate-500">Status: </span>
                <span className="text-amber-400 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                  Waiting for pairing...
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Connecting ───
  if (phase === 'connecting') {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
        <p className="text-xl text-white font-medium">Loading content...</p>
        <p className="text-slate-500 text-sm mt-2">{screenName}</p>
      </div>
    );
  }

  // ─── Render: Offline ───
  if (phase === 'offline') {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center">
        <WifiOff className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl text-white font-bold mb-2">Unable to Connect</h2>
        <p className="text-slate-400 mb-6">{error}</p>
        <div className="flex gap-3">
          <button onClick={() => { setError(null); setPhase('connecting'); }} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium">
            Retry
          </button>
          <button onClick={() => { localStorage.removeItem('edu_device_fp'); setPhase('registering'); }} className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium">
            Reset Device
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: Playing ───
  const isTemplate = !!playlist?.template;
  const sorted = playlist && !isTemplate ? [...(playlist.items || [])].sort((a: any, b: any) => a.sequenceOrder - b.sequenceOrder) : [];
  
  const isItemValid = (item: any) => {
    if (!item || (!item.daysOfWeek && !item.timeStart && !item.timeEnd)) return true;
    const now = new Date();
    if (item.daysOfWeek && !item.daysOfWeek.includes(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()])) return false;
    if (item.timeStart && item.timeEnd) {
      const [sh, sm] = item.timeStart.split(':').map(Number);
      const [eh, em] = item.timeEnd.split(':').map(Number);
      const currentMins = now.getHours() * 60 + now.getMinutes();
      if (currentMins < (sh * 60 + sm) || currentMins > (eh * 60 + em)) return false;
    }
    return true;
  };
  
  const currentItem = sorted.length && isItemValid(sorted[currentIndex % sorted.length]) ? sorted[currentIndex % sorted.length] : null;
  const isVideo = currentItem?.asset?.mimeType?.startsWith('video/');
  const fileUrl = currentItem?.asset?.fileUrl || '';
  const resolvedUrl = fileUrl.startsWith('http') ? fileUrl : `${getApiRoot()}${fileUrl}`;

  // Template rendering
  if (isTemplate) {
    const tpl = playlist.template;
    const zones = tpl.zones || [];

    return (
      <div className="fixed inset-0 cursor-none" onClick={() => setShowOverlay(!showOverlay)}
        style={{
          backgroundColor: tpl.bgColor || '#000000',
          ...(tpl.bgGradient ? { background: tpl.bgGradient } : {}),
          ...(tpl.bgImage ? { backgroundImage: `url(${tpl.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
        }}>
        {/* Render each zone with its live widget */}
        {zones.map((zone: any) => (
          <div key={zone.id} className="absolute overflow-hidden"
            style={{
              left: `${zone.x}%`,
              top: `${zone.y}%`,
              width: `${zone.width}%`,
              height: `${zone.height}%`,
              zIndex: zone.zIndex || 0,
            }}>
            <WidgetPreview
              widgetType={zone.widgetType}
              config={zone.defaultConfig}
              width={zone.width}
              height={zone.height}
            />
          </div>
        ))}

        {/* Info overlay */}
        {showOverlay && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[999]">
            <div className="bg-slate-900 rounded-2xl p-8 max-w-md w-full mx-4 border border-slate-700 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">{screenName || 'Screen'}</h3>
                <div className="flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm text-emerald-400 font-medium">Connected</span>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">Template</span><span className="text-white font-medium">{tpl.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Zones</span><span className="text-white font-medium">{zones.length} live widgets</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Resolution</span><span className="text-white font-medium">{tpl.screenWidth}×{tpl.screenHeight}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Last Sync</span><span className="text-white font-medium">{lastSync || 'Never'}</span></div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={(e) => { e.stopPropagation(); fetchContent(); }} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors">Sync Now</button>
                <button onClick={(e) => { 
                  e.stopPropagation(); 
                  if(window.confirm('Are you sure you want to unpair this screen?')) {
                    localStorage.removeItem('edu_device_fp'); 
                    setPhase('registering'); 
                    setShowOverlay(false); 
                  }
                }} title="Unpair Device" className="py-2 px-4 bg-red-950/40 hover:bg-red-900 border border-red-900/50 text-red-200 hover:text-white rounded-lg text-sm transition-colors">
                  <Power className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Media playlist rendering
  return (
    <div className="fixed inset-0 bg-black cursor-none overflow-hidden" onClick={() => setShowOverlay(!showOverlay)}>
      {currentItem ? (
        <div className="relative w-full h-full flex items-center justify-center pointer-events-none">
          {sorted.map((item, index) => {
            const isActive = index === (currentIndex % sorted.length);
            const isVid = item.asset?.mimeType?.startsWith('video/');
            const fileUrl = item.asset?.fileUrl || '';
            const resUrl = fileUrl.startsWith('http') ? fileUrl : `${getApiRoot()}${fileUrl}`;
            
            // Render video ONLY when active to preserve memory
            if (isVid && !isActive) return null;

            // Compute physics class limits
            const trans = item.transitionType || 'FADE';
            let classes = "absolute inset-0 w-full h-full object-contain transition-all duration-[1000ms] ease-in-out ";
            if (trans === 'FADE') classes += isActive ? "opacity-100 z-10" : "opacity-0 z-0";
            else if (trans === 'SLIDE_LEFT') classes += isActive ? "translate-x-0 z-10" : "translate-x-full z-0";
            else if (trans === 'SLIDE_RIGHT') classes += isActive ? "translate-x-0 z-10" : "-translate-x-full z-0";
            else if (trans === 'SLIDE_UP') classes += isActive ? "translate-y-0 z-10" : "translate-y-full z-0";
            else if (trans === 'SLIDE_DOWN') classes += isActive ? "translate-y-0 z-10" : "-translate-y-full z-0";
            else classes += isActive ? "opacity-100 z-10 duration-0" : "opacity-0 z-0 duration-0";

            if (isVid) {
              return <video key={item.id} src={resUrl} className={classes} autoPlay muted playsInline onEnded={(e) => {
                setCurrentIndex(prev => prev + 1);
                e.currentTarget.currentTime = 0;
                e.currentTarget.play();
              }} />;
            }
            return <img key={item.id} src={resUrl} alt="" className={classes} />;
          })}
        </div>
      ) : (
        <div className="w-full h-full bg-slate-50 flex items-center justify-center p-8 overflow-hidden relative cursor-default" onClick={(e) => e.stopPropagation()}>
          {/* Decorative background blurs to match Pastel Pop */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-400/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-400/20 rounded-full blur-3xl pointer-events-none" />

          <div className="w-full max-w-5xl bg-white/80 backdrop-blur-3xl rounded-[3rem] shadow-[0_20px_60px_rgb(0,0,0,0.06)] border border-white p-12 flex flex-col items-center z-10 animate-in fade-in zoom-in-95 duration-700">
            <div className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-emerald-100 to-emerald-50 shadow-[inset_0_4px_20px_rgb(0,0,0,0.05)] flex items-center justify-center mb-6 ring-4 ring-white">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            </div>
            <h1 className="text-4xl font-extrabold text-slate-800 tracking-tight">Screen Paired Successfully</h1>
            <p className="text-lg font-medium text-slate-500 mt-2 mb-10 text-center">Waiting for a schedule to be assigned from the dashboard...</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl mb-10">
              {/* Device Card */}
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
                  <Monitor className="w-6 h-6 text-indigo-500" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">{screenName || 'Display Screen'}</h3>
                <p className="text-xs font-semibold text-slate-400 mt-1">{typeof window !== 'undefined' ? `${window.screen.width}×${window.screen.height}` : 'Unknown'} • {typeof navigator !== 'undefined' ? (navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Other') : ''}</p>
                <div className="mt-4 flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Online
                </div>
              </div>

              {/* Storage Card */}
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center mb-4">
                  <HardDrive className="w-6 h-6 text-sky-500" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">Local Storage</h3>
                <p className="text-xs font-semibold text-slate-400 mt-1">{storageInfo.used} used of {storageInfo.total}</p>
                <div className="w-full h-2 bg-slate-100 rounded-full mt-4 overflow-hidden">
                  <div className="h-full bg-sky-500 rounded-full transition-all duration-1000" style={{ width: `${storageInfo.percent}%` }} />
                </div>
              </div>

              {/* Server Card */}
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center mb-4">
                  <Server className="w-6 h-6 text-violet-500" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">CMS Server</h3>
                <p className="text-xs font-semibold text-slate-400 mt-1 truncate w-full px-2" title={typeof window !== 'undefined' ? window.location.hostname : 'Local'}>{typeof window !== 'undefined' ? window.location.hostname : 'Local'}</p>
                <p className="text-[10px] font-semibold text-slate-400 mt-1">Last sync: {lastSync || 'Never'}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4">
              <button onClick={(e) => { 
                e.stopPropagation(); 
                if(window.confirm('Are you absolutely certain you want to tear down the connection? This will wipe the pairing from this device.')) {
                  localStorage.removeItem('edu_device_fp'); 
                  setPhase('registering'); 
                  setShowOverlay(false);
                }
              }} className="px-6 py-3 bg-white border border-slate-200 hover:border-red-100 hover:bg-red-50 text-slate-700 hover:text-red-600 text-sm font-bold rounded-2xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative group">
                <Power className="w-5 h-5 text-slate-400 group-hover:text-red-500" /> Unpair Device
              </button>
              <button onClick={(e) => { e.stopPropagation(); fetchContent(); }} className="px-6 py-3 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-2xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative">
                <Network className="w-5 h-5 text-slate-400" /> Ping Server
              </button>
              <button onClick={(e) => { e.stopPropagation(); alert('No assigned content currently queued.'); }} className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-2xl transition-all shadow-[0_8px_20px_rgb(99,102,241,0.3)] hover:shadow-[0_8px_25px_rgb(99,102,241,0.4)] hover:-translate-y-0.5 flex items-center gap-2 focus:scale-95 z-20 relative">
                <Play className="w-5 h-5 fill-current" /> Auto-Play
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slide level restriction overlay logic goes here if desired, but UI logic removes the bottom progress bar. */}

      {/* Overlay */}
      {showOverlay && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 rounded-2xl p-8 max-w-md w-full mx-4 border border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">{screenName || 'Screen'}</h3>
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-emerald-400" />
                <span className="text-sm text-emerald-400 font-medium">Connected</span>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Playlist</span><span className="text-white font-medium">{playlist?.name || 'None'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Slide</span><span className="text-white font-medium">{(currentIndex % (sorted.length || 1)) + 1} / {sorted.length}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Last Sync</span><span className="text-white font-medium">{lastSync || 'Never'}</span></div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={(e) => { e.stopPropagation(); fetchContent(); }} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors">Sync Now</button>
              <button onClick={(e) => { 
                e.stopPropagation(); 
                if(window.confirm('Are you sure you want to completely unpair this device from the CMS?')) {
                  localStorage.removeItem('edu_device_fp'); 
                  setPhase('registering'); 
                  setShowOverlay(false);
                }
              }} title="Unpair Device" className="py-2 px-4 bg-red-950/40 hover:bg-red-900 border border-red-900/50 text-red-200 hover:text-white rounded-lg text-sm transition-colors group">
                <Power className="w-4 h-4 group-hover:text-red-100" />
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes shrink { from { width: 100%; } to { width: 0%; } }
      `}</style>
    </div>
  );
}
