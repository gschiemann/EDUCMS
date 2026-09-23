/**
 * POS item photos, from the POS's own catalog to the Designer's prompt
 * (2026-09-23, the Codex-parity wave).
 *
 * FIXTURE PROVENANCE — nothing here is a hand-written ResolvedMenu. The menu is
 * a Toast Menus V2 payload run through the producers (test/toast-photo-menu.ts):
 * normalizeToastMenus → MenuService.ingestPosCatalog → the rows in the
 * two-tenant Prisma double → MenuService.resolvePosMenuForLocation. Then the
 * real loadPosBindingPlan (+ attachPlanPhotos: real JPEG encodings, the real
 * decode gates, an in-memory bucket), formatPosPlanContent and
 * buildDesignerUserPrompt.
 */
import sharp from 'sharp';
import { loadPosBindingPlan } from './designer-pos-binding';
import { buildPosBindingPlan, formatPosPlanContent } from './pos-binding-plan';
import { buildDesignerUserPrompt, parsePosBoundRows, countMenuContentRows } from './designer-prompt';
import {
  memoryBucket,
  toastPhotoCatalog,
  toastPhotoCdn,
  TOAST_CONNECTION_ID,
  TOAST_PHOTO_URLS,
} from '../../test/toast-photo-menu';

jest.setTimeout(30_000);

const OUR_ITEM_URL = /^https:\/\/sb\.example\/storage\/v1\/object\/public\/assets\/ai-designer\/t1\/item-[0-9a-f]{16}\.jpg$/;
const SELECTION = { connectionId: TOAST_CONNECTION_ID, sections: ['Tacos', 'Burritos'] };
const CANVAS = { width: 3840, height: 2160 };

describe('the producer chain carries the POS photo to the plan (and nothing else does)', () => {
  it('ResolvedMenu items hold the https photo Toast gave; an http one never survived the sync', async () => {
    const { menu } = await toastPhotoCatalog();
    const resolved = await menu.resolvePosMenuForLocation('t1', { connectionId: TOAST_CONNECTION_ID, includeUnavailable: true, ignoreDayparts: true });
    const byName = new Map(resolved.items.map((i) => [i.name, i.imageUrl]));
    expect(byName.get('3 Birria Tacos w/ consome')).toBe(TOAST_PHOTO_URLS.birria);
    expect(byName.get('Al Pastor Taco')).toBe(TOAST_PHOTO_URLS.pastor); // from Toast's `images[]`
    expect(byName.get('Asada Super Burrito')).toBe(TOAST_PHOTO_URLS.asada);
    expect(byName.get('Fish Taco')).toBeNull();
    expect(byName.get('Carnitas Burrito')).toBeNull(); // http: refused by the Toast producer itself
    expect(byName.has('Market special')).toBe(false); // open price: not a board row
  });
});

describe('loadPosBindingPlan — item photos checked and copied BEFORE the draw', () => {
  it('each row gets OUR copy of its own POS photo, or none; the POS URL never reaches the plan output', async () => {
    const { prisma, menu, db } = await toastPhotoCatalog();
    const cdn = await toastPhotoCdn();
    const bucket = memoryBucket();
    const plan = await loadPosBindingPlan({ prisma, menu, photos: { storage: bucket, fetch: cdn.fetch } }, 't1', SELECTION, CANVAS);

    expect(plan.itemPhotos).toBe(true);
    const row = (name: string) => plan.items.find((i) => i.name === name)!;
    expect(row('3 Birria Tacos w/ consome').imageUrl).toMatch(OUR_ITEM_URL);
    expect(row('Al Pastor Taco').imageUrl).toMatch(OUR_ITEM_URL);
    expect(row('Asada Super Burrito').imageUrl).toBeUndefined(); // its photo 404'd — absent, never replaced
    expect(row('Fish Taco').imageUrl).toBeUndefined();
    expect(row('Carnitas Burrito').imageUrl).toBeUndefined();
    // Every https POS photo was tried once; http never was.
    expect([...cdn.calls].sort()).toEqual([TOAST_PHOTO_URLS.asada, TOAST_PHOTO_URLS.birria, TOAST_PHOTO_URLS.pastor].sort());
    expect(bucket.uploads.map((u) => u.contentType)).toEqual(['image/jpeg', 'image/jpeg']);
    expect(bucket.uploads.every((u) => /^ai-designer\/t1\/item-[0-9a-f]{16}\.jpg$/.test(u.path))).toBe(true);
    // A 4K card frame is 960x640: the copy is at most ~1.25x that, never the POS original.
    for (const u of bucket.uploads) {
      const meta = await sharp(u.buf).metadata();
      expect(meta.width! <= 1200 && meta.height! <= 800).toBe(true);
    }
    // Tenant t2's connection and menu were never read for t1.
    expect(db.foreignTouches('t1')).toEqual([]);

    const content = formatPosPlanContent(plan);
    expect(content).not.toContain('toasttab');
    for (const id of ['ml-birria', 'ml-fish', 'ml-pastor', 'ml-asada', 'ml-carnitas', TOAST_CONNECTION_ID]) expect(content).not.toContain(id);
    // Rows with a photo end "— photo: item.N.photo"; the URLs follow the rows.
    const lines = content.split('\n');
    for (const it of plan.items) {
      const line = lines.find((l) => l.startsWith(`[item.${it.n}] `))!;
      expect(line.endsWith(` — photo: item.${it.n}.photo`)).toBe(!!it.imageUrl);
    }
    expect(lines.filter((l) => /^item\.\d+\.photo: /.test(l))).toEqual(
      plan.items.filter((i) => i.imageUrl).map((i) => `item.${i.n}.photo: ${i.imageUrl}`),
    );
    expect(countMenuContentRows(content)).toBe(plan.items.length);
    // The prompt parser reads back exactly the plan's photos.
    expect(parsePosBoundRows(content).map((r) => [r.n, r.photo ?? null])).toEqual(plan.items.map((i) => [i.n, i.imageUrl ?? null]));
  });

  it('the Designer is told which rows have a photo — and that the rest get none', async () => {
    const { prisma, menu } = await toastPhotoCatalog();
    const cdn = await toastPhotoCdn();
    const plan = await loadPosBindingPlan({ prisma, menu, photos: { storage: memoryBucket(), fetch: cdn.fetch } }, 't1', SELECTION, CANVAS);
    const withPhoto = plan.items.filter((i) => i.imageUrl).map((i) => `item.${i.n}`);
    expect(withPhoto).toHaveLength(2);
    const p = buildDesignerUserPrompt({ prompt: 'our Toast menu', width: 3840, height: 2160, purpose: 'menu', content: formatPosPlanContent(plan) });
    expect(p).toContain(`- ITEM PHOTOS — 2 of the rows (${withPhoto.join(' and ')}) end "photo: item.N.photo"`);
    expect(p).toContain('A row without a photo gets no photo frame');
    expect(p).toContain('THIS BOARD IS THE MENU — the content above has 5 items.');
    expect(p).not.toContain('toasttab');
  });

  it('no storage injected: the same plan, no photos, no fetch — and still marked, so the binder strips borrowed ones', async () => {
    const { prisma, menu } = await toastPhotoCatalog();
    const cdn = await toastPhotoCdn();
    const plan = await loadPosBindingPlan({ prisma, menu, photos: { storage: null, fetch: cdn.fetch } }, 't1', SELECTION, CANVAS);
    expect(plan.itemPhotos).toBe(true);
    expect(plan.items.every((i) => i.imageUrl === undefined)).toBe(true);
    expect(cdn.calls).toEqual([]);
    const p = buildDesignerUserPrompt({ prompt: 'menu', width: 3840, height: 2160, purpose: 'menu', content: formatPosPlanContent(plan) });
    expect(p).toContain('None of these rows comes with a photo');
    expect(p).not.toMatch(/ITEM PHOTOS|Item photos \(/);
    // …and a caller that injects nothing at all gets exactly the same.
    const bare = await loadPosBindingPlan({ prisma, menu }, 't1', SELECTION, CANVAS);
    expect(bare.itemPhotos).toBe(true);
    expect(formatPosPlanContent(bare)).toBe(formatPosPlanContent(plan));
  });

  it('our storage down: no photo, and the board still gets its plan (a photo problem never costs the board)', async () => {
    const { prisma, menu } = await toastPhotoCatalog();
    const cdn = await toastPhotoCdn();
    const plan = await loadPosBindingPlan({ prisma, menu, photos: { storage: memoryBucket({ fail: true }), fetch: cdn.fetch } }, 't1', SELECTION, CANVAS);
    expect(plan.items).toHaveLength(5);
    expect(plan.items.every((i) => i.imageUrl === undefined)).toBe(true);
  });
});

describe('a long row keeps its photo marker and still counts as a row', () => {
  it('the description is shortened (never the name, price or marker) to keep the row within 300 characters', () => {
    const long = (label: string, n: number) => `${label} ${'x'.repeat(n)}`.slice(0, n);
    const section = long('Section', 60);
    const plan = buildPosBindingPlan({
      menu: {
        categories: [{ id: 'c', name: section }],
        items: [
          {
            externalId: 'ml-long',
            name: long('A Very Long Dish Name', 80),
            description: long('Slow-braised, hand-pulled, twice-fried', 120),
            priceCents: 123456,
            category: section,
            imageUrl: 'https://images.toasttab.com/long.jpg',
          },
        ],
      },
      sections: [section],
      providerId: 'toast',
      providerName: 'Toast',
      connectionId: TOAST_CONNECTION_ID,
      rowLimit: 24,
    });
    plan.itemPhotos = true;
    plan.items[0].imageUrl = 'https://sb.example/storage/v1/object/public/assets/ai-designer/t1/item-0123456789abcdef.jpg';
    const content = formatPosPlanContent(plan);
    const row = content.split('\n').find((l) => l.startsWith('[item.0] '))!;
    expect(row.length).toBeLessThanOrEqual(300);
    expect(row.endsWith(' — photo: item.0.photo')).toBe(true);
    expect(row).toContain(`— ${long('A Very Long Dish Name', 80)} — $1234.56 — `);
    expect(row).toContain('…'); // the description, and only it, was shortened
    expect(countMenuContentRows(content)).toBe(1);
    expect(parsePosBoundRows(content)[0].photo).toBe(plan.items[0].imageUrl);
  });
});
