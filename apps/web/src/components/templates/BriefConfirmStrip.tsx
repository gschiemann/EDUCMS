'use client';

import { useState } from 'react';
import { Check, Loader2, Pencil, Sparkles } from 'lucide-react';
import {
  applyDesignerBriefEdit,
  designerBriefHasSignal,
  type DesignerBrief,
} from '@/hooks/use-ai-designer';

/**
 * BRIEF-ECHO CONFIRM STRIP (2026-07-01, launch-sprint #268 item 3 / task #277)
 *
 * A 2-second-glance confirm, NOT a wizard. Shows the AI Designer's structured
 * read of the operator's prompt as tappable chips (headline / occasion /
 * items / date-time / tone / CTA). Tap a chip → inline text edit. The
 * "Looks right — Generate" button is ALWAYS enabled — this strip never gates
 * generation, it only offers a chance to correct a misread before paying for
 * the expensive 3× fan-out.
 *
 * Mobile-first (thumb-sized chips, wraps naturally), no polling, no blur —
 * matches the mobile-perf-guard rules and the AI modal's existing visual
 * language (violet/fuchsia, rounded-xl, text-xs).
 */

const CHIP_FIELDS: Array<{ key: keyof DesignerBrief; label: string; placeholder: string; multi?: boolean }> = [
  { key: 'headline', label: 'Headline', placeholder: 'e.g. "Friday Night Lights"' },
  { key: 'occasion', label: 'Occasion', placeholder: 'e.g. "homecoming promo"' },
  { key: 'items', label: 'Items', placeholder: 'Comma-separated: Nachos $5, Soda $2', multi: true },
  { key: 'dateTime', label: 'When', placeholder: 'e.g. "Fridays 4-6pm"' },
  { key: 'tone', label: 'Tone', placeholder: 'e.g. "bold"' },
  { key: 'callToAction', label: 'Call to action', placeholder: 'e.g. "Order now"' },
];

function chipText(brief: DesignerBrief, key: keyof DesignerBrief): string {
  const v = brief[key];
  if (Array.isArray(v)) return v.join(', ');
  return (v as string) || '';
}

export interface BriefConfirmStripProps {
  /** Skeleton state — extraction is in flight. Shows placeholder chips. */
  loading: boolean;
  /** The extracted (or chip-edited) brief. Null while loading or if extraction found no signal. */
  brief: DesignerBrief | null;
  onChange: (next: DesignerBrief) => void;
  /** Fires on "Looks right — Generate". Never disabled by this component. */
  onConfirm: () => void;
  /** Fires on "Skip" — generate without a confirmed brief (server extracts inline). */
  onSkip: () => void;
  generating?: boolean;
}

export function BriefConfirmStrip({ loading, brief, onChange, onConfirm, onSkip, generating }: BriefConfirmStripProps) {
  const [editingKey, setEditingKey] = useState<keyof DesignerBrief | null>(null);
  const [draft, setDraft] = useState('');

  // Nothing worth confirming — no signal extracted (or not loaded yet with no
  // brief). Render nothing; the caller's own "Generate" button remains the
  // only affordance, exactly as if this component didn't exist.
  if (!loading && !designerBriefHasSignal(brief)) return null;

  const startEdit = (key: keyof DesignerBrief) => {
    if (!brief) return;
    setEditingKey(key);
    setDraft(chipText(brief, key));
  };

  const commitEdit = () => {
    if (!brief || !editingKey) return;
    const field = CHIP_FIELDS.find((f) => f.key === editingKey);
    const value = field?.multi ? draft.split(',').map((s) => s.trim()).filter(Boolean) : draft;
    onChange(applyDesignerBriefEdit(brief, editingKey, value));
    setEditingKey(null);
    setDraft('');
  };

  return (
    <div
      data-testid="brief-confirm-strip"
      className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 flex flex-col gap-2.5"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-violet-700">
        <Sparkles className="w-3.5 h-3.5" />
        {loading ? 'Reading your brief…' : 'Here’s what I heard — tap anything to fix it'}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {loading || !brief
          ? CHIP_FIELDS.map((f) => (
              <span
                key={f.key}
                data-testid="brief-chip-skeleton"
                className="h-6 w-20 rounded-full bg-violet-100 animate-pulse"
                aria-hidden
              />
            ))
          : CHIP_FIELDS.map((f) => {
              const text = chipText(brief, f.key);
              if (!text) return null; // empty fields aren't shown as chips
              const isEditing = editingKey === f.key;
              if (isEditing) {
                return (
                  <span key={f.key} className="inline-flex items-center gap-1">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit();
                        if (e.key === 'Escape') { setEditingKey(null); setDraft(''); }
                      }}
                      onBlur={commitEdit}
                      placeholder={f.placeholder}
                      aria-label={`Edit ${f.label}`}
                      className="px-2.5 py-1 text-xs rounded-full border border-violet-400 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 min-w-[120px]"
                    />
                  </span>
                );
              }
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => startEdit(f.key)}
                  title={`Tap to edit ${f.label.toLowerCase()}`}
                  className="group inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-white border border-violet-200 text-violet-800 hover:border-violet-400 hover:bg-violet-100 transition-colors max-w-[220px]"
                >
                  <span className="text-violet-400 font-normal">{f.label}:</span>
                  <span className="truncate">{text}</span>
                  <Pencil className="w-2.5 h-2.5 text-violet-300 group-hover:text-violet-500 shrink-0" />
                </button>
              );
            })}
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={onConfirm}
          disabled={!!generating}
          className="flex-1 px-3 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-sm disabled:opacity-60 flex items-center justify-center gap-1.5"
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {generating ? 'Generating…' : 'Looks right — Generate'}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={!!generating}
          className="px-3 py-2 text-xs font-semibold text-slate-400 hover:text-slate-600 disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
