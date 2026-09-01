'use client';

/**
 * "Reset canvas on the screen" — the dashboard's reach into a DEVICE-SIDE
 * LED canvas pin (2026-09-01, G55 field find).
 *
 * The player's own on-screen "Resize for LED" editor writes `edu_canvasW/H`
 * to the panel's localStorage (and `?canvasW=` to its URL). The pin script
 * prefers that over the panel's real size on every boot, and the server never
 * hears about it — so a stale pin shrinks every template into a corner of the
 * glass across reboots and APK updates, and nothing in the dashboard could
 * reach it: the LED-canvas section only renders for LED hardware, by design
 * (standard LCDs must not see LED controls). A 2160×3840 Goodview G55 drew its
 * board in roughly a 720×1280 box, top-left, the rest black.
 *
 * This sends RESET_CANVAS over the display-control transport (same RBAC,
 * audit row, signed per-screen fan-out and outcome ring as every other
 * action). The web player clears the pin and reloads at the panel's native
 * size. Copy states what was SENT, never what the glass shows.
 */

import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { useDisplayControl, DISPLAY_CONTROL_TIMEOUT_MS } from '@/hooks/use-api';

export function CanvasResetSection({
  screen,
  readOnly,
}: {
  screen: any;
  /** RESTRICTED_VIEWER / CONTRIBUTOR — the button is inert. */
  readOnly?: boolean;
}) {
  const control = useDisplayControl();
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // APK players only: the pin lives in the panel's own storage. A browser
  // preview has nothing to reset and no push channel to reach.
  const osInfoLc = String(screen?.osInfo ?? '').toLowerCase();
  const isAndroid = osInfoLc.includes('android') || screen?.hardwareModel === 'generic-android';
  if (!isAndroid) return null;

  const native = typeof screen?.resolution === 'string' && screen.resolution.trim()
    ? screen.resolution.trim()
    : null;
  const pending = control.isPending;

  const send = () => {
    if (readOnly || pending) return;
    setStatus(null);
    control.mutate(
      { screenId: screen.id, action: 'RESET_CANVAS' },
      {
        onSuccess: (res: any) => {
          setStatus(
            res?.delivered === false
              ? {
                  ok: false,
                  msg: 'Queued — this screen has no live push channel right now; it resets when it reconnects.',
                }
              : {
                  ok: true,
                  msg: 'Sent — the screen clears any canvas size set on it and reloads at its panel-native size.',
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

  return (
    <div className="px-3.5 py-2.5 border-b border-slate-100" data-testid="canvas-reset-section">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
          <Maximize2 className="w-3.5 h-3.5 text-slate-400" />
          Canvas
        </span>
        <span className="text-[10px] font-mono text-slate-500 tabular-nums">
          {native ? `panel ${native}` : 'panel size not reported'}
        </span>
      </div>
      <p className="text-[10px] text-slate-500 leading-snug mt-1">
        If this screen draws its content in one corner with the rest black, a canvas size was
        set on the screen itself. This clears it.
      </p>
      <button
        type="button"
        onClick={(e) => {
          // Same discipline as the LED canvas buttons: the popover's
          // document-level outside-click handler must not see this click.
          e.stopPropagation();
          send();
        }}
        disabled={readOnly || pending}
        className="mt-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Clears any LED canvas size set on the screen itself and reloads the player at the panel's native size."
      >
        {pending ? 'Sending…' : 'Reset canvas on the screen'}
      </button>
      {status && (
        <p className={`text-[10px] leading-snug mt-1 ${status.ok ? 'text-emerald-700' : 'text-amber-700'}`}>
          {status.msg}
        </p>
      )}
    </div>
  );
}
