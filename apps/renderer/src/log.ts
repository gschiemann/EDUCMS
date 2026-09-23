/**
 * One JSON object per line on stdout — what Railway's log search indexes.
 * Never logs board HTML or image bytes: a board can carry a customer's menu,
 * prices and photos, and none of that belongs in a log stream.
 */
export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/** Strip control characters (log forging) and cap length. */
export function clean(value: unknown, max = 300): string {
  const s = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value ?? '');
  let out = '';
  for (const ch of s.slice(0, max)) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out;
}

export function createLogger(write: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    write(JSON.stringify({ t: new Date().toISOString(), level, svc: 'renderer', msg, ...fields }));
  };
  return {
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
