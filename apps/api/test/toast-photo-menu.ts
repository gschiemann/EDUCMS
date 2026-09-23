/**
 * A Toast venue whose menu carries the POS's own item photos — built by the
 * PRODUCERS, never hand-written (2026-09-23, POS item photos).
 *
 *   Toast Menus V2 payload (the shape pos/providers/toast.spec.ts pins)
 *     → normalizeToastMenus              (pos/providers/toast.ts)
 *     → MenuService.ingestPosCatalog     (writes MenuCatalog / MenuCategory / MenuItem rows)
 *     → MenuService.resolvePosMenuForLocation — what loadPosBindingPlan and
 *       auto-grounding read.
 *
 * The rows live in the two-tenant Prisma double, which EVALUATES every `where`
 * (a read that forgot its tenant would see tenant t2's connection and menu).
 * The photos are real JPEG encodings (test/supertaco-site.ts) behind a
 * safeFetch-shaped double: two load, one 404s, one is served over http (which
 * the Toast producer itself refuses), one item has none.
 */
import { makeTwoTenantPrisma } from '../src/tenant-isolation/two-tenant-prisma';
import { normalizeToastMenus } from '../src/pos/providers/toast';
import { MenuService } from '../src/pos/menu.service';
import { photoJpeg } from './supertaco-site';

export const TOAST_RESTAURANT_GUID = '11111111-1111-4111-8111-111111111111';
export const TOAST_CONNECTION_ID = 'conn-toast-photos';

export const TOAST_PHOTO_URLS = {
  birria: 'https://images.toasttab.com/restaurants/st/birria-tacos.jpg',
  pastor: 'https://images.toasttab.com/restaurants/st/al-pastor.jpg',
  asada: 'https://images.toasttab.com/restaurants/st/asada-super.jpg',
  carnitasHttp: 'http://images.toasttab.com/restaurants/st/carnitas.jpg',
} as const;

/** GET /config/v2/menus for one restaurant, as Toast answers it (Menus V2). */
export const TOAST_PHOTO_MENUS = {
  menus: [
    {
      guid: 'menu-all-day',
      name: 'All Day',
      menuGroups: [
        {
          guid: 'grp-tacos',
          name: 'Tacos',
          menuItems: [
            {
              guid: 'item-birria',
              multiLocationId: 'ml-birria',
              name: '3 Birria Tacos w/ consome',
              description: 'slow-braised beef',
              price: 14.5,
              pricingStrategy: 'BASE_PRICE',
              visibility: ['POS', 'TOAST_ONLINE_ORDERING'],
              image: TOAST_PHOTO_URLS.birria,
            },
            {
              guid: 'item-fish',
              multiLocationId: 'ml-fish',
              name: 'Fish Taco',
              price: 4.5,
              pricingStrategy: 'BASE_PRICE',
              visibility: ['POS'],
              image: null,
            },
            {
              guid: 'item-pastor',
              multiLocationId: 'ml-pastor',
              name: 'Al Pastor Taco',
              price: 4.25,
              pricingStrategy: 'MENU_SPECIFIC_PRICE',
              visibility: ['POS'],
              images: [TOAST_PHOTO_URLS.pastor],
            },
          ],
        },
        {
          guid: 'grp-burritos',
          name: 'Burritos',
          menuItems: [
            {
              guid: 'item-asada',
              multiLocationId: 'ml-asada',
              name: 'Asada Super Burrito',
              price: 17.5,
              pricingStrategy: 'BASE_PRICE',
              visibility: ['POS'],
              image: TOAST_PHOTO_URLS.asada,
            },
            {
              guid: 'item-carnitas',
              multiLocationId: 'ml-carnitas',
              name: 'Carnitas Burrito',
              price: 12.75,
              pricingStrategy: 'BASE_PRICE',
              visibility: ['POS'],
              image: TOAST_PHOTO_URLS.carnitasHttp,
            },
            {
              guid: 'item-market',
              name: 'Market special',
              price: null,
              pricingStrategy: 'OPEN_PRICE',
              visibility: ['POS'],
            },
          ],
        },
      ],
    },
  ],
};

/** Tenant t1's Toast connection, plus another tenant's (which must never be read for t1). */
function dataset() {
  const now = new Date('2026-09-23T12:00:00.000Z');
  return {
    tenant: [
      { id: 't1', parentId: null, name: 'Super Taco' },
      { id: 't2', parentId: null, name: 'Other Venue' },
    ],
    posProviderConnection: [
      {
        id: TOAST_CONNECTION_ID,
        tenantId: 't1',
        providerId: 'toast',
        displayName: null,
        status: 'ACTIVE',
        statusReason: null,
        lastSyncedAt: now,
        createdAt: now,
      },
      {
        id: 'conn-t2-square',
        tenantId: 't2',
        providerId: 'square',
        displayName: 'Other registers',
        status: 'ACTIVE',
        statusReason: null,
        lastSyncedAt: now,
        createdAt: now,
      },
    ],
    posLocation: [],
    menuCatalog: [],
    menuCategory: [],
    menuItem: [],
    menuLocationOverride: [],
    auditLog: [],
  };
}

/**
 * Tenant t1 after a Toast sync of TOAST_PHOTO_MENUS: the Prisma double holding
 * the rows MenuService wrote, and a MenuService reading them back.
 */
export async function toastPhotoCatalog() {
  const db = makeTwoTenantPrisma(dataset());
  const prisma = { client: db.client };
  const menu = new MenuService(prisma as any);
  await menu.ingestPosCatalog(
    { id: TOAST_CONNECTION_ID, tenantId: 't1', providerId: 'toast' },
    normalizeToastMenus(TOAST_PHOTO_MENUS as any, TOAST_RESTAURANT_GUID),
  );
  return { db, prisma, menu };
}

/**
 * Toast's image CDN, offline: real JPEG encodings for the photos that exist, a
 * 404 for the one that does not. Shaped like `safeFetch` (status, body,
 * contentType, finalUrl). `calls` records every URL requested.
 */
export async function toastPhotoCdn() {
  const photos: Record<string, Buffer> = {
    [TOAST_PHOTO_URLS.birria]: await photoJpeg(1600, 1067, 61),
    [TOAST_PHOTO_URLS.pastor]: await photoJpeg(1400, 1400, 62),
  };
  const calls: string[] = [];
  const fetch = (url: string) => {
    calls.push(url);
    const body = photos[url];
    return Promise.resolve(
      body
        ? { status: 200, body, contentType: 'image/jpeg', finalUrl: url }
        : {
            status: 404,
            body: Buffer.from('Not Found'),
            contentType: 'text/plain',
            finalUrl: url,
          },
    );
  };
  return { fetch: fetch as any, calls };
}

/** Our bucket, in memory: `upload` answers the public URL Supabase would. */
export function memoryBucket(opts: { fail?: boolean } = {}) {
  const uploads: Array<{ path: string; contentType: string; buf: Buffer }> = [];
  return {
    uploads,
    upload: (path: string, buf: Buffer, contentType: string) => {
      if (opts.fail) return Promise.reject(new Error('storage down'));
      uploads.push({ path, contentType, buf });
      return Promise.resolve(
        `https://sb.example/storage/v1/object/public/assets/${path}`,
      );
    },
  };
}
