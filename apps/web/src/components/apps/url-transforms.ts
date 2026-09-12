/**
 * url-transforms — pure helpers that turn a "share" URL an operator would
 * copy/paste (YouTube watch link, Google Slides edit link, etc.) into the
 * embeddable form a widget actually needs.
 *
 * Kept separate from app-registry.ts so they're independently testable and
 * so other code can import the same normalizers without pulling in the
 * whole App Registry (React-free, no "use client").
 *
 * NOTE: StreamingWidget.tsx already has its own `normalizeEmbedUrl` for
 * YouTube/Twitch/Vimeo (used at PLAYER render time, given whatever URL is
 * already sitting in zone config — including a raw watch URL, since the
 * player must stay robust to hand-edited configs). This file's job is
 * different: producing the cleanest canonical URL at ADD-TIME so the
 * config form's live preview matches what the player will actually show.
 */

/** Extract a YouTube video ID from any common share-URL shape. */
export function youtubeVideoId(input: string): string | null {
  const u = (input || '').trim();
  if (!u) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/live\/)([\w-]{6,})/i,
  ];
  for (const re of patterns) {
    const m = u.match(re);
    if (m) return m[1];
  }
  return null;
}

/** YouTube watch/share URL -> canonical watch URL (StreamingWidget embeds it at render time). */
export function toYoutubeCanonicalUrl(input: string): string {
  const id = youtubeVideoId(input);
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  // Channel "live" URLs (youtube.com/@handle/live) — pass through, the
  // StreamingWidget's normalizeEmbedUrl already special-cases these.
  return (input || '').trim();
}

/** Vimeo share URL -> canonical vimeo.com/<id> URL. */
export function toVimeoCanonicalUrl(input: string): string {
  const u = (input || '').trim();
  const m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? `https://vimeo.com/${m[1]}` : u;
}

/**
 * Google Slides "share" or "edit" link -> the publish-to-web /embed form.
 * Accepts:
 *   https://docs.google.com/presentation/d/<id>/edit#slide=id.p
 *   https://docs.google.com/presentation/d/<id>/pub?start=true...
 *   https://docs.google.com/presentation/d/e/<pub-id>/pub  (already published)
 * Returns an /embed URL with autostart + loop + delay params. Note: this
 * only works if the operator has already used File -> Share -> Publish to
 * web in Slides — a private (unpublished) deck's /edit link will render a
 * Google sign-in wall in the iframe. We can't detect that client-side; the
 * config form surfaces a warning instead (see app-registry.ts blurb).
 */
export function toGoogleSlidesEmbedUrl(input: string, opts?: { loop?: boolean; delayMs?: number }): string {
  const u = (input || '').trim();
  if (!u) return '';
  const delay = opts?.delayMs ?? 5000;
  const loop = opts?.loop !== false;
  // Already a /pub or /embed URL — just make sure the autoplay params are set.
  const idMatch = u.match(/\/presentation\/d\/(?:e\/)?([\w-]+)/);
  if (!idMatch) return u; // not a recognizable Slides URL — pass through untouched
  const isPublished = u.includes('/d/e/');
  const base = isPublished
    ? `https://docs.google.com/presentation/d/e/${idMatch[1]}/embed`
    : `https://docs.google.com/presentation/d/${idMatch[1]}/embed`;
  const params = new URLSearchParams({
    start: 'true',
    loop: loop ? 'true' : 'false',
    delayms: String(delay),
  });
  return `${base}?${params.toString()}`;
}

/**
 * Google Sheets "share" link -> published HTML embed. Same publish-to-web
 * caveat as Slides. Accepts a /edit or /pubhtml URL; passes through anything
 * else unrecognized (operator may already have the raw /pubhtml?widget=...
 * URL from File -> Share -> Publish to web).
 */
export function toGoogleSheetsEmbedUrl(input: string): string {
  const u = (input || '').trim();
  if (!u) return '';
  if (u.includes('/pubhtml') || u.includes('output=html')) return u;
  const idMatch = u.match(/\/spreadsheets\/d\/([\w-]+)/);
  if (!idMatch) return u;
  return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/pubhtml?widget=true&headers=false`;
}

/**
 * PowerPoint Online (OneDrive/SharePoint "Embed" share link). Office embed
 * links already come out of Share -> Embed as a full <iframe src="..."> —
 * operators sometimes paste the whole snippet. We strip an accidentally-
 * pasted <iframe ...></iframe> wrapper down to the bare src.
 */
export function extractIframeSrc(input: string): string {
  const u = (input || '').trim();
  const m = u.match(/src=["']([^"']+)["']/i);
  return m ? m[1] : u;
}

/**
 * Canva "share" link -> the public ?embed viewer URL. Requires the design
 * to have been shared as "Anyone with the link can view" (Canva's own
 * requirement for embeds — we can't detect privacy client-side).
 */
export function toCanvaEmbedUrl(input: string): string {
  const u = (input || '').trim();
  if (!u) return '';
  if (/[?&]embed\b/.test(u)) return u;
  const sep = u.includes('?') ? '&' : '?';
  return `${u}${sep}embed`;
}

/** Google Maps "share" link or a plain address/place query -> Maps embed URL. */
export function toGoogleMapsEmbedUrl(query: string, opts?: { apiKey?: string; mode?: 'place' | 'directions' | 'view'; zoom?: number }): string {
  const q = (query || '').trim();
  if (!q) return '';
  // Already an embed URL (operator pasted from Maps "Embed a map" dialog) — pass through.
  if (/google\.com\/maps\/embed/.test(q)) return q;
  const mode = opts?.mode || 'place';
  if (opts?.apiKey) {
    // Maps Embed API (needs a key — GOOGLE_MAPS_API_KEY per CLAUDE.md, used
    // server-side elsewhere in the app for geocoding). TODO(lead): wire a
    // real server-proxied key lookup for this app; Phase 1 leaves the key
    // field blank in the config form and falls back to the keyless output
    // below, which is the safe default (no key exposed client-side).
    return `https://www.google.com/maps/embed/v1/${mode}?key=${encodeURIComponent(opts.apiKey)}&q=${encodeURIComponent(q)}`;
  }
  // Keyless fallback — the classic "output=embed" form still works without
  // an API key for simple place/address queries (no directions/traffic layer).
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=${opts?.zoom ?? 14}&output=embed`;
}

/**
 * Google Calendar public link -> the real "Embed code" HTML view
 * (calendar.google.com/calendar/embed?...). Unlike the .ics feed URL (which
 * the CALENDAR widget never actually fetches — see app-registry.ts's
 * Calendar app comment), this HTML embed is Google's own live view and
 * works TODAY riding the WEBPAGE widget/proxy — real content, no stub.
 * Accepts:
 *   - an already-built /calendar/embed?... URL (operator pasted it straight
 *     from Google Calendar Settings -> Integrate calendar -> Embed code) —
 *     passed through untouched.
 *   - a public .ics "Secret address" URL — converted to the matching src
 *     calendar id where possible.
 *   - a bare calendar id / email address (e.g. a Google Workspace resource
 *     calendar) — wrapped directly.
 * Falls back to passing the input through unchanged if we can't confidently
 * extract a calendar id, so the operator's paste is never silently dropped.
 */
export function toGoogleCalendarEmbedUrl(input: string): string {
  const u = (input || '').trim();
  if (!u) return '';
  if (/calendar\.google\.com\/calendar\/embed/i.test(u)) return u;
  // .ics feed URL: .../calendar/ical/<id>/... or .../calendar/ical/<id>.ics
  const icsMatch = u.match(/calendar\.google\.com\/calendar\/ical\/([^/]+)\//i);
  const id = icsMatch ? decodeURIComponent(icsMatch[1]) : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u) ? u : null);
  if (id) {
    return `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(id)}&ctz=local`;
  }
  return u;
}

/** Bare domain -> https:// prefixed URL (WebpageWidget already does this too; kept here so the config-form preview matches what will actually render). */
export function ensureHttps(input: string): string {
  const u = (input || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u) || u.startsWith('//')) return u;
  return `https://${u}`;
}

/** Twitch channel URL or bare channel name -> canonical twitch.tv/<channel> URL. */
export function toTwitchCanonicalUrl(input: string): string {
  const u = (input || '').trim();
  const m = u.match(/twitch\.tv\/([\w-]+)/);
  if (m) return `https://twitch.tv/${m[1]}`;
  // Bare channel name (no slashes/dots) — treat as a handle.
  if (/^[\w-]+$/.test(u)) return `https://twitch.tv/${u}`;
  return u;
}

/**
 * detectApp — "paste anything" auto-detect (App Library world-class build,
 * 2026-07-01, see docs/research/2026-06-30-app-library/20-WORLDCLASS-BUILD-PLAN.md
 * Tier 1 #1).
 *
 * Pure, DOM-free, unit-testable: given whatever an operator pastes (a full
 * URL, a bare Twitch handle, etc.), returns which App Registry tile it
 * matches + the field(s) to prefill on that app's config form — WITHOUT the
 * operator ever having to pick a tile first. Deliberately reuses the exact
 * matchers above (no new regexes) so a match here is guaranteed to `build()`
 * the same way the app's own form would. Runs in a fixed priority order:
 * the most specific host match wins before the catch-all bare-URL fallback.
 *
 * Returns null for empty/unparsable input so callers can leave the grid
 * exactly as-is (per the spec: "no match → grid stays").
 */
export interface DetectedApp {
  appId: string;
  /** Field values to seed into that app's AppConfigForm via `initialValues`. */
  prefill: Record<string, string>;
}

export function detectApp(input: string): DetectedApp | null {
  const raw = (input || '').trim();
  if (!raw) return null;

  // YouTube — watch/shorts/youtu.be/embed/live, or a bare @handle/live URL.
  if (youtubeVideoId(raw) || /youtube\.com\/(@[\w-]+\/live|live\/)/i.test(raw)) {
    return { appId: 'youtube', prefill: { url: raw } };
  }
  // Vimeo
  if (/vimeo\.com\/(?:video\/)?\d+/i.test(raw)) {
    return { appId: 'vimeo', prefill: { url: raw } };
  }
  // Twitch — full URL only for auto-detect (a bare word is too ambiguous to
  // silently claim as a Twitch channel from a generic paste box/search box).
  if (/twitch\.tv\/[\w-]+/i.test(raw)) {
    return { appId: 'twitch', prefill: { channel: raw } };
  }
  // Google Slides
  if (/docs\.google\.com\/presentation\//i.test(raw)) {
    return { appId: 'google-slides', prefill: { url: raw } };
  }
  // Google Sheets
  if (/docs\.google\.com\/spreadsheets\//i.test(raw)) {
    return { appId: 'google-sheets', prefill: { url: raw } };
  }
  // Canva
  if (/canva\.com\//i.test(raw)) {
    return { appId: 'canva', prefill: { url: raw } };
  }
  // Google Maps (a share link, not just any google.com URL)
  if (/(?:maps\.google\.com|google\.com\/maps)/i.test(raw)) {
    return { appId: 'google-maps', prefill: { query: raw } };
  }
  // Office/OneDrive/SharePoint embed link or snippet
  if (/onedrive\.live\.com|sharepoint\.com/i.test(raw)) {
    return { appId: 'powerpoint-onedrive', prefill: { url: raw } };
  }
  // Catch-all: any other valid https(s) URL becomes the generic Web Page
  // app, prefilled — so paste NEVER dead-ends even when we don't have a
  // dedicated tile for it (synthesis: "the generic Web Page path always
  // works immediately so paste never dead-ends").
  const httpsLike = /^https?:\/\//i.test(raw) || (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw) && !raw.includes(' '));
  if (httpsLike) {
    return { appId: 'web-url', prefill: { url: ensureHttps(raw) } };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// URL SANITY — shared by the App Library's build validator (build-app.ts)
// and by AppConfigForm's live preview, so "we'll preview it" and "we'll add
// it" can never disagree again.
//
// M6-1 (2026-09-12): every transform above is deliberately FORGIVING — each
// one passes an unrecognised paste straight through so an operator's input
// is never silently dropped. That is right for a transform and wrong for a
// gate: `ensureHttps('not a valid url')` returns `https://not a valid url`,
// which used to sail into a zone behind a green Add button. These helpers
// are the gate the transforms were never meant to be.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parse a URL we'd be willing to put in front of an operator's screen —
 * `http:`/`https:` with a hostname that is actually a hostname. Returns null
 * for anything else (a `javascript:` URL, a bare sentence, a host with no
 * domain). This is NOT a security control — the WEBPAGE proxy and
 * `streaming-hosts.ts` own that — it is the "will this resolve to anything
 * at all" check.
 */
export function parseWebUrl(input: string): URL | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  // An IPv6 literal arrives bracketed; an IPv4 literal and `localhost` are
  // both legitimate on a district LAN, so neither needs a dotted domain.
  if (host.startsWith('[') || host === 'localhost') return parsed;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return parsed;
  // Everything else needs at least one dot with real labels either side —
  // that is what separates `example.com` from `not-a-valid-url`, and it is
  // the same shape `detectApp`'s catch-all above already requires.
  // (Unicode hosts arrive punycoded from `new URL`, so ASCII suffices.)
  const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
  return new RegExp(`^${LABEL}(?:\\.${LABEL})+$`).test(host) ? parsed : null;
}

/** True when `input` is a URL worth putting in an iframe. */
export function isUsableWebUrl(input: string): boolean {
  return parseWebUrl(input) !== null;
}

/**
 * Dot-boundary host match — exact host, or a subdomain of one. Same rule as
 * `streaming-hosts.isAllowedStreamingHost`, so `canva.com.evil.net` and
 * `notcanva.com` are both refused. A leading `www.` is ignored.
 */
export function hostIsOneOf(input: string, hosts: readonly string[]): boolean {
  const parsed = parseWebUrl(input);
  if (!parsed) return false;
  const h = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return hosts.some((allowed) => h === allowed || h.endsWith('.' + allowed));
}
