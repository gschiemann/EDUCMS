"use client";


import { getServiceWorkerContainer } from '../../lib/safe-service-worker';
/**
 * StaleBundleWatcher — mounted once at the DashboardLayout root.
 *
 * Polls /api/build-info every 5 min. If the server's deployed SHA
 * differs from the SHA baked into this open tab's bundle, shows a
 * non-blocking toast asking the operator to reload — and after
 * 30 s of no operator action, soft-reloads the page automatically.
 *
 * Why this exists (2026-05-12):
 *
 * Operator updated their profile, clicked Save, but the dashboard
 * kept saying "gschiemann." Root cause: their tab loaded the JS
 * bundle BEFORE the profile fix shipped to Vercel. The buggy
 * require() code patched a parallel store; the real store stayed
 * stale. Every Vercel deploy silently strands every open dashboard
 * tab on the previous bundle until the operator manually hard-
 * refreshes — which they rarely do.
 *
 * The kiosk player already has this exact check (Phase B4 stale-
 * bundle drift detection). This brings the same self-heal to the
 * dashboard so the next deploy doesn't reproduce the issue.
 */

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface BuildInfo {
  sha: string | null;
  shaFull?: string | null;
}

/**
 * 2026-06-08 — Reload that ACTUALLY clears the stale shell.
 *
 * The old code just called window.location.reload(), which — when a
 * stale dashboard service worker was still controlling the page — got
 * served the SAME stale app shell straight back out of CacheStorage.
 * That's why operators reported "reloading doesn't help, I have to
 * clear my cache." This version, before reloading:
 *   1. pulls the freshly-deployed service worker (registration.update)
 *      and tells any waiting worker to take over immediately, and
 *   2. deletes the dashboard's own CacheStorage entries (edu-shell-*),
 *      so the post-reload fetch can't be answered from the stale cache.
 * Scoped to edu-shell-* so the kiosk player's offline store (same
 * origin) is never wiped. Best-effort: any failure still reloads.
 */
async function freshReload() {
  try {
    const swc = getServiceWorkerContainer();
    if (swc) {
      const reg = await swc.getRegistration();
      if (reg) {
        try { await reg.update(); } catch { /* non-fatal */ }
        try { reg.waiting?.postMessage({ type: 'SKIP_WAITING' }); } catch { /* non-fatal */ }
      }
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('edu-shell-')).map((k) => caches.delete(k)),
      );
    }
  } catch {
    // Best-effort — reload regardless so the operator is never stuck.
  }
  window.location.reload();
}

export function StaleBundleWatcher() {
  // Bake-time SHA — read once at module load. Same logic as the
  // player's drift check: NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA is auto-
  // injected by Vercel; NEXT_PUBLIC_BUILD_SHA is the in-repo
  // convention if anyone sets it explicitly.
  const mySha: string | null = (() => {
    const raw =
      (process.env as any).NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
      (process.env as any).NEXT_PUBLIC_BUILD_SHA ||
      null;
    return raw ? String(raw).slice(0, 12) : null;
  })();

  const [stale, setStale] = useState(false);
  const [reloadCountdownSec, setReloadCountdownSec] = useState<number | null>(null);

  // Poll /api/build-info every 5 min. The check is essentially free
  // (one ~150-byte JSON response per 5 min per open tab) and only
  // takes action when the SHA actually differs — so the typical
  // case of "tab open all day, no deploys" produces 12 idle polls
  // per hour with zero UI noise.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!mySha) return; // Local dev / self-hosted — can't compare.

    let cancelled = false;
    const check = async () => {
      if (cancelled || stale) return;
      try {
        const res = await fetch('/api/build-info', { cache: 'no-store' });
        if (!res.ok) return;
        const data: BuildInfo = await res.json();
        const serverSha = typeof data?.sha === 'string' ? data.sha : null;
        if (!serverSha || serverSha === mySha) return;
        // Drift detected → show the toast.
        console.log(`[dashboard-drift] mine=${mySha} server=${serverSha} — prompting reload`);
        setStale(true);
        setReloadCountdownSec(30);
      } catch {
        // Tolerated — next tick retries.
      }
    };

    // First check delayed 30 s so initial page-load isn't interrupted.
    const kickTimer = setTimeout(check, 30_000);
    const iv = setInterval(check, 5 * 60_000);
    return () => {
      cancelled = true;
      clearTimeout(kickTimer);
      clearInterval(iv);
    };
  }, [mySha, stale]);

  // Countdown tick. 30 s of "operator hasn't clicked" → auto-reload.
  // Operator can click "Reload now" to skip the countdown OR click
  // "Later" to pause for 5 more minutes (the next check still fires).
  useEffect(() => {
    if (!stale || reloadCountdownSec === null) return;
    if (reloadCountdownSec <= 0) {
      void freshReload();
      return;
    }
    const t = setTimeout(() => setReloadCountdownSec((s) => (s == null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [stale, reloadCountdownSec]);

  if (!stale) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-[9999] max-w-sm bg-white rounded-2xl shadow-2xl border border-indigo-200 p-4 flex items-start gap-3 animate-in slide-in-from-bottom-2"
    >
      <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
        <RefreshCw className="w-4 h-4 text-indigo-600 animate-spin" style={{ animationDuration: '3s' }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-800">A new version is available</p>
        <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
          Reloading in <span className="font-bold text-indigo-600">{reloadCountdownSec ?? 0}s</span> to pick up the latest fixes.
        </p>
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => void freshReload()}
            className="px-3 py-1.5 text-[11px] font-bold rounded-lg text-white"
            style={{ background: 'var(--brand-primary, #4f46e5)' }}
          >
            Reload now
          </button>
          <button
            type="button"
            onClick={() => {
              setStale(false);
              setReloadCountdownSec(null);
            }}
            className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
