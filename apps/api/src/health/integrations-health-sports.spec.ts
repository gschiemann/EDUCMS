import { SCORE_SOURCES } from '@cms/api-types';
import {
  IntegrationsHealthController,
  type IntegrationRow,
} from './integrations-health.controller';

/**
 * K12-F33 — the Integrations page's sports rows say what each score source
 * IS, from the one list in @cms/api-types sports-sources.ts: the console and
 * the generic feed work; Sportzcast / Scorebird are recipes on that feed; a
 * scoreboard console is experimental hardware with a short sport list; a
 * provider with no connector is unavailable. Nothing unbuilt reads as
 * working or connected.
 */
function controller(gameCount: number) {
  const prisma = {
    client: { game: { count: jest.fn(async () => gameCount) } },
  } as any;
  return new IntegrationsHealthController(
    prisma,
    {} as any,
    {} as any,
    {} as any,
  );
}

async function sportsRows(gameCount = 0): Promise<IntegrationRow[]> {
  return (controller(gameCount) as any).probeSports(
    'tenant-1',
    '2026-09-27T12:00:00.000Z',
  );
}

describe('sports integration rows (K12-F33)', () => {
  it('one row per score source, in the list order', async () => {
    const rows = await sportsRows();
    expect(rows.map((r) => r.id)).toEqual(
      SCORE_SOURCES.map((s) => `sports-${s.id}`),
    );
    expect(rows.every((r) => r.category === 'sports')).toBe(true);
  });

  it('the console and the generic feed are ready; the vendor recipes say there is no native adapter', async () => {
    const byId = new Map((await sportsRows(2)).map((r) => [r.id, r]));
    expect(byId.get('sports-manual')?.status).toBe('READY');
    expect(byId.get('sports-generic-feed')?.status).toBe('READY');
    expect(byId.get('sports-generic-feed')?.message).toMatch(/SENDER is yours/);
    for (const id of ['sports-sportzcast', 'sports-scorebird']) {
      expect(byId.get(id)?.status).toBe('READY');
      expect(byId.get(id)?.message).toMatch(/no native .* adapter/);
    }
  });

  it('a scoreboard console is experimental and names the only sports it decodes', async () => {
    const byId = new Map((await sportsRows()).map((r) => [r.id, r]));
    const cts = byId.get('sports-cts-console')!;
    const dak = byId.get('sports-daktronics-allsport')!;
    for (const row of [cts, dak]) {
      expect(row.status).toBe('NOT_CONFIGURED');
      expect(row.message).toMatch(/^Experimental hardware/);
      expect(row.message).toMatch(/any other sport is refused/);
    }
    expect(cts.message).toMatch(/Water Polo only/);
    expect(dak.message).toMatch(
      /Football, Basketball, Baseball, Softball only/,
    );
  });

  it('a provider with no connector is unavailable, and nothing unbuilt says connected or working', async () => {
    const rows = await sportsRows(3);
    for (const id of [
      'genius-sports',
      'sportradar',
      'maxpreps',
      'gamechanger',
      'nfhs-network',
    ]) {
      const row = rows.find((r) => r.id === `sports-${id}`)!;
      expect(row.status).toBe('COMING_SOON');
      expect(row.message).toMatch(/^Not available — no .* connector exists/);
    }
    for (const row of rows.filter((r) => r.status !== 'READY')) {
      expect(row.message).not.toMatch(/\bconnected\b|\bworking\b|\blive\b/i);
    }
  });
});
