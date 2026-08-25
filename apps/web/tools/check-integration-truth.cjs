#!/usr/bin/env node
/**
 * check-integration-truth.cjs
 *
 * Guards the streaming/media integration catalog against the one defect
 * class that keeps coming back: shipping a source because it is
 * technically reachable, as though reachability were a commercial
 * public-performance license.
 *
 * The 2026-08-24 sweep found four live instances of it —
 *   • a bundled catalog of broadcaster YouTube `embed/live_stream` URLs
 *     under a header claiming the broadcasters "invite venue rebroadcast";
 *   • reverse-engineered Pluto stitch URLs + formula-generated Xumo
 *     playlist URLs shipped as a gym channel catalog;
 *   • an API route that scraped `ytInitialData` out of a YouTube channel
 *     page to find the current live video id for a gym screen;
 *   • BLOCKED sources that still asked the operator for a URL / channel
 *     name, which reads as "fill this in and it will work".
 *
 * Each was individually plausible and collectively put the CUSTOMER on
 * the hook — the gym is the one performing publicly, not us. These
 * assertions are cheap; the failure mode is not.
 *
 * Dependency-free (regex over source text) so it runs on a bare runner.
 * Run: node apps/web/tools/check-integration-truth.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

/**
 * Blank out comments, preserving offsets and line structure.
 *
 * Every pattern below is scanned against the CODE, never the prose. A
 * file that documents what was removed ("we used to mint a
 * youtube.com/embed/live_stream URL here, and here is why we stopped")
 * must not trip the guard that removed it — otherwise the only way to
 * pass is to delete the explanation, and the next agent re-derives the
 * mistake from scratch. Three of these checks self-tripped on their own
 * comments before this existed.
 *
 * A `//` inside a string (`https://…`) is not a comment, so the scanner
 * tracks string and template-literal state.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  let mode = 'code'; // code | line | block | sq | dq | tpl
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
      out += c; i += 1; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; } else out += ' ';
      i += 1; continue;
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') { mode = 'code'; out += '  '; i += 2; continue; }
      out += (c === '\n' ? c : ' '); i += 1; continue;
    }
    // inside a string / template literal
    if (c === '\\') { out += c + (n === undefined ? '' : n); i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
    out += c; i += 1; continue;
  }
  return out;
}

const failures = [];
const checks = [];
const fail = (rel, msg) => failures.push(`${rel}\n    ${msg}`);
const ok = (name) => checks.push(name);

/** Brace-match the object literal containing `from`. */
function objectAt(src, from) {
  const start = src.lastIndexOf('{', from);
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

// ── 1. No bundled preset channel catalog ────────────────────────────────
{
  const rel = 'packages/api-types/src/streaming-presets.ts';
  const src = read(rel);
  if (src == null) fail(rel, 'file is missing — the guard cannot verify the preset catalog.');
  else {
    const code = stripComments(src);
    const m = code.match(/PUBLIC_BROADCASTER_CHANNELS[^=]*=\s*(\[[\s\S]*?\]\s*;)/);
    if (!m) fail(rel, 'PUBLIC_BROADCASTER_CHANNELS is no longer a literal array — the guard cannot verify it is empty.');
    else if (/\bid:\s*['"]/.test(m[1])) {
      fail(rel, 'PUBLIC_BROADCASTER_CHANNELS has entries again. A bundled venue catalog needs BOTH a provider-documented commercial playback path AND written venue rights on file — not a reachable URL.');
    } else ok('no bundled preset channel catalog');
    if (/youtube\.com\/embed\/live_stream/.test(code)) {
      fail(rel, 'mints a youtube.com/embed/live_stream URL. YouTube terms prohibit public screening; this is the exact URL shape that must not reach a venue screen.');
    } else ok('no YouTube live_stream embed minting');
  }
}

// ── 2. No bundled consumer FAST catalog ─────────────────────────────────
{
  const rel = 'apps/web/src/components/widgets/fitness/fastChannelCatalogs.ts';
  const src = read(rel);
  if (src == null) fail(rel, 'file is missing — the guard cannot verify the FAST catalog.');
  else {
    const code = stripComments(src);
    const m = code.match(/FAST_CHANNELS[^=]*=\s*(\{[\s\S]*?\}\s*;)/);
    if (!m) fail(rel, 'FAST_CHANNELS is no longer a literal object — the guard cannot verify it is empty.');
    else if (/\bhlsUrl:\s*[`'"]/.test(m[1]) || /\bhlsUrl:\s*\w+\(/.test(m[1])) {
      fail(rel, 'FAST_CHANNELS ships channel URLs again. Pluto stitch URLs and Xumo playlist URLs are consumer endpoints — reachable, but not licensed for commercial performance.');
    } else ok('no bundled consumer FAST catalog');
  }
}

// ── 3. The API does not scrape a consumer service for programming ───────
{
  const apiSrc = path.join(ROOT, 'apps/api/src');
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) {
        const code = stripComments(fs.readFileSync(p, 'utf8'));
        // Extracting the channel page's embedded data blob is the
        // signature of scraping it for the current live video id.
        if (/ytInitialData/.test(code)) hits.push(path.relative(ROOT, p));
      }
    }
  };
  if (fs.existsSync(apiSrc)) walk(apiSrc);
  if (hits.length) {
    for (const h of hits) fail(h, 'scrapes ytInitialData out of a consumer YouTube page to resolve programming. Never scrape a consumer service for venue media — the catalog marks youtube-live BLOCKED, and the API must not broker what the catalog refuses.');
  } else ok('no consumer-service scraping in the API');
}

// ── 4. A BLOCKED source explains itself and collects nothing ────────────
{
  const rel = 'apps/web/src/components/widgets/fitness/fitnessSourceCatalog.ts';
  const src = read(rel);
  if (src == null) fail(rel, 'file is missing — the guard cannot verify BLOCKED sources.');
  else {
    const code = stripComments(src);
    let checked = 0;
    let bad = 0;
    const idRe = /\bid: '([a-z0-9-]+)'/g;
    let m;
    while ((m = idRe.exec(code)) !== null) {
      const block = objectAt(code, m.index);
      const st = block.match(/status: '([A-Z]+)'/);
      if (!st || st[1] !== 'BLOCKED') continue;
      checked += 1;
      const fieldRe = /\{[^{}]*\btype: '([a-z]+)'[^{}]*\}/g;
      let f;
      while ((f = fieldRe.exec(block)) !== null) {
        if (f[1] !== 'info') {
          bad += 1;
          fail(rel, `source '${m[1]}' is BLOCKED but still collects operator input (a '${f[1]}' field). A source that can never lawfully play must not ask the operator to fill anything in — that reads as "complete this and it works".`);
        }
      }
    }
    if (checked === 0) fail(rel, 'found no BLOCKED sources at all — the guard is not actually inspecting this catalog.');
    else if (!bad) ok(`${checked} BLOCKED sources collect no operator input`);
  }
}

// ── 5. listPresetChannels serves nothing ────────────────────────────────
{
  const rel = 'apps/api/src/streaming/streaming.service.ts';
  const src = read(rel);
  if (src == null) fail(rel, 'file is missing — the guard cannot verify the preset endpoint.');
  else {
    const code = stripComments(src);
    const i = code.indexOf('listPresetChannels');
    if (i < 0) ok('no listPresetChannels endpoint');
    else {
      const body = code.slice(i, i + 600);
      if (/return\s*\[\s*\]/.test(body.split('\n').slice(0, 12).join('\n'))) ok('listPresetChannels serves no rows');
      else fail(rel, 'listPresetChannels returns rows again. It may only serve a catalog whose rows carry both a supported commercial playback path and verified venue rights.');
    }
  }
}

if (failures.length) {
  console.error('\nINTEGRATION TRUTH — %d violation(s):\n', failures.length);
  for (const f of failures) console.error('  ✗ ' + f + '\n');
  console.error('A source ships only when a provider documents a commercial playback path');
  console.error('AND written venue rights are on file. Reachable ≠ licensed; the gym is the');
  console.error('party performing publicly. See docs/research/2026-08-24-gym-media-integrations/.\n');
  process.exit(1);
}
console.log('OK — integration truth clean (%d checks): %s', checks.length, checks.join(' · '));
