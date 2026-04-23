"use client";

import { useEffect, useState, useMemo } from 'react';
import { X, Download, Copy, Trash2, Bug } from 'lucide-react';
import {
  dumpRecent,
  dumpRecentAsText,
  clearRecent,
  downloadRecent,
  type LogEntry,
} from '@/lib/client-logger';

/**
 * In-app log viewer. Opens with Ctrl+Shift+L (or Cmd+Shift+L on Mac).
 *
 * Why this exists: during testing phases the operator hits a bug, you
 * ask "what did you see?" and they can't articulate it. The viewer
 * lets them pop open the last ~500 events and either copy them to
 * their clipboard or save them as a .log file to attach to a bug
 * report. No devtools required.
 *
 * Also exposed via window.__eduCmsLog for anyone already in devtools.
 *
 * Mounted once from the root layout so it's available on every page.
 */
export function LogViewer() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [copied, setCopied] = useState(false);

  // Keyboard shortcut: Ctrl/Cmd + Shift + L.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toUpperCase() === 'L') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Refresh entries whenever we open (and every 2s while open).
  useEffect(() => {
    if (!open) return;
    setEntries(dumpRecent());
    const t = setInterval(() => setEntries(dumpRecent()), 2000);
    return () => clearInterval(t);
  }, [open]);

  const visible = useMemo(() => {
    return entries.filter((e) => {
      if (filter !== 'all' && e.level !== filter) return false;
      if (tagFilter && !e.tag.toLowerCase().includes(tagFilter.toLowerCase())) return false;
      return true;
    });
  }, [entries, filter, tagFilter]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(dumpRecentAsText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API blocked in some embedded contexts */
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-2 sm:p-8"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-4xl h-[80vh] bg-slate-950 text-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900">
          <div className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-bold">Client log ({visible.length}/{entries.length})</h2>
            <span className="text-xs text-slate-500">Ctrl+Shift+L</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCopy}
              className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium flex items-center gap-1"
              title="Copy all log entries to clipboard"
            >
              <Copy className="w-3 h-3" />
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={() => downloadRecent()}
              className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium flex items-center gap-1"
              title="Download as .log file"
            >
              <Download className="w-3 h-3" />
              Save
            </button>
            <button
              onClick={() => { clearRecent(); setEntries([]); }}
              className="px-2 py-1 rounded-md bg-rose-950/50 hover:bg-rose-900/50 text-rose-300 text-xs font-medium flex items-center gap-1"
              title="Clear log buffer"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-md hover:bg-slate-800"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 bg-slate-900/50 text-xs">
          <div className="flex gap-1">
            {(['all', 'info', 'warn', 'error'] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFilter(lvl)}
                className={`px-2 py-0.5 rounded ${
                  filter === lvl
                    ? 'bg-indigo-500/30 text-indigo-200 ring-1 ring-indigo-400/50'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
          <input
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            placeholder="Filter tag (e.g. auth, api, upload)…"
            className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Entries */}
        <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed bg-slate-950">
          {visible.length === 0 ? (
            <div className="text-slate-500 text-center py-8">
              {entries.length === 0 ? 'No log entries yet.' : 'No entries match this filter.'}
            </div>
          ) : (
            visible.slice().reverse().map((e, i) => (
              <div key={i} className="flex gap-2 py-0.5 hover:bg-slate-900/50 rounded px-1">
                <span className="text-slate-600 shrink-0 tabular-nums">{e.ts.slice(11, 23)}</span>
                <span className={`shrink-0 w-12 ${levelColor(e.level)}`}>{e.level.toUpperCase()}</span>
                <span className="shrink-0 w-16 text-indigo-300 truncate">{e.tag}</span>
                <span className="text-slate-200 break-all">
                  {e.msg}
                  {e.ctx ? (
                    <span className="text-slate-500 ml-2">
                      {JSON.stringify(e.ctx)}
                    </span>
                  ) : null}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function levelColor(level: LogEntry['level']): string {
  switch (level) {
    case 'debug': return 'text-slate-500';
    case 'info':  return 'text-emerald-400';
    case 'warn':  return 'text-amber-400';
    case 'error': return 'text-rose-400';
  }
}
