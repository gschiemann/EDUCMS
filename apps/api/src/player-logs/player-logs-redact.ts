/**
 * What a device log may leave in the IMMUTABLE audit table (2026-10-03).
 *
 * The player log is free text, and the audit table cannot be edited or
 * deleted afterwards, so a credential that lands there stays there. The APK
 * already redacts its own PLAYER_PLAYBACK_FAILURE markers (URLs and JWT-shaped
 * strings), but the crash record stores the last 10 KB of the WHOLE log, and
 * ordinary lines carry full URLs ("URL overlay page started: <url>", web-tab
 * sign-in redirects, exception messages naming a signed download URL). Until
 * the text body parser was mounted no upload was ever parsed, so this path had
 * never stored anything; it is closed here before it starts.
 *
 * Removed before storage:
 *   - JWT-shaped strings (`eyJ…`, whole or truncated)       → [credential]
 *   - `Bearer <anything>`                                   → Bearer [credential]
 *   - URL userinfo, query string and fragment               → scheme://host/path?[redacted]
 *   - `token=…`, `"password": "…"` and similar pairs        → token=[redacted]
 *   - opaque runs of 40+ base64/hex characters              → [redacted]
 *
 * Linear-time by construction: every caller passes a BOUNDED string (a 2 KB
 * line or a ~12 KB tail — never the 1 MB body), and no pattern nests a
 * quantifier, so a hostile body cannot buy CPU with backtracking.
 */

const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*){0,2}/g;
const BEARER = /\b(bearer)\s+[^\s"',;]+/gi;
// scheme, optional userinfo, host+path, optional query/fragment. Everything
// after the scheme is optional, so a match never fails once the scheme has
// matched and consumes the rest of its whitespace-delimited run.
const URL_PARTS =
  /\b([a-z][a-z0-9+.-]{0,31}:\/\/)([^\s/?#@]*@)?([^\s?#]*)([?#]\S*)?/gi;
// A value already replaced by an earlier rule is left as it is.
const SECRET_PAIR =
  /\b([\w-]{0,40}?(?:token|jwt|secret|passw(?:or)?d|api[-_]?key|signature|cookie|authorization|session[-_]?id))(\s{0,3}["']?\s{0,3}[:=]\s{0,3}["']?)(?!\[(?:redacted|credential)\])[^\s"'&,;)}\]]+/gi;
const OPAQUE_RUN = /[A-Za-z0-9_+=-]{40,}/g;

/** Redact credentials and URL secrets from a BOUNDED piece of log text. */
export function redactDiagnosticText(text: string): string {
  return text
    .replace(JWT_LIKE, '[credential]')
    .replace(BEARER, '$1 [credential]')
    .replace(
      URL_PARTS,
      (
        _m,
        scheme: string,
        userinfo: string | undefined,
        rest: string,
        query: string | undefined,
      ) =>
        scheme +
        (userinfo ? '[redacted]@' : '') +
        rest +
        (query ? `${query[0]}[redacted]` : ''),
    )
    .replace(SECRET_PAIR, '$1$2[redacted]')
    .replace(OPAQUE_RUN, '[redacted]');
}

/**
 * One recovery marker line for storage: redacted, then held to `max`
 * characters. Only the first `2 × max` characters are examined — the rest
 * could never be stored anyway, and cutting the END of a line never leaves a
 * URL without its scheme (which is what the redaction keys on).
 */
export function auditLine(line: string, max: number): string {
  return redactDiagnosticText(line.slice(0, max * 2)).slice(0, max);
}

/**
 * The newest `max` characters of a log for storage, redacted.
 *
 * A window a little wider than `max` is cut at a LINE boundary first (or, for
 * a single giant line, a whitespace boundary), because a URL never contains
 * either: cutting `https://host/?session=abc` after its `?ses` would start the
 * window with `sion=abc`, which nothing can recognise as part of a URL.
 * Redaction runs on that clean window; the result is then held to `max`.
 */
export function auditTail(raw: string, max: number): string {
  const start = Math.max(0, raw.length - (max + 2048));
  let window = raw.slice(start);
  if (start > 0 && raw[start - 1] !== '\n') {
    const newline = window.indexOf('\n');
    if (newline >= 0) {
      window = window.slice(newline + 1);
    } else {
      const space = window.search(/\s/);
      window = space >= 0 ? window.slice(space + 1) : '';
    }
  }
  const clean = redactDiagnosticText(window);
  return clean.length > max ? clean.slice(clean.length - max) : clean;
}
