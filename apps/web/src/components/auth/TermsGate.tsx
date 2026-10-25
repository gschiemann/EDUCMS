"use client";

/**
 * TermsGate — the End User License Agreement, accepted ON THE ACCOUNT
 * (2026-10-24, launch QA S2).
 *
 * WHY. Acceptance lived only in one browser's localStorage: the API had no
 * record of who accepted which version when, a second person on the same
 * browser was never asked, and an invited teammate (accept-invite signs them
 * straight in) never saw the agreement at all. For a product that ships an
 * emergency-features disclaimer, the record has to be the server's.
 *
 * WHAT THIS DOES, after first-login setup and email verification (the layout
 * renders those first, so the person who accepts is the person who owns the
 * account):
 *   1. the account already accepted THIS version (`user.termsAcceptedVersion`)
 *      → nothing to do, nothing rendered;
 *   2. the person ticked the box on the sign-in form during THIS sign-in
 *      (parked by the login page, bound to their account id) → it is recorded
 *      quietly (`POST /users/me/terms`, method `sign-in`) — no second ask;
 *   3. the cached session does not know → one `GET /users/me` decides;
 *   4. otherwise → one short screen: read, tick, "Accept and continue".
 *
 * EMERGENCY FIRST. While an alert is active the screen steps aside: the
 * emergency overlay and its all-clear must never sit behind a terms prompt.
 * It comes back when the alert ends. Nothing here gates an API route — the
 * prompt is the dashboard's, the record is the server's.
 *
 * NEVER A LOCKOUT. It asks only once the server has shown it keeps this
 * record — the sign-in answer carried `termsAcceptedVersion`, or
 * `GET /users/me` carried `termsCurrentVersion` — and only for the version
 * that server accepts. The web and the API deploy separately: a dashboard
 * that reached customers before its API (or an unreadable answer) must never
 * put up a prompt nothing can satisfy over everyone's dashboard. In those
 * cases it stays silent and asks on a later visit.
 *
 * It renders OVER the dashboard (not instead of it, like the setup screen):
 * the account is fully set up, so the dashboard's reads all succeed behind it,
 * and the layer below it is what the person lands on after accepting.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertCircle, FileCheck2, Loader2 } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { API_URL } from '@/lib/api-url';
import { ensureCsrfToken } from '@/lib/csrf';
import { clog } from '@/lib/client-logger';
import { getClientBrand } from '@/lib/brand';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import {
  EULA_VERSION,
  clearParkedServerTermsAcceptance,
  parkedServerTermsAcceptance,
} from '@/lib/eula-acceptance';

/** `silent`: this server does not keep the record (yet), or could not say — ask later. */
type Phase = 'checking' | 'accepted' | 'prompt' | 'silent';
type RecordResult = 'ok' | 'unsupported' | 'failed';

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${useAppStore.getState().token ?? ''}`,
  };
  const csrf = await ensureCsrfToken().catch(() => null);
  if (csrf) headers['X-CSRF-Token'] = csrf;
  return headers;
}

/**
 * Record the acceptance on the account. `unsupported` = this server cannot
 * take it (no such route yet, or it shows a different version) — asking would
 * be a prompt nothing can satisfy.
 */
async function recordOnServer(method: 'sign-in' | 'prompt'): Promise<RecordResult> {
  const res = await fetch(`${API_URL}/users/me/terms`, {
    method: 'POST',
    credentials: 'include',
    headers: await authHeaders(),
    body: JSON.stringify({ version: EULA_VERSION, method }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data?.version === EULA_VERSION) return 'ok';
  clog.warn('auth', 'Terms acceptance not recorded', { status: res.status, code: data?.code });
  if (res.status === 404 || data?.code === 'TERMS_VERSION_UNKNOWN') return 'unsupported';
  return 'failed';
}

export function TermsGate() {
  const t = useTranslations('termsGate');
  const tAuth = useTranslations('auth');
  const brand = getClientBrand();
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const logout = useAppStore((s) => s.logout);
  const isEmergencyActive = useAppStore((s) => s.isEmergencyActive);

  const userId = user?.id ?? '';
  // `undefined` = the session never said (an older sign-in answer, or a blob
  // cached before this existed); `null` = the server said "never accepted".
  const known = (user as { termsAcceptedVersion?: string | null } | null)?.termsAcceptedVersion;
  const [phase, setPhase] = useState<Phase>(known === EULA_VERSION ? 'accepted' : 'checking');
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const resolvedFor = useRef<string | null>(null);

  const markAccepted = () => {
    clearParkedServerTermsAcceptance();
    const cur = useAppStore.getState().user;
    if (cur) setUser({ ...cur, termsAcceptedVersion: EULA_VERSION });
    setPhase('accepted');
  };

  // Decide once per account (steps 1–3 above).
  useEffect(() => {
    if (!userId) return;
    if (known === EULA_VERSION) {
      setPhase('accepted');
      return;
    }
    if (resolvedFor.current === userId) return;
    resolvedFor.current = userId;
    let cancelled = false;
    (async () => {
      try {
        // 2. Ticked on the sign-in form a moment ago: record it, ask nothing.
        if (parkedServerTermsAcceptance(userId)) {
          const recorded = await recordOnServer('sign-in');
          if (cancelled) return;
          if (recorded === 'ok') { markAccepted(); return; }
          if (recorded === 'unsupported') { setPhase('silent'); return; }
        }
        // 3. The cached session did not say: the server's own answer decides
        //    — and only a server that keeps this record (and shows the same
        //    version) can be asked to.
        if (known === undefined) {
          const res = await fetch(`${API_URL}/users/me`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${useAppStore.getState().token ?? ''}` },
          });
          const me = res.ok ? await res.json().catch(() => null) : null;
          if (cancelled) return;
          if (!me || me.termsCurrentVersion !== EULA_VERSION) { setPhase('silent'); return; }
          if (me.termsAcceptedVersion === EULA_VERSION) { markAccepted(); return; }
          const cur = useAppStore.getState().user;
          if (cur) setUser({ ...cur, termsAcceptedVersion: me.termsAcceptedVersion ?? null });
        }
        if (!cancelled) setPhase('prompt');
      } catch {
        // Unreadable: never a lockout — stay silent and ask on a later visit.
        if (!cancelled) setPhase('silent');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decided once per account
  }, [userId, known]);

  const showPrompt = phase === 'prompt' && !isEmergencyActive;
  useOverlayLock(showPrompt);

  const checkboxRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showPrompt) return;
    checkboxRef.current?.focus();
    // Keep Tab inside the card: the dashboard behind it is not usable yet.
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !cardRef.current) return;
      const focusables = cardRef.current.querySelectorAll<HTMLElement>(
        'input, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, [showPrompt]);

  if (!showPrompt) return null;

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!checked) {
      setError(tAuth('eulaRequired'));
      checkboxRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const recorded = await recordOnServer('prompt');
      if (recorded === 'ok') markAccepted();
      else if (recorded === 'unsupported') setPhase('silent');
      else setError(t('failed'));
    } catch {
      setError(t('failed'));
    } finally {
      setSaving(false);
    }
  };

  const eulaLink = (chunks: React.ReactNode) => (
    <Link
      href="/terms/eula"
      target="_blank"
      rel="noopener"
      className="text-indigo-600 hover:text-indigo-700 underline underline-offset-2 font-semibold"
    >
      {chunks}
    </Link>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
      data-testid="terms-gate"
      // z-[55]: above the dashboard and its tab bar, BELOW the emergency
      // overlay (z-[60]) — though while an alert is up this does not render.
      className="fixed top-0 right-0 bottom-0 left-0 z-[55] flex items-center justify-center p-4 bg-slate-900/50 overflow-y-auto"
    >
      <div ref={cardRef} className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-7">
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
            <FileCheck2 className="w-6 h-6 text-indigo-600" aria-hidden />
          </div>
        </div>
        <h2 id="terms-gate-title" className="text-center text-xl font-semibold tracking-tight text-slate-900">
          {t('title')}
        </h2>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed text-center">
          {t('intro', { brand: brand.name })}
        </p>

        <form onSubmit={accept} className="mt-6 space-y-4" noValidate>
          <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <input
              ref={checkboxRef}
              type="checkbox"
              checked={checked}
              onChange={(e) => { setChecked(e.target.checked); setError(''); }}
              aria-describedby="terms-gate-agree"
              className="mt-0.5 w-4 h-4 accent-indigo-600 shrink-0"
              data-testid="terms-gate-checkbox"
            />
            <span id="terms-gate-agree" className="text-xs leading-snug text-slate-700">
              {tAuth.rich('eulaAgree', { link: eulaLink })}
            </span>
          </label>

          {error && (
            <div role="alert" className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" aria-hidden />
              <p className="text-xs text-rose-700 font-medium">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            data-testid="terms-gate-accept"
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('saving')}
              </>
            ) : (
              t('accept')
            )}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-[11px] text-slate-500">
          <span>{t('version', { version: EULA_VERSION })}</span>
          <button
            type="button"
            onClick={() => { logout(); window.location.replace('/login'); }}
            className="font-semibold text-slate-500 hover:text-slate-700"
          >
            {t('signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}
