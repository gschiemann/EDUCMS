/**
 * Keep-warm pinger for the Railway API.
 *
 * Railway's free tier will not sleep a running service, but cold-started
 * Postgres connections, Supabase pgbouncer, and the Next.js → Railway
 * DNS edge can still give the first request of the day a ~5–10s latency.
 * Pinging /health every 4 minutes keeps the DB pool warm and surfaces
 * outages in the Vercel deployment logs.
 *
 * Scheduled by vercel.json (crons section). Vercel cron is free on the
 * Hobby tier (2 daily executions per schedule is not enough, but the
 * `* /4 * * * *` equivalent `* /4 * * * *` under the Hobby cap is — see
 * vercel.json comment for the actual expression).
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Optional auth for the cron endpoint — Vercel automatically adds
  // the CRON_SECRET header to scheduled invocations when the env var is set.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get('authorization');
    if (header !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL;
  if (!apiUrl) {
    return NextResponse.json(
      { ok: false, error: 'NEXT_PUBLIC_API_URL not configured' },
      { status: 500 },
    );
  }

  const target = `${apiUrl.replace(/\/$/, '')}/health`;
  const started = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    const res = await fetch(target, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    }).finally(() => clearTimeout(timer));

    const body = await res.json().catch(() => ({}));
    const elapsedMs = Date.now() - started;

    return NextResponse.json({
      ok: res.ok,
      target,
      status: res.status,
      elapsedMs,
      upstream: body,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        target,
        elapsedMs: Date.now() - started,
        error: (err as Error).message,
        ts: new Date().toISOString(),
      },
      { status: 502 },
    );
  }
}
