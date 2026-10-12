"use client";

/**
 * Bug Reporter — the floating "Report a problem" button + submission modal.
 *
 * Operator vision (2026-05-27): "the best bug reporter ever seen
 * before where someone finds a bug, clicks a button, it screen caps the
 * issue, it grabs the backend info you need, it records the users info
 * and time stamp then feeds it directly to you, then you find the issue
 * and the fix and then just ask my approval and we fix the fucking
 * issue, things are resolved in record fucking time like no one has ever
 * seen before in real life".
 *
 * What this component renders:
 *   1. A bottom-right floating button (admins only — SUPER, DISTRICT, SCHOOL)
 *   2. A modal with a textarea and a "Submit" button
 *   3. Cmd/Ctrl+Shift+B opens the modal from anywhere
 *
 * What it does NOT render on:
 *   - /login, /signup, /reset-password, /onboarding (no auth yet)
 *   - /panic, /player, /board, /ribbon, /scorebug (immersive surfaces)
 *   - The marketing root '/'
 *
 * What it does NOT log:
 *   - Itself — `setBugCaptureIgnoreSelector('[data-bug-modal]')` is
 *     toggled while the modal is open so the operator opening / typing
 *     in the bug form doesn't spam its own breadcrumbs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LEGAL_CONTACTS } from '@/lib/legal-entity';
import { AlertCircle, Bug, CheckCircle2, Loader2, X } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { captureBugBundle } from '@/lib/bug-capture';
import { setBugCaptureIgnoreSelector } from '@/lib/bug-ringbuffers';
import { useCreateBug } from '@/hooks/use-bugs';
import { useOverlayLock } from '@/hooks/use-overlay-lock';

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']);

/** Routes where the button must NEVER render. Immersive surfaces +
 *  unauthenticated pages. Order matters only to the human reading it
 *  — the check uses startsWith on each entry. */
const HIDDEN_PREFIXES = [
  '/login',
  '/signup',
  '/reset-password',
  '/onboarding',
  '/panic',
  '/player',
  '/board/',
  '/ribbon/',
  '/scorebug/',
];

export function BugReporterButton() {
  const t = useTranslations('bugReporter');
  const pathname = usePathname() || '';
  const user = useAppStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Hide the mobile tab bar while the bug-report modal is up (its footer
  // Submit button is bottom-anchored on mobile via items-end).
  useOverlayLock(open);

  // Mount gate so SSR vs CSR don't disagree (user store rehydrates
  // client-side from sessionStorage — same pattern as SuperPage).
  useEffect(() => { setMounted(true); }, []);

  // Cmd/Ctrl + Shift + B opens the modal. Bound on every render where
  // the button is allowed to show; cleaned up on unmount.
  const isVisibleSurface = useMemo(() => {
    if (pathname === '/') return false;
    return !HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
  }, [pathname]);

  const isAdmin = !!user && ADMIN_ROLES.has(user.role);
  const shouldRender = mounted && isAdmin && isVisibleSurface;

  // P2 (mobile-UX audit 2026-05-29): the FAB is fixed at z-[70] and was NOT
  // overlay-aware, so the "Report bug" chip floated over modal/sheet footers
  // (and over the emergency overlay) on every bottom-anchored surface. Hide
  // the FAB whenever ANY overlay is open — same `overlayOpenCount` signal the
  // MobileTabBar uses. Note: opening THIS component's own modal calls
  // `useOverlayLock(open)` above, which bumps the count, so `> 0` also hides
  // the chip behind its own modal (the modal still renders below via
  // `{open && …}`). The keyboard shortcut + modal mount stay gated on
  // `shouldRender` (NOT this) so a modal that's already open keeps rendering.
  const overlayOpenCount = useAppStore((s) => s.overlayOpenCount);
  const showFab = shouldRender && overlayOpenCount === 0;

  useEffect(() => {
    if (!shouldRender) return;
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shouldRender]);

  // While the modal is open, stop logging breadcrumbs from clicks
  // inside it — otherwise every keystroke / submit click pollutes the
  // very ringbuffer we're about to ship.
  useEffect(() => {
    if (open) setBugCaptureIgnoreSelector('[data-bug-modal]');
    else setBugCaptureIgnoreSelector(null);
    return () => setBugCaptureIgnoreSelector(null);
  }, [open]);

  if (!shouldRender) return null;

  return (
    <>
      {showFab && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('open')}
          title={t('openTitle')}
          // Sit ABOVE the MobileTabBar (z-[60]) and the EmergencyOverlay
          // chrome. The bottom-24 offset keeps it clear of the mobile tab
          // bar (h-56px + safe-area). On desktop it lifts to bottom-6.
          // Only rendered when `overlayOpenCount === 0` (see showFab) so it
          // never floats over another modal/sheet footer or the emergency
          // overlay. ICON ONLY (2026-09-28, Greg): the "Report bug" pill sat
          // on top of the playlist page numbers; a 36px icon takes a third of
          // the room. The accessible name + tooltip carry the words.
          className="fixed right-4 bottom-24 md:bottom-6 md:right-6 z-[70] inline-flex items-center justify-center w-9 h-9 rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2"
        >
          <Bug className="w-4 h-4" aria-hidden />
        </button>
      )}
      {open && (
        <BugReporterModal
          onClose={() => setOpen(false)}
          reporterRole={user?.role || ''}
        />
      )}
    </>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────

interface ModalProps {
  onClose: () => void;
  reporterRole: string;
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'capturing' }
  | { kind: 'submitting' }
  | { kind: 'success'; bugId: string }
  | { kind: 'error'; message: string };

function BugReporterModal({ onClose, reporterRole }: ModalProps) {
  const t = useTranslations('bugReporter');
  const [description, setDescription] = useState('');
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });
  const createBug = useCreateBug();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus the description textarea on mount — same end-result as
  // `autoFocus` but bypasses the jsx-a11y/no-autofocus rule (autofocus
  // attribute hurts screen-reader users; a programmatic focus inside a
  // modal that announces itself via aria-modal is fine).
  useEffect(() => { textareaRef.current?.focus(); }, []);

  // Esc closes the modal (same pattern as ProfileEditModal).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state.kind !== 'capturing' && state.kind !== 'submitting') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, state.kind]);

  const submit = useCallback(async () => {
    if (state.kind === 'capturing' || state.kind === 'submitting') return;
    setState({ kind: 'capturing' });
    let bundle;
    try {
      bundle = await captureBugBundle({ description });
    } catch (err) {
      setState({
        kind: 'error',
        message: t('captureFailed'),
      });
      return;
    }
    setState({ kind: 'submitting' });
    try {
      const res = await createBug.mutateAsync({
        captured: bundle.captured,
        screenshotBase64: bundle.screenshotBase64,
      });
      setState({ kind: 'success', bugId: res.bugId });
    } catch (err) {
      setState({
        kind: 'error',
        message: t('submitFailed'),
      });
    }
  }, [createBug, description, state.kind, t]);

  const busy = state.kind === 'capturing' || state.kind === 'submitting';
  const isSuperAdmin = reporterRole === 'SUPER_ADMIN';

  return (
    <div
      className="fixed top-0 right-0 bottom-0 left-0 z-[200] flex items-end sm:items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bug-reporter-title"
      data-bug-modal
    >
      {/* Backdrop. Click to close (unless mid-submit) — match the
          rest of the dashboard's modal UX. */}
      <button
        type="button"
        aria-label={t('close')}
        onClick={() => { if (!busy) onClose(); }}
        className="absolute top-0 right-0 bottom-0 left-0 bg-slate-900/40 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <header className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <Bug className="w-4.5 h-4.5" aria-hidden />
            </div>
            <div>
              <h2 id="bug-reporter-title" className="text-base font-extrabold text-slate-900 leading-tight">
                {t('title')}
              </h2>
              <p className="text-[11px] text-slate-500 leading-tight">
                {t('subtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('close')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {state.kind === 'success' ? (
            <SuccessPanel
              bugId={state.bugId}
              isSuperAdmin={isSuperAdmin}
              onClose={onClose}
            />
          ) : (
            <>
              <p className="text-xs text-slate-600 leading-relaxed">
                {t('intro')}
              </p>

              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {t('whatHappened')} <span className="text-slate-300 normal-case font-normal">{t('optionalHelpful')}</span>
                </span>
                <textarea
                  ref={textareaRef}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={busy}
                  rows={4}
                  placeholder={t('placeholder')}
                  className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 placeholder:text-slate-400 disabled:opacity-50"
                  maxLength={2000}
                />
                <span className="mt-1 block text-[10px] text-slate-400 text-right">
                  {description.length}/2000
                </span>
              </label>

              {state.kind === 'error' && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" aria-hidden />
                  <div className="text-[11px] text-rose-700 leading-snug">
                    <div className="font-bold mb-0.5">{t('errorTitle')}</div>
                    <div>{state.message}</div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="px-3 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {state.kind === 'capturing'
                    ? t('capturing')
                    : state.kind === 'submitting'
                      ? t('submitting')
                      : state.kind === 'error'
                        ? t('tryAgain')
                        : t('submit')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface SuccessProps {
  bugId: string;
  isSuperAdmin: boolean;
  onClose: () => void;
}

/**
 * What a customer reads after sending a report: a plain "we got it" with the
 * reference. Nothing about statuses, internal tooling or how it gets fixed.
 * Only platform staff get a link into the owner console.
 */
export function SuccessPanel({ bugId, isSuperAdmin, onClose }: SuccessProps) {
  const t = useTranslations('bugReporter');
  return (
    <div className="text-center py-2">
      <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-3">
        <CheckCircle2 className="w-6 h-6 text-emerald-600" aria-hidden />
      </div>
      <h3 className="text-base font-extrabold text-slate-900 mb-1">{t('successTitle')}</h3>
      <p className="text-xs text-slate-500 leading-relaxed">
        {t('successBody', { ref: bugId.slice(0, 8) })}
      </p>
      <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
        {t('successContact', { email: LEGAL_CONTACTS.support })}
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        {isSuperAdmin && (
          <Link
            href={`/super/bugs/${bugId}`}
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700"
          >
            {t('openOwnerConsole')}
          </Link>
        )}
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-2 text-xs font-bold text-slate-600 hover:text-slate-900"
        >
          {t('close')}
        </button>
      </div>
    </div>
  );
}
