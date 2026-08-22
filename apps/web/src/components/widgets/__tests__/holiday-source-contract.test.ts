import * as fs from 'fs';
import * as path from 'path';
import {
  HOLIDAY_DEDICATED_PORTRAIT_BOARDS,
  HOLIDAY_GRADE_LEVEL_KEYS,
  HOLIDAY_HTML_CONTENT_VERSION,
  HOLIDAY_STYLE_BRIDGE_SOURCE,
  HOLIDAY_VARIANT_KEYS,
  resolveHolidayTemplateSource,
} from '../holiday-source-contract';

const templateRoot = path.resolve(
  __dirname,
  '../../../../public/holiday-templates',
);

const boardKeys = HOLIDAY_GRADE_LEVEL_KEYS.flatMap((gradeLevel) =>
  HOLIDAY_VARIANT_KEYS.map((variant) => ({ gradeLevel, variant })),
);

const expectedCanonicalPortraitFallbacks = new Set([
  'es-christmas',
  'es-easter',
  'es-halloween',
  'es-stpatricks',
  'es-thanksgiving',
  'es-valentines',
  'ms-christmas',
  'hs-christmas',
]);

function expectVersionedBridge(fileName: string) {
  const source = fs.readFileSync(path.join(templateRoot, fileName), 'utf8');
  expect(source).toContain(`src="${HOLIDAY_STYLE_BRIDGE_SOURCE}"`);
}

describe('holiday template source selection', () => {
  it.each(boardKeys)(
    'selects an existing, versioned landscape board for $gradeLevel-$variant',
    ({ gradeLevel, variant }) => {
      const result = resolveHolidayTemplateSource({
        gradeLevel,
        variant,
        portrait: false,
      });
      const url = new URL(result.src, 'https://venueos.test');

      expect(result.fileName).toBe(`${gradeLevel}-${variant}.html`);
      expect(result.usesCanonicalPortraitFallback).toBe(false);
      expect(url.searchParams.get('v')).toBe(HOLIDAY_HTML_CONTENT_VERSION);
      expect(url.searchParams.has('o')).toBe(false);
      expect(fs.existsSync(path.join(templateRoot, result.fileName))).toBe(true);
      expectVersionedBridge(result.fileName);
    },
  );

  it.each(boardKeys)(
    'selects a safe, existing portrait source for $gradeLevel-$variant',
    ({ gradeLevel, variant }) => {
      const boardKey = `${gradeLevel}-${variant}`;
      const shouldFallback = expectedCanonicalPortraitFallbacks.has(boardKey);
      const result = resolveHolidayTemplateSource({
        gradeLevel,
        variant,
        portrait: true,
      });
      const url = new URL(result.src, 'https://venueos.test');

      expect(result.fileName).toBe(
        `${boardKey}${shouldFallback ? '' : '-portrait'}.html`,
      );
      expect(result.usesCanonicalPortraitFallback).toBe(shouldFallback);
      expect(url.searchParams.get('v')).toBe(HOLIDAY_HTML_CONTENT_VERSION);
      expect(url.searchParams.get('o')).toBe(shouldFallback ? 'portrait' : null);
      expect(fs.existsSync(path.join(templateRoot, result.fileName))).toBe(true);
      expectVersionedBridge(result.fileName);
    },
  );

  it('locks the dedicated portrait inventory to the eight known fallbacks', () => {
    const allBoardKeys = boardKeys.map(
      ({ gradeLevel, variant }) => `${gradeLevel}-${variant}`,
    );
    const actualFallbacks = allBoardKeys.filter(
      (boardKey) => !HOLIDAY_DEDICATED_PORTRAIT_BOARDS.has(boardKey),
    );

    expect(new Set(actualFallbacks)).toEqual(expectedCanonicalPortraitFallbacks);
  });

  it('versions the shared style bridge across the complete shipped HTML pack', () => {
    const boardFiles = fs.readdirSync(templateRoot)
      .filter((fileName) => fileName.endsWith('.html'))
      .filter((fileName) => fileName !== '_overhaul-gallery.html')
      .sort();

    // Canonical, v2, flagship, and dedicated portrait boards all load the
    // same bridge. Keeping this inventory assertion explicit prevents a new
    // static board from silently shipping with a stale cached bridge URL.
    expect(boardFiles).toHaveLength(58);
    boardFiles.forEach(expectVersionedBridge);
  });
});
