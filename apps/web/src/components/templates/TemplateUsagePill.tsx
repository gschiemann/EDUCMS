"use client";

/**
 * Templates Gallery — Calm v1 · the card's operational status row (§6.1
 * items 4-5, §6.3).
 *
 * Renders NOTHING when usage is unknown — that emptiness is the point (see
 * template-usage.ts rule 1). Every pill states its meaning in words, so a
 * colour-blind operator reads the same fact as everyone else (§14).
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  type TemplateUsageState,
  usagePillLabel,
  usageReachLabel,
} from './template-usage';

export function TemplateUsagePill({
  state,
  needsAttention = false,
}: {
  state: TemplateUsageState;
  /** §10.5 — the SAVED template is broken (not merely its thumbnail). */
  needsAttention?: boolean;
}) {
  const pill = usagePillLabel(state);
  const reach = usageReachLabel(state);

  if (!pill && !reach && !needsAttention) return null;

  const live = state.kind === 'live';

  return (
    <div className="flex flex-col gap-1 min-w-0">
      {(pill || needsAttention) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {needsAttention && (
            <span
              data-testid="template-attention-pill"
              className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800"
              title="This layout has no content yet — a screen running it would show nothing."
            >
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Needs attention
            </span>
          )}
          {pill && (
            <span
              data-testid="template-usage-pill"
              className={
                live
                  ? 'inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800'
                  : 'inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500'
              }
            >
              {live && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              )}
              {pill}
            </span>
          )}
        </div>
      )}
      {reach && (
        <p data-testid="template-usage-reach" className="truncate text-[11px] font-medium text-slate-500">
          {reach}
        </p>
      )}
    </div>
  );
}
