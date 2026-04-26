"use client";

/**
 * Sprint 5: Admin broadcast UI.
 *
 * Send a text overlay (optionally with media URLs) to all screens in a
 * scope. Hold-to-confirm (3s) to guard against accidental sends. Lists
 * currently active emergency messages with per-row Clear buttons.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';
import { AlertTriangle, Megaphone, ShieldAlert, Send, Loader2, X, Image as ImageIcon, Volume2 } from 'lucide-react';

type Severity = 'INFO' | 'WARN' | 'CRITICAL';

interface ActiveMsg {
  id: string;
  type: 'SOS' | 'TEXT_BROADCAST' | 'MEDIA_ALERT';
  severity: Severity;
  textBlob: string | null;
  mediaUrls: string[];
  audioUrl: string | null;
  expiresAt: number | null;
  createdAt: string;
  triggeredByUserId: string | null;
}

const HOLD_MS = 3000;

export default function BroadcastPage() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params.schoolId;
  const { user, token } = useAppStore();
  const userRole = useUIStore((s) => s.user?.role);
  const isViewer = userRole === 'RESTRICTED_VIEWER';

  const [text, setText] = useState('');
  const [severity, setSeverity] = useState<Severity>('WARN');
  const [durationMin, setDurationMin] = useState(5);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [mediaDraft, setMediaDraft] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [withMedia, setWithMedia] = useState(false);

  const [phase, setPhase] = useState<'idle' | 'holding' | 'sending' | 'sent' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [active, setActive] = useState<ActiveMsg[]>([]);

  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  const role = user?.role;
  const canClear = role === 'DISTRICT_ADMIN' || role === 'SUPER_ADMIN';

  const fetchActive = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/emergency/status?tenantId=${encodeURIComponent(schoolId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const json = await res.json();
      setActive(json.active || []);
    } catch { /* offline — ignore */ }
  }, [schoolId, token]);

  useEffect(() => {
    fetchActive();
    const h = setInterval(fetchActive, 5000);
    return () => clearInterval(h);
  }, [fetchActive]);

  const resetHold = () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    holdTimerRef.current = null;
    progressTimerRef.current = null;
  };

  const handleHoldStart = (e: React.PointerEvent) => {
    e.preventDefault();
    if (phase !== 'idle' && phase !== 'error') return;
    if (!text.trim()) { setErrorMsg('Message is required.'); setPhase('error'); return; }
    setPhase('holding');
    setProgress(0);
    const start = Date.now();
    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(100, (elapsed / HOLD_MS) * 100));
    }, 50);
    holdTimerRef.current = setTimeout(() => { void submit(); }, HOLD_MS);
  };

  const handleHoldCancel = () => {
    if (phase === 'holding') {
      setPhase('idle');
      setProgress(0);
    }
    resetHold();
  };

  const submit = async () => {
    resetHold();
    setPhase('sending');
    setErrorMsg('');
    try {
      const endpoint = withMedia ? 'media-alert' : 'broadcast';
      const body: any = withMedia
        ? {
            scopeType: 'tenant',
            scopeId: schoolId,
            mediaUrls,
            audioUrl: audioUrl || undefined,
            textBlob: text,
            severity,
          }
        : {
            scopeType: 'tenant',
            scopeId: schoolId,
            text,
            severity,
            durationMs: durationMin * 60 * 1000,
          };

      const res = await fetch(`${API_URL}/emergency/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Send failed: ${res.status}`);
      setPhase('sent');
      setText('');
      setMediaUrls([]);
      setAudioUrl('');
      fetchActive();
      setTimeout(() => setPhase('idle'), 2000);
    } catch (e: any) {
      setErrorMsg(e.message || 'Broadcast failed');
      setPhase('error');
    }
  };

  const clearMessage = async (id: string) => {
    try {
      await fetch(`${API_URL}/emergency/messages/${id}/all-clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'include',
      });
      fetchActive();
    } catch { /* ignore */ }
  };

  const severityButton = (s: Severity, label: string, color: string) => (
    <button
      type="button"
      onClick={() => setSeverity(s)}
      className={`flex-1 px-4 py-3 rounded-lg border-2 font-bold uppercase tracking-wide text-sm transition ${
        severity === s ? `${color} text-white border-transparent` : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 md:p-10">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center gap-3 mb-8">
          <Megaphone className="w-8 h-8 text-orange-500" />
          <div>
            <h1 className="text-2xl font-black uppercase tracking-wide">Emergency Broadcast</h1>
            <p className="text-sm text-slate-400">Push a text overlay or media-rich alert to every screen in this school.</p>
          </div>
        </header>

        <div className="grid md:grid-cols-5 gap-8">
          {/* Composer */}
          {!isViewer && (<section className="md:col-span-3 space-y-5 bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Severity</label>
              <div className="flex gap-2">
                {severityButton('INFO', 'Info', 'bg-yellow-500')}
                {severityButton('WARN', 'Warn', 'bg-orange-500')}
                {severityButton('CRITICAL', 'Critical', 'bg-red-600')}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Message</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="e.g., All staff report to the main office."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white focus:border-orange-500 focus:outline-none"
              />
              <div className="text-xs text-slate-500 mt-1 text-right">{text.length}/2000</div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
                <input type="checkbox" checked={withMedia} onChange={(e) => setWithMedia(e.target.checked)} />
                Include media (image/video/audio)
              </label>
              {withMedia ? (
                <div className="space-y-3 border border-slate-800 rounded-lg p-3 bg-slate-950">
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={mediaDraft}
                      onChange={(e) => setMediaDraft(e.target.value)}
                      placeholder="https://cdn.example.com/evac-map.jpg"
                      className="flex-1 bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => { if (mediaDraft) { setMediaUrls([...mediaUrls, mediaDraft]); setMediaDraft(''); } }}
                      className="px-4 bg-slate-800 rounded text-sm font-bold uppercase tracking-wide hover:bg-slate-700"
                    >Add</button>
                  </div>
                  {mediaUrls.length > 0 && (
                    <ul className="space-y-1 text-xs">
                      {mediaUrls.map((u, i) => (
                        <li key={i} className="flex items-center gap-2 text-slate-400">
                          <ImageIcon className="w-3 h-3" />
                          <span className="flex-1 truncate">{u}</span>
                          <button onClick={() => setMediaUrls(mediaUrls.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300"><X className="w-3 h-3" /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-slate-400" />
                    <input
                      type="url"
                      value={audioUrl}
                      onChange={(e) => setAudioUrl(e.target.value)}
                      placeholder="Optional audio URL"
                      className="flex-1 bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Duration (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={durationMin}
                    onChange={(e) => setDurationMin(Math.max(1, parseInt(e.target.value) || 5))}
                    className="w-32 bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                  />
                </div>
              )}
            </div>

            {/* Preview */}
            <div>
              <div className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Preview</div>
              <div className={`rounded-lg p-4 border-2 ${
                severity === 'INFO' ? 'bg-yellow-400/95 border-yellow-600 text-slate-900' :
                severity === 'WARN' ? 'bg-orange-500/95 border-orange-700 text-white' :
                'bg-red-700/95 border-red-900 text-white'
              }`}>
                <div className="flex items-center gap-3">
                  {severity === 'CRITICAL' ? <ShieldAlert className="w-6 h-6" /> :
                   severity === 'WARN' ? <AlertTriangle className="w-6 h-6" /> :
                   <Megaphone className="w-6 h-6" />}
                  <span className="font-bold text-lg">{text || 'Your message will appear here.'}</span>
                </div>
              </div>
            </div>

            {errorMsg && <div className="p-3 rounded bg-red-900/40 border border-red-800 text-red-200 text-sm">{errorMsg}</div>}
            {phase === 'sent' && <div className="p-3 rounded bg-emerald-900/40 border border-emerald-800 text-emerald-200 text-sm">Broadcast dispatched.</div>}

            <button
              onPointerDown={handleHoldStart}
              onPointerUp={handleHoldCancel}
              onPointerLeave={handleHoldCancel}
              onContextMenu={(e) => e.preventDefault()}
              disabled={phase === 'sending'}
              className={`relative w-full py-5 rounded-xl font-black uppercase tracking-widest text-lg overflow-hidden transition
                ${phase === 'holding' ? 'bg-orange-700' : 'bg-orange-600 hover:bg-orange-500'}
                ${phase === 'sending' ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {phase === 'holding' && (
                <span className="absolute inset-y-0 left-0 bg-orange-900/60" style={{ width: `${progress}%` }} />
              )}
              <span className="relative flex items-center justify-center gap-3">
                {phase === 'sending' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                {phase === 'holding' ? `Hold to send… ${Math.floor(progress)}%` : 'Hold 3s to Broadcast'}
              </span>
            </button>
          </section>)}
          <section className={`${isViewer ? 'md:col-span-5' : 'md:col-span-2'} bg-slate-900 border border-slate-800 rounded-xl p-6`}>
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Active broadcasts</h2>
            {active.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No active emergency messages.</p>
            ) : (
              <ul className="space-y-3">
                {active.map((m) => (
                  <li key={m.id} className={`rounded-lg p-3 border ${
                    m.severity === 'CRITICAL' ? 'border-red-700 bg-red-900/30' :
                    m.severity === 'WARN' ? 'border-orange-700 bg-orange-900/30' :
                    'border-yellow-700 bg-yellow-900/20'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold uppercase tracking-widest opacity-80">{m.type} · {m.severity}</span>
                      {canClear && (
                        <button
                          onClick={() => clearMessage(m.id)}
                          className="text-xs font-bold uppercase tracking-wide text-slate-300 hover:text-white border border-slate-600 rounded px-2 py-1"
                        >Clear</button>
                      )}
                    </div>
                    <p className="text-sm leading-snug">{m.textBlob || '(no text)'}</p>
                    {m.mediaUrls.length > 0 && (
                      <p className="text-xs text-slate-400 mt-1">{m.mediaUrls.length} media attachment{m.mediaUrls.length === 1 ? '' : 's'}</p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-1">
                      {new Date(m.createdAt).toLocaleTimeString()} {m.expiresAt ? `· expires ${new Date(m.expiresAt * 1000).toLocaleTimeString()}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
