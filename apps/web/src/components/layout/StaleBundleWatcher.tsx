"use client";

/**
 * StaleBundleWatcher — mounted once at the DashboardLayout root.
 *
 * Checks /api/build-info while the tab is visible (30 s after mount or
 * after the tab becomes visible, then at most every 5 min). If the
 * deployed SHA differs from the SHA baked into this tab's bundle, it
 * shows a small persistent "A new version is available — Reload"
 * control. It never reloads a tab the operator can see.
 *
 *   - Reload: reload now (any beforeunload guard still asks first).
 *   - Later: hide the control until a DIFFERENT deployed SHA appears.
 *   - Automatic reload: only after the tab has been hidden for
 *     HIDDEN_RELOAD_DELAY_MS, with nothing dirty (lib/unsaved-work),
 *     no modal or overlay open, no emergency active, focus not in a
 *     text field, the browser online, and a route that runs nothing
 *     live. The rules are in stale-bundle-policy.ts. They are read again
 *     immediately before the navigation (freshReload awaits the service
 *     worker and CacheStorage first), and a tab that became visible in the
 *     meantime is never reloaded.
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

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';
import { hasUnsavedWork } from '@/lib/unsaved-work';
import { useUploadActivityVisible } from '@/components/assets/UploadActivity';
import { freshReload } from './fresh-reload';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  HIDDEN_RELOAD_DELAY_MS,
  autoReloadBlocker,
  readAutoReloadState,
} from './stale-bundle-policy';

interface BuildInfo {
  sha: string | null;
  shaFull?: string | null;
}

export function StaleBundleWatcher() {
  const t = useTranslations('appUpdate');
  // The upload tray uses the same bottom slot; stack above it while it shows.
  const uploadTrayShown = useUploadActivityVisible();

  // Bake-time SHA — read once at module load. Same logic as the
  // player's drift check: NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA is auto-
  // injected by Vercel; NEXT_PUBLIC_BUILD_SHA is the in-repo
  // convention if anyone sets it explicitly.
  const mySha: string | null = (() => {
    const raw =
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
      process.env.NEXT_PUBLIC_BUILD_SHA ||
      null;
    return raw ? String(raw).slice(0, 12) : null;
  })();

  // The deployed SHA this tab is behind, and the one the operator chose
  // "Later" for. The refs mirror the state for the timer callbacks, so the
  // effect below runs once per mount and never re-arms on a state change.
  const [pendingSha, setPendingSha] = useState<string | null>(null);
  const [snoozedSha, setSnoozedSha] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const snoozedRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!mySha) return; // Local dev / self-hosted — can't compare.

    let cancelled = false;
    let checkTimer: ReturnType<typeof setTimeout> | null = null;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    let reloadArmedAt = 0;
    let lastCheckAt = 0;
    // Bumped every time the tab becomes visible. An automatic reload already
    // in flight goes ahead only if this has not moved since its timer fired.
    let visibleEpoch = 0;

    const isVisible = () => document.visibilityState === 'visible';
    const awaitingOperator = () => !!pendingRef.current && pendingRef.current !== snoozedRef.current;
    const setPending = (sha: string | null) => {
      pendingRef.current = sha;
      setPendingSha(sha);
    };

    const currentBlocker = (lateMs: number) => {
      const store = useAppStore.getState();
      return autoReloadBlocker(
        readAutoReloadState(document, window.location.pathname, {
          unsavedWork: hasUnsavedWork(),
          overlayOpenCount: store.overlayOpenCount,
          emergencyActive: store.isEmergencyActive,
          online: typeof navigator === 'undefined' || navigator.onLine !== false,
          timerLateMs: lateMs,
        }),
      );
    };

    const tryAutoReload = () => {
      reloadTimer = null;
      if (cancelled || !awaitingOperator()) return;
      const blocker = currentBlocker(Date.now() - reloadArmedAt - HIDDEN_RELOAD_DELAY_MS);
      if (blocker) {
        console.log(`[dashboard-drift] automatic reload held: ${blocker}`);
        return;
      }
      const epoch = visibleEpoch;
      const firedAt = Date.now();
      const target = pendingRef.current;
      console.log(`[dashboard-drift] tab hidden and idle — reloading onto ${target}`);
      // Asked again after each await inside freshReload and right before the
      // navigation. The elapsed time since the decision is checked like a late
      // timer: a long wait means the page was suspended and may be resuming.
      void freshReload(() => {
        if (cancelled || visibleEpoch !== epoch || pendingRef.current !== target || !awaitingOperator()) {
          console.log('[dashboard-drift] automatic reload held: tab changed while preparing');
          return false;
        }
        const late = currentBlocker(Date.now() - firedAt);
        if (late) {
          console.log(`[dashboard-drift] automatic reload held: ${late}`);
          return false;
        }
        return true;
      });
    };

    const armAutoReload = () => {
      if (reloadTimer || !awaitingOperator()) return;
      reloadArmedAt = Date.now();
      reloadTimer = setTimeout(tryAutoReload, HIDDEN_RELOAD_DELAY_MS);
    };

    const disarmAutoReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = null;
    };

    const scheduleCheck = (delayMs: number) => {
      if (checkTimer) clearTimeout(checkTimer);
      checkTimer = setTimeout(runCheck, delayMs);
    };

    const runCheck = async () => {
      checkTimer = null;
      // Never check from a hidden tab; the visibility handler resumes it.
      if (cancelled || !isVisible()) return;
      lastCheckAt = Date.now();
      try {
        const res = await fetch('/api/build-info', { cache: 'no-store' });
        if (res.ok) {
          const data: BuildInfo = await res.json();
          const serverSha = typeof data?.sha === 'string' ? data.sha : null;
          if (!cancelled && serverSha) {
            if (serverSha === mySha) {
              setPending(null);
            } else if (serverSha !== pendingRef.current) {
              console.log(`[dashboard-drift] mine=${mySha} server=${serverSha} — offering reload`);
              setPending(serverSha);
            }
          }
        }
      } catch {
        // Tolerated — the next check retries.
      }
      if (cancelled) return;
      if (isVisible()) scheduleCheck(CHECK_INTERVAL_MS);
      else armAutoReload(); // The answer landed after the tab was hidden.
    };

    const onVisibilityChange = () => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') {
        if (checkTimer) clearTimeout(checkTimer);
        checkTimer = null;
        armAutoReload();
        return;
      }
      if (!isVisible()) return;
      visibleEpoch += 1;
      disarmAutoReload();
      // Resume the same cadence: never sooner than 30 s after the tab comes
      // back, never more than one check per interval.
      const sinceLast = lastCheckAt ? Date.now() - lastCheckAt : Number.POSITIVE_INFINITY;
      scheduleCheck(Math.max(FIRST_CHECK_DELAY_MS, CHECK_INTERVAL_MS - sinceLast));
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    // First check delayed 30 s so initial page-load isn't interrupted.
    if (isVisible()) scheduleCheck(FIRST_CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (checkTimer) clearTimeout(checkTimer);
      disarmAutoReload();
    };
  }, [mySha]);

  if (!pendingSha || pendingSha === snoozedSha) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="app-update-control"
      className={`fixed z-50 left-4 md:left-auto md:right-[4.25rem] max-w-[calc(100vw-6rem)] md:max-w-sm flex items-center gap-2 rounded-full border border-indigo-200 bg-white py-1.5 pl-3 pr-1.5 shadow-lg ${
        uploadTrayShown
          ? 'bottom-[calc(8.75rem+env(safe-area-inset-bottom))] md:bottom-[5rem]'
          : 'bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-6'
      }`}
    >
      <RefreshCw className="w-3.5 h-3.5 text-indigo-600 shrink-0" aria-hidden />
      <span className="min-w-0 truncate text-[12px] font-semibold text-slate-800">{t('available')}</span>
      <Button
        type="button"
        size="sm"
        onClick={() => void freshReload()}
        className="text-[12px] font-bold text-white"
        style={{ background: 'var(--brand-primary, #4f46e5)' }}
      >
        {t('reload')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          snoozedRef.current = pendingSha;
          setSnoozedSha(pendingSha);
        }}
        className="text-[12px] font-semibold text-slate-600"
      >
        {t('later')}
      </Button>
    </div>
  );
}
