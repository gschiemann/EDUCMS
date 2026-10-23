/**
 * Runs in the browser before any application code (Next.js
 * `instrumentation-client`), on every page: the dashboard and the player.
 *
 * Zod 4 probes whether `new Function` is allowed the first time it parses an
 * object schema, to pick its JIT fast path (`allowsEval` in
 * zod/v4/core/util.js). Our CSP never allows eval, so that probe filed a
 * `script-src blocked=eval` violation report on every page load that parsed
 * with Zod — ~1,500 `/api/csp-report` calls a day, about 15% of the free
 * Vercel plan's Active CPU (2026-09-28). The probe already failed and Zod
 * already fell back to its interpreted path, so turning the JIT off changes
 * nothing except that the probe — and its report — never happen.
 *
 * Import `config` by name, never the `z` namespace (2026-10-23): this file
 * runs on every page, and the namespace object pulled the whole of Zod into
 * the root chunk every page loads. The named export tree-shakes to Zod's
 * global config, the same object every schema reads.
 */
import { config } from 'zod';

config({ jitless: true });
