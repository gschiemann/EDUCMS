"use client";

/**
 * AiImageGenerateButton — "Generate with AI" image button + modal for the
 * asset library (2026-06-26). The #1 competitive gap vs Appspace: type a
 * prompt, get a custom on-brand image saved straight into the library —
 * no stock photo hunt.
 *
 * Backend: POST /api/v1/ai/image (apps/api/src/ai/ai.service.ts
 * generateImage). OpenAI gpt-image-1 / dall-e-3 OR Google Imagen; brand-
 * aware (the server weaves the venue name + palette + brand voice into the
 * prompt). The decoded PNG is persisted as a normal Asset.
 *
 * Gating — mirrors the sparkle button's getAiStatusSource() contract:
 *   - source 'none' (no key anywhere)  → render NOTHING. (No image affordance
 *     at all when AI isn't configured, per spec "HIDE when no provider".)
 *   - source 'platform'/'tenant'       → render the button. The platform
 *     fallback is Anthropic (no images) and a tenant MAY be on Anthropic,
 *     so on click the server may return AI_IMAGE_UNAVAILABLE — the modal
 *     surfaces that gracefully with a "switch to OpenAI/Google" CTA, never
 *     a stack trace.
 */

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Sparkles, Loader2, X, AlertCircle, ImagePlus, Settings2 } from 'lucide-react';
import { getAiStatusSource } from './AiGenerateButton';
import { useGenerateImage } from '@/hooks/use-api';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import type { Vertical } from '@cms/api-types';

type Orientation = 'square' | 'landscape' | 'portrait';
const SIZE_FOR: Record<Orientation, '1024x1024' | '1792x1024' | '1024x1792'> = {
  square: '1024x1024',
  landscape: '1792x1024',
  portrait: '1024x1792',
};

/**
 * Per-vertical prompt placeholder for the "Generate an image with AI" modal.
 * The original copy ("a welcoming back-to-school banner…") was K-12-only and
 * read wrong on Sports / QSR / Retail / etc. tenants. Each vertical now gets a
 * relevant example; unknown verticals fall back to GENERIC_IMAGE_PLACEHOLDER.
 * Keyed by the canonical Vertical union from packages/api-types/verticals.ts.
 */
const GENERIC_IMAGE_PLACEHOLDER =
  'A clean, modern hero background with soft lighting and your brand colors — friendly, bright, and uncluttered';

const IMAGE_PLACEHOLDER_BY_VERTICAL: Record<Vertical, string> = {
  K12: 'A welcoming back-to-school banner with bright confetti, soft sunrise colors, friendly and clean',
  GYM: 'A high-energy fitness banner — motion-blurred athlete mid-workout, bold lighting, motivating and modern',
  RETAIL: 'A bright storefront promo background for a seasonal sale — clean product styling, airy and inviting',
  CORPORATE: 'A polished corporate lobby backdrop — abstract geometric shapes, calm professional palette',
  QSR: 'A mouth-watering menu hero shot — a fresh signature burger and crisp fries on a clean studio background',
  FASHION: 'An editorial boutique lookbook backdrop — soft draped fabric, runway lighting, elegant and minimal',
  BAR: 'A moody happy-hour banner — a craft cocktail with citrus and steam, warm neon glow, inviting nightlife vibe',
  HEALTHCARE: 'A calm, reassuring waiting-room background — soft greens and blues, clean lines, friendly and safe',
  HOSPITALITY: 'An elegant hotel lobby welcome backdrop — warm ambient lighting, plush textures, refined and inviting',
  RESTAURANT: 'An appetizing plated-dish hero — a beautifully arranged entrée with garnish, warm restaurant lighting',
  SPORTS: 'A dynamic game-day banner background — stadium lights, dramatic motion, bold team-color energy',
  WORSHIP: 'A serene, uplifting service backdrop — soft golden light through stained glass, peaceful and warm',
};

function imagePlaceholderForVertical(v: Vertical): string {
  return IMAGE_PLACEHOLDER_BY_VERTICAL[v] ?? GENERIC_IMAGE_PLACEHOLDER;
}

export function AiImageGenerateButton({
  onGenerated,
  disabled,
  renderAs = 'button',
  onOpen,
}: {
  /** Called with the created asset after a successful generation. */
  onGenerated?: (asset: { id: string; fileUrl: string; name: string; status: string }) => void;
  /** External disable (e.g. RESTRICTED_VIEWER). */
  disabled?: boolean;
  /**
   * 'menuitem' renders the trigger as a row inside an existing `role="menu"`
   * (the Media Library's "Add asset" menu, handoff §5) instead of a
   * standalone toolbar button. The self-gating contract is identical: with
   * no AI provider configured this component still renders NOTHING, so the
   * menu never shows an option that can't work.
   */
  renderAs?: 'button' | 'menuitem';
  /** Fired when the trigger opens the modal — lets a parent menu close. */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // null = loading (render nothing to avoid a flash); 'none' = no AI
  // configured (render nothing — no image affordance); otherwise show it.
  const [aiSource, setAiSource] = useState<'platform' | 'tenant' | 'none' | null>(null);
  useEffect(() => {
    let alive = true;
    void getAiStatusSource().then((s) => { if (alive) setAiSource(s); });
    return () => { alive = false; };
  }, []);

  // Loading or no AI at all → render nothing (HIDE the affordance).
  if (aiSource === null || aiSource === 'none') return null;

  return (
    <>
      {renderAs === 'menuitem' ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => { onOpen?.(); setOpen(true); }}
          disabled={disabled}
          title={disabled ? 'Read-only — viewer role' : 'Generate a custom image with AI'}
          className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:bg-slate-100"
          data-testid="ai-image-generate-button"
        >
          <Sparkles className="w-3.5 h-3.5 text-violet-500" /> Generate image with AI
        </button>
      ) : (
      <button
        type="button"
        onClick={() => { onOpen?.(); setOpen(true); }}
        disabled={disabled}
        title={disabled ? 'Read-only — viewer role' : 'Generate a custom image with AI'}
        className="min-h-11 sm:min-h-0 px-3 py-2 bg-white border border-violet-200 hover:border-violet-400 text-violet-700 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="ai-image-generate-button"
      >
        <Sparkles className="w-3.5 h-3.5 text-violet-500" /> Generate with AI
      </button>
      )}
      {open && (
        <AiImageModal
          onClose={() => setOpen(false)}
          onGenerated={(asset) => {
            onGenerated?.(asset);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function AiImageModal({
  onClose,
  onGenerated,
}: {
  onClose: () => void;
  onGenerated: (asset: { id: string; fileUrl: string; name: string; status: string }) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [orientation, setOrientation] = useState<Orientation>('square');
  const [error, setError] = useState<string | null>(null);
  const [needsImageProvider, setNeedsImageProvider] = useState(false);
  const generate = useGenerateImage();

  // Vertical-aware prompt example — Sports tenants get a game-day banner,
  // QSR a menu hero, etc., instead of the K-12 "back-to-school" default.
  const { vertical } = useTenantCopy();
  const promptPlaceholder = imagePlaceholderForVertical(vertical);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const titleId = 'ai-image-modal-title';

  // Resolve the tenant-scoped settings link (same pattern as the sparkle
  // button) so the "switch provider" CTA lands on the real BYOK card.
  const routeParams = useParams<{ schoolId?: string | string[] }>();
  const schoolId = Array.isArray(routeParams?.schoolId) ? routeParams.schoolId[0] : routeParams?.schoolId;
  const aiSettingsHref = schoolId ? `/${schoolId}/settings/ai` : '/settings/ai';

  useEffect(() => {
    const previouslyFocused = (typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null) : null);
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      // Tab-trap inside the dialog (ARIA APG).
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !dialogRef.current.contains(active)) { e.preventDefault(); last.focus(); }
        } else if (active === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const run = async () => {
    if (!prompt.trim()) {
      setError('Describe the image you want — what should it show?');
      return;
    }
    setError(null);
    setNeedsImageProvider(false);
    try {
      const asset = await generate.mutateAsync({ prompt: prompt.trim(), size: SIZE_FOR[orientation] });
      onGenerated(asset);
    } catch (e: any) {
      const code = String(e?.code || '');
      const status = Number(e?.status || 0);
      const msg = String(e?.message || e || '');
      if (code === 'AI_IMAGE_UNAVAILABLE') {
        // Graceful: provider can't do images (Anthropic / platform key).
        // Show the friendly "add an OpenAI or Google key" message + CTA.
        setNeedsImageProvider(true);
        setError(null);
      } else if (code === 'AI_PROVIDER_OUT_OF_CREDIT') {
        setError(e?.body?.message || msg || 'Your AI provider is out of credit. Add credits and try again.');
      } else if (code === 'AI_IMAGE_CAP_REACHED' || (status === 429 && /image cap/i.test(msg))) {
        setError('You’ve hit the hourly AI image limit. Try again in a bit.');
      } else if (code === 'AI_CAP_REACHED' || status === 402) {
        setError('You’ve used your free AI for this month. Connect your own provider key in Settings → AI provider for unlimited.');
      } else if (/not configured/i.test(msg)) {
        setError('AI is not configured. Ask your admin to add a provider key in Settings → AI provider.');
      } else if (/rejected|re-enter/i.test(msg)) {
        setError(msg);
      } else {
        setError(msg || 'Image generation failed. Try rephrasing your prompt.');
      }
    }
  };

  const running = generate.isPending;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-100 flex items-start justify-between sticky top-0 bg-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white">
              <ImagePlus className="w-6 h-6" />
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-slate-800">Generate an image with AI</h2>
              <p className="text-xs text-slate-500 mt-0.5">Describe it — we’ll create a custom, on-brand image and save it to your library.</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4">
          {needsImageProvider ? (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-center">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 mx-auto flex items-center justify-center text-white mb-3">
                <Settings2 className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Image generation needs OpenAI or Google</h3>
              <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed mb-4">
                Your current AI provider can write copy but doesn’t create images. Add an OpenAI or Google
                key in Settings → AI provider, then come back and generate.
              </p>
              <a
                href={aiSettingsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-bold hover:from-violet-700 hover:to-fuchsia-700"
              >
                Open AI settings
              </a>
            </div>
          ) : (
            <>
              {/* Prompt */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">What should the image show?</label>
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={promptPlaceholder}
                  rows={3}
                  maxLength={1000}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Be specific about subject, mood, and colors. We automatically weave in your brand name and palette.
                </p>
              </div>

              {/* Orientation */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Orientation</label>
                <div className="flex flex-wrap gap-1.5">
                  {(['square', 'landscape', 'portrait'] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOrientation(o)}
                      className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
                        orientation === o ? 'bg-violet-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              {/* Generate */}
              <button
                onClick={run}
                disabled={running || !prompt.trim()}
                className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:from-violet-700 hover:to-fuchsia-700 transition-all"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {running ? 'Generating image…' : 'Generate image'}
              </button>

              {running && (
                <p className="text-[10px] text-slate-400 text-center">
                  This takes a few seconds — the AI is rendering your image.
                </p>
              )}

              {error && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
                </div>
              )}

              <p className="text-[10px] text-slate-400 text-center pt-1">
                Powered by OpenAI / Google · saved to your media library
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
