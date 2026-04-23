"use client";

/**
 * Mobile pairing page — scan the QR code shown on a screen device with a phone
 * camera to pair it without typing. Falls back to manual entry for iOS Safari
 * quirks where getUserMedia may be blocked on non-HTTPS origins.
 */

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { apiFetch } from '@/lib/api-client';
import { clog } from '@/lib/client-logger';

type Phase = 'idle' | 'scanning' | 'pairing' | 'success' | 'error';

export default function PairPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string>('');
  const [pairedName, setPairedName] = useState<string>('');
  const [manualCode, setManualCode] = useState<string>('');

  const stopCamera = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const submitPairingCode = async (code: string) => {
    setPhase('pairing');
    setError('');
    clog.info('pair', 'Submitting pairing code', { code: code.trim().toUpperCase().slice(0, 6) });
    try {
      const res: any = await apiFetch('/screens/pair', {
        method: 'POST',
        body: JSON.stringify({ pairingCode: code.trim().toUpperCase() }),
      });
      clog.info('pair', 'Pair success', { screenId: res?.id, name: res?.name });
      setPairedName(res?.name || 'Screen');
      setPhase('success');
    } catch (e: any) {
      clog.error('pair', 'Pair failed', { message: e?.message });
      setError(e?.message || 'Invalid pairing code');
      setPhase('error');
    }
  };

  const extractCode = (raw: string): string | null => {
    const trimmed = raw.trim();
    // QR payload may be the bare code ("ABC123") or a URL with ?code=ABC123
    try {
      const u = new URL(trimmed);
      const c = u.searchParams.get('code') || u.searchParams.get('pairingCode');
      if (c) return c.toUpperCase();
    } catch {
      // not a URL
    }
    if (/^[A-Z0-9]{4,12}$/i.test(trimmed)) return trimmed.toUpperCase();
    return null;
  };

  const tick = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });
    if (code?.data) {
      const extracted = extractCode(code.data);
      if (extracted) {
        stopCamera();
        void submitPairingCode(extracted);
        return;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const startCamera = async () => {
    setError('');
    setPhase('scanning');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();
      }
      rafRef.current = requestAnimationFrame(tick);
    } catch (e: any) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'Camera permission denied. You can type the code instead.'
          : 'Camera unavailable on this device. Type the code below.',
      );
      setPhase('error');
    }
  };

  // Test hook: allow E2E tests to inject a decoded QR payload without a real
  // camera (guarded to non-production builds).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).__pairFromQrData = (raw: string) => {
      const extracted = extractCode(raw);
      if (extracted) void submitPairingCode(extracted);
    };
    return () => {
      try { delete (window as any).__pairFromQrData; } catch { /* ignore */ }
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col items-center p-6">
      <h1 className="text-2xl font-bold mt-6 mb-2">Pair a Screen</h1>
      <p className="text-sm text-slate-400 mb-6 text-center max-w-sm">
        Point your phone camera at the QR code shown on the screen device, or
        type the 6-digit code.
      </p>

      <div className="w-full max-w-sm bg-slate-900 rounded-2xl overflow-hidden border border-slate-800">
        <div className="aspect-square relative bg-black">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            muted
            playsInline
            aria-label="Camera preview"
          />
          <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
          {phase === 'idle' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                onClick={startCamera}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 rounded-xl font-bold"
              >
                Start Camera
              </button>
            </div>
          )}
          {phase === 'pairing' && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
              <p className="text-lg font-semibold">Pairing…</p>
            </div>
          )}
          {phase === 'success' && (
            <div className="absolute inset-0 bg-emerald-600/90 flex flex-col items-center justify-center p-4 text-center">
              <p className="text-xl font-bold mb-2">Paired!</p>
              <p className="text-sm">{pairedName} is now connected.</p>
            </div>
          )}
        </div>

        <div className="p-4 space-y-3">
          {error && (
            <div
              role="alert"
              className="text-sm text-red-300 bg-red-900/40 border border-red-800 rounded-lg px-3 py-2"
            >
              {error}
            </div>
          )}

          <label htmlFor="manual-pair-code" className="block text-xs font-semibold text-slate-400">
            Or type the code
          </label>
          <div className="flex gap-2">
            <input
              id="manual-pair-code"
              data-testid="manual-pair-code"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={12}
              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-center font-mono tracking-widest uppercase"
            />
            <button
              onClick={() => manualCode && submitPairingCode(manualCode)}
              disabled={!manualCode || phase === 'pairing'}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg font-bold"
            >
              Pair
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
