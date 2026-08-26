'use client';

/**
 * ScreenSetupSection — the panel's first-boot permission state, in the gear
 * popover on /[schoolId]/screens (2026-08-25, v1.1.6).
 *
 * ── THE FIELD EVIDENCE ────────────────────────────────────────────────
 *
 * Operator, installing a new Goodview on v1.1.5: *"it popped up with the
 * config page but after you do the first 4 requirements it just launched so
 * i didnt get to even do the optional ones at all and have no way to know
 * how to pull those up again"* — and, on the install before that, *"one
 * menu wasnt even visible i had to guess where all admin permissions was"*.
 *
 * Two different problems, and this section answers both from the dashboard:
 *
 *  1. WHAT IS OUTSTANDING. The APK has reported it since v1.1.5 (the
 *     `setup` block inside the device-inventory probe) and nothing read it.
 *  2. THE WAY BACK. "Open setup on this panel" pushes a signed `OPEN_SETUP`
 *     over the SAME transport as every other display action, so the
 *     operator taps here, walks to the screen, and the checklist is up. No
 *     adb, no cable, no laptop at the panel.
 *
 * ── AND THE THING THAT PAYS OFF ACROSS A FLEET ────────────────────────
 *
 * `launch: 'fallback' | 'failed'` records that THIS MODEL hides the direct
 * Settings page for a grant. That is a fact about the next fifty panels of
 * the same SKU, not about this one — so it gets its own callout.
 *
 * ── HONESTY RULES (the same ones ScreenDisplayControls lives by) ───────
 *
 *  • No report → render NOTHING. Not "complete", not "0 of 4". An older APK
 *    and a fully-provisioned panel must never look the same.
 *  • The push button appears only when the panel's reported APK actually
 *    carries the `openSetupChecklist` bridge method (≥ v1.1.6). Below that
 *    it is a button that fails 100% of the time, so it is a sentence
 *    instead.
 *  • `delivered:false` is reported as "queued, this screen has no live push
 *    channel" — never as success. Same wording discipline as the display
 *    controls: we show what we SENT, never a fabricated device state.
 */

import { useState } from 'react';
import { ClipboardCheck, ExternalLink, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useDisplayControl, DISPLAY_CONTROL_TIMEOUT_MS } from '@/hooks/use-api';
import {
  parseSetupTelemetry,
  describeStep,
  supportsSetupPush,
  SETUP_PUSH_MIN_VERSION,
} from './screen-setup';

export function ScreenSetupSection({
  screen,
  inventoryReport,
  readOnly,
}: {
  screen: { id: string; name?: string | null; playerVersion?: string | null };
  /** `screen_device_inventory.report`, or null while loading / never reported. */
  inventoryReport: unknown;
  /** RESTRICTED_VIEWER — the push button is inert. */
  readOnly?: boolean;
}) {
  const control = useDisplayControl();
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const setup = parseSetupTelemetry(inventoryReport);
  // ⚠️ NOTHING, not a placeholder. See the honesty rules above.
  if (!setup) return null;

  const canPush = supportsSetupPush(screen.playerVersion);
  const pending = control.isPending;

  const openOnPanel = () => {
    if (readOnly || pending) return;
    setStatus(null);
    control.mutate(
      { screenId: screen.id, action: 'OPEN_SETUP' },
      {
        onSuccess: (res: any) => {
          setStatus(
            res?.delivered === false
              ? {
                  ok: false,
                  msg: 'Queued — this screen has no live push channel right now, so it will not see it until it reconnects.',
                }
              : {
                  ok: true,
                  msg: 'Sent. The setup list is on the panel now — walk to the screen and finish the remaining steps.',
                },
          );
        },
        onError: (e: any) => {
          setStatus({
            ok: false,
            msg:
              e?.name === 'AbortError'
                ? `No answer in ${Math.round(DISPLAY_CONTROL_TIMEOUT_MS / 1000)}s — try again.`
                : e?.message || 'Could not reach the server.',
          });
        },
      },
    );
  };

  const applicable = setup.steps.filter((s) => s.applies);

  return (
    <div className="border-t border-slate-100">
      <div className="px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
            <ClipboardCheck className="w-3.5 h-3.5 text-slate-400" />
            Screen setup
          </span>
          <span className="text-[10px] font-mono text-slate-500 tabular-nums">
            {setup.granted} of {setup.required} required
          </span>
        </div>

        {/* The correction the panel's own completion card now also makes:
            "required: done" is not "nothing left". */}
        {setup.optionalOutstanding > 0 && (
          <p className="text-[10px] text-amber-600 leading-snug mt-1">
            {setup.optionalOutstanding === 1
              ? '1 optional step was never set up on this panel.'
              : `${setup.optionalOutstanding} optional steps were never set up on this panel.`}
          </p>
        )}

        <div className="mt-2 space-y-1">
          {applicable.map((step) => {
            const d = describeStep(step);
            return (
              <div key={step.key} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-600 truncate" title={step.name}>
                  {step.name}
                  {step.optional && (
                    <span className="ml-1 text-[9px] uppercase tracking-wide text-slate-400">
                      optional
                    </span>
                  )}
                </span>
                <span
                  className={`text-[10px] font-semibold shrink-0 ${
                    d.tone === 'ok'
                      ? 'text-emerald-700'
                      : d.tone === 'warn'
                        ? 'text-amber-700'
                        : 'text-slate-400'
                  }`}
                >
                  {d.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* ── FLEET KNOWLEDGE, not per-screen trivia ───────────────────── */}
        {setup.vendorLost.length > 0 && (
          <div className="flex items-start gap-2 px-2 py-1.5 rounded border border-amber-200 bg-amber-50 mt-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-[10px] text-amber-800 leading-snug">
              <span className="font-bold">This model hides some Settings pages.</span>{' '}
              {setup.vendorLost.map((s) => s.name).join(', ')} —{' '}
              {setup.vendorLost.some((s) => s.launch === 'failed')
                ? 'the panel could not open them at all'
                : 'the panel had to fall back to a broader menu'}
              . Expect the same on every screen of this model, and budget an extra
              minute per panel to find them by hand.
            </div>
          </div>
        )}

        {/* ── THE CABLE-FREE WAY BACK ──────────────────────────────────── */}
        {canPush ? (
          <>
            <button
              type="button"
              onClick={openOnPanel}
              disabled={!!readOnly || pending}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-full mt-2.5 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-[11px] font-semibold text-slate-700 transition-colors"
              title="Raises the setup checklist on the screen itself so someone standing at the panel can finish the remaining grants"
            >
              {pending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5" />
              )}
              Open setup on this panel
            </button>
            <p className="text-[10px] text-slate-400 leading-snug mt-1">
              Or, at the screen: press and hold the top-left corner for 6 seconds.
            </p>
          </>
        ) : (
          <p className="text-[10px] text-slate-400 leading-snug mt-2">
            Update this screen to Player v{SETUP_PUSH_MIN_VERSION} or newer to open the
            setup list from here. Until then, at the screen: press and hold the
            top-left corner for 6 seconds.
          </p>
        )}

        {status && (
          <p
            className={`flex items-start gap-1.5 text-[10px] leading-snug mt-1.5 ${
              status.ok ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {status.ok ? (
              <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
            )}
            {status.msg}
          </p>
        )}
      </div>
    </div>
  );
}
