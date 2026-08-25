"use client";

/**
 * ChatToEditBox — "edit this with words" (Slice 2a, 2026-06-16).
 * The operator selects ONE or MORE elements, types a plain-English
 * instruction ("make it bigger and say 'Friday Night Lights' in our brand
 * red", or "move the sponsor cards to the bottom"), and the AI proposes a
 * field-mutation DIFF. We show a per-change REVIEW CARD (no competitor
 * ships a true before-apply diff) and apply it as ONE undoable commit —
 * preview-then-apply, so a bad edit never auto-lands on a wall of screens.
 *
 * Single OR multi-zone: pass all selected zones. On Apply the parent gets
 * the validated diff and commits it (one updateZone, or one updateZones
 * transaction for a multi-zone edit → a single undo step for the whole
 * sentence). The server re-validates the model's diff against the field-map
 * (clamps, brand-token resolution, CSS-injection reject) — untrusted input.
 *
 * Backend: POST /api/v1/ai/edit/resolve (AiService.resolveChatEdit). Spec:
 * docs/research/2026-06-16-touch-editor-flagship/03-IN-EDITOR-AI-EDITING-SPEC.md §2a.
 */

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Check, X, Wand2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { getAiStatusSource } from '@/components/ai/AiGenerateButton';
import { fetchExternalChatFields } from '@/components/ai/external-chat-fields';

export interface ChatEditZone {
  id: string;
  widgetType: string;
  x?: number; y?: number; width?: number; height?: number; zIndex?: number;
  defaultConfig?: Record<string, any>;
  locked?: boolean;
}

export interface ChatDiffEntry {
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
  zones,
  onApply,
  vertical,
}: {
  /** The selected zone(s) to edit. */
  zones: ChatEditZone[];
  /** Commit the validated diff (parent owns the undo-committing store call). */
  onApply: (diff: ChatDiffEntry[]) => void;
  /** Vertical hint → per-vertical voice clause. */
  vertical?: string;
}) {
  const [aiSource, setAiSource] = useState<'platform' | 'tenant' | 'none' | null>(null);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ diff: ChatDiffEntry[]; unresolved: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The editable, non-locked zones (a locked zone is never sent / patched).
  const editable = zones.filter((z) => !z.locked);
  const idKey = editable.map((z) => z.id).join(',');

  useEffect(() => {
    let alive = true;
    void getAiStatusSource().then((s) => { if (alive) setAiSource(s); });
    return () => { alive = false; abortRef.current?.abort(); };
  }, []);

  // Reset the review when the selection changes underneath us.
  useEffect(() => { setReview(null); setError(null); }, [idKey]);

  // Gates: need at least one non-locked zone + AI configured.
  if (!editable.length) return null;
  if (aiSource === null || aiSource === 'none') return null;

  const multi = editable.length > 1;

  async function resolve() {
    const text = instruction.trim();
    if (!text) { setError('Tell the AI what to change.'); return; }
    setError(null);
    setBusy(true);
    setReview(null);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      // ── AI-Designer board (EXTERNAL_HTML with baked html) ──────────────
      // These have no structured fields for /ai/edit/resolve to patch — the
      // whole board is one HTML document. Route to the designer-refine path:
      // the model revises the current HTML per the instruction and we swap the
      // zone's html. (This is the "dial it in with AI" loop on a generated board.)
      const dz =
        editable.length === 1 &&
        editable[0].widgetType === 'EXTERNAL_HTML' &&
        typeof editable[0].defaultConfig?.html === 'string' &&
        (editable[0].defaultConfig!.html as string).length > 200
          ? editable[0]
          : null;
      if (dz) {
        const curHtml = dz.defaultConfig!.html as string;
        // utf8-safe base64 so the global request sanitizer passes it untouched.
        const b64 = btoa(unescape(encodeURIComponent(curHtml)));
        const dres = await apiFetch<{ html?: string }>('/templates/refine-designer', {
          method: 'POST',
          body: JSON.stringify({ instruction: text, htmlBase64: b64, ...(vertical ? { vertical } : {}) }),
          signal: abortRef.current.signal,
        });
        const newHtml = dres?.html;
        if (!newHtml || newHtml.length < 200) {
          setError("The AI couldn't apply that change. Try rephrasing it.");
          return;
        }
        setReview({
          diff: [{ zoneId: dz.id, patch: { defaultConfig: { html: newHtml } }, summary: [`Applied: ${text}`] }],
          unresolved: [],
        });
        return;
      }
      // ── Packaged EXTERNAL_HTML boards (B11 dead-end fix, 2026-08-24) ───
      // These render from a static /public/templates URL; their editable copy
      // is the [data-field] inventory the panel's form editor already parses.
      // Send that inventory as `chatFields` so the AI can target board copy —
      // the server routes the edits into cfg.textOverrides (the same
      // transport the form fields + in-board shim use). Without this, every
      // packaged board 422'd with "I couldn't turn that into an edit."
      const isPackagedBoard = (z: ChatEditZone) =>
        z.widgetType === 'EXTERNAL_HTML' &&
        typeof z.defaultConfig?.url === 'string' &&
        z.defaultConfig.url.trim() !== '' &&
        !(typeof z.defaultConfig?.html === 'string' && (z.defaultConfig.html as string).length > 200);
      const zonesPayload: Record<string, any>[] = [];
      for (const z of editable) {
        const zp: Record<string, any> = {
          id: z.id,
          widgetType: z.widgetType,
          x: z.x, y: z.y, width: z.width, height: z.height, zIndex: z.zIndex,
          defaultConfig: z.defaultConfig || {},
        };
        if (isPackagedBoard(z)) {
          const cf = await fetchExternalChatFields(z.defaultConfig);
          if (cf.length) {
            zp.chatFields = cf;
          } else if (editable.length === 1) {
            // No AI call to burn — be honest and point at the path that works.
            setError('This designed board doesn’t expose chat-editable text yet — tap the text on the board to edit it directly.');
            return;
          }
        }
        zonesPayload.push(zp);
      }
      const body: Record<string, any> = {
        instruction: text,
        zones: zonesPayload,
      };
      if (vertical) body.vertical = vertical;
      const res = await apiFetch<{ diff: ChatDiffEntry[]; unresolved: string[] }>('/ai/edit/resolve', {
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
    if (!review || !review.diff.length) { setReview(null); return; }
    onApply(review.diff);
    setReview(null);
    setInstruction('');
  }

  const changeCount = review ? review.diff.reduce((n, d) => n + d.summary.length, 0) : 0;
  const zoneCount = review ? review.diff.length : 0;

  return (
    <div className="rounded-lg bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 p-2.5 space-y-2" style={{ contain: 'layout paint' }}>
      <div className="flex items-center gap-1.5">
        <Wand2 className="w-3.5 h-3.5 text-indigo-600" />
        <span className="text-[11px] font-bold text-slate-700">Edit with words</span>
        <span className="text-[10px] text-slate-400">{multi ? `— ${editable.length} elements` : '— describe a change'}</span>
      </div>

      <div className="flex items-start gap-1.5">
        <textarea
          value={instruction}
          onChange={(e) => { setInstruction(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void resolve(); } }}
          placeholder={multi ? 'e.g. make them all smaller and use our brand color' : 'e.g. make it bigger and use our brand color'}
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
        {busy ? 'Working on your edit' : changeCount ? `Proposed ${changeCount} change${changeCount === 1 ? '' : 's'}, review and apply` : ''}
      </span>

      {error && (
        <div role="alert" className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded px-2 py-1">
          {error}
        </div>
      )}

      {review && (
        <div role="dialog" aria-label="Review AI edit" className="rounded-md border border-indigo-200 bg-white p-2 space-y-1.5">
          {changeCount > 0 ? (
            <>
              <p className="text-[10px] font-bold text-slate-500">
                Proposed changes{multi ? ` (${zoneCount} element${zoneCount === 1 ? '' : 's'})` : ''}
              </p>
              <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                {review.diff.flatMap((d) => d.summary.map((s, i) => (
                  <li key={`${d.zoneId}-${i}`} className="text-[11px] text-slate-800 flex items-start gap-1">
                    <Check className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" /> {s}
                  </li>
                )))}
              </ul>
            </>
          ) : (
            <p className="text-[11px] text-slate-600">No applicable changes.</p>
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
            {changeCount > 0 && (
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
