import { NextResponse, type NextRequest } from 'next/server';
import { serverApiBase, verifySameOriginRequest } from '@/lib/session-bff';
import {
  PANIC_COOKIE_NAME,
  clearPanicCookies,
  isPanicRefusal,
  logPanicOutcome,
  panicForwardHeaders,
  setPanicCookies,
} from '@/lib/panic-bff';

/**
 * Panic phones (2026-11-14) — POST /api/panic/{enroll,status,targets,active,trigger,end}.
 *
 * The browser's ONLY way to use the panic credential. Same CSRF gate as the
 * session routes (custom header + same-origin `Origin`), plus SameSite=Strict
 * on the cookie. There is no all-clear here and there must never be one.
 *
 * WHAT CLEARS THE COOKIE: only the API's decision that the credential is dead
 * (401 PANIC_DEVICE_REFUSED), or the phone's own "turn off" (`end`). The kill
 * switch, a missing secret, a throttle, a 5xx or an unreachable API keep it —
 * "could not use it now" is never "it is gone".
 */
export const runtime = 'nodejs';

const ACTIONS = new Set(['enroll', 'status', 'targets', 'active', 'trigger', 'end']);
const TYPES = new Set(['hold', 'secure', 'lockdown', 'evacuate', 'weather', 'medical']);

/** The trigger body the API accepts — rebuilt key by key, never forwarded as sent. */
function triggerFields(raw: any): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || !TYPES.has(raw.type)) return null;
  const out: Record<string, unknown> = { type: raw.type };
  if (raw.isDrill === true) out.isDrill = true;
  const t = raw.target;
  if (t != null) {
    if (typeof t !== 'object' || (t.scopeType !== 'group' && t.scopeType !== 'device') || typeof t.scopeId !== 'string' || !t.scopeId || t.scopeId.length > 128) {
      return null;
    }
    out.target = { scopeType: t.scopeType, scopeId: t.scopeId };
  }
  return out;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const gate = verifySameOriginRequest(req.headers);
  if (!gate.ok) {
    logPanicOutcome(action, `forbidden-${gate.reason}`);
    return NextResponse.json({ error: 'forbidden', reason: gate.reason }, { status: 403 });
  }
  const secure = req.nextUrl.protocol === 'https:';
  const forward = panicForwardHeaders((n) => req.headers.get(n));
  const api = serverApiBase();

  // ── Mint: a signed-in page asks for this phone to be kept ready ─────────
  if (action === 'enroll') {
    const auth = req.headers.get('authorization');
    if (!auth || !/^Bearer\s+\S+/i.test(auth)) return NextResponse.json({ enrolled: false, reason: 'no-bearer' }, { status: 401 });
    let upstream: Response;
    try {
      upstream = await fetch(`${api}/panic-device/enroll`, { method: 'POST', headers: { ...forward, authorization: auth }, body: '{}' });
    } catch {
      logPanicOutcome('enroll', 'api-unreachable');
      return NextResponse.json({ enrolled: false, reason: 'unavailable' }, { status: 503 });
    }
    const body: any = await upstream.json().catch(() => null);
    if (!upstream.ok || typeof body?.credential !== 'string') {
      logPanicOutcome('enroll', 'refused', upstream.status);
      const reason = body?.reason ?? (body?.code === 'PANIC_DEVICE_DISABLED' || body?.code === 'PANIC_DEVICE_UNAVAILABLE' ? 'unavailable' : 'refused');
      return NextResponse.json({ enrolled: false, reason }, { status: upstream.ok ? 502 : upstream.status });
    }
    const res = NextResponse.json({ enrolled: true, device: body.device ?? null });
    setPanicCookies(res.cookies, secure, body.credential);
    logPanicOutcome('enroll', 'enrolled', upstream.status);
    return res;
  }

  const credential = req.cookies.get(PANIC_COOKIE_NAME)?.value;

  // ── Turn off on this phone ──────────────────────────────────────────────
  if (action === 'end') {
    if (credential) {
      try {
        await fetch(`${api}/panic-device/revoke`, { method: 'POST', headers: forward, body: JSON.stringify({ credential }) });
      } catch {
        /* the cookie is cleared regardless; an admin can still revoke the row */
      }
    }
    const res = NextResponse.json({ ended: true });
    clearPanicCookies(res.cookies, secure);
    logPanicOutcome('end', credential ? 'ended' : 'ended-no-cookie');
    return res;
  }

  if (!credential) {
    logPanicOutcome(action, 'no-cookie');
    const res = NextResponse.json({ ok: false, reason: 'no-cookie' }, { status: 401 });
    clearPanicCookies(res.cookies, secure);
    return res;
  }

  let extra: Record<string, unknown> = {};
  if (action === 'trigger') {
    const fields = triggerFields(await req.json().catch(() => null));
    if (!fields) return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
    extra = fields;
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${api}/panic-device/${action}`, {
      method: 'POST',
      headers: forward,
      body: JSON.stringify({ credential, ...extra }),
    });
  } catch {
    logPanicOutcome(action, 'api-unreachable');
    return NextResponse.json({ ok: false, reason: 'unavailable' }, { status: 503 });
  }
  const body: any = await upstream.json().catch(() => null);

  if (isPanicRefusal(upstream.status, body)) {
    logPanicOutcome(action, `refused-${body?.reason ?? 'unknown'}`, upstream.status);
    const res = NextResponse.json({ ok: false, reason: 'refused', detail: body?.reason ?? null }, { status: 401 });
    clearPanicCookies(res.cookies, secure);
    return res;
  }
  if (upstream.status === 403 && (body?.code === 'PANIC_DEVICE_DISABLED' || body?.code === 'PANIC_DEVICE_UNAVAILABLE')) {
    logPanicOutcome(action, 'unavailable', upstream.status);
    return NextResponse.json({ ok: false, reason: 'unavailable' }, { status: 403 });
  }
  if (upstream.status === 429 || upstream.status >= 500) {
    logPanicOutcome(action, 'retry', upstream.status);
    return NextResponse.json({ ok: false, reason: 'retry' }, { status: 503 });
  }
  if (!upstream.ok) {
    // The trigger's own answer (403 scope, 409 drill over a live alert, 400…):
    // passed on as-is; the credential is fine.
    logPanicOutcome(action, 'upstream-error', upstream.status);
    return NextResponse.json({ ok: false, ...(body && typeof body === 'object' ? { code: body.code, message: body.message } : {}) }, { status: upstream.status });
  }
  const res = NextResponse.json(body ?? {});
  // A good status check renews the cookie's own lifetime (see panic-bff.ts).
  if (action === 'status') setPanicCookies(res.cookies, secure, credential);
  logPanicOutcome(action, 'ok', upstream.status);
  return res;
}
