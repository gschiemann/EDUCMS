/**
 * The `preserve` offer has to be backed by a render, and now something checks.
 *
 * These are the detector's own tests. What uses it — prepare demoting a page
 * before the manifest is persisted — is pinned in `import-prepare.service.spec`;
 * what happens if one slips through to commit anyway is pinned in
 * `import-commit.service.spec` (R4's all-or-nothing refusal).
 */
import {
  demoteRasterGaps,
  describeRasterGaps,
  findRasterGaps,
} from './import-manifest-integrity';
import type { ManifestPage } from './import-manifest';

const page = (over: Partial<ManifestPage> = {}): ManifestPage => ({
  sourcePage: 1,
  label: 'Page 1',
  disposition: 'converted',
  availableModes: ['preserve'],
  defaultMode: 'preserve',
  editableTextCount: 0,
  editableImageCount: 0,
  rasterObjectKey: 't/j/p1.webp',
  thumbObjectKey: 't/j/p1.thumb.webp',
  widthPx: 1920,
  heightPx: 1080,
  warnings: [],
  ...over,
});

describe('findRasterGaps', () => {
  it('finds nothing in a manifest prepare actually produced', () => {
    expect(findRasterGaps({ pages: [page(), page({ sourcePage: 2 })] })).toEqual([]);
  });

  it('names a page offered as preserve with no staged render', () => {
    const pages = [page(), page({ sourcePage: 2, rasterObjectKey: undefined })];
    expect(findRasterGaps({ pages })).toEqual([{ sourcePage: 2, reason: 'no-raster-key' }]);
  });

  it('names a page with a render but no size to build a canvas from', () => {
    const pages = [page({ widthPx: undefined }), page({ sourcePage: 2, heightPx: 0 })];
    expect(findRasterGaps({ pages })).toEqual([
      { sourcePage: 1, reason: 'no-dimensions' },
      { sourcePage: 2, reason: 'no-dimensions' },
    ]);
  });

  it('leaves alone a page that never offered preserve', () => {
    // A PowerPoint slide has no render and is not supposed to: `editable` is
    // the only mode a deck offers, and a page past the cap offers none at all.
    const slide = page({
      availableModes: ['editable'], defaultMode: 'editable',
      rasterObjectKey: undefined, thumbObjectKey: undefined,
      widthPx: undefined, heightPx: undefined,
    });
    const capped = page({
      sourcePage: 61, disposition: 'excluded-by-limit', availableModes: [], defaultMode: null,
      rasterObjectKey: undefined, widthPx: undefined, heightPx: undefined,
    });
    expect(findRasterGaps({ pages: [slide, capped] })).toEqual([]);
  });

  it('does not fall over on a manifest with no pages at all', () => {
    expect(findRasterGaps({ pages: [] })).toEqual([]);
    expect(findRasterGaps({ pages: undefined as unknown as ManifestPage[] })).toEqual([]);
  });
});

describe('demoteRasterGaps', () => {
  it('returns the pages untouched when there is nothing wrong', () => {
    const pages = [page(), page({ sourcePage: 2 })];
    const out = demoteRasterGaps(pages);
    expect(out.gaps).toEqual([]);
    expect(out.pages).toBe(pages); // same array, no copying for the common case
  });

  it('takes the mode away from the broken page and leaves the good one alone', () => {
    const pages = [page(), page({ sourcePage: 2, rasterObjectKey: undefined })];
    const out = demoteRasterGaps(pages);

    expect(out.pages[0]).toEqual(pages[0]);
    expect(out.pages[1]).toMatchObject({
      sourcePage: 2, availableModes: [], defaultMode: null,
    });
    // `defaultMode: null` is the manifest's existing word for "cannot be
    // converted", which the review screen already renders as unselectable and
    // the button count already excludes. No new UI is needed to honour it.
  });

  it('keeps the page — a page that vanished is the bug this program ended', () => {
    const pages = [page(), page({ sourcePage: 2, rasterObjectKey: undefined }), page({ sourcePage: 3 })];
    expect(demoteRasterGaps(pages).pages.map((p) => p.sourcePage)).toEqual([1, 2, 3]);
  });

  it('says why, in a sentence an operator can act on', () => {
    const out = demoteRasterGaps([page({ rasterObjectKey: undefined })]);
    expect(out.pages[0].warnings).toEqual([
      {
        code: 'PAGE_UNREADABLE',
        sourcePage: 1,
        detail: expect.stringContaining('could not be rendered'),
      },
    ]);
    // Nothing internal reaches the operator: no key, no bucket, no path.
    const said = JSON.stringify(out.pages[0].warnings);
    expect(said).not.toMatch(/t\/j\/|bucket|import-staging/);
  });

  it('does not mutate the array it was given', () => {
    const pages = [page({ rasterObjectKey: undefined })];
    const before = JSON.parse(JSON.stringify(pages));
    demoteRasterGaps(pages);
    expect(pages).toEqual(before);
  });
});

describe('describeRasterGaps', () => {
  it('is page numbers and reasons, and nothing else', () => {
    const line = describeRasterGaps([
      { sourcePage: 2, reason: 'no-raster-key' },
      { sourcePage: 7, reason: 'no-dimensions' },
    ]);
    expect(line).toBe('p2:no-raster-key,p7:no-dimensions');
  });
});
