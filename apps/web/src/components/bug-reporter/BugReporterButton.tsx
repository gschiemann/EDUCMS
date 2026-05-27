"use client";

/**
 * Bug Reporter — the floating "Report a bug" button + submission modal.
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
import { AlertCircle, Bug, CheckCircle2, Loader2, X } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { captureBugBundle } from '@/lib/bug-capture';
import { setBugCaptureIgnoreSelector } from '@/lib/bug-ringbuffers';
import { useCreateBug } from '@/hooks/use-bugs';
import type { BugStatus } from '@cms/api-types';

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
  const pathname = usePathname() || '';
  const user = useAppStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

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
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report a bug"
        title="Report a bug (⌘⇧B)"
        // Sit ABOVE the MobileTabBar (z-[60]) and the EmergencyOverlay
        // chrome. The bottom-24 offset keeps it clear of the mobile tab
        // bar (h-56px + safe-area). On desktop it lifts to bottom-6.
        className="fixed right-4 bottom-24 md:bottom-6 md:right-6 z-[70] inline-flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-700 transition-colors text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2"
      >
        <Bug className="w-4 h-4" aria-hidden />
        <span className="hidden sm:inline">Report bug</span>
      </button>
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
  | { kind: 'success'; bugId: string; status: BugStatus }
  | { kind: 'error'; message: string };

function BugReporterModal({ onClose, reporterRole }: ModalProps) {
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
        message: err instanceof Error ? err.message : 'Capture failed before we could submit.',
      });
      return;
    }
    setState({ kind: 'submitting' });
    try {
      const res = await createBug.mutateAsync({
        captured: bundle.captured,
        screenshotBase64: bundle.screenshotBase64,
      });
      setState({ kind: 'success', bugId: res.bugId, status: res.status });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Submit failed. Please try again.',
      });
    }
  }, [createBug, description, state.kind]);

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
        aria-label="Close"
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
                Report a bug
              </h2>
              <p className="text-[11px] text-slate-500 leading-tight">
                We&apos;ll capture the screen + state automatically.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {state.kind === 'success' ? (
            <SuccessPanel
              bugId={state.bugId}
              status={state.status}
              isSuperAdmin={isSuperAdmin}
              onClose={onClose}
            />
          ) : (
            <>
              <p className="text-xs text-slate-600 leading-relaxed">
                Tell us what went wrong. We&apos;ll capture the page, recent actions, console
                errors, and network failures — and route it to the team for an automated
                fix proposal.
              </p>

              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  What happened? <span className="text-slate-300 normal-case font-normal">(optional but helpful)</span>
                </span>
                <textarea
                  ref={textareaRef}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={busy}
                  rows={4}
                  placeholder="I clicked Save and nothing happened, or…"
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
                    <div className="font-bold mb-0.5">Couldn&apos;t submit the bug</div>
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
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {state.kind === 'capturing'
                    ? 'Capturing screen…'
                    : state.kind === 'submitting'
                      ? 'Submitting…'
                      : state.kind === 'error'
                        ? 'Try again'
                        : 'Submit bug report'}
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
  status: BugStatus;
  isSuperAdmin: boolean;
  onClose: () => void;
}

function SuccessPanel({ bugId, status, isSuperAdmin, onClose }: SuccessProps) {
  return (
    <div className="text-center py-2">
      <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-3">
        <CheckCircle2 className="w-6 h-6 text-emerald-600" aria-hidden />
      </div>
      <h3 className="text-base font-extrabold text-slate-900 mb-1">Thanks — bug filed.</h3>
      <p className="text-xs text-slate-500 leading-relaxed">
        The team has it. Bug{' '}
        <span className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
          {bugId.slice(0, 8)}
        </span>{' '}
        is{' '}
        <span className="font-bold text-slate-700">{status.toLowerCase()}</span>.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        {isSuperAdmin && (
          <Link
            href={`/super/bugs/${bugId}`}
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700"
          >
            Open in /super/bugs
          </Link>
        )}
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-2 text-xs font-bold text-slate-600 hover:text-slate-900"
        >
          Close
        </button>
      </div>
    </div>
  );
}
