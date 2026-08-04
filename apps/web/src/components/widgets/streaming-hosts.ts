/**
 * Streaming embed host allowlist — the ONE list every widget that frames a
 * third-party player checks against.
 *
 * 2026-08-02 (INJ-006) introduced this allowlist inside `StreamingWidget.tsx`
 * because `normalizeEmbedUrl` used to end with "assume the URL is already an
 * embed URL; return u" — so any string an operator (or a template-JSON edit)
 * dropped into `embedUrl` was framed verbatim, full-bleed, on a display that
 * also renders lockdown alerts.
 *
 * 2026-08-03 — the fix missed its twin. `fitness/FitnessLiveTVWidget.tsx`
 * frames `config.streamUrl` (and the youtube-live resolver's `embedUrl`) with
 * the SAME `sandbox="allow-scripts allow-same-origin allow-presentation"`, and
 * had no allowlist at all. `allow-same-origin` is only defensible while the
 * `src` is guaranteed to be a FOREIGN origin — the allowlist is precisely what
 * makes that guarantee, so a sandbox without one is the weaker half of a pair.
 * Hoisting the list here lets both widgets share one source of truth instead of
 * the next one drifting again.
 *
 * Adding a host here without a matching normalise rule in
 * `StreamingWidget.normalizeEmbedUrl` would let an operator-typed URL on that
 * host through verbatim — so keep the two lists in step.
 */
export const STREAMING_EMBED_HOSTS = [
  'youtube.com',
  'youtube-nocookie.com',
  'youtu.be',
  'twitch.tv',
  'vimeo.com',
  'kick.com',
] as const;

/** True when `host` is an allowlisted streaming host or a subdomain of one. */
export function isAllowedStreamingHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  for (const allowed of STREAMING_EMBED_HOSTS) {
    // Exact host, or a dot-boundary suffix — so "youtube.com.evil.net" and
    // "notyoutube.com" are both refused.
    if (h === allowed || h.endsWith('.' + allowed)) return true;
  }
  return false;
}

/**
 * Gate a URL that is about to become an iframe `src`.
 *
 * Returns the URL unchanged when it (a) parses as an absolute URL, (b) is
 * `https:`, and (c) lives on an allowlisted host. Returns `''` for everything
 * else — a relative path, `javascript:`/`data:`/`file:`, plain http, or any
 * host we don't recognise — so the caller can render an honest "unsupported
 * streaming host" placeholder instead of framing a stranger's page.
 *
 * There is deliberately NO loopback/dev exemption: that would be the one way
 * `src` could end up SAME-ORIGIN with the app, and these frames carry
 * `allow-same-origin`, which is only safe while the src is guaranteed foreign.
 */
export function safeEmbedSrc(input: string | undefined | null): string {
  if (!input) return '';
  const u = String(input).trim();
  if (!u) return '';
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:') return '';
    if (!isAllowedStreamingHost(parsed.hostname)) return '';
    return u;
  } catch {
    return '';
  }
}
