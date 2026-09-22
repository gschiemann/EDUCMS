/**
 * Which saved AI key a tenant's AI calls use (2026-09-22): its OWN key, else the nearest ANCESTOR's.
 *
 * A key saved on an organisation (a district, a chain's head office) covers every location under
 * it — the same organisation the included allowance is already pooled at (ai-allowance.service.ts).
 * Before this, a location with no key of its own went straight to OUR key even when its
 * organisation had one: Greg saved his OpenAI key on "RIOT Las Vegas - Downtown", and its five
 * locations drew their boards with Claude on our key instead of GPT-6 Sol on his.
 *
 * A location that saves its OWN key keeps using it (nearest key wins), and a location's own key
 * that cannot be read is still that location's problem — the walk stops at the first row that HAS
 * a key, readable or not, so a broken key never silently borrows the organisation's.
 */
import { MAX_TENANT_TREE_DEPTH } from '../emergency/tenant-hierarchy';

export interface TenantAiKeyRow {
  /** The tenant the key is saved on (the caller itself, or an ancestor). */
  keyTenantId: string;
  aiProvider: string | null;
  aiKeyEncrypted: string;
  aiModel: string | null;
  /** True when the key belongs to an ancestor, not the tenant itself. */
  inherited: boolean;
}

type TenantReader = {
  tenant: {
    findUnique(args: {
      where: { id: string };
      select: Record<string, boolean>;
    }): Promise<unknown>;
  };
};

export async function findTenantAiKeyRow(
  client: TenantReader,
  tenantId: string,
): Promise<TenantAiKeyRow | null> {
  let current = tenantId;
  const seen = new Set<string>([tenantId]);
  for (let depth = 0; depth < MAX_TENANT_TREE_DEPTH; depth++) {
    // ten-ok: walks UP the caller's OWN tenant chain (the authenticated tenant, then its parents)
    // to find the nearest saved AI key; the id is never caller input.
    const row = (await client.tenant.findUnique({
      where: { id: current },
      select: {
        parentId: true,
        aiProvider: true,
        aiKeyEncrypted: true,
        aiModel: true,
      },
    })) as {
      parentId?: string | null;
      aiProvider?: string | null;
      aiKeyEncrypted?: string | null;
      aiModel?: string | null;
    } | null;
    if (!row) return null;
    if (row.aiKeyEncrypted) {
      return {
        keyTenantId: current,
        aiProvider: row.aiProvider ?? null,
        aiKeyEncrypted: row.aiKeyEncrypted,
        aiModel: row.aiModel ?? null,
        inherited: current !== tenantId,
      };
    }
    const parent = row.parentId || null;
    if (!parent || seen.has(parent)) return null;
    seen.add(parent);
    current = parent;
  }
  return null;
}
