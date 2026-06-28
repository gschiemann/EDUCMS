'use client';

// ─────────────────────────────────────────────────────────────────────────
// AiIntakeWizard — the guided question wizard (default) + advanced one-screen
// view for the AI "Generate a template" flow.
//
// Greg (2026-06-28): "Both — wizard + advanced." Default = a step-by-step
// 6-question wizard for non-IT operators; an "I know what I want → advanced"
// link swaps to a single-screen chips+prompt view. After intake the parent runs
// the EXISTING 3-candidate pick + chat-to-edit flow unchanged.
//
// This component is PURE UI + state plumbing. It does NOT call the API — it
// raises onGenerate() and the parent (templates/page.tsx) builds the request
// body from these answers via buildIntakeRequestFields() and calls the existing
// useGenerateTouchCandidates mutation. That keeps build-a-set, pick, and
// chat-to-edit owned by the page.
//
// Mobile: this lives inside the AI modal (already a sheet on phones), so it's
// fine to be rich — but it stays light (no always-mounted backdrop-blur on
// persistent chrome; this is transient overlay content).
// ─────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import {
  Sparkles,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Check,
  // purpose icons
  Hand,
  ListOrdered,
  Tag,
  CalendarClock,
  Megaphone,
  Columns2,
  Image as ImageIcon,
  // widget icons
  Type,
  Text as TextIcon,
  BadgeCheck,
  Clock,
  Calendar,
  CloudSun,
  Timer,
  AlignJustify,
  QrCode,
  MousePointerClick,
  Wand2,
} from 'lucide-react';
import {
  type AiIntakeAnswers,
  type IntakePurpose,
  type IntakeThemeKey,
  type IntakeWidgetKey,
  type IntakeBackground,
  type IntakePaletteMode,
  PURPOSE_OPTIONS,
  THEME_OPTIONS,
  BACKGROUND_OPTIONS,
  WIDGET_OPTIONS,
  PALETTE_PRESETS,
  DEFAULT_WIDGETS_BY_PURPOSE,
} from './ai-intake-contract';

// lucide icon name → component. Keeps ai-intake-contract.ts dependency-free
// (strings there) while rendering real icons here.
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Hand,
  ListOrdered,
  Tag,
  CalendarClock,
  Megaphone,
  Columns2,
  Image: ImageIcon,
  Type,
  Text: TextIcon,
  BadgeCheck,
  Clock,
  Calendar,
  CloudSun,
  Timer,
  AlignJustify,
  QrCode,
  MousePointerClick,
};

export interface AiIntakeWizardProps {
  /** Current answers (controlled by the parent). */
  answers: AiIntakeAnswers;
  onChange: (next: AiIntakeAnswers) => void;
  /** The headline / "what should it say" text — same value as the page prompt. */
  promptText: string;
  onPromptChange: (next: string) => void;
  /** Vertical-aware example chips for the prompt line (parent passes them). */
  exampleChips?: ReadonlyArray<string>;
  /**
   * Question 6 (Screen) reuses the EXISTING canvas / "Match a screen" picker
   * already in templates/page.tsx — the parent passes it in so we don't rebuild
   * it. Also used inside the advanced view.
   */
  screenPicker: React.ReactNode;
  /**
   * The Touch / Display / Build-a-set toggle (also owned by the parent). Shown
   * on the first question + in advanced view.
   */
  typeToggle: React.ReactNode;
  /** Fires when the operator hits Generate. Parent builds the body + calls AI. */
  onGenerate: () => void;
  /** Cancel / close the modal. */
  onCancel: () => void;
  isPending: boolean;
  /** Inline error (rate-limit / no-AI / empty prompt), rendered by the parent
   *  in the candidate phase; here we show it above the action row. */
  error?: string | null;
  /** Set-mode changes the action-button copy ("Build the set" vs "Generate 3"). */
  setMode: boolean;
}

const TOTAL_STEPS = 6;

export function AiIntakeWizard(props: AiIntakeWizardProps) {
  const {
    answers,
    onChange,
    promptText,
    onPromptChange,
    exampleChips,
    screenPicker,
    typeToggle,
    onGenerate,
    onCancel,
    isPending,
    error,
    setMode,
  } = props;

  // 'wizard' (default, step-by-step) or 'advanced' (everything on one screen).
  const [mode, setMode_] = useState<'wizard' | 'advanced'>('wizard');
  const [step, setStep] = useState(0); // 0..5

  // ── helpers to patch one answer field ──
  const patch = (p: Partial<AiIntakeAnswers>) => onChange({ ...answers, ...p });

  const setPurpose = (purpose: IntakePurpose) => {
    // When a real purpose is chosen, pre-check its sensible default content set
    // — but only if the operator hasn't already curated their own (so we never
    // stomp a manual choice). This keeps the "What's on it?" step at zero clicks
    // on the happy path.
    if (purpose !== 'auto' && answers.widgets.length === 0) {
      patch({ purpose, widgets: [...DEFAULT_WIDGETS_BY_PURPOSE[purpose]] });
    } else {
      patch({ purpose });
    }
  };

  const toggleWidget = (key: IntakeWidgetKey) => {
    const has = answers.widgets.includes(key);
    patch({
      widgets: has ? answers.widgets.filter((w) => w !== key) : [...answers.widgets, key],
    });
  };

  const generateLabel = useMemo(() => {
    if (isPending) return setMode ? 'Building set…' : 'Generating…';
    return setMode ? 'Build the set' : 'Generate 3 options';
  }, [isPending, setMode]);

  // ───────────────────────────────────────────────────────────────────────
  // SHARED field renderers (used by BOTH wizard steps AND advanced view).
  // ───────────────────────────────────────────────────────────────────────

  const PurposeGrid = (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {PURPOSE_OPTIONS.map((o) => {
        const Icon = ICONS[o.icon] || Sparkles;
        const active = answers.purpose === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => setPurpose(o.key)}
            disabled={isPending}
            className={`flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-colors disabled:opacity-50 ${
              active
                ? 'border-violet-500 bg-violet-50'
                : 'border-slate-200 bg-white hover:border-violet-300'
            }`}
          >
            <Icon className={`w-5 h-5 ${active ? 'text-violet-600' : 'text-slate-400'}`} />
            <span className="text-xs font-bold text-slate-800">{o.label}</span>
            <span className="text-[10px] text-slate-500 leading-tight">{o.hint}</span>
          </button>
        );
      })}
    </div>
  );

  const ThemeChips = (
    <div className="flex flex-wrap gap-2">
      {THEME_OPTIONS.map((t) => {
        const active = answers.theme === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => patch({ theme: t.key as IntakeThemeKey })}
            disabled={isPending}
            className={`flex items-center gap-2 rounded-full border-2 pl-1.5 pr-3 py-1 text-xs font-bold transition-colors disabled:opacity-50 ${
              active
                ? 'border-violet-500 bg-violet-50 text-violet-700'
                : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300'
            }`}
          >
            <span className="flex -space-x-1" aria-hidden>
              <span className="w-4 h-4 rounded-full border border-white" style={{ background: t.swatch[0] }} />
              <span className="w-4 h-4 rounded-full border border-white" style={{ background: t.swatch[1] }} />
            </span>
            {t.key}
          </button>
        );
      })}
    </div>
  );

  const PaletteRow = (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {([
          { key: 'brand', label: 'Use my brand colors' },
          { key: 'custom', label: 'Pick a palette' },
          { key: 'auto', label: 'Let AI choose' },
        ] as Array<{ key: IntakePaletteMode; label: string }>).map((o) => {
          const active = answers.paletteMode === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => patch({ paletteMode: o.key })}
              disabled={isPending}
              className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
                active
                  ? 'border-violet-500 bg-violet-50 text-violet-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {answers.paletteMode === 'custom' && (
        <div className="flex flex-wrap gap-2 pt-0.5">
          {PALETTE_PRESETS.map((p) => {
            const active =
              answers.paletteColors.length === p.colors.length &&
              answers.paletteColors.every((c, i) => c === p.colors[i]);
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => patch({ paletteColors: [...p.colors] })}
                disabled={isPending}
                title={p.label}
                aria-label={`${p.label} palette`}
                aria-pressed={active}
                className={`flex items-center gap-1.5 rounded-lg border-2 px-2 py-1.5 transition-colors disabled:opacity-50 ${
                  active ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white hover:border-violet-300'
                }`}
              >
                <span className="flex -space-x-1" aria-hidden>
                  {p.colors.map((c, i) => (
                    <span key={i} className="w-4 h-4 rounded-full border border-white" style={{ background: c }} />
                  ))}
                </span>
                <span className="text-[11px] font-semibold text-slate-600">{p.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const BackgroundChips = (
    <div className="flex flex-wrap gap-2">
      {BACKGROUND_OPTIONS.map((b) => {
        const active = answers.background === b.key;
        return (
          <button
            key={b.key}
            type="button"
            onClick={() => patch({ background: b.key as IntakeBackground })}
            disabled={isPending}
            title={b.hint}
            className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
              active
                ? 'border-violet-500 bg-violet-50 text-violet-700'
                : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300'
            }`}
          >
            {b.label}
          </button>
        );
      })}
    </div>
  );

  const WidgetChips = (
    <div className="flex flex-wrap gap-2">
      {WIDGET_OPTIONS.map((w) => {
        const Icon = ICONS[w.icon] || Sparkles;
        const active = answers.widgets.includes(w.key);
        return (
          <button
            key={w.key}
            type="button"
            onClick={() => toggleWidget(w.key)}
            disabled={isPending}
            aria-pressed={active}
            className={`flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
              active
                ? 'border-violet-500 bg-violet-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300'
            }`}
          >
            {active ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5 opacity-70" />}
            {w.label}
          </button>
        );
      })}
    </div>
  );

  const PromptBox = (
    <div className="space-y-2">
      <textarea
        value={promptText}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder={'What should it say? e.g. "Welcome to Riverside Cafe — now serving brunch"'}
        maxLength={1800}
        rows={3}
        disabled={isPending}
        className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent placeholder:text-slate-400 disabled:opacity-60"
      />
      {exampleChips && exampleChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] text-slate-400 self-center mr-0.5">Try:</span>
          {exampleChips.slice(0, 4).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onPromptChange(c)}
              disabled={isPending}
              className="text-[10px] px-2 py-1 rounded-full bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // ───────────────────────────────────────────────────────────────────────
  // WIZARD STEP DEFINITIONS
  // ───────────────────────────────────────────────────────────────────────
  const steps: Array<{ title: string; subtitle: string; body: React.ReactNode }> = [
    {
      title: "What's this screen for?",
      subtitle: 'Pick the kind of board — or skip and let AI decide.',
      body: (
        <div className="space-y-4">
          {typeToggle}
          {PurposeGrid}
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5">What should it say?</p>
            {PromptBox}
          </div>
        </div>
      ),
    },
    {
      title: 'Style & mood',
      subtitle: 'How should it feel? (Optional — AI picks one that fits otherwise.)',
      body: ThemeChips,
    },
    {
      title: 'Colors',
      subtitle: 'Your brand, a ready-made palette, or let AI choose.',
      body: PaletteRow,
    },
    {
      title: 'Background',
      subtitle: 'The backdrop behind your content.',
      body: BackgroundChips,
    },
    {
      title: "What's on it?",
      subtitle: 'Tap the elements you want — we pre-picked the usual ones.',
      body: WidgetChips,
    },
    {
      title: 'Screen',
      subtitle: 'Lay it out for the right shape so nothing gets clipped.',
      body: <div className="space-y-2">{screenPicker}</div>,
    },
  ];

  const isLast = step === TOTAL_STEPS - 1;

  // ───────────────────────────────────────────────────────────────────────
  // ADVANCED — everything on one screen.
  // ───────────────────────────────────────────────────────────────────────
  if (mode === 'advanced') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-slate-400">Advanced — set everything at once</p>
          <button
            type="button"
            onClick={() => setMode_('wizard')}
            disabled={isPending}
            className="text-[11px] font-bold text-violet-600 hover:text-violet-700 disabled:opacity-50 flex items-center gap-1"
          >
            <Wand2 className="w-3.5 h-3.5" /> Guide me instead
          </button>
        </div>

        {typeToggle}

        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-500">What should it say?</p>
          {PromptBox}
        </div>

        <details open className="group">
          <summary className="text-xs font-bold text-slate-500 cursor-pointer select-none mb-2">Purpose</summary>
          {PurposeGrid}
        </details>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500">Style / mood</p>
          {ThemeChips}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500">Colors</p>
          {PaletteRow}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500">Background</p>
          {BackgroundChips}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500">What's on it?</p>
          {WidgetChips}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500">Screen</p>
          {screenPicker}
        </div>

        {error && (
          <div
            role="alert"
            aria-live="polite"
            className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2.5"
          >
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-1 gap-3">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="px-4 py-2 text-sm font-bold rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onGenerate}
            disabled={isPending || !promptText.trim()}
            className="px-5 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generateLabel}
          </button>
        </div>
      </div>
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // WIZARD — step by step.
  // ───────────────────────────────────────────────────────────────────────
  const cur = steps[step];
  return (
    <div className="space-y-4">
      {/* Progress + advanced toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5" aria-hidden>
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-violet-600' : i < step ? 'w-3 bg-violet-300' : 'w-3 bg-slate-200'
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setMode_('advanced')}
          disabled={isPending}
          className="text-[11px] font-bold text-violet-600 hover:text-violet-700 disabled:opacity-50"
        >
          I know what I want → advanced
        </button>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-base font-bold text-slate-800">{cur.title}</h3>
          <span className="text-[10px] font-semibold text-slate-400 shrink-0">
            Step {step + 1} of {TOTAL_STEPS}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">{cur.subtitle}</p>
      </div>

      <div className="min-h-[120px]">{cur.body}</div>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2.5"
        >
          {error}
        </div>
      )}

      {/* Nav row */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          onClick={step === 0 ? onCancel : () => setStep((s) => Math.max(0, s - 1))}
          disabled={isPending}
          className="px-4 py-2 text-sm font-bold rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1"
        >
          {step === 0 ? 'Cancel' : (<><ChevronLeft className="w-4 h-4" /> Back</>)}
        </button>

        <div className="flex items-center gap-2">
          {/* "Skip" advances without choosing — every question stays ~2 clicks. */}
          {!isLast && (
            <button
              onClick={() => setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1))}
              disabled={isPending}
              className="px-3 py-2 text-xs font-bold rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Skip
            </button>
          )}
          {isLast ? (
            <button
              onClick={onGenerate}
              disabled={isPending || !promptText.trim()}
              className="px-5 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generateLabel}
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1))}
              disabled={isPending}
              className="px-5 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md disabled:opacity-50 flex items-center gap-1.5"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Generate-now escape hatch — non-IT operators who filled the first
          question can ship without walking all 6 steps (smart defaults). */}
      {step > 0 && !isLast && (
        <button
          onClick={onGenerate}
          disabled={isPending || !promptText.trim()}
          className="w-full text-[11px] font-semibold text-violet-600 hover:text-violet-700 disabled:opacity-40"
        >
          or generate now with what I&apos;ve picked
        </button>
      )}
    </div>
  );
}
