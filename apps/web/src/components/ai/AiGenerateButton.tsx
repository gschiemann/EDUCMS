"use client";

/**
 * AiGenerateButton — sparkle button + modal for Claude-backed copy generation.
 *
 * 2026-05-03 — operator: "get us at the top level of everyone". Drops
 * next to text fields in the PropertiesPanel so an operator typing an
 * announcement / quote / promo / menu-item description can hit "✨ AI"
 * and get 3 options back, ranked. Pick → fills the target field.
 *
 * Backend: POST /api/v1/ai/generate (apps/api/src/ai/ai.service.ts).
 * Cost-capped at 30 calls/hour/tenant, 300 max_tokens, claude-3-5-haiku.
 *
 * Why this is THE differentiator:
 *   - Yodeck / Rise Vision / BrightSign: zero AI features.
 *   - OptiSigns / ScreenCloud: AI suggestions in their template editor
 *     but for static design content, not the live copy in widgets.
 *   - VenueOS: AI generates the actual text the screen displays — the
 *     announcement, the daily special, the motivational quote — with
 *     intent-aware system prompts so a gym quote doesn't read like a
 *     restaurant promo.
 */

import { useState, useEffect } from 'react';
import { Sparkles, Loader2, X, RefreshCw, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useTenantCopy } from '@/hooks/use-tenant-copy';

export type AiIntent =
  | 'announcement'
  | 'quote'
  | 'menu_item'
  | 'promo'
  | 'daypart'
  | 'ticker';

const INTENT_LABELS: Record<AiIntent, string> = {
  announcement: 'announcement',
  quote: 'motivational quote',
  menu_item: 'menu item description',
  promo: 'daily promo',
  daypart: 'daypart copy',
  ticker: 'ticker line',
};

const INTENT_PLACEHOLDERS: Record<AiIntent, string> = {
  announcement: 'Spring break next week — final school day Friday, lunch served as usual',
  quote: 'Audience: cardio floor regulars. Theme: consistency over intensity.',
  menu_item: 'Dish: smoked brisket sandwich with pickled red onion + horseradish aioli on brioche',
  promo: 'Today only — happy hour wine glasses are $8 from 4-6pm, charcuterie board half-off',
  daypart: 'Brunch menu drop — bottomless mimosas back this Sunday, new shakshuka',
  ticker: 'Hours: open 6am-10pm weekdays, 7am-11pm weekends. Wifi: VenueGuest. Welcome!',
};

interface AiOption { text: string; tag?: string }

export function AiGenerateButton({
  intent,
  onPick,
  buttonClassName,
  buttonLabel,
  defaultContext,
}: {
  intent: AiIntent;
  /** Called with the picked option's text. */
  onPick: (text: string) => void;
  /** Override the default sparkle-button styling. */
  buttonClassName?: string;
  /** Override the default "AI" / "AI Generate" label. */
  buttonLabel?: string;
  /** Pre-fill the modal's context box (e.g. existing field text). */
  defaultContext?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClassName ?? 'inline-flex items-center gap-1 text-[10px] font-bold text-violet-600 hover:text-violet-700 px-1.5 py-0.5 rounded hover:bg-violet-50 transition-colors'}
        title="Generate with AI (Claude)"
      >
        <Sparkles className="w-3 h-3" /> {buttonLabel ?? 'AI'}
      </button>
      {open && (
        <AiGenerateModal
          intent={intent}
          defaultContext={defaultContext}
          onClose={() => setOpen(false)}
          onPick={(text) => {
            onPick(text);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function AiGenerateModal({
  intent,
  defaultContext,
  onClose,
  onPick,
}: {
  intent: AiIntent;
  defaultContext?: string;
  onClose: () => void;
  onPick: (text: string) => void;
}) {
  const tenantCopy = useTenantCopy();
  const [context, setContext] = useState(defaultContext ?? '');
  const [tone, setTone] = useState<'energetic' | 'elegant' | 'playful' | 'serious' | 'casual'>('casual');
  const [running, setRunning] = useState(false);
  const [options, setOptions] = useState<AiOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Auto-trigger first generation when the modal opens with a non-empty
  // default context (e.g. operator already typed something and hit ✨).
  useEffect(() => {
    if (defaultContext && defaultContext.trim()) {
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    if (!context.trim()) {
      setError('Type some context for the AI — what is this about?');
      return;
    }
    setError(null);
    setRunning(true);
    setOptions([]);
    try {
      const res = await apiFetch<{ options: AiOption[] }>('/ai/generate', {
        method: 'POST',
        body: JSON.stringify({
          intent,
          context,
          tone,
          count: 3,
          vertical: tenantCopy.vertical,
        }),
      });
      setOptions(res.options || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex items-start justify-between sticky top-0 bg-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 capitalize">Generate {INTENT_LABELS[intent]} with AI</h2>
              <p className="text-xs text-slate-500 mt-0.5">Claude writes 3 options. Pick one, edit if needed.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4">
          {/* Context input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">What's this about?</label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={INTENT_PLACEHOLDERS[intent]}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Be specific — names, numbers, hours, the actual menu item. The more real detail you give, the better the copy.
            </p>
          </div>

          {/* Tone picker */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Tone</label>
            <div className="flex flex-wrap gap-1.5">
              {(['casual', 'energetic', 'elegant', 'playful', 'serious'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTone(t)}
                  className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
                    tone === t
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={run}
            disabled={running || !context.trim()}
            className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:from-violet-700 hover:to-fuchsia-700 transition-all"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {running ? 'Generating…' : options.length > 0 ? 'Regenerate' : 'Generate 3 options'}
          </button>

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {/* Options */}
          {options.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-700 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5" /> Pick one — click to use
              </h3>
              {options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onPick(opt.text)}
                  className="w-full text-left rounded-lg border-2 border-slate-200 hover:border-violet-400 hover:bg-violet-50/40 p-3 text-sm text-slate-800 transition-all"
                >
                  <div className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-[11px] font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span className="flex-1 leading-relaxed">{opt.text}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <p className="text-[10px] text-slate-400 text-center pt-2">
            Powered by Claude · 30 generations/hour/tenant · cap raises with paid tiers
          </p>
        </div>
      </div>
    </div>
  );
}
