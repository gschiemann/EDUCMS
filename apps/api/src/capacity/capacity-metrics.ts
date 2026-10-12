/**
 * Capacity metric registry: what we measure, which limit it is judged against, and the EXACT
 * upgrade action to put in front of the owner. Pure data (no I/O) so the email, the API response
 * and the specs all read one source of truth.
 */
import type { LimitKey } from './capacity-math';

export type MetricUnit = 'bytes' | 'count' | 'ms';

export interface MetricDef {
  key: string;
  label: string;
  unit: MetricUnit;
  /** Which entry of CAPACITY_LIMITS judges it. null = informational (no % / no alert). */
  limitKey: LimitKey | null;
  /** The upgrade step, in the owner's words. */
  action: string;
  /** Where to confirm / click. */
  link?: string;
}

export const METRICS: MetricDef[] = [
  {
    key: 'db_size',
    label: 'Database size',
    unit: 'bytes',
    limitKey: 'dbBytes',
    action: 'Supabase -> Project Settings -> Compute and Disk -> raise Disk size (disk is billed per GB; no restart needed for a disk grow). Also check for runaway telemetry tables below.',
    link: 'https://supabase.com/dashboard/project/_/settings/compute-and-disk',
  },
  {
    key: 'db_connections',
    label: 'Database connections',
    unit: 'count',
    limitKey: 'dbConnections',
    action: 'Supabase -> Compute and Disk -> Compute size: Micro -> Small (+$5/mo, 90 connections; ~2 min restart, do it in a quiet window). Then raise the Supavisor Pool Size to >= 2 x replicas x connection_limit + spare.',
    link: 'https://supabase.com/dashboard/project/_/settings/compute-and-disk',
  },
  {
    key: 'storage_bytes',
    label: 'File storage (media, APKs)',
    unit: 'bytes',
    limitKey: 'storageBytes',
    action: 'Supabase -> Organization -> Billing: storage past the included 100 GB is billed per GB on Pro (set a spend cap alert). Review the biggest tenants in /super and the storage quota policy.',
    link: 'https://supabase.com/dashboard/org/_/billing',
  },
  {
    key: 'redis_memory',
    label: 'Redis memory',
    unit: 'bytes',
    limitKey: 'redisBytes',
    action: 'Railway -> Redis service -> Settings -> raise memory / plan (and set CAPACITY_LIMITS.redisBytes to the new size). Redis down only degrades push to HTTP polling, but eviction would drop leases and revocations.',
    link: 'https://railway.com/dashboard',
  },
  {
    key: 'api_memory',
    label: 'API process memory (RSS)',
    unit: 'bytes',
    limitKey: 'memoryBytes',
    action: 'Railway -> api service -> Settings -> raise memory limit (Pro plan) and, if NODE_OPTIONS --max-old-space-size is set, raise it too.',
    link: 'https://railway.com/dashboard',
  },
  {
    key: 'event_loop_lag',
    label: 'API event-loop lag (p99)',
    unit: 'ms',
    limitKey: 'eventLoopLagMs',
    action: 'Railway -> api service -> raise vCPU, or add a second replica (code is multi-replica ready; run a two-replica emergency drill first).',
    link: 'https://railway.com/dashboard',
  },
  {
    key: 'paired_screens',
    label: 'Paired screens',
    unit: 'count',
    limitKey: 'pairedScreens',
    action: 'Fleet is large for Micro compute: Supabase -> Compute size: Small (+$5/mo) or Medium (+$50/mo). Re-run the load test in scripts/loadtest first.',
    link: 'https://supabase.com/dashboard/project/_/settings/compute-and-disk',
  },
];

export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

/** Biggest-table size rows are informational; their key is `table:<relname>`. */
export const TABLE_PREFIX = 'table:';
export const TABLE_METRIC_COUNT = 5;

export function tableMetricDef(name: string): MetricDef {
  return {
    key: `${TABLE_PREFIX}${name}`,
    label: `Table size: ${name}`,
    unit: 'bytes',
    limitKey: null,
    action: 'Informational: the fastest-growing tables drive database disk and Micro-compute load. If one grows without bound, add or shorten its retention purge.',
  };
}

/**
 * Things the API cannot measure itself. Static rows for the Capacity card ("check these by hand,
 * here"): Vercel and Railway plan usage need their own dashboards / tokens.
 */
export interface ChecklistItem {
  label: string;
  what: string;
  link: string;
  upgrade: string;
}

export const MANUAL_CHECKLIST: ChecklistItem[] = [
  {
    label: 'Vercel usage',
    what: 'Edge Requests (Hobby 1 M / 30 days), Active CPU (Hobby 4 h), Fast Data Transfer. Over a Hobby limit, Vercel can pause the project (dashboard and /player shell).',
    link: 'https://vercel.com/dashboard/usage',
    upgrade: 'Vercel -> Settings -> Billing -> upgrade to Pro ($20/user/mo; 10 M edge requests). Do this before 70% of the Hobby limit.',
  },
  {
    label: 'Railway plan limits',
    what: 'Per-service memory/vCPU ceilings, the 500 logs/sec drop limit, replica count, and monthly usage vs. plan credit.',
    link: 'https://railway.com/account/usage',
    upgrade: 'Railway -> Workspace -> Plan: Hobby -> Pro ($20/mo) for higher limits and multi-replica headroom.',
  },
  {
    label: 'Supabase egress and backups',
    what: 'Egress (Pro includes 250 GB), daily backup status, and compute CPU/credit burst.',
    link: 'https://supabase.com/dashboard/org/_/usage',
    upgrade: 'Supabase -> Billing: spend-cap alerts; compute Micro -> Small (+$5/mo) when CPU stays high.',
  },
  {
    label: 'Resend email volume',
    what: 'Monthly sends vs. plan, and that the sending domain is verified (the shared sender only reaches the account owner).',
    link: 'https://resend.com/overview',
    upgrade: 'Resend -> Billing -> Pro when nearing the free monthly limit.',
  },
];
