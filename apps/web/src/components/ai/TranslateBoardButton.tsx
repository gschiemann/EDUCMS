"use client";

/**
 * TranslateBoardButton — one-click WHOLE-BOARD localization (2026-07-05).
 *
 * The operator picks a language and the AI translates the USER-VISIBLE TEXT of
 * every element into it, applied as ONE undoable commit. Huge for K-12 (Spanish
 * / Chinese / Vietnamese / Arabic families) and the multi-vertical venues.
 *
 * Backend: POST /api/v1/ai/translate (AiService.translateBoard). It reuses the
 * chat-edit security spine (validateChatEditDiff) then STRIPS to text-only, so a
 * translation can never move / restyle / resize an element — the returned diff
 * carries only each widget's primary text field. We apply it exactly like
 * ChatToEditBox's onApply (a single updateZones commit → one undo step).
 *
 * Gated: hidden unless AI is configured AND the board has ≥1 non-HTML element
 * with editable text (a pure-image board / AI-Designer HTML board has nothing
 * for this endpoint to patch — those localize via the designer-refine loop).
 */

import { useEffect, useRef, useState } from 'react';
import { Languages, Loader2, Check, ChevronDown } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { getAiStatusSource } from '@/components/ai/AiGenerateButton';
import type { ChatEditZone, ChatDiffEntry } from '@/components/ai/ChatToEditBox';

// Mirrors the server's SUPPORTED_TRANSLATE_LANGS (ai.service.ts). The label is
// what the operator sees; the code is what the endpoint receives.
const LANGS: Array<{ code: string; label: string }> = [
  { code: 'es', label: 'Spanish' },
  { code: 'zh-Hans', label: 'Simplified Chinese' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'fr', label: 'French' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'ko', label: 'Korean' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ht', label: 'Haitian Creole' },
  { code: 'ru', label: 'Russian' },
  { code: 'de', label: 'German' },
  { code: 'ja', label: 'Japanese' },
  { code: 'hi', label: 'Hindi' },
  { code: 'so', label: 'Somali' },
  { code: 'en', label: 'English (revert)' },
];

// A light FE gate: does this zone plausibly carry translatable text? Excludes
// EXTERNAL_HTML (localized via the designer-refine loop, not this endpoint) and
// requires at least one non-empty string in the config. The SERVER is the real
// source of truth (primaryTextFieldKey), so this only decides button VISIBILITY.
function hasTranslatableText(z: ChatEditZone): boolean {
  if (z.widgetType === 'EXTERNAL_HTML') return false;
  const cfg = z.defaultConfig || {};
  return Object.values(cfg).some((v) => typeof v === 'string' && v.trim().length > 0);
}

function friendlyErr(e: any): string {
  const code = String(e?.code || '');
  const status = Number(e?.status || 0);
  const raw = (e?.message || '').toLowerCase();
  if (code === 'AI_CAP_REACHED' || status === 402) return "This month's included AI is used up — add your own AI key in Settings → AI.";
  if (code === 'AI_FAILURE_CAP_REACHED') return 'Too many failed AI requests this hour. Try again later.';
  if (status === 400 || raw.includes('no editable text')) return e?.body?.message || 'Nothing to translate on this board.';
  if (raw.includes('not configured')) return 'AI isn’t enabled — ask your admin to add a provider key.';
  if (status === 429 || raw.includes('hourly')) return 'Hit this hour’s AI limit. Try again soon.';
  if (raw.includes('unreachable') || raw.includes('unparseable')) return 'Couldn’t reach the AI. Try again.';
  return 'That didn’t work — try again.';
}

export function TranslateBoardButton({
  zones,
  vertical,
  onApply,
}: {
  /** ALL board zones (the whole board is translated, not a selection). */
  zones: ChatEditZone[];
  vertical?: string;
  /** Commit the validated text-only diff (parent owns the undo commit). */
  onApply: (diff: ChatDiffEntry[]) => void;
}) {
  const [aiSource, setAiSource] = useState<'platform' | 'tenant' | 'none' | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void getAiStatusSource().then((s) => { if (alive) setAiSource(s); });
    return () => { alive = false; abortRef.current?.abort(); };
  }, []);

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const translatable = zones.filter(hasTranslatableText);
  // Gate: AI on + something to translate. Same "hide, don't disable" contract
  // as ChatToEditBox — an unusable affordance is never shown.
  if (aiSource === null || aiSource === 'none' || translatable.length === 0) return null;

  async function run(code: string, label: string) {
    setOpen(false);
    setError(null);
    setDone(null);
    setBusy(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const res = await apiFetch<{ diff: ChatDiffEntry[]; translated: number; targetLangLabel: string }>('/ai/translate', {
        method: 'POST',
        body: JSON.stringify({
          targetLang: code,
          zones: translatable.map((z) => ({ id: z.id, widgetType: z.widgetType, defaultConfig: z.defaultConfig || {} })),
          ...(vertical ? { vertical } : {}),
        }),
        signal: abortRef.current.signal,
      });
      const diff = res?.diff || [];
      if (!diff.length) { setError('Nothing to translate on this board.'); return; }
      onApply(diff);
      setDone(`Translated ${diff.length} element${diff.length === 1 ? '' : 's'} to ${res?.targetLangLabel || label} · undo to revert`);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(friendlyErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setError(null); setDone(null); }}
        disabled={busy}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Translate every text element on this board into another language"
        className="inline-flex items-center gap-1 px-2 py-1.5 rounded text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Languages className="w-3.5 h-3.5" aria-hidden />}
        <span className="text-[10px] font-bold uppercase tracking-wider hidden md:inline">Translate</span>
        <ChevronDown className="w-3 h-3 hidden md:inline" aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Translate board to"
          className="absolute z-50 mt-1 left-0 w-52 max-h-72 overflow-y-auto rounded-lg bg-white border border-slate-200 shadow-xl py-1"
        >
          <p className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wide">Translate board to…</p>
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => void run(l.code, l.label)}
              className="w-full text-left px-3 py-1.5 text-[12px] text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      <span aria-live="polite" className="sr-only">{busy ? 'Translating the board' : done || ''}</span>

      {(done || error) && !open && (
        <div
          role={error ? 'alert' : 'status'}
          className={`absolute z-40 mt-1 left-0 w-60 rounded-md px-2 py-1 text-[10px] font-semibold shadow-lg border ${
            error ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'
          }`}
        >
          {error ? error : <span className="inline-flex items-center gap-1"><Check className="w-3 h-3" aria-hidden /> {done}</span>}
        </div>
      )}
    </div>
  );
}
