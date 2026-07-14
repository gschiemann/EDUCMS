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
 * Cost-capped at 30 calls/hour/tenant, 300 max_tokens, on the catalog's
 * Standard-tier Claude Haiku 4.5 (see ai-providers.ts; the raw hyphenated
 * id in a comment trips the gitleaks generic-api-key rule).
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

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Sparkles, Loader2, X, RefreshCw, AlertCircle, Zap, Settings2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useTenantCopy } from '@/hooks/use-tenant-copy';

// 2026-05-04 — usage snapshot returned by both /ai/key (status) and
// /ai/generate (live update post-call). source 'platform' means we
// pay; 'tenant' means BYOK admin set their own key (unlimited);
// 'none' means AI is not available at all.
interface AiUsage {
  source: 'platform' | 'tenant' | 'none';
  used: number;
  cap: number | null;
  resetAt: string | null;
}

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

// 2026-05-26 audit AI-P0-3 — module-level cache of the /ai/key status
// so the button can know upfront whether AI is configured, without
// every <AiGenerateButton> instance firing its own GET on mount
// (PropertiesPanel renders 4 of them — was 4 redundant calls). Cache
// is invalidated on auth events; the worst case (stale cache after an
// admin enables/disables AI in another tab) is a 60s window where the
// button is hidden/shown incorrectly — the next mount refreshes.
type AiStatusSource = 'platform' | 'tenant' | 'none';
let __aiStatusCache: { source: AiStatusSource; fetchedAt: number } | null = null;
let __aiStatusInflight: Promise<AiStatusSource> | null = null;
const AI_STATUS_TTL_MS = 60_000;
export async function getAiStatusSource(): Promise<AiStatusSource> {
  const now = Date.now();
  if (__aiStatusCache && now - __aiStatusCache.fetchedAt < AI_STATUS_TTL_MS) {
    return __aiStatusCache.source;
  }
  if (__aiStatusInflight) return __aiStatusInflight;
  __aiStatusInflight = (async () => {
    try {
      const r = await apiFetch<{ usage?: AiUsage }>('/ai/key');
      const src = (r?.usage?.source as AiStatusSource) || 'none';
      __aiStatusCache = { source: src, fetchedAt: Date.now() };
      return src;
    } catch {
      // 2026-05-29 audit §3 — reconcile the old FAIL-OPEN quirk. The
      // previous behavior returned 'platform' on a status-fetch error,
      // which rendered a fully-active generate button for a no-key
      // tenant → click → POST /ai/generate → 503. We now treat an
      // unreachable status endpoint as 'none', which renders the
      // unobtrusive "Set up AI" affordance (a LINK to /settings/ai —
      // it never calls generate, so it can never 503). The worst case
      // is a configured tenant briefly sees "Set up AI" during an
      // outage; clicking it lands on settings (where their key shows
      // configured) instead of throwing. Do NOT cache the error result
      // so the next mount re-checks promptly once the endpoint recovers.
      return 'none';
    } finally {
      __aiStatusInflight = null;
    }
  })();
  return __aiStatusInflight;
}

/**
 * Test-only: clear the module-level AI-status cache so each test starts
 * from a clean slate (the status is cached globally with a 60s TTL).
 * Mirrors the `__resetSessionLogoutFired` escape hatch in api-client.ts.
 * Never called in app code.
 */
export function __resetAiStatusCacheForTests() {
  __aiStatusCache = null;
  __aiStatusInflight = null;
}

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
  // 2026-05-26 audit AI-P0-3 + 2026-05-29 §3 discoverability.
  // Three render states driven by the cached /ai/key status:
  //   - null  (loading)          → render nothing yet (avoids a flash;
  //                                resolves within one round-trip)
  //   - 'none' (no key anywhere) → render an UNOBTRUSIVE "Set up AI"
  //                                affordance that LINKS to /settings/ai.
  //                                It never calls generate, so it can
  //                                never 503 — it just shows the
  //                                operator that AI EXISTS and how to
  //                                turn it on. Before this, the button
  //                                vanished entirely and operators
  //                                literally couldn't find the feature.
  //   - 'platform' | 'tenant'    → render the real sparkle generate
  //                                button (opens the modal).
  const [aiSource, setAiSource] = useState<AiStatusSource | null>(null);
  useEffect(() => {
    let alive = true;
    void getAiStatusSource().then((s) => { if (alive) setAiSource(s); });
    return () => { alive = false; };
  }, []);

  // Resolve the schoolId from the dynamic route so the "Set up AI" link
  // points at /[schoolId]/settings/ai (the real, tenant-scoped route),
  // not a bare /settings/ai which 404s — same fix pattern as the
  // streaming-picker links in PropertiesPanel. Falls back to the
  // unscoped path only if we're somehow rendered outside the route.
  const routeParams = useParams<{ schoolId?: string | string[] }>();
  const schoolId = Array.isArray(routeParams?.schoolId)
    ? routeParams.schoolId[0]
    : routeParams?.schoolId;
  const aiSettingsHref = schoolId ? `/${schoolId}/settings/ai` : '/settings/ai';

  // Loading — don't flash anything.
  if (aiSource === null) return null;

  // No AI configured — show the discoverable "Set up AI" link. It is a
  // real <a> (keyboard-focusable, opens settings in a new tab) styled
  // subtly so it doesn't compete with the operator's content fields.
  // Crucially it does NOT call /ai/generate, so no click→503.
  if (aiSource === 'none') {
    return (
      <a
        href={aiSettingsHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-violet-600 px-1.5 py-0.5 rounded hover:bg-violet-50 transition-colors"
        title="Add your AI provider key to generate copy with AI"
        data-testid="ai-setup-affordance"
      >
        <Settings2 className="w-3 h-3" /> Set up AI
      </a>
    );
  }

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
  // Live usage badge + cap-reached upgrade prompt. Initialized null
  // so we don't flash a stale "200/200" before the status fetch
  // completes.
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [capHit, setCapHit] = useState(false);

  // Resolve the tenant-scoped schoolId from the dynamic route so the
  // cap-reached overlay's "Open Settings" link lands on the REAL
  // /[schoolId]/settings/ai BYOK provider card (the whole point of the
  // cap prompt is "connect your own key"), not a bare /settings that
  // 404s. Same fix pattern as the "Set up AI" affordance in
  // AiGenerateButton above + the streaming-picker links in
  // PropertiesPanel.tsx. Falls back to the unscoped path only when
  // schoolId is absent.
  const routeParams = useParams<{ schoolId?: string | string[] }>();
  const schoolId = Array.isArray(routeParams?.schoolId)
    ? routeParams.schoolId[0]
    : routeParams?.schoolId;
  const aiSettingsHref = schoolId ? `/${schoolId}/settings/ai` : '/settings/ai';

  // ai-imports-006 fix: a11y + focus management.
  //  - role="dialog" + aria-modal="true" + aria-labelledby tells screen
  //    readers this is a modal and points at its title.
  //  - Auto-focus the textarea on open so keyboard users land in the
  //    primary input instead of having to tab in.
  //  - Restore focus to the previously-focused element on close so the
  //    user's keyboard place isn't lost.
  //  - Trap Tab / Shift+Tab inside the modal's focusable elements so
  //    focus can't leak to background page content while the modal is
  //    open (per ARIA APG dialog pattern).
  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const titleId = 'ai-generate-modal-title';

  useEffect(() => {
    const previouslyFocused = (typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null);
    // Auto-focus the textarea when the modal mounts.
    textareaRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Tab-trap. Find every focusable element inside the dialog and
      // cycle Tab / Shift+Tab between first and last.
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !dialogRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      abortRef.current?.abort();
      // Restore focus to whatever opened the modal.
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  // Auto-trigger first generation when the modal opens with a non-empty
  // default context (e.g. operator already typed something and hit ✨).
  useEffect(() => {
    if (defaultContext && defaultContext.trim()) {
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch current usage snapshot when modal mounts so the badge ("X
  // of 200 free this month") renders before the first click. Falls
  // through silently on error — usage is decoration, never blocking.
  useEffect(() => {
    void apiFetch<{ usage?: AiUsage }>('/ai/key')
      .then((s) => { if (s?.usage) setUsage(s.usage); })
      .catch(() => { /* status endpoint unavailable, hide badge */ });
  }, []);

  const run = async () => {
    if (!context.trim()) {
      setError('Type some context for the AI — what is this about?');
      return;
    }
    setError(null);
    setRunning(true);
    setOptions([]);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      // CYCLE-5 ai-NaN-count fix — clamp count to a positive integer before
      // sending. If a future caller passes a non-numeric count via prop /
      // env / form input, the backend would receive NaN which serialized to
      // `Generate NaN options` in the prompt. Defensive clamp here so the
      // server-side `Math.min(Math.max(count ?? 3, 1), 5)` always sees a
      // finite number — NaN passes the ?? but breaks min/max.
      const rawCount = 3;
      const safeCount = Number.isFinite(rawCount) ? Math.max(1, Math.min(5, Math.trunc(rawCount))) : 3;
      const res = await apiFetch<{ options: AiOption[]; usage?: AiUsage }>('/ai/generate', {
        method: 'POST',
        body: JSON.stringify({
          intent,
          context,
          tone,
          count: safeCount,
          vertical: tenantCopy.vertical,
        }),
        signal: abortRef.current.signal,
      });
      setOptions(res.options || []);
      // Live usage update — server returns the post-bump count so
      // the badge advances without a second fetch.
      if (res.usage) setUsage(res.usage);
    } catch (e: any) {
      // Aborted requests are expected on unmount/regenerate — silent.
      if (e?.name === 'AbortError') return;
      const msg = String(e?.message || e || '');
      // 2026-05-25 (audit-W8) — was regex-matching the human error
      // message ("monthly free AI cap"). Server now stamps a
      // STRUCTURED `code` field on the error envelope; apiFetch
      // surfaces it as `e.code`. Branch on the code first; fall
      // back to message-pattern matching only for legacy paths
      // that don't yet emit a code.
      const code = String(e?.code || '');
      const status = Number(e?.status || 0);
      // 2026-05-26 audit AI-P0-1 — provider-side "out of credit" is
      // distinct from "I'm out of platform free credits" (AI_CAP_REACHED).
      // The server's mapProviderQuotaError() helper recognizes OpenAI
      // insufficient_quota / Anthropic credit_balance_too_low / Google
      // RESOURCE_EXHAUSTED and emits AI_PROVIDER_OUT_OF_CREDIT. The
      // message it ships already contains the right "go add money at
      // platform.openai.com / console.anthropic.com / etc." instructions
      // so we just display it. keySource tells us whether to point the
      // operator at THEIR provider (BYOK) or escalate to admin (platform).
      if (code === 'AI_PROVIDER_OUT_OF_CREDIT') {
        setError(e?.body?.message || msg || 'Your AI provider is out of credit. Add credits with your provider and try again.');
      } else if (code === 'AI_CAP_REACHED' || status === 402) {
        setCapHit(true);
        setError(null);
      } else if (code === 'AI_FAILURE_CAP_REACHED' || (status === 429 && /failed AI/i.test(msg))) {
        setError('Too many failed AI requests in the last hour. Wait an hour, or contact support if you think this is wrong.');
      } else if (/not configured/i.test(msg)) {
        // The ONLY true "no key on file" case — backend message is literally
        // "AI is not configured…". (Was `status === 503 || …`, which
        // mislabeled EVERY downstream 503 — bad key, empty/truncated model
        // reply, provider 4xx — as "not configured", hiding the real,
        // fixable error from the operator.)
        setError('AI is not configured for this deployment. Ask your admin to add a provider key in Settings → AI provider, then try again.');
      } else if (/rejected|re-enter/i.test(msg)) {
        setError(msg); // BYOK key invalid/expired — server message is actionable
      } else if (status === 429 || /hourly AI cap|rate.?limit/i.test(msg)) {
        setError('Hit the hourly AI cap for this tenant. Try again in a bit, or upgrade for a higher cap.');
      } else if (/empty response/i.test(msg)) {
        setError(msg); // model truncated — server message says how to fix
      } else if (status === 503 && msg) {
        // Any other backend 503: surface the server's own (operator-friendly)
        // message rather than a misleading generic.
        setError(msg);
      } else {
        setError(msg || 'AI request failed. Try rephrasing your context.');
      }
    } finally {
      setRunning(false);
    }
  };

  /** Format the usage badge: "187 of 200 free generations this month". */
  const usageBadgeText = () => {
    if (!usage) return null;
    if (usage.source === 'tenant') return 'Unlimited (your provider)';
    if (usage.source === 'none') return null;
    if (usage.cap == null) return null;
    const remaining = Math.max(0, usage.cap - usage.used);
    return `${remaining} of ${usage.cap} free generations left this month`;
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
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
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-slate-800 capitalize">Generate {INTENT_LABELS[intent]} with AI</h2>
              <p className="text-xs text-slate-500 mt-0.5">Claude writes 3 options. Pick one, edit if needed.</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4">
          {/* Context input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">What's this about?</label>
            <textarea
              ref={textareaRef}
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
            {usageBadgeText() || 'Powered by Claude · cap raises with paid tiers'}
          </p>
        </div>

        {/*
          Cap-reached overlay. Replaces the form area with a friendly
          upgrade prompt. The "Connect provider key" link drops the
          operator on Settings → Brand kit + AI provider; the BYOK
          card there walks them through the Anthropic / OpenAI key
          paste flow. RESTRICTED_VIEWER + CONTRIBUTOR can't reach
          that page so they see only the wait-message.
        */}
        {capHit && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white mb-4">
              <Zap className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              You've used your free AI for this month
            </h3>
            <p className="text-sm text-slate-600 max-w-md leading-relaxed mb-5">
              Your tenant has hit the {usage?.cap ?? 200}-generation monthly cap.
              {usage?.resetAt
                ? ` Resets ${new Date(usage.resetAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`
                : ''}
              {' '}Connect your own Anthropic or OpenAI key in Settings to continue without limits.
            </p>
            <div className="flex gap-2">
              <a
                href={aiSettingsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-bold hover:from-violet-700 hover:to-fuchsia-700"
              >
                Open Settings
              </a>
              <button
                onClick={onClose}
                type="button"
                className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
