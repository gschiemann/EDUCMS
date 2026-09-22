/**
 * A location with no AI key of its own uses its organisation's (2026-09-22). Greg saved his OpenAI
 * key on "RIOT Las Vegas - Downtown"; its five child locations went to OUR key — Claude — instead.
 */
import { findTenantAiKeyRow } from './ai-tenant-key';

function fakeClient(
  rows: Record<
    string,
    {
      parentId?: string | null;
      aiProvider?: string | null;
      aiKeyEncrypted?: string | null;
      aiModel?: string | null;
    }
  >,
) {
  const findUnique = jest.fn(async ({ where, select }: any) => {
    const row = rows[where.id];
    if (!row) return null;
    const out: any = {};
    for (const k of Object.keys(select))
      if (select[k]) out[k] = (row as any)[k] ?? null;
    return out;
  });
  return { client: { tenant: { findUnique } }, findUnique };
}

describe('findTenantAiKeyRow — own key, else the nearest ancestor', () => {
  it('a tenant with its own key uses it (not inherited)', async () => {
    const { client } = fakeClient({
      riot: {
        parentId: null,
        aiProvider: 'openai',
        aiKeyEncrypted: 'sealed-riot',
        aiModel: 'gpt-5',
      },
    });
    await expect(findTenantAiKeyRow(client, 'riot')).resolves.toEqual({
      keyTenantId: 'riot',
      aiProvider: 'openai',
      aiKeyEncrypted: 'sealed-riot',
      aiModel: 'gpt-5',
      inherited: false,
    });
  });

  it("a location with no key uses its organisation's — the RIOT case", async () => {
    const { client } = fakeClient({
      riot: {
        parentId: null,
        aiProvider: 'openai',
        aiKeyEncrypted: 'sealed-riot',
        aiModel: 'gpt-5',
      },
      henderson: { parentId: 'riot' },
    });
    await expect(
      findTenantAiKeyRow(client, 'henderson'),
    ).resolves.toMatchObject({
      keyTenantId: 'riot',
      aiProvider: 'openai',
      aiKeyEncrypted: 'sealed-riot',
      inherited: true,
    });
  });

  it('walks more than one level, and the NEAREST key wins', async () => {
    const { client } = fakeClient({
      district: {
        parentId: null,
        aiProvider: 'anthropic',
        aiKeyEncrypted: 'sealed-district',
      },
      region: {
        parentId: 'district',
        aiProvider: 'openai',
        aiKeyEncrypted: 'sealed-region',
      },
      school: { parentId: 'region' },
      classroom: { parentId: 'school' },
    });
    await expect(
      findTenantAiKeyRow(client, 'classroom'),
    ).resolves.toMatchObject({ keyTenantId: 'region', aiProvider: 'openai' });
    await expect(findTenantAiKeyRow(client, 'region')).resolves.toMatchObject({
      keyTenantId: 'region',
      inherited: false,
    });
  });

  it("stops at the first key, readable or not — a location's own broken key never borrows the organisation's", async () => {
    const { client, findUnique } = fakeClient({
      org: {
        parentId: null,
        aiProvider: 'openai',
        aiKeyEncrypted: 'sealed-org',
      },
      site: {
        parentId: 'org',
        aiProvider: 'openai',
        aiKeyEncrypted: 'garbage-that-will-not-decrypt',
      },
    });
    await expect(findTenantAiKeyRow(client, 'site')).resolves.toMatchObject({
      keyTenantId: 'site',
      aiKeyEncrypted: 'garbage-that-will-not-decrypt',
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('no key anywhere up the chain → null (our key, or "not configured")', async () => {
    const { client } = fakeClient({
      org: { parentId: null },
      site: { parentId: 'org' },
    });
    await expect(findTenantAiKeyRow(client, 'site')).resolves.toBeNull();
  });

  it('survives a parent cycle and a missing row without looping or throwing', async () => {
    const { client, findUnique } = fakeClient({
      a: { parentId: 'b' },
      b: { parentId: 'a' },
    });
    await expect(findTenantAiKeyRow(client, 'a')).resolves.toBeNull();
    expect(findUnique.mock.calls.length).toBeLessThanOrEqual(3);
    const { client: c2 } = fakeClient({ a: { parentId: 'gone' } });
    await expect(findTenantAiKeyRow(c2, 'a')).resolves.toBeNull();
  });
});
