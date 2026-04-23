/**
 * Lightweight in-browser event logger — testing-phase visibility layer.
 *
 * What this does:
 *   - Keeps the last N log entries in an in-memory ring buffer (fast).
 *   - Mirrors to console so the regular devtools flow still works.
 *   - Mirrors to sessionStorage so a hard refresh doesn't wipe them.
 *   - Exposes `dumpRecent()` for the admin/debug dialog to render + copy.
 *   - Exposes `downloadRecent()` to save as a .log file the operator can
 *     attach to a bug report — no GitHub Actions, no dev tools, no SSH.
 *
 * Why this exists (2026-04-23): the Integration Lead was burning hours
 * reproducing issues in customer demos because there was no persistent
 * client-side trace. Every "it just happened once" bug is now at least
 * captured in the ring buffer so they can dump it right after.
 *
 * NOT a replacement for Sentry — this is the zero-budget, always-on
 * field-diagnostics layer. If/when Sentry ships we'll thread it in on
 * the `error` level too.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;          // ISO timestamp
  level: LogLevel;
  tag: string;         // short subsystem name: auth, api, upload, ws, emergency, ...
  msg: string;         // human-readable message
  ctx?: Record<string, unknown> | null; // structured context
}

const MAX_ENTRIES = 500;
const SS_KEY = 'edu_cms_client_log';

const ring: LogEntry[] = [];

function safeSession(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

// Restore any previous entries from sessionStorage so hard-refresh
// doesn't lose the trace leading up to the crash.
(function bootstrap() {
  const ss = safeSession();
  if (!ss) return;
  try {
    const raw = ss.getItem(SS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const e of parsed.slice(-MAX_ENTRIES)) {
        if (e && typeof e === 'object' && 'ts' in e) ring.push(e as LogEntry);
      }
    }
  } catch {
    /* corrupt blob — ignore, the ring just starts empty */
  }
})();

function persist() {
  const ss = safeSession();
  if (!ss) return;
  try {
    // Only store the last 200 to keep sessionStorage well under quota.
    const tail = ring.slice(-200);
    ss.setItem(SS_KEY, JSON.stringify(tail));
  } catch {
    /* quota / private mode — swallow */
  }
}

function emit(level: LogLevel, tag: string, msg: string, ctx?: Record<string, unknown> | null) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    tag,
    msg,
    ctx: ctx ?? null,
  };
  ring.push(entry);
  if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES);
  // Only persist every Nth entry to avoid sessionStorage churn on
  // high-frequency subsystems (upload progress, WS pings). Errors
  // always persist immediately so a crash leaves them on disk.
  if (level === 'error' || level === 'warn' || ring.length % 5 === 0) {
    persist();
  }

  // Mirror to console — tag the origin so devtools filter works.
  const prefix = `[${tag}]`;
  /* eslint-disable no-console */
  const payload = ctx ? [prefix, msg, ctx] : [prefix, msg];
  switch (level) {
    case 'debug': console.debug(...payload); break;
    case 'info':  console.info(...payload);  break;
    case 'warn':  console.warn(...payload);  break;
    case 'error': console.error(...payload); break;
  }
  /* eslint-enable no-console */
}

export const clog = {
  debug: (tag: string, msg: string, ctx?: Record<string, unknown> | null) => emit('debug', tag, msg, ctx),
  info:  (tag: string, msg: string, ctx?: Record<string, unknown> | null) => emit('info',  tag, msg, ctx),
  warn:  (tag: string, msg: string, ctx?: Record<string, unknown> | null) => emit('warn',  tag, msg, ctx),
  error: (tag: string, msg: string, ctx?: Record<string, unknown> | null) => emit('error', tag, msg, ctx),
};

export function dumpRecent(n = MAX_ENTRIES): LogEntry[] {
  return ring.slice(-n);
}

export function dumpRecentAsText(n = MAX_ENTRIES): string {
  return dumpRecent(n)
    .map((e) => {
      const ctxPart = e.ctx ? ' ' + JSON.stringify(e.ctx) : '';
      return `${e.ts} [${e.level.toUpperCase()}] ${e.tag}: ${e.msg}${ctxPart}`;
    })
    .join('\n');
}

export function clearRecent(): void {
  ring.length = 0;
  const ss = safeSession();
  if (ss) {
    try { ss.removeItem(SS_KEY); } catch {}
  }
}

export function downloadRecent(filename = `edu-cms-log-${new Date().toISOString().replace(/[:.]/g, '-')}.log`): void {
  if (typeof window === 'undefined') return;
  const text = dumpRecentAsText();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

// Dev convenience — expose on window so you can dump from the browser
// console without importing. In prod the bundle still ships this but
// the cost is negligible (two closures).
if (typeof window !== 'undefined') {
  (window as any).__eduCmsLog = {
    dumpRecent,
    dumpRecentAsText,
    clearRecent,
    downloadRecent,
  };
}
