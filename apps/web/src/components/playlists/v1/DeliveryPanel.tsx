"use client";

/**
 * DeliveryPanel — the workspace's Delivery tab (handoff §15).
 *
 * This is the operational trust surface the old playlist workspace did not
 * have. Its whole job is to be believed, which means it says exactly what each
 * column is built on and leaves the columns it cannot fill visibly empty:
 *
 *   • Reachability      — the screen's ping-derived status. Reachable is not
 *                         proof of a picture, and never coloured as if it were.
 *   • Picture           — the device's own render proof. Proof that SOMETHING
 *                         was painted, not proof of WHAT.
 *   • Update            — VALUE-identity acknowledgement: the player echoed
 *                         back the exact pending-refresh value it was sent.
 *                         Equality, never a clock comparison (a signage box
 *                         runs minutes of skew).
 *   • Content signature — PERMANENTLY "Not compared". The platform stores no
 *                         expected per-target signature, so there is nothing to
 *                         compare a reported one against (§10.3). This column
 *                         exists to make the gap visible rather than let a
 *                         layout imply it was checked.
 *
 * §22.5 — when the delivery read fails, this tab says so and offers a retry. It
 * is never downgraded to a healthy gray, and it never prints a count it did
 * not receive.
 */

import { AlertTriangle, ExternalLink, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import {
  deriveDeliveryFromScreens, deriveTargetsFromScreens, exactStamp, summarizeDelivery,
  summarizeDeliveryPayload, timeAgo,
  type DeliveryPayload, type DeliverySummary, type DeliveryTarget, type OpsScreenRef,
} from './playlistOps';

const INK = 'text-[#111A3A]';
const INK_2 = 'text-[#536181]';
const INK_3 = 'text-[#7B87A4]';
const HAIRLINE = 'border-[#E4E8F1]';
const SURFACE = `bg-white border ${HAIRLINE}`;

const TONE_TEXT: Record<string, string> = {
  ok: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-rose-700',
  muted: 'text-[#7B87A4]',
  unavailable: 'text-amber-700',
};
const TONE_SHELL: Record<string, string> = {
  ok: 'border-emerald-200 bg-emerald-50/60',
  warn: 'border-amber-200 bg-amber-50/60',
  bad: 'border-rose-200 bg-rose-50/60',
  muted: `${HAIRLINE} bg-slate-50/60`,
  unavailable: 'border-amber-200 bg-amber-50/60',
};

export interface DeliveryPanelProps {
  playlistName: string;
  /** The API's answer. `null` = the read FAILED (not "nothing to report"). */
  payload: DeliveryPayload | null | undefined;
  /** True while the delivery query is in flight. */
  loading: boolean;
  /**
   * False when the API answered. True when it did not and this panel is
   * showing the client-side derivation from each screen's own report — which
   * it states out loud rather than passing off as deployment truth.
   */
  derived: boolean;
  /** Target screens, for the derivation and for the per-row evidence columns. */
  targetScreens: OpsScreenRef[];
  onRetry: () => void;
  onRefreshScreen: (screenId: string) => void;
  refreshingScreenId: string | null;
  onOpenScreen: (screenId: string) => void;
  isViewer: boolean;
}

export function DeliveryPanel(props: DeliveryPanelProps) {
  const { payload, derived, targetScreens, loading } = props;

  if (loading) {
    return (
      <div className={`rounded-[12px] p-10 flex items-center justify-center ${SURFACE}`} aria-busy="true">
        <Loader2 className={`w-5 h-5 animate-spin ${INK_3}`} aria-hidden />
        <span className="sr-only">Checking delivery…</span>
      </div>
    );
  }

  // Which source is answering, and what does it say?
  // Must match the TABLE's own test below (`apiAnswered && payload?.latest`).
  // They used to disagree: a payload of `{latest: null, history: []}` made this
  // true, so the summary took the "API answered" branch and printed the
  // NOT_PUBLISHED label, while the table fell through to the screen-derived
  // list and showed a reachable, picture-confirmed screen. One playlist, two
  // sources, opposite claims — Greg's screenshot, 2026-09-16.
  const apiAnswered = !derived && payload != null && payload.latest != null;
  const summary: DeliverySummary = apiAnswered
    ? summarizeDeliveryPayload(payload)
    : derived
      ? (targetScreens.length > 0
        // deriveDeliveryFromScreens, NOT summarizeDelivery: the wrapper carries
        // the anyPending guard (playlistOps.ts) that downgrades "Update received
        // on N of N" to "Picture confirmed on N of N" when NOTHING was ever
        // pushed. Calling summarizeDelivery raw skipped it, so this panel could
        // claim a deployment that never happened — the exact overclaim §4.3
        // exists to prevent. The route and the library row both use the wrapper.
        ? deriveDeliveryFromScreens(targetScreens)
        : summarizeDelivery([]))
      : summarizeDeliveryPayload(null); // read failed → §22.5

  const targets: DeliveryTarget[] = apiAnswered && payload?.latest
    ? payload.latest.targets
    : deriveTargetsFromScreens(targetScreens);

  const screenById = new Map(targetScreens.map((s) => [s.id, s]));

  return (
    <div className="space-y-4">
      {/* ── §15.1 summary block — only when there is something to say. A
             healthy playlist opens straight onto its screens; the exception
             states (warn / bad / unavailable) still lead, and 'unavailable'
             keeps its Retry. ── */}
      {summary.tone !== 'ok' && summary.tone !== 'muted' && (
      <div className={`rounded-[12px] border p-4 ${TONE_SHELL[summary.tone] ?? TONE_SHELL.muted}`}>
        <div className="flex items-start gap-3">
          {/* Only warn / bad / unavailable reach this block now — the gate above
              excludes 'ok' and 'muted', and tsc proved the old Check/Clock
              branches unreachable. A healthy or not-yet-pushed playlist shows
              no banner at all; it opens straight onto its screens. */}
          <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${TONE_TEXT[summary.tone]}`} aria-hidden />
          <div className="flex-1 min-w-0">
            <p className={`text-[14px] font-bold ${TONE_TEXT[summary.tone] ?? INK}`}>{summary.label}</p>
            {summary.detail && <p className={`text-[13px] mt-0.5 ${INK_2}`}>{summary.detail}</p>}
            {apiAnswered && payload?.latest && (
              <p className={`text-[12px] mt-1 ${INK_3}`} title={exactStamp(payload.latest.createdAt)}>
                Last update requested {timeAgo(payload.latest.createdAt)} · {payload.latest.label}
              </p>
            )}
            {summary.tone === 'unavailable' && (
              <button
                type="button"
                onClick={props.onRetry}
                className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-[9px] border border-amber-300 bg-white text-[13px] font-bold text-amber-800"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden />
                Retry delivery status
              </button>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Say where these numbers come from. An operator who is told the source
          can weigh the claim; one who is not has to trust a colour. */}
      {derived && targetScreens.length > 0 && (
        <p className={`text-[12px] ${INK_3}`}>
          Built from each screen’s own last report — nothing has been pushed to
          these screens from here.
        </p>
      )}

      {/* ── §15.2 target table ── */}
      {targets.length === 0 ? (
        <div className={`rounded-[12px] px-6 py-10 text-center ${SURFACE}`}>
          <p className={`text-[14px] font-bold ${INK}`}>Not published to any screen</p>
          <p className={`text-[13px] ${INK_2} mt-1`}>
            Add a publishing rule and this table will show every screen it reaches.
          </p>
        </div>
      ) : (
        <div className={`rounded-[12px] overflow-hidden ${SURFACE}`}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" data-testid="delivery-table">
              <caption className="sr-only">
                Every screen this playlist reaches, with its reachability, picture proof and update state
              </caption>
              <thead>
                <tr className={`border-b ${HAIRLINE}`}>
                  {['Screen', 'Reachable', 'Picture', 'Update', ''].map((h, i) => (
                    <th
                      key={h || `sp-${i}`}
                      scope="col"
                      className={`text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide ${INK_3}`}
                    >
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => {
                  const sc = screenById.get(t.screenId);
                  const bad = t.state !== 'acknowledged';
                  return (
                    <tr
                      key={t.screenId}
                      className={`border-b last:border-b-0 ${HAIRLINE} ${bad ? 'bg-amber-50/40' : ''}`}
                      data-testid="delivery-row"
                      data-state={t.state}
                    >
                      <td className="px-3 py-2.5">
                        <p className={`text-[13px] font-bold ${INK}`}>{t.name}</p>
                        {t.locationName && <p className={`text-[12px] ${INK_3}`}>{t.locationName}</p>}
                        {sc?.authState === 'REPAIR_REQUIRED' && (
                          <p className="text-[11px] text-rose-700 font-semibold">Re-pair required</p>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {t.online ? (
                          <span className="text-[13px] text-emerald-700 font-semibold">Yes</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[13px] text-amber-700 font-semibold">
                            <WifiOff className="w-3.5 h-3.5" aria-hidden /> Offline
                          </span>
                        )}
                        {sc?.pushChannel === 'stale' && (
                          <p className={`text-[11px] ${INK_3}`}>Instant commands not arriving</p>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {t.state === 'no-picture' ? (
                          <span className="text-[13px] text-rose-700 font-semibold">No picture confirmed</span>
                        ) : t.lastProofAt ? (
                          <span className="text-[13px] text-emerald-700 font-semibold" title={exactStamp(t.lastProofAt)}>
                            Picture confirmed {timeAgo(t.lastProofAt)}
                          </span>
                        ) : (
                          <span className={`text-[13px] ${INK_3}`}>Never reported</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {t.state === 'acknowledged' && t.ackAt ? (
                          <span className="text-[13px] text-emerald-700 font-semibold">Received</span>
                        ) : t.state === 'not-updated' ? (
                          <span className="text-[13px] text-amber-800 font-semibold">Not received</span>
                        ) : t.state === 'offline' ? (
                          <span className={`text-[13px] ${INK_3}`}>Cannot be reached</span>
                        ) : (
                          <span className={`text-[13px] ${INK_3}`}>Nothing requested</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          {/* §15.3 — named actions only. No generic "Fix". */}
                          {!props.isViewer && t.online && (
                            <button
                              type="button"
                              onClick={() => props.onRefreshScreen(t.screenId)}
                              disabled={props.refreshingScreenId === t.screenId}
                              className={`h-8 px-2.5 rounded-[8px] border ${HAIRLINE} bg-white text-[12px] font-bold ${INK_2} hover:bg-slate-50 disabled:opacity-50`}
                              title="Ask this screen to reload its page and fetch the current content"
                            >
                              {props.refreshingScreenId === t.screenId ? 'Sending…' : 'Refresh screen'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => props.onOpenScreen(t.screenId)}
                            className={`h-8 px-2.5 rounded-[8px] border ${HAIRLINE} bg-white text-[12px] font-bold ${INK_2} hover:bg-slate-50 inline-flex items-center gap-1`}
                          >
                            Open screen
                            <ExternalLink className="w-3 h-3" aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={`px-3 py-2.5 text-[12px] ${INK_3} border-t ${HAIRLINE}`}>
            No screen is checked against an expected copy of this playlist — the
            platform does not store one. The rows above say what each screen
            reports about itself, not what it is showing.
          </p>
        </div>
      )}

      {/* ── §15.4 history ── */}
      {apiAnswered && (payload?.history?.length ?? 0) > 0 && (
        <div className={`rounded-[12px] overflow-hidden ${SURFACE}`}>
          <h3 className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide ${INK_3} border-b ${HAIRLINE}`}>
            Recent updates
          </h3>
          <ul>
            {payload!.history.map((h) => (
              <li key={h.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 border-b last:border-b-0 ${HAIRLINE}`}>
                <div className="min-w-0">
                  <p className={`text-[13px] font-semibold ${INK} truncate`}>{h.label}</p>
                  <p className={`text-[12px] ${INK_3}`} title={exactStamp(h.createdAt)}>{timeAgo(h.createdAt)}</p>
                </div>
                <span className={`text-[13px] font-semibold shrink-0 ${h.acknowledged >= h.targetCount ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {h.acknowledged} of {h.targetCount} received
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default DeliveryPanel;
