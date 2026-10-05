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
 * ENGLISH-ONLY, deliberately. The three locale catalogs are held at exact key
 * parity by a hard CI gate (`check-i18n-parity.cjs`), and shipping guessed
 * es/zh strings for a security-critical flow is worse than shipping none.
 * This surface is scoped to one US operator's provisioning run; localise it
 * alongside the rest of the auth surfaces when that work is done properly.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, KeyRound, Loader2 } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';
import { clog } from '@/lib/client-logger';
import { getClientBrand } from '@/lib/brand';
import { ensureCsrfToken } from '@/lib/csrf';

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
        if (!trimmed) next.email = 'Enter your work email address.';
        else if (!looksLikeEmail(trimmed)) next.email = 'That does not look like an email address.';
        else if (trimmed.toLowerCase() === placeholderEmail.trim().toLowerCase()) {
          next.email = 'Use your own email — this is the temporary address the account was created with.';
        }
        // Typed twice: this address receives every sign-in code and password
        // reset from now on, and a typo here strands the account (nothing
        // verifies the mailbox yet — Greg, 2026-10-05).
        if (!next.email && confirmEmail.trim().toLowerCase() !== trimmed.toLowerCase()) {
          next.confirmEmail = 'The two email addresses do not match.';
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
          next.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
        }
        if (confirm !== password) next.confirm = 'The two passwords do not match.';
        return next;
      },
    [email, confirmEmail, password, confirm, placeholderEmail],
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
        setFieldErrors({ email: 'That email is already in use. Try another, or ask your administrator.' });
        break;
      case 'SETUP_EMAIL_UNCHANGED':
        setCodeStep(false);
        setFieldErrors({ email: 'Use your own email — this is the temporary address the account was created with.' });
        break;
      case 'SETUP_NOT_REQUIRED':
        setUser(user ? { ...user, mustSetupCredentials: false } : user);
        break;
      default:
        clog.warn('auth', 'Setup email code not sent', { status: res.status, code: data?.code });
        setFormError(data?.message || 'We could not send the code. Please try again.');
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
          setFieldErrors({ email: 'That email is already in use. Try another, or ask your administrator.' });
          break;
        case 'SETUP_EMAIL_UNCHANGED':
          setCodeStep(false);
          setFieldErrors({
            email: 'Use your own email — this is the temporary address the account was created with.',
          });
          break;
        case 'SETUP_PASSWORD_UNCHANGED':
          setCodeStep(false);
          setFieldErrors({ password: 'Choose a new password — this is the starter password you were given.' });
          break;
        case 'SETUP_EMAIL_CODE_REQUIRED':
          // The server now verifies addresses (mail was just switched on):
          // send the code and show its step.
          if (!codeStep) await requestCode();
          else setCodeError('Enter the 6-digit code from the email.');
          break;
        case 'SETUP_EMAIL_CODE_INVALID':
          setCodeError("That code isn't right. Check the email and try again.");
          break;
        case 'SETUP_EMAIL_CODE_EXPIRED':
          setCodeError('That code has expired. Send a new one.');
          break;
        case 'SETUP_EMAIL_CODE_LOCKED':
          setCodeError('Too many wrong tries. Send a new code.');
          break;
        case 'ValidationError':
          // The server's Zod pipe does not say WHICH field failed, and the
          // client checks above already cover every rule it enforces — so
          // reaching here means something unusual (e.g. an over-long value).
          setFormError('Check the email and password and try again.');
          break;
        case 'SETUP_NOT_REQUIRED':
          // The account was set up elsewhere (another tab, an admin). Nothing
          // to do here — drop the stale flag and let the dashboard render.
          setUser(user ? { ...user, mustSetupCredentials: false } : user);
          break;
        default:
          clog.warn('auth', 'Credential setup rejected', { status: res.status, code: data?.code });
          setFormError(data?.message || 'We could not save that. Please try again.');
      }
    } catch {
      setFormError(`Can't reach the server at ${API_URL}. Check your connection and try again.`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (codeStep) {
      const digits = emailCode.replace(/\D/g, '');
      if (digits.length !== 6) {
        setCodeError('Enter the 6-digit code from the email.');
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
      setFormError(`Can't reach the server at ${API_URL}. Check your connection and try again.`);
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
      setFormError(`Can't reach the server at ${API_URL}. Check your connection and try again.`);
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
            Finish setting up your account
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            One time only — then you&rsquo;re into {brand.name}.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-7">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
              <KeyRound className="w-6 h-6 text-indigo-600" aria-hidden />
            </div>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed mb-5">
            This account was created for your location with a temporary email
            {placeholderEmail ? (
              <>
                {' '}(<span className="font-mono text-slate-500">{placeholderEmail}</span>)
              </>
            ) : null}{' '}
            and a starter password. Replace both with your own so password resets reach you and
            your actions are recorded under your name.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {codeStep ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-700">
                  We sent a 6-digit code to <strong className="font-semibold break-all">{sentTo}</strong>. It can take a
                  minute to arrive.
                </p>
                <div>
                  <label htmlFor="setup-email-code" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Code from the email
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
                    {resendIn > 0 ? `Send a new code (${resendIn}s)` : 'Send a new code'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCodeStep(false); setEmailCode(''); setCodeError(''); }}
                    className="font-semibold text-slate-500 hover:text-slate-700"
                  >
                    Use a different email
                  </button>
                </div>
              </div>
            ) : (
              <>
            <div>
              <label htmlFor="setup-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Your work email
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
                We send your sign-in codes and password resets here, so make sure you can open it.
              </p>
            </div>

            <div>
              <label htmlFor="setup-confirm-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Type your email again
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
                New password
              </label>
              <input
                id="setup-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
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
                Confirm new password
              </label>
              <input
                id="setup-confirm"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder="Type it again"
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
              disabled={submitting}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Saving…
                </>
              ) : (
                codeStep ? 'Verify and finish' : 'Save and continue'
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
            Not your account? Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
