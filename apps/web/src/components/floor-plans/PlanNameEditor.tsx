"use client";

/**
 * The floor plan's name, editable in place (2026-09-14, Greg: "where do I
 * change the name of the floor plan?"). Click the name or the pencil → type →
 * Enter saves, Escape cancels, a blank name is refused. Read-only roles see
 * plain text.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { useRenameFloorPlan } from '@/hooks/use-api';

export function PlanNameEditor({
  planId,
  name,
  canEdit,
  className,
}: {
  planId: string;
  name: string;
  canEdit: boolean;
  className?: string;
}) {
  const rename = useRenameFloorPlan();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing) setDraft(name); }, [name, editing]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    if (!next) { setError('A plan needs a name.'); return; }
    if (next === name) { setEditing(false); return; }
    try {
      await rename.mutateAsync({ planId, name: next });
      setEditing(false); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed.');
    }
  };

  if (!canEdit) return <span className={className}>{name}</span>;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Rename this floor plan"
        className={`inline-flex items-center gap-1.5 rounded-md hover:bg-slate-100 px-1 -mx-1 ${className ?? ''}`}
      >
        {name}
        <Pencil className="w-3 h-3 text-slate-400" aria-hidden />
        <span className="sr-only">Rename floor plan</span>
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit(); }
          if (e.key === 'Escape') { setEditing(false); setDraft(name); setError(null); }
        }}
        aria-label="Floor plan name"
        aria-invalid={!!error}
        disabled={rename.isPending}
        maxLength={200}
        className="h-8 px-2 rounded-lg border border-slate-300 text-[13px] font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-300 min-w-[16rem]"
      />
      <button type="button" onClick={() => void commit()} disabled={rename.isPending} aria-label="Save name"
        className="w-8 h-8 rounded-lg text-white flex items-center justify-center disabled:opacity-50" style={{ background: 'var(--brand-primary, #4f46e5)' }}>
        {rename.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Check className="w-3.5 h-3.5" aria-hidden />}
      </button>
      <button type="button" onClick={() => { setEditing(false); setDraft(name); setError(null); }} aria-label="Cancel rename"
        className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 flex items-center justify-center hover:bg-slate-50">
        <X className="w-3.5 h-3.5" aria-hidden />
      </button>
      {error && <span role="alert" className="text-[11px] font-semibold text-rose-600">{error}</span>}
    </span>
  );
}
