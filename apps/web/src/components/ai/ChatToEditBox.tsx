"use client";

/**
 * ChatToEditBox — "edit this element with words" (Slice 2a, 2026-06-16).
 * The operator selects an element, types a plain-English instruction
 * ("make it bigger and say 'Friday Night Lights' in our brand red"), and
 * the AI proposes a field-mutation DIFF. We show a per-change REVIEW CARD
 * (no competitor does a true before-apply diff) and apply it as ONE
 * undoable commit — preview-then-apply, so a bad edit never auto-lands.
 *
 * MVP scope: single selected zone; text + font size + color. The server
 * re-validates the model's diff against the field-map (clamps, brand-token
 * resolution, CSS-injection reject) — the model output is untrusted.
 *
 * Backend: POST /api/v1/ai/edit/resolve (AiService.resolveChatEdit). Spec:
 * docs/research/2026-06-16-touch-editor-flagship/03-IN-EDITOR-AI-EDITING-SPEC.md §2a.
 */

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Check, X, Wand2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { hasRewriteableText } from '@cms/api-types';
import { getAiStatusSource } from '@/components/ai/AiGenerateButton';

interface DiffEntry {
  zoneId: string;
  /** zone-level keys (x/y/width/height/zIndex) + optional defaultConfig. */
  patch: Record<string, any>;
  summary: string[];
}

function friendlyChatError(e: any): string {
  const code = String(e?.code || '');
  const status = Number(e?.status || 0);
  const raw = (e?.message || '').toLowerCase();
  if (code === 'NO_RESOLVABLE_EDITS' || status === 422) {
    return e?.body?.message || 'I couldn’t turn that into an edit — try naming the change (e.g. “make the title bigger”).';
  }
  if (code === 'AI_PROVIDER_OUT_OF_CREDIT') return e?.body?.message || 'Your AI provider is out of credit.';
  if (code === 'AI_CAP_REACHED' || status === 402) return 'Monthly free AI used up — add your own key in Settings → AI.';
  if (code === 'AI_FAILURE_CAP_REACHED') return 'Too many failed AI requests this hour. Try again later.';
  if (raw.includes('not configured')) return 'AI isn’t enabled — ask your admin to add a provider key.';
  if (raw.includes('rejected') || raw.includes('re-enter')) return e.message;
  if (status === 429 || raw.includes('hourly') || raw.includes('rate-limit')) return 'Hit this hour’s AI limit. Try again soon.';
  if (raw.includes('unreachable')) return 'Couldn’t reach the AI. Check your connection.';
  if (status === 503 && e?.message) return e.message;
  return 'That didn’t work — try rephrasing.';
}

export function ChatToEditBox({
  zone,
  updateZone,
  vertical,
}: {
  zone: {
    id: string;
    widgetType: string;
    x?: number; y?: number; width?: number; height?: number; zIndex?: number;
    defaultConfig?: Record<string, any>;
    locked?: boolean;
  };
  /** updateZone(id, patch, commit) — the undo-committing store setter. */
  updateZone: (id: string, patch: Record<string, any>, commit?: boolean) => void;
  vertical?: string;
}) {
  const [aiSource, setAiSource] = useState<'platform' | 'tenant' | 'none' | null>(null);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ diff: DiffEntry[]; unresolved: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void getAiStatusSource().then((s) => { if (alive) setAiSource(s); });
    return () => { alive = false; abortRef.current?.abort(); };
  }, []);

  // Reset the review when the selected element changes underneath us.
  useEffect(() => { setReview(null); setError(null); }, [zone.id]);

  // Gates: only for editable text-bearing widgets, not locked, AI configured.
  if (zone.locked || !hasRewriteableText(zone.widgetType)) return null;
  if (aiSource === null || aiSource === 'none') return null;

  async function resolve() {
    const text = instruction.trim();
    if (!text) { setError('Tell the AI what to change.'); return; }
    setError(null);
    setBusy(true);
    setReview(null);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const body: Record<string, any> = {
        instruction: text,
        zones: [{
          id: zone.id,
          widgetType: zone.widgetType,
          x: zone.x, y: zone.y, width: zone.width, height: zone.height, zIndex: zone.zIndex,
          defaultConfig: zone.defaultConfig || {},
        }],
      };
      if (vertical) body.vertical = vertical;
      const res = await apiFetch<{ diff: DiffEntry[]; unresolved: string[] }>('/ai/edit/resolve', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });
      setReview({ diff: res?.diff || [], unresolved: res?.unresolved || [] });
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(friendlyChatError(e));
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!review) return;
    const entry = review.diff.find((d) => d.zoneId === zone.id);
    if (!entry) { setReview(null); return; }
    // Build the zone patch: zone-level keys (x/y/width/height/zIndex) pass
    // through; defaultConfig changes merge onto the LIVE config (handles a
    // stale diff if the operator nudged the zone meanwhile). One undo step.
    const { defaultConfig: cfgPatch, ...zoneKeys } = entry.patch;
    const merged: Record<string, any> = { ...zoneKeys };
    if (cfgPatch) merged.defaultConfig = { ...(zone.defaultConfig || {}), ...cfgPatch };
    updateZone(zone.id, merged, true);
    setReview(null);
    setInstruction('');
  }

  const entry = review?.diff.find((d) => d.zoneId === zone.id);

  return (
    <div className="rounded-lg bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 p-2.5 space-y-2" style={{ contain: 'layout paint' }}>
      <div className="flex items-center gap-1.5">
        <Wand2 className="w-3.5 h-3.5 text-indigo-600" />
        <span className="text-[11px] font-bold text-slate-700">Edit with words</span>
        <span className="text-[10px] text-slate-400">— describe a change</span>
      </div>

      <div className="flex items-start gap-1.5">
        <textarea
          value={instruction}
          onChange={(e) => { setInstruction(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void resolve(); } }}
          placeholder='e.g. make it bigger and use our brand color'
          rows={2}
          maxLength={500}
          disabled={busy}
          aria-label="Describe the change to make"
          className="flex-1 px-2 py-1.5 rounded-md bg-white border border-slate-200 text-[11px] focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={resolve}
          disabled={busy || !instruction.trim()}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1.5 rounded-md shadow-sm"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {busy ? '…' : 'Go'}
        </button>
      </div>

      <span aria-live="polite" className="sr-only">
        {busy ? 'Working on your edit' : entry ? `Proposed ${entry.summary.length} change${entry.summary.length === 1 ? '' : 's'}, review and apply` : ''}
      </span>

      {error && (
        <div role="alert" className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded px-2 py-1">
          {error}
        </div>
      )}

      {review && (
        <div role="dialog" aria-label="Review AI edit" className="rounded-md border border-indigo-200 bg-white p-2 space-y-1.5">
          {entry && entry.summary.length > 0 ? (
            <>
              <p className="text-[10px] font-bold text-slate-500">Proposed changes</p>
              <ul className="space-y-0.5">
                {entry.summary.map((s, i) => (
                  <li key={i} className="text-[11px] text-slate-800 flex items-start gap-1">
                    <Check className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" /> {s}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[11px] text-slate-600">No applicable changes for this element.</p>
          )}
          {review.unresolved.length > 0 && (
            <p className="text-[10px] text-amber-700 bg-amber-50 rounded px-1.5 py-1">
              Couldn’t apply: {review.unresolved.join('; ')}
            </p>
          )}
          <div className="flex items-center justify-end gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => setReview(null)}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 hover:text-slate-800 px-2 py-1 rounded"
            >
              <X className="w-3 h-3" /> Discard
            </button>
            {entry && entry.summary.length > 0 && (
              <button
                type="button"
                onClick={apply}
                className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 rounded shadow-sm"
              >
                <Check className="w-3 h-3" /> Apply
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
