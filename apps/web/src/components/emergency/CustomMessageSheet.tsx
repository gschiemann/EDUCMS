"use client";

/**
 * Custom message — type it, pick how it appears, pick who gets it, hold 3
 * seconds (2026-10-26).
 *
 * The owner, on site: "it should not get its own page, add it into the
 * emergency page area as a custom message … just make us type something from
 * the web app and push the 3 sec button from mobile to trigger it … Info and
 * Critical is all we need for message types … broadcast should let me pick
 * displays if i want as well and not have to hit them all … use the same
 * screen picker we built for the emergency ones."
 *
 * So this is NOT a page. It is the sheet behind the "Custom message" card on
 * the Emergency page (/panic on a phone, the Emergency window on the desktop):
 *
 *   1. HOW — Info (a banner across the top; your content keeps playing
 *      underneath, pushed down so nothing is covered) or Critical (takes over
 *      the whole screen). Those are the only two an operator sees; the API
 *      still accepts the older WARN and the list reads it as Info.
 *   2. WORDS — one box, at least 16 px so a phone does not zoom.
 *   3. WHO — the SAME "Send to" line and the SAME picker the alert triggers
 *      use, in its multi-select mode: Everywhere (the default), a screen
 *      group, or specific screens with search and "Selected: N screens".
 *   4. HOLD — the same 3-second hold-to-trigger button, with the same
 *      aria-live announcements, on a phone, a laptop and a keyboard alike.
 *
 * Above them, when something is already on screens, is the list of what is up
 * with a one-tap CLEAR — a clear is the time-critical action, so it comes
 * first. Clearing a send to specific screens ends exactly that set.
 *
 * Always-dark, like every life-safety surface here. The tenant id sent is the
 * signed-in WORKSPACE's (`tenantId` prop, from the user) — never the URL slug
 * (launch QA B1, 2026-10-23: the slug 403'd every send).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Sentry from '@sentry/nextjs';
import { AlertTriangle, CheckCircle2, Loader2, Megaphone, ShieldAlert, X } from 'lucide-react';
import { EmergencyTargetBar } from '@/components/emergency/EmergencyTargetBar';
import { EmergencyTargetPicker } from '@/components/emergency/EmergencyTargetPicker';
import { useEmergencyAnnouncer } from '@/components/emergency/EmergencyLiveRegion';
import { HoldToTriggerButton } from '@/components/emergency/HoldToTriggerButton';
import {
  EmergencyApiError,
  clearCustomMessage,
  fetchEmergencyTargets,
  fetchLiveMessages,
  sendCustomMessage,
  type LiveMessage,
} from '@/lib/emergency-api';
import {
  allScreensTarget,
  customMessageBody,
  targetChipLabel,
  type EmergencyTarget,
} from '@/lib/emergency-target';
import {
  CUSTOM_MESSAGE_DURATIONS_MIN,
  CUSTOM_MESSAGE_MAX_CHARS,
  DEFAULT_CUSTOM_MESSAGE_MINUTES,
  durationLabel,
  formatUntil,
  liveMessageKind,
  liveMessageTargetLabel,
  liveMessageTypeKey,
  type CustomMessageKind,
} from '@/lib/custom-message';

export const LIVE_MESSAGES_KEY = 'custom-messages-live';

export interface CustomMessageSheetProps {
  open: boolean;
  onClose: () => void;
  token: string | null;
  /** The signed-in workspace's tenant id (a UUID) — never the URL slug. */
  tenantId: string;
  /** May this person send? (role or the delegated panic flag, never a viewer.) */
  canSend: boolean;
  /** May this person clear what is up? */
  canClear: boolean;
}

export function CustomMessageSheet({ open, onClose, token, tenantId, canSend, canClear }: CustomMessageSheetProps) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const { announce, region: liveRegion } = useEmergencyAnnouncer();

  const [kind, setKind] = useState<CustomMessageKind>('INFO');
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState<number>(DEFAULT_CUSTOM_MESSAGE_MINUTES);
  const [chosenTarget, setChosenTarget] = useState<EmergencyTarget | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [feedback, setFeedback] = useState('');
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [clearError, setClearError] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pickerOpenRef = useRef(false);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { pickerOpenRef.current = pickerOpen; }, [pickerOpen]);
  useEffect(() => () => { if (sentTimer.current) clearTimeout(sentTimer.current); }, []);

  // ── who can receive it (read once per opening, never polled) ─────────────
  const targetsQuery = useQuery({
    queryKey: ['emergency-targets', tenantId],
    queryFn: () => fetchEmergencyTargets(token),
    enabled: open && canSend && !!token,
    staleTime: 60_000,
    retry: 1,
  });
  const allScreens = useMemo(
    () => allScreensTarget(tenantId, targetsQuery.data?.allScreensCount ?? null),
    [tenantId, targetsQuery.data?.allScreensCount],
  );
  const target = chosenTarget ?? allScreens;

  // ── what is on screens right now (polled only while the sheet is open and visible) ──
  const liveQuery = useQuery({
    queryKey: [LIVE_MESSAGES_KEY, tenantId],
    queryFn: () => fetchLiveMessages(token, tenantId),
    enabled: open && !!token,
    refetchInterval: open ? 8000 : false,
    staleTime: 0,
    retry: false,
  });
  const live: LiveMessage[] = liveQuery.data ?? [];

  // ── opening / closing ────────────────────────────────────────────────────
  // The latest onClose, so the Escape listener (and the focus it set up) is
  // created once per OPENING — a parent re-rendering with a new lambda must not
  // re-run this and pull the focus out of the text box mid-sentence.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    // A laptop gets the cursor in the box; a phone does not get a keyboard thrown over the sheet.
    try {
      if (canSend && window.matchMedia?.('(pointer: fine)').matches) textRef.current?.focus();
    } catch { /* no matchMedia: leave the focus on the sheet */ }
    const onKey = (e: KeyboardEvent) => {
      // The picker (opened from here) closes itself on Escape — one press, one sheet.
      if (e.key === 'Escape' && !pickerOpenRef.current) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, canSend]);

  const kindLabel = (k: CustomMessageKind) => (k === 'INFO' ? t('emergency.message.kindInfo') : t('emergency.message.kindCritical'));

  // ── send ─────────────────────────────────────────────────────────────────
  const canStartHold = useCallback(() => {
    if (!text.trim()) {
      setPhase('error');
      setFeedback(t('emergency.message.errMessageRequired'));
      announce(t('emergency.message.annNeedMessage'));
      textRef.current?.focus();
      return false;
    }
    return true;
  }, [text, t, announce]);

  const send = useCallback(async () => {
    const where = targetChipLabel(t, target);
    const body = customMessageBody({ tenantId, text: text.trim(), severity: kind, durationMin: minutes, target });
    setPhase('sending');
    setFeedback('');
    announce(t('emergency.message.annSending', { kind: kindLabel(kind).toLowerCase(), where }));
    try {
      const result = await sendCustomMessage(token, body);
      const reached = typeof result.affectedScreenCount === 'number' ? result.affectedScreenCount : null;
      setPhase('sent');
      setFeedback(reached !== null && target.screenIds ? t('emergency.message.sentCount', { count: reached }) : t('emergency.message.sentTo', { where }));
      announce(t('emergency.message.annSent', { kind: kindLabel(kind).toLowerCase(), where }));
      setText('');
      // The NEXT message starts from Everywhere again — under stress nobody re-reads the "Send to" line.
      setChosenTarget(null);
      void queryClient.invalidateQueries({ queryKey: [LIVE_MESSAGES_KEY] });
      if (sentTimer.current) clearTimeout(sentTimer.current);
      sentTimer.current = setTimeout(() => setPhase((p) => (p === 'sent' ? 'idle' : p)), 5000);
    } catch (e: unknown) {
      const status = e instanceof EmergencyApiError ? e.status : null;
      const timedOut = e instanceof Error && /timeout|network|fetch/i.test(e.message);
      const message = status
        ? t('emergency.message.errSendFailed', { status })
        : timedOut
          ? t('emergency.message.errNetwork')
          : t('emergency.message.errGeneric');
      setPhase('error');
      setFeedback(message);
      announce(t('emergency.message.annFailed', { error: message }));
      Sentry.captureException(e, { tags: { component: 'CustomMessageSheet', action: 'send' } });
    }
    // `kindLabel` is derived from `t` and `kind`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, tenantId, text, kind, minutes, token, t, announce, queryClient]);

  // ── clear ────────────────────────────────────────────────────────────────
  const clear = useCallback(
    async (message: LiveMessage) => {
      setClearingId(message.id);
      setClearError('');
      try {
        await clearCustomMessage(token, message.id);
        announce(t('emergency.message.annCleared'));
        // Off the list at once; the next read confirms it.
        queryClient.setQueryData<LiveMessage[]>([LIVE_MESSAGES_KEY, tenantId], (old) => (old ?? []).filter((m) => m.id !== message.id));
        void queryClient.invalidateQueries({ queryKey: [LIVE_MESSAGES_KEY] });
      } catch (e: unknown) {
        const detail = e instanceof EmergencyApiError ? t('emergency.message.errStatus', { status: e.status }) : '';
        const msg = t('emergency.message.errClearFailed', { error: detail }).trim();
        setClearError(msg);
        announce(t('emergency.message.annClearFailed', { error: detail }).trim());
        console.error('[CustomMessageSheet] clear FAILED — the message may still be on screens:', e);
        Sentry.captureException(e, { tags: { component: 'CustomMessageSheet', action: 'clear' }, extra: { messageId: message.id } });
      } finally {
        setClearingId(null);
      }
    },
    [token, tenantId, t, announce, queryClient],
  );

  if (!open) return null;

  const trimmed = text.trim();
  const accent = kind === 'INFO' ? { rgb: '245,158,11', hex: '#f59e0b', soft: '#fcd34d' } : { rgb: '239,68,68', hex: '#ef4444', soft: '#fca5a5' };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-message-title"
      tabIndex={-1}
      data-testid="custom-message-sheet"
      className="fixed top-0 right-0 bottom-0 left-0 z-[110] flex flex-col text-white outline-none"
      style={{ background: 'linear-gradient(180deg, #121a30 0%, #0b1020 100%)' }}
    >
      {liveRegion}

      <div className="flex items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 border-b border-white/10">
        <div className="flex items-center min-w-0">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] ring-1 ring-white/10 mr-3">
            <Megaphone className="w-5 h-5 text-amber-300" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="custom-message-title" className="text-lg font-bold tracking-tight truncate">
              {t('emergency.message.title')}
            </h2>
            <p className="text-xs text-white/60 truncate">{t('emergency.message.subtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('emergency.message.close')}
          data-testid="custom-message-close"
          className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-white/80 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="w-5 h-5" aria-hidden />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-xl px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-5">
          {/* ── ON SCREENS NOW — first, because Clear is the time-critical action ── */}
          {(live.length > 0 || clearError) && (
            <section aria-labelledby="custom-message-live" data-testid="custom-message-live">
              <h3 id="custom-message-live" className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/55 mb-2">
                {t('emergency.message.liveTitle')}
              </h3>
              {clearError && (
                <div role="alert" className="mb-2 rounded-xl border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-100">
                  {clearError}
                </div>
              )}
              <ul className="space-y-2">
                {live.map((m) => {
                  const k = liveMessageKind(m);
                  const until = formatUntil(m.expiresAt);
                  const busy = clearingId === m.id;
                  return (
                    <li
                      key={m.id}
                      data-testid={`custom-message-live-${m.id}`}
                      className="rounded-xl border p-3"
                      style={{
                        background: k === 'CRITICAL' ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.09)',
                        borderColor: k === 'CRITICAL' ? 'rgba(248,113,113,0.5)' : 'rgba(251,191,36,0.45)',
                      }}
                    >
                      <div className="flex items-start">
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">
                            <span data-testid="custom-message-live-kind">{k === 'INFO' ? t('emergency.message.kindInfo') : t('emergency.message.kindCritical')}</span>
                            {' · '}
                            {t(liveMessageTypeKey(m))}
                          </p>
                          <p className="mt-1 text-sm leading-snug break-words">{m.textBlob || t('emergency.message.noText')}</p>
                          <p className="mt-1 text-xs text-white/60">
                            {liveMessageTargetLabel(t, m)}
                            {' · '}
                            {until ? t('emergency.message.until', { time: until }) : t('emergency.message.untilCleared')}
                          </p>
                        </div>
                        {canClear && (
                          <button
                            type="button"
                            onClick={() => void clear(m)}
                            disabled={busy}
                            aria-label={t('emergency.message.clearAria', { text: m.textBlob || t('emergency.message.noText') })}
                            data-testid={`custom-message-clear-${m.id}`}
                            className="ml-3 shrink-0 min-h-[44px] min-w-[84px] px-4 rounded-xl border border-white/25 bg-white/[0.07] text-sm font-bold text-white hover:bg-white/[0.14] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                          >
                            {busy ? <Loader2 className="w-4 h-4 mx-auto animate-spin" aria-hidden /> : t('emergency.message.clear')}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {liveQuery.isError && live.length === 0 && (
            <p className="text-xs text-white/55" data-testid="custom-message-live-failed">{t('emergency.message.liveFailed')}</p>
          )}

          {canSend ? (
            <>
              {/* ── HOW it appears ── */}
              <fieldset>
                <legend className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/55 mb-2">
                  {t('emergency.message.kindLabel')}
                </legend>
                <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t('emergency.message.kindLabel')}>
                  {(['INFO', 'CRITICAL'] as const).map((k) => {
                    const on = kind === k;
                    const rgb = k === 'INFO' ? '245,158,11' : '239,68,68';
                    const Icon = k === 'INFO' ? Megaphone : ShieldAlert;
                    return (
                      <label
                        key={k}
                        data-testid={`custom-message-kind-${k.toLowerCase()}`}
                        className="relative block cursor-pointer rounded-2xl p-3.5 min-h-[112px] transition-colors focus-within:ring-2 focus-within:ring-white/70"
                        style={{
                          background: on
                            ? `radial-gradient(120% 90% at 50% 0%, rgba(${rgb},0.24) 0%, rgba(${rgb},0.06) 70%), linear-gradient(180deg, rgba(22,28,46,0.95), rgba(13,18,32,0.98))`
                            : 'linear-gradient(180deg, rgba(22,28,46,0.9), rgba(13,18,32,0.95))',
                          border: `1px solid ${on ? `rgb(${rgb})` : `rgba(${rgb},0.28)`}`,
                          boxShadow: on ? `0 0 0 1px rgb(${rgb}), 0 0 26px rgba(${rgb},0.30)` : '0 6px 18px rgba(0,0,0,0.35)',
                        }}
                      >
                        <input
                          type="radio"
                          name="custom-message-kind"
                          value={k}
                          checked={on}
                          onChange={() => {
                            setKind(k);
                            announce(t('emergency.message.annKindSet', { kind: kindLabel(k) }));
                          }}
                          className="sr-only"
                        />
                        <Icon className="w-6 h-6 mb-2" aria-hidden style={{ color: `rgb(${rgb})` }} />
                        <span className="block font-bold text-sm">{kindLabel(k)}</span>
                        <span className="block mt-1 text-[11px] leading-snug text-white/65">
                          {k === 'INFO' ? t('emergency.message.kindInfoHelp') : t('emergency.message.kindCriticalHelp')}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {/* ── WORDS ── */}
              <div>
                <label htmlFor="custom-message-text" className="block text-[11px] font-bold uppercase tracking-[0.16em] text-white/55 mb-2">
                  {t('emergency.message.messageLabel')}
                </label>
                <textarea
                  id="custom-message-text"
                  ref={textRef}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (phase === 'error') { setPhase('idle'); setFeedback(''); }
                  }}
                  rows={3}
                  maxLength={CUSTOM_MESSAGE_MAX_CHARS}
                  placeholder={t('emergency.message.placeholder')}
                  data-testid="custom-message-text"
                  className="w-full rounded-xl bg-slate-950/60 border border-white/15 p-3 text-[16px] leading-snug text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-amber-400/70"
                />
                <p className="mt-1 text-right text-xs text-white/50" data-testid="custom-message-count">
                  {t('emergency.message.charCount', { count: text.length, max: CUSTOM_MESSAGE_MAX_CHARS })}
                </p>
              </div>

              {/* ── HOW IT WILL LOOK ── */}
              <div aria-hidden data-testid="custom-message-preview" data-kind={kind.toLowerCase()}>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/55 mb-2">{t('emergency.message.previewLabel')}</p>
                <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/15 bg-slate-900">
                  {kind === 'INFO' ? (
                    <>
                      <div
                        className="relative z-10 px-3 py-1.5 text-[11px] font-bold leading-tight text-slate-900"
                        style={{ background: '#facc15' }}
                      >
                        <span className="line-clamp-2">{trimmed || t('emergency.message.previewEmpty')}</span>
                      </div>
                      <div className="flex items-center justify-center text-[11px] text-white/45" style={{ height: 'calc(100% - 30px)', background: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0 10px, rgba(255,255,255,0.06) 10px 20px)' }}>
                        {t('emergency.message.previewContent')}
                      </div>
                    </>
                  ) : (
                    <div className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center px-4 text-center" style={{ background: '#b91c1c' }}>
                      <ShieldAlert className="w-7 h-7 mb-1.5" />
                      <span className="text-sm font-black leading-tight line-clamp-3">{trimmed || t('emergency.message.previewEmpty')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* ── WHO — the very same line and picker the alerts use ── */}
              <EmergencyTargetBar
                target={target}
                disabled={phase === 'sending'}
                onChoose={() => setPickerOpen(true)}
                onReset={() => {
                  setChosenTarget(null);
                  announce(t('emergency.message.annTargetSet', { where: targetChipLabel(t, allScreens) }));
                }}
              />

              {/* ── HOW LONG ── */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/55 mb-2">{t('emergency.message.showFor')}</p>
                <div className="flex flex-wrap -m-1" role="radiogroup" aria-label={t('emergency.message.showFor')}>
                  {CUSTOM_MESSAGE_DURATIONS_MIN.map((m) => {
                    const on = minutes === m;
                    return (
                      <label
                        key={m}
                        className="m-1 cursor-pointer rounded-xl px-4 min-h-[44px] inline-flex items-center text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-white/70"
                        style={{
                          background: on ? `rgba(${accent.rgb},0.22)` : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${on ? accent.hex : 'rgba(255,255,255,0.14)'}`,
                          color: on ? '#fff' : 'rgba(255,255,255,0.8)',
                        }}
                      >
                        <input type="radio" name="custom-message-minutes" value={m} checked={on} onChange={() => setMinutes(m)} className="sr-only" />
                        {durationLabel(t, m)}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* ── feedback ── */}
              {phase === 'error' && feedback && (
                <div role="alert" data-testid="custom-message-error" className="rounded-xl border border-red-400/50 bg-red-500/10 p-3 flex items-start text-sm text-red-100">
                  <AlertTriangle className="w-4 h-4 mt-0.5 mr-2 shrink-0" aria-hidden />
                  <span>{feedback}</span>
                </div>
              )}
              {phase === 'sent' && feedback && (
                <div role="status" data-testid="custom-message-sent" className="rounded-xl border border-emerald-400/50 bg-emerald-500/10 p-3 flex items-start text-sm text-emerald-100">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 mr-2 shrink-0" aria-hidden />
                  <span>{feedback}</span>
                </div>
              )}

              {/* ── HOLD — the existing 3-second hold-to-trigger ── */}
              <HoldToTriggerButton
                testId="custom-message-hold"
                tone={kind === 'INFO' ? 'info' : 'critical'}
                label={t('emergency.message.holdToSend')}
                holdingLabel={(pct) => t('emergency.message.holdingPct', { pct })}
                ariaLabel={t('emergency.message.sendAria')}
                busyLabel={t('emergency.message.sending')}
                busy={phase === 'sending'}
                canStart={canStartHold}
                onHoldStart={() => announce(t('emergency.message.annHolding', { kind: kindLabel(kind).toLowerCase(), where: targetChipLabel(t, target) }))}
                onHoldCancel={() => announce(t('emergency.message.annCancelled'))}
                onComplete={() => void send()}
              />
            </>
          ) : (
            <p className="text-sm text-white/60" data-testid="custom-message-view-only">{t('emergency.message.viewOnly')}</p>
          )}
        </div>
      </div>

      {canSend && (
        <EmergencyTargetPicker
          open={pickerOpen}
          multiScreens
          targets={targetsQuery.data ?? null}
          status={targetsQuery.isError ? 'error' : targetsQuery.data ? 'ready' : 'loading'}
          selected={target}
          allScreens={allScreens}
          onSelect={(next) => {
            setChosenTarget(next.scopeType === 'tenant' ? null : next);
            announce(t('emergency.message.annTargetSet', { where: targetChipLabel(t, next) }));
          }}
          onClose={() => setPickerOpen(false)}
          onRetry={() => void targetsQuery.refetch()}
        />
      )}
    </div>
  );
}
