"use client";
import { useEffect, useId, useState } from 'react';
import { useBuilderStore } from './useBuilderStore';

export function TextField({ label, value, placeholder, onChange, onFocus }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void; onFocus?: () => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  // A2 — undo keystroke coalescing. Every TextField's onChange ultimately
  // calls a caller-supplied setField/setMeta that commits with
  // commit=true on EVERY keystroke; the store's activeTransaction guard
  // (see useBuilderStore.ts) turns those into a no-op re-commit as long
  // as a transaction is open, so wrapping focus/blur here — once, in the
  // shared component — coalesces all 285 TextField/TextAreaField call
  // sites into "one undo step per edit session" with zero call-site
  // changes. beginTransaction() is idempotent (no-ops if already open),
  // so nested/rapid focus doesn't push extra snapshots.
  const beginTransaction = useBuilderStore((s) => s.beginTransaction);
  const endTransaction = useBuilderStore((s) => s.endTransaction);
  // Label ↔ input association (same fix SelectField got in the 2026-08-24
  // a11y wave): screen readers announce the field, getByLabelText finds it.
  const inputId = useId();
  return (
    <div>
      <label htmlFor={inputId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <input
        id={inputId}
        type="text"
        value={local}
        placeholder={placeholder}
        onFocus={() => { beginTransaction(); onFocus?.(); }}
        onBlur={endTransaction}
        onChange={(e) => { setLocal(e.target.value); onChange(e.target.value); }}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm" />
    </div>
  );
}

export function SelectField({ label, value, options, onChange }: { label: string; value: string; options: [string,string][]; onChange: (v: string) => void }) {
  // a11y wave (2026-08-24) — axe-core: "Select element must have an
  // accessible name" (critical). The label text was visible but never
  // programmatically associated with the <select> (no htmlFor/id pairing,
  // no aria-label) — every widget field that renders through this shared
  // component was affected. useId() matches this file's existing
  // convention (see `nameId` above).
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm cursor-pointer">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
