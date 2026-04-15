"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { MonitorPlay, Wifi, WifiOff, AlertTriangle, Loader2, Settings } from 'lucide-react';

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
          // Format manifest items to match player structure
          const formattedPlaylist = {
            name: 'Scheduled Content',
            items: manifest.playlists[0].items.map((item: any) => ({
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

      // 2. Fallback: If no schedule is assigned, just find the very first playlist with items
      const playlistRes = await fetch(`${getApiRoot()}/api/v1/playlists`, {
        headers: { 'Authorization': `Bearer ${access_token}` },
      });

      if (!playlistRes.ok) throw new Error('Failed to load playlists');
      const payload = await playlistRes.json();
      const playlists = Array.isArray(payload) ? payload : (payload.value || []);

      const validPlaylist = playlists.find((p: any) => p.items?.length > 0);

      if (validPlaylist) {
        setPlaylist(validPlaylist);
        setCurrentIndex(0);
        setPhase('playing');
        setLastSync(new Date().toLocaleTimeString());
      } else {
        setError('No content assigned to this screen yet');
        setPhase('offline');
      }
    } catch (e: any) {
      setError(e.message);
      setPhase('offline');
    }
  }, [screenId]);

  useEffect(() => {
    if (phase === 'connecting') fetchContent();
  }, [phase, fetchContent]);

  // ─── Auto-refresh every 60s ───
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = setInterval(fetchContent, 60000);
    return () => clearInterval(id);
  }, [phase, fetchContent]);

  // ─── Cycle through slides ───
  useEffect(() => {
    if (phase !== 'playing' || !playlist?.items?.length) return;

    const sorted = [...playlist.items].sort((a: any, b: any) => a.sequenceOrder - b.sequenceOrder);
    const item = sorted[currentIndex % sorted.length];
    const duration = item?.durationMs || 10000;

    timerRef.current = setTimeout(() => {
      setCurrentIndex(prev => (prev + 1) % sorted.length);
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
  const sorted = playlist ? [...playlist.items].sort((a: any, b: any) => a.sequenceOrder - b.sequenceOrder) : [];
  const currentItem = sorted[currentIndex % (sorted.length || 1)];
  const isVideo = currentItem?.asset?.mimeType?.startsWith('video/');
  const fileUrl = currentItem?.asset?.fileUrl || '';
  const resolvedUrl = fileUrl.startsWith('http') ? fileUrl : `${getApiRoot()}${fileUrl}`;

  return (
    <div className="fixed inset-0 bg-black cursor-none" onClick={() => setShowOverlay(!showOverlay)}>
      {currentItem ? (
        <div className="w-full h-full flex items-center justify-center">
          {isVideo ? (
            <video
              key={currentItem.id}
              src={resolvedUrl}
              className="w-full h-full object-contain"
              autoPlay muted playsInline
              onEnded={() => setCurrentIndex(prev => (prev + 1) % sorted.length)}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={currentItem.id} src={resolvedUrl} alt="" className="w-full h-full object-contain" />
          )}
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center">
          <MonitorPlay className="w-16 h-16 text-slate-600 mb-4" />
          <p className="text-xl text-slate-500">No content assigned</p>
        </div>
      )}

      {/* Progress bar */}
      {sorted.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-900/50">
          <div
            className="h-full bg-indigo-500/60"
            key={`p-${currentIndex}`}
            style={{ width: '100%', animation: `shrink ${currentItem?.durationMs || 10000}ms linear forwards` }}
          />
        </div>
      )}

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
              <button onClick={(e) => { e.stopPropagation(); fetchContent(); }} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm">Sync Now</button>
              <button onClick={(e) => { e.stopPropagation(); localStorage.removeItem('edu_device_fp'); setPhase('registering'); setShowOverlay(false); }} className="py-2 px-4 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm">
                <Settings className="w-4 h-4" />
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
