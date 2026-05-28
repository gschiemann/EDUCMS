/**
 * Companion to close-clock-bugs.ts — moves bugs that have been
 * shipped (commit on master, close-out email manually fired via
 * Resend) into APPROVED status in the DB so the audit trail shows
 * the right state.
 *
 * The /approve API endpoint normally does this AND fires the email.
 * We're inverting the order (email first, DB second) because Greg's
 * email pipeline broke on 2026-05-28 — the close-out script bypassed
 * the controller's fire-and-forget email path, so the close-out
 * email never fired. Firing it directly via Resend was the fastest
 * way to get him his "fix shipped" notification; this script then
 * catches the DB state up.
 *
 * Run:
 *   cd apps/api && ./node_modules/.bin/ts-node --transpile-only scripts/mark-bugs-shipped.ts
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const prisma = new PrismaClient();

const SHIPPED = [
  { id: '046d73aa-e869-4416-b852-2b1f12cb0516', sha: '9242bc0' },
  { id: '51494dff-59c4-466a-a46d-54d6d733c0c8', sha: 'bf7cf2d' },
  { id: '97f54357-c5ec-40f9-957c-ef8579c4a55a', sha: 'bb065e3' },
];

const SUPER_ADMIN_ID = '93f2fede-2bd1-43e7-a445-6b92f2ae7a72'; // greg.schiemann@e-arc.com

async function main() {
  console.log(`Marking ${SHIPPED.length} clock bugs as APPROVED (post-close-out)…\n`);

  for (const { id, sha } of SHIPPED) {
    const bug = await prisma.bug.findUnique({ where: { id } });
    if (!bug) {
      console.log(`  ✗  ${id.slice(0, 8)} — not found`);
      continue;
    }
    if (['APPROVED', 'SHIPPED', 'REJECTED', 'DUPLICATE'].includes(bug.status)) {
      console.log(`  ↷  ${id.slice(0, 8)} — already ${bug.status}`);
      continue;
    }

    await prisma.bug.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: SUPER_ADMIN_ID,
        approvedAt: new Date(),
        fixCommitSha: sha,
        fixBranchName: `direct-master:${sha}`,
        shippedAt: new Date(),
      },
    });

    // Audit log for forensics.
    await prisma.auditLog.create({
      data: {
        tenantId: bug.tenantId,
        userId: SUPER_ADMIN_ID,
        action: 'BUG_APPROVED',
        targetType: 'BUG',
        targetId: id,
        details: JSON.stringify({
          source: 'mark-bugs-shipped script (post-Resend manual close-out)',
          commitSha: sha,
          emailDispatched: true,
        }),
      },
    });

    console.log(`  ✓  ${id.slice(0, 8)} → APPROVED (commit ${sha})`);
  }

  console.log('\nDone.');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
