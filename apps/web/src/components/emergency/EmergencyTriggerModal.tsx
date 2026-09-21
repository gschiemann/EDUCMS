import { useAppStore } from '@/lib/store';
import { X, Flame, ShieldAlert, WifiOff, Hand, Lock, HeartPulse, CloudLightning, AlertTriangle, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { broadcastEmergency } from '@/actions/trigger-emergency';
import { clog } from '@/lib/client-logger';
import * as Sentry from '@sentry/nextjs';
import { useEmergencyAnnouncer } from '@/components/emergency/EmergencyLiveRegion';

/**
 * Emergency Trigger — the red button on the dashboard.
 *
 * Trigger-only modal. Setup (which playlist + media plays for each
 * SRP type) happens in /settings → Emergency Content. This modal is
 * for the life-safety moment: pick the type, type the confirm word,
 * fire.
 *
 * The server looks up the right playlist for the tenant by type
 * (panicHoldPlaylistId, panicSecurePlaylistId, panicLockdownPlaylistId,
 * etc.) and broadcasts it on the tenant's signed channel. No playlist
 * selection happens here — that shortens the time-to-trigger and stops
 * operators from pairing a Hold with an Evacuate playlist by mistake.
 *
 * SAFETY: local emergencyActive state is ONLY flipped after the server
 * confirms the broadcast. If the server call rejects, a loud error
 * banner is shown and emergencyActive stays null so the operator knows
 * screens did NOT receive the alert.
 */

interface Props {
  onClose: () => void;
}

export function EmergencyTriggerModal({ onClose }: Props) {
  // Life-safety modal — hide the mobile tab bar so the confirm/fire footer
  // (bottom-anchored on mobile, items-end) is never occluded by the tab bar.
  useOverlayLock();
  // i18n (X7, 2026-08-25): every operator-visible string on this life-safety
  // surface resolves through the catalog. The SRP CONFIRM WORDS
  // (HOLD/SECURE/LOCKDOWN/EVACUATE/SHELTER/MEDICAL) deliberately stay
  // English everywhere — they are the drilled safety-protocol vocabulary,
  // not UI copy. Only the instructions AROUND them are translated.
  const t = useTranslations();
  const setEmergencyActive = useAppStore((state) => state.setEmergencyActive);
  const user = useAppStore((state) => state.user);
  const token = useAppStore((state) => state.token);

  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState('');
  const [isPending, startTransition] = useTransition();
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  // A11y / life-safety (P1-9, 2026-05-28): screen-reader live region +
  // best-effort speech, mirroring the mobile /panic page. A blind admin
  // firing a lockdown from this desktop modal now hears type-select →
  // sending → success/failure.
  const { announce, region: liveRegion } = useEmergencyAnnouncer();
  // Stores the last-attempted payload so the retry button re-fires the
  // same broadcast without requiring the operator to re-fill the form.
  const [lastPayload, setLastPayload] = useState<{
    schoolId: string;
    type: string;
    triggeredBy: string;
    token?: string;
  } | null>(null);

  // Full Standard Response Protocol — used by the vast majority of US
  // K-12 districts. Each type has its own confirm word so an operator
  // tense under pressure can't accidentally fire Lockdown when they
  // meant Hold. Order matches SRP training materials so muscle memory
  // aligns.
  // 2026-06-16: per-type semantic SRP accent (same palette as the mobile
  // /panic board) so this desktop surface matches — each type keeps its
  // life-safety color as a glow accent at rest that ignites on select.
  // accent = live color, rgb = same color as a raw triplet for rgba() glow.
  const types = [
    { id: 'hold',     name: t('emergency.types.hold.name'),     description: t('emergency.types.hold.desc'),     icon: Hand,           confirm: 'HOLD',     accent: '#f5a623', rgb: '245,166,35'  },
    { id: 'secure',   name: t('emergency.types.secure.name'),   description: t('emergency.types.secure.desc'),   icon: Lock,           confirm: 'SECURE',   accent: '#3b82f6', rgb: '59,130,246'  },
    { id: 'lockdown', name: t('emergency.types.lockdown.name'), description: t('emergency.types.lockdown.desc'), icon: ShieldAlert,    confirm: 'LOCKDOWN', accent: '#ef4444', rgb: '239,68,68'   },
    { id: 'evacuate', name: t('emergency.types.evacuate.name'), description: t('emergency.types.evacuate.desc'), icon: Flame,          confirm: 'EVACUATE', accent: '#f97316', rgb: '249,115,22'  },
    { id: 'weather',  name: t('emergency.types.weather.name'),  description: t('emergency.types.weather.desc'),  icon: CloudLightning, confirm: 'SHELTER',  accent: '#22d3ee', rgb: '34,211,238'  },
    { id: 'medical',  name: t('emergency.types.medical.name'),  description: t('emergency.types.medical.desc'),  icon: HeartPulse,     confirm: 'MEDICAL',  accent: '#10b981', rgb: '16,185,129'  },
  ];

  const currentType = types.find((tt) => tt.id === selectedType);
  const confirmWord = currentType?.confirm || '';

  const fireTrigger = (payload: {
    schoolId: string;
    type: string;
    triggeredBy: string;
    token?: string;
  }) => {
    setDispatchError(null);
    setLastPayload(payload);
    const typeName = types.find((tt) => tt.id === payload.type)?.name || payload.type;
    announce(t('emergency.modal.annTriggering', { type: typeName }));
    startTransition(async () => {
      const started = performance.now();
      clog.warn('emergency', `TRIGGER: ${payload.type}`, {
        schoolId: payload.schoolId,
        triggeredBy: payload.triggeredBy,
        role: user?.role,
      });
      try {
        const result = await broadcastEmergency(payload);
        // Guard: the server action returns { success: false, error: "..." } on
        // rejection (HTTP 200 body) rather than throwing. Treat that as a
        // failure — do NOT flip local emergency state until the server confirms.
        if (result && result.success === false) {
          throw new Error(result.error || t('emergency.modal.errServerRejected'));
        }
        if (!result || typeof result.success === 'undefined') {
          throw new Error(t('emergency.modal.errUnexpectedResponse'));
        }
        clog.info('emergency', `TRIGGER success: ${payload.type}`, {
          elapsedMs: Math.round(performance.now() - started),
          overrideId: result.overrideId,
        });
        announce(t('emergency.modal.annSent', { type: typeName }));
        // ONLY flip local emergency state after the server confirms the broadcast.
        // Carry the overrideId into the store so EmergencyOverlay can pass it
        // back on all-clear (audit P2 #3 — forensic chain-of-custody fix).
        setEmergencyActive(true, result.overrideId);
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        clog.error('emergency', `TRIGGER FAILED: ${payload.type}`, {
          err: message,
          elapsedMs: Math.round(performance.now() - started),
        });
        console.error('[EmergencyTriggerModal] Dispatch FAILED — alert was NOT sent to screens:', err);
        Sentry.captureException(err, {
          tags: { component: 'EmergencyTriggerModal', emergencyType: payload.type },
          extra: { schoolId: payload.schoolId, triggeredBy: payload.triggeredBy },
        });
        setDispatchError(message || t('emergency.modal.errUnknown'));
        announce(t('emergency.modal.annFailed', { type: typeName, error: message }));
        // Local emergency state intentionally NOT set — server did not confirm broadcast.
      }
    });
  };

  const handleTrigger = () => {
    if (!selectedType || confirmKey !== confirmWord) return;
    fireTrigger({
      schoolId: user?.tenantId || 'global',
      type: selectedType,
      // No playlistId — the server resolves the right panic playlist
      // for this type from the tenant's stored settings.
      triggeredBy: user?.id || 'unknown',
      token: token || undefined,
    });
  };

  const handleRetry = () => {
    if (!lastPayload) return;
    fireTrigger(lastPayload);
  };

  return (
    // z-[100] (was z-50): a life-safety modal must always sit above the
    // mobile tab bar (z-60). The tab bar is also hidden while this is open
    // (useOverlayLock), so this is belt-and-suspenders.
    // 2026-06-16: premium-dark "command surface" — ALWAYS dark regardless of
    // dashboard theme, matching the mobile /panic board so the two emergency
    // trigger surfaces feel like one serious life-safety product.
    <div className="fixed top-0 right-0 bottom-0 left-0 z-[100] flex items-end md:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      {liveRegion}
      <div
        className="w-full max-w-2xl max-h-[90dvh] rounded-2xl shadow-2xl border border-white/10 overflow-hidden flex flex-col text-white"
        style={{ background: 'linear-gradient(180deg, #121a30 0%, #0b1020 100%)' }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b border-white/10 flex justify-between items-center"
          style={{ background: 'linear-gradient(180deg, rgba(239,68,68,0.14) 0%, rgba(239,68,68,0.04) 100%)' }}
        >
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: '#f87171' }}>
              <ShieldAlert className="w-5 h-5" />
              {t('emergency.modal.title')}
            </h2>
            <p className="text-xs text-white/65 mt-0.5">
              {t.rich('emergency.modal.configuredIn', {
                b: (chunks) => <strong className="text-white/85">{chunks}</strong>,
              })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors"
            aria-label={t('emergency.modal.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
          {/* Step 1 — pick the SRP type */}
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-white mb-3">
              {t('emergency.modal.step1')}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {types.map((type) => {
                const isSel = selectedType === type.id;
                // Rest = dark-glass with the semantic color as a faint inner
                // glow + ring. Selected = the color ignites (tinted fill +
                // solid ring + glow), mirroring the /panic hold state.
                const restBg =
                  `radial-gradient(120% 90% at 50% 0%, rgba(${type.rgb},0.10) 0%, rgba(255,255,255,0.012) 60%),` +
                  ' linear-gradient(180deg, rgba(22,28,46,0.9) 0%, rgba(13,18,32,0.95) 100%)';
                const selBg =
                  `radial-gradient(120% 90% at 50% 0%, rgba(${type.rgb},0.26) 0%, rgba(${type.rgb},0.06) 70%),` +
                  ' linear-gradient(180deg, rgba(22,28,46,0.95) 0%, rgba(13,18,32,0.98) 100%)';
                return (
                  <button
                    key={type.id}
                    onClick={() => { setSelectedType(type.id); setConfirmKey(''); setDispatchError(null); announce(t('emergency.modal.annSelected', { type: type.name, word: type.confirm })); }}
                    className="p-3 rounded-xl text-left transition-all outline-none"
                    style={{
                      background: isSel ? selBg : restBg,
                      border: `1px solid ${isSel ? type.accent : `rgba(${type.rgb},0.30)`}`,
                      boxShadow: isSel
                        ? `0 0 0 1px ${type.accent}, 0 0 28px rgba(${type.rgb},0.35)`
                        : '0 6px 18px rgba(0,0,0,0.35)',
                    }}
                  >
                    <type.icon className="w-6 h-6 mb-2 transition-colors" style={{ color: type.accent }} />
                    <div className="font-bold text-sm transition-colors" style={{ color: isSel ? '#ffffff' : 'rgba(255,255,255,0.85)' }}>
                      {type.name}
                    </div>
                    <div className="text-[11px] text-white/65 mt-1 leading-snug">
                      {type.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2 — type the confirm word */}
          {selectedType && (
            <div className="animate-in fade-in slide-in-from-top-4 duration-200 pt-5 border-t border-white/10">
              <h3 className="text-sm font-semibold tracking-tight text-white mb-3">
                {t('emergency.modal.step2')}
              </h3>
              <div
                className="rounded-xl p-4 border space-y-3"
                style={{ background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.25)' }}
              >
                <p className="text-sm text-white/80">
                  {t.rich('emergency.modal.willBroadcast', {
                    type: currentType?.name ?? '',
                    b: (chunks) => <strong className="font-bold text-white">{chunks}</strong>,
                  })}
                </p>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-white/65 mb-1.5">
                    {t.rich('emergency.modal.typeToConfirm', {
                      word: confirmWord,
                      w: (chunks) => <span className="font-mono font-bold" style={{ color: '#fca5a5' }}>{chunks}</span>,
                    })}
                  </label>
                  <input
                    type="text"
                    value={confirmKey}
                    onChange={(e) => setConfirmKey(e.target.value.toUpperCase())}
                    // Keyboard equivalence (a11y §18-1): Enter in the confirm
                    // field fires the SAME guarded handleTrigger — it still
                    // requires confirmKey === confirmWord, so this is purely an
                    // added keyboard path, not a weakened safeguard. The fire
                    // button (also keyboard-operable) remains the primary CTA.
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isPending && selectedType && confirmKey === confirmWord) {
                        e.preventDefault();
                        handleTrigger();
                      }
                    }}
                    placeholder={confirmWord}
                    autoFocus
                    aria-label={t('emergency.modal.confirmAria', { word: confirmWord })}
                    className="w-full px-4 py-2.5 border border-white/15 rounded-md bg-slate-950/60 text-white placeholder-white/60 font-mono text-sm outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all uppercase tracking-wider"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Dispatch error banner — shown only when the server call failed */}
        {dispatchError && (
          <div
            className="mx-6 mb-4 rounded-lg border p-4 flex items-start gap-3"
            style={{ background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.45)' }}
          >
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#f87171' }} />
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: '#fecaca' }}>
                {t('emergency.modal.dispatchFailed')}
              </p>
              <p className="text-xs text-red-200/90 mt-1 font-mono break-all">
                {dispatchError}
              </p>
            </div>
            <button
              onClick={handleRetry}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded shrink-0 transition-colors"
              aria-label={t('emergency.modal.retryAria')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t('emergency.modal.retry')}
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-black/20 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
          >
            {t('emergency.modal.cancel')}
          </button>
          <button
            onClick={handleTrigger}
            disabled={!selectedType || confirmKey !== confirmWord || isPending}
            className="px-6 py-2.5 text-white text-sm font-bold rounded-md shadow-sm transition-all flex justify-center items-center gap-2 min-w-[160px] disabled:opacity-40 active:scale-[0.99]"
            style={{ background: 'linear-gradient(160deg, #ef4444 0%, #b91c1c 100%)', boxShadow: '0 0 24px rgba(239,68,68,0.30)' }}
          >
            {isPending ? (
              <span className="animate-pulse">{t('emergency.modal.sending')}</span>
            ) : (
              <span className="flex items-center gap-2">
                <WifiOff className="w-4 h-4" /> {t('emergency.modal.title')}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
