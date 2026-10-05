'use client';

import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

/**
 * Copy text to the clipboard; true when the browser accepted it. The modern
 * Clipboard API first, then the old select-and-copy route for a browser that
 * refuses the first (Safari outside a fresh tap, an unusual frame).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the older route */
  }
  try {
    // A node THIS function creates and removes — never one React rendered.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy') === true;
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * "Copy all codes" that SAYS what happened. The old button called the
 * Clipboard API and showed nothing, so a person could not tell whether
 * anything had been copied (Greg, 2026-10-05, on the backup-codes screen).
 */
export function CopyCodesButton({
  codes,
  label,
  copiedLabel,
  failedLabel,
}: {
  codes: string[];
  label: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onCopy = async () => {
    const ok = await copyText(codes.join('\n'));
    setState(ok ? 'copied' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), ok ? 2500 : 6000);
  };

  return (
    <>
      <button
        type="button"
        onClick={onCopy}
        className={`w-full border text-xs font-semibold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
          state === 'copied'
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
            : 'border-slate-300 hover:bg-slate-50 text-slate-700'
        }`}
      >
        {state === 'copied' ? (<><Check className="w-3.5 h-3.5" aria-hidden /> {copiedLabel}</>) : label}
      </button>
      <p role="status" aria-live="polite" className={state === 'failed' ? 'text-[11px] leading-snug text-rose-600 text-center' : 'sr-only'}>
        {state === 'failed' ? failedLabel : state === 'copied' ? copiedLabel : ''}
      </p>
    </>
  );
}
