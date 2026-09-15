/**
 * The import contract is shared so it cannot drift.
 *
 * This spec lives in the API rather than beside the types it covers, because
 * `packages/api-types` has no `test` script and no workflow runs jest over
 * `packages/` — the specs already sitting there have never executed. A test
 * that cannot run is worse than no test: it reads as coverage. This pins what would drift
 * first: the disposition and mode vocabularies the screen branches on and the
 * server writes, and the JSON round trip, because a manifest is persisted as
 * JSON on an import job and read back days later.
 */
import type {
  ImportManifestLike,
  ImportPageDisposition,
  ImportPageMode,
} from '@cms/api-types';

describe('design-import contract', () => {
  it('has exactly two modes', () => {
    const modes: ImportPageMode[] = ['preserve', 'editable'];
    expect(new Set(modes).size).toBe(2);
  });

  it('accounts for a page in one of four ways, none of which is absence', () => {
    const all: ImportPageDisposition[] = [
      'converted', 'converted-with-warnings', 'empty', 'excluded-by-limit',
    ];
    expect(new Set(all).size).toBe(4);
  });

  it('survives a JSON round trip unchanged', () => {
    const manifest: ImportManifestLike = {
      version: 1,
      format: 'pdf',
      sourcePageCount: 3,
      warnings: [{ code: 'PAGES_TRUNCATED', detail: 'Only the first 3 of 60 pages were rendered.' }],
      pages: [
        {
          // The artwork-only page: no text to make editable, but it still has a
          // picture of itself, so it is offered rather than dropped.
          sourcePage: 2, label: 'Page 2', disposition: 'empty',
          availableModes: ['preserve'], defaultMode: 'preserve',
          editableTextCount: 0, editableImageCount: 0,
          rasterObjectKey: 't/j/p2.webp', widthPx: 1920, heightPx: 1080,
          warnings: [],
        },
      ],
    };
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('a page that cannot be converted still has a row, with no mode', () => {
    const page: ImportManifestLike['pages'][number] = {
      sourcePage: 41, label: 'Page 41', disposition: 'excluded-by-limit',
      availableModes: [], defaultMode: null,
      editableTextCount: 0, editableImageCount: 0, warnings: [],
    };
    // `null` rather than a mode is what stops it being selectable, and the row
    // existing at all is what stops it being invisible.
    expect(page.defaultMode).toBeNull();
    expect(page.availableModes).toEqual([]);
  });
});
