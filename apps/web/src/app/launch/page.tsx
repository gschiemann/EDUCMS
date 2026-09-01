"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, CloudOff, Clock, Building2, ChevronRight, RefreshCw } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { API_URL } from '@/lib/api-url';
import { fetchWithTimeout } from '@/lib/fetch-timeout';
import { useAccessibleTenants } from '@/hooks/use-api';
import { decideLaunch, type LaunchDecision } from './launchRoute';

/**
 * M01 — Launch router.
 *
 * "Purpose: send an installed or deep-linked user to the correct
 * destination", with five named states. Before this, the manifest's
 * `start_url` was `/`, so the home-screen icon opened the MARKETING PAGE —
 * hero, pricing, "Book a demo" — to someone who has run this fleet for
 * months. M01: "Do not show the marketing homepage after launching the
 * installed application."
 *
 * The routing decision itself is pure and unit-tested (./launchRoute.ts);
 * this page owns only the network probe and the four screens a decision can
 * land on.
 *
 * ON THE HONEST OFFLINE STATE. A token we could not CHECK is not an expired
 * token. The distinction matters on a phone, where "no signal in the
 * stairwell" and "you've been signed out" look identical if you conflate
 * them — and one of those two answers wrongly sends an operator hunting for
 * a password during an incident. `unreachable` shows last-known sync time
 * and a Retry; only a server that actually answers 401 produces the expired
 * screen.
 */
export default function LaunchPage() {
  const router = useRouter();
  const params = useSearchParams();
  const token = useAppStore((s) => s.token);
  const user = useAppStore((s) => s.user);

  const [mounted, setMounted] = useState(false);
  const [verify, setVerify] = useState<'pending' | 'ok' | 'expired' | 'unreachable' | 'skipped'>('pending');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const next = params?.get('next') ?? null;

  useEffect(() => { setMounted(true); }, []);

  // Probe the session exactly once per attempt. /users/me is the endpoint
  // EVERY authenticated role can reach — the panic page learned the hard way
  // that an admin-only endpoint turns a valid contributor session into a
  // bogus "signed out".
  useEffect(() => {
    if (!mounted) return;
    if (!token) { setVerify('skipped'); return; }
    let cancelled = false;
    setVerify('pending');
    (async () => {
      try {
        const res = await fetchWithTimeout(
          `${API_URL}/users/me`,
          { headers: { Authorization: `Bearer ${token}` } },
          6000,
        );
        if (cancelled) return;
        if (res.ok) {
          setVerify('ok');
          try { window.localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString()); } catch { /* ignore */ }
        } else if (res.status === 401 || res.status === 403) {
          setVerify('expired');
        } else {
          // 5xx is the server failing, not the operator being logged out.
          setVerify('unreachable');
        }
      } catch {
        if (!cancelled) setVerify('unreachable');
      }
    })();
    return () => { cancelled = true; };
  }, [mounted, token, attempt]);

  useEffect(() => {
    try { setLastSync(window.localStorage.getItem(LAST_SYNC_KEY)); } catch { /* ignore */ }
  }, [mounted, verify]);

  const decision: LaunchDecision | null = useMemo(() => {
    if (!mounted || verify === 'pending') return null;
    return decideLaunch({
      hasToken: !!token,
      slug: user?.tenantSlug ?? null,
      verify,
      next,
    });
  }, [mounted, verify, token, user?.tenantSlug, next]);

  // Navigation happens in an effect, never during render.
  useEffect(() => {
    if (!decision) return;
    if (decision.kind === 'go') router.replace(decision.path);
    if (decision.kind === 'sign-in') {
      const q = decision.redirect ? `?redirect=${encodeURIComponent(decision.redirect)}` : '';
      router.replace(`/login${q}`);
    }
  }, [decision, router]);

  if (!decision || decision.kind === 'go' || decision.kind === 'sign-in') {
    return <Shell><Working /></Shell>;
  }

  if (decision.kind === 'expired') {
    const q = decision.redirect ? `?redirect=${encodeURIComponent(decision.redirect)}` : '';
    return (
      <Shell>
        <div data-testid="launch-expired" className="text-center">
          <Badge tone="amber"><Clock className="w-5 h-5" aria-hidden /></Badge>
          <h1 className="mt-4 text-[20px] font-black text-white">Your session has expired</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">
            For security, VenueOS signs you out after a period away. Sign in again to
            pick up where you left off.
          </p>
          <Link
            href={`/login${q}`}
            className="mt-5 inline-flex items-center justify-center w-full min-h-[48px] rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-[14px] font-bold transition-colors"
          >
            Sign in
          </Link>
        </div>
      </Shell>
    );
  }

  if (decision.kind === 'offline') {
    return (
      <Shell>
        <div data-testid="launch-offline" className="text-center">
          <Badge tone="slate"><CloudOff className="w-5 h-5" aria-hidden /></Badge>
          <h1 className="mt-4 text-[20px] font-black text-white">Can&apos;t reach VenueOS</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">
            You are still signed in — this device just can&apos;t reach the server right
            now. Nothing has been sent or changed.
          </p>
          <p className="mt-3 text-[12px] font-semibold text-slate-500">
            {lastSync ? `Last successful sync ${formatStamp(lastSync)}` : 'No successful sync recorded on this device yet'}
          </p>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-5 inline-flex items-center justify-center gap-2 w-full min-h-[48px] rounded-xl bg-white/10 hover:bg-white/15 text-white text-[14px] font-bold transition-colors"
          >
            <RefreshCw className="w-4 h-4" aria-hidden /> Try again
          </button>
          {/* An emergency must never be gated behind this screen. */}
          <Link
            href="/panic"
            className="mt-2 inline-flex items-center justify-center w-full min-h-[48px] rounded-xl text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 text-[13px] font-bold transition-colors"
          >
            Open Emergency
          </Link>
        </div>
      </Shell>
    );
  }

  return <Shell><LocationChooser /></Shell>;
}

const LAST_SYNC_KEY = 'venueos_last_sync_at';

function Working() {
  return (
    <div className="text-center" data-testid="launch-working">
      <Loader2 className="w-6 h-6 mx-auto text-indigo-300 animate-spin" aria-hidden />
      <p className="mt-3 text-[13px] font-semibold text-slate-400">Opening VenueOS…</p>
    </div>
  );
}

/**
 * M01: "Authenticated without a selected location → location chooser."
 * Sourced from the same accessible-tenants query the header switcher uses, so
 * the list can never disagree with the one inside the app.
 */
function LocationChooser() {
  const { data, isPending, isError } = useAccessibleTenants();
  const tenants = data?.tenants ?? [];

  if (isPending) return <Working />;

  if (isError || tenants.length === 0) {
    return (
      <div className="text-center" data-testid="launch-no-locations">
        <Badge tone="slate"><Building2 className="w-5 h-5" aria-hidden /></Badge>
        <h1 className="mt-4 text-[20px] font-black text-white">No location to open</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">
          Your account isn&apos;t attached to a location yet, or the list couldn&apos;t be
          loaded. An administrator can add you to one.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex items-center justify-center w-full min-h-[48px] rounded-xl bg-white/10 hover:bg-white/15 text-white text-[14px] font-bold"
        >
          Sign in as someone else
        </Link>
      </div>
    );
  }

  return (
    <div data-testid="launch-choose-location">
      <h1 className="text-[20px] font-black text-white">Choose a location</h1>
      <p className="mt-1 text-[13px] text-slate-400">Pick where you want to work today.</p>
      <div className="mt-4 space-y-2">
        {tenants.map((tn) => (
          <Link
            key={tn.id}
            href={`/${tn.slug}/dashboard`}
            className="flex items-center gap-3 min-h-[56px] px-4 rounded-xl bg-white/[0.04] ring-1 ring-white/10 hover:bg-white/[0.08] transition-colors"
          >
            <Building2 className="w-4 h-4 shrink-0 text-slate-400" aria-hidden />
            <span className="flex-1 min-w-0 text-[14px] font-bold text-white truncate">{tn.name}</span>
            <ChevronRight className="w-4 h-4 shrink-0 text-slate-500" aria-hidden />
          </Link>
        ))}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="min-h-dvh flex items-center justify-center px-6 py-[max(2rem,env(safe-area-inset-top))]"
      style={{ background: 'linear-gradient(180deg,#0b1020 0%,#070a14 100%)' }}
    >
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

function Badge({ tone, children }: { tone: 'amber' | 'slate'; children: React.ReactNode }) {
  return (
    <span
      className={
        'inline-flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ' +
        (tone === 'amber'
          ? 'bg-amber-500/15 ring-amber-400/30 text-amber-300'
          : 'bg-white/[0.06] ring-white/10 text-slate-300')
      }
    >
      {children}
    </span>
  );
}

/** "3 minutes ago" / "yesterday at 4:12 PM" — never a bare ISO string. */
function formatStamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'at an unknown time';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 0) return 'just now'; // clock skew reads as fresh, never negative
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
