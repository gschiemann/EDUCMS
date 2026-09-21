// TODO(a11y): Sprint 2 — replace autoFocus on email input with useEffect-based focus management.
/* eslint-disable jsx-a11y/no-autofocus */
"use client";

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, AlertCircle, KeyRound, ShieldCheck, ArrowLeft, Fingerprint } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_URL, warnIfMisconfigured, isLikelyMisconfigured } from '@/lib/api-url';
import { clog } from '@/lib/client-logger';
import { getClientBrand } from '@/lib/brand';
import { useTranslations } from 'next-intl';
import { LanguageSwitcherInline } from '@/components/layout/LanguageMenu';
import { adoptRememberedSession } from '@/lib/session-client';
import { describePasskeyError, getPasskey, passkeysSupported } from '@/lib/passkeys';

const INPUT_CLS =
  'w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 ' +
  'placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[#fafbfc]"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const t = useTranslations('auth');
  // Root-scoped translator for the shared `passkeys.*` copy — `describe
  // PasskeyError` returns a full key path because the same sentences are
  // rendered by Settings → Security, which is not under `auth`.
  const tRoot = useTranslations();
  // 2026-05-05 — operator: "the login screen still says k-12 when
  // entering your credentials" + "lets change the default to Venue
  // OS right?". Pulls brand identity from getClientBrand() so the
  // h1 + tagline match whatever brand the deploy is configured for
  // (default VenueOS; EDU CMS only when NEXT_PUBLIC_CMS_BRAND=educms
  // is explicitly set).
  const brand = getClientBrand();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const login = useUIStore((state) => state.login);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect');
  const authReason = searchParams.get('reason'); // 'session-expired' | 'explicit-logout'
  const [rememberMe, setRememberMe] = useState(false);
  // EULA v1.0 acceptance. Persisted per-browser in localStorage so a
  // returning user isn't asked again on every login; the version is
  // part of the key so bumping the EULA forces re-acceptance.
  const EULA_VERSION = '1.0';
  const EULA_KEY = `edu_cms_eula_accepted_v${EULA_VERSION}`;
  const [eulaAccepted, setEulaAccepted] = useState(false);
  // Rehydrate on mount so users who've accepted previously don't see
  // the checkbox block the button. We still SHOW the checkbox (pre-
  // checked) so it's never silently auto-accepted on a shared device.
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(EULA_KEY) === 'yes') {
        setEulaAccepted(true);
      }
    } catch { /* localStorage unavailable */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [ssoOpen, setSsoOpen] = useState(false);
  const [ssoSlug, setSsoSlug] = useState('');
  const [ssoChecking, setSsoChecking] = useState(false);

  // ── MFA challenge step ──────────────────────────────────────────
  // When /auth/login responds { mfaRequired: true, mfaToken }, the
  // password was correct but the account has TOTP enabled. We hold the
  // short-lived mfaToken and render a second step: the user enters a
  // 6-digit code (or a backup code) which we trade — together with the
  // mfaToken — at POST /auth/mfa/challenge for the real session.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);

  // ── Passkeys (2026-09-21) ───────────────────────────────────────────
  // Operator: "im sick of the damn auth app". Two entry points on this page:
  // a passkey as the SECOND factor (when the login response says the account
  // has one) and passwordless sign-in from the form below.
  //
  // `mfaMethods` comes from the login response. An API that predates passkeys
  // omits it entirely, and the ONLY safe reading of "absent" is the behaviour
  // that already shipped — a TOTP-only challenge step, byte-for-byte.
  const [mfaMethods, setMfaMethods] = useState<string[]>(['totp']);
  // Capability is resolved AFTER mount, never during render: reading a browser
  // API inline makes the SSR'd HTML disagree with the first client paint, and
  // a hydration mismatch here would take the whole sign-in form with it.
  const [passkeyCapable, setPasskeyCapable] = useState(false);
  useEffect(() => { setPasskeyCapable(passkeysSupported()); }, []);
  // On the passkey-capable challenge step the code form starts CLOSED — the
  // passkey button is the primary control and the code is the alternative.
  const [codeFormOpen, setCodeFormOpen] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const passkeyStepBtnRef = useRef<HTMLButtonElement>(null);

  /** Show the passkey button on the challenge step? */
  const passkeyStepAvailable = mfaMethods.includes('passkey') && passkeyCapable;
  /** Is the 6-digit code still an option for this account? */
  const totpStepAvailable = mfaMethods.includes('totp');

  // Focus the step's PRIMARY control when the passkey challenge opens. The
  // TOTP input carries autoFocus for the same reason; when the passkey button
  // is primary the focus has to follow it or a keyboard operator lands at the
  // top of the document with no idea what changed.
  useEffect(() => {
    if (mfaToken && passkeyStepAvailable && !codeFormOpen) {
      passkeyStepBtnRef.current?.focus();
    }
  }, [mfaToken, passkeyStepAvailable, codeFormOpen]);

  // ── ACC-03: FORCED ENROLLMENT step ──────────────────────────────
  // When /auth/login responds { mfaRequired, mfaEnrollmentRequired, mfaToken }
  // the password was correct but an admin has REQUIRED two-factor on this
  // account and the user has never enrolled. They cannot use the normal
  // Settings → Security card to fix it, because that needs the session the
  // policy is withholding. Without the branch below, setting the flag is a
  // LOCKOUT with no path forward — which is precisely the bug this prevents.
  //
  // The API's /auth/mfa/required/enroll + /required/verify exist for this and
  // are authorized by the partial mfaToken itself. /required/verify returns
  // the real session AND the one-time backup codes, so this step ends on a
  // "write these down" screen before we complete the sign-in.
  const [enrollRequired, setEnrollRequired] = useState(false);
  const [enrollSecret, setEnrollSecret] = useState<{ secret: string; otpauthUrl: string; label: string } | null>(null);
  const [enrollQr, setEnrollQr] = useState<string | null>(null);
  const [pendingBackupCodes, setPendingBackupCodes] = useState<string[] | null>(null);
  const [pendingSession, setPendingSession] = useState<any>(null);

  // Render the otpauth URL into a QR the moment the provisional secret
  // arrives. `qrcode` is imported lazily so the login bundle — the first
  // thing every user downloads — does not carry it for the 99% of sign-ins
  // that never reach this step.
  useEffect(() => {
    let cancelled = false;
    if (!enrollSecret?.otpauthUrl) { setEnrollQr(null); return; }
    import('qrcode')
      .then((m) => m.toDataURL(enrollSecret.otpauthUrl, { width: 200, margin: 1 }))
      .then((url) => { if (!cancelled) setEnrollQr(url); })
      // No QR is survivable — the manual key below it is always shown.
      .catch(() => { if (!cancelled) setEnrollQr(null); });
    return () => { cancelled = true; };
  }, [enrollSecret?.otpauthUrl]);

  // Shared post-login completion — used by BOTH the normal password path
  // and the MFA challenge path so EULA persistence + the cross-tenant-safe
  // redirect logic live in exactly one place.
  const completeLogin = (data: any) => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(EULA_KEY, 'yes');
        window.localStorage.setItem(`${EULA_KEY}_at`, new Date().toISOString());
        window.localStorage.setItem(`${EULA_KEY}_by`, email);
      }
    } catch { /* best-effort */ }
    clog.info('auth', 'EULA accepted', { version: EULA_VERSION, userId: data.user?.id });
    // Pass the "Keep me logged in" choice. The store keeps the ACCESS token
    // per-tab only (it is <= 1h now); durability comes from the step below.
    login(data.access_token, data.user, rememberMe);
    // SEC-010 (2026-09-05) — trade the fresh access token for an HttpOnly,
    // first-party, single-use refresh cookie on THIS origin. That cookie is
    // what makes "Keep me logged in" survive closing the app, and page
    // JavaScript can never read it — which is the finding this closes ("the
    // remembered bearer remains JS-readable for up to 30 days").
    //
    // Deliberately NOT awaited: the redirect below must not wait on a network
    // call, and a failure here is survivable by design — the operator stays
    // signed in on the short session they already have. It runs from this one
    // function so BOTH the password path and the MFA path get it.
    if (rememberMe && data.access_token) {
      void adoptRememberedSession(data.access_token);
    }
    // 2026-05-03 — cross-tenant bleed fix. Only honor `redirectTarget`
    // if it points within the authenticated user's own tenant slug;
    // otherwise hard-redirect to their home dashboard.
    const userSlug = data.user.tenantSlug || data.user.tenantId;
    const homeUrl = `/${userSlug}/dashboard`;
    // Known-safe GLOBAL routes: not tenant-slug-prefixed, but safe post-login
    // destinations because they re-resolve the caller's own context (no
    // cross-tenant data). EXACT match only — '/panic' is allowed, '/panic-x'
    // or '/panic?next=//evil' are not — so the 2026-05-03 open-redirect /
    // cross-tenant-bleed guard still holds. /panic is life-safety: re-login
    // mid-emergency must land back on the trigger page, not the dashboard
    // (2026-06-09 Fable mobile audit — login was dropping ?redirect=/panic).
    const SAFE_GLOBAL_REDIRECTS = ['/panic'];
    const safeRedirect =
      redirectTarget &&
      (redirectTarget === '/' ||
        SAFE_GLOBAL_REDIRECTS.includes(redirectTarget) ||
        redirectTarget.startsWith(`/${userSlug}/`) ||
        redirectTarget.startsWith(`/${userSlug}?`))
        ? redirectTarget
        : homeUrl;
    router.push(safeRedirect);
  };

  /**
   * The ONE place a /auth/login-shaped response becomes the next screen.
   *
   * Extracted 2026-09-21 so passwordless passkey sign-in takes the exact same
   * branches as the password path. `POST /auth/passkeys/login/verify` returns
   * the SAME envelope as a successful password login — which means it can
   * legitimately still be another step (a second factor, or forced MFA
   * enrollment). Assuming "a passkey verified, therefore a session" is how a
   * policy-gated account ends up half-signed-in with no path forward.
   */
  const applyLoginResponse = async (
    res: { ok: boolean; status: number },
    data: any,
    source: 'password' | 'passkey',
    fallbackError: string,
  ) => {
    if (res.ok && data?.mfaRequired && data?.mfaToken) {
      // Credential was accepted, but a second factor is owed. Hold the
      // short-lived challenge token and render the second step. EULA
      // persistence is deferred to completeLogin() so it only records on a
      // FULLY successful sign-in.
      setMfaToken(data.mfaToken);
      setMfaCode('');
      setUseBackupCode(false);
      // Absent ⇒ ['totp'] — an older API can never be read as "this account
      // has a passkey", only as the shape that already shipped.
      const methods: string[] = Array.isArray(data.mfaMethods) && data.mfaMethods.length
        ? data.mfaMethods
        : ['totp'];
      setMfaMethods(methods);
      // The code form opens immediately UNLESS a passkey is on offer, in
      // which case the passkey button is the primary control.
      setCodeFormOpen(!(methods.includes('passkey') && passkeyCapable));

      if (data.mfaEnrollmentRequired) {
        // ACC-03 — an admin REQUIRED 2FA and this user has never enrolled.
        // They cannot reach Settings → Security (that needs the session the
        // policy is withholding), so enrollment happens right here. Without
        // this branch the flag is a lockout with no path forward.
        clog.info('auth', 'MFA enrollment required — starting setup', { email, source });
        setEnrollRequired(true);
        setEnrollSecret(null);
        await startRequiredEnrollment(data.mfaToken);
      } else {
        clog.info('auth', 'MFA required — showing challenge step', { email, source });
        setEnrollRequired(false);
      }
      return;
    }
    if (res.ok && data?.access_token) {
      // Persist EULA acceptance + redirect via the shared completion helper.
      completeLogin(data);
      return;
    }
    clog.warn('auth', 'Login rejected', { status: res.status, message: data?.message, source });
    setError(data?.message || fallbackError);
  };

  const handleMfaChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    const trimmed = mfaCode.trim();
    if (!trimmed) {
      setError(useBackupCode ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your authenticator app.');
      return;
    }
    setError('');
    setMfaSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/mfa/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          useBackupCode
            ? { mfaToken, backupCode: trimmed }
            : { mfaToken, code: trimmed },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.access_token) {
        completeLogin(data);
        return;
      }
      // MFA_TOKEN_INVALID → the partial token expired; send them back to
      // the start. Otherwise surface the specific code-mismatch message.
      if (data?.code === 'MFA_TOKEN_INVALID') {
        setMfaToken(null);
        setMfaCode('');
        setUseBackupCode(false);
        setError('Your sign-in attempt timed out. Please enter your password again.');
      } else {
        clog.warn('auth', 'MFA challenge rejected', { status: res.status, code: data?.code });
        setError(data?.message || 'That code did not match. Please try again.');
      }
    } catch {
      setError("Can't reach the server to verify your code. Try again in a moment.");
    } finally {
      setMfaSubmitting(false);
    }
  };

  const cancelMfa = () => {
    setMfaToken(null);
    setMfaCode('');
    setUseBackupCode(false);
    setEnrollRequired(false);
    setEnrollSecret(null);
    setPendingBackupCodes(null);
    setPendingSession(null);
    setMfaMethods(['totp']);
    setCodeFormOpen(false);
    setError('');
  };

  /**
   * Shared error handling for both passkey ceremonies.
   *
   * A dismissed Face ID / Windows Hello sheet is a DECISION, not a failure:
   * it leaves no message at all and puts the operator back on the button.
   * Painting a red banner there teaches people to ignore the error area that
   * real problems use.
   */
  const reportPasskeyCeremonyError = (err: unknown): void => {
    const described = describePasskeyError(err, 'get');
    if (described.quiet) { setError(''); return; }
    setError(tRoot(described.messageKey as string));
  };

  /** Map a REJECTED passkey HTTP response to copy. */
  const passkeyHttpError = (status: number, data: any): string => {
    // 429 keeps this page's existing behaviour — prefer whatever the server
    // says, because the rate limiter is the thing that knows the window.
    if (status === 429) return data?.message || t('passkeyTooMany');
    if (status === 401) return t('passkeyRejected');
    return data?.message || t('passkeyRejected');
  };

  /**
   * SECOND FACTOR — trade the partial mfaToken + an assertion for the session.
   *
   * Deliberately NOT auto-invoked when the step opens: Safari requires a user
   * gesture for `navigator.credentials.get()`, and the activation from the
   * password submit has already been spent by the time the response lands.
   * One tap IS the design, not a missing nicety.
   */
  const handlePasskeyChallenge = async () => {
    if (!mfaToken) return;
    setError('');
    setPasskeyBusy(true);
    try {
      const optRes = await fetch(`${API_URL}/auth/mfa/challenge/passkey/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken }),
      });
      const optData = await optRes.json().catch(() => ({}));
      if (!optRes.ok || !optData?.options) {
        if (optData?.code === 'MFA_TOKEN_INVALID') {
          cancelMfa();
          setError(t('mfaSetupTimedOut'));
          return;
        }
        setError(passkeyHttpError(optRes.status, optData));
        return;
      }

      let assertion;
      try {
        assertion = await getPasskey(optData.options);
      } catch (ceremonyErr) {
        reportPasskeyCeremonyError(ceremonyErr);
        return;
      }

      const res = await fetch(`${API_URL}/auth/mfa/challenge/passkey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken, response: assertion }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.access_token) {
        completeLogin(data);
        return;
      }
      if (data?.code === 'MFA_TOKEN_INVALID') {
        cancelMfa();
        setError(t('mfaSetupTimedOut'));
        return;
      }
      clog.warn('auth', 'Passkey challenge rejected', { status: res.status, code: data?.code });
      setError(passkeyHttpError(res.status, data));
    } catch {
      setError(t('mfaVerifyUnreachable'));
    } finally {
      setPasskeyBusy(false);
    }
  };

  /**
   * PASSWORDLESS — no email, no password, just the authenticator.
   *
   * Honours the SAME gates the password path does: the EULA checkbox (same
   * message — a second way in must not be a way around the agreement) and
   * "Keep me logged in". The verify response is fed through
   * applyLoginResponse, because it can still be a second step.
   */
  const handlePasswordlessPasskey = async () => {
    if (!eulaAccepted) {
      setError('You must accept the End User License Agreement to continue.');
      return;
    }
    setError('');
    setPasskeyBusy(true);
    warnIfMisconfigured();
    clog.info('auth', 'Passwordless passkey attempt', { rememberMe, redirectTarget });
    try {
      const optRes = await fetch(`${API_URL}/auth/passkeys/login/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const optData = await optRes.json().catch(() => ({}));
      if (!optRes.ok || !optData?.options) {
        setError(passkeyHttpError(optRes.status, optData));
        return;
      }

      let assertion;
      try {
        assertion = await getPasskey(optData.options);
      } catch (ceremonyErr) {
        reportPasskeyCeremonyError(ceremonyErr);
        return;
      }

      const res = await fetch(`${API_URL}/auth/passkeys/login/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: optData.challengeId, response: assertion, rememberMe }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        clog.warn('auth', 'Passkey sign-in rejected', { status: res.status, code: data?.code });
        setError(passkeyHttpError(res.status, data));
        return;
      }
      await applyLoginResponse(res, data, 'passkey', t('passkeyRejected'));
    } catch {
      if (isLikelyMisconfigured()) {
        setError(
          "Can't reach the server. This deployment is missing NEXT_PUBLIC_API_URL — " +
            'ask your administrator to set it in Vercel (it should point to the Railway API + /api/v1).'
        );
      } else {
        setError(`Can't reach the server at ${API_URL}. If this keeps happening, contact your administrator.`);
      }
    } finally {
      setPasskeyBusy(false);
    }
  };

  /**
   * ACC-03 — start forced enrollment. Trades the partial mfaToken for a
   * provisional TOTP secret. Safe to re-run: the endpoint issues a fresh
   * secret and clears any half-finished one, and the account is not enrolled
   * until /required/verify succeeds.
   */
  const startRequiredEnrollment = async (token: string) => {
    setError('');
    setMfaSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/mfa/required/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken: token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.secret && data?.otpauthUrl) {
        setEnrollSecret({ secret: data.secret, otpauthUrl: data.otpauthUrl, label: data.label || email });
        return;
      }
      if (data?.code === 'MFA_TOKEN_INVALID') {
        cancelMfa();
        setError(t('mfaSetupTimedOut'));
        return;
      }
      clog.warn('auth', 'Required-MFA enroll rejected', { status: res.status, code: data?.code });
      setError(data?.message || t('mfaSetupFailed'));
    } catch {
      setError(t('mfaSetupUnreachable'));
    } finally {
      setMfaSubmitting(false);
    }
  };

  /**
   * ACC-03 — confirm the provisional secret and COMPLETE the held-back login.
   * The response is the real session envelope plus 10 one-time backup codes,
   * which are shown ONCE — so we park the session and render the codes first
   * rather than redirecting straight past them.
   */
  const handleRequiredVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    const trimmed = mfaCode.trim();
    if (!trimmed) {
      setError(t('mfaEnterCodeToFinish'));
      return;
    }
    setError('');
    setMfaSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/mfa/required/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken, code: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.access_token) {
        if (Array.isArray(data.backupCodes) && data.backupCodes.length) {
          setPendingSession(data);
          setPendingBackupCodes(data.backupCodes);
        } else {
          completeLogin(data);
        }
        return;
      }
      if (data?.code === 'MFA_TOKEN_INVALID') {
        cancelMfa();
        setError(t('mfaSetupTimedOut'));
        return;
      }
      clog.warn('auth', 'Required-MFA verify rejected', { status: res.status, code: data?.code });
      setError(data?.message || t('mfaCodeMismatch'));
    } catch {
      setError(t('mfaVerifyUnreachable'));
    } finally {
      setMfaSubmitting(false);
    }
  };

  const handleSsoStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!ssoSlug.trim()) {
      setError('Enter your organization slug to continue.');
      return;
    }
    setSsoChecking(true);
    try {
      // Ask the API which provider is configured for this tenant.
      const res = await fetch(`${API_URL}/auth/sso/${encodeURIComponent(ssoSlug.trim())}/config-public`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.enabled) {
        setError(`SSO is not enabled for "${ssoSlug}". Ask your admin to configure it or sign in with your password.`);
        setSsoChecking(false);
        return;
      }
      const provider = (data.provider as string).toLowerCase();
      // Navigate to the API SSO entry point; it will 302 to the IdP.
      window.location.href = `${API_URL}/auth/sso/${encodeURIComponent(ssoSlug.trim())}/${provider}/login`;
    } catch {
      setError("Can't reach the server to start SSO. Try again in a moment.");
      setSsoChecking(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eulaAccepted) {
      setError('You must accept the End User License Agreement to continue.');
      return;
    }
    setError('');
    setLoading(true);
    warnIfMisconfigured();
    clog.info('auth', 'Login attempt', { email, rememberMe, redirectTarget });
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe })
      });
      const data = await res.json();
      await applyLoginResponse(res, data, 'password', 'Invalid email or password. Please try again.');
    } catch {
      if (isLikelyMisconfigured()) {
        setError(
          "Can't reach the server. This deployment is missing NEXT_PUBLIC_API_URL — " +
            'ask your administrator to set it in Vercel (it should point to the Railway API + /api/v1).'
        );
      } else {
        setError(`Can't reach the server at ${API_URL}. If this keeps happening, contact your administrator.`);
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * The 6-digit / backup-code challenge form, VERBATIM as it shipped before
   * the passkey wave.
   *
   * Lifted into a variable rather than left inline so the no-passkey path can
   * render it as the WHOLE branch — no wrapper element, no reordering, no new
   * attributes. An account with no passkey must see the step it has always
   * seen, and "byte-for-byte" is only provable if there is exactly one copy
   * of this markup.
   */
  const codeChallengeForm = (
    <form onSubmit={handleMfaChallenge} className="space-y-4">
      <div className="flex justify-center">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
          <ShieldCheck className="w-6 h-6 text-indigo-600" />
        </div>
      </div>
      <div>
        <label htmlFor="mfa-code" className="block text-xs font-semibold text-slate-700 mb-1.5">
          {useBackupCode ? t('backupCode') : t('authCode')}
        </label>
        <input
          id="mfa-code"
          name="mfa-code"
          type="text"
          inputMode={useBackupCode ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoFocus
          required
          placeholder={useBackupCode ? 'XXXX-XXXX' : '123456'}
          className={INPUT_CLS + (useBackupCode ? '' : ' tracking-[0.4em] text-center font-mono text-base')}
          value={mfaCode}
          onChange={(e) => setMfaCode(e.target.value)}
          aria-describedby="mfa-help"
        />
        <p id="mfa-help" className="mt-1.5 text-[11px] text-slate-400">
          {useBackupCode ? t('backupCodeOnce') : t('openAuthenticator')}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-xs text-rose-700 font-medium">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={mfaSubmitting}
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        {mfaSubmitting ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> {t('verifying')}</>
        ) : (
          t('verifySignIn')
        )}
      </button>

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={cancelMfa}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {t('back')}
        </button>
        {/* A passkey-ONLY account has no authenticator app, so from its
            backup-code form there is no "use authenticator code" to switch
            to — offering it sent the operator to a code box that can only
            ever answer MFA_TOTP_NOT_ENABLED (lead's end-to-end run,
            2026-09-21). With 'totp' in the methods (or an older API that
            sends none) this renders exactly as it always has. */}
        {(mfaMethods.includes('totp') || !useBackupCode) && (
        <button
          type="button"
          onClick={() => { setUseBackupCode((v) => !v); setMfaCode(''); setError(''); }}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
        >
          {useBackupCode ? t('useAuthCode') : t('useBackupCode')}
        </button>
        )}
      </div>
    </form>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafbfc] px-4 py-10">
      <div className="w-full max-w-sm">
        {/* brand */}
        <div className="text-center mb-7">
          <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden className="mx-auto">
            <polygon points="30,16 23,28.12 9,28.12 2,16 9,3.88 23,3.88" fill="#4f46e5" />
            <polygon points="22,16 19,21.2 13,21.2 10,16 13,10.8 19,10.8" fill="#a5b4fc" />
          </svg>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">
            {pendingBackupCodes
              ? t('mfaBackupCodesTitle')
              : enrollRequired
                ? t('mfaSetupTitle')
                : mfaToken
                  ? t('twoFactorTitle')
                  : t('signInTitle', { brand: brand.name })}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {pendingBackupCodes
              ? t('mfaBackupCodesSubtitle')
              : enrollRequired
                ? t('mfaSetupSubtitle')
                : mfaToken
                  ? (useBackupCode ? t('mfaEnterBackup') : t('mfaEnterCode'))
                  : brand.tagline}
          </p>
        </div>

        {/* card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-7">
          {pendingBackupCodes ? (
            /* ── ACC-03: one-time backup codes, shown BEFORE we redirect ──
               `/required/verify` returns these once and never again. Handing
               the user straight to the dashboard would silently throw away
               their only recovery path if they later lose the phone. */
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-emerald-600" />
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{t('mfaBackupCodesHelp')}</p>
              <ul className="grid grid-cols-2 gap-1.5 bg-slate-50 rounded-lg p-3 list-none">
                {pendingBackupCodes.map((c) => (
                  <li key={c} className="font-mono text-xs text-slate-700 select-all text-center">{c}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => { navigator.clipboard?.writeText(pendingBackupCodes.join('\n')); }}
                className="w-full border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                {t('mfaCopyCodes')}
              </button>
              <button
                type="button"
                onClick={() => { const s = pendingSession; setPendingBackupCodes(null); setPendingSession(null); if (s) completeLogin(s); }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors"
              >
                {t('mfaSavedCodesContinue')}
              </button>
            </div>
          ) : enrollRequired && mfaToken ? (
            /* ── ACC-03: forced-enrollment step ──────────────────────────
               An admin required 2FA on this account and it has never been set
               up. Settings → Security is unreachable (it needs the session
               this policy withholds), so setup happens here. */
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-indigo-600" />
                </div>
              </div>

              {!enrollSecret ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  {mfaSubmitting ? (
                    <>
                      <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                      <p className="text-xs text-slate-500">{t('mfaSetupPreparing')}</p>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startRequiredEnrollment(mfaToken)}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                    >
                      {t('mfaSetupRetry')}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <ol className="text-xs text-slate-600 space-y-1.5 list-decimal list-inside">
                    <li>{t('mfaSetupStep1')}</li>
                    <li>{t('mfaSetupStep2')}</li>
                    <li>{t('mfaSetupStep3')}</li>
                  </ol>

                  <div className="flex flex-col items-center gap-3">
                    <div className="rounded-xl border border-slate-200 p-3 bg-white">
                      {enrollQr ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={enrollQr} alt={t('mfaSetupQrAlt')} width={160} height={160} className="block" />
                      ) : (
                        <div className="w-[160px] h-[160px] flex items-center justify-center text-slate-300">
                          <Loader2 className="w-5 h-5 animate-spin" />
                        </div>
                      )}
                    </div>
                    <div className="w-full">
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">{t('mfaSetupManualKey')}</p>
                      <code className="block text-xs text-slate-700 select-all break-all bg-slate-50 rounded-lg px-2.5 py-2 font-mono">
                        {enrollSecret.secret}
                      </code>
                    </div>
                  </div>

                  <form onSubmit={handleRequiredVerify} className="space-y-4">
                    <div>
                      <label htmlFor="mfa-enroll-code" className="block text-xs font-semibold text-slate-700 mb-1.5">
                        {t('authCode')}
                      </label>
                      <input
                        id="mfa-enroll-code"
                        name="mfa-enroll-code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                        placeholder="123456"
                        className={INPUT_CLS + ' tracking-[0.4em] text-center font-mono text-base'}
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value)}
                      />
                    </div>

                    {error && (
                      <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                        <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-rose-700 font-medium">{error}</p>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={mfaSubmitting}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {mfaSubmitting ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> {t('verifying')}</>
                      ) : (
                        t('mfaSetupFinish')
                      )}
                    </button>
                  </form>
                </>
              )}

              {!enrollSecret && error && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-700 font-medium">{error}</p>
                </div>
              )}

              <button
                type="button"
                onClick={cancelMfa}
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> {t('back')}
              </button>
            </div>
          ) : mfaToken ? (
            /* ── MFA challenge step ─────────────────────────────────────
               When the account has NO passkey (or this browser can't do
               WebAuthn) this renders `codeChallengeForm` and nothing else —
               the exact markup that shipped before 2026-09-21. The passkey
               arm is additive; it never reshapes the TOTP-only step. */
            passkeyStepAvailable ? (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
                    <Fingerprint className="w-6 h-6 text-indigo-600" />
                  </div>
                </div>

                {/* PRIMARY control. One tap, on purpose — Safari needs a
                    fresh user gesture for navigator.credentials.get(), and
                    the activation from the password submit is long gone by
                    the time this step renders. */}
                <button
                  ref={passkeyStepBtnRef}
                  type="button"
                  onClick={handlePasskeyChallenge}
                  disabled={passkeyBusy}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {passkeyBusy ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> {t('verifying')}</>
                  ) : (
                    <><Fingerprint className="w-4 h-4" /> {t('usePasskey')}</>
                  )}
                </button>

                {/* The code form is the ALTERNATIVE here. Offered only when
                    the account actually has TOTP — a passkey-only user gets
                    the backup-code path below instead, which is their real
                    fallback. */}
                {!codeFormOpen && totpStepAvailable && (
                  <button
                    type="button"
                    onClick={() => { setCodeFormOpen(true); setError(''); }}
                    className="w-full text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                  >
                    {t('useCodeInstead')}
                  </button>
                )}

                {codeFormOpen ? codeChallengeForm : (
                  <>
                    <div aria-live="polite">
                      {error && (
                        <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                          <p className="text-xs text-rose-700 font-medium">{error}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={cancelMfa}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" /> {t('back')}
                      </button>
                      {/* A passkey-only account's fallback IS a backup code,
                          so this stays reachable whether or not TOTP is on. */}
                      <button
                        type="button"
                        onClick={() => { setUseBackupCode(true); setMfaCode(''); setError(''); setCodeFormOpen(true); }}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                      >
                        {t('useBackupCode')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : codeChallengeForm
          ) : (
          <>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1.5">{t('email')}</label>
              <input
                id="login-email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                placeholder={t('emailPlaceholder')}
                className={INPUT_CLS}
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700 mb-1.5">{t('password')}</label>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className={INPUT_CLS}
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <span className="text-xs font-medium text-slate-600">{t('keepSignedIn')}</span>
              </label>
              <Link
                href="/reset-password/request"
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                {t('forgotPassword')}
              </Link>
            </div>

            {/* EULA acceptance — required. Gates the Sign-in button. */}
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={eulaAccepted}
                onChange={e => setEulaAccepted(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                required
                aria-describedby="eula-text"
              />
              <span id="eula-text" className="text-[11px] leading-snug text-slate-600">
                {t.rich('eulaAgree', {
                  link: (chunks) => (
                    <Link
                      href="/terms/eula"
                      target="_blank"
                      className="text-indigo-600 hover:text-indigo-700 underline underline-offset-2 font-semibold"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </span>
            </label>

            {/* 2026-09-11 — the invite was ACCEPTED and the password is set,
                but this organization requires two-factor, so there is no
                session yet. Say that plainly: without it the operator lands on
                a bare login form with no idea whether their invite worked. */}
            {!error && authReason === 'invite-mfa' && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 font-medium">
                  {t('inviteMfaSetupNeeded')}
                </p>
              </div>
            )}

            {!error && authReason === 'session-expired' && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 font-medium">
                  {t('sessionExpired')}
                </p>
              </div>
            )}

            {/* The live region is PERSISTENT (2026-09-21): an aria-live node
                that only appears at the same moment its text does is not
                reliably announced. Passwordless passkey failures land here,
                and "that passkey wasn't accepted" is useless to a screen
                reader that never hears it. */}
            <div aria-live="polite">
              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-700 font-medium">{error}</p>
                </div>
              )}
            </div>

            {/* Keep enabled when the EULA is unchecked (only `loading` disables)
                so the handleLogin guard fires and surfaces the real "you must
                accept the EULA" error on click/Enter. Previously disabled on
                !eulaAccepted, which made that guard — and the Enter-key path —
                silently dead for first-time users (2026-06-09 Fable audit). */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> {t('signingIn')}</>
              ) : (
                t('signIn')
              )}
            </button>

            {/* Passwordless sign-in (2026-09-21). Secondary by design — the
                password path stays the one the form submits. It is `type=
                "button"` so Enter in the email/password fields still submits
                the real form, and it honours the SAME EULA gate and "Keep me
                logged in" choice: a second way in must never be a way around
                the agreement. Hidden entirely when the browser cannot do
                WebAuthn, rather than shown dead. */}
            {passkeyCapable && (
              <button
                type="button"
                onClick={handlePasswordlessPasskey}
                disabled={passkeyBusy || loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition-colors"
              >
                {passkeyBusy ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> {t('verifying')}</>
                ) : (
                  <><Fingerprint className="w-4 h-4" /> {t('signInWithPasskey')}</>
                )}
              </button>
            )}
          </form>

          {/* SSO block */}
          <div className="mt-5 pt-5 border-t border-slate-100">
            {!ssoOpen ? (
              <button
                type="button"
                onClick={() => { setSsoOpen(true); setError(''); }}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition-colors"
              >
                <KeyRound className="w-4 h-4" /> {t('signInWithSSO')}
              </button>
            ) : (
              <form onSubmit={handleSsoStart} className="space-y-3">
                <label htmlFor="sso-slug" className="block text-xs font-semibold text-slate-700">
                  {t('orgSlug')}
                </label>
                <input
                  id="sso-slug"
                  type="text"
                  autoComplete="organization"
                  placeholder="acme-co"
                  value={ssoSlug}
                  onChange={(e) => setSsoSlug(e.target.value)}
                  className={INPUT_CLS}
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={ssoChecking}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2"
                  >
                    {ssoChecking ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('redirecting')}</> : t('continueSSO')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSsoOpen(false)}
                    className="px-4 py-2.5 text-slate-500 hover:text-slate-700 text-xs font-semibold"
                  >
                    {t('cancel')}
                  </button>
                </div>
              </form>
            )}
          </div>
          </>
          )}
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          {t('newHere')} <Link href="/signup" className="text-indigo-600 hover:text-indigo-700 font-semibold">{t('createWorkspace')}</Link>
        </p>

        {/* a11y (2026-05-26): bumped text-slate-400 (2.53:1 fail on #fafbfc bg)
            up to text-slate-600 (~7.86:1, comfortably above WCAG AA 4.5:1).
            Hover state bumped slate-600 → slate-800 to preserve the
            darken-on-hover affordance. Same source renders on every
            unauthenticated redirect, so this fixes all 9 axe routes at once. */}
        <nav className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-slate-600">
          <Link href="/" className="hover:text-slate-800 transition">{t('home')}</Link>
          <Link href="/pricing" className="hover:text-slate-800 transition">{t('pricing')}</Link>
          <Link href="/help" className="hover:text-slate-800 transition">{t('help')}</Link>
          <Link href="/privacy" className="hover:text-slate-800 transition">{t('privacy')}</Link>
          <Link href="/terms" className="hover:text-slate-800 transition">{t('terms')}</Link>
        </nav>

        {/* Language switcher — pre-auth operators need a way in before they
            can reach the avatar-menu switcher. */}
        <LanguageSwitcherInline className="mt-4" />
      </div>
    </div>
  );
}
