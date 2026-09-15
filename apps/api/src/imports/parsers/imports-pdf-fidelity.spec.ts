/**
 * PDF conversion fidelity and page accounting.
 *
 * Two kinds of fixture, both REAL files fed to the REAL parser:
 *
 *  1. the shared corpus's `mixed-layout.pdf` and `forty-one-pages.pdf`
 *     — the 2026-09-15 audit's own synthetic PDFs, copied verbatim from
 *     `docs/design/proposals/2026-09-15-template-import-audit/evidence/`.
 *     They contain no customer data. They are the corpus the audit used
 *     to prove "Left column Right column" and "a 3-page PDF becomes 2
 *     templates", so the fixed behaviour is asserted on the exact bytes
 *     that produced the finding.
 *  2. A minimal PDF written here, byte by byte, so rotation and crop-box
 *     cases can be constructed with known coordinates.
 *
 * ── Why `parsePdf` runs in a child process ──────────────────────────
 *
 * `pdfjs-dist` v6 is ESM-only and the API compiles with `module: nodenext`,
 * which preserves the parser's `await import()` as a real dynamic import.
 * Jest's CommonJS VM cannot service that without `--experimental-vm-modules`,
 * and there is no way around it from inside a spec (measured: a plain
 * `import()`, a `new Function('return import(s)')`, and `createRequire()`
 * all fail — Jest owns the loader in its sandbox and recompiles the `.mjs`
 * as CommonJS, dying on `import.meta`). Mocking pdf.js would test a fiction:
 * the single most important thing this file asserts is a behaviour NO
 * hand-written mock would have predicted — real pdf.js fills a column
 * gutter with a 346pt-wide, zero-height whitespace run, which is precisely
 * why the old "adjacency" check could never have worked.
 *
 * So `__fixtures__/parse-pdf-in-child.mjs` runs the real parser over the
 * real bytes in a plain Node process, and everything downstream of it —
 * `buildImport`, `toDeviceItem`, `groupItemsIntoZones` — is exercised
 * directly, in-process, because none of those touch pdf.js.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toDeviceItem, groupItemsIntoZones, MAX_PDF_PAGES } from './pdf-parser';
import { buildImport } from './import-builder';
import { collectWarnings, type ParsedDocument } from './types';

jest.setTimeout(120_000);

// The shared golden corpus — see apps/api/test/fixtures/import-corpus/README.md.
// The child-process runner below still lives in __fixtures__ beside this spec,
// because it is test MACHINERY, not a document under test.
const FIXTURES = join(__dirname, '..', '..', '..', 'test', 'fixtures', 'import-corpus');
const RUNNER = join(__dirname, '__fixtures__', 'parse-pdf-in-child.mjs');

/** Parse a real PDF with the real parser, out of Jest's CommonJS VM. */
function parsePdfFile(pdfPath: string): ParsedDocument {
  const stdout = execFileSync(process.execPath, [RUNNER, pdfPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // pdf.js logs a standardFontDataUrl warning to stderr; stdout is JSON.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout) as ParsedDocument;
}

const cache = new Map<string, ParsedDocument>();
function parseFixture(name: string): ParsedDocument {
  const cached = cache.get(name);
  if (cached) return cached;
  const doc = parsePdfFile(join(FIXTURES, name));
  cache.set(name, doc);
  return doc;
}

let scratch: string | null = null;
function parseBytes(pdf: Buffer, name: string): ParsedDocument {
  scratch ??= mkdtempSync(join(tmpdir(), 'venueos-pdf-spec-'));
  const file = join(scratch, `${name}.pdf`);
  writeFileSync(file, pdf);
  return parsePdfFile(file);
}

// ─── A hand-built PDF, so rotation/crop coordinates are known ─────────

interface PageSpec {
  mediaBox: [number, number, number, number];
  rotate?: number;
  content: string;
}

/** A text-showing operator at an explicit user-space position. */
function showText(
  x: number,
  y: number,
  size: number,
  text: string,
  matrix?: [number, number, number, number],
): string {
  const m = matrix ?? [1, 0, 0, 1];
  return `BT /F1 ${size} Tf ${m[0]} ${m[1]} ${m[2]} ${m[3]} ${x} ${y} Tm (${text}) Tj ET`;
}

/** Assemble a valid single-font PDF with a real cross-reference table. */
function buildPdf(pages: PageSpec[]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };
  const fontNum = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageNums: number[] = [];
  // The Pages object is written last; its number is known in advance
  // because every page contributes exactly two objects.
  const pagesNum = objects.length + pages.length * 2 + 1;
  for (const p of pages) {
    const contentNum = add(
      `<< /Length ${Buffer.byteLength(p.content, 'latin1')} >>\nstream\n${p.content}\nendstream`,
    );
    pageNums.push(
      add(
        `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [${p.mediaBox.join(' ')}]` +
          (p.rotate ? ` /Rotate ${p.rotate}` : '') +
          ` /Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNum} 0 R >>`,
      ),
    );
  }
  const written = add(
    `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>`,
  );
  if (written !== pagesNum) throw new Error('fixture object numbering drifted');
  const catalogNum = add(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>`);

  let out = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ─────────────────────────────────────────────────────────────────────
// Defect 6a — columns merge
// ─────────────────────────────────────────────────────────────────────

describe('defect 6 — two columns sharing a baseline are two zones', () => {
  it('separates the audit fixture\'s "Left column" and "Right column"', () => {
    const page1 = parseFixture('mixed-layout.pdf').pages[0];
    const texts = page1.zones.map((z) => z.defaultConfig.content);

    // The exact string the audit recorded from the old code, and what it
    // must never be again.
    expect(texts).not.toContain('Left column Right column');
    expect(texts).toEqual([
      'SYNTHETIC IMPORT TEST',
      'Left column',
      'Right column',
    ]);

    // They are on the same baseline and horizontally apart, which is the
    // whole point: the split is horizontal, not vertical.
    const [, left, right] = page1.zones;
    expect(left.y).toBeCloseTo(right.y, 3);
    expect(right.x).toBeGreaterThan(left.x + left.width);
  });

  it('NEGATIVE CONTROL: a normal word gap on one baseline stays ONE zone', () => {
    // "Lunch" ends at x≈100; "menu" starts at 107 — a 7pt word space at
    // 20pt type. Splitting here would shred every ordinary sentence.
    const doc = parseBytes(
      buildPdf([
        {
          mediaBox: [0, 0, 800, 450],
          content: `${showText(50, 280, 20, 'Lunch')}\n${showText(107, 280, 20, 'menu')}`,
        },
      ]),
      'word-gap',
    );
    expect(doc.pages[0].zones.map((z) => z.defaultConfig.content)).toEqual([
      'Lunch menu',
    ]);
  });

  it('splits three columns into three zones, in reading order', () => {
    const doc = parseBytes(
      buildPdf([
        {
          mediaBox: [0, 0, 900, 300],
          content: [
            showText(40, 200, 18, 'Monday'),
            showText(360, 200, 18, 'Tuesday'),
            showText(680, 200, 18, 'Wednesday'),
          ].join('\n'),
        },
      ]),
      'three-columns',
    );
    expect(doc.pages[0].zones.map((z) => z.defaultConfig.content)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
    ]);
  });

  it('a column gap does not inflate the font size the zone reports', () => {
    // pdf.js fills a gutter with a ZERO-HEIGHT whitespace run. Letting it
    // into the geometry pushed the zone onto the text-matrix height
    // fallback, reporting 20pt type as 27px.
    const [, left, right] = parseFixture('mixed-layout.pdf').pages[0].zones;
    expect(left.defaultConfig.fontSize).toBe(20);
    expect(right.defaultConfig.fontSize).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Defect 6b — page rotation and crop box
// ─────────────────────────────────────────────────────────────────────

describe('defect 6 — page rotation and crop box move the text with them', () => {
  it('places text on a /Rotate 90 page where the viewer shows it', () => {
    // A 450×800 portrait page rotated 90° for display → an 800×450
    // device page. Text drawn near the TOP-LEFT of the portrait source
    // (50, 700) belongs near the RIGHT edge after the rotation.
    const doc = parseBytes(
      buildPdf([
        {
          mediaBox: [0, 0, 450, 800],
          rotate: 90,
          content: showText(50, 700, 20, 'Top left'),
        },
      ]),
      'rotate-90',
    );
    const page = doc.pages[0];
    expect([page.screenWidth, page.screenHeight]).toEqual([800, 450]);
    const zone = page.zones[0];
    expect(zone.defaultConfig.content).toBe('Top left');
    // Device x = 700 of 800 = 87.5%.
    expect(zone.x).toBeCloseTo(87.5, 2);
    // Device baseline y = 50, minus 0.85 × 20px of ascent → 33 of 450.
    expect(zone.y).toBeCloseTo(7.3333, 2);

    // The OLD approximation was x = e (50 → 6.25%) and
    // y = pageHeight − f (450 − 700 = −250, clamped to 0). Neither is
    // what this now produces, which is what makes this a real check.
    expect(zone.x).not.toBeCloseTo(6.25, 2);
    expect(zone.y).not.toBeCloseTo(0, 2);
  });

  it('subtracts a crop box that does not start at the origin', () => {
    // MediaBox [100 100 900 550]: an 800×450 page whose user-space
    // origin is (100,100). Text at user (150,450) is 50pt from the left
    // edge and 100pt from the top of what the viewer actually shows.
    const doc = parseBytes(
      buildPdf([
        {
          mediaBox: [100, 100, 900, 550],
          content: showText(150, 450, 20, 'Top left'),
        },
      ]),
      'cropped',
    );
    const zone = doc.pages[0].zones[0];
    expect(zone.x).toBeCloseTo(6.25, 2); // 50 / 800
    expect(zone.y).toBeCloseTo(18.4444, 2); // (100 − 17) / 450

    // The OLD code used the raw user-space e/f: x = 150 (18.75%),
    // y = 450 − 450 = 0.
    expect(zone.x).not.toBeCloseTo(18.75, 2);
  });

  it('NEGATIVE CONTROL: an unrotated, origin-cropped page is unchanged', () => {
    const doc = parseBytes(
      buildPdf([
        {
          mediaBox: [0, 0, 800, 450],
          content: showText(50, 350, 20, 'Top left'),
        },
      ]),
      'plain',
    );
    const zone = doc.pages[0].zones[0];
    // Here the old approximation and the viewport transform AGREE — which
    // is exactly why the plain case could never have caught the bug.
    expect(zone.x).toBeCloseTo(6.25, 2);
    expect(zone.y).toBeCloseTo(18.4444, 2);
  });

  it('records text that is rotated within the page instead of pretending', () => {
    const doc = parseBytes(
      buildPdf([
        {
          mediaBox: [0, 0, 800, 450],
          // A 90° text matrix: the run climbs the page.
          content: showText(400, 100, 20, 'Sideways', [0, 1, -1, 0]),
        },
      ]),
      'sideways',
    );
    expect(doc.pages[0].warnings.map((w) => w.code)).toContain('TEXT_ROTATED');
    // Still imported — a warning is not a deletion.
    expect(doc.pages[0].zones[0].defaultConfig.content).toBe('Sideways');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Defect 7 — page accounting
// ─────────────────────────────────────────────────────────────────────

describe('defect 7 — every source page is accounted for', () => {
  it('reports 3 source pages for the 3-page fixture, with the artwork page EMPTY', () => {
    const doc = parseFixture('mixed-layout.pdf');

    expect(doc.sourcePageCount).toBe(3);
    expect(doc.pages.map((p) => p.sourcePage)).toEqual([1, 2, 3]);
    expect(doc.pages.map((p) => p.disposition)).toEqual([
      'converted',
      'empty',
      'converted',
    ]);
    // Page 2 is the artwork-only page. It is a FACT, not a deletion.
    expect(doc.pages[1].zones).toHaveLength(0);
    expect(doc.pages[1].warnings.map((w) => w.code)).toContain('PAGE_EMPTY');
  });

  it('carries that accounting through the builder — 3 pages, 2 templates', () => {
    const built = buildImport(parseFixture('mixed-layout.pdf'), {
      resolveMedia: () => null,
    });

    // The audit's exact finding was "buildTemplates emits only Page 1 and
    // Page 3". Both statements are now available at once: two templates,
    // three accounted pages.
    expect(built.templates.map((t) => t.label)).toEqual(['Page 1', 'Page 3']);
    expect(built.pages).toHaveLength(3);
    expect(built.sourcePageCount).toBe(3);
    expect(built.pages[1].template).toBeNull();
    expect(built.pages[1].disposition).toBe('empty');
    expect(built.pages.map((p) => p.sourcePage)).toEqual([1, 2, 3]);
    // Source page numbers survive the gap: "Page 3" is still page 3.
    expect(built.templates.map((t) => t.sourcePage)).toEqual([1, 3]);
  });

  it('reports 41 source pages for the 41-page fixture and names the cap', () => {
    const doc = parseFixture('forty-one-pages.pdf');

    expect(doc.sourcePageCount).toBe(41);
    expect(doc.pages).toHaveLength(41);
    expect(doc.pages.filter((p) => p.disposition === 'converted')).toHaveLength(
      MAX_PDF_PAGES,
    );
    const excluded = doc.pages.filter(
      (p) => p.disposition === 'excluded-by-limit',
    );
    expect(excluded.map((p) => p.sourcePage)).toEqual([41]);

    const truncation = doc.warnings.find((w) => w.code === 'PAGES_TRUNCATED');
    expect(truncation).toBeDefined();
    // The message states the REAL total, which is the whole point.
    expect(truncation!.detail).toContain('41');
    expect(truncation!.detail).toContain(String(MAX_PDF_PAGES));
  });

  it('the builder never invents or loses a page', () => {
    const built = buildImport(parseFixture('forty-one-pages.pdf'), {
      resolveMedia: () => null,
    });
    expect(built.pages).toHaveLength(41);
    expect(built.templates).toHaveLength(40);
    expect(built.sourcePageCount).toBe(41);
    expect(built.warnings.map((w) => w.code)).toContain('PAGES_TRUNCATED');
    // An excluded page cannot acquire a template on the way through.
    expect(built.pages[40].template).toBeNull();
    expect(built.pages[40].disposition).toBe('excluded-by-limit');
  });

  it('pageBackgroundUrl is addressed by SOURCE page, not array index', () => {
    const seen: Array<[number, number]> = [];
    const built = buildImport(parseFixture('mixed-layout.pdf'), {
      resolveMedia: () => null,
      pageBackgroundUrl: (index, sourcePage) => {
        seen.push([index, sourcePage]);
        return `https://cdn.example/page-${sourcePage}.webp`;
      },
    });
    expect(seen).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    // With a background the artwork page HAS something renderable, so it
    // becomes a template rather than staying empty — which is exactly the
    // door a rasterizer walks through.
    expect(built.templates).toHaveLength(3);
    expect(built.pages[1].template!.zones[0].defaultConfig.assetUrl).toBe(
      'https://cdn.example/page-2.webp',
    );
    expect(built.pages[1].disposition).not.toBe('empty');
  });

  it('every warning stays JSON-serialisable and operator-readable', () => {
    const all = collectWarnings(parseFixture('forty-one-pages.pdf'));
    expect(all.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(all))).toEqual(all);
    for (const w of all) {
      expect(typeof w.code).toBe('string');
      expect(typeof w.detail).toBe('string');
      expect(w.detail.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// The pure halves, exercised directly in-process
// ─────────────────────────────────────────────────────────────────────

describe('toDeviceItem — the pure coordinate composition', () => {
  const upright = [1, 0, 0, -1, 0, 450]; // an 800×450 page, no rotation

  it('flips a PDF bottom-left origin to a top-left device origin', () => {
    const item = toDeviceItem(
      { str: 'Hi', width: 40, height: 20, transform: [20, 0, 0, 20, 50, 350] },
      upright,
    );
    expect(item).not.toBeNull();
    expect(item!.xPx).toBeCloseTo(50, 6);
    expect(item!.yPx).toBeCloseTo(100, 6);
    expect(item!.hPx).toBeCloseTo(20, 6);
    expect(item!.wPx).toBeCloseTo(40, 6);
    expect(item!.rotated).toBe(false);
  });

  it('applies the viewport rotation to the item position', () => {
    // The /Rotate 90 viewport of a 450×800 page.
    const rotated = [0, 1, 1, 0, 0, 0];
    const item = toDeviceItem(
      {
        str: 'Hi',
        width: 40,
        height: 20,
        transform: [20, 0, 0, 20, 50, 700],
      },
      rotated,
    );
    expect(item!.xPx).toBeCloseTo(700, 6);
    expect(item!.yPx).toBeCloseTo(50, 6);
    // …and the naive flip would have said (50, 800 − 700).
    expect(item!.xPx).not.toBeCloseTo(50, 6);
  });

  it('marks whitespace-only runs blank and gives them no glyph height', () => {
    const item = toDeviceItem(
      {
        str: '   ',
        width: 346,
        height: 0,
        transform: [20, 0, 0, 20, 153, 280],
      },
      upright,
    );
    expect(item!.blank).toBe(true);
    expect(item!.hPx).toBe(0);
    expect(item!.rotated).toBe(false);
  });

  it('refuses a run with no string or a malformed matrix', () => {
    expect(
      toDeviceItem({ str: '', transform: [1, 0, 0, 1, 0, 0] }, upright),
    ).toBeNull();
    expect(toDeviceItem({ str: 'x', transform: [1, 0] }, upright)).toBeNull();
    expect(
      toDeviceItem({ str: 'x', transform: [1, 0, 0, 1, NaN, 0] }, upright),
    ).toBeNull();
  });
});

describe('groupItemsIntoZones — the caps report themselves', () => {
  const item = (x: number, y: number) => ({
    str: `t${x}-${y}`,
    xPx: x,
    yPx: y,
    hPx: 10,
    wPx: 20,
    blank: false,
    rotated: false,
  });

  it('stops at the per-page zone cap and calls back', () => {
    const codes: string[] = [];
    const items = Array.from({ length: 100 }, (_, i) => item(0, i * 40));
    const zones = groupItemsIntoZones(items, 800, 5000, (c) => codes.push(c));
    expect(zones).toHaveLength(80);
    expect(codes).toContain('ZONES_TRUNCATED');
  });

  it('treats a wide blank run as the gap, not as content', () => {
    // The exact shape real pdf.js emits between two columns.
    const zones = groupItemsIntoZones(
      [
        { ...item(50, 170), str: 'Left column', wPx: 103 },
        {
          str: ' ',
          xPx: 153,
          yPx: 170,
          hPx: 0,
          wPx: 347,
          blank: true,
          rotated: false,
        },
        { ...item(500, 170), str: 'Right column', wPx: 117 },
      ],
      800,
      450,
    );
    expect(zones.map((z) => z.defaultConfig.content)).toEqual([
      'Left column',
      'Right column',
    ]);
  });

  it('returns nothing for no items, without calling back', () => {
    const codes: string[] = [];
    expect(groupItemsIntoZones([], 800, 450, (c) => codes.push(c))).toEqual([]);
    expect(codes).toEqual([]);
  });
});

// A fixture guard: if the audit's PDFs are ever replaced, these numbers
// stop matching and every assertion above becomes meaningless silently.
describe('fixture integrity', () => {
  it('the audit PDFs are the ones this file was written against', () => {
    const mixed = readFileSync(join(FIXTURES, 'mixed-layout.pdf'));
    const forty = readFileSync(join(FIXTURES, 'forty-one-pages.pdf'));
    expect(mixed.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(forty.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(parseFixture('mixed-layout.pdf').sourcePageCount).toBe(3);
    expect(parseFixture('forty-one-pages.pdf').sourcePageCount).toBe(41);
  });
});
