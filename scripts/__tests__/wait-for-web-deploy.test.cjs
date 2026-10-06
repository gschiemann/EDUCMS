const { test } = require('node:test');
const assert = require('node:assert/strict');
const { waitForWebDeployment } = require('../wait-for-web-deploy.cjs');
const wanted = 'a'.repeat(40), previous = 'b'.repeat(40);
const config = { sha: wanted, repository: 'owner/repo', origin: 'https://web.test', maxWaitMs: 30, intervalMs: 10 };
function harness(body, live = () => previous) {
  let clock = 0, reads = 0;
  return { fetch: async url => ({ ok: true, json: async () => String(url).includes('api.github.com') ? body : { shaFull: live(++reads) } }),
    now: () => clock, sleep: async ms => { clock += ms; }, log: () => {} };
}
test('the pushed SHA is verified immediately', async () => {
  await waitForWebDeployment(config, harness(null, () => wanted));
});
test('a web-only push waits through the old deployment until its own SHA appears', async () => {
  await waitForWebDeployment(config, harness({ status: 'ahead', files: [{ filename: 'apps/web/src/app/page.tsx' }] }, reads => reads < 3 ? previous : wanted));
});
test('an API-only push correctly accepts the unchanged web artifact', async () => {
  await waitForWebDeployment(config, harness({ status: 'ahead', files: [{ filename: 'apps/api/src/main.ts' }] }));
});
test('shared packages are web artifacts too', async () => {
  await assert.rejects(waitForWebDeployment(config, harness({ status: 'ahead', files: [{ filename: 'packages/api-types/src/index.ts' }] })), /refusing to smoke/);
});
test('an unreachable endpoint never becomes a false green', async () => {
  const deps = harness(null); deps.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(waitForWebDeployment(config, deps), /refusing to smoke/);
});
test('unknown, capped, and diverged comparisons fail closed', async () => {
  for (const body of [null, { status: 'ahead', files: Array(300).fill({ filename: 'docs/note.md' }) }, { status: 'diverged', files: [] }]) {
    await assert.rejects(waitForWebDeployment(config, harness(body)), /refusing to smoke/);
  }
});
