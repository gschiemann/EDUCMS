/**
 * Multi-location DEMO seed (2026-06-02) — a 5-location chain you can explore.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Creates a fake "Acme Coffee Co." chain so you can SEE the multi-location
 * model in action and inspect how each piece is wired:
 *
 *   Acme Coffee Co. (Corporate)          ← parent tenant (the brand HQ)
 *   ├─ Acme Coffee — Austin (South Congress)
 *   ├─ Acme Coffee — Dallas (Deep Ellum)
 *   ├─ Acme Coffee — Houston (Montrose)
 *   ├─ Acme Coffee — San Antonio (Pearl)
 *   └─ Acme Coffee — Fort Worth (Sundance Sq)   ← 5 child "location" tenants
 *       each with 3 screens (Drive-Thru / Lobby / Counter) = 15 screens,
 *       real addresses + lat/lng so they cluster on the fleet map.
 *
 *   ONE menu ("Acme Coffee Menu") designed at Corporate, with PER-LOCATION
 *   price overrides so the same item is priced differently per store — and
 *   one item 86'd at Fort Worth — exactly what a POS would drive in
 *   production (here the overrides are source:'manual', so no POS needed).
 *
 * Additive + idempotent (fixed UUIDs; re-run safe), isolated to demo rows —
 * your real customer's data is never touched. Only SUPER_ADMINs see it, so it
 * appears in YOUR account-switcher dropdown automatically (no new login). A
 * Corporate admin login is also created for the chain-admin (non-super) view.
 *
 * Plain Node ESM (no tsx/esbuild needed). Run from the repo root:
 *   node packages/database/prisma/seed-multilocation-demo.mjs
 *   node packages/database/prisma/seed-multilocation-demo.mjs --clean
 * (loads packages/database/.env for DATABASE_URL)
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

// Load the database package's .env (DATABASE_URL) regardless of cwd.
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../.env') });
loadEnv({ path: resolve(__dirname, '../../../.env') }); // fall back to repo-root .env

const prisma = new PrismaClient();
const CLEAN = process.argv.includes('--clean');

const ID = {
  corporate: 'ac0c0000-0000-0000-0000-000000000001',
  catalog: 'ac0c0000-0000-0000-0000-0000000000c0',
  catCoffee: 'ac0c0000-0000-0000-0000-0000000000c1',
  catFood: 'ac0c0000-0000-0000-0000-0000000000c2',
  adminUser: 'ac0c0000-0000-0000-0000-0000000000d0',
};

const LOCATIONS = [
  { id: 'ac0c0000-0000-0000-0000-0000000000a1', key: 'austin', name: 'Acme Coffee — Austin', slug: 'acme-austin', address: '1500 S Congress Ave, Austin, TX 78704', lat: 30.2504, lng: -97.7501 },
  { id: 'ac0c0000-0000-0000-0000-0000000000a2', key: 'dallas', name: 'Acme Coffee — Dallas', slug: 'acme-dallas', address: '2800 Main St, Dallas, TX 75226', lat: 32.7841, lng: -96.7842 },
  { id: 'ac0c0000-0000-0000-0000-0000000000a3', key: 'houston', name: 'Acme Coffee — Houston', slug: 'acme-houston', address: '1200 Westheimer Rd, Houston, TX 77006', lat: 29.7450, lng: -95.3902 },
  { id: 'ac0c0000-0000-0000-0000-0000000000a4', key: 'sanantonio', name: 'Acme Coffee — San Antonio', slug: 'acme-san-antonio', address: '303 Pearl Pkwy, San Antonio, TX 78215', lat: 29.4432, lng: -98.4803 },
  { id: 'ac0c0000-0000-0000-0000-0000000000a5', key: 'fortworth', name: 'Acme Coffee — Fort Worth', slug: 'acme-fort-worth', address: '420 Main St, Fort Worth, TX 76102', lat: 32.7556, lng: -97.3309 },
];

const SCREEN_ROLES = ['Drive-Thru Menu', 'Lobby Menu Board', 'Counter Display'];

const ITEMS = [
  { id: 'ac0c0000-0000-0000-0000-0000000000e1', cat: ID.catCoffee, externalId: 'DEMO-LATTE', name: 'Latte', price: 450 },
  { id: 'ac0c0000-0000-0000-0000-0000000000e2', cat: ID.catCoffee, externalId: 'DEMO-CAPP', name: 'Cappuccino', price: 425 },
  { id: 'ac0c0000-0000-0000-0000-0000000000e3', cat: ID.catCoffee, externalId: 'DEMO-COLDBREW', name: 'Cold Brew', price: 475 },
  { id: 'ac0c0000-0000-0000-0000-0000000000e4', cat: ID.catCoffee, externalId: 'DEMO-DRIP', name: 'Drip Coffee', price: 295 },
  { id: 'ac0c0000-0000-0000-0000-0000000000e5', cat: ID.catFood, externalId: 'DEMO-CROISSANT', name: 'Butter Croissant', price: 375 },
  { id: 'ac0c0000-0000-0000-0000-0000000000e6', cat: ID.catFood, externalId: 'DEMO-BAGEL', name: 'Bagel & Schmear', price: 425 },
  { id: 'ac0c0000-0000-0000-0000-0000000000e7', cat: ID.catFood, externalId: 'DEMO-AVOTOAST', name: 'Avocado Toast', price: 895 },
  { id: 'ac0c0000-0000-0000-0000-0000000000e8', cat: ID.catFood, externalId: 'DEMO-MUFFIN', name: 'Blueberry Muffin', price: 350 },
];

const OVERRIDES = {
  austin: [ { externalId: 'DEMO-LATTE', priceCents: 525 }, { externalId: 'DEMO-AVOTOAST', priceCents: 995 } ],
  dallas: [ { externalId: 'DEMO-COLDBREW', priceCents: 450 } ],
  houston: [ { externalId: 'DEMO-LATTE', priceCents: 500 } ],
  // sanantonio: none → pure inheritance of the corporate default prices.
  fortworth: [ { externalId: 'DEMO-LATTE', priceCents: 425 }, { externalId: 'DEMO-AVOTOAST', isAvailable: false } ],
};

async function clean() {
  console.log('Cleaning Acme Coffee demo…');
  const locIds = LOCATIONS.map((l) => l.id);
  const allTenantIds = [ID.corporate, ...locIds];
  await prisma.menuLocationOverride.deleteMany({ where: { tenantId: { in: allTenantIds } } });
  await prisma.menuItem.deleteMany({ where: { catalogId: ID.catalog } });
  await prisma.menuCategory.deleteMany({ where: { catalogId: ID.catalog } });
  await prisma.menuCatalog.deleteMany({ where: { id: ID.catalog } });
  await prisma.screen.deleteMany({ where: { deviceFingerprint: { startsWith: 'demo-acme-' } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: allTenantIds } } });
  await prisma.user.deleteMany({ where: { id: ID.adminUser } });
  await prisma.tenant.deleteMany({ where: { id: { in: locIds } } });
  await prisma.tenant.deleteMany({ where: { id: ID.corporate } });
  console.log('Demo removed.');
}

async function seed() {
  console.log('Seeding Acme Coffee Co. (5-location demo)…');

  await prisma.tenant.upsert({
    where: { id: ID.corporate },
    update: { name: 'Acme Coffee Co. (Corporate)', vertical: 'RESTAURANT', address: '500 W 2nd St, Austin, TX 78701', latitude: 30.2669, longitude: -97.7497 },
    create: { id: ID.corporate, name: 'Acme Coffee Co. (Corporate)', slug: 'acme-coffee-corporate', vertical: 'RESTAURANT', address: '500 W 2nd St, Austin, TX 78701', latitude: 30.2669, longitude: -97.7497 },
  });

  for (const loc of LOCATIONS) {
    await prisma.tenant.upsert({
      where: { id: loc.id },
      update: { name: loc.name, parentId: ID.corporate, vertical: 'RESTAURANT', address: loc.address, latitude: loc.lat, longitude: loc.lng },
      create: { id: loc.id, name: loc.name, slug: loc.slug, parentId: ID.corporate, vertical: 'RESTAURANT', address: loc.address, latitude: loc.lat, longitude: loc.lng },
    });
  }

  const passwordHash = await argon2.hash('admin123', { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
  await prisma.user.upsert({
    where: { email: 'corporate@acme-coffee.demo' },
    update: {},
    create: { id: ID.adminUser, tenantId: ID.corporate, email: 'corporate@acme-coffee.demo', passwordHash, role: 'DISTRICT_ADMIN', firstName: 'Acme', lastName: 'Corporate' },
  });

  const now = new Date();
  let screenCount = 0;
  for (const loc of LOCATIONS) {
    for (let i = 0; i < SCREEN_ROLES.length; i++) {
      const fp = `demo-acme-${loc.key}-${i + 1}`;
      const shortName = `${loc.name.replace('Acme Coffee — ', '')} · ${SCREEN_ROLES[i]}`;
      await prisma.screen.upsert({
        where: { deviceFingerprint: fp },
        update: { name: shortName, tenantId: loc.id, status: 'ONLINE', lastPingAt: now, resolution: '1920x1080', address: loc.address, latitude: loc.lat, longitude: loc.lng },
        create: { name: shortName, deviceFingerprint: fp, tenantId: loc.id, status: 'ONLINE', lastPingAt: now, pairedAt: now, resolution: '1920x1080', orientation: 'LANDSCAPE', address: loc.address, latitude: loc.lat, longitude: loc.lng },
      });
      screenCount++;
    }
  }

  await prisma.menuCatalog.upsert({
    where: { id: ID.catalog },
    update: { name: 'Acme Coffee Menu', isActive: true },
    create: { id: ID.catalog, tenantId: ID.corporate, name: 'Acme Coffee Menu', isActive: true },
  });
  await prisma.menuCategory.upsert({ where: { id: ID.catCoffee }, update: { name: 'Coffee', sortOrder: 0 }, create: { id: ID.catCoffee, tenantId: ID.corporate, catalogId: ID.catalog, name: 'Coffee', sortOrder: 0 } });
  await prisma.menuCategory.upsert({ where: { id: ID.catFood }, update: { name: 'Food', sortOrder: 1 }, create: { id: ID.catFood, tenantId: ID.corporate, catalogId: ID.catalog, name: 'Food', sortOrder: 1 } });

  const itemIdByExternal = new Map();
  for (let i = 0; i < ITEMS.length; i++) {
    const it = ITEMS[i];
    const row = await prisma.menuItem.upsert({
      where: { id: it.id },
      update: { name: it.name, defaultPriceCents: it.price, categoryId: it.cat, externalId: it.externalId, sortOrder: i },
      create: { id: it.id, tenantId: ID.corporate, catalogId: ID.catalog, categoryId: it.cat, externalId: it.externalId, name: it.name, defaultPriceCents: it.price, sortOrder: i },
    });
    itemIdByExternal.set(it.externalId, row.id);
  }

  let overrideCount = 0;
  for (const loc of LOCATIONS) {
    for (const ov of OVERRIDES[loc.key] || []) {
      const menuItemId = itemIdByExternal.get(ov.externalId);
      if (!menuItemId) continue;
      await prisma.menuLocationOverride.upsert({
        where: { locationTenantId_menuItemId: { locationTenantId: loc.id, menuItemId } },
        update: { priceCents: ov.priceCents ?? null, isAvailable: ov.isAvailable ?? true, source: 'manual' },
        create: { tenantId: ID.corporate, locationTenantId: loc.id, menuItemId, priceCents: ov.priceCents ?? null, isAvailable: ov.isAvailable ?? true, source: 'manual' },
      });
      overrideCount++;
    }
  }

  console.log(`
✅ Acme Coffee demo seeded:
   • 1 Corporate parent + ${LOCATIONS.length} location tenants
   • ${screenCount} screens (3 per store), online + geo-located across Texas
   • 1 menu (${ITEMS.length} items, 2 categories) designed once at Corporate
   • ${overrideCount} per-location price/availability overrides

How to see it:
   • SUPER_ADMIN account switcher → "Acme Coffee Co. (Corporate)" and each
     "Acme Coffee — <city>" now appear in your dropdown. Switch into Corporate
     to see the menu + all 5 stores; switch into a store to see its screens.
   • Fleet map (Settings → Screens → Map): 5 Texas pins, 15 screens clustered.
   • Per-location pricing: Latte $4.50 default → $5.25 Austin, $5.00 Houston,
     $4.25 Fort Worth; Avocado Toast 86'd at Fort Worth; San Antonio has no
     overrides (shows the corporate defaults — inheritance).
   • Optional chain-admin login: corporate@acme-coffee.demo / admin123

Remove with: node packages/database/prisma/seed-multilocation-demo.mjs --clean
`);
}

(CLEAN ? clean() : seed())
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
