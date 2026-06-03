/**
 * Scale the Acme Coffee demo to ~50 US locations × 3 screens (~150 screens).
 * ─────────────────────────────────────────────────────────────────────────
 * Adds ~45 nationwide child locations under the existing "Acme Coffee Co.
 * (Corporate)" parent (keeps the original 5 Texas stores), each with 3 screens,
 * real-ish addresses + city-center lat/lng so they spread across the US map.
 *
 * Screens are seeded ONLINE (lastPingAt = now) so the fleet reads "all online";
 * the alerting test then ages subsets to drive them offline.
 *
 * Additive + idempotent (deterministic UUIDs, upserts; re-run safe). Demo-only
 * rows (deviceFingerprint demo-acme-*). Run from repo root:
 *   node packages/database/prisma/seed-50-locations.mjs
 *   node packages/database/prisma/seed-50-locations.mjs --clean   (removes the +45)
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../.env') });
loadEnv({ path: resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();
const CLEAN = process.argv.includes('--clean');
const CORP = 'ac0c0000-0000-0000-0000-000000000001';
const SCREEN_ROLES = ['Drive-Thru Menu', 'Lobby Menu Board', 'Counter Display'];

// The original 5 (kept, reusing their ids so we don't duplicate them).
const EXISTING = [
  { id: 'ac0c0000-0000-0000-0000-0000000000a1', key: 'austin', city: 'Austin, TX', slug: 'acme-austin', address: '1500 S Congress Ave, Austin, TX 78704', lat: 30.2504, lng: -97.7501 },
  { id: 'ac0c0000-0000-0000-0000-0000000000a2', key: 'dallas', city: 'Dallas, TX', slug: 'acme-dallas', address: '2800 Main St, Dallas, TX 75226', lat: 32.7841, lng: -96.7842 },
  { id: 'ac0c0000-0000-0000-0000-0000000000a3', key: 'houston', city: 'Houston, TX', slug: 'acme-houston', address: '1200 Westheimer Rd, Houston, TX 77006', lat: 29.7450, lng: -95.3902 },
  { id: 'ac0c0000-0000-0000-0000-0000000000a4', key: 'sanantonio', city: 'San Antonio, TX', slug: 'acme-san-antonio', address: '303 Pearl Pkwy, San Antonio, TX 78215', lat: 29.4432, lng: -98.4803 },
  { id: 'ac0c0000-0000-0000-0000-0000000000a5', key: 'fortworth', city: 'Fort Worth, TX', slug: 'acme-fort-worth', address: '420 Main St, Fort Worth, TX 76102', lat: 32.7556, lng: -97.3309 },
];

// 45 more, spread across the country. [city, key, lat, lng]
const CITIES = [
  ['New York, NY', 'new-york', 40.7128, -74.0060], ['Los Angeles, CA', 'los-angeles', 34.0522, -118.2437],
  ['Chicago, IL', 'chicago', 41.8781, -87.6298], ['Phoenix, AZ', 'phoenix', 33.4484, -112.0740],
  ['Philadelphia, PA', 'philadelphia', 39.9526, -75.1652], ['San Diego, CA', 'san-diego', 32.7157, -117.1611],
  ['San Jose, CA', 'san-jose', 37.3382, -121.8863], ['Jacksonville, FL', 'jacksonville', 30.3322, -81.6557],
  ['Columbus, OH', 'columbus', 39.9612, -82.9988], ['Charlotte, NC', 'charlotte', 35.2271, -80.8431],
  ['Indianapolis, IN', 'indianapolis', 39.7684, -86.1581], ['Seattle, WA', 'seattle', 47.6062, -122.3321],
  ['Denver, CO', 'denver', 39.7392, -104.9903], ['Washington, DC', 'washington-dc', 38.9072, -77.0369],
  ['Boston, MA', 'boston', 42.3601, -71.0589], ['Nashville, TN', 'nashville', 36.1627, -86.7816],
  ['Portland, OR', 'portland', 45.5152, -122.6784], ['Las Vegas, NV', 'las-vegas', 36.1699, -115.1398],
  ['Detroit, MI', 'detroit', 42.3314, -83.0458], ['Memphis, TN', 'memphis', 35.1495, -90.0490],
  ['Louisville, KY', 'louisville', 38.2527, -85.7585], ['Milwaukee, WI', 'milwaukee', 43.0389, -87.9065],
  ['Albuquerque, NM', 'albuquerque', 35.0844, -106.6504], ['Tucson, AZ', 'tucson', 32.2226, -110.9747],
  ['Fresno, CA', 'fresno', 36.7378, -119.7871], ['Sacramento, CA', 'sacramento', 38.5816, -121.4944],
  ['Kansas City, MO', 'kansas-city', 39.0997, -94.5786], ['Atlanta, GA', 'atlanta', 33.7490, -84.3880],
  ['Miami, FL', 'miami', 25.7617, -80.1918], ['Raleigh, NC', 'raleigh', 35.7796, -78.6382],
  ['Omaha, NE', 'omaha', 41.2565, -95.9345], ['Minneapolis, MN', 'minneapolis', 44.9778, -93.2650],
  ['Tampa, FL', 'tampa', 27.9506, -82.4572], ['New Orleans, LA', 'new-orleans', 29.9511, -90.0715],
  ['Cleveland, OH', 'cleveland', 41.4993, -81.6944], ['Pittsburgh, PA', 'pittsburgh', 40.4406, -79.9959],
  ['Cincinnati, OH', 'cincinnati', 39.1031, -84.5120], ['St. Louis, MO', 'st-louis', 38.6270, -90.1994],
  ['Orlando, FL', 'orlando', 28.5383, -81.3792], ['Salt Lake City, UT', 'salt-lake-city', 40.7608, -111.8910],
  ['Richmond, VA', 'richmond', 37.5407, -77.4360], ['Buffalo, NY', 'buffalo', 42.8864, -78.8784],
  ['Boise, ID', 'boise', 43.6150, -116.2023], ['Oklahoma City, OK', 'oklahoma-city', 35.4676, -97.5164],
  ['Hartford, CT', 'hartford', 41.7658, -72.6734],
];

const NEW = CITIES.map((c, i) => ({
  id: `ac0c0000-0000-0000-0000-1${String(i + 1).padStart(11, '0')}`,
  key: c[1], city: c[0], slug: `acme-${c[1]}`,
  address: `${100 + i} Main St, ${c[0]}`, lat: c[2], lng: c[3],
}));

const LOCATIONS = [...EXISTING, ...NEW];

async function clean() {
  const newIds = NEW.map((l) => l.id);
  console.log(`Removing ${newIds.length} added locations + their screens…`);
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: newIds } } });
  await prisma.schedule.deleteMany({ where: { tenantId: { in: newIds } } });
  await prisma.screen.deleteMany({ where: { tenantId: { in: newIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: newIds } } });
  console.log('Removed the +45 (original 5 Texas stores untouched).');
}

async function seed() {
  console.log(`Scaling Acme to ${LOCATIONS.length} locations × 3 screens…`);
  const corp = await prisma.tenant.findUnique({ where: { id: CORP }, select: { id: true } });
  if (!corp) throw new Error('Corporate parent not found — run seed-multilocation-demo.mjs first.');

  const now = new Date();
  let tenantCount = 0, screenCount = 0;
  for (const loc of LOCATIONS) {
    await prisma.tenant.upsert({
      where: { id: loc.id },
      update: { name: `Acme Coffee — ${loc.city.split(',')[0]}`, parentId: CORP, vertical: 'RESTAURANT', address: loc.address, latitude: loc.lat, longitude: loc.lng },
      create: { id: loc.id, name: `Acme Coffee — ${loc.city.split(',')[0]}`, slug: loc.slug, parentId: CORP, vertical: 'RESTAURANT', address: loc.address, latitude: loc.lat, longitude: loc.lng },
    });
    tenantCount++;
    for (let i = 0; i < SCREEN_ROLES.length; i++) {
      const fp = `demo-acme-${loc.key}-${i + 1}`;
      const shortName = `${loc.city.split(',')[0]} · ${SCREEN_ROLES[i]}`;
      await prisma.screen.upsert({
        where: { deviceFingerprint: fp },
        update: { name: shortName, tenantId: loc.id, status: 'ONLINE', lastPingAt: now, resolution: '1920x1080', address: loc.address, latitude: loc.lat, longitude: loc.lng },
        create: { name: shortName, deviceFingerprint: fp, tenantId: loc.id, status: 'ONLINE', lastPingAt: now, pairedAt: now, resolution: '1920x1080', orientation: 'LANDSCAPE', address: loc.address, latitude: loc.lat, longitude: loc.lng },
      });
      screenCount++;
    }
  }
  console.log(`✅ ${tenantCount} locations, ${screenCount} screens (all ONLINE), nationwide.`);
}

(CLEAN ? clean() : seed())
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
