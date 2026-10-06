/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The worker bypasses Next/SWC. A modern Node VM accepts syntax that stops an
// older Android WebView registering it, so the VM protocol tests alone cannot
// prove the fleet has an offline cache. Next already bundles the parser.
const { parse } = require('next/dist/compiled/acorn') as {
  parse(source: string, options: { ecmaVersion: number }): unknown;
};

test('the shipped offline worker parses without syntax newer than the oldest active WebView', () => {
  const source = readFileSync(resolve(__dirname, '../../../../public/sw-player.js'), 'utf8');
  expect(() => parse(source, { ecmaVersion: 2018 })).not.toThrow();
});

test.each(['const hit = cache ?? null;', 'const url = asset?.url;'])(
  'the compatibility gate rejects a worker-breaking modern construct: %s', source => {
    expect(() => parse(source, { ecmaVersion: 2018 })).toThrow();
  },
);
