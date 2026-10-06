/**
 * Repair an already-enabled corporate account's initial location setup.
 * Dry run is the default and performs reads only. Uses the same initializer
 * as corporate enablement; never triggers/clears an alert or replaces local edits.
 *
 * pnpm --filter api exec ts-node --transpile-only scripts/initialize-emergency-locations.ts \
 *   --tenant-id <corporate-id> --env-file <api-env-path> [--apply --all-locations | --apply --location-id <child-id>]
 *
 * Apply records immutable per-location audits and a maintenance summary audit
 * with userId=null (system maintenance, never impersonation of a human session).
 */
import * as dotenv from 'dotenv';
import { PrismaClient } from '@cms/database';
import { effectiveEmergencyEnabled } from '@cms/api-types';
import { collectDescendantTenantIds } from '../src/emergency/tenant-hierarchy';
import { initializeEmergencyLocations } from '../src/tenants/emergency-defaults';

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => args[args.indexOf(name) + 1];
  const tenantId = args.includes('--tenant-id') ? value('--tenant-id') : '';
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      tenantId,
    )
  ) {
    throw new Error(
      'Provide --tenant-id with the enabled corporate account UUID. Default mode is read-only.',
    );
  }
  if (args.includes('--env-file'))
    dotenv.config({ path: value('--env-file'), quiet: true });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (
    databaseUrl.port !== '5432' ||
    databaseUrl.searchParams.has('pgbouncer')
  ) {
    throw new Error(
      'Use the approved session-mode database connection (5432, no pgbouncer parameter).',
    );
  }
  const dryRun = !args.includes('--apply');
  const selectedIds = args.flatMap((arg, index) =>
    arg === '--location-id' ? [args[index + 1]] : [],
  );
  if (!dryRun && !args.includes('--all-locations') && !selectedIds.length) {
    throw new Error(
      'Choose --all-locations or one or more --location-id arguments before applying.',
    );
  }
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const root = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: {
            parentId: true,
            archivedAt: true,
            vertical: true,
            emergencyEnabled: true,
          },
        });
        if (
          !root ||
          root.archivedAt ||
          root.parentId ||
          !effectiveEmergencyEnabled(root.vertical, root.emergencyEnabled)
        ) {
          throw new Error(
            'The target must be a non-archived, already-enabled top-level account.',
          );
        }
        const descendants = await collectDescendantTenantIds(
          tx.tenant,
          tenantId,
        );
        if (selectedIds.some((id) => !descendants.includes(id))) {
          throw new Error(
            'Every selected location must belong to the corporate account.',
          );
        }
        const targets = selectedIds.length
          ? [...new Set(selectedIds)]
          : descendants;
        const changes = await initializeEmergencyLocations(
          tx,
          tenantId,
          targets,
          null,
          'maintenance',
          { dryRun },
        );
        if (!dryRun)
          await tx.auditLog.create({
            data: {
              tenantId,
              userId: null,
              action: 'CORPORATE_EMERGENCY_DEFAULTS_INITIALIZED',
              targetType: 'Tenant',
              targetId: tenantId,
              details: JSON.stringify({
                maintenance: true,
                script: 'initialize-emergency-locations',
                descendants: descendants.length,
                selectedLocations: targets.length,
                ...changes,
              }),
            },
          });
        return {
          mode: dryRun ? 'read-only plan' : 'applied',
          descendants: descendants.length,
          selectedLocations: targets.length,
          ...changes,
        };
      },
      { timeout: 30000 },
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  // Never print connection strings, SQL parameters or customer media URLs.
  console.error(
    error instanceof Error ? error.message : 'Emergency initialization failed.',
  );
  process.exitCode = 1;
});
