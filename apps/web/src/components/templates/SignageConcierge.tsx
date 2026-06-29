'use client';

// ─────────────────────────────────────────────────────────────────────────
// SignageConcierge — the conversational AI intake (DEFAULT) for the
// "Generate a template" flow. Replaces the fixed-question wizard as the
// first thing the operator sees; the wizard stays one click away as a
// guided-form fallback (templates/page.tsx owns the toggle).
//
// The operator chats with a signage-savvy AI that asks the right next
// question, accepts reference URLs + image uploads for the look they want,
// and — when ready — hands EVERYTHING it gathered to the EXISTING
// 3-candidate generator via onGenerate({ prompt, intake }). This component
// only drives the conversation + reference gathering; the page owns generate
// / pick / refine, so nothing in that pipeline changes.
//
// Request/response only — NO timers, NO polling. Safe on the operator's
// iPhone: the panel is responsive down to ~380px, the transcript scrolls,
// and the composer is pinned at the bottom. (Mobile-perf: this is transient
// overlay content inside the AI modal — no always-mounted backdrop-blur.)
// ─────────────────────────────────────────────────────────────────────────

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  Send,
  Globe,
  ImagePlus,
  X,
  Link as LinkIcon,
  Image as ImageIcon,
  Wand2,
  AlertCircle,
} from 'lucide-react';
import type { ConciergeReference, ConciergeMessage, ConciergeIntake } from '@cms/api-types';
import {
  useConciergeChat,
  useConciergeUrlReference,
  useConciergeImageReference,
} from '@/hooks/use-api';

// ── friendly error mapping ──────────────────────────────────────────────
// Mirrors friendlyAiError() in templates/page.tsx so chat speaks the same
// language as the rest of the AI modal. Replicated (not imported) because
// the page keeps it module-private; if that ever gets exported, swap to it.
interface ApiError {
  code?: string;
  status?: number;
  message?: string;
  body?: { message?: string };
}
function friendlyConciergeError(err: unknown): string {
  const e = (err ?? {}) as ApiError;
  const code = String(e.code || '');
  const status = Number(e.status || 0);
  const msg = e.message || '';
  const raw = msg.toLowerCase();
  const bodyMsg = e.body?.message;
  if (code === 'CONCIERGE_SCRAPE_FAILED') {
    return bodyMsg || msg || "Couldn't read that website. Check the URL, or just tell me about the look instead.";
  }
  if (code === 'CONCIERGE_VISION_UNAVAILABLE') {
    return bodyMsg || msg || "Couldn't read that image right now. Try another, or describe the look in words.";
  }
  if (code === 'AI_PROVIDER_OUT_OF_CREDIT') {
    return bodyMsg || msg || 'Your AI provider is out of credit. Add credits with your provider and try again.';
  }
  if (code === 'AI_CAP_REACHED' || status === 402) {
    return 'Monthly free AI quota used up. Add your own provider key in Settings → AI provider, or wait until next month.';
  }
  if (code === 'AI_FAILURE_CAP_REACHED') {
    return 'Too many failed AI requests in the last hour. Wait an hour, or contact support if you think this is wrong.';
  }
  if (raw.includes('not configured')) {
    return "AI isn't enabled for this site. Ask your administrator to add an API key in Settings → AI provider.";
  }
  if (status === 429 || raw.includes('hourly') || raw.includes('rate-limit')) {
    return "You've hit this hour's AI limit. Try again in a few minutes.";
  }
  if (raw.includes('unreachable')) return 'Could not reach the AI service. Check your connection or retry.';
  if (status === 503 && msg) return msg;
  return 'Something went wrong. Try again in a moment.';
}

const GREETING =
  "Hi! Tell me what screen you're making — like \"happy-hour board for my bar\" or \"welcome wall for our clinic lobby\" — and I'll design it with you. Got a website or a photo of a look you like? Share it and I'll match your style.";

// Human labels for the "What I've gathered" chips.
const PURPOSE_LABEL: Record<string, string> = {
  welcome: 'Welcome',
  menu: 'Menu / pricing',
  promo: 'Promo / sale',
  event: 'Event countdown',
  announcement: 'Announcement',
  feature: 'Feature / split',
  'photo-hero': 'Photo hero',
};
const BACKGROUND_LABEL: Record<string, string> = {
  solid: 'Solid bg',
  gradient: 'Gradient bg',
  textured: 'Textured bg',
  photo: 'AI photo bg',
};

export interface SignageConciergeProps {
  /** Tenant vertical (lowercased) — steers the model's signage advice. */
  vertical: string;
  /** The board canvas the page picked (real screen aspect). */
  canvas: { w: number; h: number };
  /** Touch (interactive) vs passive display — passed through to generate. */
  interactive: boolean;
  /** Hand the gathered intake to the EXISTING 3-candidate generator. */
  onGenerate: (args: { prompt: string; intake: ConciergeIntake; references: ConciergeReference[] }) => void;
  /** True while the page's generate request is in flight. */
  generating: boolean;
  /** Error from the page's GENERATE step (e.g. hourly AI cap, provider error) —
   *  surfaced here so a failed "Generate 3 boards" never looks like it did
   *  nothing. Set by the parent's generate handler; null/undefined = no error. */
  generateError?: string | null;
  /** The Touch / Display / Build-a-set toggle (owned by the page). */
  typeToggle?: React.ReactNode;
  /** The canvas / "Match a screen" picker (owned by the page). */
  screenPicker?: React.ReactNode;
}

type ChipKind = ConciergeReference['kind'];

export function SignageConcierge(props: SignageConciergeProps) {
  const { canvas, interactive, vertical, onGenerate, generating, generateError, typeToggle, screenPicker } = props;

  // Display transcript. The leading assistant greeting is display-only and
  // is NOT sent in the FIRST chat call (the contract prefers a leading USER
  // turn). After the first exchange the greeting rides along as context.
  const [messages, setMessages] = useState<ConciergeMessage[]>([
    { role: 'assistant', content: GREETING },
  ]);
  const [references, setReferences] = useState<ConciergeReference[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Latest structured state from the last turn.
  const [intake, setIntake] = useState<ConciergeIntake>({});
  const [brief, setBrief] = useState('');
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  // Reference-adding sub-UI.
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [refError, setRefError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const chat = useConciergeChat();
  const urlRef = useConciergeUrlReference();
  const imageRef = useConciergeImageReference();

  const busy = chat.isPending;

  // Auto-scroll the transcript to the newest message.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  // The last user message text — the fallback "prompt" when no brief yet.
  const lastUserText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content;
    }
    return '';
  }, [messages]);

  const hasUserTurn = useMemo(() => messages.some((m) => m.role === 'user'), [messages]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;
      setError(null);
      const nextMessages: ConciergeMessage[] = [...messages, { role: 'user', content }];
      setMessages(nextMessages);
      setInput('');
      // Send the FULL transcript so the model keeps context. If the leading
      // element is the display-only assistant greeting, drop it so the array
      // begins on a user turn (the contract's preference).
      const wire =
        nextMessages.length > 0 && nextMessages[0].role === 'assistant'
          ? nextMessages.slice(1)
          : nextMessages;
      try {
        const turn = await chat.mutateAsync({
          messages: wire,
          references: references.length ? references : undefined,
          vertical,
          screenWidth: canvas.w,
          screenHeight: canvas.h,
        });
        setMessages((prev) => [...prev, { role: 'assistant', content: turn.reply }]);
        setIntake(turn.intake || {});
        setBrief(turn.brief || '');
        setReady(!!turn.ready);
        setMissing(Array.isArray(turn.missing) ? turn.missing : []);
      } catch (e) {
        setError(friendlyConciergeError(e));
      }
    },
    [busy, messages, references, vertical, canvas.w, canvas.h, chat],
  );

  const addUrl = useCallback(async () => {
    const url = urlValue.trim();
    if (!url || urlRef.isPending) return;
    setRefError(null);
    try {
      const ref = await urlRef.mutateAsync({ url });
      setReferences((prev) => [...prev, ref]);
      setUrlValue('');
      setUrlOpen(false);
    } catch (e) {
      setRefError(friendlyConciergeError(e));
    }
  }, [urlValue, urlRef]);

  const addImage = useCallback(
    async (file: File) => {
      setRefError(null);
      try {
        const ref = await imageRef.mutateAsync(file);
        setReferences((prev) => [...prev, ref]);
      } catch (e) {
        setRefError(friendlyConciergeError(e));
      }
    },
    [imageRef],
  );

  const removeReference = useCallback((idx: number) => {
    setReferences((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleGenerate = useCallback(() => {
    if (generating) return;
    const prompt = (brief || lastUserText).trim();
    if (!prompt) {
      setError('Tell me a bit about the screen first, then I can generate it.');
      return;
    }
    // Pass the gathered references (scraped site + uploaded images) so the
    // page can feed the designer agent the real brand palette + business-type +
    // logo — the difference between an on-brand pizza board and a generic one.
    onGenerate({ prompt, intake, references });
  }, [generating, brief, lastUserText, intake, references, onGenerate]);

  // ── "What I've gathered" chips ─────────────────────────────────────────
  const intakeChips = useMemo(() => {
    const out: Array<{ key: string; label: string }> = [];
    if (intake.purpose) out.push({ key: 'purpose', label: PURPOSE_LABEL[intake.purpose] || intake.purpose });
    if (intake.theme) out.push({ key: 'theme', label: `Theme: ${intake.theme}` });
    if (intake.palette) {
      out.push({
        key: 'palette',
        label: intake.palette === 'brand' ? 'Brand colors' : `${intake.palette.colors.length}-color palette`,
      });
    }
    if (intake.background) out.push({ key: 'background', label: BACKGROUND_LABEL[intake.background] || intake.background });
    if (intake.widgets && intake.widgets.length) {
      out.push({ key: 'widgets', label: `${intake.widgets.length} element${intake.widgets.length === 1 ? '' : 's'}` });
    }
    return out;
  }, [intake]);

  const hasGathered = intakeChips.length > 0 || references.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Transcript ── */}
      <div
        ref={scrollRef}
        className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 overflow-y-auto flex flex-col gap-2.5"
        style={{ minHeight: 220, maxHeight: '42vh' }}
        aria-live="polite"
      >
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-violet-600 text-white rounded-br-sm'
                  : 'bg-white border border-slate-200 text-slate-700 rounded-bl-sm'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-white border border-slate-200 px-3.5 py-2 text-sm text-slate-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
            </div>
          </div>
        )}
      </div>

      {/* ── Errors ── */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2"
        >
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Reference adders + chips ── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setUrlOpen((v) => !v); setRefError(null); }}
            disabled={urlRef.isPending}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-full bg-white border border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-700 disabled:opacity-50"
          >
            <Globe className="w-3.5 h-3.5" /> Add a website
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={imageRef.isPending}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-full bg-white border border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-700 disabled:opacity-50"
          >
            {imageRef.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
            Upload a look
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void addImage(f);
              // reset so re-picking the same file fires onChange again
              e.target.value = '';
            }}
          />
        </div>

        {urlOpen && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <LinkIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                // The URL field only mounts on an explicit "Add a website" tap —
                // focusing it then is the expected behavior, not a surprise.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                type="url"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addUrl(); } }}
                placeholder="https://your-business.com"
                disabled={urlRef.isPending}
                className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-60"
              />
            </div>
            <button
              type="button"
              onClick={() => void addUrl()}
              disabled={urlRef.isPending || !urlValue.trim()}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-600 text-white disabled:opacity-50 flex items-center gap-1"
            >
              {urlRef.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add'}
            </button>
          </div>
        )}

        {refError && (
          <div role="alert" className="text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-1.5">
            {refError}
          </div>
        )}
      </div>

      {/* ── "What I've gathered" strip ── */}
      {hasGathered && (
        <div className="rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-violet-500 mb-1.5">What I&apos;ve gathered</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {intakeChips.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-violet-200 text-[11px] font-semibold text-violet-700">
                {c.label}
              </span>
            ))}
            {references.map((r, i) => (
              <span
                key={`ref-${i}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-violet-200 text-[11px] font-semibold text-violet-700"
                title={r.summary}
              >
                <ReferenceIcon kind={r.kind} />
                <span className="max-w-[120px] truncate">{r.label || (r.kind === 'url' ? 'Website' : 'Image')}</span>
                {r.palette && r.palette.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 ml-0.5">
                    {r.palette.slice(0, 4).map((hex, j) => (
                      <span
                        key={j}
                        className="w-2.5 h-2.5 rounded-full border border-white shadow-sm"
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeReference(i)}
                  className="ml-0.5 text-violet-400 hover:text-rose-600"
                  aria-label="Remove reference"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Composer (pinned at the bottom of the flow) ── */}
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Type your reply… (e.g. “happy-hour board for my bar”)"
          disabled={busy}
          className="flex-1 resize-none rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void send(input)}
          disabled={busy || !input.trim()}
          className="shrink-0 h-10 w-10 flex items-center justify-center rounded-xl bg-violet-600 text-white disabled:opacity-50"
          aria-label="Send"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>

      {/* ── Type toggle + screen picker (owned by the page) ── */}
      {(typeToggle || screenPicker) && (
        <div className="flex flex-col gap-2 pt-1 border-t border-slate-100">
          {typeToggle}
          {screenPicker}
        </div>
      )}

      {/* ── Generate error (e.g. hourly AI cap) — surfaced so a failed
            "Generate 3 boards" never looks like nothing happened. ── */}
      {generateError && (
        <div
          role="alert"
          className="flex items-start gap-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2"
        >
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{generateError}</span>
        </div>
      )}

      {/* ── Primary action ── */}
      <button
        type="button"
        onClick={handleGenerate}
        disabled={!hasUserTurn || generating}
        title={!hasUserTurn ? 'Tell me about the screen first' : undefined}
        className={`w-full px-4 py-3 text-sm font-bold rounded-xl text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-shadow ${
          ready
            ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 shadow-lg ring-2 ring-violet-300'
            : 'bg-gradient-to-r from-violet-500 to-fuchsia-500'
        }`}
      >
        {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
        {generating ? 'Generating…' : interactive ? 'Generate 3 touch boards' : 'Generate 3 boards'}
      </button>
      {!ready && hasUserTurn && missing.length > 0 && (
        <p className="text-[11px] text-slate-400 text-center -mt-1">
          Tip: keep chatting and I&apos;ll dial it in — or generate now and tweak after.
        </p>
      )}
    </div>
  );
}

function ReferenceIcon({ kind }: { kind: ChipKind }) {
  if (kind === 'url') return <Globe className="w-3 h-3" />;
  return <ImageIcon className="w-3 h-3" />;
}
