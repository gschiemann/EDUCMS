#!/usr/bin/env node
/**
 * Tests for scripts/ci-changed-areas.cjs — the classifier that decides which
 * CI jobs a change needs. A wrong "false" here would SKIP a gate, so every
 * shape that must run is pinned.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../ci-changed-areas.cjs');

const pick = (r, ...k) => k.map((x) => r[x]);

test('docs-only change runs nothing', () => {
  const r = classify(['docs/a.md', 'README.md', '.claude/x', 'scratch/y.html', 'LICENSE']);
  for (const k of ['code', 'app', 'server', 'player', 'renderer', 'deps']) assert.equal(r[k], false, k);
});

test('shipped help markdown is NOT docs', () => {
  assert.deepEqual(pick(classify(['apps/web/src/content/help/foo.md']), 'code', 'app', 'server'), [true, true, true]);
});

test('nested README outside docs/ counts as code (globs never crossed /)', () => {
  assert.equal(classify(['apps/api/README.md']).app, true);
});

test('player-only change still runs the app suites (web tests read the Kotlin), not the API image', () => {
  const r = classify(['apps/player/app/src/main/x.kt', 'docs/x.md']);
  assert.deepEqual(pick(r, 'code', 'app', 'server', 'player', 'renderer'), [true, true, false, true, false]);
});

test('api-only and web-only changes both run the app suites and the image', () => {
  for (const f of ['apps/api/src/x.ts', 'apps/web/src/app/page.tsx', 'packages/api-types/src/index.ts']) {
    assert.deepEqual(pick(classify([f]), 'app', 'server'), [true, true], f);
  }
});

test('renderer-only change is renderer only', () => {
  assert.deepEqual(pick(classify(['apps/renderer/src/server.ts']), 'code', 'app', 'server', 'renderer'), [true, false, false, true]);
});

test('shared inputs run everything', () => {
  for (const f of ['pnpm-lock.yaml', 'package.json', '.github/workflows/ci.yml']) {
    assert.deepEqual(pick(classify([f]), 'app', 'server', 'renderer'), [true, true, true], f);
  }
  assert.deepEqual(pick(classify(['scripts/x.cjs']), 'app', 'server'), [true, true]);
});

test('dependency / image inputs set deps', () => {
  for (const f of ['Dockerfile', 'apps/renderer/Dockerfile', 'pnpm-lock.yaml', 'apps/web/package.json', '.trivyignore.yaml']) {
    assert.equal(classify([f]).deps, true, f);
  }
  assert.equal(classify(['apps/web/src/a.ts']).deps, false);
});
