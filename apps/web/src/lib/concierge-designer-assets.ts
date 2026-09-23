/**
 * concierge-designer-assets — which logo and photo a Concierge generation hands
 * the AI Designer, and whose they are (2026-09-23, the Codex-parity wave).
 *
 * One conversation can gather several references: the website the operator
 * pasted (its logo, and its own photo — or a STOCK photo when the site had no
 * usable one), a logo they uploaded, a photo of their food they uploaded…
 * Every image the API returns was checked and copied to our bucket, and says
 * where it came from (`logoSource` / `imageSource`). The templates page used to
 * take the FIRST reference with a logo and the FIRST with a photo, so a site's
 * stock photo beat the operator's own uploaded photo whenever the URL was
 * pasted first.
 *
 * `pickConciergeDesignerAssets` — the operator's own image always wins:
 *   photo: upload > POS > site > (no provenance — an older reference) > stock
 *   logo:  upload > site > (no provenance)
 * Ties go to the earlier reference. The winner's provenance rides along
 * (`logoSource` / `heroImageSource` on the generate request), so the Designer's
 * Logo: / Photo: lines can say whose image it is — a stock photo is never
 * captioned as the venue's own. Only known source values are ever sent.
 *
 * `conciergeUrlReferenceBody` — the body `POST concierge/reference/url` sends:
 * the URL plus the canvas being designed, so the reference's photo is checked
 * and sized for THAT board (a 960×1080 LED poster, a portrait kiosk…) instead
 * of the Designer's 3840×2160 default.
 *
 * Pure; unit-tested in __tests__/concierge-designer-assets.test.ts over
 * references cut from the API's own producers.
 */
import type { ConciergeReference } from '@cms/api-types';

export type DesignerPhotoSource = 'upload' | 'pos' | 'site' | 'stock';
export type DesignerLogoSource = 'upload' | 'site';

/** The logo / photo fields of a generate-designer request. */
export interface ConciergeDesignerAssets {
  logoUrl?: string;
  logoSource?: DesignerLogoSource;
  heroImageUrl?: string;
  heroImageSource?: DesignerPhotoSource;
}

const PHOTO_RANK: Record<DesignerPhotoSource, number> = { upload: 0, pos: 1, site: 2, stock: 4 };
/** A photo with no provenance (a reference from before 2026-09-23): below the site's own, above stock. */
const UNMARKED_PHOTO_RANK = 3;
const LOGO_RANK: Record<DesignerLogoSource, number> = { upload: 0, site: 1 };
const UNMARKED_LOGO_RANK = 2;

function photoSource(v: unknown): DesignerPhotoSource | undefined {
  return v === 'upload' || v === 'pos' || v === 'site' || v === 'stock' ? v : undefined;
}

function logoSource(v: unknown): DesignerLogoSource | undefined {
  return v === 'upload' || v === 'site' ? v : undefined;
}

/** An absolute http(s) URL the generate request will accept (its schema is `z.string().url().max(2000)`). */
function usableUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const u = v.trim();
  if (!u || u.length > 2000) return undefined;
  try {
    const { protocol } = new URL(u);
    return protocol === 'https:' || protocol === 'http:' ? u : undefined;
  } catch {
    return undefined;
  }
}

/** The logo and photo the Designer should build around, ranked by whose they are (see the header). */
export function pickConciergeDesignerAssets(
  refs: ReadonlyArray<ConciergeReference> | null | undefined,
): ConciergeDesignerAssets {
  let logo: { url: string; source?: DesignerLogoSource; rank: number } | null = null;
  let photo: { url: string; source?: DesignerPhotoSource; rank: number } | null = null;
  for (const ref of refs || []) {
    if (!ref || typeof ref !== 'object') continue;
    const logoUrl = usableUrl(ref.logoUrl);
    if (logoUrl) {
      const source = logoSource(ref.logoSource);
      const rank = source ? LOGO_RANK[source] : UNMARKED_LOGO_RANK;
      if (!logo || rank < logo.rank) logo = { url: logoUrl, source, rank };
    }
    const imageUrl = usableUrl(ref.imageUrl);
    if (imageUrl) {
      const source = photoSource(ref.imageSource);
      const rank = source ? PHOTO_RANK[source] : UNMARKED_PHOTO_RANK;
      if (!photo || rank < photo.rank) photo = { url: imageUrl, source, rank };
    }
  }
  return {
    ...(logo ? { logoUrl: logo.url, ...(logo.source ? { logoSource: logo.source } : {}) } : {}),
    ...(photo ? { heroImageUrl: photo.url, ...(photo.source ? { heroImageSource: photo.source } : {}) } : {}),
  };
}

/** The largest canvas side the Designer accepts (DesignerGenerateSchema). */
const MAX_CANVAS_SIDE = 8192;

/**
 * `{ url }` plus the canvas being designed, when it is a real one. A missing or
 * nonsensical canvas is simply left out — the API then sizes for 3840×2160, as
 * it always has.
 */
export function conciergeUrlReferenceBody(
  url: string,
  canvas?: { w?: unknown; h?: unknown } | null,
): { url: string; screenWidth?: number; screenHeight?: number } {
  const side = (v: unknown): number | null => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const n = Math.round(v);
    return n >= 1 && n <= MAX_CANVAS_SIDE ? n : null;
  };
  const w = side(canvas?.w);
  const h = side(canvas?.h);
  return w != null && h != null ? { url, screenWidth: w, screenHeight: h } : { url };
}
