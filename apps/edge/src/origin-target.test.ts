// Run: node --test apps/edge/src/origin-target.test.ts   (Node 22 strips the types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildOriginTarget } from './origin-target.ts';

const ORIGIN = 'https://api.example.test';

test('a normal path keeps ORIGIN_URL as its origin', () => {
  const t = buildOriginTarget('/api/v1/screens/abc/manifest', '?x=1', ORIGIN);
  assert.ok(t);
  assert.equal(t.toString(), 'https://api.example.test/api/v1/screens/abc/manifest?x=1');
});

test('ORIGIN_URL with a path still yields the origin + request path', () => {
  const t = buildOriginTarget('/health', '', 'https://api.example.test/some/base/');
  assert.equal(t?.toString(), 'https://api.example.test/health');
});

for (const p of ['//evil.example/x', '/\\evil.example/x', '//evil.example', '/\\\\evil.example', '/\t/evil.example', '/a\nb', 'relative', '']) {
  test(`refuses ${JSON.stringify(p)}`, () => {
    assert.equal(buildOriginTarget(p, '', ORIGIN), null);
  });
}

test('a refused path would otherwise have left the origin (negative control)', () => {
  // The construction this replaces: new URL(path, ORIGIN_URL).
  assert.equal(new URL('//evil.example/x', ORIGIN).origin, 'https://evil.example');
});

test('proxyToOrigin builds its target only through buildOriginTarget and answers 400 on refusal', () => {
  // index.ts targets the Workers runtime (extensionless imports), so assert
  // on its source rather than importing it under Node.
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function proxyToOrigin'), src.indexOf('// Asset CDN proxy'));
  assert.match(fn, /buildOriginTarget\(url\.pathname, url\.search, env\.ORIGIN_URL\)/);
  assert.match(fn, /status: 400/);
  assert.doesNotMatch(fn, /new URL\(url\.pathname/);
});

test('an unparseable ORIGIN_URL refuses everything', () => {
  assert.equal(buildOriginTarget('/x', '', 'not a url'), null);
});
