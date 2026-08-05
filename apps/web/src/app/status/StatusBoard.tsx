'use client';

/**
 * StatusBoard — live component grid for /status.
 *
 * Reads the public, unauthenticated, @SkipThrottle health endpoints:
 *   GET /health                → API + db + redis (always HTTP 200; truth in body)
 *   GET /health/emergency-path → db + redis + ws_signer (503 when the chain is broken)
 *   GET /health/storage        → upload transport probe (503 when down)
 *
 * Polls every 60s, and ONLY while the tab is visible (mobile perf standard:
 * never poll a backgrounded tab) — refreshes immediately on return.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '@/lib/api-url';

type Tone = 'ok' | 'degraded' | 'down' | 'unknown';

interface ComponentStatus {
  name: string;
  detail: string;
  tone: Tone;
}

const TONE_STYLES: Record<Tone, { dot: string; label: string; text: string }> = {
  ok: { dot: 'bg-emerald-500', label: 'Operational', text: 'text-emerald-600' },
  degraded: { dot: 'bg-amber-500', label: 'Degraded', text: 'text-amber-600' },
  down: { dot: 'bg-red-500', label: 'Outage', text: 'text-red-600' },
  unknown: { dot: 'bg-slate-300', label: 'Checking…', text: 'text-slate-400' },
};

async function fetchJson(path: string): Promise<{ httpOk: boolean; body: any } | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
    // 503 bodies carry the same JSON report — parse regardless of status.
    const body = await res.json().catch(() => null);
    return { httpOk: res.ok, body };
  } catch {
    return null; // network-level failure: API unreachable
  }
}

interface Snapshot {
  components: ComponentStatus[];
  version?: string;
  checkedAt: Date;
}

async function takeSnapshot(): Promise<Snapshot> {
  const [live, emergency, storage] = await Promise.all([
    fetchJson('/health'),
    fetchJson('/health/emergency-path'),
    fetchJson('/health/storage'),
  ]);

  const components: ComponentStatus[] = [];

  // Web dashboard — this page rendering IS the check (served by a separate
  // deploy surface than the API).
  components.push({ name: 'Web dashboard', detail: 'You are looking at it', tone: 'ok' });

  // API
  if (!live) {
    components.push({ name: 'API', detail: 'Unreachable', tone: 'down' });
  } else {
    components.push({ name: 'API', detail: 'Serving requests', tone: 'ok' });
  }

  // Database
  const db = live?.body?.db;
  components.push(
    !live
      ? { name: 'Database', detail: 'Unknown — API unreachable', tone: 'unknown' }
      : db === 'ok'
        ? { name: 'Database', detail: 'Queries healthy', tone: 'ok' }
        : { name: 'Database', detail: 'Not responding to queries', tone: 'down' },
  );

  // Realtime delivery — 'fallback'/'off' is a designed mode: screens poll
  // instead of receiving pushes. Honest amber, not red.
  const redis = live?.body?.redis;
  components.push(
    !live
      ? { name: 'Realtime delivery', detail: 'Unknown — API unreachable', tone: 'unknown' }
      : redis === 'ok'
        ? { name: 'Realtime delivery', detail: 'Instant push active', tone: 'ok' }
        : { name: 'Realtime delivery', detail: 'Polling fallback — updates within ~30s', tone: 'degraded' },
  );

  // Emergency alert path — the life-safety chain (DB + signing).
  components.push(
    !emergency
      ? { name: 'Emergency alert path', detail: 'Unknown — API unreachable', tone: 'unknown' }
      : emergency.httpOk
        ? { name: 'Emergency alert path', detail: 'Trigger chain verified', tone: 'ok' }
        : { name: 'Emergency alert path', detail: 'Trigger chain check failing', tone: 'down' },
  );

  // File storage
  const transport = storage?.body?.storage?.transport;
  components.push(
    !storage
      ? { name: 'File uploads & storage', detail: 'Unknown — API unreachable', tone: 'unknown' }
      : storage.httpOk && transport === 'primary'
        ? { name: 'File uploads & storage', detail: 'Uploads healthy', tone: 'ok' }
        : storage.httpOk
          ? { name: 'File uploads & storage', detail: 'Working via backup transport', tone: 'degraded' }
          : { name: 'File uploads & storage', detail: 'Uploads failing', tone: 'down' },
  );

  return {
    components,
    version: typeof live?.body?.version === 'string' ? live.body.version.slice(0, 7) : undefined,
    checkedAt: new Date(),
  };
}

function overallTone(components: ComponentStatus[]): Tone {
  if (components.some((c) => c.tone === 'down')) return 'down';
  if (components.some((c) => c.tone === 'degraded')) return 'degraded';
  if (components.some((c) => c.tone === 'unknown')) return 'unknown';
  return 'ok';
}

const OVERALL_COPY: Record<Tone, string> = {
  ok: 'All systems operational',
  degraded: 'Partial degradation — service continues',
  down: 'Service disruption',
  unknown: 'Checking systems…',
};

export function StatusBoard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      setSnapshot(await takeSnapshot());
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const components: ComponentStatus[] =
    snapshot?.components ??
    [
      'Web dashboard',
      'API',
      'Database',
      'Realtime delivery',
      'Emergency alert path',
      'File uploads & storage',
    ].map((name) => ({ name, detail: 'Checking…', tone: 'unknown' as Tone }));

  const overall = snapshot ? overallTone(snapshot.components) : 'unknown';
  const overallStyle = TONE_STYLES[overall];

  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">System status</h1>
      <p className="mt-2 text-slate-500 text-sm">
        Live health of the VenueOS platform, checked directly from your browser. Auto-refreshes every minute.
      </p>

      <div
        className={`mt-8 rounded-xl border px-5 py-4 flex items-center gap-3 ${
          overall === 'ok'
            ? 'border-emerald-200 bg-emerald-50'
            : overall === 'degraded'
              ? 'border-amber-200 bg-amber-50'
              : overall === 'down'
                ? 'border-red-200 bg-red-50'
                : 'border-slate-200 bg-slate-50'
        }`}
      >
        <span className={`h-3 w-3 rounded-full ${overallStyle.dot}`} aria-hidden />
        <span className="font-semibold">{OVERALL_COPY[overall]}</span>
      </div>

      <ul className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {components.map((c) => {
          const s = TONE_STYLES[c.tone];
          return (
            <li key={c.name} className="flex items-center justify-between px-5 py-4">
              <div>
                <div className="font-medium text-slate-900">{c.name}</div>
                <div className="text-sm text-slate-500">{c.detail}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} aria-hidden />
                <span className={`text-sm font-medium ${s.text}`}>{s.label}</span>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs text-slate-400">
        {snapshot
          ? `Last checked ${snapshot.checkedAt.toLocaleTimeString()}${snapshot.version ? ` · API build ${snapshot.version}` : ''}`
          : 'Running first check…'}
        {' · '}Emergency alerts also have an offline-capable path on every screen — see{' '}
        <a href="/help" className="underline hover:text-slate-600">
          Help
        </a>{' '}
        for details.
      </p>
    </main>
  );
}
