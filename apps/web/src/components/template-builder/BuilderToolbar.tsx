"use client";

import {
  ArrowLeft, Save, Copy, Tv,
  RotateCw, Loader2, CheckCircle2, AlertCircle, Trash2, X,
  // C3 (Wave C, 2026-07-02) — the History trigger button beside SaveStatusChip.
  History as HistoryIcon,
  // E3 (CRUSH Wave E, 2026-07-03) — the "Put on a screen" express-lane arrow.
  ArrowRight, Tv2,
} from 'lucide-react';
import { useMemo } from 'react';
import { useBuilderStore } from './useBuilderStore';
import { validateTouchHitTargets } from './constants';
import { TranslateBoardButton } from '@/components/ai/TranslateBoardButton';

interface Props {
  onBack: () => void;
  onSave: () => void;
  onSaveAs?: () => void;
  /** One-click fork for starter/system templates → the operator's own
   *  editable copy. BuilderShell passes this; shown only when isSystem. */
  onCustomize?: () => void;
  /** Discard in-progress work and delete the template. BuilderShell
   *  passes this only for non-system templates; a missing handler hides
   *  the button. Clicking prompts for confirmation in BuilderShell. */
  onDiscard?: () => void;
  /** Open the fullscreen TemplatePreviewModal. Owned by BuilderShell so
   *  the modal can render OVER the entire builder, not just the toolbar. */
  onPreview?: () => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveError?: string;
  lastSavedAt?: number | null;
  /** C3 (Wave C, 2026-07-02) — opens BuilderShell's version-history
   *  panel. Owned by BuilderShell (same pattern as onPreview) so the
   *  panel can render as its own overlay; the toolbar is just the
   *  trigger button, placed beside SaveStatusChip. Hidden entirely for
   *  system templates (they never save, so they never have versions). */
  onOpenHistory?: () => void;
  /** E3 (CRUSH Wave E, 2026-07-03) — express-lane publish, reusing the
   *  gallery's exact `putOnScreen` handler (see lib/put-on-screen.ts).
   *  Owned by BuilderShell (same pattern as onOpenHistory/onPreview) so
   *  it can call handleSave first when the template is dirty. Hidden
   *  entirely for system templates — same reasoning as onOpenHistory:
   *  a starter preset was never saved into the operator's tenant, so
   *  there's nothing of theirs yet to put on a screen. Renders as the
   *  SaveStatusChip's "Saved ✓ — Put on a screen →" morph per
   *  05-EDITOR-CRUSH-LENSES.md:353. */
  onPutOnScreen?: () => void;
  /** True while the express-lane playlist is being created (per
   *  usePutOnScreen's puttingOnScreenId). Drives the CTA's spinner. */
  puttingOnScreenBusy?: boolean;
}

export function BuilderToolbar({ onBack, onSave, onSaveAs, onCustomize, onDiscard, onPreview, saveStatus, saveError, lastSavedAt, onOpenHistory, onPutOnScreen, puttingOnScreenBusy }: Props) {
  // Atomic selectors — one subscription per key lets Zustand skip this
  // toolbar's re-render when only zone geometry (BuilderCanvas concern)
  // or property fields (PropertiesPanel concern) changed.
  const meta = useBuilderStore((s) => s.meta);
  const zones = useBuilderStore((s) => s.zones);
  const isDirty = useBuilderStore((s) => s.isDirty);
  const isSystem = useBuilderStore((s) => s.isSystem);
  // 2026-05-12 toolbar simplification — Clean View, Hand touch-mode
  // toggle, and "+ Touch point" buttons removed. Selectors / setters
  // dropped along with them. isTouchEnabled is still read because
  // the warnings chip below the toolbar surfaces hit-target audit
  // when touch mode is on (the toggle lives in Properties panel now).
  const isTouchEnabled = useBuilderStore((s) => s.isTouchEnabled);
  const flipCanvas = useBuilderStore((s) => s.flipCanvas);
  // Whole-board Translate (2026-07-05) commits like PropertiesPanel's
  // ChatToEditBox — one updateZones call = one undo step.
  const updateZones = useBuilderStore((s) => s.updateZones);

  const touchWarnings = useMemo(
    () => isTouchEnabled ? validateTouchHitTargets(zones, meta.screenWidth, meta.screenHeight).warnings : [],
    [isTouchEnabled, zones, meta.screenWidth, meta.screenHeight],
  );

  const isPortrait = meta.screenHeight > meta.screenWidth;

  return (
    <div className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to template gallery"
          className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
        </button>
        <div className="h-6 w-px bg-slate-200" aria-hidden />
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-800 truncate">{meta.name || 'Untitled template'}</div>
          <div className="text-[10px] text-slate-400">{zones.length} {zones.length === 1 ? 'zone' : 'zones'} &middot; v2 builder</div>
        </div>
        {isSystem && (
          <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide">
            Starter
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {/* Undo/Redo + Grid/Snap + Zoom moved to the floating bottom bar
            (BuilderBottomBar in BuilderShell.tsx) — single source of truth
            for canvas-state controls. Top toolbar keeps only the things
            unique to it: preview/touch toggles + save/discard cluster. */}

        {/* 2026-05-12 — toolbar cleanup. Removed three redundant
            buttons after operator feedback:
              - "Clean view" (Eye) — operators kept hitting it
                expecting fullscreen and got the builder canvas at
                builder-zoom instead. The Tv Preview button below
                does the actual "show me on a TV" surface.
              - Hand touch-mode toggle — auto-enables when ANY touch
                widget is dropped (Phase D2.9); the manual override
                still exists as a tiny checkbox at the bottom of
                the Properties panel.
              - "+ Touch point" — redundant with the 25-tile Touch
                palette pinned at the top of Widgets.
            Result: one Preview button. Less ceremony. */}
        {onPreview && (
          <ToolbarBtn
            label="Open fullscreen preview at native resolution"
            onClick={onPreview}
          >
            <Tv className="w-3.5 h-3.5" aria-hidden />
            <span className="ml-1 text-[10px] font-bold uppercase tracking-wider hidden md:inline">Preview</span>
          </ToolbarBtn>
        )}

        {/* Whole-board Translate (2026-07-05, #282) — localize every text
            element in one undoable commit. Self-gates: hidden unless AI is
            configured AND the board has translatable text. */}
        <TranslateBoardButton
          zones={zones as any}
          vertical={(meta as any).vertical}
          onApply={(diff) => {
            const byId = new Map(diff.map((d) => [d.zoneId, d.patch]));
            updateZones(
              diff.map((d) => d.zoneId),
              (z: any) => {
                const p = byId.get(z.id);
                if (!p) return {};
                const { defaultConfig: cfgPatch, ...zoneKeys } = p;
                const merged: Record<string, any> = { ...zoneKeys };
                if (cfgPatch) merged.defaultConfig = { ...(z.defaultConfig || {}), ...cfgPatch };
                return merged;
              },
              true,
            );
          }}
        />
        {isTouchEnabled && touchWarnings.length > 0 && (
          <span
            className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded flex items-center gap-1"
            title={touchWarnings.map(w => `${w.zoneName}: ${w.reason}`).join('\n')}
            role="status"
            data-testid="touch-warnings"
          >
            <AlertCircle className="w-3 h-3" aria-hidden />
            {touchWarnings.length} hit-target {touchWarnings.length === 1 ? 'warning' : 'warnings'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* a11y wave (2026-08-24) — both badges measured 2.51:1
            (text-slate-400 on bg-slate-50) via axe-core; text-slate-600
            comfortably clears WCAG AA's 4.5:1 floor at this text size
            (text-slate-500's own ~4.76:1-on-white margin narrows against
            the slightly darker slate-50 backdrop these sit on, so this
            pair goes one shade further than the plain-white fixes
            elsewhere in this wave). */}
        <span className="text-[10px] font-mono text-slate-600 bg-slate-50 px-2 py-1 rounded">
          {meta.screenWidth}&times;{meta.screenHeight}
        </span>
        <button
          type="button"
          onClick={flipCanvas}
          aria-label={`Flip to ${isPortrait ? 'landscape' : 'portrait'}`}
          title={`Flip to ${isPortrait ? 'landscape' : 'portrait'}`}
          className="p-1.5 hover:bg-indigo-50 rounded text-slate-400 hover:text-indigo-600 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <RotateCw className="w-3.5 h-3.5" aria-hidden />
        </button>
        <span className="text-[10px] font-bold text-slate-600 bg-slate-50 px-2 py-1 rounded">
          {isPortrait ? 'Portrait' : 'Landscape'}
        </span>

        <SaveStatusChip
          status={saveStatus}
          isDirty={isDirty}
          error={saveError}
          lastSavedAt={lastSavedAt ?? null}
          onPutOnScreen={!isSystem ? onPutOnScreen : undefined}
          puttingOnScreenBusy={puttingOnScreenBusy}
        />

        {/* C3 — version history. Hidden for system templates (they
            never go through Save, so they never accumulate versions). */}
        {!isSystem && onOpenHistory && (
          <button
            type="button"
            onClick={onOpenHistory}
            title="Version history — restore one of the last 5 saves"
            className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <HistoryIcon className="w-3.5 h-3.5" aria-hidden />
          </button>
        )}

        {/* Discard — delete the in-progress (non-system) template and
            exit. Red tint so it's clearly destructive; only renders when
            BuilderShell passes the handler (system presets hide it). */}
        {onDiscard && (
          <button
            type="button"
            onClick={onDiscard}
            title="Discard this template and exit"
            className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-rose-400 border border-rose-200"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden />
            Discard
          </button>
        )}

        {/* Custom templates keep the secondary "Save as copy". Hidden on
            starter/system templates — there the PRIMARY action below IS the
            copy (you can't overwrite a shared starter). */}
        {onSaveAs && !isSystem && (
          <button
            type="button"
            onClick={onSaveAs}
            disabled={saveStatus === 'saving'}
            title="Save as copy (Ctrl+Shift+S)"
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <Copy className="w-3.5 h-3.5" aria-hidden />
            Save as copy
          </button>
        )}

        {/* Starter/system templates: the primary action is the one-click fork
            into the operator's own editable copy. Always enabled (forking is
            valid even before edits) so the path to "make this mine" is never
            hidden — the fix for "I couldn't update anything." */}
        {isSystem && onCustomize && (
          <button
            type="button"
            onClick={onCustomize}
            disabled={saveStatus === 'saving'}
            title="Save an editable copy to your templates"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            {saveStatus === 'saving'
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              : <Copy className="w-3.5 h-3.5" aria-hidden />}
            Save to my templates
          </button>
        )}

        {/* The primary "Save" writes into the current template. Hidden
            for system presets — those can never be overwritten; the
            operator can only Save-as-copy into their tenant. Disabled
            until there are actual changes — previously the bright
            indigo button was always active even on a freshly-opened
            template, which made 'Save' look like a required step. */}
        {!isSystem && (
          <button
            type="button"
            onClick={onSave}
            disabled={saveStatus === 'saving' || !isDirty}
            title={isDirty ? 'Save (Ctrl+S)' : 'No changes to save'}
            className={`px-4 py-2 text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
              isDirty && saveStatus !== 'saving'
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            {saveStatus === 'saving'
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              : <Save className="w-3.5 h-3.5" aria-hidden />}
            Save
          </button>
        )}

        {/* Explicit Close button — user feedback: the top-left back arrow
            wasn't obvious after landing on a new Save-as-copy. A labeled
            Close on the right-cluster where the save actions are gives
            the operator a clear exit. Falls through to onBack() which
            prompts for unsaved changes. */}
        <button
          type="button"
          onClick={onBack}
          title="Close template"
          className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
          Close
        </button>
      </div>
    </div>
  );
}

function ToolbarBtn({
  label, onClick, disabled, pressed, children,
}: {
  label: string; onClick: () => void; disabled?: boolean; pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={pressed ?? undefined}
      className={`p-1.5 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
        pressed
          ? 'bg-indigo-100 text-indigo-700'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function SaveStatusChip({
  status, isDirty, error, lastSavedAt, onPutOnScreen, puttingOnScreenBusy,
}: {
  status: Props['saveStatus']; isDirty: boolean; error?: string; lastSavedAt: number | null;
  onPutOnScreen?: () => void; puttingOnScreenBusy?: boolean;
}) {
  if (status === 'saving') {
    return (
      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded flex items-center gap-1" role="status">
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Saving&hellip;
      </span>
    );
  }
  // E3 (CRUSH Wave E, 2026-07-03) — a persisted, non-dirty template has
  // something publishable. Once Save has succeeded at least once
  // (status==='saved' right after Save, or lastSavedAt from an earlier
  // save this session) AND there are no unsaved edits, morph the chip
  // into the express-lane CTA per 05-EDITOR-CRUSH-LENSES.md:353: "Saved
  // ✓ — Put on a screen →". `onPutOnScreen` is undefined for system
  // templates (BuilderToolbar gates it), so this simply falls through to
  // the plain chip there.
  if (status === 'saved' || (status === 'idle' && !isDirty && lastSavedAt)) {
    if (onPutOnScreen) {
      return (
        <button
          type="button"
          onClick={onPutOnScreen}
          disabled={puttingOnScreenBusy}
          title="Create a playlist from this template and publish it to a screen"
          /* 2026-08-25 — PROMOTED from a 10px pale chip to a solid button.
             The express lane existed since 2026-07-03 and the operator never
             saw it: "when i hit save on my template shouldnt it take me out
             then so i can quickly publish it?" — he was asking for a way to
             publish that he already had, because at 10px in a toolbar of grey
             chips it did not read as the next step. Solid fill + real button
             sizing so the one action you want after saving is the one thing
             that stands out. */
          className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 border border-emerald-700 px-3 py-2 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-emerald-400"
        >
          {puttingOnScreenBusy
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
            : <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />}
          Saved
          <span className="text-emerald-200 font-normal">&middot;</span>
          <Tv2 className="w-3.5 h-3.5" aria-hidden />
          Put on a screen
          <ArrowRight className="w-3.5 h-3.5" aria-hidden />
        </button>
      );
    }
    if (status === 'saved') {
      return (
        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded flex items-center gap-1" role="status">
          <CheckCircle2 className="w-3 h-3" aria-hidden /> Saved
        </span>
      );
    }
  }
  if (status === 'error') {
    return (
      <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded flex items-center gap-1" role="alert" title={error || 'Save failed'}>
        <AlertCircle className="w-3 h-3" aria-hidden /> Save failed
      </span>
    );
  }
  if (isDirty) {
    return (
      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded" role="status" title="Click Save to persist changes">
        Unsaved
      </span>
    );
  }
  if (lastSavedAt) {
    return (
      <span className="text-[10px] font-semibold text-slate-400 px-2 py-1" title={new Date(lastSavedAt).toLocaleString()}>
        Saved {formatRelative(lastSavedAt)}
      </span>
    );
  }
  return null;
}

function formatRelative(ts: number): string {
  const delta = Math.max(0, Date.now() - ts);
  const sec = Math.floor(delta / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString();
}
