/**
 * image-url — pure helpers for the image URLs a website hands us.
 *
 * Why this file exists (2026-09-22, the Super Taco boards):
 *   The website reader picked a Wix BLUR PLACEHOLDER as the board's hero
 *   photo — `…/v1/fill/w_151,h_101,…,blur_2,…/photo.jpg`, 5,200 bytes, which
 *   the page LABELS 1805×670 — while the 2.6 MB original sat at the bare media
 *   URL with the resize segment removed. Every site builder does some version
 *   of this: the <img> a page ships is a thumbnail, a loading placeholder or a
 *   CDN rendition sized for a phone, never the file the owner uploaded.
 *
 * Three jobs, no I/O:
 *   - `parseSrcset` / `largestSrcsetCandidate` — read a srcset the way a
 *     browser does. Wix URLs carry commas INSIDE the URL (`w_35,h_35,al_c`), so
 *     the old `split(',')` cut every Wix candidate in half.
 *   - `isPlaceholderImageUrl` — a URL that can only ever be a loading stand-in.
 *   - `originalImageUrl` — CDN rendition → the original upload, for the builders
 *     and CDNs whose URL scheme says so. Unknown hosts come back untouched.
 *
 * None of these results is trusted on its own: the designer-asset resolver
 * (apps/api/src/ai/designer-assets.ts) still fetches through `safeFetch` and
 * decodes the REAL pixels before anything reaches a board.
 */

export interface SrcsetCandidate {
  url: string;
  /** `w` descriptor — the candidate's intrinsic width in px. */
  width?: number;
  /** `x` descriptor — pixel density. */
  density?: number;
}

const WS = /[\t\n\f\r ]/;

/**
 * Parse a `srcset` attribute with the HTML spec's tokenizer: a URL is a run of
 * non-whitespace (so it MAY contain commas), and a candidate ends at a comma
 * outside parentheses. Never throws; junk yields `[]`.
 */
export function parseSrcset(
  srcset: string | null | undefined,
): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = [];
  if (!srcset || typeof srcset !== 'string') return out;
  const s = srcset.length > 20_000 ? srcset.slice(0, 20_000) : srcset;
  const n = s.length;
  let i = 0;
  while (i < n) {
    while (i < n && (WS.test(s[i]) || s[i] === ',')) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && !WS.test(s[i])) i++;
    let url = s.slice(start, i);
    let descriptors: string[] = [];
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      let desc = '';
      let depth = 0;
      while (i < n) {
        const c = s[i];
        if (c === '(') depth++;
        else if (c === ')') depth = Math.max(0, depth - 1);
        else if (c === ',' && depth === 0) {
          i++;
          break;
        }
        desc += c;
        i++;
      }
      descriptors = desc.trim().split(/\s+/).filter(Boolean);
    }
    if (!url) continue;
    const cand: SrcsetCandidate = { url };
    for (const d of descriptors) {
      const m = /^(\d+(?:\.\d+)?)([wx])$/i.exec(d);
      if (!m) continue;
      const v = parseFloat(m[1]);
      if (!Number.isFinite(v) || v <= 0) continue;
      if (m[2].toLowerCase() === 'w') cand.width = Math.round(v);
      else cand.density = v;
    }
    out.push(cand);
  }
  return out;
}

/**
 * The biggest real candidate in a srcset — by `w` descriptor when the set has
 * them, otherwise by `x` density (a bare URL counts as 1x). Placeholders are
 * skipped, so a lazy-loader's 1×1 data URI never wins.
 */
export function largestSrcsetCandidate(
  srcset: string | null | undefined,
): SrcsetCandidate | null {
  const cands = parseSrcset(srcset).filter(
    (c) => !isPlaceholderImageUrl(c.url),
  );
  if (!cands.length) return null;
  const anyWidth = cands.some((c) => typeof c.width === 'number');
  let best: SrcsetCandidate | null = null;
  let bestKey = -Infinity;
  for (const c of cands) {
    const key = anyWidth ? (c.width ?? 0) : (c.density ?? 1);
    if (key > bestKey) {
      best = c;
      bestKey = key;
    }
  }
  return best;
}

/**
 * A URL that can only ever be a loading stand-in, never the real image:
 * data URIs, the lazy-loaders' blank/spacer/1×1 files, LQIP names, and the
 * blur transforms CDNs use for them (Wix `blur_N`, imgix/Contentful
 * `?blur=N`, Cloudinary `e_blur`). Tiny Wix renditions (`w_49,h_2`) count too.
 *
 * A Wix `blur_2` rendition is a placeholder, but a RECOVERABLE one — callers
 * run `originalImageUrl` first and test what comes back.
 */
const PLACEHOLDER_URL_RE = new RegExp(
  [
    '^data:',
    '(?:^|[/_.-])(?:blank|spacer|pixel|transparent|empty|grey|gray|1x1|lazy|lazyload|lazy-load|loading|loader|spinner)\\.(?:gif|png|svg|webp)(?:[?#]|$)',
    '(?:^|[/_.,-])(?:lqip|placeholder|placeholders)(?:[/_.,-]|$)',
    '[,/]blur_\\d',
    '[?&](?:blur|px)=\\d',
    '(?:^|[/,])e_blur(?::|[,/]|$)',
    '[/,]w_\\d{1,2},h_\\d{1,2}(?:[,/]|$)',
  ].join('|'),
  'i',
);

export function isPlaceholderImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return true;
  return PLACEHOLDER_URL_RE.test(url.trim());
}

// ── CDN rendition → original ─────────────────────────────────────────────

/** imgix-family hosts: every query param is a transform, the bare path is the upload. */
const IMGIX_LIKE_HOST =
  /(?:^|\.)(?:imgix\.net|images\.pexels\.com|images\.unsplash\.com|images\.getbento\.com|images\.ctfassets\.net|cdn\.sanity\.io)$/i;

/** Cloudinary transformation keys (`w_400`, `c_fill`, `q_auto:good`, `$var_1` …). */
const CLOUDINARY_PARAM =
  /^(?:w|h|c|g|x|y|q|f|e|r|a|o|b|bo|co|l|u|t|dpr|ar|fl|z|d|pg|dn|cs|if|so|eo|du|vc|ac|br|fps|sp|vs|ki|fn|\$[a-z0-9]+)_[^,/]*$/i;

function isCloudinaryTransformSegment(seg: string): boolean {
  if (!seg || /^v\d+$/.test(seg)) return false;
  return seg.split(',').every((p) => CLOUDINARY_PARAM.test(p));
}

const IMAGE_EXT = '(?:jpe?g|png|gif|webp|avif)';

/**
 * Shopify legacy size suffix on the filename: `_400x`, `_x400`,
 * `_400x400_crop_center@2x`, `_grande`, and the theme template `_{width}x`
 * (which `new URL()` percent-encodes to `_%7Bwidth%7Dx`).
 */
const OB = '(?:\\{|%7B)';
const CB = '(?:\\}|%7D)';
const SHOPIFY_SIZE_SUFFIX = new RegExp(
  `_(?:\\d+x\\d*|x\\d+|${OB}width${CB}x(?:${OB}height${CB})?|pico|icon|thumb|small|compact|medium|large|grande|original|master)(?:_crop_[a-z]+)?(?:@\\d+x)?(?=\\.${IMAGE_EXT}$)`,
  'i',
);

/** WordPress intermediate size: `hero-1024x683.jpg` → `hero.jpg`. */
const WP_SIZE_SUFFIX = new RegExp(
  `-\\d{2,5}x\\d{2,5}(?=\\.${IMAGE_EXT}$)`,
  'i',
);

/** Webflow responsive variant: `hero-p-800.jpeg` → `hero.jpeg`. */
const WEBFLOW_VARIANT = new RegExp(`-p-\\d{3,4}(?=\\.${IMAGE_EXT}$)`, 'i');

function httpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/**
 * The ORIGINAL upload behind a CDN rendition URL, or `raw` unchanged when the
 * host is unknown / the URL is already the original / it is not http(s).
 *
 * Covered: Wix (`/v1/fill|fit|crop/…`), Squarespace (`?format=Nw`), Shopify
 * (`_WxH` / `_{size}x` suffixes, `?width=`), WordPress (`-WxH.ext`, and a
 * Jetpack `i0.wp.com` wrapper), Cloudinary (transformation segments, `fetch/`
 * wrappers), imgix and the imgix-backed CDNs (Pexels, Unsplash, BentoBox,
 * Contentful, Sanity — every query param is a transform), Webflow (`-p-800`),
 * GoDaddy Websites (`/:/rs=…`), Cloudflare Image Resizing (`/cdn-cgi/image/…`)
 * and the Next.js optimizer (`/_next/image?url=`).
 *
 * The result can point at a DIFFERENT host (the unwrap cases). That is no new
 * capability — the page could already reference any URL — and every caller
 * fetches through `safeFetch`, which re-validates the destination.
 */
export function originalImageUrl(raw: string): string {
  if (typeof raw !== 'string' || !raw) return raw;
  const u = httpUrl(raw.trim());
  if (!u) return raw;
  return originalFrom(u, 0) ?? raw;
}

function originalFrom(u: URL, depth: number): string | null {
  if (depth > 3) return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  const unwrap = (inner: string): string | null => {
    const next = httpUrl(inner);
    if (!next) return null;
    return originalFrom(next, depth + 1) ?? next.toString();
  };

  // Next.js image optimizer — the source rides in `url`, relative or absolute.
  if (/\/_next\/image\/?$/.test(path)) {
    const inner = u.searchParams.get('url');
    if (!inner) return null;
    try {
      return unwrap(new URL(inner, u.origin).toString());
    } catch {
      return null;
    }
  }

  // Cloudflare Image Resizing — `/cdn-cgi/image/<options>/<source>`.
  const cf = /^\/cdn-cgi\/image\/[^/]+\/(.+)$/.exec(path);
  if (cf) {
    const rest = cf[1];
    return /^https?:\/\//i.test(rest)
      ? unwrap(rest)
      : unwrap(`${u.origin}/${rest}`);
  }

  // Jetpack Photon — `i0.wp.com/<origin-host>/<path>` mirrors the origin's file.
  if (/^i[0-3]\.wp\.com$/.test(host)) {
    const m = /^\/([a-z0-9.-]+\.[a-z]{2,})\/(.+)$/i.exec(path);
    return m ? unwrap(`https://${m[1]}/${m[2]}`) : null;
  }

  // Wix — `/media/<id>/v1/<fill|fit|crop>/…/<name>` → `/media/<id>`.
  if (host === 'static.wixstatic.com' || host.endsWith('.wixstatic.com')) {
    const m = /^(\/media\/[^/]+)\/v1\/(?:fill|fit|crop)\//i.exec(path);
    return m ? `${u.protocol}//${u.host}${m[1]}` : null;
  }

  // Squarespace — `?format=500w` picks a rendition; no param is the original.
  if (
    /(?:^|\.)(?:squarespace-cdn\.com|squarespace\.com|sqspcdn\.com)$/.test(host)
  ) {
    if (!u.searchParams.has('format')) return null;
    const out = new URL(u.toString());
    out.searchParams.delete('format');
    return out.toString();
  }

  // Cloudinary — drop transformation segments; `fetch/` wraps a remote URL.
  // (Host-specific branches run BEFORE the path-pattern ones below: a
  // Cloudinary `fetch/` of a WordPress image has `/wp-content/uploads/` in
  // its OWN path.)
  if (host === 'res.cloudinary.com' || host.endsWith('.cloudinary.com')) {
    const fetchMode = /^\/[^/]+\/image\/fetch\/(.+)$/i.exec(path);
    if (fetchMode) {
      const segs = fetchMode[1].split('/');
      const at = segs.findIndex((s) =>
        /^https?:/i.test(decodeURIComponentSafe(s)),
      );
      if (at < 0) return null;
      return unwrap(
        decodeURIComponentSafe(segs.slice(at).join('/')).replace(
          /^(https?):\/(?!\/)/i,
          '$1://',
        ),
      );
    }
    const m =
      /^(\/[^/]+\/(?:image|video)\/(?:upload|private|authenticated))\/(.+)$/i.exec(
        path,
      );
    if (!m) return null;
    const segs = m[2].split('/');
    const versionAt = segs.findIndex((s) => /^v\d+$/.test(s));
    let keepFrom = 0;
    if (versionAt >= 0) keepFrom = versionAt;
    else
      while (
        keepFrom < segs.length - 1 &&
        isCloudinaryTransformSegment(segs[keepFrom])
      )
        keepFrom++;
    if (keepFrom === 0) return null;
    return `${u.protocol}//${u.host}${m[1]}/${segs.slice(keepFrom).join('/')}`;
  }

  // imgix and the CDNs built on it — every param is a transform. A signed URL
  // (`s=`) breaks if touched, so it is left as it is.
  if (IMGIX_LIKE_HOST.test(host)) {
    if (!u.search || u.searchParams.has('s')) return null;
    return `${u.protocol}//${u.host}${path}`;
  }

  // Webflow — `-p-500` / `-p-800` … are responsive variants of one upload.
  if (/(?:^|\.)(?:website-files\.com|webflow\.com)$/.test(host)) {
    const stripped = path.replace(WEBFLOW_VARIANT, '');
    return stripped !== path
      ? `${u.protocol}//${u.host}${stripped}${u.search}`
      : null;
  }

  // GoDaddy Websites + Marketing — everything after `/:/` is a transform.
  if (host === 'img1.wsimg.com' || host.endsWith('.wsimg.com')) {
    const at = path.indexOf('/:/');
    return at > 0 ? `${u.protocol}//${u.host}${path.slice(0, at)}` : null;
  }

  // ── Path patterns (any host) ──

  // Shopify — cdn.shopify.com, a store's own `/cdn/shop/…`, or `/s/files/…`.
  if (
    host === 'cdn.shopify.com' ||
    /\/cdn\/shop\//.test(path) ||
    /^\/s\/files\//.test(path)
  ) {
    const out = new URL(u.toString());
    const segs = out.pathname.split('/');
    const last = segs.pop() || '';
    segs.push(last.replace(SHOPIFY_SIZE_SUFFIX, ''));
    out.pathname = segs.join('/');
    for (const p of ['width', 'height', 'crop', 'pad_color'])
      out.searchParams.delete(p);
    const s = out.toString();
    return s !== u.toString() ? s : null;
  }

  // WordPress media library — `-1024x683.jpg` is a generated intermediate size.
  if (/\/wp-content\/uploads\//i.test(path)) {
    const out = new URL(u.toString());
    out.pathname = out.pathname.replace(WP_SIZE_SUFFIX, '');
    for (const p of ['resize', 'fit', 'w', 'h']) out.searchParams.delete(p);
    const s = out.toString();
    return s !== u.toString() ? s : null;
  }

  return null;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * A Pexels photo at a requested width: the ORIGINAL file plus Pexels' own
 * documented resize params (`?auto=compress&cs=tinysrgb&w=N` — the same shape
 * its `src.*` renditions use). `large2x` is only ~1880 px wide, which a 4K
 * board stretches 2×. Returns null for anything that is not a Pexels image URL.
 */
export function pexelsPhotoAtWidth(url: string, width: number): string | null {
  const u = httpUrl(url);
  if (
    !u ||
    u.hostname.toLowerCase() !== 'images.pexels.com' ||
    u.protocol !== 'https:'
  )
    return null;
  const w = Math.max(320, Math.min(6000, Math.round(width || 0)));
  return `https://images.pexels.com${u.pathname}?auto=compress&cs=tinysrgb&w=${w}`;
}
