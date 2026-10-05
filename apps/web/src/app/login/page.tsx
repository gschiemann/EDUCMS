// autoFocus is deliberate on this page: each sign-in step mounts fresh and its
// first field (or primary button) must take focus, or a keyboard / screen-
// reader operator is left at the top of the document after every step change.
/* eslint-disable jsx-a11y/no-autofocus */
"use client";

import { Fragment, Suspense, useEffect, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, AlertCircle, ShieldCheck, ArrowLeft, Fingerprint, CheckCircle2, Mail, Smartphone } from 'lucide-react';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { useUIStore } from '@/store/ui-store';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_URL, warnIfMisconfigured, isLikelyMisconfigured } from '@/lib/api-url';
import { clog } from '@/lib/client-logger';
import { getClientBrand } from '@/lib/brand';
import { useTranslations } from 'next-intl';
import { LanguageSwitcherInline } from '@/components/layout/LanguageMenu';
import { adoptRememberedSession } from '@/lib/session-client';
import {
  cancelPasskeyCeremony,
  conditionalPasskeyAvailable,
  createPasskey,
  describePasskeyError,
  getPasskey,
  getPasskeyFromAutofill,
  guessDeviceLabel,
  passkeyDeviceKind,
  passkeyErrorName,
  passkeyMissDiagnostics,
  passkeyPhoneKind,
  passkeysSupported,
  platformPasskeyAvailable,
  type PasskeyMissStage,
  type PasskeyPhoneKind,
} from '@/lib/passkeys';
import { passkeyRememberedOnDevice, rememberPasskeyOnDevice } from '@/lib/passkey-on-device';
import {
  emailCodeSendErrorKey,
  emailCodeVerifyError,
  otherWaysFor,
  readMfaFallbacks,
  type OtherWay,
} from '@/lib/mfa-other-ways';
import {
  isPasskeyOfferSnoozed,
  PASSKEY_METHOD_KEYS,
  passkeyMethodFor,
  readPasskeyEnrollmentGrant,
  snoozePasskeyOffer,
  type PasskeyMethod,
} from '@/lib/passkey-offer';
import {
  fetchSignInOptions,
  INITIAL_SIGN_IN_STEP,
  leaveForSingleSignOn,
  normalizeEmail,
  signInStepReducer,
  ssoLoginUrl,
  stashEmailForReset,
} from '@/lib/sign-in-steps';
import {
  clearPendingEulaAcceptance,
  eulaAcceptedOnThisDevice,
  EULA_VERSION,
  recordEulaAcceptance,
  stashPendingEulaAcceptance,
} from '@/lib/eula-acceptance';
import { keepSignedInForPasskey, rememberKeepSignedInChoice } from '@/lib/keep-signed-in';

const INPUT_CLS =
  'w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 ' +
  'placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition';

/** The ONE primary action of a sign-in step. */
const PRIMARY_BTN_CLS =
  'w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white ' +
  'text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2';

/**
 * A low-emphasis alternative under the primary action. Looks like a text
 * link; the padding (cancelled by the negative margin) only enlarges the
 * area a thumb can hit.
 */
const LINK_BTN_CLS =
  'px-3 py-2 -my-2 rounded text-xs font-semibold text-indigo-600 hover:text-indigo-700 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * One of the two EQUAL first choices on a phone's passkey step (2026-10-05):
 * "Use your passkey" / "Set up a passkey on this iPhone". Same size, same
 * weight — neither is the "real" answer until the person says where their
 * passkey is. 52px tall: a thumb, not a cursor.
 */
const CHOICE_BTN_CLS =
  'w-full min-h-[52px] px-4 py-3 bg-white border-2 border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50 ' +
  'rounded-xl text-[15px] leading-snug text-center font-semibold text-indigo-700 transition-colors ' +
  'flex items-center justify-center gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed';

/** The guided "Turn on Face ID or Touch ID" — the screen's only button, thumb-sized. */
const TURN_ON_BTN_CLS =
  'w-full min-h-[52px] px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[15px] font-semibold ' +
  'transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * The post-sign-in passkey offer (2026-09-22) — one screen between a finished
 * password (+ authenticator code) sign-in and the dashboard. See
 * `lib/passkey-offer.ts` and, for the server half, the API's
 * `passkey-enrollment-grant.ts`.
 *
 *   ready     — options are already in hand; "Set up passkey" / "Not now"
 *   working   — the device sheet is up
 *   done      — saved; Continue
 *   codes     — saved, and it was this account's FIRST factor: the ten
 *               one-time backup codes must be seen before Continue
 *   cancelled — the sheet was dismissed; calm note + Continue
 *   failed    — plain message + Continue
 *   exists    — this device ALREADY holds a passkey for the account (the
 *               browser refused a duplicate); calm note + Continue. Possible
 *               since 2026-10-05, when the offer started going to accounts
 *               whose passkey is on another device.
 */
type PasskeyOfferPhase = 'ready' | 'working' | 'done' | 'codes' | 'cancelled' | 'failed' | 'exists';

interface PasskeyOfferState {
  /** Where the sign-in was going; every way out of the offer goes there. */
  destination: string;
  /** The fresh session's access token — the offer's two calls are Bearer calls. */
  token: string;
  /**
   * Creation options fetched BEFORE the button is enabled (Safari gesture).
   * `null` only on the guided screen when nothing could be prepared — it then
   * opens straight on its "add it later" line.
   */
  options: PublicKeyCredentialCreationOptionsJSON | null;
  /** Did this sign-in involve a code? Picks "…password and code" vs "…password". */
  withCode: boolean;
  method: PasskeyMethod;
  /**
   * The person ASKED for this (2026-10-05) — "Set up a passkey on this
   * iPhone", then the emailed code. ONE button ("Turn on Face ID or Touch
   * ID"), no "Not now" / "Don't ask", the "Not now" snooze does not apply,
   * and a saved passkey goes straight on to the destination.
   */
  guided: boolean;
  /** Which phone or tablet, for the guided screen's words. */
  device: PasskeyPhoneKind;
}

/** The history entry pushed on entering step 2, so the browser's Back returns to step 1. */
const STEP_HISTORY_STATE = { venueosSignInStep: 2 };

/** A history entry we push while the offer is up, so Back can be answered. */
const OFFER_HISTORY_STATE = { venueosPasskeyOffer: true };

/** Longest the offer may hold a finished sign-in back while it prepares. */
const OFFER_PREPARE_TIMEOUT_MS = 8_000;

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
  // ── IDENTIFIER-FIRST SIGN-IN (2026-10-04) ────────────────────────────
  // Owner: "the sign in seems so confusing, so many options… can't you just
  // show what's enabled for the user". One field first (the email), then only
  // what applies to it. The step machine and the lookup are pure and live in
  // `lib/sign-in-steps.ts`; this page renders them.
  //
  // The typed address stays in component state — never the URL, never
  // localStorage — so "Change" (and the browser's Back) return to it.
  const [emailInput, setEmailInput] = useState('');
  const [step, dispatchStep] = useReducer(signInStepReducer, INITIAL_SIGN_IN_STEP);
  /** The address every handler below uses: what step 2 was opened for, else what is typed. */
  const email = step.name === 'email' ? normalizeEmail(emailInput) : step.email;
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const login = useUIStore((state) => state.login);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect');
  const authReason = searchParams.get('reason'); // 'session-expired' | 'explicit-logout'
  // Support-only: `/login?sso=1` shows the manual "organization slug" entry
  // that used to sit behind the always-visible "Sign in with SSO" button.
  // There is deliberately no control on the page that leads here.
  const manualSso = searchParams.get('sso') === '1';
  const [rememberMe, setRememberMe] = useState(false);
  // "Keep me signed in" for the sign-in IN PROGRESS, when it did not come
  // from the checkbox. The checkbox lives on the password step; a passkey
  // used on step 1 never passes it, so that sign-in follows the choice its
  // account last made on this browser (`lib/keep-signed-in.ts`). `null` =
  // "use the checkbox". A ref, not state: the value is decided and consumed
  // inside one async sign-in, across renders.
  const signInKeepRef = useRef<boolean | null>(null);
  // EULA acceptance (`lib/eula-acceptance.ts` — per browser, per version).
  //
  // The click-through is exactly as binding as it has always been for a
  // browser that has NOT accepted this version: the checkbox is shown on
  // step 2, it is `required`, and no handler signs in without it. What
  // changed (2026-10-04) is that a browser that HAS accepted is no longer
  // shown a pre-ticked checkbox on every visit — it gets one quiet line
  // under the button instead.
  /** This browser already accepted this EULA version (read after mount). */
  const [eulaOnDevice, setEulaOnDevice] = useState(false);
  /** The checkbox, shown only when `eulaOnDevice` is false. Never pre-ticked. */
  const [eulaChecked, setEulaChecked] = useState(false);
  const eulaAccepted = eulaOnDevice || eulaChecked;
  // Read AFTER mount, never during render: localStorage does not exist on the
  // server, and a hydration mismatch here would take the form with it.
  useEffect(() => {
    if (eulaAcceptedOnThisDevice()) setEulaOnDevice(true);
    // A fresh visit to this page: a single sign-on round trip that parked a
    // tick did not finish, so that tick records nothing.
    clearPendingEulaAcceptance();
  }, []);
  const [ssoSlug, setSsoSlug] = useState('');
  const [ssoChecking, setSsoChecking] = useState(false);
  /** Step 2's single sign-on button was pressed; the browser is leaving. */
  const [ssoRedirecting, setSsoRedirecting] = useState(false);
  /** Polite, screen-reader-only note of what the page just became. */
  const [stepAnnouncement, setStepAnnouncement] = useState('');

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

  // ── "Use another way" (2026-10-05) ──────────────────────────────────
  // Owner: his passkey was on his Mac; on his iPhone the sheet showed the
  // cross-device QR code and the page offered nothing else he could see. The
  // pure decisions are in `lib/mfa-other-ways.ts`.
  //
  // `mfaFallbacks` from the login response — `null` when the API predates it,
  // which reads as the shipped behaviour (backup code offered, no email).
  const [mfaFallbacks, setMfaFallbacks] = useState<string[] | null>(null);
  /** The list of other ways is open on the passkey step. */
  const [otherWaysOpen, setOtherWaysOpen] = useState(false);
  /** The passkey sheet just closed without a credential on THIS device. */
  const [passkeyMissed, setPasskeyMissed] = useState(false);
  const firstOtherWayRef = useRef<HTMLButtonElement>(null);
  const otherWays = otherWaysFor(mfaMethods, mfaFallbacks);

  // ── "Set up a passkey on this phone" (2026-10-05) ───────────────────
  // Owner, on his iPhone: "it just pops up a QR code, I X off of that and you
  // give me 3 more options but I just want to create a passkey on my phone
  // and get logged in." So on a PHONE or TABLET the passkey step starts with
  // two equal choices BEFORE any sheet opens — "Use your passkey" and "Set up
  // a passkey on this iPhone" — and the second is one guided path: the
  // emailed code (sent at once), then ONE "Turn on Face ID or Touch ID"
  // button. The password alone never adds a passkey: the grant that buys the
  // creation options is minted only after the emailed code
  // (`passkey-enrollment-grant.ts`, mint site 3).
  //
  // Decided when the step opens (`applyLoginResponse`): which phone this is,
  // and only if it has a built-in authenticator (else `null` — the step stays
  // as it was); and whether this device already holds a passkey for the
  // account (`lib/passkey-on-device.ts`) — then only "Use your passkey".
  const [phoneSetupDevice, setPhoneSetupDevice] = useState<PasskeyPhoneKind | null>(null);
  const [passkeyOnDevice, setPasskeyOnDevice] = useState(false);
  /** The emailed code on screen belongs to the set-up path. */
  const [phoneSetup, setPhoneSetup] = useState(false);
  /** The emailed code — what setting a passkey up here needs first — is on offer. */
  const emailCodeOffered = otherWays.includes('email');
  /** "Set up a passkey on this phone" can be offered on this step. */
  const phoneSetupWay = passkeyStepAvailable && phoneSetupDevice !== null && emailCodeOffered;
  /** Before any sheet: the two equal choices (not when this device holds one). */
  const phoneChoices = phoneSetupWay && !passkeyOnDevice && !passkeyMissed;
  /** After a miss (or from "Use another way"), the set-up path leads the list. */
  const listedWays: Array<OtherWay | 'phone-setup'> =
    phoneSetupWay && !phoneChoices ? ['phone-setup', ...otherWays] : otherWays;
  /**
   * This phone could hold a passkey, but the emailed code that must come
   * first is not available (mail not configured, or a password reset in the
   * last 7 days): the choice is hidden, and the step says where the passkey
   * works instead.
   */
  const phoneSetupBlocked =
    passkeyStepAvailable && phoneSetupDevice !== null && !emailCodeOffered && !passkeyOnDevice && !passkeyMissed;

  // ── The emailed code (2026-10-05) ───────────────────────────────────
  // A 6-digit code mailed to the account, as the SECOND step only: the send
  // needs the partial mfaToken, which exists only after a correct password.
  // `emailChallenge` is the opaque handle the send returned — page memory
  // only, never storage, exactly like the mfaToken it stands beside.
  const [emailChallenge, setEmailChallenge] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeBusy, setEmailCodeBusy] = useState<false | 'sending' | 'verifying'>(false);
  const [emailCodeResent, setEmailCodeResent] = useState(false);
  /** The live partial token, for async handlers that must not act after "Back". */
  const mfaTokenRef = useRef<string | null>(null);
  useEffect(() => { mfaTokenRef.current = mfaToken; }, [mfaToken]);

  /**
   * Diagnostics for a passkey ceremony that ended without a credential —
   * through the existing client log, no PII (see `passkeyMissDiagnostics`).
   */
  const logPasskeyMiss = (stage: PasskeyMissStage, err: unknown, accountHasPasskeys: boolean | null) => {
    clog.info('auth', 'Passkey ceremony ended without a credential', passkeyMissDiagnostics({ stage, err, accountHasPasskeys }));
  };

  // Whenever the list of ways comes on screen — because the passkey missed,
  // because "Use another way" was pressed (that link is replaced by the list,
  // so focus would otherwise fall to the page), or on the way back from a code
  // form — focus its first way: the keyboard or screen-reader operator lands
  // on what to do next.
  useEffect(() => {
    if (mfaToken && otherWaysOpen && !codeFormOpen && !emailChallenge) firstOtherWayRef.current?.focus();
  }, [mfaToken, otherWaysOpen, passkeyMissed, codeFormOpen, emailChallenge]);

  // Focus the step's PRIMARY control when the passkey challenge opens. The
  // TOTP input carries autoFocus for the same reason; when the passkey button
  // is primary the focus has to follow it or a keyboard operator lands at the
  // top of the document with no idea what changed.
  // Also on the way BACK from the set-up path's emailed code to the two
  // choices (the list of ways, when open, takes focus in the effect above).
  useEffect(() => {
    if (mfaToken && passkeyStepAvailable && !codeFormOpen && !emailChallenge && !otherWaysOpen) {
      passkeyStepBtnRef.current?.focus();
    }
  }, [mfaToken, passkeyStepAvailable, codeFormOpen, emailChallenge, otherWaysOpen]);

  // ── "No passkey here yet?" and the post-sign-in offer (2026-09-22) ──────
  // Operator: "when i try to login with a passkey to my main account it says
  // i dont have one saved. shouldnt it walk me thru getting one?"
  //
  // The hint is shown after "Sign in with a passkey" ends with no credential.
  // The browser cannot tell "this device has none" from "you closed the
  // sheet" (both are NotAllowedError), so it is a calm pointer to the way
  // forward, never an error. `offer` says whether it may PROMISE the setup
  // walk-through — only when this device has a built-in authenticator and
  // "Not now" is not in force, i.e. only when the walk-through will appear.
  const [passkeyHint, setPasskeyHint] = useState<{ offer: boolean; method: PasskeyMethod } | null>(null);
  const [passkeyOffer, setPasskeyOffer] = useState<PasskeyOfferState | null>(null);
  const [offerPhase, setOfferPhase] = useState<PasskeyOfferPhase>('ready');
  const [offerCodes, setOfferCodes] = useState<string[] | null>(null);
  // Set the instant the operator leaves the offer. A ceremony that resolves
  // after that must not register a credential nobody is watching — its
  // one-time backup codes would be shown to no one.
  const offerClosedRef = useRef(false);
  const offerHistoryPushedRef = useRef(false);
  const offerPrimaryRef = useRef<HTMLButtonElement>(null);
  // The latest Esc / Back handler, for listeners registered once per offer.
  const offerEscapeRef = useRef<(via: 'key' | 'history') => void>(() => {});

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

  // ── Which factor the held-back operator is setting up (2026-09-21) ──
  // `'totp'` is today's step, unchanged, and it is the DEFAULT on purpose: a
  // browser that cannot do WebAuthn — and any path that somehow reaches this
  // step without deciding — gets exactly the screen that has always shipped.
  // `'choice'` is the new first screen, and it is only ever entered
  // deliberately, when we know the browser can create a passkey.
  const [enrollMethod, setEnrollMethod] = useState<'choice' | 'totp'>('totp');
  const enrollPasskeyBtnRef = useRef<HTMLButtonElement>(null);

  // Focus the step's PRIMARY control when the choice screen opens — the same
  // rule the passkey challenge step follows. Without it a keyboard or
  // screen-reader operator lands at the top of the document with no idea the
  // page changed underneath them.
  useEffect(() => {
    if (mfaToken && enrollRequired && enrollMethod === 'choice') {
      enrollPasskeyBtnRef.current?.focus();
    }
  }, [mfaToken, enrollRequired, enrollMethod]);

  // Safari only lets navigator.credentials.create() run straight from the tap
  // that asked for it; a network fetch in between (the old order: tap, fetch
  // the options, THEN create) loses that permission, so on a Mac the button
  // sat on "Waiting for your device…" and no passkey sheet ever opened
  // (RIOT Corporate first sign-in, 2026-10-05). The options are therefore
  // fetched as the choice screen opens and the tap goes straight to the
  // device. The server's challenge lives 5 minutes; anything older, or a
  // fetch that has not landed, falls back to the fetch-then-create path.
  const requiredPasskeyOptsRef = useRef<{ token: string; options: any; at: number } | null>(null);
  useEffect(() => {
    requiredPasskeyOptsRef.current = null;
    if (!mfaToken || !enrollRequired || enrollMethod !== 'choice') return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/mfa/required/passkey/options`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mfaToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (live && res.ok && data?.options) {
          requiredPasskeyOptsRef.current = { token: mfaToken, options: data.options, at: Date.now() };
        }
      } catch {
        /* the tap fetches them itself */
      }
    })();
    return () => {
      live = false;
    };
  }, [mfaToken, enrollRequired, enrollMethod]);

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

  /** Set the moment a sign-in finishes; the page is on its way out. */
  const sessionStartedRef = useRef(false);

  // Shared post-login completion — used by BOTH the normal password path
  // and the MFA challenge path so EULA persistence + the cross-tenant-safe
  // redirect logic live in exactly one place.
  //
  // Async since 2026-09-22: when the sign-in left a passkey-enrollment grant
  // behind, the offer is prepared here BEFORE the redirect, and callers await
  // it so their "Signing in…" state holds until the next screen is ready.
  const completeLogin = async (data: any, opts: { guided?: boolean } = {}): Promise<void> => {
    // A session exists from here on — nothing on this page re-arms.
    sessionStartedRef.current = true;
    // Recorded only now, on a FULLY successful sign-in.
    recordEulaAcceptance(email);
    clog.info('auth', 'EULA accepted', { version: EULA_VERSION, userId: data.user?.id });
    // The checkbox, unless this sign-in was a passkey used on step 1 (see
    // `signInKeepRef`). Remembered per account so that account's NEXT passkey
    // sign-in on this browser follows it.
    const keepSignedIn = signInKeepRef.current ?? rememberMe;
    void rememberKeepSignedInChoice(data.user?.id, keepSignedIn);
    // Pass the "Keep me logged in" choice. The store keeps the ACCESS token
    // per-tab only (it is <= 1h now); durability comes from the step below.
    login(data.access_token, data.user, keepSignedIn);
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
    if (keepSignedIn && data.access_token) {
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

    // THE WALK-THROUGH (2026-09-22). One screen, only when everything lines
    // up; otherwise straight on, exactly as before.
    const guided = !!opts.guided;
    const offer = await preparePasskeyOffer(data, guided);
    if (offer) {
      offerClosedRef.current = false;
      setOfferCodes(null);
      setOfferPhase('ready');
      setPasskeyOffer({ ...offer, destination: safeRedirect });
      return;
    }
    if (guided) {
      // The person ASKED to set up a passkey here and the emailed code proved
      // it was them, but nothing can be created right now (no grant, options
      // refused or unreachable). Signed in all the same: say so, with the way
      // on — never a silent jump to the dashboard, never back to the QR code.
      offerClosedRef.current = false;
      setOfferCodes(null);
      setOfferPhase('failed');
      setPasskeyOffer({
        destination: safeRedirect,
        token: '',
        options: null,
        withCode: true,
        method: passkeyMethodFor(),
        guided: true,
        device: phoneSetupDevice ?? 'other',
      });
      return;
    }
    router.push(safeRedirect);
  };

  /**
   * Should this finished sign-in be offered a passkey — and if so, get the
   * creation options NOW.
   *
   * All of these must hold, or the answer is "no offer" and the sign-in
   * continues untouched: the API left a grant (it does so only for an account
   * with no passkey, after a real password [+ code] sign-in), the account is
   * not behind the first-login setup gate, this browser does WebAuthn AND has
   * a built-in authenticator, and "Not now" is not in force.
   *
   * ⚠️ WHY THE OPTIONS ARE FETCHED HERE, before the button exists: Safari
   * only lets `navigator.credentials.create()` run inside the user's tap
   * (transient user activation), and an `await fetch(...)` between the tap
   * and the call can spend that activation. With the options already in
   * hand, the "Set up passkey" handler calls create() as its very first
   * statement. This also redeems the single-use grant within one request of
   * receiving it, so it never lingers in the page.
   */
  const preparePasskeyOffer = async (
    data: unknown,
    // The guided path (2026-10-05): the person asked for this one, so a
    // session's "Not now" does not hold it back. Every other rule stands.
    guided = false,
  ): Promise<Omit<PasskeyOfferState, 'destination'> | null> => {
    const session = data as { access_token?: unknown; user?: { mustSetupCredentials?: unknown } } | null;
    const grant = readPasskeyEnrollmentGrant(data);
    const token = typeof session?.access_token === 'string' ? session.access_token : '';
    if (!grant || !token || session?.user?.mustSetupCredentials) return null;
    if (!passkeyCapable || (!guided && isPasskeyOfferSnoozed())) return null;
    if (!(await platformPasskeyAvailable())) return null;

    // Bounded: a convenience must never hold a finished sign-in hostage.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OFFER_PREPARE_TIMEOUT_MS);
    try {
      // A Bearer call on the fresh session — the CSRF middleware's Bearer
      // bypass covers it, so no new pre-session route and no EXEMPT_PATHS
      // entry. Deliberately NOT apiFetch: an expired or spent offer is a 403
      // anyway, but nothing on this screen may ever take the sign-out path.
      const res = await fetch(`${API_URL}/auth/passkeys/register/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enrollmentGrant: grant }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        options?: PublicKeyCredentialCreationOptionsJSON;
        code?: string;
      };
      if (!res.ok || !body?.options) {
        clog.warn('auth', 'Passkey offer skipped — options refused', { status: res.status, code: body?.code });
        return null;
      }
      return {
        token,
        options: body.options,
        // The MFA step is where a code was typed; it is the only caller that
        // runs while a partial mfaToken is held.
        withCode: mfaToken !== null,
        method: passkeyMethodFor(),
        guided,
        device: phoneSetupDevice ?? 'other',
      };
    } catch {
      clog.warn('auth', 'Passkey offer skipped — options unreachable', {});
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * "Set up passkey".
   *
   * `createPasskey` is the FIRST statement — nothing awaited in front of it —
   * so the device sheet opens inside this tap's user activation (WebKit
   * refuses `navigator.credentials.create()` without one). The options were
   * fetched before this button was enabled; see `preparePasskeyOffer`.
   */
  const startOfferSetUp = () => {
    const offer = passkeyOffer;
    if (!offer || !offer.options || offerPhase !== 'ready' || offerClosedRef.current) return;
    let ceremony: Promise<RegistrationResponseJSON>;
    try {
      ceremony = createPasskey(offer.options);
    } catch (err) {
      ceremony = Promise.reject(err);
    }
    setOfferPhase('working');
    void finishOfferSetUp(ceremony, offer);
  };

  const finishOfferSetUp = async (
    ceremony: Promise<RegistrationResponseJSON>,
    offer: PasskeyOfferState,
  ) => {
    let credential: RegistrationResponseJSON;
    try {
      credential = await ceremony;
    } catch (err) {
      if (offerClosedRef.current) return;
      const described = describePasskeyError(err, 'create');
      clog.info('auth', 'Passkey offer ended without a credential', { reason: described.reason, guided: offer.guided });
      logPasskeyMiss('offer-create', err, null);
      // The browser refused a DUPLICATE: this device already holds a passkey
      // for the account (it was offered because this sign-in used a code).
      if (described.reason === 'already-registered') await rememberPasskeyOnDevice(email);
      setOfferPhase(
        described.reason === 'already-registered' ? 'exists' : described.quiet ? 'cancelled' : 'failed',
      );
      return;
    }
    // The operator left while the sheet was up. Registering now would add a
    // factor behind their back — and, for a first factor, mint recovery codes
    // no screen will ever show.
    if (offerClosedRef.current) return;
    try {
      const res = await fetch(`${API_URL}/auth/passkeys/register/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${offer.token}` },
        body: JSON.stringify({ response: credential, label: guessDeviceLabel() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        passkey?: unknown;
        backupCodes?: unknown;
        code?: string;
      };
      if (res.ok && data?.passkey) {
        clog.info('auth', 'Passkey added from the sign-in offer', { guided: offer.guided });
        // The next sign-in on this device offers only "Use your passkey".
        await rememberPasskeyOnDevice(email);
        const codes = Array.isArray(data.backupCodes)
          ? data.backupCodes.filter((c): c is string => typeof c === 'string')
          : [];
        if (codes.length) {
          // This passkey is the account's FIRST second factor. The codes are
          // its only recovery path and are shown exactly once — they come
          // before Continue, never after it.
          setOfferCodes(codes);
          setOfferPhase('codes');
        } else if (offer.guided) {
          // "…and get logged in": the person asked for exactly this, the
          // device sheet has just said it is saved — straight on, no extra
          // "saved" screen to tap through.
          leaveOffer('none');
        } else {
          setOfferPhase('done');
        }
        return;
      }
      clog.warn('auth', 'Passkey offer verify refused', { status: res.status, code: data?.code });
      setOfferPhase('failed');
    } catch {
      setOfferPhase('failed');
    }
  };

  /**
   * Every way out of the offer lands on the destination the sign-in was
   * already headed for — "Not now", Continue, Esc, and the browser's Back.
   * No path leaves the operator on this page.
   *
   * `remember` (2026-09-24 — one "Not now" used to mean thirty days, which is
   * how the operator lost the offer for a month): 'session' is "Not now", Esc
   * and Back before starting, and a cancelled or failed setup — not again
   * this session, the next sign-in may ask; 'thirty-days' is the quiet
   * "Don't ask on this device" choice only; 'none' after success (there is
   * nothing left to offer — the account has a passkey now).
   */
  const leaveOffer = (
    remember: 'thirty-days' | 'session' | 'none',
    via: 'ui' | 'history' = 'ui',
  ) => {
    const offer = passkeyOffer;
    if (!offer || offerClosedRef.current) return;
    offerClosedRef.current = true;
    if (offerPhase === 'working') cancelPasskeyCeremony();
    if (remember !== 'none') snoozePasskeyOffer({ forThirtyDays: remember === 'thirty-days' });
    // From the buttons, our own history entry is still on top: REPLACE it, so
    // Back from the dashboard lands where it always has. After Back, that entry
    // is already gone and the destination is simply pushed.
    if (via === 'ui' && offerHistoryPushedRef.current) router.replace(offer.destination);
    else router.push(offer.destination);
  };

  // Esc and Back, answered with the handler for the CURRENT phase. Kept in a
  // ref (refreshed after every render) so the listeners below are registered
  // once per offer and never call a stale phase.
  useEffect(() => {
    offerEscapeRef.current = (via) => {
      if (!passkeyOffer || offerClosedRef.current) return;
      switch (offerPhase) {
        case 'ready':
          // Esc or Back before starting says what "Not now" says: this
          // session only. Never the 30-day answer — that takes a deliberate
          // choice of its own button.
          leaveOffer('session', via === 'history' ? 'history' : 'ui');
          return;
        case 'working':
          // Esc belongs to the device sheet, which cancels itself. Back leaves
          // (and cancels the pending ceremony on the way out).
          if (via === 'history') leaveOffer('session', 'history');
          return;
        case 'codes':
          // The ONE hold: these codes are shown once and are this account's
          // only recovery path. Back re-arms the entry and the codes stay on
          // screen; the way on is the button directly under them.
          if (via === 'history') {
            try { window.history.pushState(OFFER_HISTORY_STATE, ''); } catch { /* nothing to re-arm */ }
          }
          return;
        case 'done':
          leaveOffer('none', via === 'history' ? 'history' : 'ui');
          return;
        default:
          leaveOffer('session', via === 'history' ? 'history' : 'ui');
      }
    };
  });

  const offerOpen = passkeyOffer !== null;
  useEffect(() => {
    if (!offerOpen) return;
    // One synthetic history entry per offer (StrictMode runs this twice in
    // dev), so the browser's Back answers the offer instead of leaving it.
    if (!offerHistoryPushedRef.current) {
      try {
        window.history.pushState(OFFER_HISTORY_STATE, '');
        offerHistoryPushedRef.current = true;
      } catch {
        /* no history API — the buttons and Esc still get out */
      }
    }
    const onPop = () => offerEscapeRef.current('history');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') offerEscapeRef.current('key');
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
    };
  }, [offerOpen]);

  // Focus follows the offer's primary control on every phase — a keyboard or
  // screen-reader operator must land on the thing to press next.
  useEffect(() => {
    if (offerOpen && offerPhase !== 'working') offerPrimaryRef.current?.focus();
  }, [offerOpen, offerPhase]);

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
      // Absent ⇒ ['totp'] — an older API can never be read as "this account
      // has a passkey", only as the shape that already shipped.
      const methods: string[] = Array.isArray(data.mfaMethods) && data.mfaMethods.length
        ? data.mfaMethods
        : ['totp'];
      // A PHONE with a passkey step (2026-10-05): can it hold a passkey of
      // its own (a built-in authenticator — bounded, never hangs), and does
      // it already hold one for this account? Settled BEFORE the step's first
      // paint, so it opens on the right choices instead of changing under a
      // thumb. Everywhere else nothing is awaited here.
      const phone =
        methods.includes('passkey') && passkeyCapable && !data.mfaEnrollmentRequired ? passkeyPhoneKind() : null;
      const [canHoldPasskey, holdsPasskey] = phone
        ? await Promise.all([platformPasskeyAvailable(), passkeyRememberedOnDevice(email)])
        : [false, false];
      setPhoneSetupDevice(phone && canHoldPasskey ? phone : null);
      setPasskeyOnDevice(holdsPasskey);
      setPhoneSetup(false);
      // Credential was accepted, but a second factor is owed. Hold the
      // short-lived challenge token and render the second step. EULA
      // persistence is deferred to completeLogin() so it only records on a
      // FULLY successful sign-in.
      setMfaToken(data.mfaToken);
      setMfaCode('');
      setUseBackupCode(false);
      setMfaMethods(methods);
      // The other ways through on THIS device (backup codes, an emailed
      // code). Absent ⇒ null ⇒ the shipped behaviour (see mfa-other-ways.ts).
      setMfaFallbacks(readMfaFallbacks(data));
      setOtherWaysOpen(false);
      setPasskeyMissed(false);
      setEmailChallenge(null);
      setEmailCode('');
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
        if (passkeyCapable) {
          // OFFER THE CHOICE FIRST, and start NOTHING (2026-09-21).
          // `startRequiredEnrollment` is not a render — it mints a real TOTP
          // secret on the server and parks it on the user's row. Firing it on
          // arrival would write provisional authenticator state onto the
          // account of every operator who then taps "use a passkey", which is
          // the outcome we expect most of them to choose. The secret is
          // minted when — and only when — they ask for one.
          setEnrollMethod('choice');
        } else {
          // No WebAuthn in this browser: today's step, byte for byte,
          // including starting enrollment immediately.
          setEnrollMethod('totp');
          await startRequiredEnrollment(data.mfaToken);
        }
      } else {
        clog.info('auth', 'MFA required — showing challenge step', { email, source });
        setEnrollRequired(false);
      }
      return;
    }
    if (res.ok && data?.access_token) {
      // Persist EULA acceptance + redirect via the shared completion helper.
      // Awaited: it may be preparing the passkey offer, and the caller's
      // "Signing in…" state must hold until the next screen is ready.
      await completeLogin(data);
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
      setError(useBackupCode ? t('mfaEnterBackupToFinish') : t('mfaEnterCodeToFinish'));
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
        // Awaited — this is the sign-in the passkey offer most often follows
        // (password + authenticator code), and "Verifying…" must hold until
        // the offer, or the dashboard, is ready.
        await completeLogin(data);
        return;
      }
      // MFA_TOKEN_INVALID → the partial token expired; send them back to
      // the start. Otherwise surface the specific code-mismatch message.
      if (data?.code === 'MFA_TOKEN_INVALID') {
        setMfaToken(null);
        setMfaCode('');
        setUseBackupCode(false);
        setError(t('mfaSetupTimedOut'));
      } else {
        clog.warn('auth', 'MFA challenge rejected', { status: res.status, code: data?.code });
        setError(data?.message || t('mfaCodeMismatch'));
      }
    } catch {
      setError(t('mfaVerifyUnreachable'));
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
    setEnrollMethod('totp');
    setPendingBackupCodes(null);
    setPendingSession(null);
    setMfaMethods(['totp']);
    setCodeFormOpen(false);
    setMfaFallbacks(null);
    setOtherWaysOpen(false);
    setPasskeyMissed(false);
    setEmailChallenge(null);
    setEmailCode('');
    setEmailCodeResent(false);
    setPhoneSetup(false);
    setPhoneSetupDevice(null);
    setPasskeyOnDevice(false);
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
  const reportPasskeyCeremonyError = (
    err: unknown,
    // The ceremony matters: `InvalidStateError` means "this device already
    // has a passkey for the account" only for a CREATE, and since 2026-09-22
    // a GET gets sign-in copy rather than sentences about "setting up" a
    // passkey. Defaulted to 'get' so the two sign-in call sites read exactly
    // as they did before enrollment joined them.
    ceremony: 'create' | 'get' = 'get',
  ): ReturnType<typeof describePasskeyError> => {
    const described = describePasskeyError(err, ceremony);
    if (described.quiet) { setError(''); return described; }
    setError(tRoot(described.messageKey as string));
    return described;
  };

  /** Map a REJECTED passkey HTTP response to copy. */
  const passkeyHttpError = (status: number, data: any): string => {
    // 429 keeps this page's existing behaviour — prefer whatever the server
    // says, because the rate limiter is the thing that knows the window.
    if (status === 429) return data?.message || t('passkeyTooMany');
    // The one refusal with its own sentence in the catalogs. Everything else
    // gets the translated generic line — the server's `message` is English
    // and would reach a Spanish or Chinese operator untranslated.
    if (data?.code === 'PASSKEY_ORIGIN_NOT_ALLOWED') return tRoot('passkeys.errWrongDomain');
    return t('passkeyRejected');
  };

  /**
   * The same map for a REGISTRATION. Separate because the sign-in copy —
   * "try again or sign in with your password" — is wrong advice mid-setup:
   * the password is how they got here, and it will not get them any further.
   * The 4xx bodies this door sends (already enrolled, not required, that
   * passkey is already registered) are specific and worth surfacing verbatim.
   */
  const passkeyEnrollHttpError = (status: number, data: any): string => {
    if (status === 429) return data?.message || t('passkeyTooMany');
    if (status === 401) return t('mfaSetupPasskeyFailed');
    return data?.message || t('mfaSetupPasskeyFailed');
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
    const token = mfaToken;
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
        setOtherWaysOpen(true);
        return;
      }

      let assertion;
      try {
        assertion = await getPasskey(optData.options);
      } catch (ceremonyErr) {
        // NEVER A DEAD END (2026-10-05). Cancelled, timed out, "no passkey
        // here" (iOS's cross-device QR code dismissed) — the browser reports
        // them all alike, and the likeliest story on a phone is that the
        // passkey lives on another device. Say so calmly and open the ways
        // that work on THIS one. A cancel still paints no red banner.
        reportPasskeyCeremonyError(ceremonyErr);
        logPasskeyMiss('mfa', ceremonyErr, true);
        if (mfaTokenRef.current !== token) return; // "Back" was pressed meanwhile
        setPasskeyMissed(true);
        setOtherWaysOpen(true);
        setCodeFormOpen(false);
        return;
      }

      const res = await fetch(`${API_URL}/auth/mfa/challenge/passkey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken, response: assertion }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.access_token) {
        // The passkey works from THIS device — next time, only "Use your passkey".
        await rememberPasskeyOnDevice(email);
        await completeLogin(data);
        return;
      }
      if (data?.code === 'MFA_TOKEN_INVALID') {
        cancelMfa();
        setError(t('mfaSetupTimedOut'));
        return;
      }
      clog.warn('auth', 'Passkey challenge rejected', { status: res.status, code: data?.code });
      setError(passkeyHttpError(res.status, data));
      setOtherWaysOpen(true);
    } catch {
      setError(t('mfaVerifyUnreachable'));
    } finally {
      setPasskeyBusy(false);
    }
  };

  /**
   * THE EMAILED CODE, step 1 — "Email a code to …" (2026-10-05).
   *
   * Needs the partial mfaToken (the password was proven); the API decides
   * whether this account may have one (`mfa-email-code.ts`) and the page only
   * offers it when the login response listed it. `resend` is "Send a new
   * code" — the API retires the older code when it sends a new one.
   */
  const sendEmailCode = async (opts: { resend?: boolean; guided?: boolean } = {}) => {
    if (!mfaToken || emailCodeBusy) return;
    const token = mfaToken;
    setError('');
    // Which path this code is for — "Email me a code", or the first step of
    // "Set up a passkey on this phone". A resend keeps whichever is open.
    if (!opts.resend) setPhoneSetup(!!opts.guided);
    setEmailCodeBusy('sending');
    let sent = false;
    try {
      const res = await fetch(`${API_URL}/auth/mfa/challenge/email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken: token }),
      });
      const data = await res.json().catch(() => ({}));
      if (mfaTokenRef.current !== token) return;
      if (res.ok && typeof data?.challenge === 'string') {
        clog.info('auth', 'Sign-in code emailed', { resend: !!opts.resend, guided: !!opts.guided });
        sent = true;
        setEmailChallenge(data.challenge);
        setEmailCode('');
        setEmailCodeResent(!!opts.resend);
        setCodeFormOpen(false);
        return;
      }
      if (data?.code === 'MFA_TOKEN_INVALID') {
        cancelMfa();
        setError(t('mfaSetupTimedOut'));
        return;
      }
      clog.warn('auth', 'Sign-in code not sent', { status: res.status, code: data?.code });
      setError(t(emailCodeSendErrorKey(res.status, data?.code)));
    } catch {
      setError(t('emailCodeUnreachable'));
    } finally {
      setEmailCodeBusy(false);
      // A first send that did not go out leaves no code form behind it.
      if (!sent && !opts.resend) setPhoneSetup(false);
    }
  };

  /**
   * "Set up a passkey on this phone" (2026-10-05) — ONE guided path. The
   * emailed code goes out at once (no separate "Email me a code" choice), and
   * it always comes first: a password alone never adds a passkey.
   */
  const startPhoneSetup = () => {
    void sendEmailCode({ guided: true });
  };

  /** "Back" from the set-up path's code: to the screen it was started from. */
  const leavePhoneSetup = () => {
    setEmailChallenge(null);
    setEmailCode('');
    setPhoneSetup(false);
    setError('');
  };

  /** THE EMAILED CODE, step 2 — trade it for the session. */
  const handleEmailCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailChallenge || emailCodeBusy) return;
    const trimmed = emailCode.trim();
    if (!trimmed) {
      setError(t('emailCodeEnter'));
      return;
    }
    setError('');
    setEmailCodeBusy('verifying');
    try {
      const res = await fetch(`${API_URL}/auth/mfa/challenge/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge: emailChallenge, code: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.access_token) {
        clog.info('auth', 'Signed in with an emailed code', { guided: phoneSetup });
        // Awaited: this is exactly the sign-in the "add a passkey for this
        // device" offer exists for, and "Verifying…" holds until it is ready.
        // On the set-up path it opens the ONE-button "Turn on" screen.
        await completeLogin(data, { guided: phoneSetup });
        return;
      }
      clog.warn('auth', 'Emailed code rejected', { status: res.status, code: data?.code });
      const refused = emailCodeVerifyError(res.status, data);
      setError(t(refused.key, refused.values));
    } catch {
      setError(t('mfaVerifyUnreachable'));
    } finally {
      setEmailCodeBusy(false);
    }
  };

  /** Back from a code form (authenticator, backup or emailed) to the list of ways. */
  const showOtherWays = () => {
    setCodeFormOpen(false);
    setEmailChallenge(null);
    setEmailCode('');
    setPhoneSetup(false);
    setMfaCode('');
    setUseBackupCode(false);
    setError('');
    setOtherWaysOpen(true);
  };

  /** Open the authenticator-code or backup-code form from the list. */
  const openCodeForm = (kind: 'totp' | 'backup') => {
    setUseBackupCode(kind === 'backup');
    setMfaCode('');
    setError('');
    setEmailChallenge(null);
    setCodeFormOpen(true);
  };

  /**
   * PASSWORDLESS, second half — trade a passkey assertion for the session.
   *
   * Shared by BOTH ways an assertion can arrive: the email field's autofill
   * (conditional mediation) and the "Sign in with a passkey" link. The verify
   * response is fed through applyLoginResponse, because it can still be a
   * second step. Returns nothing; every outcome is a state change.
   */
  const verifyPasswordlessAssertion = async (
    challengeId: unknown,
    assertion: unknown,
  ): Promise<void> => {
    // Step 1 has no "Keep me signed in" checkbox. The assertion carries the
    // account's opaque user handle, so the choice that account last made on
    // this browser can travel WITH the verify request (the server stamps the
    // session class there). Default: off — exactly an unticked box.
    const keepSignedIn = keepSignedInForPasskey(assertion);
    signInKeepRef.current = keepSignedIn;
    try {
      const res = await fetch(`${API_URL}/auth/passkeys/login/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, response: assertion, rememberMe: keepSignedIn }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        clog.warn('auth', 'Passkey sign-in rejected', { status: res.status, code: data?.code });
        setError(passkeyHttpError(res.status, data));
        return;
      }
      await applyLoginResponse(res, data, 'passkey', t('passkeyRejected'));
    } catch {
      setError(
        isLikelyMisconfigured() ? t('serverMissingApiUrl') : t('serverUnreachableAt', { url: API_URL }),
      );
    }
  };

  /**
   * PASSWORDLESS — the "Sign in with a passkey" link (step 1).
   *
   * Shown ONLY where the browser cannot offer passkeys from the email field's
   * own autofill; where it can, the autofill request below is the way in and
   * there is no link at all.
   *
   * Honours the SAME gate the password path does: the EULA (a second way in
   * must not be a way around the agreement). Step 1 has no checkbox, so the
   * link is only rendered once this browser has accepted — the guard here is
   * the belt to that.
   */
  const handlePasswordlessPasskey = async () => {
    if (!eulaAccepted) {
      setError(t('eulaRequired'));
      return;
    }
    setError('');
    setPasskeyHint(null);
    setPasskeyBusy(true);
    warnIfMisconfigured();
    clog.info('auth', 'Passwordless passkey attempt', { redirectTarget });
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
        // No account is known yet on this path, so `accountHasPasskeys` is null.
        logPasskeyMiss('passwordless', ceremonyErr, null);
        const described = reportPasskeyCeremonyError(ceremonyErr);
        if (described.quiet) {
          // The operator's own report: "it says I don't have one saved" —
          // that line is Safari's sheet, and dismissing it arrives here as
          // the same NotAllowedError a plain cancel does. No red banner (a
          // cancel is a decision), but not silence either: say what to do
          // next, and — when this device can hold a passkey — that signing
          // in with the password will offer to set one up.
          const canOffer = (await platformPasskeyAvailable()) && !isPasskeyOfferSnoozed();
          setPasskeyHint({ offer: canOffer, method: passkeyMethodFor() });
        }
        return;
      }

      await verifyPasswordlessAssertion(optData.challengeId, assertion);
    } catch {
      setError(
        isLikelyMisconfigured() ? t('serverMissingApiUrl') : t('serverUnreachableAt', { url: API_URL }),
      );
    } finally {
      setPasskeyBusy(false);
    }
  };

  // ── PASSKEY AUTOFILL on the email field (conditional mediation) ─────────
  // While step 1 is on screen, a pending `navigator.credentials.get({
  // mediation: 'conditional' })` lets the BROWSER list this device's passkey
  // in the email field's own suggestions. Someone who has one picks it and is
  // signed in; everyone else sees nothing extra — no button, no explainer.
  //
  // What makes this safe to leave pending:
  //  • It shows nothing and submits nothing by itself. The promise settles
  //    only when the person picks a credential in the browser's UI and
  //    passes its biometric/PIN check.
  //  • It is not an account oracle: the options are the same discoverable
  //    request for every visitor (no email is sent), and which passkeys exist
  //    is known only to the browser, never to this page, until one is used.
  //  • It can never sit in front of another ceremony: it is registered with
  //    the library's single abort service, so the second-factor passkey
  //    sheet (or the post-sign-in offer) aborts it before starting, and it is
  //    aborted explicitly the moment the operator presses Continue or leaves.
  //  • The EULA gate holds: it is armed only in a browser that has already
  //    accepted the agreement (step 1 has no checkbox to tick).
  const [conditionalAvailable, setConditionalAvailable] = useState<boolean | null>(null);
  /** Bumped to re-arm the autofill request after a picked passkey did not end in a session. */
  const [conditionalEpoch, setConditionalEpoch] = useState(0);
  /** A conditional request started by the effect below is still pending. */
  const conditionalPendingRef = useRef(false);
  // The latest verify handler, for an effect whose request can outlive renders.
  const verifyPasswordlessRef = useRef(verifyPasswordlessAssertion);
  useEffect(() => { verifyPasswordlessRef.current = verifyPasswordlessAssertion; });

  useEffect(() => {
    if (!passkeyCapable) return;
    let cancelled = false;
    void conditionalPasskeyAvailable().then((ok) => { if (!cancelled) setConditionalAvailable(ok); });
    return () => { cancelled = true; };
  }, [passkeyCapable]);

  /** No second factor, forced setup, backup codes or passkey offer is on screen. */
  const signInFormShowing = !mfaToken && !passkeyOffer && !pendingBackupCodes;
  /** Step 1 is on screen and idle — the only time the autofill request is armed. */
  const onEmailStep = step.name === 'email' && !manualSso && signInFormShowing;
  const conditionalArmed = onEmailStep && conditionalAvailable === true && eulaOnDevice;

  useEffect(() => {
    if (!conditionalArmed) return;
    let cancelled = false;
    void (async () => {
      let optData: { options?: Parameters<typeof getPasskeyFromAutofill>[0]; challengeId?: unknown } = {};
      try {
        const optRes = await fetch(`${API_URL}/auth/passkeys/login/options`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        optData = await optRes.json().catch(() => ({}));
        // Refused or throttled: no autofill this time. Never an error on
        // screen — nobody asked for anything yet.
        if (!optRes.ok || !optData?.options) return;
      } catch {
        return;
      }
      if (cancelled || !optData.options) return;

      let assertion;
      conditionalPendingRef.current = true;
      try {
        assertion = await getPasskeyFromAutofill(optData.options);
      } catch (err) {
        // Aborted (Continue, leaving, another ceremony) or unsupported after
        // all. Quiet by design; a real failure after a pick is reported by
        // the verify step, not here.
        clog.info('auth', 'Passkey autofill ended without a credential', {
          reason: describePasskeyError(err, 'get').reason,
        });
        // 2026-10-05 — NotAllowedError (unlike AbortError, which is OUR abort
        // on Continue / leaving) means the operator PICKED a passkey in the
        // autofill — on iOS, "a passkey from another device" — and its sheet
        // closed without one. Same calm pointer as the passkey link, and the
        // autofill is re-armed so it keeps working.
        // The request has SETTLED — mark it before the await below, so an
        // unmount meanwhile never "aborts" a ceremony this effect no longer owns.
        conditionalPendingRef.current = false;
        if (!cancelled && passkeyErrorName(err) === 'NotAllowedError') {
          logPasskeyMiss('autofill', err, null);
          const canOffer = (await platformPasskeyAvailable()) && !isPasskeyOfferSnoozed();
          if (!cancelled) {
            setPasskeyHint({ offer: canOffer, method: passkeyMethodFor() });
            setConditionalEpoch((n) => n + 1);
          }
        }
        return;
      } finally {
        conditionalPendingRef.current = false;
      }
      if (cancelled) return;

      // The operator picked a passkey in the browser's own UI.
      setError('');
      setPasskeyHint(null);
      setPasskeyBusy(true);
      clog.info('auth', 'Passkey autofill sign-in', { redirectTarget });
      try {
        await verifyPasswordlessRef.current(optData.challengeId, assertion);
      } finally {
        setPasskeyBusy(false);
        // If that did not end in a session or a next step, this effect is
        // still armed with a spent request — arm a fresh one.
        if (!cancelled && !sessionStartedRef.current) setConditionalEpoch((n) => n + 1);
      }
    })();
    return () => {
      cancelled = true;
      // Abort ONLY a request this effect started and that is still waiting.
      // A blanket cancel here could abort a modal ceremony that began after
      // the autofill request had already settled.
      if (conditionalPendingRef.current) {
        conditionalPendingRef.current = false;
        cancelPasskeyCeremony();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionalArmed, conditionalEpoch]);

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
   * The operator picked the authenticator app. ONLY NOW do we mint a secret.
   *
   * Before the choice screen this ran automatically on arrival, which was
   * fine when TOTP was the only option. It is not fine now: minting writes a
   * provisional secret onto the account, and doing that for someone who is
   * about to tap "use a passkey" is server-side state nobody asked for.
   */
  const chooseAuthenticatorApp = () => {
    if (!mfaToken) return;
    setError('');
    setEnrollMethod('totp');
    void startRequiredEnrollment(mfaToken);
  };

  /**
   * THE POINT OF THIS WAVE — set the required second factor up with Face ID,
   * Touch ID, Windows Hello or a security key, from the login page, with no
   * session and nothing to install.
   *
   * Ends on the SAME "save your backup codes" screen the authenticator path
   * ends on: `/auth/mfa/required/passkey/verify` returns the identical
   * envelope `/auth/mfa/required/verify` does, so the hand-off below is the
   * same code, not a parallel copy.
   *
   * Tap-driven, never auto-invoked: Safari requires a fresh user gesture for
   * `navigator.credentials.create()`, and the activation from the password
   * submit is long gone by the time this step renders.
   */
  const handleRequiredPasskeyEnroll = async () => {
    if (!mfaToken) return;
    setError('');
    setPasskeyBusy(true);
    try {
      // Options already fetched when this screen opened: go STRAIGHT to the
      // device, with nothing awaited first (see the effect above).
      const ready = requiredPasskeyOptsRef.current;
      requiredPasskeyOptsRef.current = null;
      let creationOptions: any = null;
      let ceremony: Promise<any> | null = null;
      if (ready && ready.token === mfaToken && Date.now() - ready.at < 4 * 60_000) {
        creationOptions = ready.options;
        ceremony = createPasskey(creationOptions);
      } else {
        const optRes = await fetch(`${API_URL}/auth/mfa/required/passkey/options`, {
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
          clog.warn('auth', 'Required-MFA passkey options rejected', { status: optRes.status, code: optData?.code });
          setError(passkeyEnrollHttpError(optRes.status, optData));
          return;
        }
        creationOptions = optData.options;
        ceremony = createPasskey(creationOptions);
      }

      let credential;
      try {
        credential = await ceremony;
      } catch (ceremonyErr) {
        // A dismissed Face ID sheet is a DECISION. Quiet, and the operator is
        // back on the choice with both options still open.
        reportPasskeyCeremonyError(ceremonyErr, 'create');
        return;
      }

      const res = await fetch(`${API_URL}/auth/mfa/required/passkey/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `label` so the operator's passkey list reads "iPhone" rather than a
        // credential id from the very first device. They can rename it later.
        body: JSON.stringify({ mfaToken, response: credential, label: guessDeviceLabel() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.access_token) {
        if (Array.isArray(data.backupCodes) && data.backupCodes.length) {
          // Park the session and show the codes FIRST. Redirecting past them
          // would silently throw away the only recovery path this account has
          // — and a passkey-only account has never seen a backup code before.
          setPendingSession(data);
          setPendingBackupCodes(data.backupCodes);
        } else {
          await completeLogin(data);
        }
        return;
      }
      if (data?.code === 'MFA_TOKEN_INVALID') {
        cancelMfa();
        setError(t('mfaSetupTimedOut'));
        return;
      }
      clog.warn('auth', 'Required-MFA passkey verify rejected', { status: res.status, code: data?.code });
      setError(passkeyEnrollHttpError(res.status, data));
    } catch {
      setError(t('mfaSetupUnreachable'));
    } finally {
      setPasskeyBusy(false);
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
          await completeLogin(data);
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
      setError(t('ssoSlugRequired'));
      return;
    }
    // The same gate every other way in has.
    if (!eulaAccepted) {
      setError(t('eulaRequired'));
      return;
    }
    setSsoChecking(true);
    try {
      // Ask the API which provider is configured for this tenant.
      const res = await fetch(`${API_URL}/auth/sso/${encodeURIComponent(ssoSlug.trim())}/config-public`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.enabled) {
        setError(t('ssoNotEnabled', { slug: ssoSlug.trim() }));
        setSsoChecking(false);
        return;
      }
      const provider = (data.provider as string).toLowerCase();
      if (!eulaOnDevice) stashPendingEulaAcceptance();
      // Navigate to the API SSO entry point; it will 302 to the IdP.
      leaveForSingleSignOn(`${API_URL}/auth/sso/${encodeURIComponent(ssoSlug.trim())}/${provider}/login`);
    } catch {
      setError(t('ssoUnreachable'));
      setSsoChecking(false);
    }
  };

  // ── Step 1 → step 2 ─────────────────────────────────────────────────────
  /**
   * "Continue". Asks the API what applies to this email's DOMAIN (single
   * sign-on or not — never anything about an account) and opens step 2.
   * `fetchSignInOptions` resolves `null` on any failure or after 3 s, which
   * the step machine reads as "password form": this lookup can never stand
   * between a person and signing in.
   */
  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = normalizeEmail(emailInput);
    if (!value || step.name !== 'email') return;
    setError('');
    setPasskeyHint(null);
    warnIfMisconfigured();
    // Leaving step 1 disarms the autofill request (its effect cleanup aborts
    // it) — the operator has chosen to continue without a passkey.
    dispatchStep({ type: 'CONTINUE', email: value });
    const options = await fetchSignInOptions(API_URL, value);
    dispatchStep({ type: 'OPTIONS', email: value, options });
  };

  /** Back to step 1 with the address still in the field. */
  const backToEmailStep = () => {
    dispatchStep({ type: 'CHANGE' });
    setPassword('');
    setError('');
    setSsoRedirecting(false);
  };

  // The browser's Back returns from step 2 to step 1 instead of leaving the
  // page: one synthetic history entry per visit to step 2 (the same device the
  // passkey offer uses).
  const stepHistoryPushedRef = useRef(false);
  const stepBackRef = useRef<() => void>(() => {});
  useEffect(() => {
    stepBackRef.current = () => {
      // The passkey offer answers its own Back (it pushed its own entry).
      if (passkeyOffer) return;
      stepHistoryPushedRef.current = false;
      // One-time backup codes are on screen: Back must not take them away.
      if (pendingBackupCodes) return;
      if (mfaToken) cancelMfa();
      backToEmailStep();
    };
  });
  const onMethodStep = step.name === 'method';
  useEffect(() => {
    if (!onMethodStep) return;
    if (!stepHistoryPushedRef.current) {
      try {
        window.history.pushState(STEP_HISTORY_STATE, '');
        stepHistoryPushedRef.current = true;
      } catch {
        /* no history API — "Change" still gets back */
      }
    }
    const onPop = () => stepBackRef.current();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onMethodStep]);

  /** "Change" next to the address on step 2. */
  const handleChangeEmail = () => {
    if (stepHistoryPushedRef.current) {
      // Drop our own history entry so Back from step 1 leaves the page, as it
      // always has. The popstate it raises finds step 1 already showing.
      stepHistoryPushedRef.current = false;
      try { window.history.back(); } catch { /* nothing to drop */ }
    }
    backToEmailStep();
  };

  // Say what the page just became — politely, and only on a CHANGE (the
  // first paint of step 1 is not announced; the page title already was).
  const announcedStepRef = useRef<string>('email');
  const stepKind =
    step.name === 'method' ? (step.sso && !step.passwordOpen ? 'sso' : 'password') : 'email';
  useEffect(() => {
    if (announcedStepRef.current === stepKind) return;
    announcedStepRef.current = stepKind;
    setStepAnnouncement(
      stepKind === 'sso'
        ? t('stepSsoAnnounce', { email })
        : stepKind === 'password'
          ? t('stepPasswordAnnounce', { email })
          : t('stepEmailAnnounce'),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKind]);

  /**
   * Step 2, single sign-on. The API 302s to the organization's identity
   * provider. The EULA gate is the same one the password form has.
   */
  const handleSsoContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (step.name !== 'method' || !step.sso) return;
    if (!eulaAccepted) {
      setError(t('eulaRequired'));
      return;
    }
    setError('');
    // The sign-in finishes on /login/sso-complete, after the round trip to
    // the identity provider. Park the tick; that page records it once the
    // session really exists — the same "only on a finished sign-in" rule the
    // password path follows.
    if (!eulaOnDevice) stashPendingEulaAcceptance();
    setSsoRedirecting(true);
    clog.info('auth', 'SSO sign-in started', { provider: step.sso.provider });
    leaveForSingleSignOn(ssoLoginUrl(API_URL, step.sso));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step.name !== 'method') return;
    if (!eulaAccepted) {
      setError(t('eulaRequired'));
      return;
    }
    setError('');
    // The "no passkey here yet" hint has done its job the moment the operator
    // takes the path it points to.
    setPasskeyHint(null);
    // A password sign-in follows the checkbox on this step, whatever an
    // earlier passkey attempt on this page decided.
    signInKeepRef.current = null;
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
      await applyLoginResponse(res, data, 'password', t('invalidCredentials'));
    } catch {
      setError(
        isLikelyMisconfigured() ? t('serverMissingApiUrl') : t('serverUnreachableAt', { url: API_URL }),
      );
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

  // ── Shared pieces of the two sign-in steps ─────────────────────────────
  /** Errors are announced the moment they appear. */
  const errorBanner = error ? (
    <div role="alert" className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
      <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" aria-hidden />
      <p className="text-xs text-rose-700 font-medium">{error}</p>
    </div>
  ) : null;

  /**
   * THE EMAILED CODE form (2026-10-05). `autocomplete="one-time-code"`, so
   * Safari on an iPhone offers the code from Mail above the keyboard — usually
   * one tap. "Send a new code" retires the old one (the API keeps only the
   * newest alive); "Use another way" returns to the list.
   */
  const emailCodeForm = (
    <form onSubmit={handleEmailCodeSubmit} className="space-y-4" data-testid="mfa-email-code-form">
      <div className="flex justify-center">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
          <Mail className="w-6 h-6 text-indigo-600" aria-hidden />
        </div>
      </div>
      <p className="text-sm text-slate-700 leading-relaxed text-center" aria-live="polite" data-testid="email-code-sent">
        {emailCodeResent ? t('emailCodeResent', { email }) : t('emailCodeSent', { email })}
      </p>
      <div>
        <label htmlFor="mfa-email-code" className="block text-xs font-semibold text-slate-700 mb-1.5">
          {t('emailCodeLabel')}
        </label>
        <input
          id="mfa-email-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={9}
          placeholder="123456"
          className={INPUT_CLS + ' tracking-[0.4em] text-center font-mono text-base'}
          value={emailCode}
          onChange={(e) => setEmailCode(e.target.value)}
          aria-describedby="mfa-email-code-help"
        />
        <p id="mfa-email-code-help" className="mt-1.5 text-[11px] text-slate-500">{t('emailCodeHelp')}</p>
      </div>

      {errorBanner}

      {/* On the set-up path the next screen is "Turn on Face ID…", so the
          button says Continue rather than promising the end of the sign-in. */}
      <button type="submit" disabled={emailCodeBusy === 'verifying'} className={PRIMARY_BTN_CLS + (phoneSetup ? ' min-h-[48px]' : '')}>
        {emailCodeBusy === 'verifying' ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> {t('verifying')}</>
        ) : (
          phoneSetup ? t('continue') : t('verifySignIn')
        )}
      </button>

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={phoneSetup ? leavePhoneSetup : showOtherWays}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 min-h-[44px]"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {phoneSetup ? t('back') : t('useAnotherWay')}
        </button>
        <button
          type="button"
          onClick={() => void sendEmailCode({ resend: true })}
          disabled={!!emailCodeBusy}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50 min-h-[44px]"
        >
          {emailCodeBusy === 'sending' ? t('emailCodeSending') : t('emailCodeResend')}
        </button>
      </div>
    </form>
  );

  /** Why the operator is back on this page, when the URL says so. */
  const reasonBanners = error ? null : (
    <>
      {/* 2026-09-11 — the invite was ACCEPTED and the password is set, but
          this organization requires two-factor, so there is no session yet.
          Say that plainly: without it the operator lands on a bare login form
          with no idea whether their invite worked. */}
      {authReason === 'invite-mfa' && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden />
          <p className="text-xs text-amber-800 font-medium">{t('inviteMfaSetupNeeded')}</p>
        </div>
      )}
      {authReason === 'session-expired' && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden />
          <p className="text-xs text-amber-800 font-medium">{t('sessionExpired')}</p>
        </div>
      )}
    </>
  );

  /** Step 2: who is signing in, and the way back to step 1. */
  const identityRow = (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
      <span className="min-w-0 break-all text-sm text-slate-900" data-testid="sign-in-email">{email}</span>
      <button
        type="button"
        onClick={handleChangeEmail}
        aria-label={t('changeEmail')}
        className="shrink-0 px-2 py-1.5 -mx-2 -my-1.5 rounded text-xs font-semibold text-indigo-600 hover:text-indigo-700"
      >
        {t('change')}
      </button>
    </div>
  );

  const eulaLink = (chunks: React.ReactNode) => (
    <Link
      href="/terms/eula"
      target="_blank"
      className="text-indigo-600 hover:text-indigo-700 underline underline-offset-2 font-semibold"
    >
      {chunks}
    </Link>
  );

  /**
   * EULA acceptance — REQUIRED, for a browser that has not accepted this
   * version. Unticked by default. Two independent locks, as before:
   *   1. `required` — the browser will not submit the form without it;
   *   2. every submit handler refuses without `eulaAccepted`.
   * `onInvalid` only swaps the browser's own bubble (in the browser's
   * language, at the browser's whim) for OUR translated, announced message —
   * the submit stays blocked either way.
   * Once accepted on this browser it is not rendered again (`eulaNote`).
   *
   * `first`: on a step with nothing to type (single sign-on), this checkbox
   * IS the first field, so it takes the focus the password field would.
   */
  const renderEulaCheckbox = (first = false) => eulaOnDevice ? null : (
    <label className="flex items-start gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        required
        autoFocus={first}
        checked={eulaChecked}
        onChange={e => { setEulaChecked(e.target.checked); setError(''); }}
        onInvalid={(e) => { e.preventDefault(); setError(t('eulaRequired')); }}
        className="w-4 h-4 mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
        aria-describedby="eula-text"
      />
      <span id="eula-text" className="text-[11px] leading-snug text-slate-600">
        {t.rich('eulaAgree', { link: eulaLink })}
      </span>
    </label>
  );

  /**
   * The offer card's check mark: a saved passkey, its backup codes — and on
   * the guided screen every after-state, which all say "You're signed in".
   */
  const offerCheckMark =
    offerPhase === 'done' ||
    offerPhase === 'codes' ||
    (!!passkeyOffer?.guided && offerPhase !== 'ready' && offerPhase !== 'working');

  /** The quiet line a browser that already accepted gets instead. */
  const eulaNote = eulaOnDevice ? (
    <p className="text-center text-balance text-[11px] leading-snug text-slate-500" data-testid="eula-accepted-note">
      {t.rich('eulaAcceptedNote', { link: eulaLink })}
    </p>
  ) : null;

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
            {passkeyOffer?.guided
              ? (offerPhase === 'ready' || offerPhase === 'working'
                ? t('phoneSetupTurnOnTitle', { device: passkeyOffer.device })
                : offerPhase === 'codes'
                  ? t('mfaBackupCodesTitle')
                  : t('phoneSetupSignedInTitle'))
              : passkeyOffer
              ? (offerPhase === 'done'
                ? t('passkeyOfferDoneTitle')
                : offerPhase === 'codes'
                  ? t('mfaBackupCodesTitle')
                  : t('passkeyOfferTitle', { method: t(PASSKEY_METHOD_KEYS[passkeyOffer.method]) }))
              : pendingBackupCodes
              ? t('mfaBackupCodesTitle')
              : enrollRequired
                ? t('mfaSetupTitle')
                : mfaToken
                  ? t('twoFactorTitle')
                  : t('signInTitle', { brand: brand.name })}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {passkeyOffer?.guided
              ? (offerPhase === 'ready' || offerPhase === 'working'
                ? t('phoneSetupTurnOnSub')
                : offerPhase === 'codes'
                  ? t('mfaBackupCodesSubtitle')
                  : null)
              : passkeyOffer
              ? (offerPhase === 'done'
                ? t('passkeyOfferDoneBody', { method: t(PASSKEY_METHOD_KEYS[passkeyOffer.method]) })
                : offerPhase === 'codes'
                  ? t('mfaBackupCodesSubtitle')
                  : t(passkeyOffer.withCode ? 'passkeyOfferBodyWithCode' : 'passkeyOfferBody', {
                    method: t(PASSKEY_METHOD_KEYS[passkeyOffer.method]),
                  }))
              : pendingBackupCodes
              ? t('mfaBackupCodesSubtitle')
              : enrollRequired
                ? t('mfaSetupSubtitle')
                : mfaToken
                  ? (emailChallenge
                    ? (phoneSetup && phoneSetupDevice
                      ? t('phoneSetupCodeSub', { device: phoneSetupDevice })
                      : t('emailCodeSubtitle'))
                    : phoneChoices && !codeFormOpen
                      ? t('phoneChoiceSub', { device: phoneSetupDevice ?? 'other' })
                      : passkeyStepAvailable && !codeFormOpen
                        ? t('mfaUsePasskeySub')
                        : useBackupCode ? t('mfaEnterBackup') : t('mfaEnterCode'))
                  : brand.tagline}
          </p>
        </div>

        {/* card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-7">
          {passkeyOffer ? (
            /* ── THE POST-SIGN-IN PASSKEY OFFER (2026-09-22) ─────────────
               The operator is already signed in; this is one optional screen
               before the dashboard. Every exit — Set up, Not now, Continue,
               Esc, Back — ends on the destination the sign-in was headed for.
               The only hold is the one-time backup codes of a FIRST factor. */
            <div
              className="space-y-4"
              data-testid="passkey-offer"
              data-phase={offerPhase}
              data-guided={passkeyOffer.guided ? 'true' : undefined}
            >
              <div className="flex justify-center">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    offerCheckMark ? 'bg-emerald-50' : 'bg-indigo-50'
                  }`}
                >
                  {offerCheckMark ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                  ) : (
                    <Fingerprint className="w-6 h-6 text-indigo-600" />
                  )}
                </div>
              </div>

              {/* PERSISTENT live region for the whole offer: a node that
                  appears at the same moment as its text is not reliably
                  announced, so this one is there from the first phase. */}
              <div aria-live="polite">
                {passkeyOffer.guided && (offerPhase === 'cancelled' || offerPhase === 'failed') ? (
                  /* The guided path's ONE line when no passkey was made
                     (2026-10-05): calm, never red — the emailed code already
                     signed the person in, and this is not a failure of theirs. */
                  <p data-testid="phone-setup-later" className="text-sm text-slate-700 leading-relaxed text-center">
                    {t('phoneSetupLater')}
                  </p>
                ) : offerPhase === 'failed' ? (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-rose-700 font-medium">{t('passkeyOfferFailed')}</p>
                  </div>
                ) : offerPhase === 'cancelled' ? (
                  <p className="text-xs text-slate-600 leading-relaxed text-center">{t('passkeyOfferCancelled')}</p>
                ) : offerPhase === 'exists' ? (
                  <p className="text-xs text-slate-600 leading-relaxed text-center">{t('passkeyOfferExists')}</p>
                ) : offerPhase === 'done' || offerPhase === 'codes' ? (
                  <span className="sr-only">{t('passkeyOfferDoneTitle')}</span>
                ) : null}
              </div>

              {/* Each phase is its OWN keyed subtree. Without the keys React
                  reuses the previous phase's <button> for the next phase's —
                  "Not now" became "Continue" mid-`transition-colors` and
                  painted pale for a frame. */}
              {passkeyOffer.guided && (offerPhase === 'ready' || offerPhase === 'working') ? (
                <Fragment key="offer-guided">
                  {/* THE ONE BUTTON (2026-10-05). The person asked for this —
                      "Set up a passkey on this iPhone", then the emailed code
                      — so there is nothing else to choose here. Its handler
                      calls create() before anything else (the options are
                      already here): Safari sees the ceremony inside this tap.
                      Cancelled or refused, the screen says "add it later" and
                      the person is still signed in. */}
                  <button
                    ref={offerPrimaryRef}
                    type="button"
                    data-testid="phone-setup-turn-on"
                    onClick={startOfferSetUp}
                    disabled={offerPhase === 'working'}
                    className={TURN_ON_BTN_CLS}
                  >
                    {offerPhase === 'working' ? (
                      <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('mfaSetupPasskeyWaiting')}</>
                    ) : (
                      <><Fingerprint className="w-5 h-5" aria-hidden /> {t('phoneSetupTurnOnButton', { device: passkeyOffer.device })}</>
                    )}
                  </button>
                </Fragment>
              ) : offerPhase === 'ready' || offerPhase === 'working' ? (
                <Fragment key="offer-ask">
                  {/* PRIMARY. Its handler calls create() before anything
                      else — the options are already here — so Safari sees
                      the ceremony inside this tap. */}
                  <button
                    ref={offerPrimaryRef}
                    type="button"
                    onClick={startOfferSetUp}
                    disabled={offerPhase === 'working'}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {offerPhase === 'working' ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> {t('mfaSetupPasskeyWaiting')}</>
                    ) : (
                      // "Add a passkey for this iPhone" (2026-10-05) — the
                      // device is named, so it is obvious the passkey being
                      // made lives on THIS one.
                      <><Fingerprint className="w-4 h-4" /> {tRoot('passkeys.addForDevice', { device: passkeyDeviceKind() })}</>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => leaveOffer('session')}
                    disabled={offerPhase === 'working'}
                    className="w-full py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('passkeyOfferNotNow')}
                  </button>
                  {/* The 30-day answer is its OWN quiet choice (2026-09-24).
                      "Not now" holds for this session; only this puts the
                      offer away for a month on this device. slate-500, not
                      400: the card is white and slate-400 fails AA here. */}
                  <button
                    type="button"
                    onClick={() => leaveOffer('thirty-days')}
                    disabled={offerPhase === 'working'}
                    className="w-full py-1 text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('passkeyOfferDontAsk')}
                  </button>
                  <p className="text-[11px] leading-snug text-slate-500 text-center">
                    {t('passkeyOfferFootnote')}
                  </p>
                </Fragment>
              ) : offerPhase === 'codes' && offerCodes ? (
                <Fragment key="offer-codes">
                  <p className="text-xs text-slate-600 leading-relaxed">{t('mfaBackupCodesHelp')}</p>
                  <ul className="grid grid-cols-2 gap-1.5 bg-slate-50 rounded-lg p-3 list-none">
                    {offerCodes.map((c) => (
                      <li key={c} className="font-mono text-xs text-slate-700 select-all text-center">{c}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard?.writeText(offerCodes.join('\n')); }}
                    className="w-full border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    {t('mfaCopyCodes')}
                  </button>
                  <button
                    ref={offerPrimaryRef}
                    type="button"
                    onClick={() => leaveOffer('none')}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors"
                  >
                    {t('mfaSavedCodesContinue')}
                  </button>
                </Fragment>
              ) : (
                <Fragment key="offer-after">
                  {/* done / cancelled / failed / exists — the sentence is in
                      the live region above; this is the way on. */}
                  <button
                    ref={offerPrimaryRef}
                    type="button"
                    onClick={() => leaveOffer(offerPhase === 'done' ? 'none' : 'session')}
                    className={
                      'w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors' +
                      (passkeyOffer.guided ? ' min-h-[48px]' : '')
                    }
                  >
                    {t('passkeyOfferContinue')}
                  </button>
                </Fragment>
              )}
            </div>
          ) : pendingBackupCodes ? (
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
                onClick={() => { const s = pendingSession; setPendingBackupCodes(null); setPendingSession(null); if (s) void completeLogin(s); }}
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

              {/* ── PICK A FACTOR (2026-09-21) ───────────────────────────
                  Only rendered when this browser can actually create a
                  passkey. Otherwise `enrollMethod` is 'totp' from the start
                  and the fragment below renders today's step, unchanged —
                  no disabled button, no "your browser doesn't support this"
                  dead end on a screen the operator cannot leave. */}
              {enrollMethod === 'choice' ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {t('mfaSetupChooseHelp')}
                  </p>

                  {/* PRIMARY. One tap, on purpose — Safari needs a fresh
                      user gesture for navigator.credentials.create(). */}
                  <button
                    ref={enrollPasskeyBtnRef}
                    type="button"
                    onClick={handleRequiredPasskeyEnroll}
                    disabled={passkeyBusy}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {passkeyBusy ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> {t('mfaSetupPasskeyWaiting')}</>
                    ) : (
                      <><Fingerprint className="w-4 h-4" /> {t('mfaSetupUsePasskey')}</>
                    )}
                  </button>
                  <p className="text-[11px] leading-snug text-slate-500 text-center">
                    {t('mfaSetupPasskeyWhy')}
                  </p>

                  {/* The authenticator app stays a first-class option — a
                      shared workstation, a borrowed laptop, or an operator
                      who already has one all need it. */}
                  <button
                    type="button"
                    onClick={chooseAuthenticatorApp}
                    disabled={passkeyBusy}
                    className="w-full text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('mfaSetupUseAuthenticator')}
                  </button>

                  {/* PERSISTENT live region: a node that appears at the same
                      moment its text does is not reliably announced. */}
                  <div aria-live="polite">
                    {error && (
                      <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                        <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-rose-700 font-medium">{error}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
              <>
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
              </>
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
            emailChallenge ? emailCodeForm
            : passkeyStepAvailable ? (
              <div className="space-y-4" data-testid="mfa-passkey-step">
                <div className="flex justify-center">
                  <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
                    <Fingerprint className="w-6 h-6 text-indigo-600" />
                  </div>
                </div>

                {phoneChoices && phoneSetupDevice ? (
                  /* A PHONE OR TABLET (2026-10-05): two EQUAL choices before
                     any sheet opens. "Use your passkey" is today's button;
                     "Set up a passkey on this iPhone" emails the code at once
                     and then asks for ONE tap of Face ID / Touch ID. The page
                     cannot know where the passkey lives — the person can. */
                  <div className="space-y-3" data-testid="phone-passkey-choices">
                    {/* Equal rows (`auto-rows-fr`): when one label wraps — it
                        does in Spanish — both choices stay the same height. */}
                    <div className="grid grid-cols-1 auto-rows-fr gap-3">
                    <button
                      ref={passkeyStepBtnRef}
                      type="button"
                      onClick={handlePasskeyChallenge}
                      disabled={passkeyBusy || !!emailCodeBusy}
                      className={CHOICE_BTN_CLS}
                    >
                      {passkeyBusy ? (
                        <><Loader2 className="w-5 h-5 shrink-0 animate-spin" aria-hidden /> {t('verifying')}</>
                      ) : (
                        <><Fingerprint className="w-5 h-5 shrink-0" aria-hidden /> {t('usePasskey')}</>
                      )}
                    </button>
                    <button
                      type="button"
                      data-testid="phone-setup-choice"
                      onClick={startPhoneSetup}
                      disabled={passkeyBusy || !!emailCodeBusy}
                      aria-describedby="phone-setup-why"
                      className={CHOICE_BTN_CLS}
                    >
                      {emailCodeBusy === 'sending' ? (
                        <><Loader2 className="w-5 h-5 shrink-0 animate-spin" aria-hidden /> {t('emailCodeSending')}</>
                      ) : (
                        <><Smartphone className="w-5 h-5 shrink-0" aria-hidden /> {t('phoneSetupChoice', { device: phoneSetupDevice })}</>
                      )}
                    </button>
                    </div>
                    <p id="phone-setup-why" className="text-[11px] leading-snug text-slate-500 text-center">
                      {t('phoneSetupChoiceWhy')}
                    </p>
                  </div>
                ) : (
                /* PRIMARY control. One tap, on purpose — Safari needs a
                    fresh user gesture for navigator.credentials.get(), and
                    the activation from the password submit is long gone by
                    the time this step renders. */
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
                    <><Fingerprint className="w-4 h-4" /> {passkeyMissed ? t('passkeyTryAgain') : t('usePasskey')}</>
                  )}
                </button>
                )}

                {codeFormOpen ? (
                  <>
                    {codeChallengeForm}
                    {/* The way back to the list — the code form keeps its own
                        Back (to the password) and its own code/backup toggle. */}
                    <div className="text-center">
                      <button type="button" onClick={showOtherWays} className={LINK_BTN_CLS}>
                        {t('useAnotherWay')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* NEVER A DEAD END (2026-10-05). Persistent live region:
                        the calm "may be on another device" line after the
                        sheet closes with nothing, or a real error. */}
                    <div aria-live="polite">
                      {error ? (
                        <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                          <p className="text-xs text-rose-700 font-medium">{error}</p>
                        </div>
                      ) : passkeyMissed ? (
                        <p data-testid="passkey-elsewhere-note" className="text-sm text-slate-700 leading-relaxed text-center">
                          {t('passkeyElsewhereNote')}
                        </p>
                      ) : phoneSetupBlocked && phoneSetupDevice ? (
                        /* No emailed code for this sign-in, so no setting a
                           passkey up here: say where the passkey works. */
                        <p data-testid="phone-setup-unavailable" className="text-xs text-slate-600 leading-relaxed text-center">
                          {t('phoneSetupUnavailable', { device: phoneSetupDevice })}
                        </p>
                      ) : null}
                    </div>

                    {otherWaysOpen ? (
                      <div role="group" aria-label={t('otherWaysLabel')} data-testid="mfa-other-ways" className="space-y-2">
                        {listedWays.map((way, i) => (
                          <button
                            key={way}
                            ref={i === 0 ? firstOtherWayRef : undefined}
                            type="button"
                            data-way={way}
                            disabled={
                              (way === 'email' || way === 'phone-setup') && emailCodeBusy === 'sending'
                            }
                            onClick={() =>
                              way === 'phone-setup'
                                ? startPhoneSetup()
                                : way === 'email'
                                  ? void sendEmailCode()
                                  : openCodeForm(way)
                            }
                            className={
                              way === 'phone-setup'
                                // Leads the list after a miss (2026-10-05):
                                // the likeliest story on a phone is that the
                                // passkey lives on another device.
                                ? 'w-full min-h-[48px] border-2 border-indigo-300 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-indigo-800 text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2'
                                : 'w-full min-h-[44px] border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2'
                            }
                          >
                            {way === 'phone-setup' && (emailCodeBusy === 'sending' && phoneSetup
                              ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('emailCodeSending')}</>
                              : <><Smartphone className="w-4 h-4 text-indigo-600" aria-hidden /> {t('phoneSetupChoice', { device: phoneSetupDevice ?? 'other' })}</>)}
                            {way === 'totp' && <><ShieldCheck className="w-4 h-4 text-slate-500" aria-hidden /> {t('otherWayAuthenticator')}</>}
                            {way === 'backup' && <><ShieldCheck className="w-4 h-4 text-slate-500" aria-hidden /> {t('useBackupCode')}</>}
                            {way === 'email' && (emailCodeBusy === 'sending' && !phoneSetup
                              ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('emailCodeSending')}</>
                              : <><Mail className="w-4 h-4 text-slate-500" aria-hidden /> {t('otherWayEmail')}</>)}
                          </button>
                        ))}
                        {/* No emailed code here (mail not configured, or a
                            password reset is too fresh): say where the
                            passkey DOES work, and how to bring it here. */}
                        {!otherWays.includes('email') && (
                          <p data-testid="other-way-device-hint" className="text-xs text-slate-600 leading-relaxed text-center">
                            {otherWays.length === 0 ? t('otherWayNone') : t('otherWayDeviceHint')}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="text-center">
                        <button
                          type="button"
                          data-testid="use-another-way"
                          onClick={() => { setOtherWaysOpen(true); setError(''); }}
                          className={LINK_BTN_CLS}
                        >
                          {t('useAnotherWay')}
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={cancelMfa}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" /> {t('back')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                {codeChallengeForm}
                {/* The authenticator-only account (or a browser with no
                    WebAuthn) gets the emailed code too — but ONLY when the API
                    listed it, so with an older API, or with mail off, this
                    branch is the exact markup that has always shipped. */}
                {otherWays.includes('email') && (
                  <div className="text-center mt-3">
                    <button
                      type="button"
                      data-testid="email-code-instead"
                      onClick={() => void sendEmailCode()}
                      disabled={emailCodeBusy === 'sending'}
                      className={LINK_BTN_CLS}
                    >
                      {emailCodeBusy === 'sending' ? t('emailCodeSending') : t('emailCodeInstead')}
                    </button>
                  </div>
                )}
              </>
            )
          ) : (
          manualSso ? (
            /* ── SUPPORT-ONLY manual single sign-on entry (`/login?sso=1`) ──
               The form that used to sit behind the always-visible "Sign in
               with SSO" button. Nothing on the page links here; the normal
               way in is the email's domain on step 2. */
            <form key="manual-sso" onSubmit={handleSsoStart} className="space-y-4">
              <div>
                <label htmlFor="sso-slug" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {t('orgSlug')}
                </label>
                <input
                  id="sso-slug"
                  type="text"
                  autoFocus
                  autoComplete="organization"
                  placeholder="acme-co"
                  value={ssoSlug}
                  onChange={(e) => setSsoSlug(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              {renderEulaCheckbox()}
              {errorBanner}
              <button
                type="submit"
                disabled={ssoChecking}
                className={PRIMARY_BTN_CLS}
              >
                {ssoChecking ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('redirecting')}</> : t('continueSSO')}
              </button>
              {eulaNote}
            </form>
          ) : step.name !== 'method' ? (
            /* ── STEP 1 — one field ─────────────────────────────────────
               The email, and Continue. `autocomplete="username webauthn"`
               is what lets the browser list this device's passkey in the
               field's own suggestions (see the autofill effect above).

               NO `name` ON ANY FIELD OF THESE FORMS, deliberately (the page
               never had them). A Continue pressed before React has hydrated
               is a NATIVE form submit — a GET to this same URL — and a named
               field would put what was typed into the address bar, the
               history and the server log. Unnamed, that submit carries
               nothing. Password managers key on `type` + `autocomplete`. */
            <form key="step-email" onSubmit={handleContinue} className="space-y-4" data-testid="sign-in-step-email">
              <div>
                <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1.5">{t('email')}</label>
                <input
                  id="login-email"
                  type="email"
                  required
                  autoFocus
                  maxLength={254}
                  autoComplete="username webauthn"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t('emailPlaceholder')}
                  className={INPUT_CLS}
                  value={emailInput}
                  // Frozen while the lookup is in flight — by ignoring edits,
                  // NOT by `readOnly`/`disabled`, which would drop focus (and
                  // the phone keyboard) a moment before the password field
                  // takes it.
                  onChange={e => { if (step.name === 'email') setEmailInput(e.target.value); }}
                />
              </div>

              {reasonBanners}
              {errorBanner}

              <button
                type="submit"
                disabled={step.name === 'checking' || passkeyBusy}
                aria-busy={step.name === 'checking' || passkeyBusy}
                className={PRIMARY_BTN_CLS}
              >
                {(step.name === 'checking' || passkeyBusy) && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                {t('continue')}
              </button>

              {/* Only where the browser CANNOT offer passkeys from the field's
                  autofill. One quiet link, same handler as before; no
                  explainer box — the post-sign-in offer is what teaches
                  people to set a passkey up. Not rendered until this browser
                  has accepted the EULA (step 1 has no checkbox to tick). */}
              {passkeyCapable && conditionalAvailable === false && eulaOnDevice && (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={handlePasswordlessPasskey}
                    disabled={passkeyBusy || step.name === 'checking'}
                    className={LINK_BTN_CLS}
                  >
                    {t('signInWithPasskey')}
                  </button>
                </div>
              )}
              {/* "Your passkey may be on another device" — a calm pointer
                  after the device sheet closes with no credential, from the
                  link above OR the email field's autofill (where iOS offers
                  "a passkey from another device"). The way on is the email
                  and password on THIS page, so it is named as a button that
                  takes you there. Persistent live region so a screen reader
                  hears it. */}
              <div aria-live="polite" className="text-center">
                {passkeyHint && !error && (
                  <div data-testid="passkey-none-hint" className="mt-1 space-y-2">
                    <p className="text-xs text-slate-700 leading-relaxed">{t('passkeyElsewhereNote')}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setPasskeyHint(null);
                        document.getElementById('login-email')?.focus();
                      }}
                      className="w-full min-h-[44px] border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors"
                    >
                      {t('passkeyUseEmailInstead')}
                    </button>
                    {passkeyHint.offer && (
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        {t('passkeyNoneHintOffer', { method: t(PASSKEY_METHOD_KEYS[passkeyHint.method]) })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </form>
          ) : step.sso && !step.passwordOpen ? (
            /* ── STEP 2 — this organization signs in with single sign-on ──
               Decided by the email's DOMAIN alone. One primary action; the
               password form is one link away, because a domain claim is not
               proof and nobody may be locked out by it. */
            <form key="step-sso" onSubmit={handleSsoContinue} className="space-y-4" data-testid="sign-in-step-sso">
              {identityRow}
              <p className="text-xs text-slate-600 leading-relaxed">{t('ssoExplain')}</p>

              {renderEulaCheckbox(true)}
              {errorBanner}

              {/* Focus: the EULA checkbox when there is one (it is the
                  step's first field), otherwise the primary action. */}
              <button
                type="submit"
                autoFocus={eulaOnDevice}
                disabled={ssoRedirecting}
                className={PRIMARY_BTN_CLS}
              >
                {ssoRedirecting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> {t('redirecting')}</>
                ) : step.sso.label ? (
                  t('continueWithProvider', { provider: step.sso.label })
                ) : (
                  t('continueWithSso')
                )}
              </button>

              {step.passwordAllowed && (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => { setError(''); dispatchStep({ type: 'USE_PASSWORD' }); }}
                    className={LINK_BTN_CLS}
                  >
                    {t('usePasswordInstead')}
                  </button>
                </div>
              )}

              {eulaNote}
            </form>
          ) : (
            /* ── STEP 2 — password ─────────────────────────────────────── */
            <form key="step-password" onSubmit={handleLogin} className="space-y-4" data-testid="sign-in-step-password">
              {identityRow}
              {/* For password managers: the account this password belongs
                  to. Not shown, not focusable — the address is on screen in
                  the row above. */}
              <input
                type="email"
                autoComplete="username"
                value={email}
                readOnly
                hidden
                tabIndex={-1}
                aria-hidden="true"
              />
              <div>
                <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700 mb-1.5">{t('password')}</label>
                <input
                  id="login-password"
                  type="password"
                  required
                  autoFocus
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={INPUT_CLS}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span className="text-xs font-medium text-slate-600">{t('keepSignedIn')}</span>
                </label>
                {/* Carries the address forward so it is not typed twice —
                    through sessionStorage, consumed by the reset page on
                    arrival; never the URL. */}
                <Link
                  href="/reset-password/request"
                  onClick={() => stashEmailForReset(email)}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  {t('forgotPassword')}
                </Link>
              </div>

              {renderEulaCheckbox()}
              {errorBanner}

              {/* Stays enabled when the EULA is unticked (only `loading`
                  disables), so pressing it — or Enter — says WHY nothing
                  happened instead of looking dead (2026-06-09 Fable audit). */}
              <button
                type="submit"
                disabled={loading}
                className={PRIMARY_BTN_CLS}
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> {t('signingIn')}</>
                ) : (
                  t('signIn')
                )}
              </button>

              {eulaNote}
            </form>
          )
          )}
        </div>

        {/* What the page just became, for a screen reader. Persistent node:
            a live region that appears together with its text is not reliably
            announced. */}
        <p className="sr-only" aria-live="polite" data-testid="sign-in-step-announcement">{stepAnnouncement}</p>

        {/* Step 1 only (including while its lookup is in flight): someone who
            is already typing a password or a code is not looking for "create
            a workspace". */}
        {step.name !== 'method' && signInFormShowing && (
          <p className="text-center text-xs text-slate-500 mt-6">
            {t('newHere')} <Link href="/signup" className="text-indigo-600 hover:text-indigo-700 font-semibold">{t('createWorkspace')}</Link>
          </p>
        )}

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
