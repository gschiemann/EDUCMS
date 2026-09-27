/**
 * Shared SportsService harness for the K12 launch specs (lane A1, 2026-09-26):
 * the real service over sports-prisma-fake.ts, with the collaborators stubbed.
 * Test-only — imported by *.spec.ts files, never by application code. It uses
 * no jest globals on purpose: this file is inside src/, so the app build
 * compiles it (the same arrangement as tenant-isolation/two-tenant-prisma.ts).
 */
import { SportsService } from './sports.service';
import { makeSportsPrismaFake } from './sports-prisma-fake';

export const TENANT = 'tenant-1';

export function setup(opts: { playerStats?: boolean; vertical?: string } = {}) {
  const { client, tables } = makeSportsPrismaFake({
    game: {
      // Mirrors the column defaults in schema.prisma.
      defaults: {
        homeScore: 0,
        awayScore: 0,
        version: 0,
        stats: {},
        spotlight: {},
        status: 'SCHEDULED',
        possession: null,
        feedTokenVersion: 0,
        consoleTokenVersion: 0,
        autoPushAt: null,
      },
    },
    gameEvent: {},
    gameCommand: { uniques: [['gameId', 'commandId']] },
    gameStatRollup: { pk: 'gameId' },
    screen: {},
    sponsor: {},
    rosterPlayer: {},
    customCue: {},
    auditLog: {},
    template: {},
    playerSeasonStat: { uniques: [['personId', 'season', 'statKey', 'sport']] },
    playerCareerStat: { uniques: [['personId', 'statKey', 'sport']] },
    // K-12 launch, lane B3: the public board reads the tenant's student
    // privacy policy. The harness tenant is a sports VENUE by default (the
    // per-game switches alone decide); pass `vertical: 'K12'` for a school.
    tenant: {},
    studentPrivacyPolicy: { pk: 'tenantId' },
    sportsPerson: {},
    user: {},
  });
  tables.tenant.rows.push({
    id: TENANT,
    name: 'Test Tenant',
    vertical: opts.vertical ?? 'SPORTS',
    parentId: null,
  });
  tables.template.rows.push(
    { id: 'tmpl-board', tenantId: TENANT, isSystem: false },
    { id: 'tmpl-ribbon', tenantId: TENANT, isSystem: false },
    { id: 'tmpl-scorebug', tenantId: TENANT, isSystem: false },
  );
  const prisma = { client };
  const published: Array<{ channel: string; message: unknown }> = [];
  const redis = {
    publish: async (channel: string, message: unknown) => {
      published.push({ channel, message });
    },
  };
  const signer = { signMessage: () => ({ eventId: 'e', signature: 's' }) };
  const sponsorsService = { listActive: async () => [] };
  const flags = { isEnabledAsync: async () => !!opts.playerStats };
  const service = new SportsService(
    prisma as any,
    redis as any,
    signer as any,
    sponsorsService as any,
    flags as any,
  );
  return {
    service,
    client,
    tables,
    flags,
    published,
    game: tables.game,
    gameEvent: tables.gameEvent,
    gameCommand: tables.gameCommand,
    screen: tables.screen,
    auditLog: tables.auditLog,
    rosterPlayer: tables.rosterPlayer,
  };
}

export async function newGame(service: SportsService, sport = 'football') {
  return service.createGame(TENANT, {
    sport,
    homeTeam: 'Home',
    awayTeam: 'Away',
  });
}
