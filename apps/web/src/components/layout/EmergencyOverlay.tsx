"use client";

import { useAppStore } from '@/lib/store';
import { AlertTriangle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { allClearEmergency } from '@/actions/trigger-emergency';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { useTenantStatus } from '@/hooks/use-api';
import { canSendAllClear, hasPanicAuthority } from '@/lib/emergency-capability';
import { fetchActiveAlerts } from '@/lib/emergency-api';
import { activeAlertLabel, allClearScopeOf, typeIdOf, type ActiveAlert } from '@/lib/emergency-target';
import { EmergencyTriggerModal } from '@/components/emergency/EmergencyTriggerModal';

/** A stable key for one live alert (the tenant-wide one has no id). */
const alertKey = (a: ActiveAlert) => a.alertId ?? `${a.scopeType}:${a.scopeId}`;

export function EmergencyOverlay() {
  // P0-10 (mobile-UX audit 2026-05-29) — LIFE-SAFETY. The fixed
  // MobileTabBar (z-60) rendered tappable OVER this overlay (z-50 inside a
  // relative dashboard container), so a user could navigate AWAY from the
  // all-clear screen mid-incident. Registering the overlay with the global
  // overlay lock bumps `overlayOpenCount`, which makes MobileTabBar.isHidden
  // true and unmounts the tab bar entirely while the emergency overlay is up
  // — so the all-clear control owns the screen. (Paired with the z-[60] bump
  // on the overlay root below as defense-in-depth.) This touches ONLY
  // overlay layering — no trigger / broadcast / all-clear / audit logic.
  useOverlayLock();
  // i18n (X7, 2026-08-25): the all-clear CONFIRM WORD stays the English
  // literal 'CLEAR' — drilled protocol vocabulary, identical in every
  // locale. Only the instructions around it are translated.
  const t = useTranslations();
  const queryClient = useQueryClient();
  const setEmergencyActive = useAppStore((state) => state.setEmergencyActive);
  const user = useAppStore((state) => state.user);
  const token = useAppStore((state) => state.token);
  // 2026-05-23 audit P2 #3 — pass the active overrideId back to the
  // all-clear so the AuditLog can pair trigger+clear events. The
  // EmergencyTriggerModal puts the overrideId into the store on
  // successful broadcast; previously this component minted a
  // synthetic `clear_<uuid>` every time and the chain was broken.
  const activeOverrideId = useAppStore((state) => state.activeEmergencyOverrideId);
  const [confirmKey, setConfirmKey] = useState('');
  const [isPending, startTransition] = useTransition();
  const [clearError, setClearError] = useState<string | null>(null);
  const [sendAnotherOpen, setSendAnotherOpen] = useState(false);

  // ── WHICH alerts are live (alert targeting, 2026-10-05) ──────────────
  // An operator can now aim an alert at all screens, one group or one
  // screen, so several can be live at once and each needs its own all-clear.
  // This list is read only while the overlay is mounted (i.e. only during an
  // emergency), every 15 s while the tab is visible and on return — never in
  // the always-mounted chrome. Only someone who may send the all-clear can
  // read it (the API applies the trigger's own authorization); everyone else
  // sees the lock and who to ask.
  const mayClear = canSendAllClear(user);
  const { data: tenant } = useTenantStatus();
  const activeQuery = useQuery({
    queryKey: ['emergency-active', user?.tenantId ?? null],
    queryFn: () => fetchActiveAlerts(token),
    enabled: mayClear && !!token,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const alerts: ActiveAlert[] = useMemo(() => activeQuery.data ?? [], [activeQuery.data]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // One alert (the common case) is simply THE alert — no extra choice.
  const selected: ActiveAlert | null =
    alerts.find((a) => alertKey(a) === selectedKey) ?? (alerts.length === 1 ? alerts[0] : null);
  const tenantWideActive =
    alerts.some((a) => a.scopeType === 'tenant') ||
    (!activeQuery.data && !!tenant?.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE');

  // Nothing live any more (cleared from another device, or expired): let the
  // server's own tenant state decide whether the lock comes down, rather than
  // closing on one possibly-early list read.
  const listedEmpty = activeQuery.isSuccess && alerts.length === 0;
  useEffect(() => {
    if (listedEmpty) void queryClient.invalidateQueries({ queryKey: ['tenant-status'] });
  }, [listedEmpty, queryClient]);

  const typeName = (apiType: string | null) => {
    const id = typeIdOf(apiType);
    return id ? t(`emergency.types.${id}.name`) : (apiType || t('emergency.active'));
  };
  const labelOf = (a: ActiveAlert) => activeAlertLabel(t, typeName(a.type), a);

  // A11y audit 2026-05-12 — the takeover overlay was a bare <div> that
  // never told assistive tech "this is a blocking dialog" and let Tab
  // wander into the disabled main content underneath. role="alertdialog"
  // + focus-on-mount + focus-trap fixes both. We deliberately do NOT
  // bind Esc here: an emergency overlay must be dismissed via the
  // explicit "type CLEAR" gate, not a stray keystroke.
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Focus the "type CLEAR" field on mount so an SR/keyboard operator
    // lands directly on the interactive element. Sighted operators
    // can still click the rest of the overlay.
    inputRef.current?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = overlayRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'input, button, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, []);

  // With several alerts the operator picks one first; with the list
  // unavailable the all-clear falls back to the whole tenant, exactly as
  // before targeting existed (only when a tenant-wide alert is known).
  const canSubmit =
    mayClear &&
    confirmKey === 'CLEAR' &&
    !isPending &&
    (selected !== null || (alerts.length === 0 && tenantWideActive));

  const handleAllClear = () => {
    if (!canSubmit) return;
    const target = selected;
    setClearError(null);
    startTransition(async () => {
      try {
        const result = await allClearEmergency(
          target
            ? {
                // The tenant-wide entry's scopeId IS the tenant to clear (a
                // district admin may end one school's own alert).
                schoolId: target.scopeType === 'tenant' ? target.scopeId : user?.tenantId || 'global',
                token: token || undefined,
                // Exactly this alert. The tenant-wide alert carries no id on
                // the Tenant row, so it keeps the one the modal recorded.
                overrideId: target.alertId ?? (target.scopeType === 'tenant' ? activeOverrideId || undefined : undefined),
                // Its own scope — or, if that target was deleted mid-alert, the
                // scope the server says still reaches it.
                ...allClearScopeOf(target),
              }
            : {
                schoolId: user?.tenantId || 'global',
                token: token || undefined,
                overrideId: activeOverrideId || undefined,
              },
        );
        // LIFE-SAFETY: the action reports failure in its RESULT. It used to
        // be ignored and the overlay closed anyway — telling the operator the
        // incident was over while every screen stayed locked down.
        if (!result || result.success !== true) {
          setClearError(t('emergency.overlay.clearFailed', { error: result?.error || t('emergency.modal.errUnknown') }));
          return;
        }
        setConfirmKey('');
        setSelectedKey(null);
        void queryClient.invalidateQueries({ queryKey: ['tenant-status'] });
        if (!mayClear || !token) {
          setEmergencyActive(false);
          return;
        }
        // Other alerts may still be live — only drop the lock when none is.
        const remaining = await queryClient.fetchQuery({
          queryKey: ['emergency-active', user?.tenantId ?? null],
          queryFn: () => fetchActiveAlerts(token),
          staleTime: 0,
        }).catch(() => null);
        if (remaining && remaining.length === 0) setEmergencyActive(false);
      } catch (e) {
        console.error("Failed to clear emergency", e);
        setClearError(
          t('emergency.overlay.clearFailed', { error: e instanceof Error ? e.message : String(e) }),
        );
      }
    });
  };

  return (
    <div
      ref={overlayRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="emergency-overlay-title"
      aria-describedby="emergency-overlay-desc"
      // A11y audit (2026-05-25): mirror the player overlay's
      // role="alert" + aria-live="assertive" pattern (see
      // apps/web/src/components/player/EmergencyOverlay.tsx). The
      // dashboard overlay already declared alertdialog which is great
      // for modal semantics but does NOT itself trigger an SR
      // announcement when the overlay mounts. Adding role="alert" on
      // a nested wrapper + aria-live="assertive" + aria-atomic ensures
      // the SR speaks the title+desc the moment the overlay appears
      // (which is exactly the life-safety moment we need it to).
      // z-[60] (was z-50): defense-in-depth alongside useOverlayLock() above
      // so the overlay is never painted under the fixed MobileTabBar (z-[60])
      // even on a frame before the tab bar unmounts. Life-safety: the
      // all-clear control must always own the screen during an active
      // emergency (mobile-UX audit P0-10, 2026-05-29).
      // 2026-06-27 (LANE 1 life-safety) — added `overflow-y-auto` so the
      // all-clear control is ALWAYS reachable. The overlay centers its content
      // with `items-center`; on a short viewport (a phone in landscape, a
      // small browser window) the stacked content — icon + title + desc + the
      // tall "type CLEAR" card — exceeded the viewport and, with no scroll, the
      // input + Terminate button were pushed off-screen, leaving the operator
      // unable to clear the emergency. `overflow-y-auto` lets it scroll; the
      // `my-auto` on the inner block keeps it centered when it DOES fit.
      // (Dashboard surface, not a Taurus player — inset-0 / blur are fine here.)
      className="absolute inset-0 z-[60] flex items-center justify-center p-6 overflow-y-auto bg-red-950/90 backdrop-blur-3xl border-8 border-red-500 transition-all duration-300"
    >
      {/* Inner alert region — announces the title + description on mount.
          The outer alertdialog handles focus + modal semantics; this
          inner role="alert" handles the live announcement. Per WAI-ARIA
          authoring practices, alertdialog is for confirmation prompts
          and does not imply aria-live="assertive". */}
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {tenantWideActive ? t('emergency.overlay.srAlert') : t('emergency.overlay.srAlertScoped')}
      </div>
      {/* Flashing global indicator — clamped by the
          @media (prefers-reduced-motion: reduce) rule in globals.css
          so users with vestibular / photosensitive sensitivity
          don't see sustained pulsing red. The static border + the
          word "EMERGENCY ACTIVE" + the unmissable contrast still
          convey severity without motion. */}
      <div className="absolute inset-x-0 top-0 h-2 bg-red-500 animate-pulse" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 h-2 bg-red-500 animate-pulse" aria-hidden />

      <div className="max-w-2xl w-full my-auto flex flex-col items-center justify-center text-center space-y-8 animate-in zoom-in-95 duration-500">
        <div className="w-32 h-32 rounded-full bg-red-500/20 flex items-center justify-center animate-pulse">
          <AlertTriangle className="w-16 h-16 text-red-500" />
        </div>

        <div className="space-y-4">
          <h1 id="emergency-overlay-title" className="text-5xl font-black tracking-tighter text-white">{t('emergency.overlay.title')}</h1>
          <p id="emergency-overlay-desc" className="text-xl text-red-200 mt-2 font-medium">
            {tenantWideActive ? t('emergency.overlay.desc') : t('emergency.overlay.descScoped')}
          </p>
        </div>

        {/* EVERY live alert, each with its target — "Lockdown — Gym group,
            6 screens". Several alerts are listed separately; the one chosen
            here is the one the all-clear below ends, and nothing else. */}
        {mayClear && alerts.length > 0 && (
          <div className="w-full max-w-md text-left" data-testid="emergency-active-alerts">
            <h2 className="text-sm font-bold uppercase tracking-wider text-red-300 mb-2">
              {alerts.length > 1 ? t('emergency.overlay.chooseAlert') : t('emergency.overlay.alertsTitle')}
            </h2>
            <ul className="space-y-2">
              {alerts.map((a) => {
                const on = selected !== null && alertKey(selected) === alertKey(a);
                return (
                  <li key={alertKey(a)}>
                    <button
                      type="button"
                      onClick={() => { setSelectedKey(alertKey(a)); setClearError(null); inputRef.current?.focus(); }}
                      aria-pressed={on}
                      className="w-full min-h-[52px] px-4 py-2 rounded-lg border flex items-center gap-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                      style={{
                        background: on ? 'rgba(239,68,68,0.30)' : 'rgba(0,0,0,0.35)',
                        borderColor: on ? 'rgba(254,202,202,0.9)' : 'rgba(239,68,68,0.35)',
                      }}
                    >
                      <ShieldAlert className="w-5 h-5 shrink-0 text-red-300" aria-hidden />
                      <span className="flex-1 min-w-0 font-semibold text-white">{labelOf(a)}</span>
                      {alerts.length > 1 && (
                        <span className="shrink-0 text-xs font-bold uppercase tracking-wider text-red-200">
                          {on ? t('emergency.overlay.selected') : t('emergency.overlay.select')}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {mayClear && activeQuery.isError && (
          <p className="text-sm text-red-200" role="status">{t('emergency.overlay.loadFailed')}</p>
        )}

        <div className="w-full max-w-md bg-black/40 backdrop-blur-md rounded-xl p-8 border border-red-500/30 mt-8 space-y-6">
          {mayClear ? (
            <>
              <div>
                <label htmlFor="all-clear-input" className="block text-sm font-bold uppercase tracking-wider text-red-400 mb-2">
                  {t('emergency.overlay.authLabel')}
                </label>
                {alerts.length > 1 && selected && (
                  <p className="text-sm font-semibold text-white mb-2" data-testid="emergency-overlay-ending">
                    {t('emergency.overlay.ending', { label: labelOf(selected) })}
                  </p>
                )}
                <p className="text-sm text-red-200 mb-4 opacity-80">
                  {t.rich('emergency.overlay.authHint', { b: (chunks) => <strong>{chunks}</strong> })}
                </p>
                <input
                  ref={inputRef}
                  id="all-clear-input"
                  type="text"
                  value={confirmKey}
                  onChange={(e) => setConfirmKey(e.target.value.toUpperCase())}
                  placeholder={t('emergency.overlay.placeholder')}
                  className="w-full px-4 py-3 bg-black/50 border border-red-500/30 rounded-lg text-white font-mono text-center tracking-[0.5em] focus:ring-2 focus:ring-red-500 outline-none uppercase"
                />
              </div>

              {clearError && (
                <p className="text-sm font-semibold text-red-100 bg-red-900/60 border border-red-400/60 rounded-lg p-3 text-left" role="alert">
                  {clearError}
                </p>
              )}

              <button
                onClick={handleAllClear}
                disabled={!canSubmit}
                className="w-full py-4 px-6 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:hover:bg-red-600 text-white font-bold rounded-lg shadow-xl hover:shadow-red-500/20 transition-all flex justify-center items-center gap-2"
              >
                {isPending ? (
                  <span className="flex items-center gap-2 animate-pulse">
                    <ShieldCheck className="w-5 h-5" /> {t('emergency.overlay.submitting')}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5" /> {t('emergency.overlay.terminate')}
                  </span>
                )}
              </button>
            </>
          ) : (
            <p className="text-sm text-red-100">{t('emergency.overlay.noAuthority')}</p>
          )}
        </div>

        {/* One alert per target: an operator who needs a second target (a
            second group, one more screen) sends a second alert. */}
        {hasPanicAuthority(user) && (
          <button
            type="button"
            onClick={() => setSendAnotherOpen(true)}
            className="min-h-[44px] px-5 rounded-lg border border-red-300/50 text-sm font-bold text-red-100 hover:bg-red-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {t('emergency.overlay.sendAnother')}
          </button>
        )}
      </div>
      {sendAnotherOpen && (
        <EmergencyTriggerModal
          onClose={() => {
            setSendAnotherOpen(false);
            void activeQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
