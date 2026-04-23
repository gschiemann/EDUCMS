/**
 * One-shot seed for the AGC Education pilot.
 *
 * Provisions a dedicated K-12 tenant ("AGC Education") and two
 * SCHOOL_ADMIN users (chuck + larry @agceducation.com) with
 * `canTriggerPanic: true` so they can exercise the full emergency
 * flow during the pilot.
 *
 * NOT wired into the main seed (`pnpm db:seed`) on purpose — this is
 * a customer-specific bootstrap. Runs idempotently: upsert by tenant
 * slug and user email, so running it twice is safe.
 *
 * Canonical Argon2id settings mirror apps/api/src/auth/crypto.config.ts
 * (memoryCost 65536, timeCost 3, parallelism 4). Keep them aligned or
 * login will reject hashes minted here.
 *
 * Run with:
 *   pnpm tsx packages/database/scripts/seed-agc-pilot.ts
 *
 * Requires DATABASE_URL + DIRECT_URL in the environment (same as every
 * other Prisma script in this package).
 */

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// Mirrors apps/api/src/auth/crypto.config.ts. Do not diverge from
// the API's verification options or login breaks for these accounts.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64MB
  timeCost: 3,
  parallelism: 4,
} as const;

const TENANT_SLUG = 'agc-education';
const TENANT_NAME = 'AGC Education';

const PILOT_USERS: Array<{ email: string; password: string }> = [
  { email: 'chuck@agceducation.com', password: '12345678' },
  { email: 'larry@agceducation.com', password: '12345678' },
];

async function main() {
  console.log(`Seeding AGC Education pilot...`);

  // 1. Tenant — upsert by unique slug. If someone manually created one
  //    with the same slug already, we keep it and just ensure the
  //    vertical/name are right.
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: {
      name: TENANT_NAME,
      vertical: 'K12',
    },
    create: {
      name: TENANT_NAME,
      slug: TENANT_SLUG,
      vertical: 'K12',
    },
  });

  console.log(`  Tenant: ${tenant.name} (id=${tenant.id}, slug=${tenant.slug})`);

  // 2. Users — one argon2 hash per user (the algorithm embeds a salt
  //    so we can't share a hash). Upsert by email. On update we leave
  //    the passwordHash alone so rotating the script doesn't quietly
  //    reset a password an operator already changed in the UI.
  for (const { email, password } of PILOT_USERS) {
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        // Keep role + panic capability aligned with the pilot spec
        // without overwriting the hash / status.
        tenantId: tenant.id,
        role: 'SCHOOL_ADMIN',
        canTriggerPanic: true,
      },
      create: {
        tenantId: tenant.id,
        email,
        passwordHash,
        role: 'SCHOOL_ADMIN',
        canTriggerPanic: true,
        status: 'ACTIVE',
      },
    });

    console.log(
      `  User: ${user.email} (id=${user.id}, role=${user.role}, canTriggerPanic=${user.canTriggerPanic})`
    );
  }

  console.log('AGC Education pilot seed complete.');
}

main()
  .catch((e) => {
    console.error('[seed-agc-pilot] failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
