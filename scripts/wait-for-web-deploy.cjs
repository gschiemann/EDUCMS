#!/usr/bin/env node
// Production smoke must see the pushed web artifact, rather than the build
// Vercel is replacing. Non-web pushes may legitimately keep the old SHA;
// compare against it using the same paths as vercel-ignore-build.sh.
const WEB_PATH = /^(apps\/web\/|packages\/|pnpm-lock\.yaml$|package\.json$|turbo\.json$)/;
async function waitForWebDeployment(config, deps = {}) {
  const fetcher = deps.fetch || fetch;
  const now = deps.now || Date.now;
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const log = deps.log || console.log;
  const { sha, repository, origin, token, maxWaitMs = 300000, intervalMs = 15000 } = config;
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Missing full commit SHA or repository');
  const endpoint = new URL('/api/build-info', origin);
  const deadline = now() + maxWaitMs;
  let compared = null;
  do {
    let live = null;
    try {
      const response = await fetcher(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (response.ok) live = (await response.json()).shaFull;
    } catch { /* An unreachable deployment is not a pass. */ }
    if (live === sha) { log(`Web deployment verified: ${sha.slice(0, 12)}`); return; }
    if (/^[a-f0-9]{40}$/.test(live || '') && live !== compared) {
      compared = live;
      try {
        const response = await fetcher(`https://api.github.com/repos/${repository}/compare/${live}...${sha}`, {
          headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          const diff = await response.json();
          // GitHub caps files at 300. A capped/unknown comparison cannot
          // establish that an ignored build is safe to smoke.
          if (['ahead', 'identical'].includes(diff.status) && Array.isArray(diff.files) && diff.files.length < 300 && !diff.files.some(file => WEB_PATH.test(file.filename))) {
            log(`No web artifact changed since ${live.slice(0, 12)}; the running build is current for this push.`);
            return;
          }
        }
      } catch { /* Unknown diff: wait for the exact SHA. */ }
    }
    if (now() >= deadline) break;
    log(`Waiting for web ${sha.slice(0, 12)}; live=${typeof live === 'string' ? live.slice(0, 12) : 'unavailable'}`);
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  } while (now() <= deadline);
  throw new Error(`Web commit ${sha} did not become live within ${maxWaitMs / 1000}s; refusing to smoke a different artifact.`);
}
module.exports = { waitForWebDeployment };
if (require.main === module) waitForWebDeployment({
  sha: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY,
  origin: process.env.WEB_ORIGIN || 'https://venue-os.app', token: process.env.GH_TOKEN,
}).catch(error => { console.error(`::error::${error.message}`); process.exitCode = 1; });
