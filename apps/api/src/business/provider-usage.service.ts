import { Injectable } from '@nestjs/common';

export interface ProviderUsageSource {
  provider: 'vercel' | 'railway' | 'supabase';
  state: 'connected' | 'not_configured' | 'unavailable' | 'manual';
  scope: 'project' | 'team' | 'workspace' | 'organization';
  periodStart: string | null;
  periodEnd: string | null;
  observedAt: string | null;
  accruedCostCents: number | null;
  items: Array<{ label: string; costCents: number }>;
  href: string;
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const CACHE_MS = 5 * 60_000;
const WORKSPACE_USAGE_QUERY = `query BusinessUsage($workspaceId: String!) {
  workspace(workspaceId: $workspaceId) {
    customer { currentUsage billingPeriod { start end } }
  }
}`;

/** Bounded across body consumption; provider errors never return credentials or response text. */
async function boundedText(url: string, init: RequestInit): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8_000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: abort.signal,
      redirect: 'error',
    });
    if (!response.ok || !response.body)
      throw new Error('Provider usage unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          abort.abort();
          throw new Error('Provider usage response exceeds limit');
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid usage response');
  return value as Record<string, unknown>;
}
function cents(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1e9
  )
    throw new Error('Invalid usage amount');
  return value * 100;
}

/** Vercel CLI's documented usage command reads JSON-lines BilledCost, denominated in USD. */
export function vercelUsageLines(body: string, projectId?: string) {
  const items = new Map<string, number>();
  let total = 0;
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const charge = record(JSON.parse(line));
    if (projectId) {
      const tags = record(charge.Tags ?? {});
      if (tags.ProjectId !== projectId) continue;
    }
    // Absent/invalid billed-cost data is unknown, never an invented zero.
    const amount = cents(charge.BilledCost);
    const service =
      typeof charge.ServiceName === 'string' ? charge.ServiceName : 'Usage';
    total += amount;
    items.set(service, (items.get(service) ?? 0) + amount);
  }
  return {
    accruedCostCents: Math.round(total),
    items: [...items].map(([label, amount]) => ({
      label,
      costCents: Math.round(amount),
    })),
  };
}

@Injectable()
export class ProviderUsageService {
  private cached: { asOf: string; sources: ProviderUsageSource[] } | null =
    null;
  private expiresAt = 0;
  private inFlight: Promise<{
    asOf: string;
    sources: ProviderUsageSource[];
  }> | null = null;

  getReport(
    now = new Date(),
  ): Promise<{ asOf: string; sources: ProviderUsageSource[] }> {
    if (this.cached && now.getTime() < this.expiresAt)
      return Promise.resolve(this.cached);
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.collect(now)
      .then((report) => {
        this.cached = report;
        this.expiresAt = now.getTime() + CACHE_MS;
        return report;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async collect(now: Date) {
    const [vercel, railway] = await Promise.all([
      this.vercel(now),
      this.railway(now),
    ]);
    const supabase: ProviderUsageSource = {
      provider: 'supabase',
      state: 'manual',
      scope: 'organization',
      periodStart: null,
      periodEnd: null,
      observedAt: null,
      accruedCostCents: null,
      items: [],
      href: 'https://supabase.com/dashboard/org/_/usage',
    };
    return { asOf: now.toISOString(), sources: [vercel, railway, supabase] };
  }

  private async vercel(now: Date): Promise<ProviderUsageSource> {
    const token = process.env.BUSINESS_VERCEL_TOKEN;
    const teamId = process.env.BUSINESS_VERCEL_TEAM_ID;
    const projectId = process.env.BUSINESS_VERCEL_PROJECT_ID;
    const source: ProviderUsageSource = {
      provider: 'vercel',
      state: 'not_configured',
      scope: projectId ? 'project' : 'team',
      periodStart: null,
      periodEnd: null,
      observedAt: null,
      accruedCostCents: null,
      items: [],
      href: 'https://vercel.com/dashboard/usage',
    };
    // Require explicit account scope; never silently read the token owner's unrelated personal account.
    if (!token || !teamId) return source;
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();
    const query = new URLSearchParams({
      teamId,
      from: start,
      to: now.toISOString(),
    });
    try {
      const body = await boundedText(
        `https://api.vercel.com/v1/billing/charges?${query}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/x-ndjson',
          },
        },
      );
      return {
        ...source,
        ...vercelUsageLines(body, projectId),
        state: 'connected',
        periodStart: start,
        periodEnd: now.toISOString(),
        observedAt: now.toISOString(),
      };
    } catch {
      return { ...source, state: 'unavailable' };
    }
  }

  private async railway(now: Date): Promise<ProviderUsageSource> {
    const token = process.env.BUSINESS_RAILWAY_TOKEN;
    const workspaceId = process.env.BUSINESS_RAILWAY_WORKSPACE_ID;
    const source: ProviderUsageSource = {
      provider: 'railway',
      state: 'not_configured',
      scope: 'workspace',
      periodStart: null,
      periodEnd: null,
      observedAt: null,
      accruedCostCents: null,
      items: [],
      href: 'https://railway.com/account/usage',
    };
    if (!token || !workspaceId) return source;
    try {
      const response = record(
        JSON.parse(
          await boundedText('https://backboard.railway.com/graphql/v2', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: WORKSPACE_USAGE_QUERY,
              variables: { workspaceId },
            }),
          }),
        ),
      );
      if (response.errors) throw new Error('Provider usage unavailable');
      const customer = record(record(record(response.data).workspace).customer);
      const period = record(customer.billingPeriod);
      if (
        typeof period.start !== 'string' ||
        typeof period.end !== 'string' ||
        !Number.isFinite(Date.parse(period.start)) ||
        !Number.isFinite(Date.parse(period.end))
      )
        throw new Error('Invalid billing period');
      return {
        ...source,
        state: 'connected',
        accruedCostCents: Math.round(cents(customer.currentUsage)),
        periodStart: period.start,
        periodEnd: period.end,
        observedAt: now.toISOString(),
      };
    } catch {
      return { ...source, state: 'unavailable' };
    }
  }
}
