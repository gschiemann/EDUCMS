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
