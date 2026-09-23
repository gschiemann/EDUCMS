/**
 * Container memory, read the way the platform enforces it: from the cgroup.
 *
 * Summing RSS over a Chromium process tree over-counts wildly (shared pages —
 * render-worker-client.ts measured 936 MiB that way for a render the cgroup
 * charged 200 MiB), and the cgroup number is the one the OOM killer acts on.
 * Where there is no cgroup (a developer Mac) both readers return null and the
 * watchdog is simply off.
 */
import fs from 'node:fs';

function readNumber(file: string): number | null {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (raw === 'max') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Bytes currently charged to this container, or null. */
export function cgroupMemoryUsage(): number | null {
  return readNumber('/sys/fs/cgroup/memory.current') ?? readNumber('/sys/fs/cgroup/memory/memory.usage_in_bytes');
}

/** The container's memory limit in bytes, or null when unlimited / unknown. */
export function cgroupMemoryLimit(): number | null {
  const limit = readNumber('/sys/fs/cgroup/memory.max') ?? readNumber('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  // cgroup v1 reports "unlimited" as a number near 2^63.
  if (limit !== null && limit > 1024 ** 4) return null;
  return limit;
}

/**
 * The watchdog threshold: an explicit knob wins; otherwise 85 % of the
 * cgroup limit, leaving room for Node and the kernel to act before the OOM
 * killer does; otherwise no watchdog.
 */
export function resolveMemoryLimit(explicit: number | null): number | null {
  if (explicit !== null) return explicit;
  const limit = cgroupMemoryLimit();
  return limit === null ? null : Math.floor(limit * 0.85);
}
