/**
 * designer-renderer.client.ts — the API side of the board renderer
 * (apps/renderer, a private Railway service; 2026-09-23, Codex finding 3).
 *
 * One job: turn a clean AI board into `{ image, metrics }` so the Designer can
 * LOOK at what it drew — or say, in plain words, why it could not. It never
 * throws and it never fails a generation: every renderer outcome that is not a
 * 200 with our contract version (429 busy, 504 too slow, 5xx, a network error,
 * a body too big, an answer from a different contract) is `{ ok: false,
 * reason }`, and the caller skips the review for that board.
 *
 * What it sends is what a screen gets (designer-render-document.ts) with every
 * image inlined as a `data:` URI first — the renderer has no network. Images
 * are fetched through `safeFetch` ONLY from our own public storage
 * (`${SUPABASE_URL}/storage/v1/object/public/…` — where designer-assets.ts
 * re-hosts every logo and photo a board is given, and where the branding and
 * stock re-hosts land). Any other URL is never fetched: it goes to the renderer
 * as written, the renderer blocks and reports it, and the review calls it a
 * defect (an image the board was not given). A trusted image that is too big
 * or does not arrive is left as written too, and reported as SKIPPED so it is
 * never mistaken for the board's fault.
 *
 * Config (the only environment this module reads):
 *   RENDERER_URL               where the renderer listens (private network).
 *                              Unset ⇒ no render, no review: generation is
 *                              exactly what it was before this existed.
 *   AI_DESIGN_REVIEW_DISABLED  1/true/yes ⇒ the same, without a deploy — the
 *                              subtractive kill switch. It also stops the logo
 *                              and photo being attached to the draw.
 *   SUPABASE_URL               the one image origin trusted for inlining.
 */
import { Logger } from '@nestjs/common';
import { safeFetch } from '../branding/safe-fetch';
import { assembleDesignerRenderDocument } from './designer-render-document';
import {
  RENDER_CONTRACT_VERSION,
  RENDER_LIMITS,
  type RenderErrorBody,
  type RenderRequest,
  type RenderResponse,
} from './renderer-contract';

/** Caps on what a render request may carry, measured on the `data:` URIs as SENT (base64). */
export const RENDER_IMAGE_CAPS = {
  /** One image. */
  perImageChars: 1_536 * 1024,
  /** Every image in one board together — the body cap is 4 MB and the document needs room too. */
  totalChars: 3_584 * 1024,
} as const;

/** The POST to the renderer: queue wait + a 30 s render + encode. */
export const RENDERER_TIMEOUT_MS = 35_000;
/** One image fetch from our storage (hard deadline over safeFetch's idle timer). */
export const IMAGE_FETCH_TIMEOUT_MS = 8_000;

/** Raster types every vendor we send image parts to accepts. */
const MODEL_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type Env = Record<string, string | undefined>;

export interface RendererClientDeps {
  /** The POST to the renderer (a private, operator-configured URL — never user input). */
  fetch?: typeof fetch;
  /** Image fetches (SSRF-guarded). Defaults to `safeFetch`. */
  safeFetch?: typeof safeFetch;
  env?: Env;
  log?: (msg: string) => void;
}

export interface InlinedImages {
  html: string;
  inlined: Array<{ url: string; chars: number }>;
  /** Trusted images that were NOT inlined (too big, did not arrive) — not the board's fault. */
  skipped: Array<{ url: string; reason: string }>;
  /** Images the board points at that are not ours — never fetched, the renderer will block them. */
  untrusted: string[];
}

export type RenderOutcome =
  | {
      ok: true;
      response: RenderResponse;
      /** Trusted images left as written (see InlinedImages.skipped). */
      skippedImages: Array<{ url: string; reason: string }>;
      requestChars: number;
      ms: number;
    }
  | { ok: false; reason: string; status?: number; ms: number };

/** One fetch per image URL per batch (three boards share one logo). */
export type TrustedImageResult =
  | { ok: true; mediaType: string; base64: string }
  | { ok: false; reason: string };
export type RendererImageCache = Map<string, Promise<TrustedImageResult>>;

export interface ModelImage {
  mediaType: string;
  base64: string;
}

export function designerReviewKillSwitchOn(env: Env = process.env): boolean {
  const v = String(env.AI_DESIGN_REVIEW_DISABLED || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** The renderer's base URL, or null when the review is off (unset, not http(s), or the kill switch). */
export function rendererBaseUrl(env: Env = process.env): string | null {
  if (designerReviewKillSwitchOn(env)) return null;
  const raw = String(env.RENDERER_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return raw;
}

/** The one image origin we fetch from: our public storage. Null when SUPABASE_URL is unset. */
export function trustedImagePrefix(env: Env = process.env): string | null {
  const base = String(env.SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/i.test(base)) return null;
  return `${base}/storage/v1/object/public/`;
}

export function isTrustedImageUrl(
  url: string | null | undefined,
  env: Env = process.env,
): boolean {
  const prefix = trustedImagePrefix(env);
  if (!prefix || typeof url !== 'string') return false;
  // No traversal out of the public tree (URL parsing normalises `..`).
  try {
    return new URL(url).href.startsWith(prefix) && url.startsWith(prefix);
  } catch {
    return false;
  }
}

const decodeAttr = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/** Every image reference in a board: `<img src>` and CSS `url(…)`, as written (raw) and decoded. */
export function boardImageRefs(
  html: string,
): Array<{ raw: string; url: string }> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(
    /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
  )) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (raw) out.set(raw, decodeAttr(raw));
  }
  for (const m of html.matchAll(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi,
  )) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (raw) out.set(raw, decodeAttr(raw));
  }
  return [...out.entries()]
    .filter(([, url]) => !/^data:/i.test(url))
    .map(([raw, url]) => ({ raw, url }));
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * The board renderer's API client. Stateless apart from its deps; one per
 * process (AiModule) or one per spec.
 */
export class DesignerRendererClient {
  private readonly logger = new Logger('DesignerRenderer');

  constructor(private readonly deps: RendererClientDeps = {}) {}

  private get env(): Env {
    return this.deps.env ?? process.env;
  }

  private log(msg: string): void {
    if (this.deps.log) this.deps.log(msg);
    else this.logger.warn(msg);
  }

  /** Render + review are on: a renderer is configured and the kill switch is off. */
  enabled(): boolean {
    return rendererBaseUrl(this.env) !== null;
  }

  /** Image parts may be attached to model calls (the same kill switch). */
  imagesEnabled(): boolean {
    return !designerReviewKillSwitchOn(this.env);
  }

  /**
   * One trusted image's bytes, or why not. NEVER fetches an untrusted URL.
   * `maxChars` bounds the base64 it may produce.
   */
  async fetchTrustedImage(
    url: string,
    maxChars: number = RENDER_IMAGE_CAPS.perImageChars,
  ): Promise<TrustedImageResult> {
    if (!isTrustedImageUrl(url, this.env))
      return { ok: false, reason: 'untrusted-host' };
    const maxBytes = Math.floor((maxChars * 3) / 4);
    try {
      const res = await withDeadline(
        (this.deps.safeFetch ?? safeFetch)(url, {
          maxBytes,
          timeoutMs: IMAGE_FETCH_TIMEOUT_MS,
          accept: 'image/*',
        }),
        IMAGE_FETCH_TIMEOUT_MS + 2_000,
      );
      if (res.status < 200 || res.status >= 300)
        return { ok: false, reason: `HTTP ${res.status}` };
      // A redirect off our storage is not our image.
      if (res.finalUrl && !isTrustedImageUrl(res.finalUrl, this.env))
        return { ok: false, reason: 'redirected-off-origin' };
      const mediaType = String(res.contentType || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (!mediaType.startsWith('image/'))
        return {
          ok: false,
          reason: `not an image (${mediaType || 'no type'})`,
        };
      if (!res.body || !res.body.length) return { ok: false, reason: 'empty' };
      const base64 = res.body.toString('base64');
      if (base64.length > maxChars) return { ok: false, reason: 'too-large' };
      return { ok: true, mediaType, base64 };
    } catch (e: any) {
      const name = String(e?.name || '');
      if (name === 'FetchTooLargeError')
        return { ok: false, reason: 'too-large' };
      return {
        ok: false,
        reason:
          e?.message === 'timeout'
            ? 'timeout'
            : `fetch-failed (${name || 'error'})`,
      };
    }
  }

  /**
   * Images for a MODEL call (the logo and photo a board is drawn around):
   * trusted, raster, under the per-image cap — anything else is simply not
   * attached (the prompt still names its URL). Never throws.
   */
  async loadModelImage(
    url: string | null | undefined,
  ): Promise<ModelImage | null> {
    if (!url || !this.imagesEnabled() || !isTrustedImageUrl(url, this.env))
      return null;
    const got = await this.fetchTrustedImage(url);
    if (!got.ok) {
      this.log(
        `designer images: ${url.slice(0, 120)} not attached (${got.reason})`,
      );
      return null;
    }
    if (!MODEL_IMAGE_TYPES.has(got.mediaType)) return null;
    return { mediaType: got.mediaType, base64: got.base64 };
  }

  /**
   * Inline every image a board references that we trust, within the caps.
   * `cache` (per batch) lets three boards share one fetch of the same logo.
   */
  async inlineBoardImages(
    html: string,
    cache: RendererImageCache = new Map(),
  ): Promise<InlinedImages> {
    const inlined: InlinedImages['inlined'] = [];
    const skipped: InlinedImages['skipped'] = [];
    const untrusted: string[] = [];
    let total = 0;
    let out = html;
    for (const ref of boardImageRefs(html)) {
      if (!isTrustedImageUrl(ref.url, this.env)) {
        untrusted.push(ref.url);
        continue;
      }
      let pending = cache.get(ref.url);
      if (!pending) {
        pending = this.fetchTrustedImage(ref.url);
        cache.set(ref.url, pending);
      }
      const got = await pending;
      if (!got.ok) {
        skipped.push({ url: ref.url, reason: got.reason });
        continue;
      }
      const dataUri = `data:${got.mediaType};base64,${got.base64}`;
      if (total + dataUri.length > RENDER_IMAGE_CAPS.totalChars) {
        skipped.push({ url: ref.url, reason: 'total-cap' });
        continue;
      }
      total += dataUri.length;
      out = out.split(ref.raw).join(dataUri);
      inlined.push({ url: ref.url, chars: dataUri.length });
    }
    return { html: out, inlined, skipped, untrusted };
  }

  /**
   * Render one clean board as a screen shows it. NEVER throws; every failure is
   * `{ ok: false, reason }` and the caller skips the review.
   */
  async render(
    boardHtml: string,
    canvas: { width: number; height: number },
    imageCache?: RendererImageCache,
  ): Promise<RenderOutcome> {
    const started = Date.now();
    const ms = () => Date.now() - started;
    const base = rendererBaseUrl(this.env);
    if (!base) return { ok: false, reason: 'renderer-off', ms: ms() };
    let body: string;
    let skippedImages: InlinedImages['skipped'] = [];
    try {
      const images = await this.inlineBoardImages(boardHtml, imageCache);
      skippedImages = images.skipped;
      const request: RenderRequest = {
        html: assembleDesignerRenderDocument(
          images.html,
          canvas.width,
          canvas.height,
        ),
        canvasWidth: Math.round(canvas.width),
        canvasHeight: Math.round(canvas.height),
      };
      body = JSON.stringify(request);
    } catch (e: any) {
      return {
        ok: false,
        reason: `assemble-failed (${String(e?.message || e).slice(0, 80)})`,
        ms: ms(),
      };
    }
    if (Buffer.byteLength(body) > RENDER_LIMITS.maxBodyBytes) {
      return { ok: false, reason: 'body-too-large', ms: ms() };
    }
    let res: Response;
    try {
      res = await (this.deps.fetch ?? fetch)(`${base}/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(RENDERER_TIMEOUT_MS),
      });
    } catch (e: any) {
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      return {
        ok: false,
        reason: timedOut
          ? 'timeout'
          : `unreachable (${String(e?.cause?.code || e?.name || 'error')})`,
        ms: ms(),
      };
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return {
        ok: false,
        status: res.status,
        reason: `HTTP ${res.status} (unreadable body)`,
        ms: ms(),
      };
    }
    if (!res.ok) {
      const code = (json as Partial<RenderErrorBody> | null)?.error;
      return {
        ok: false,
        status: res.status,
        reason: `HTTP ${res.status}${code ? ` ${code}` : ''}`,
        ms: ms(),
      };
    }
    const r = json as Partial<RenderResponse> | null;
    if (!r || r.contractVersion !== RENDER_CONTRACT_VERSION) {
      return {
        ok: false,
        status: res.status,
        reason: `contract-version ${String(r?.contractVersion)} (expected ${RENDER_CONTRACT_VERSION})`,
        ms: ms(),
      };
    }
    if (
      typeof r.image !== 'string' ||
      !r.image ||
      !r.metrics ||
      typeof r.metrics !== 'object'
    ) {
      return {
        ok: false,
        status: res.status,
        reason: 'malformed-response',
        ms: ms(),
      };
    }
    return {
      ok: true,
      response: r as RenderResponse,
      skippedImages,
      requestChars: body.length,
      ms: ms(),
    };
  }
}
