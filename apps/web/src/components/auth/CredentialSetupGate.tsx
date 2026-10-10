"use client";

/**
 * CredentialSetupGate — FIRST-LOGIN CREDENTIAL SETUP (2026-09-03).
 *
 * WHY IT EXISTS. A multi-location operator provisions one account per site
 * before knowing who will run it, so each is created with a PLACEHOLDER email
 * (`riot-jacksonville@riotcolor.com`) and a per-location starter password.
 * `User.mustSetupCredentials` marks such an account; the API refuses every
 * route but `/auth/complete-setup`, `/auth/logout` and `/users/me` until it is
 * cleared. This is the operator-facing half: the whole screen, in place of the
 * dashboard, until they have claimed their own email and password.
 *
 * WHY IT RENDERS *INSTEAD OF* `DashboardLayout`, not inside it. Mounting the
 * dashboard chrome would fire its data hooks (tenant status, notifications,
 * branding) — every one of which the API now 403s — so the operator would
 * watch a broken dashboard assemble itself behind a modal. Swapping at the
 * layout boundary means not one gated request is ever made.
 *
 * NO FLASH. `SchoolLayout` already gates on `mounted` and paints a plain
 * backdrop for the SSR/first-client render, and the flag arrives INSIDE the
 * login response (so it is in the store's hydrated blob before the first
 * authed render). The dashboard is therefore never painted, not even for a
 * frame, for an account in this state.
 *
 * KEYBOARD-ONLY. Native `<form>` + labelled inputs: Tab reaches every control
 * in reading order, Enter submits from any field. Focus is placed on the email
 * input on mount so a keyboard user starts on the first thing they must fill
 * in, and errors are `role="alert"` + wired to their input via
 * `aria-describedby`/`aria-invalid` so a screen reader announces them.
 *
 * en + es + zh (2026-10-10): every string lives in the `credentialSetup`
 * namespace of the three catalogs (held at key parity by
 * `check-i18n-parity.cjs`). It used to be English-only.
 *
 * FIRST SIGN-IN ORDER (2026-10-10): this screen now comes BEFORE the required
 * two-step setup. When `/auth/complete-setup` answers with the enrollment
 * envelope (no session yet), the envelope is handed to the sign-in page
 * (`lib/setup-two-step-handoff.ts`), which owns the passkey / authenticator
 * flow — so the factor is registered under the person's REAL address.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, KeyRound, Loader2 } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';
import { clog } from '@/lib/client-logger';
import { getClientBrand } from '@/lib/brand';
import { ensureCsrfToken } from '@/lib/csrf';
import { isTwoStepEnvelope, stashSetupTwoStep } from '@/lib/setup-two-step-handoff';
import { hardNavigate } from '@/lib/hard-navigate';

/** Matches the login screen's input styling exactly — same surface family. */
const INPUT_CLS =
  'w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 ' +
  'placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition';
const INPUT_ERR_CLS =
  'w-full px-3.5 py-2.5 bg-white border border-rose-300 rounded-lg text-sm text-slate-900 ' +
  'placeholder:text-slate-400 outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition';

/** The platform password floor (`validatePassword`, api-types NewPasswordString). */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Same lenient shape the API validates against — enough to catch a typo before
 * a round trip, never stricter than the server (a client that rejects an
 * address the server would accept is a lockout).
 */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type FieldErrors = { email?: string; confirmEmail?: string; password?: string; confirm?: string };

export function CredentialSetupGate() {
  const t = useTranslations('credentialSetup');
  const brand = getClientBrand();
  const user = useUIStore((s) => s.user);
  const setToken = useUIStore((s) => s.setToken);
  const setUser = useUIStore((s) => s.setUser);
  const logout = useUIStore((s) => s.logout);

  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  // Step 2 (2026-10-06): when this deploy can deliver mail, the new address is
  // proven with a 6-digit code before setup finishes.
  const [codeStep, setCodeStep] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** Saved; on the way to the sign-in page for the required two-step setup. */
  const [twoStepNext, setTwoStepNext] = useState(false);

  const emailRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    // Focus the first field a keyboard-only operator has to fill in. Done in
    // an effect rather than `autoFocus` so it runs once, after hydration, and
    // never fights the browser's own restoration on a back-navigation.
    emailRef.current?.focus();
  }, []);

  const placeholderEmail = user?.email ?? '';

  const validate = useMemo(
    () =>
      (): FieldErrors => {
        const next: FieldErrors = {};
        const trimmed = email.trim();
        if (!trimmed) next.email = t('emailRequired');
        else if (!looksLikeEmail(trimmed)) next.email = t('emailInvalid');
        else if (trimmed.toLowerCase() === placeholderEmail.trim().toLowerCase()) {
          next.email = t('emailIsPlaceholder');
        }
        // Typed twice: this address receives every sign-in code and password
        // reset from now on, and a typo here strands the account (nothing
        // verifies the mailbox yet — Greg, 2026-10-05).
        if (!next.email && confirmEmail.trim().toLowerCase() !== trimmed.toLowerCase()) {
          next.confirmEmail = t('emailMismatch');
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
          next.password = t('passwordTooShort', { min: MIN_PASSWORD_LENGTH });
        }
        if (confirm !== password) next.confirm = t('passwordMismatch');
        return next;
      },
    [email, confirmEmail, password, confirm, placeholderEmail, t],
  );

  // Deliberately raw fetches rather than `apiFetch`: these calls happen while
  // the account is gated, and apiFetch's success path schedules a silent token
  // refresh — a route the gate refuses — which would log a confusing 403 on
  // the one request that must look clean.
  const authHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${useUIStore.getState().token ?? ''}`,
    };
    const csrf = await ensureCsrfToken().catch(() => null);
    if (csrf) headers['X-CSRF-Token'] = csrf;
    return headers;
  };

  /** Ask the server to email a code to the new address. */
  const requestCode = async (): Promise<'sent' | 'not-required' | 'failed'> => {
    const address = email.trim().toLowerCase();
    const res = await fetch(`${API_URL}/auth/complete-setup/email-code`, {
      method: 'POST',
      credentials: 'include',
      headers: await authHeaders(),
      body: JSON.stringify({ email: address }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.required === false) return 'not-required';
    if (res.ok && data?.sent) {
      setSentTo(address);
      setEmailCode('');
      setCodeError('');
      setResendIn(30);
      setCodeStep(true);
      return 'sent';
    }
    switch (data?.code) {
      case 'SETUP_EMAIL_IN_USE':
        setCodeStep(false);
        setFieldErrors({ email: t('emailInUse') });
        break;
      case 'SETUP_EMAIL_UNCHANGED':
        setCodeStep(false);
        setFieldErrors({ email: t('emailIsPlaceholder') });
        break;
      case 'SETUP_NOT_REQUIRED':
        setUser(user ? { ...user, mustSetupCredentials: false } : user);
        break;
      default:
        clog.warn('auth', 'Setup email code not sent', { status: res.status, code: data?.code });
        setFormError(t('sendFailed'));
    }
    return 'failed';
  };

  /** Save the new email + password (with the emailed code when verification is on). */
  const finishSetup = async (code?: string) => {
    try {
      const res = await fetch(`${API_URL}/auth/complete-setup`, {
        method: 'POST',
        credentials: 'include',
        headers: await authHeaders(),
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          ...(code ? { emailCode: code } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));

      // FIRST SIGN-IN ORDER (2026-10-10): saved, and the account's role needs
      // two-step sign-in — there is no session until that is set up. Hand the
      // envelope to the sign-in page, which owns that flow.
      if (res.ok && isTwoStepEnvelope(data)) {
        clog.info('auth', 'Credential setup complete — two-step setup next', { sessionsRevoked: (data as { sessionsRevoked?: unknown }).sessionsRevoked });
        setTwoStepNext(true);
        const saved = (data as { email?: unknown }).email;
        const address = (typeof saved === 'string' && saved) || email.trim().toLowerCase();
        const handedOff = stashSetupTwoStep(address, data);
        logout();
        hardNavigate(handedOff ? '/login?reason=setup-two-step' : '/login?reason=setup-done');
        return;
      }
      if (res.ok && data?.signInAgain) {
        logout();
        hardNavigate('/login?reason=setup-done');
        return;
      }

      if (res.ok && data?.access_token && data?.user) {
        clog.info('auth', 'First-login credential setup complete', {
          userId: data.user.id,
          sessionsRevoked: data.sessionsRevoked,
        });
        // Order matters: the token first, so the very next request the newly
        // ungated dashboard fires already carries the replacement credential
        // (every OTHER token for this account was just revoked).
        setToken(data.access_token);
        setUser(data.user);
        return;
      }

      switch (data?.code) {
        case 'SETUP_EMAIL_IN_USE':
          setCodeStep(false);
          setFieldErrors({ email: t('emailInUse') });
          break;
        case 'SETUP_EMAIL_UNCHANGED':
          setCodeStep(false);
          setFieldErrors({ email: t('emailIsPlaceholder') });
          break;
        case 'SETUP_PASSWORD_UNCHANGED':
          setCodeStep(false);
          setFieldErrors({ password: t('passwordUnchanged') });
          break;
        case 'SETUP_EMAIL_CODE_REQUIRED':
          // The server now verifies addresses (mail was just switched on):
          // send the code and show its step.
          if (!codeStep) await requestCode();
          else setCodeError(t('codeEnter'));
          break;
        case 'SETUP_EMAIL_CODE_INVALID':
          setCodeError(t('codeWrong'));
          break;
        case 'SETUP_EMAIL_CODE_EXPIRED':
          setCodeError(t('codeExpired'));
          break;
        case 'SETUP_EMAIL_CODE_LOCKED':
          setCodeError(t('codeLocked'));
          break;
        case 'ValidationError':
          // The server's Zod pipe does not say WHICH field failed, and the
          // client checks above already cover every rule it enforces — so
          // reaching here means something unusual (e.g. an over-long value).
          setFormError(t('checkFields'));
          break;
        case 'SETUP_NOT_REQUIRED':
          // The account was set up elsewhere (another tab, an admin). Nothing
          // to do here — drop the stale flag and let the dashboard render.
          setUser(user ? { ...user, mustSetupCredentials: false } : user);
          break;
        default:
          clog.warn('auth', 'Credential setup rejected', { status: res.status, code: data?.code });
          setFormError(t('saveFailed'));
      }
    } catch {
      setFormError(t('unreachable', { url: API_URL }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (codeStep) {
      const digits = emailCode.replace(/\D/g, '');
      if (digits.length !== 6) {
        setCodeError(t('codeEnter'));
        return;
      }
      setCodeError('');
      setSubmitting(true);
      try {
        await finishSetup(digits);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const problems = validate();
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setSubmitting(true);
    try {
      const outcome = await requestCode();
      // Verification is off for this deploy: save straight away, as before.
      if (outcome === 'not-required') await finishSetup();
    } catch {
      setFormError(t('unreachable', { url: API_URL }));
    } finally {
      setSubmitting(false);
    }
  };

  const resendCode = async () => {
    setFormError('');
    setCodeError('');
    setSubmitting(true);
    try {
      await requestCode();
    } catch {
      setFormError(t('unreachable', { url: API_URL }));
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  useEffect(() => {
    if (codeStep) codeRef.current?.focus();
  }, [codeStep]);

  const describedBy = (field: keyof FieldErrors) =>
    fieldErrors[field] ? `setup-${field}-error` : undefined;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafbfc] px-4 py-10">
      <div className="w-full max-w-sm">
        {/* brand — same lockup as the login screen */}
        <div className="text-center mb-7">
          <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden className="mx-auto">
            <polygon points="30,16 23,28.12 9,28.12 2,16 9,3.88 23,3.88" fill="#4f46e5" />
            <polygon points="22,16 19,21.2 13,21.2 10,16 13,10.8 19,10.8" fill="#a5b4fc" />
          </svg>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('subtitle', { brand: brand.name })}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-7">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
              <KeyRound className="w-6 h-6 text-indigo-600" aria-hidden />
            </div>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed mb-5">
            {t('intro')}
          </p>
          {placeholderEmail && (
            <p className="-mt-3 mb-5 text-xs text-slate-500">
              {t('temporaryEmailLabel')}{' '}
              <span className="font-mono text-slate-500 break-all">{placeholderEmail}</span>
            </p>
          )}

          {twoStepNext && (
            <p role="status" className="mb-4 text-xs font-medium text-indigo-700">
              {t('twoStepNext')}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {codeStep ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-700">
                  {t('codeSentLead')} <strong className="font-semibold break-all">{sentTo}</strong>
                  <br />
                  {t('codeSentHint')}
                </p>
                <div>
                  <label htmlFor="setup-email-code" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {t('codeLabel')}
                  </label>
                  <input
                    id="setup-email-code"
                    ref={codeRef}
                    name="email-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    placeholder="123456"
                    className={codeError ? INPUT_ERR_CLS : INPUT_CLS}
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value)}
                    aria-invalid={codeError ? true : undefined}
                    aria-describedby={codeError ? 'setup-email-code-error' : undefined}
                  />
                  {codeError && (
                    <p id="setup-email-code-error" role="alert" className="mt-1.5 text-xs text-rose-700 font-medium">
                      {codeError}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={resendCode}
                    disabled={submitting || resendIn > 0}
                    className="font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {resendIn > 0 ? t('resendIn', { seconds: resendIn }) : t('resend')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCodeStep(false); setEmailCode(''); setCodeError(''); }}
                    className="font-semibold text-slate-500 hover:text-slate-700"
                  >
                    {t('differentEmail')}
                  </button>
                </div>
              </div>
            ) : (
              <>
            <div>
              <label htmlFor="setup-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t('emailLabel')}
              </label>
              <input
                id="setup-email"
                ref={emailRef}
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@yourcompany.com"
                className={fieldErrors.email ? INPUT_ERR_CLS : INPUT_CLS}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={fieldErrors.email ? true : undefined}
                aria-describedby={describedBy('email')}
              />
              {fieldErrors.email && (
                <p id="setup-email-error" role="alert" className="mt-1.5 text-xs text-rose-700 font-medium">
                  {fieldErrors.email}
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-slate-500">
                {t('emailHelp')}
              </p>
            </div>

            <div>
              <label htmlFor="setup-confirm-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t('confirmEmailLabel')}
              </label>
              <input
                id="setup-confirm-email"
                name="confirm-email"
                type="email"
                autoComplete="off"
                className={fieldErrors.confirmEmail ? INPUT_ERR_CLS : INPUT_CLS}
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                aria-invalid={fieldErrors.confirmEmail ? true : undefined}
                aria-describedby={describedBy('confirmEmail')}
              />
              {fieldErrors.confirmEmail && (
                <p id="setup-confirmEmail-error" role="alert" className="mt-1.5 text-xs text-rose-700 font-medium">
                  {fieldErrors.confirmEmail}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="setup-password" className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t('passwordLabel')}
              </label>
              <input
                id="setup-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                placeholder={t('passwordPlaceholder', { min: MIN_PASSWORD_LENGTH })}
                className={fieldErrors.password ? INPUT_ERR_CLS : INPUT_CLS}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={fieldErrors.password ? true : undefined}
                aria-describedby={describedBy('password')}
              />
              {fieldErrors.password && (
                <p id="setup-password-error" role="alert" className="mt-1.5 text-xs text-rose-700 font-medium">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="setup-confirm" className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t('confirmLabel')}
              </label>
              <input
                id="setup-confirm"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder={t('confirmPlaceholder')}
                className={fieldErrors.confirm ? INPUT_ERR_CLS : INPUT_CLS}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={fieldErrors.confirm ? true : undefined}
                aria-describedby={describedBy('confirm')}
              />
              {fieldErrors.confirm && (
                <p id="setup-confirm-error" role="alert" className="mt-1.5 text-xs text-rose-700 font-medium">
                  {fieldErrors.confirm}
                </p>
              )}
            </div>

              </>
            )}

            {formError && (
              <div role="alert" className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" aria-hidden />
                <p className="text-xs text-rose-700 font-medium">{formError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || twoStepNext}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('saving')}
                </>
              ) : (
                codeStep ? t('verifyFinish') : t('saveContinue')
              )}
            </button>
          </form>
        </div>

        {/* An operator handed the wrong starter credential must not be trapped
            here. `AuthExpirationGuard` lives inside `DashboardLayout`, which is
            deliberately NOT mounted behind this gate, so nothing would react to
            the store clearing — hence the explicit hard navigation, the same
            pattern the Sidebar / TopToolbar sign-out buttons use. */}
        <div className="text-center mt-5">
          <button
            type="button"
            onClick={() => {
              logout();
              window.location.replace('/login');
            }}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700"
          >
            {t('notYou')}
          </button>
        </div>
      </div>
    </div>
  );
}
