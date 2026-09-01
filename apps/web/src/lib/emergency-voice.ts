/**
 * Spoken emergency announcements — OFF unless the operator turns them on.
 *
 * Mobile design package §M17 ("Emergency trigger"):
 *   > Header: … Silent status: **Silent** by default.
 *   > Do not speak aloud by default. A user-enabled audio setting must
 *   > clearly indicate that the phone may make sound.
 * §21 wave 0 item 2: "Default Emergency to silent."
 * §15 (accessibility):
 *   > Screen-reader announcements describe changes once; do not duplicate
 *   > them with forced text-to-speech.
 * §20 QA: "[ ] Triggering is silent by default." /
 *         "[ ] Screen-reader updates are not duplicated by forced TTS."
 *
 * WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * The emergency surfaces announced every phase transition (holding →
 * dispatching → sent → cleared) two ways at once: an `aria-live="assertive"`
 * region AND an unconditional `speechSynthesis.speak()`. Both were added for
 * the same, correct reason — ADA Title II / Section 504 equivalence for an
 * operator who cannot see the screen. Only ONE of them is the mechanism that
 * obligation actually names.
 *
 * The live region IS the accessibility contract, and it is untouched here:
 * assertive, atomic, announced by the operator's own screen reader in their
 * own voice, at their own rate, through their own output device. The forced
 * utterance on top of it was a second, uncontrollable voice that:
 *   - read the SAME message a screen reader had just read (§15's duplication),
 *   - could not be silenced by the operator's assistive-tech settings, and
 *   - made the phone speak "Holding lockdown alert…" OUT LOUD, from a pocket,
 *     during the one event where an occupant's audible position may be the
 *     thing they most need to control.
 *
 * So speech becomes opt-in. Silent is the default; the preference persists
 * per browser; the surface that offers the toggle must SAY that turning it on
 * lets the phone make sound (see the panic page's Silent/Voice control).
 *
 * NO accessibility capability is removed: with voice off, a screen-reader
 * user gets exactly the same assertive live-region announcement they always
 * did — once, instead of twice.
 */

/** Per-browser preference. Absent ⇒ silent. */
export const EMERGENCY_VOICE_KEY = 'venueos_emergency_voice';

/**
 * Is spoken announcement turned on for this browser?
 *
 * Fails CLOSED to silent: unavailable storage, an unreadable value, or
 * anything other than the exact opt-in string all mean "stay quiet". A
 * surface that cannot read the preference must never guess loud.
 */
export function isEmergencyVoiceEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(EMERGENCY_VOICE_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Persist the operator's choice. Storage failures are non-fatal. */
export function setEmergencyVoiceEnabled(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(EMERGENCY_VOICE_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode / storage disabled — the session simply stays silent */
  }
}

interface SpeechWindow {
  speechSynthesis?: { cancel?: () => void; speak: (u: unknown) => void };
  SpeechSynthesisUtterance?: new (t: string) => { rate: number; volume: number; lang: string };
}

/**
 * Speak `text` ONLY when the operator has opted in.
 *
 * Best-effort beyond that gate, exactly as before: older WebViews (Taurus
 * Chromium 83) and browsers with TTS disabled throw or no-op, and we swallow
 * that — the live region has already carried the message.
 */
export function speakEmergencyIfEnabled(text: string): void {
  if (!isEmergencyVoiceEnabled()) return;
  try {
    const w = typeof window === 'undefined' ? null : (window as unknown as SpeechWindow);
    if (w && w.speechSynthesis && typeof w.SpeechSynthesisUtterance === 'function') {
      // Cancel any in-flight utterance so successive phase changes don't
      // queue up and overlap.
      w.speechSynthesis.cancel?.();
      const u = new w.SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      u.volume = 1.0;
      // Follow <html lang> (I18nProvider keeps it in sync with the operator's
      // locale) so translated copy isn't read by an English voice.
      u.lang = (typeof document !== 'undefined' && document.documentElement.lang) || 'en-US';
      w.speechSynthesis.speak(u);
    }
  } catch {
    /* no-op — the aria-live region is the announcement that must land */
  }
}
