/**
 * resources.mjs — what the STACK is doing while the fleet drives it.
 *
 * The audit asks for API memory/CPU, Postgres connection-pool saturation and
 * Redis behaviour, not just client-side latency. Latency alone cannot tell you
 * whether the next 1,000 screens fit: an API at 12 % CPU with a 10-connection
 * pool that never queues has headroom, and an API at 12 % CPU whose pool is
 * pinned at 10 busy backends is already the bottleneck at the SAME latency.
 *
 * Three sources, all read-only, all sampled on a timer so a phase can be
 * summarised by p50/p95/max rather than by one lucky instant:
 *
 *   · Docker's own stats API over the unix socket (no `docker stats` CLI —
 *     its streaming output redraws with ANSI and a `--no-stream` call costs
 *     ~1.5 s, which is too coarse to sample a 3-minute window).
 *   · pg_stat_activity — backends, and how many are actually running a query
 *     (`state='active'`) versus parked. Prisma's `connection_limit=10` is a
 *     CLIENT-side pool; the only way to see it saturate is to watch how many
 *     of those 10 backends are busy at once.
 *   · redis INFO — connected clients, ops/sec, memory, and the pub/sub channel
 *     count that the emergency fan-out rides.
 */

import http from 'node:http';
import { sql, compose } from './sql.mjs';

const DOCKER_SOCKET = process.env.DOCKER_HOST_SOCKET || '/var/run/docker.sock';

/** One-shot container stats via the Docker Engine API. */
function dockerStats(name) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path: `/containers/${encodeURIComponent(name)}/stats?stream=false`,
        method: 'GET',
        timeout: 8_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

/** Docker's own CPU% / memory formulas, so the numbers match `docker stats`. */
function reduceStats(s) {
  if (!s || !s.cpu_stats) return null;
  const cpuDelta = (s.cpu_stats.cpu_usage?.total_usage ?? 0) - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0);
  const cpus = s.cpu_stats.online_cpus || 1;
  const cpuPct = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;
  const inactiveFile = s.memory_stats?.stats?.inactive_file ?? 0;
  const memBytes = Math.max(0, (s.memory_stats?.usage ?? 0) - inactiveFile);
  return { cpuPct, memBytes, memLimit: s.memory_stats?.limit ?? 0, cpus };
}

/**
 * Postgres side. `active` is the number of backends executing a statement at
 * the instant of the sample — the real saturation signal for a fixed pool.
 * `waiting` counts backends blocked on a lock or an IO wait event.
 */
async function pgSample() {
  const rows = await sql(`
    SELECT
      count(*) FILTER (WHERE datname = 'venueos_loadtest')::text,
      count(*) FILTER (WHERE datname = 'venueos_loadtest' AND state = 'active')::text,
      count(*) FILTER (WHERE datname = 'venueos_loadtest' AND state = 'idle in transaction')::text,
      count(*) FILTER (WHERE wait_event_type IS NOT NULL AND datname = 'venueos_loadtest')::text,
      count(*)::text,
      current_setting('max_connections')
    FROM pg_stat_activity;`);
  const [total, active, idleTx, waiting, allDb, maxConn] = rows[0] ?? [];
  return {
    backends: Number(total ?? 0),
    active: Number(active ?? 0),
    idleInTransaction: Number(idleTx ?? 0),
    waiting: Number(waiting ?? 0),
    serverBackends: Number(allDb ?? 0),
    maxConnections: Number(maxConn ?? 0),
  };
}

/** Redis side, straight out of INFO. */
async function redisSample() {
  try {
    const out = await compose('exec', '-T', 'redis', 'redis-cli', 'info');
    const get = (k) => {
      const m = out.match(new RegExp(`^${k}:(.*)$`, 'm'));
      return m ? m[1].trim() : null;
    };
    return {
      connectedClients: Number(get('connected_clients') ?? 0),
      opsPerSec: Number(get('instantaneous_ops_per_sec') ?? 0),
      usedMemoryBytes: Number(get('used_memory') ?? 0),
      totalCommands: Number(get('total_commands_processed') ?? 0),
      rejectedConnections: Number(get('rejected_connections') ?? 0),
      pubsubChannels: Number(get('pubsub_channels') ?? 0),
      keyspaceHits: Number(get('keyspace_hits') ?? 0),
      keyspaceMisses: Number(get('keyspace_misses') ?? 0),
    };
  } catch {
    return null; // Redis is deliberately dead during one of the drills.
  }
}

const q = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

/**
 * Sample the whole stack on an interval until `stop()` is called; `stop()`
 * returns the summary. Failures are recorded as gaps, never thrown — a
 * sampler that dies when Redis is stopped would take the Redis drill with it.
 */
export function startResourceSampler({ intervalMs = 3_000, label = '' } = {}) {
  const samples = { api: [], pg: [], redisRaw: [], apiRaw: [] };
  let stopped = false;
  let busy = false;

  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const [apiRaw, pgRow, redisRow] = await Promise.all([
        dockerStats('venueos-loadtest-api-1'),
        pgSample().catch(() => null),
        redisSample(),
      ]);
      const api = reduceStats(apiRaw);
      const at = Date.now();
      if (api) samples.api.push({ at, ...api });
      if (pgRow) samples.pg.push({ at, ...pgRow });
      if (redisRow) samples.redisRaw.push({ at, ...redisRow });
    } catch {
      /* a gap is data too */
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  void tick();

  return {
    label,
    /** Latest raw values, for a live console line. */
    latest() {
      return {
        api: samples.api.at(-1) ?? null,
        pg: samples.pg.at(-1) ?? null,
        redis: samples.redisRaw.at(-1) ?? null,
      };
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      const cpu = samples.api.map((s) => s.cpuPct);
      const mem = samples.api.map((s) => s.memBytes);
      const backends = samples.pg.map((s) => s.backends);
      const active = samples.pg.map((s) => s.active);
      const waiting = samples.pg.map((s) => s.waiting);
      const rClients = samples.redisRaw.map((s) => s.connectedClients);
      const rOps = samples.redisRaw.map((s) => s.opsPerSec);
      const first = samples.redisRaw[0];
      const last = samples.redisRaw.at(-1);
      return {
        label,
        samples: samples.api.length,
        api: {
          cpuPctP50: q(cpu, 50),
          cpuPctP95: q(cpu, 95),
          cpuPctMax: cpu.length ? Math.max(...cpu) : null,
          memMbP50: mem.length ? q(mem, 50) / 1048576 : null,
          memMbMax: mem.length ? Math.max(...mem) / 1048576 : null,
          memLimitMb: samples.api.at(-1) ? samples.api.at(-1).memLimit / 1048576 : null,
          hostCpus: samples.api.at(-1)?.cpus ?? null,
        },
        pg: {
          backendsP50: q(backends, 50),
          backendsMax: backends.length ? Math.max(...backends) : null,
          activeP50: q(active, 50),
          activeP95: q(active, 95),
          activeMax: active.length ? Math.max(...active) : null,
          waitingMax: waiting.length ? Math.max(...waiting) : null,
          maxConnections: samples.pg.at(-1)?.maxConnections ?? null,
          serverBackendsMax: samples.pg.length ? Math.max(...samples.pg.map((s) => s.serverBackends)) : null,
        },
        redis: last
          ? {
              connectedClientsMax: rClients.length ? Math.max(...rClients) : null,
              opsPerSecP50: q(rOps, 50),
              opsPerSecMax: rOps.length ? Math.max(...rOps) : null,
              usedMemoryMb: last.usedMemoryBytes / 1048576,
              pubsubChannelsMax: samples.redisRaw.length
                ? Math.max(...samples.redisRaw.map((s) => s.pubsubChannels))
                : null,
              commandsInWindow: first ? last.totalCommands - first.totalCommands : null,
              rejectedConnections: last.rejectedConnections,
              samples: samples.redisRaw.length,
            }
          : null,
      };
    },
  };
}
