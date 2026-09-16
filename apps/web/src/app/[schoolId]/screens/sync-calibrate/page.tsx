'use client';

/**
 * Camera auto-calibration wizard (tier-3, 2026-07-28).
 * docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §8 follow-up.
 *
 * The one thing software on a screen can never measure is the screen's
 * own glass: display electronics add 0–80ms AFTER the browser hands the
 * frame over, and it differs per panel model. This wizard measures it
 * the only honest way — by looking at the photons:
 *
 *   1. Every screen in the frame-locked group is remotely flipped into
 *      a synced flash pattern (white flash 120ms on every synced second,
 *      timed off each screen's trimmed clock — the same phase content
 *      flips on).
 *   2. The operator points their phone camera so all screens are in
 *      view and taps each screen in the preview to tag it.
 *   3. We sample each tagged region's luminance per camera frame for 8s,
 *      detect flash onsets with sub-frame interpolation, and reduce them
 *      to a circular phase per screen (pure math in lib/sync-calibration,
 *      unit-tested).
 *   4. Phase deltas ARE the glass deltas → one tap writes the per-screen
 *      trims. Re-measure to verify (residuals should read ±<10ms).
 *
 * Think AVR mic-calibration, but for video walls. 30-second happy path:
 * open → camera on → tap screens → measure → Apply.
 *
 * Mobile-first (this runs on the operator's phone). Camera requires
 * HTTPS (prod) or localhost. No polling while idle; every loop stops on
 * unmount and the flash mode is disarmed on exit (players also
 * auto-expire it, belt + suspenders).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Camera, Check, Loader2, RefreshCw, Radio, X, ChevronLeft } from 'lucide-react';
import { useScreenGroups, useCalibrateFlash, useSetScreenSyncOffset } from '@/hooks/use-api';
import {
  detectFlashOnsets,
  circularPhaseMs,
  phaseConfidenceMs,
  computeTrimUpdates,
  type LumaSample,
  type TrimUpdate,
} from '@/lib/sync-calibration';

const CAPTURE_MS = 8_000;
const REGION_FRAC = 0.09; // tag box ≈ 9% of the preview's short side

interface TaggedRegion {
  /** Center, in 0..1 fractions of the video's intrinsic frame. */
  fx: number;
  fy: number;
  screenId: string | null;
}

interface RegionResult {
  screenId: string;
  screenName: string;
  phaseMs: number | null;
  confidenceMs: number | null;
  onsetCount: number;
}

type Step = 'setup' | 'camera' | 'measuring' | 'results';

export default function SyncCalibratePage() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  // window-based param read (not useSearchParams) — same pattern as the
  // player's ?synchud flag; avoids a Suspense/prerender constraint.
  const [preselectedGroupId] = useState<string | null>(() => {
    try {
      return typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('groupId')
        : null;
    } catch { return null; }
  });

  const { data: groups } = useScreenGroups();
  const calibrateFlash = useCalibrateFlash();
  const setSyncOffset = useSetScreenSyncOffset();

  // 2026-09-16 — "keep screens in sync" moved to the playlist, so a group is
  // calibratable when its screens are ACTUALLY frame-locked (server-derived
  // `syncActive`), not when it carries the retired group flag. The second arm
  // is belt-and-braces for a payload cached before the field existed; the API
  // already folds the legacy flag into `syncActive`.
  const syncedGroups = useMemo(
    () => (Array.isArray(groups)
      ? groups.filter((g: any) => g?.syncActive === true || g?.syncMode === 'locked')
      : []),
    [groups],
  );
  const [groupId, setGroupId] = useState<string | null>(preselectedGroupId);
  const group = syncedGroups.find((g: any) => g.id === groupId) ?? null;
  const groupScreens: any[] = Array.isArray(group?.screens) ? group.screens : [];

  const [step, setStep] = useState<Step>('setup');
  const [error, setError] = useState<string | null>(null);
  const [regions, setRegions] = useState<TaggedRegion[]>([]);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<RegionResult[] | null>(null);
  const [updates, setUpdates] = useState<TrimUpdate[] | null>(null);
  const [applied, setApplied] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const measureStopRef = useRef<(() => void) | null>(null);
  const flashArmedRef = useRef(false);

  // ── camera lifecycle ──────────────────────────────────────────────────
  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => { /* iOS needs the tap that got us here — already had it */ });
      }
      setStep('camera');
    } catch (e: any) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access for this site and try again.'
          : `Could not open the camera (${e?.name || 'unknown'}). Calibration needs a camera — run this page on your phone.`,
      );
    }
  };

  const stopCamera = () => {
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    streamRef.current = null;
  };

  // Arm/disarm the flash mode on the group. Players auto-expire too.
  const armFlash = (on: boolean) => {
    if (!groupId) return;
    flashArmedRef.current = on;
    calibrateFlash.mutate({ groupId, on, durationSec: 120 });
  };

  useEffect(() => {
    return () => {
      // Unmount: stop everything, lights back on.
      measureStopRef.current?.();
      stopCamera();
      if (flashArmedRef.current && groupId) {
        try { calibrateFlash.mutate({ groupId, on: false }); } catch { /* auto-expiry covers us */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // ── tagging ──────────────────────────────────────────────────────────
  const onPreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (step !== 'camera') return;
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    if (regions.length >= Math.max(groupScreens.length, 6)) return;
    // Default assignment: next unassigned screen in group order.
    const used = new Set(regions.map((r) => r.screenId).filter(Boolean));
    const nextScreen = groupScreens.find((s) => !used.has(s.id));
    setRegions((prev) => [...prev, { fx, fy, screenId: nextScreen?.id ?? null }]);
  };

  // ── measurement ──────────────────────────────────────────────────────
  const startMeasure = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || regions.length < 2) return;
    const tagged = regions.filter((r) => r.screenId);
    if (tagged.length < 2) {
      setError('Tag at least two screens (tap each screen in the preview).');
      return;
    }
    setError(null);
    setResults(null);
    setUpdates(null);
    setApplied(false);
    setStep('measuring');
    setProgress(0);

    // Downscaled sampling canvas — cheap per-frame luma reads.
    const canvas = document.createElement('canvas');
    const CW = 320;
    const CH = Math.max(2, Math.round((v.videoHeight / v.videoWidth) * 320));
    canvas.width = CW;
    canvas.height = CH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      setError('Canvas unavailable — cannot sample the camera.');
      setStep('camera');
      return;
    }
    const half = Math.max(4, Math.round(Math.min(CW, CH) * REGION_FRAC * 0.5));
    const series: LumaSample[][] = tagged.map(() => []);
    const startMono = performance.now();
    let stopped = false;
    let rafId = 0;
    let rvfcId: number | null = null;
    const hasRvfc = typeof (v as any).requestVideoFrameCallback === 'function';

    const sampleFrame = () => {
      const tMs = performance.now() - startMono;
      try {
        ctx.drawImage(v, 0, 0, CW, CH);
        tagged.forEach((r, i) => {
          const cx = Math.round(r.fx * CW);
          const cy = Math.round(r.fy * CH);
          const x = Math.max(0, Math.min(CW - 2 * half, cx - half));
          const y = Math.max(0, Math.min(CH - 2 * half, cy - half));
          const img = ctx.getImageData(x, y, half * 2, half * 2).data;
          let sum = 0;
          for (let p = 0; p < img.length; p += 4) {
            sum += 0.2126 * img[p] + 0.7152 * img[p + 1] + 0.0722 * img[p + 2];
          }
          series[i].push({ tMs, v: sum / (img.length / 4) });
        });
      } catch { /* a dropped frame is fine */ }
      setProgress(Math.min(1, tMs / CAPTURE_MS));
      if (tMs >= CAPTURE_MS) {
        finish();
        return;
      }
      if (hasRvfc) {
        rvfcId = (v as any).requestVideoFrameCallback(() => { if (!stopped) sampleFrame(); });
      } else {
        rafId = requestAnimationFrame(() => { if (!stopped) sampleFrame(); });
      }
    };

    const finish = () => {
      if (stopped) return;
      stopped = true;
      const regionResults: RegionResult[] = tagged.map((r, i) => {
        const onsets = detectFlashOnsets(series[i]);
        const scr = groupScreens.find((s) => s.id === r.screenId);
        return {
          screenId: r.screenId!,
          screenName: scr?.name ?? r.screenId!,
          phaseMs: circularPhaseMs(onsets),
          confidenceMs: phaseConfidenceMs(onsets),
          onsetCount: onsets.length,
        };
      });
      setResults(regionResults);
      const good = regionResults.filter((r) => r.phaseMs !== null);
      if (good.length >= 2) {
        const measurements = good.map((r) => {
          const scr = groupScreens.find((s) => s.id === r.screenId);
          return {
            screenId: r.screenId,
            phaseMs: r.phaseMs!,
            currentTrimMs: typeof scr?.syncOffsetMs === 'number' ? scr.syncOffsetMs : 0,
          };
        });
        setUpdates(computeTrimUpdates(measurements, measurements[0].screenId));
      } else {
        setUpdates(null);
        setError(
          'Could not read a clean flash from enough screens. Check every tag sits ON a flashing screen, hold the phone steadier, and re-measure.',
        );
      }
      setStep('results');
    };

    measureStopRef.current = () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (hasRvfc && rvfcId !== null) {
        try { (v as any).cancelVideoFrameCallback(rvfcId); } catch { /* noop */ }
      }
    };
    sampleFrame();
  };

  const applyAll = async () => {
    if (!updates) return;
    for (const u of updates) {
      const scr = groupScreens.find((s) => s.id === u.screenId);
      const current = typeof scr?.syncOffsetMs === 'number' ? scr.syncOffsetMs : 0;
      if (u.newTrimMs !== current) {
        // Sequential on purpose — a phone on venue WiFi shouldn't burst.
        // eslint-disable-next-line no-await-in-loop
        await setSyncOffset.mutateAsync({ id: u.screenId, syncOffsetMs: u.newTrimMs }).catch(() => {});
      }
    }
    setApplied(true);
  };

  const screenName = (id: string) => groupScreens.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href={`/${schoolId}/screens`}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-lg font-black text-slate-800 flex items-center gap-2">
            <Camera className="w-5 h-5 text-indigo-500" /> Camera sync calibration
          </h1>
          <p className="text-xs font-medium text-slate-400 mt-0.5">
            Measures each display&apos;s true glass latency by watching the screens flash — then writes the per-screen trims for you.
          </p>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
          {error}
        </div>
      )}

      {step === 'setup' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-5 space-y-4 shadow-sm">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Frame-locked group</div>
            {syncedGroups.length === 0 ? (
              <p className="text-sm text-slate-500">
                No screens are synced yet. Open a playlist in <Link className="text-indigo-600 font-semibold" href={`/${schoolId}/playlists`}>Playlists</Link>, turn on <span className="font-semibold">Keep screens in sync</span> on its Screens tab, then come back.
              </p>
            ) : (
              <div className="space-y-1.5">
                {syncedGroups.map((g: any) => (
                  <button
                    key={g.id}
                    onClick={() => setGroupId(g.id)}
                    className={`w-full text-left px-4 py-3 rounded-2xl border text-sm font-bold transition-colors flex items-center gap-2 ${
                      groupId === g.id
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300'
                    }`}
                  >
                    <Radio className="w-4 h-4" /> {g.name}
                    <span className={`ml-auto text-[10px] font-semibold ${groupId === g.id ? 'text-indigo-200' : 'text-slate-400'}`}>
                      {Array.isArray(g.screens) ? g.screens.length : 0} screens
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <ol className="text-xs text-slate-500 font-medium space-y-1 list-decimal list-inside">
            <li>Stand where your phone camera can see <span className="font-bold">all the screens at once</span>.</li>
            <li>The screens will switch to a black screen with a white flash each second.</li>
            <li>Tap each screen in the camera preview to tag it, then measure (~8s).</li>
          </ol>
          <button
            disabled={!group}
            onClick={() => { armFlash(true); startCamera(); }}
            className="w-full px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
          >
            <Camera className="w-4 h-4" /> Start — flash the screens &amp; open camera
          </button>
        </div>
      )}

      {(step === 'camera' || step === 'measuring') && (
        <div className="bg-white rounded-3xl border border-slate-200 p-4 space-y-3 shadow-sm">
          <div
            className="relative w-full overflow-hidden rounded-2xl bg-black cursor-crosshair"
            onClick={onPreviewClick}
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} playsInline muted className="w-full h-auto block" />
            {regions.map((r, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${(r.fx * 100).toFixed(2)}%`,
                  top: `${(r.fy * 100).toFixed(2)}%`,
                  transform: 'translate(-50%, -50%)',
                }}
                className="pointer-events-none"
              >
                <div className="w-14 h-14 border-2 border-cyan-400 rounded-lg" />
                <div className="mt-1 px-1.5 py-0.5 rounded bg-cyan-400 text-black text-[10px] font-black text-center truncate max-w-[90px]">
                  {r.screenId ? screenName(r.screenId) : `#${i + 1}`}
                </div>
              </div>
            ))}
            {step === 'measuring' && (
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-black/40">
                <div className="h-1.5 bg-cyan-400 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>

          {step === 'camera' && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {regions.map((r, i) => (
                  <span key={i} className="flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg bg-slate-100 text-[11px] font-bold text-slate-600">
                    <select
                      value={r.screenId ?? ''}
                      onChange={(e) =>
                        setRegions((prev) => prev.map((x, xi) => (xi === i ? { ...x, screenId: e.target.value || null } : x)))
                      }
                      className="bg-transparent outline-none text-[11px] font-bold"
                    >
                      <option value="">— pick screen —</option>
                      {groupScreens.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setRegions((prev) => prev.filter((_, xi) => xi !== i))}
                      className="p-0.5 text-slate-400 hover:text-red-500"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {regions.length === 0 && (
                  <span className="text-[11px] font-semibold text-slate-400">Tap each flashing screen in the preview to tag it.</span>
                )}
              </div>
              <button
                disabled={regions.filter((r) => r.screenId).length < 2}
                onClick={startMeasure}
                className="w-full px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold transition-colors"
              >
                Measure (8s) — hold steady
              </button>
            </>
          )}
          {step === 'measuring' && (
            <p className="text-center text-xs font-bold text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-500" /> Watching the flashes… hold the phone steady
            </p>
          )}
        </div>
      )}

      {step === 'results' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-5 space-y-4 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Measured glass offsets</div>
          <div className="space-y-1.5">
            {(results ?? []).map((r) => {
              const u = updates?.find((x) => x.screenId === r.screenId);
              return (
                <div key={r.screenId} className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-slate-50 text-sm">
                  <span className="font-bold text-slate-700 flex-1 truncate">{r.screenName}</span>
                  {r.phaseMs === null ? (
                    <span className="text-[11px] font-bold text-amber-600">no clean flash ({r.onsetCount} pulses)</span>
                  ) : (
                    <>
                      <span className="text-[11px] font-mono text-slate-500">
                        {u ? `${u.deltaMs > 0 ? '+' : ''}${u.deltaMs}ms` : '—'}
                        {r.confidenceMs !== null && <span className="text-slate-300"> ±{r.confidenceMs.toFixed(0)}</span>}
                      </span>
                      {u && (
                        <span className="text-[11px] font-bold text-indigo-600 font-mono">→ trim {u.newTrimMs}ms</span>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setStep('camera'); setResults(null); setUpdates(null); armFlash(true); }}
              className="flex-1 px-4 py-3 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-sm font-bold transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" /> {applied ? 'Verify (re-measure)' : 'Re-measure'}
            </button>
            <button
              disabled={!updates || applied}
              onClick={applyAll}
              className="flex-1 px-4 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
            >
              {applied ? (<><Check className="w-4 h-4" /> Applied</>) : (<>Apply trims</>)}
            </button>
          </div>
          {applied && (
            <p className="text-[11px] font-semibold text-slate-400 text-center">
              Trims saved — screens pick them up within ~10s. Tap Verify to re-measure; residuals should read within about ±10ms.
            </p>
          )}
          <button
            onClick={() => { armFlash(false); stopCamera(); setStep('setup'); setRegions([]); }}
            className="w-full text-[11px] font-bold text-slate-400 hover:text-slate-600 transition-colors"
          >
            Done — turn the screens back to content
          </button>
        </div>
      )}
    </div>
  );
}
