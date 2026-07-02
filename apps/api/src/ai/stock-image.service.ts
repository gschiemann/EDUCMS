/**
 * StockImageService — FREE stock photography for AI signage boards (Pexels).
 *
 * THE IMAGERY-WAVE THESIS (docs/research/2026-06-28-signage-concierge):
 *   Today every generated board is a gradient — photos are gated to OpenAI /
 *   Google BYOK, and the platform/Concierge key is Anthropic, so the DEFAULT
 *   experience for nearly every tenant is gradient-forever. This service makes a
 *   real, relevant, gorgeous STOCK photo the DEFAULT for $0 — for EVERY tenant,
 *   regardless of AI provider — with a one-tap "upgrade to an AI photo" option
 *   layered on top (generateBoardBackground, unchanged).
 *
 * GRACEFUL-DEGRADATION CONTRACT (load-bearing):
 *   - `search()` returns `null` when `PEXELS_API_KEY` is unset OR on ANY error
 *     (network, non-2xx, no results, parse failure, timeout). It NEVER throws.
 *     A null result leaves the board on its themed gradient — exactly today's
 *     behaviour, zero regression. With no key the whole feature is invisible.
 *
 * SECURITY:
 *   - The key goes in the `Authorization` HEADER, never the URL, and is NEVER
 *     logged. The only outbound host is the fixed Pexels API host.
 *   - Every fetch carries an AbortSignal timeout (~6s) so a slow provider can
 *     never block board generation.
 *   - The returned image URL is a Pexels CDN URL; the persist path re-hosts it
 *     into our own Supabase bucket (templates.controller createFromCandidate),
 *     and that re-host is itself SSRF-guarded + host-allowlisted.
 *
 * No SDK, no new dependency — plain `fetch` against the documented REST API.
 */

import { Injectable, Logger } from '@nestjs/common';

/** The trusted Pexels image CDN host — the persist path allowlists exactly this
 *  host before it will re-host a stock URL into our bucket. Exported so the
 *  controller + its test share ONE source of truth. */
export const PEXELS_IMAGE_HOST = 'images.pexels.com';

/** The Pexels search API endpoint (host is fixed; the key rides a header). */
const PEXELS_SEARCH_URL = 'https://api.pexels.com/v1/search';

/** Per-request timeout. Board generation already takes ~10-20s on the LLM;
 *  the stock fetch runs in parallel and must never extend that — short cap. */
const STOCK_TIMEOUT_MS = 6000;

export interface StockImageResult {
  /** The best high-res image URL for the requested orientation. */
  url: string;
  /** A smaller URL for thumbnails/previews when available. */
  thumbUrl?: string;
  /** Attribution — the photographer's name (Pexels requires attribution). */
  photographer?: string;
  /** The Pexels photo page (for an attribution link). */
  sourceUrl?: string;
}

export interface StockSearchOptions {
  /** Bias the result toward a landscape or portrait composition. */
  orientation?: 'landscape' | 'portrait';
}

@Injectable()
export class StockImageService {
  private readonly logger = new Logger('StockImageService');

  /** True when a Pexels key is configured — the feature is otherwise invisible. */
  isConfigured(): boolean {
    return !!(process.env.PEXELS_API_KEY || '').trim();
  }

  /**
   * Search Pexels for the single best stock photo matching `query`. Returns the
   * highest-fidelity URL for the requested orientation, or `null` when no key is
   * set / no result / any error. NEVER throws.
   */
  async search(
    query: string,
    opts?: StockSearchOptions,
  ): Promise<StockImageResult | null> {
    const key = (process.env.PEXELS_API_KEY || '').trim();
    if (!key) return null; // feature off — board keeps its gradient

    const q = (query || '').trim();
    if (!q) return null;

    const orientation = opts?.orientation === 'portrait' ? 'portrait' : 'landscape';
    // per_page=10 + size=large biases toward usable hero shots; we pick #1.
    const params = new URLSearchParams({
      query: q.slice(0, 200),
      per_page: '10',
      page: '1',
      orientation,
      size: 'large',
    });

    try {
      const res = await fetch(`${PEXELS_SEARCH_URL}?${params.toString()}`, {
        method: 'GET',
        // The key rides the Authorization header — NEVER the URL (it would leak
        // into logs / referrers). Pexels uses the bare key (no "Bearer ").
        headers: { Authorization: key, Accept: 'application/json' },
        signal: AbortSignal.timeout(STOCK_TIMEOUT_MS),
      });
      if (!res.ok) {
        // 401 (bad key) / 429 (rate-limited) / 5xx — degrade to gradient, never
        // surface to the operator. Log the STATUS only — never the key/body.
        this.logger.warn(`Pexels search HTTP ${res.status} — falling back to gradient.`);
        return null;
      }
      const json: any = await res.json();
      return pickBestPhoto(json, orientation);
    } catch (e: any) {
      // Timeout / network / parse — swallow EVERYTHING; the board ships on its
      // gradient. Never include the key in any message.
      this.logger.warn(`Pexels search failed: ${e?.name || e?.message || 'error'}`);
      return null;
    }
  }

  /**
   * Search Pexels for UP TO `limit` results — the in-editor "Stock photos"
   * tab (Wave B / editor-crush B1) needs a grid, not just the single best
   * pick `search()` returns. Same graceful-degradation contract: no key /
   * empty query / no results / any error → `[]`, NEVER throws.
   */
  async searchMany(
    query: string,
    opts?: StockSearchOptions & { limit?: number },
  ): Promise<StockImageResult[]> {
    const key = (process.env.PEXELS_API_KEY || '').trim();
    if (!key) return [];

    const q = (query || '').trim();
    if (!q) return [];

    const orientation = opts?.orientation === 'portrait' ? 'portrait' : 'landscape';
    const limit = Math.max(1, Math.min(24, opts?.limit ?? 12));
    const params = new URLSearchParams({
      query: q.slice(0, 200),
      per_page: String(limit),
      page: '1',
      orientation,
      size: 'large',
    });

    try {
      const res = await fetch(`${PEXELS_SEARCH_URL}?${params.toString()}`, {
        method: 'GET',
        headers: { Authorization: key, Accept: 'application/json' },
        signal: AbortSignal.timeout(STOCK_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Pexels search HTTP ${res.status} — falling back to gradient.`);
        return [];
      }
      const json: any = await res.json();
      return pickPhotos(json, orientation);
    } catch (e: any) {
      this.logger.warn(`Pexels search failed: ${e?.name || e?.message || 'error'}`);
      return [];
    }
  }
}

/**
 * Pick the best landscape/portrait high-res URL from a Pexels search payload.
 * Defensive against any shape drift — returns null on anything unexpected.
 *
 * Pexels `src` keys (largest → smallest): original, large2x (~1880w), large
 * (~940w), landscape (1200×627), portrait (800×1200), medium, small, tiny.
 * For a 4K board we want the biggest reasonable URL: prefer `large2x`, then the
 * orientation-cropped `landscape`/`portrait`, then `large`, then `original`.
 */
export function pickBestPhoto(
  json: any,
  orientation: 'landscape' | 'portrait',
): StockImageResult | null {
  const photos = json && Array.isArray(json.photos) ? json.photos : null;
  if (!photos || !photos.length) return null;
  return extractPhoto(photos[0], orientation);
}

/**
 * Extract EVERY usable photo from a Pexels search payload (Wave B in-editor
 * grid — B1). Same defensive shape-checking as `pickBestPhoto`; entries with
 * no usable src URL are silently dropped rather than aborting the whole list.
 */
export function pickPhotos(
  json: any,
  orientation: 'landscape' | 'portrait',
): StockImageResult[] {
  const photos = json && Array.isArray(json.photos) ? json.photos : null;
  if (!photos || !photos.length) return [];
  const out: StockImageResult[] = [];
  for (const p of photos) {
    const r = extractPhoto(p, orientation);
    if (r) out.push(r);
  }
  return out;
}

/** Shared single-photo extractor used by both `pickBestPhoto` and `pickPhotos`. */
function extractPhoto(
  photo: any,
  orientation: 'landscape' | 'portrait',
): StockImageResult | null {
  const src = photo && typeof photo.src === 'object' ? photo.src : null;
  if (!src) return null;

  const orientationCrop = orientation === 'portrait' ? src.portrait : src.landscape;
  const url: string | undefined =
    asHttps(src.large2x) ||
    asHttps(orientationCrop) ||
    asHttps(src.large) ||
    asHttps(src.original) ||
    asHttps(src.medium);
  if (!url) return null;

  const result: StockImageResult = { url };
  const thumb = asHttps(src.medium) || asHttps(src.small) || asHttps(src.tiny);
  if (thumb) result.thumbUrl = thumb;
  if (typeof photo.photographer === 'string' && photo.photographer.trim()) {
    result.photographer = photo.photographer.trim().slice(0, 120);
  }
  if (typeof photo.url === 'string' && /^https:\/\//i.test(photo.url)) {
    result.sourceUrl = photo.url;
  }
  return result;
}

/** Accept only a real https URL; everything else → undefined. */
function asHttps(v: any): string | undefined {
  return typeof v === 'string' && /^https:\/\//i.test(v) ? v : undefined;
}
