import {
  ProviderUsageService,
  vercelUsageLines,
} from './provider-usage.service';

const ENV_KEYS = [
  'BUSINESS_VERCEL_TOKEN',
  'BUSINESS_VERCEL_TEAM_ID',
  'BUSINESS_VERCEL_PROJECT_ID',
  'BUSINESS_RAILWAY_TOKEN',
  'BUSINESS_RAILWAY_WORKSPACE_ID',
] as const;
const now = new Date('2026-10-18T12:00:00.000Z');
const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Vercel billing JSON-lines', () => {
  it('scopes project usage and rounds only after summing provider dollar amounts', () => {
    const body = [
      {
        Tags: { ProjectId: 'ours' },
        ServiceName: 'Functions',
        BilledCost: 0.004,
      },
      {
        Tags: { ProjectId: 'ours' },
        ServiceName: 'Functions',
        BilledCost: 0.004,
      },
      {
        Tags: { ProjectId: 'another-project' },
        ServiceName: 'Functions',
        BilledCost: 200,
      },
    ]
      .map((item) => JSON.stringify(item))
      .join('\n');
    expect(vercelUsageLines(body, 'ours')).toEqual({
      accruedCostCents: 1,
      items: [{ label: 'Functions', costCents: 1 }],
    });
  });
  it.each([
    '{"BilledCost":"2"}',
    '{"BilledCost":-1}',
    '{"ServiceName":"Functions"}',
    'not JSON',
  ])('refuses invalid or absent provider cost evidence', (body) => {
    expect(() => vercelUsageLines(body)).toThrow();
  });
  it('accepts a successful empty usage period as zero', () => {
    expect(vercelUsageLines('')).toEqual({ accruedCostCents: 0, items: [] });
  });
});

describe('ProviderUsageService', () => {
  it('returns explicit connection states without contacting providers when unconfigured', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const result = await new ProviderUsageService().getReport(now);
    expect(result.sources.map((source) => source.state)).toEqual([
      'not_configured',
      'not_configured',
      'manual',
    ]);
    expect(
      result.sources.every((source) => source.accruedCostCents === null),
    ).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('requires explicit provider scope as well as a token', async () => {
    process.env.BUSINESS_VERCEL_TOKEN = 'test-only-usage-token';
    process.env.BUSINESS_RAILWAY_TOKEN = 'test-only-usage-token';
    const fetchSpy = jest.spyOn(global, 'fetch');
    await new ProviderUsageService().getReport(now);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('shares and caches concurrent requests and keeps credentials out of the report', async () => {
    process.env.BUSINESS_VERCEL_TOKEN = 'test-only-usage-token';
    process.env.BUSINESS_VERCEL_TEAM_ID = 'team-test';
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response('{"BilledCost":1.23,"ServiceName":"Functions"}\n'),
      );
    const service = new ProviderUsageService();
    const [first, second] = await Promise.all([
      service.getReport(now),
      service.getReport(now),
    ]);
    expect(first).toEqual(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first.sources[0].accruedCostCents).toBe(123);
    expect(JSON.stringify(first)).not.toContain('test-only-usage-token');
    await service.getReport(new Date(now.getTime() + 10_000));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it('returns unknown on provider failure without disclosing response bodies', async () => {
    process.env.BUSINESS_VERCEL_TOKEN = 'test-only-usage-token';
    process.env.BUSINESS_VERCEL_TEAM_ID = 'team-test';
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('private error detail', { status: 401 }));
    const result = await new ProviderUsageService().getReport(now);
    expect(result.sources[0].state).toBe('unavailable');
    expect(result.sources[0].accruedCostCents).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private error detail');
  });
  it('reads Railway authoritative workspace usage without hardcoded pricing', async () => {
    process.env.BUSINESS_RAILWAY_TOKEN = 'test-only-usage-token';
    process.env.BUSINESS_RAILWAY_WORKSPACE_ID = 'workspace-test';
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            workspace: {
              customer: {
                currentUsage: 15.42,
                billingPeriod: {
                  start: '2026-10-01T00:00:00.000Z',
                  end: '2026-11-01T00:00:00.000Z',
                },
              },
            },
          },
        }),
      ),
    );
    const result = await new ProviderUsageService().getReport(now);
    expect(result.sources[1]).toMatchObject({
      state: 'connected',
      scope: 'workspace',
      accruedCostCents: 1542,
    });
  });
  it('does not convert missing Railway currentUsage to zero', async () => {
    process.env.BUSINESS_RAILWAY_TOKEN = 'test-only-usage-token';
    process.env.BUSINESS_RAILWAY_WORKSPACE_ID = 'workspace-test';
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            workspace: {
              customer: {
                currentUsage: null,
                billingPeriod: { start: '2026-10-01', end: '2026-11-01' },
              },
            },
          },
        }),
      ),
    );
    const result = await new ProviderUsageService().getReport(now);
    expect(result.sources[1].state).toBe('unavailable');
    expect(result.sources[1].accruedCostCents).toBeNull();
  });
});
