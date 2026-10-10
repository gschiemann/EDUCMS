/**
 * FIRST SIGN-IN ORDER (2026-10-10) — the hand-off from first-login setup to
 * the sign-in screen's required two-step setup.
 *
 * `/auth/complete-setup` saves the person's own email + password and then,
 * when their role requires a second factor, answers with the same enrollment
 * envelope `/auth/login` would (`mfaEnrollmentRequired` + a 5-minute
 * `mfaToken`) instead of a session. The sign-in page already owns that flow
 * (passkey or authenticator), so the setup screen parks the envelope here and
 * navigates there; the sign-in page takes it ONCE on mount and resumes — no
 * password to type again.
 *
 * sessionStorage (this tab only), removed the moment it is read, refused when
 * older than the token's life. Every access is wrapped: Safari private mode
 * and locked-down kiosks throw on storage, and a failure only means the person
 * signs in once more with the password they just chose.
 */
export const SETUP_TWO_STEP_HANDOFF_KEY = 'venueos_setup_two_step';
/** Just under the server's 5-minute mfaToken life. */
export const SETUP_TWO_STEP_MAX_AGE_MS = 4.5 * 60_000;

export type SetupTwoStepEnvelope = {
  mfaRequired: true;
  mfaEnrollmentRequired?: boolean;
  mfaMethods?: string[];
  mfaToken: string;
};

export type SetupTwoStepHandoff = { email: string; envelope: SetupTwoStepEnvelope };

/** Is this a /complete-setup (or /setup-link/redeem) answer that owes a second step? */
export function isTwoStepEnvelope(data: unknown): data is SetupTwoStepEnvelope {
  const d = data as Record<string, unknown> | null;
  return !!d && d.mfaRequired === true && typeof d.mfaToken === 'string' && d.mfaToken.length > 0;
}

export function stashSetupTwoStep(email: string, envelope: SetupTwoStepEnvelope, now = Date.now()): boolean {
  try {
    if (typeof window === 'undefined') return false;
    window.sessionStorage.setItem(
      SETUP_TWO_STEP_HANDOFF_KEY,
      JSON.stringify({
        email: email.trim().toLowerCase(),
        envelope: {
          mfaRequired: true,
          mfaEnrollmentRequired: !!envelope.mfaEnrollmentRequired,
          mfaMethods: Array.isArray(envelope.mfaMethods) ? envelope.mfaMethods : [],
          mfaToken: envelope.mfaToken,
        },
        at: now,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function takeSetupTwoStep(now = Date.now()): SetupTwoStepHandoff | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(SETUP_TWO_STEP_HANDOFF_KEY);
    window.sessionStorage.removeItem(SETUP_TWO_STEP_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: unknown; envelope?: unknown; at?: unknown };
    if (typeof parsed.at !== 'number' || now - parsed.at > SETUP_TWO_STEP_MAX_AGE_MS || now < parsed.at) return null;
    if (typeof parsed.email !== 'string' || parsed.email.length > 254) return null;
    if (!isTwoStepEnvelope(parsed.envelope)) return null;
    return { email: parsed.email, envelope: parsed.envelope };
  } catch {
    return null;
  }
}
