"use client";

import {
  ArrowLeft, Save, Copy, Undo2, Redo2, Eye, EyeOff, Grid3X3, Magnet,
  ZoomIn, ZoomOut, RotateCw, Loader2, CheckCircle2, AlertCircle, Hand, Trash2, X,
} from 'lucide-react';
import { useMemo } from 'react';
import { useBuilderStore } from './useBuilderStore';
import { validateTouchHitTargets } from './constants';

interface Props {
  onBack: () => void;
  onSave: () => void;
  onSaveAs?: () => void;
  /** Discard in-progress work and delete the template. BuilderShell
   *  passes this only for non-system templates; a missing handler hides
   *  the button. Clicking prompts for confirmation in BuilderShell. */
  onDiscard?: () => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveError?: string;
  lastSavedAt?: number | null;
}

export function BuilderToolbar({ onBack, onSave, onSaveAs, onDiscard, saveStatus, saveError, lastSavedAt }: Props) {
  // Atomic selectors — one subscription per key lets Zustand skip this
  // toolbar's re-render when only zone geometry (BuilderCanvas concern)
  // or property fields (PropertiesPanel concern) changed.
  const meta = useBuilderStore((s) => s.meta);
  const zones = useBuilderStore((s) => s.zones);
  const isDirty = useBuilderStore((s) => s.isDirty);
  const isSystem = useBuilderStore((s) => s.isSystem);
  const past = useBuilderStore((s) => s.past);
  const future = useBuilderStore((s) => s.future);
  const zoom = useBuilderStore((s) => s.zoom);
  const showGrid = useBuilderStore((s) => s.showGrid);
  const snapEnabled = useBuilderStore((s) => s.snapEnabled);
  const previewMode = useBuilderStore((s) => s.previewMode);
  const isTouchEnabled = useBuilderStore((s) => s.isTouchEnabled);
  const setTouchEnabled = useBuilderStore((s) => s.setTouchEnabled);
  const undo = useBuilderStore((s) => s.undo);
  const redo = useBuilderStore((s) => s.redo);
  const flipCanvas = useBuilderStore((s) => s.flipCanvas);
  const setZoom = useBuilderStore((s) => s.setZoom);
  const setShowGrid = useBuilderStore((s) => s.setShowGrid);
  const setSnapEnabled = useBuilderStore((s) => s.setSnapEnabled);
  const setPreviewMode = useBuilderStore((s) => s.setPreviewMode);

  const touchWarnings = useMemo(
    () => isTouchEnabled ? validateTouchHitTargets(zones, meta.screenWidth, meta.screenHeight).warnings : [],
    [isTouchEnabled, zones, meta.screenWidth, meta.screenHeight],
  );

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
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
      </div>

      <div className="flex items-center gap-1">
        <ToolbarBtn label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
          <Undo2 className="w-3.5 h-3.5" aria-hidden />
        </ToolbarBtn>
        <ToolbarBtn label="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo}>
          <Redo2 className="w-3.5 h-3.5" aria-hidden />
        </ToolbarBtn>
        <div className="h-4 w-px bg-slate-200 mx-1" aria-hidden />
        <ToolbarBtn
          label={showGrid ? 'Hide grid' : 'Show grid'}
          onClick={() => setShowGrid(!showGrid)}
          pressed={showGrid}
        >
          <Grid3X3 className="w-3.5 h-3.5" aria-hidden />
        </ToolbarBtn>
        <ToolbarBtn
          label={snapEnabled ? 'Disable snapping' : 'Enable snapping'}
          onClick={() => setSnapEnabled(!snapEnabled)}
          pressed={snapEnabled}
        >
          <Magnet className="w-3.5 h-3.5" aria-hidden />
        </ToolbarBtn>
        <div className="h-4 w-px bg-slate-200 mx-1" aria-hidden />
        <ToolbarBtn label="Zoom out" onClick={() => setZoom(zoom - 0.1)}>
          <ZoomOut className="w-3.5 h-3.5" aria-hidden />
        </ToolbarBtn>
        <span className="text-[10px] font-mono text-slate-500 w-10 text-center" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <ToolbarBtn label="Zoom in" onClick={() => setZoom(zoom + 0.1)}>
          <ZoomIn className="w-3.5 h-3.5" aria-hidden />
        </ToolbarBtn>
        <ToolbarBtn label="Reset zoom" onClick={() => setZoom(1)}>
          <span className="text-[10px] font-bold">1:1</span>
        </ToolbarBtn>
        <div className="h-4 w-px bg-slate-200 mx-1" aria-hidden />
        <ToolbarBtn
          label={previewMode ? 'Exit preview' : 'Live preview'}
          onClick={() => setPreviewMode(!previewMode)}
          pressed={previewMode}
        >
          {previewMode ? <EyeOff className="w-3.5 h-3.5" aria-hidden /> : <Eye className="w-3.5 h-3.5" aria-hidden />}
        </ToolbarBtn>
        <ToolbarBtn
          label={isTouchEnabled ? 'Touch mode: ON (WCAG 44px enforced)' : 'Enable touch mode'}
          onClick={() => setTouchEnabled(!isTouchEnabled)}
          pressed={isTouchEnabled}
        >
          <Hand className="w-3.5 h-3.5" aria-hidden />
        </ToolbarBtn>
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
        <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-1 rounded">
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
        <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded">
          {isPortrait ? 'Portrait' : 'Landscape'}
        </span>

        <SaveStatusChip status={saveStatus} isDirty={isDirty} error={saveError} lastSavedAt={lastSavedAt ?? null} />

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

        {onSaveAs && (
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
  status, isDirty, error, lastSavedAt,
}: {
  status: Props['saveStatus']; isDirty: boolean; error?: string; lastSavedAt: number | null;
}) {
  if (status === 'saving') {
    return (
      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded flex items-center gap-1" role="status">
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Saving&hellip;
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded flex items-center gap-1" role="status">
        <CheckCircle2 className="w-3 h-3" aria-hidden /> Saved
      </span>
    );
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
      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded" role="status" title="Auto-saves after 15s idle">
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
