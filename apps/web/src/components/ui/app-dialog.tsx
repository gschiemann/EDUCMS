"use client";

/**
 * App-themed Confirm / Alert / Prompt dialogs.
 *
 * Replaces native window.confirm/alert/prompt with a styled, accessible
 * modal. Use the imperative helpers from anywhere in the app:
 *
 *   import { appConfirm, appAlert, appPrompt } from '@/components/ui/app-dialog';
 *
 *   if (await appConfirm({ title: 'Delete?', message: '...', danger: true })) {
 *     // do it
 *   }
 *
 * <AppDialogHost /> must be mounted exactly once at the app root.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

type DialogTone = 'default' | 'danger' | 'warn' | 'info';

interface BaseRequest {
  id: number;
  title?: string;
  message: string;
  tone?: DialogTone;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmRequest extends BaseRequest {
  kind: 'confirm';
  resolve: (ok: boolean) => void;
}
interface AlertRequest extends BaseRequest {
  kind: 'alert';
  resolve: (ok: true) => void;
}
interface PromptRequest extends BaseRequest {
  kind: 'prompt';
  defaultValue?: string;
  placeholder?: string;
  resolve: (value: string | null) => void;
}

type DialogRequest = ConfirmRequest | AlertRequest | PromptRequest;

// ─── Singleton subscriber registry ───────────────────────────────────
type Listener = (req: DialogRequest | null) => void;
let queue: DialogRequest[] = [];
const listeners = new Set<Listener>();
let nextId = 1;

function notify() {
  const top = queue[0] || null;
  listeners.forEach(l => l(top));
}

function push(req: Omit<DialogRequest, 'id'>): DialogRequest {
  const full = { ...req, id: nextId++ } as DialogRequest;
  queue.push(full);
  notify();
  return full;
}

function dismiss(id: number) {
  queue = queue.filter(r => r.id !== id);
  notify();
}

// ─── Imperative API ──────────────────────────────────────────────────

export function appConfirm(opts: {
  title?: string;
  message: string;
  tone?: DialogTone;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  return new Promise(resolve => {
    push({
      kind: 'confirm',
      title: opts.title,
      message: opts.message,
      tone: opts.tone || 'default',
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      resolve,
    } as Omit<ConfirmRequest, 'id'>);
  });
}

export function appAlert(opts: {
  title?: string;
  message: string;
  tone?: DialogTone;
  confirmLabel?: string;
}): Promise<true> {
  return new Promise(resolve => {
    push({
      kind: 'alert',
      title: opts.title,
      message: opts.message,
      tone: opts.tone || 'info',
      confirmLabel: opts.confirmLabel,
      resolve,
    } as Omit<AlertRequest, 'id'>);
  });
}

export function appPrompt(opts: {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<string | null> {
  return new Promise(resolve => {
    push({
      kind: 'prompt',
      title: opts.title,
      message: opts.message,
      defaultValue: opts.defaultValue,
      placeholder: opts.placeholder,
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      resolve,
    } as Omit<PromptRequest, 'id'>);
  });
}

// ─── Host component ──────────────────────────────────────────────────

const TONE_STYLES: Record<DialogTone, { ring: string; icon: any; iconColor: string; confirmBtn: string }> = {
  default: { ring: 'ring-indigo-200',  icon: Info,          iconColor: 'text-indigo-500',  confirmBtn: 'bg-indigo-600 hover:bg-indigo-700' },
  danger:  { ring: 'ring-rose-200',    icon: AlertCircle,   iconColor: 'text-rose-500',    confirmBtn: 'bg-rose-600 hover:bg-rose-700' },
  warn:    { ring: 'ring-amber-200',   icon: AlertTriangle, iconColor: 'text-amber-500',   confirmBtn: 'bg-amber-600 hover:bg-amber-700' },
  info:    { ring: 'ring-sky-200',     icon: Info,          iconColor: 'text-sky-500',     confirmBtn: 'bg-sky-600 hover:bg-sky-700' },
};

export function AppDialogHost() {
  const [current, setCurrent] = useState<DialogRequest | null>(null);
  const [promptValue, setPromptValue] = useState('');

  useEffect(() => {
    const l: Listener = (req) => {
      setCurrent(req);
      if (req?.kind === 'prompt') setPromptValue(req.defaultValue || '');
    };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (current.kind === 'confirm') (current as ConfirmRequest).resolve(false);
        else if (current.kind === 'prompt') (current as PromptRequest).resolve(null);
        else (current as AlertRequest).resolve(true);
        dismiss(current.id);
      } else if (e.key === 'Enter' && current.kind !== 'prompt') {
        if (current.kind === 'confirm') (current as ConfirmRequest).resolve(true);
        else (current as AlertRequest).resolve(true);
        dismiss(current.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current]);

  if (!current) return null;

  const tone = TONE_STYLES[current.tone || 'default'];
  const Icon = tone.icon;

  const close = (result: any) => {
    (current as any).resolve(result);
    dismiss(current.id);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-dialog-title"
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 animate-in fade-in duration-150"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={() => current.kind !== 'alert' && close(current.kind === 'prompt' ? null : false)}
      />

      {/* Modal card */}
      <div className={`relative bg-white rounded-2xl shadow-2xl ring-1 ${tone.ring} max-w-md w-full overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-2 duration-200`}>
        {/* Close x */}
        {current.kind !== 'alert' && (
          <button
            onClick={() => close(current.kind === 'prompt' ? null : false)}
            aria-label="Cancel"
            className="absolute top-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        )}

        {/* Body */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start gap-4">
            <div className={`shrink-0 w-10 h-10 rounded-xl bg-${(current.tone || 'default') === 'default' ? 'indigo' : current.tone}-50 flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${tone.iconColor}`} aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              {current.title && (
                <h2 id="app-dialog-title" className="text-base font-bold text-slate-900 mb-1.5">
                  {current.title}
                </h2>
              )}
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{current.message}</p>
              {current.kind === 'prompt' && (
                <input
                  type="text"
                  autoFocus
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); close(promptValue); }
                  }}
                  placeholder={(current as PromptRequest).placeholder}
                  className="mt-3 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                />
              )}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 pb-5 pt-2 flex items-center justify-end gap-2 bg-slate-50/40">
          {current.kind !== 'alert' && (
            <button
              type="button"
              onClick={() => close(current.kind === 'prompt' ? null : false)}
              className="px-4 py-2 rounded-lg text-sm font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {current.cancelLabel || 'Cancel'}
            </button>
          )}
          <button
            type="button"
            autoFocus={current.kind !== 'prompt'}
            onClick={() => close(current.kind === 'prompt' ? promptValue : true)}
            className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 ${tone.confirmBtn}`}
          >
            {current.confirmLabel || (current.kind === 'alert' ? 'OK' : current.kind === 'prompt' ? 'Submit' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
