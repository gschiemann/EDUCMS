/**
 * One-off cleanup (2026-05-28) — demote the seed admin@springfield.edu
 * SUPER_ADMIN so the bug owner-alert fan-out stops sending into Resend's
 * suppression list (where it's been auto-suppressed after bounces).
 *
 * Symptom Greg hit: "no bug emails getting sent" — Resend's API said
 * SENT but the email was actually `suppressed` (auto-suppression for an
 * unreachable address). With the seed admin still SUPER_ADMIN, every
 * bug fan-out tries both Greg AND springfield, and the springfield
 * attempt is the one Greg's been watching fail.
 *
 * Demote to CONTRIBUTOR (keeping the seed-data tenant playable in dev)
 * rather than delete — preserves referential integrity for any audit
 * log rows that reference this user_id.
 *
 * Combined with the controller fix (include reporter in owner-alert
 * fan-out when they're the only remaining super-admin), Greg now gets
 * a single owner-flavored email per bug he files (rather than zero).
 *
 * Run:
 *   cd apps/api && ./node_modules/.bin/ts-node --transpile-only scripts/demote-seed-admin.ts
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const prisma = new PrismaClient();

async function main() {
  const seed = await prisma.user.findUnique({
    where: { email: 'admin@springfield.edu' },
  });
  if (!seed) {
    console.log('No seed admin found, nothing to do.');
    await prisma.$disconnect();
    return;
  }
  if (seed.role !== 'SUPER_ADMIN') {
    console.log(`Seed admin already ${seed.role}, leaving alone.`);
    await prisma.$disconnect();
    return;
  }

  await prisma.user.update({
    where: { id: seed.id },
    data: { role: 'CONTRIBUTOR' },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: seed.tenantId,
      userId: '93f2fede-2bd1-43e7-a445-6b92f2ae7a72', // Greg
      action: 'USER_ROLE_CHANGED',
      targetType: 'USER',
      targetId: seed.id,
      details: JSON.stringify({
        source: 'demote-seed-admin script',
        reason: 'Resend auto-suppression of admin@springfield.edu was swallowing every owner-alert email; seed account stays in DB for referential integrity but no longer counts as a notification target.',
        from: 'SUPER_ADMIN',
        to: 'CONTRIBUTOR',
      }),
    },
  });

  console.log(`✓ Demoted admin@springfield.edu (${seed.id}) SUPER_ADMIN → CONTRIBUTOR`);
  console.log('  Bug owner-alert fan-outs no longer route through Resend\'s suppression list.');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
