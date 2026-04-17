"use client";

import {
  ArrowLeft, Save, Undo2, Redo2, Eye, EyeOff, Grid3X3, Magnet,
  ZoomIn, ZoomOut, RotateCw, Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';

interface Props {
  onBack: () => void;
  onSave: () => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveError?: string;
}

export function BuilderToolbar({ onBack, onSave, saveStatus, saveError }: Props) {
  const {
    meta, zones, isDirty, past, future, zoom, showGrid, snapEnabled, previewMode,
    undo, redo, flipCanvas, setZoom, setShowGrid, setSnapEnabled, setPreviewMode,
  } = useBuilderStore();

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

        <SaveStatusChip status={saveStatus} isDirty={isDirty} error={saveError} />

        <button
          type="button"
          onClick={onSave}
          disabled={saveStatus === 'saving'}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          {saveStatus === 'saving'
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
            : <Save className="w-3.5 h-3.5" aria-hidden />}
          Save
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

function SaveStatusChip({ status, isDirty, error }: { status: Props['saveStatus']; isDirty: boolean; error?: string }) {
  if (status === 'saved') {
    return (
      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded flex items-center gap-1" role="status">
        <CheckCircle2 className="w-3 h-3" aria-hidden /> Saved
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded flex items-center gap-1" role="alert" title={error}>
        <AlertCircle className="w-3 h-3" aria-hidden /> Save failed
      </span>
    );
  }
  if (isDirty) {
    return <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded" role="status">Unsaved</span>;
  }
  return null;
}
