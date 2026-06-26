"use client";

/**
 * ContentApprovalCard — org-wide "Require approval before any content goes
 * live" gate (Appspace-parity enterprise control, 2026-06-26).
 *
 * OFF (default): a CONTRIBUTOR stages content and uses the explicit "Send
 * for review" flow only when they choose to — single-operator tenants keep
 * today's frictionless behavior.
 *
 * ON: every CONTRIBUTOR publish/schedule is routed through the existing
 * submit-for-review queue instead of going live directly. Admins
 * (SCHOOL_ADMIN / DISTRICT_ADMIN / SUPER_ADMIN) bypass the gate — they ARE
 * the approvers and publish straight to screens.
 *
 * Settable only by DISTRICT_ADMIN / SUPER_ADMIN (server-enforced); the
 * parent page wraps this card in a RoleGate for those roles too.
 *
 * Single-row card matching the Emergency / AI / Industry row pattern.
 */

import { ShieldCheck, ShieldOff, Loader2, ClipboardCheck } from 'lucide-react';
import { useContentApprovalConfig, useToggleContentApproval } from '@/hooks/use-api';

export function ContentApprovalCard() {
  const { data: cfg, isLoading, isError } = useContentApprovalConfig();
  const toggle = useToggleContentApproval();

  // Treat undefined config as OFF so the toggle is never wedged disabled by
  // a GET racing the first render — we rely on toggle.isPending for the
  // in-flight state, mirroring LocationBasedEmergencyCard.
  const enabled = !!cfg?.enabled;
  const known = cfg !== undefined;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between mt-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
          <ClipboardCheck className="w-4 h-4 text-indigo-600" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-800">Require approval before content goes live</div>
          <div className="text-[11px] text-slate-500">
            When on, an Editor&apos;s publish is sent to the review queue for an
            admin to approve first. Admins still publish directly.
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => toggle.mutate(!enabled)}
        disabled={toggle.isPending || !known}
        aria-pressed={enabled}
        className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-bold uppercase tracking-wide transition-colors ${
          enabled
            ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
            : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-400'
        } disabled:opacity-60 disabled:cursor-not-allowed`}
        title={enabled ? 'Turn off the approval gate' : 'Require admin approval before content goes live'}
      >
        {toggle.isPending || isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : enabled ? (
          <ShieldCheck className="w-4 h-4" />
        ) : (
          <ShieldOff className="w-4 h-4" />
        )}
        <span>{isLoading ? 'Loading' : isError ? 'Unavailable' : `Approval ${enabled ? 'On' : 'Off'}`}</span>
      </button>
    </div>
  );
}
