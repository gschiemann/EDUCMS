/**
 * isRehostableStockUrl — IMAGERY wave (2026-06-28) re-host SSRF allowlist.
 *
 * The persist path only ever re-hosts (fetches + mirrors into our Supabase
 * bucket) a stock URL we ourselves resolved from the trusted Pexels CDN. This
 * pins that gate: TRUE only for an https URL on the EXACT Pexels image host;
 * everything else (other hosts, http, data:, already-rehosted Supabase URLs,
 * suffix-trickery, garbage) is left untouched so it's never fetched.
 */

import { isRehostableStockUrl } from './templates.controller';
import { PEXELS_IMAGE_HOST } from '../ai/stock-image.service';

describe('isRehostableStockUrl (rehost allowlist)', () => {
  it('accepts an https URL on the trusted Pexels image host', () => {
    expect(isRehostableStockUrl(`https://${PEXELS_IMAGE_HOST}/photos/1/x.jpg`)).toBe(true);
    expect(isRehostableStockUrl('https://images.pexels.com/photos/2/large2x.jpeg')).toBe(true);
  });

  it('rejects http (non-https) even on the trusted host', () => {
    expect(isRehostableStockUrl(`http://${PEXELS_IMAGE_HOST}/photos/1/x.jpg`)).toBe(false);
  });

  it('rejects any other host (no off-host SSRF)', () => {
    expect(isRehostableStockUrl('https://evil.com/x.jpg')).toBe(false);
    expect(isRehostableStockUrl('https://www.pexels.com/photo/1/')).toBe(false); // the API host, not the CDN
    expect(isRehostableStockUrl('https://api.pexels.com/v1/search')).toBe(false);
  });

  it('rejects suffix-trickery hostnames', () => {
    expect(isRehostableStockUrl('https://images.pexels.com.evil.com/x.jpg')).toBe(false);
    expect(isRehostableStockUrl('https://evilimages.pexels.com/x.jpg')).toBe(false);
  });

  it('leaves an already-rehosted Supabase URL untouched (false)', () => {
    expect(isRehostableStockUrl('https://xyz.supabase.co/storage/v1/object/public/assets/ai-stock/t1/abc.jpg')).toBe(false);
  });

  it('rejects data: URLs and garbage', () => {
    expect(isRehostableStockUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isRehostableStockUrl('not a url')).toBe(false);
    expect(isRehostableStockUrl('')).toBe(false);
    // @ts-expect-error — defensive against non-string input
    expect(isRehostableStockUrl(null)).toBe(false);
  });
});
