"use client";

/**
 * CreateTemplateFlow — what "New template" opens (Phase 1 of
 * docs/TEMPLATE-BUILDER-PROGRAM.md).
 *
 * WHAT IT REPLACES. A 4-field metadata modal (name, description,
 * category, a 16-tile resolution grid) whose primary button was
 * "Create & Open Editor" — i.e. a hard drop into a white canvas holding
 * one unexplained rectangle, with ~600 widget tiles behind ~28 filter
 * chips as the only next move. An operator built a template for a
 * customer demo through that door and called it the worst demo he has
 * ever given.
 *
 * WHAT IT DOES INSTEAD, and why each part is the way it is:
 *
 *  1. ONE QUESTION UP FRONT — name + canvas SHAPE. Every researched
 *     product (Canva, Yodeck, ScreenCloud, OptiSigns, Rise Vision,
 *     Figma, Adobe Express, Google Slides, Wix Studio) asks shape and
 *     nothing else, because shape is the only decision that cannot be
 *     deferred: it filters everything after it. ScreenCloud literally
 *     asks name + landscape/portrait.
 *
 *  2. THE 16-TILE GRID IS DEMOTED, NOT DELETED. Exact resolution, LED
 *     panel chains, category and description all still exist, behind
 *     "Advanced — exact size". An operator hanging a 320×1080 LED poster
 *     still gets their canvas; an operator making a lobby board is no
 *     longer asked to have an opinion about it.
 *
 *  3. YOU LAND ON A GALLERY, NOT A CANVAS. Nobody in the market opens
 *     on a blank canvas plus the full element library. The gallery is
 *     REAL rendered presets (ScaledTemplateThumbnail — the same renderer
 *     the templates gallery and the playlists page already use), so what
 *     the operator sees is what they get.
 *
 *  4. BLANK AND AI ARE SUBORDINATE DOORS, not the default. "Describe it
 *     instead" opens the AiIntakeWizard that has existed, working and
 *     unreachable from this path, all along.
 *
 * ACCESSIBILITY: every affordance here is a real <button> or a labelled
 * input. There is no drag, no hover-only control, and no click handler
 * on a bare div — WCAG, and also the reality that this product is run
 * from a phone and sometimes from a wall panel with a D-pad.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ChevronDown, ChevronRight, ImageIcon, Loader2, Monitor,
  Plus, Search, Smartphone, Sparkles, X,
} from 'lucide-react';
import { ScaledTemplateThumbnail } from '@/components/templates/ScaledTemplateThumbnail';
import {
  canvasLabel,
  DEFAULT_CANVAS,
  orientationOfSize,
  selectCreatePresets,
  type CreateDraft,
  type CreateOrientation,
  type PresetLike,
} from '@/components/templates/create-template-flow';

/** A preset as the gallery needs it: shape data + everything to render it. */
export interface CreateFlowTemplate extends PresetLike {
  zones?: Array<{
    id?: string;
    widgetType: string;
    x: number; y: number; width: number; height: number;
    zIndex?: number | null;
    defaultConfig?: unknown;
  }>;
  bgColor?: string | null;
  bgGradient?: string | null;
  bgImage?: string | null;
}

export interface CreateTemplateFlowProps {
  /** Everything GET /templates returned — already vertical-filtered by the API. */
  templates: readonly CreateFlowTemplate[];
  /** True while that list is still in flight (drives skeletons, not a spinner page). */
  loadingTemplates?: boolean;
  /**
   * useTenantCopy().verticalKnown — whether the industry is PROVEN, not the
   * K12 value normalizeVertical() invents for a missing one. Drives ordering
   * and one line of copy; never a school default.
   */
  verticalKnown: boolean;
  /** The tenant's own category vocabulary (label + order). */
  categories: ReadonlyArray<{ key: string; label: string }>;
  /** Resolve a category key to the tenant's word for it. */
  categoryLabel: (key: string) => string;
  /** The 16 canvas presets, demoted behind "Advanced — exact size". */
  resolutionPresets: ReadonlyArray<{ label: string; sub: string; w: number; h: number }>;
  onClose: () => void;
  onStartBlank: (draft: CreateDraft) => void;
  onPickPreset: (preset: CreateFlowTemplate, draft: CreateDraft) => void;
  onDescribeInstead: (draft: CreateDraft) => void;
  /** A create is in flight — every action disables, nothing double-fires. */
  busy?: boolean;
  /** AI generation is admin-only; hide the door rather than fail it later. */
  canUseAi?: boolean;
}

const PAGE_SIZE = 12;

export function CreateTemplateFlow(props: CreateTemplateFlowProps) {
  const {
    templates, loadingTemplates, verticalKnown, categories, categoryLabel,
    resolutionPresets, onClose, onStartBlank, onPickPreset, onDescribeInstead,
    busy, canUseAi,
  } = props;

  const [step, setStep] = useState<'shape' | 'gallery'>('shape');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // 'CUSTOM' is what the previous modal actually SENT, and it stays the
  // default — a blank board is not a kiosk. The old <select> never carried
  // a matching option for it, so it displayed the tenant's first category
  // while posting 'CUSTOM'; the option below closes that gap without
  // changing what an untouched form creates.
  const [category, setCategory] = useState('CUSTOM');
  // Shape is DERIVED from the canvas, never stored beside it. Two sources of
  // truth for "which way round is this screen" is how a gallery ends up
  // filtered to the opposite of what the operator just clicked.
  const [size, setSize] = useState<{ w: number; h: number }>(DEFAULT_CANVAS.LANDSCAPE);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customRes, setCustomRes] = useState(false);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const backRef = useRef<HTMLButtonElement | null>(null);

  /**
   * Park focus on a REAL control when the step changes. Step 1 is covered
   * by the name field's autoFocus; stepping forward to the gallery unmounts
   * the button that was focused, which would otherwise drop focus onto
   * <body> and leave a keyboard operator tabbing in from the top of the
   * page. A focusable container holding focus does not count as parked.
   */
  useEffect(() => {
    if (step === 'gallery') backRef.current?.focus();
  }, [step]);

  // Escape always closes. A modal that traps an operator is the same
  // failure class as a wall panel whose Back button does nothing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  /**
   * Picking a shape sets the canvas — that is the whole point of asking
   * shape first, and it is why the shape buttons outrank a size chosen
   * earlier in Advanced. Going the other way works too: choosing an exact
   * size in Advanced re-reads the shape off it (an LED poster chain is
   * portrait, a 5:1 banner is landscape), so the two controls can never
   * disagree.
   */
  const chooseOrientation = useCallback((next: CreateOrientation) => {
    setSize(DEFAULT_CANVAS[next]);
    setCustomRes(false);
    setShown(PAGE_SIZE);
  }, []);

  const chooseSize = useCallback((w: number, h: number) => {
    setSize({ w, h });
    setCustomRes(false);
    setShown(PAGE_SIZE);
  }, []);

  const draft: CreateDraft = useMemo(() => ({
    name: name.trim(),
    description: description.trim(),
    category,
    width: size.w,
    height: size.h,
    orientation: orientationOfSize(size.w, size.h),
  }), [name, description, category, size]);

  const matches = useMemo(() => selectCreatePresets<CreateFlowTemplate>({
    templates,
    orientation: draft.orientation,
    verticalKnown,
    categoryOrder: categories.map((c) => c.key).filter(Boolean),
    query,
    // The operator just told us the canvas; show boards built for it first.
    canvas: { width: draft.width, height: draft.height },
  }), [templates, draft.orientation, draft.width, draft.height, verticalKnown, categories, query]);

  /** The tenant's own categories, with the default the form actually posts. */
  const categoryOptions = useMemo(() => ([
    { key: 'CUSTOM', label: 'Custom' },
    ...categories.filter((c) => c.key && c.key !== 'CUSTOM'),
  ]), [categories]);

  const visible = matches.slice(0, shown);
  const canContinue = name.trim().length > 0 && !busy;

  const shapeWord = draft.orientation === 'PORTRAIT' ? 'Portrait' : 'Landscape';

  // ── Step 1: the one question ────────────────────────────────────────
  const shapeStep = (
    <>
      <div className="space-y-2">
        <label htmlFor="new-template-name" className="block text-[13px] font-semibold text-slate-700">
          What should we call it?
        </label>
        <input
          id="new-template-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Lobby welcome board"
          // The first field of a modal the operator just deliberately
          // opened — focusing it saves a tab and matches the modal this
          // replaced. Escape and the Close button are both available.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
          onKeyDown={(e) => { if (e.key === 'Enter' && canContinue) setStep('gallery'); }}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="block text-[13px] font-semibold text-slate-700">
          What shape is the screen?
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {([
            { key: 'LANDSCAPE' as const, title: 'Landscape', hint: 'Wall-mounted, TV, LED wall', Icon: Monitor, box: 'h-10 w-16' },
            { key: 'PORTRAIT' as const, title: 'Portrait', hint: 'Totem, poster, door panel', Icon: Smartphone, box: 'h-16 w-10' },
          ]).map(({ key, title, hint, Icon, box }) => {
            const active = draft.orientation === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => chooseOrientation(key)}
                aria-pressed={active}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 px-3 py-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none ${
                  active
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-slate-50'
                }`}
              >
                <span className={`flex ${box} items-center justify-center rounded-md border-2 ${active ? 'border-indigo-400' : 'border-slate-300'}`} aria-hidden>
                  <Icon className="h-4 w-4 opacity-70" />
                </span>
                <span className="text-sm font-bold">{title}</span>
                <span className="text-[11px] leading-tight opacity-70">{hint}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500">
          Starting size {canvasLabel(size.w, size.h)}. You can change this any time.
        </p>
      </fieldset>

      {/* ── Advanced: nothing removed, just no longer asked first ─────── */}
      <div className="rounded-xl border border-slate-200">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          aria-controls="new-template-advanced"
          className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-[13px] font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        >
          <span>Advanced — exact size, category, description</span>
          {advancedOpen ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}
        </button>
        {advancedOpen && (
          <div id="new-template-advanced" className="space-y-4 border-t border-slate-100 p-4">
            <div>
              <span className="mb-2.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Exact screen size</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {resolutionPresets.map((p) => {
                  const active = !customRes && p.w === size.w && p.h === size.h;
                  return (
                    <button
                      key={`${p.label}-${p.sub}`}
                      type="button"
                      onClick={() => chooseSize(p.w, p.h)}
                      aria-pressed={active}
                      className={`rounded-lg border-2 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none ${
                        active ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200'
                      }`}
                    >
                      <span className="block text-xs font-bold">{p.label}</span>
                      <span className="mt-0.5 block text-[10px] opacity-60">{p.sub} · {p.w}×{p.h}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setCustomRes(true)}
                  aria-pressed={customRes}
                  className={`rounded-lg border-2 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none ${
                    customRes ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200'
                  }`}
                >
                  <span className="block text-xs font-bold">Custom</span>
                  <span className="mt-0.5 block text-[10px] opacity-60">Any resolution</span>
                </button>
              </div>
              {customRes && (
                <div className="mt-3 flex items-center gap-3">
                  <label className="sr-only" htmlFor="new-template-w">Canvas width in pixels</label>
                  <input
                    id="new-template-w" type="number" min={100} max={15360} value={size.w}
                    onChange={(e) => setSize((s) => ({ ...s, w: parseInt(e.target.value, 10) || 1920 }))}
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <span className="text-xs font-bold text-slate-400" aria-hidden>×</span>
                  <label className="sr-only" htmlFor="new-template-h">Canvas height in pixels</label>
                  <input
                    id="new-template-h" type="number" min={100} max={15360} value={size.h}
                    onChange={(e) => setSize((s) => ({ ...s, h: parseInt(e.target.value, 10) || 1080 }))}
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="new-template-category" className="block text-[13px] font-semibold text-slate-700">Category</label>
              <select
                id="new-template-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {categoryOptions.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="new-template-desc" className="block text-[13px] font-semibold text-slate-700">Description</label>
              <input
                id="new-template-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional — what this board is for"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setStep('gallery')}
        disabled={!canContinue}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500 disabled:opacity-50 motion-reduce:transition-none"
      >
        Continue <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
      {!name.trim() && (
        <p className="-mt-2 text-center text-[11px] text-slate-400">Give it a name to continue.</p>
      )}
    </>
  );

  // ── The two subordinate doors ───────────────────────────────────────
  const secondaryDoors = (
    <div className="grid gap-2 sm:grid-cols-2">
      <button
        type="button"
        onClick={() => onStartBlank(draft)}
        disabled={busy}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500 disabled:opacity-50 motion-reduce:transition-none"
      >
        <Plus className="h-4 w-4" aria-hidden /> Start from blank
      </button>
      {canUseAi !== false && (
        <button
          type="button"
          onClick={() => onDescribeInstead(draft)}
          disabled={busy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 text-[13px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500 disabled:opacity-50 motion-reduce:transition-none"
        >
          <Sparkles className="h-4 w-4" aria-hidden /> Describe it instead
        </button>
      )}
    </div>
  );

  // ── Step 2: the gallery you land on ─────────────────────────────────
  const galleryStep = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-slate-500">
          <span className="font-semibold text-slate-700">{shapeWord}</span>
          {' · '}{canvasLabel(size.w, size.h)}
          {matches.length > 0 && <> · {matches.length} ready-made {matches.length === 1 ? 'board' : 'boards'}</>}
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
          <label className="sr-only" htmlFor="new-template-search">Search ready-made boards</label>
          <input
            id="new-template-search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShown(PAGE_SIZE); }}
            placeholder="Search boards"
            className="w-44 rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-[13px] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
      </div>

      {!verticalKnown && (
        // Truth over flattery: we are NOT claiming these are industry-matched,
        // because the client cannot prove the industry. Never quietly show a
        // corporate operator a school catalogue.
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          Showing a general selection. Set your industry in Settings to see boards built for it.
        </p>
      )}

      {loadingTemplates ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[168px] animate-pulse rounded-xl border border-slate-200 bg-slate-100 motion-reduce:animate-none" />
          ))}
        </div>
      ) : matches.length === 0 ? (
        // §5 — never an empty grid. Say what happened and offer the doors.
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {query.trim()
              ? `No ready-made board matches “${query.trim()}”.`
              : `No ready-made board is built for a ${shapeWord.toLowerCase()} screen yet.`}
          </p>
          <p className="mt-1 text-[13px] text-slate-500">
            {query.trim()
              ? 'Clear the search, or start one of these ways.'
              : 'You can still build one — start blank, or describe what you want and let us draft it.'}
          </p>
          {query.trim() && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="mt-3 text-[13px] font-semibold text-indigo-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {visible.map((t) => {
              const sw = t.screenWidth || 1920;
              const sh = t.screenHeight || 1080;
              const zones = t.zones || [];
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onPickPreset(t, draft)}
                    disabled={busy}
                    className="group flex w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition-shadow hover:border-indigo-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 motion-reduce:transition-none"
                  >
                    <span className="relative flex h-[132px] w-full items-center justify-center overflow-hidden border-b border-slate-100 bg-slate-100">
                      {zones.length === 0 ? (
                        <span className="flex flex-col items-center gap-1.5 text-slate-500">
                          <ImageIcon className="h-5 w-5" aria-hidden />
                          <span className="text-[11px] font-semibold">Preview unavailable</span>
                        </span>
                      ) : (
                        <ScaledTemplateThumbnail
                          zones={zones as never}
                          screenWidth={sw}
                          screenHeight={sh}
                          bgImage={t.bgImage}
                          bgGradient={t.bgGradient}
                          bgColor={t.bgColor}
                          maxHeight={132}
                          fill={sw / sh >= 1.5}
                          flush
                          freeze
                        />
                      )}
                    </span>
                    <span className="flex flex-col gap-0.5 p-3">
                      <span className="truncate text-[13px] font-bold text-slate-800" title={t.name}>{t.name}</span>
                      <span className="truncate text-[11px] text-slate-500">
                        {categoryLabel(t.category || '')} · {sw}×{sh}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {matches.length > visible.length && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE_SIZE)}
              className="mx-auto block rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Show {Math.min(PAGE_SIZE, matches.length - visible.length)} more
            </button>
          )}
        </>
      )}

      <div className="space-y-2 border-t border-slate-100 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Or start another way</p>
        {secondaryDoors}
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4">
      {/* The dimmed backdrop is a real <button>, not a div with a click
          handler: click-outside-to-close then costs no keyboard listener
          hack and trips no a11y rule. Escape and the Close button are the
          keyboard paths, so it stays out of the tab order. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => { if (!busy) onClose(); }}
        className="absolute top-0 right-0 bottom-0 left-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-template-title"
        className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 pb-[env(safe-area-inset-bottom)] shadow-2xl md:rounded-2xl md:p-6 md:pb-6"
      >
        <div className="mb-2 flex justify-center md:hidden" aria-hidden>
          <div className="h-1 w-10 rounded-full bg-slate-300" />
        </div>

        <div className="mb-4 flex items-center gap-2">
          {step === 'gallery' && (
            <button
              ref={backRef}
              type="button"
              onClick={() => setStep('shape')}
              disabled={busy}
              className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
              aria-label="Back to name and shape"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          <h2 id="new-template-title" className="min-w-0 flex-1 truncate text-lg font-bold text-slate-800">
            {step === 'shape' ? 'New template' : 'Pick a starting point'}
          </h2>
          {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-500 motion-reduce:animate-none" aria-label="Working" />}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:bg-slate-100 disabled:opacity-50 md:h-9 md:w-9"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="space-y-4">{step === 'shape' ? shapeStep : galleryStep}</div>
      </div>
    </div>
  );
}

export default CreateTemplateFlow;
