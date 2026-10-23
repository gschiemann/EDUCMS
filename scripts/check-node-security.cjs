#!/usr/bin/env node
/**
 * Node.js runtime security watch (2026-10-23).
 *
 * Fails when a Node.js release on the same major line as a Docker image's
 * pinned `NODE_IMAGE` is a SECURITY release newer than the pin.
 *
 * Why: CVE-2026-111497 ("Node2Shell", a Brotli decoder RCE) was fixed in
 * Node 22.23.4 on 2026-10-21, and the API image kept running 22.23.2 for two
 * days. `pnpm audit` can never see this — the bug is in the Node binary, not
 * an npm package — so the runtime gets its own check. Run hourly by
 * .github/workflows/security-watch.yml; a failure there opens an issue and
 * fires the on-call routine (scheduled-failure-issue.yml).
 *
 * Exit 1: a newer security release exists, or a Dockerfile no longer pins an
 * exact `node:X.Y.Z-alpine@sha256:…` (the watch could not tell what runs).
 * Exit 0 with a warning: nodejs.org could not be reached — the next hourly
 * run retries, and a transient outage must never page anyone.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IMAGES = ['Dockerfile', 'apps/renderer/Dockerfile'];
const PIN_RE = /^ARG NODE_IMAGE=node:([0-9]+(?:\.[0-9]+){0,2})-alpine[0-9.]*@sha256:[0-9a-f]{64}\s*$/m;

function pinnedVersion(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = src.match(PIN_RE);
  if (!m) throw new Error(`${file}: NODE_IMAGE must pin node:X.Y.Z-alpine@sha256:<digest>`);
  const parts = m[1].split('.').map(Number);
  if (parts.length !== 3) {
    throw new Error(`${file}: NODE_IMAGE tag ${m[1]} is not an exact X.Y.Z version, so the running Node cannot be checked`);
  }
  return parts;
}

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function newerSecurityReleases(index, pin) {
  return index
    .filter((r) => r && typeof r.version === 'string' && r.security === true)
    .map((r) => ({ ...r, parts: r.version.replace(/^v/, '').split('.').map(Number) }))
    .filter((r) => r.parts.length === 3 && r.parts[0] === pin[0] && compare(r.parts, pin) > 0)
    .sort((a, b) => compare(b.parts, a.parts));
}

async function main() {
  const pins = IMAGES.map((file) => ({ file, pin: pinnedVersion(file) }));

  let index;
  try {
    const res = await fetch('https://nodejs.org/dist/index.json', { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = await res.json();
  } catch (e) {
    console.log(`::warning::Could not read the Node.js release index (${e.message}); the next run retries.`);
    return;
  }

  let failed = false;
  for (const { file, pin } of pins) {
    const newer = newerSecurityReleases(index, pin);
    if (newer.length > 0) {
      failed = true;
      const list = newer.map((r) => `${r.version} (${r.date})`).join(', ');
      console.log(
        `::error file=${file}::Node.js security release ${list} is newer than the pinned ${pin.join('.')}. ` +
          `Roll NODE_IMAGE to the newest node:${pin[0]}.x-alpine digest (docker buildx imagetools inspect node:${pin[0]}-alpine).`,
      );
    } else {
      console.log(`${file}: Node ${pin.join('.')} — no newer security release on v${pin[0]}.`);
    }
  }
  if (failed) process.exit(1);
}

if (require.main === module) {
  main().catch((e) => {
    console.log(`::error::${e.message}`);
    process.exit(1);
  });
}

module.exports = { PIN_RE, newerSecurityReleases, compare };
