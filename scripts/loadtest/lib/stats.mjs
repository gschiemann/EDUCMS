/**
 * stats.mjs — latency/error accounting and the ASCII tables the run prints.
 *
 * Percentiles come from the FULL sample array (nearest-rank), not a sketch:
 * the run is minutes long and a few hundred thousand doubles is nothing, and
 * an approximate p99 is exactly the number an audit would not accept.
 */

export class RouteStats {
  constructor(name) {
    this.name = name;
    this.samples = [];
    this.byStatus = new Map();
    this.errors = 0;
    this.bytes = 0;
  }

  record(res) {
    this.samples.push(res.ms);
    const key = res.error ? `ERR:${res.error}` : String(res.status);
    this.byStatus.set(key, (this.byStatus.get(key) || 0) + 1);
    if (res.error || res.status === 0 || res.status >= 500) this.errors += 1;
    this.bytes += res.body ? Buffer.byteLength(res.body) : 0;
  }

  get count() {
    return this.samples.length;
  }

  percentile(p) {
    if (!this.samples.length) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
  }

  statusSummary() {
    return [...this.byStatus.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
  }
}

export function pct(v) {
  return v == null ? '—' : v < 10 ? v.toFixed(1) : String(Math.round(v));
}

/** Fixed-width table. `rows` is an array of arrays of strings. */
export function table(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').length)));
  const line = (r) => r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd();
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

export function verdict(pass) {
  return pass ? 'PASS' : 'FAIL';
}
