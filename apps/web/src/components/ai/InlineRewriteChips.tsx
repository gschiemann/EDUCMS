"use client";

/**
 * InlineRewriteChips — one-tap AI rewrite of a single on-canvas text field
 * (Slice 1d, 2026-06-16). Sits next to the sparkle "Generate" button in the
 * builder's PropertiesPanel. When the clicked field already has text, the
 * operator can tap Rewrite / Shorten / Fit-to-zone and pick from up to 3
 * AI options that drop straight into the field (undoable — the pick goes
 * through the same updateZone(...,commit:true) setter as manual edits).
 *
 * Preview-then-apply: the operator SEES each option before tapping it, so a
 * bad rewrite never auto-lands on a wall of screens. Touch-first: pick by
 * tap, never hover (the primary device is an iPad).
 *
 * Backend: POST /api/v1/ai/text/rewrite (apps/api/src/ai/ai.service.ts
 * rewriteText) — same provider/cap/audit plumbing + output sanitization as
 * the sparkle generator. Spec: docs/research/2026-06-16-touch-editor-
 * flagship/03-IN-EDITOR-AI-EDITING-SPEC.md §1d.
 */

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Wand2, Scissors, Maximize2, X, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { getTextFieldDescriptor } from '@cms/api-types';
import { getAiStatusSource } from '@/components/ai/AiGenerateButton';

type RewriteOp = 'rewrite' | 'shorten' | 'fit_to_zone';

const CHIPS: { op: RewriteOp; label: string; Icon: typeof Wand2 }[] = [
  { op: 'rewrite', label: 'Rewrite', Icon: Wand2 },
  { op: 'shorten', label: 'Shorten', Icon: Scissors },
  { op: 'fit_to_zone', label: 'Fit to zone', Icon: Maximize2 },
];

/** Compact, structured-code-first friendly error mapping (mirrors AiGenerateButton). */
function friendlyRewriteError(e: any): string {
  const code = String(e?.code || '');
  const status = Number(e?.status || 0);
  const raw = (e?.message || '').toLowerCase();
  if (code === 'AI_PROVIDER_OUT_OF_CREDIT') return e?.body?.message || e?.message || 'Your AI provider is out of credit.';
  if (code === 'AI_CAP_REACHED' || status === 402) return 'Monthly free AI used up — add your own key in Settings → AI.';
  if (code === 'AI_FAILURE_CAP_REACHED') return 'Too many failed AI requests this hour. Try again later.';
  if (raw.includes('not configured')) return 'AI isn’t enabled — ask your admin to add a provider key.';
  if (raw.includes('rejected') || raw.includes('re-enter')) return e.message;
  if (status === 429 || raw.includes('hourly') || raw.includes('rate-limit')) return 'Hit this hour’s AI limit. Try again soon.';
  if (raw.includes('empty')) return 'The AI returned nothing — try again.';
  if (raw.includes('unreachable')) return 'Couldn’t reach the AI. Check your connection.';
  if (status === 503 && e?.message) return e.message;
  return 'Rewrite failed — try again.';
}

export function InlineRewriteChips({
  text,
  widgetType,
  fieldKey,
  fontSize,
  zonePx,
  locked,
  vertical,
  onPick,
}: {
  /** Current text of the field (the thing being rewritten). */
  text: string;
  widgetType: string;
  fieldKey: string;
  /** Current font size px — enables the "Fit to zone" chip. */
  fontSize?: number;
  /** Rendered px box of the zone — enables "Fit to zone". */
  zonePx?: { w: number; h: number };
  /** A locked zone shows no rewrite chips (can't edit it). */
  locked?: boolean;
  /** Vertical hint → per-vertical voice clause on the rewrite. */
  vertical?: string;
  /** Apply the chosen rewrite to the field (must commit via the store). */
  onPick: (text: string) => void;
}) {
  const [aiSource, setAiSource] = useState<'platform' | 'tenant' | 'none' | null>(null);
  const [busyOp, setBusyOp] = useState<RewriteOp | null>(null);
  const [openOp, setOpenOp] = useState<RewriteOp | null>(null);
  const [options, setOptions] = useState<Array<{ text: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void getAiStatusSource().then((s) => { if (alive) setAiSource(s); });
    return () => { alive = false; abortRef.current?.abort(); };
  }, []);

  const trimmed = (text || '').trim();
  // Gates (spec first-increment): no chips when locked (P0-2), when there's
  // nothing to rewrite (P1-5), when the field isn't plain/rich text, while
  // the AI status is loading (avoid a flash), or when no AI key is set (the
  // sibling sparkle already shows the "Set up AI" affordance).
  const descriptor = getTextFieldDescriptor(widgetType, fieldKey);
  if (locked || !trimmed || !descriptor || descriptor.kind === 'list') return null;
  if (aiSource === null || aiSource === 'none') return null;

  const canFit = !!fontSize && fontSize > 0 && !!zonePx && zonePx.w > 0 && zonePx.h > 0;
  const chips = CHIPS.filter((c) => c.op !== 'fit_to_zone' || canFit);

  async function run(op: RewriteOp) {
    setError(null);
    setBusyOp(op);
    setOpenOp(op);
    setOptions([]);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const body: Record<string, any> = { widgetType, fieldKey, currentText: trimmed, op };
      if (vertical) body.vertical = vertical;
      if (op === 'fit_to_zone') { body.fontSize = fontSize; body.zonePx = zonePx; }
      const res = await apiFetch<{ options: Array<{ text: string }> }>('/ai/text/rewrite', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });
      const opts = res?.options || [];
      setOptions(opts);
      if (!opts.length) setError('No suggestion — try again.');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(friendlyRewriteError(e));
      setOpenOp(null);
    } finally {
      setBusyOp(null);
    }
  }

  function close() {
    setOpenOp(null);
    setOptions([]);
    setError(null);
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rewrite this text with AI">
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-violet-500">
          <Sparkles className="w-3 h-3" /> AI
        </span>
        {chips.map(({ op, label, Icon }) => (
          <button
            key={op}
            type="button"
            onClick={() => run(op)}
            disabled={busyOp !== null}
            aria-haspopup="dialog"
            aria-expanded={openOp === op}
            className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1 rounded-full transition-colors"
          >
            {busyOp === op ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
            {label}
          </button>
        ))}
      </div>

      {/* SR-only live region so screen readers hear the result state. */}
      <span aria-live="polite" className="sr-only">
        {busyOp ? 'Generating rewrite suggestions' : options.length ? `${options.length} suggestion${options.length === 1 ? '' : 's'} ready` : ''}
      </span>

      {error && (
        <div role="alert" className="mt-1.5 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded px-2 py-1">
          {error}
        </div>
      )}

      {openOp && options.length > 0 && (
        <div
          role="dialog"
          aria-label="AI rewrite suggestions"
          className="mt-1.5 rounded-lg border border-violet-200 bg-white shadow-lg p-1.5 space-y-1"
          // mobile-perf: no backdrop-blur; contain the repaint to this card.
          style={{ contain: 'layout paint' }}
        >
          <div className="flex items-center justify-between px-1 pb-0.5">
            <span className="text-[10px] font-bold text-slate-500">Tap one to use it</span>
            <button type="button" onClick={close} aria-label="Close suggestions" className="text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {options.map((o, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { onPick(o.text); close(); }}
              className="w-full text-left text-[11px] leading-snug text-slate-800 rounded-md border border-slate-200 hover:border-violet-400 hover:bg-violet-50/50 px-2 py-1.5 transition-colors"
            >
              {o.text}
            </button>
          ))}
          <button
            type="button"
            onClick={() => run(openOp)}
            disabled={busyOp !== null}
            className="w-full inline-flex items-center justify-center gap-1 text-[10px] font-semibold text-violet-600 hover:text-violet-700 disabled:opacity-50 px-2 py-1"
          >
            <RefreshCw className="w-3 h-3" /> Try again
          </button>
        </div>
      )}
    </div>
  );
}
