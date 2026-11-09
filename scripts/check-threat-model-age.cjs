#!/usr/bin/env node
/*
 * SECURITY-DOCUMENT AGE CHECK
 * ==================================================================
 * Reads the "Last verified against code: YYYY-MM-DD" date from the three
 * security documents and exits 1 when any of them is older than the limit
 * (120 days by default).
 *
 *   docs/spec/THREAT_MODEL.md
 *   docs/spec/SECURITY_BASELINE.md
 *   docs/spec/SECURITY_GAPS.md
 *
 * WHY
 * ---
 * These three files are what a district IT reviewer is answered from, and
 * their own rule is "every control is cited to real code, an unbuilt one is a
 * KNOWN GAP". Nothing checked that rule over time: they sat at 2026-05-29 /
 * 2026-05-30 for five months while the code gained rotating refresh tokens,
 * passkeys, windowed key rotation, support access and the emergency-rev
 * confirmation, and lost a few claims (Foundry Standard Phase 1 item 7,
 * Article 11). A document that is older than the code it describes is the
 * "safeguard theater" pattern the 2026-05-21 lesson named. This check makes
 * the age visible; re-verifying the document is still a human/agent job.
 *
 * A missing file or a missing / unparsable date is a failure too — a check
 * that cannot read its input is never a pass.
 *
 * HOW IT IS WIRED
 * ---------------
 * REPORT-ONLY in `.github/workflows/security-watch.yml` (hourly schedule,
 * `continue-on-error: true`): the finding shows as an annotation without
 * failing the run. It is deliberately NOT a required check in ci.yml — an
 * age limit crossing on a calendar day must not block unrelated merges.
 * Test: `scripts/__tests__/check-threat-model-age.test.cjs`.
 *
 * USAGE
 *   node scripts/check-threat-model-age.cjs [--max-days N] [--root DIR] [--today YYYY-MM-DD]
 *
 * EXIT CODES
 *   0  every document verified within the limit
 *   1  a document is too old, missing, or has no readable date
 *   2  bad arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_DAYS = 120;
const DOCUMENTS = [
  'docs/spec/THREAT_MODEL.md',
  'docs/spec/SECURITY_BASELINE.md',
  'docs/spec/SECURITY_GAPS.md',
];
// Matches "**Last verified against code:** 2026-11-09" (bold markers optional).
const DATE_RE = /Last verified against code:?\**\s*(\d{4}-\d{2}-\d{2})/;
const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_SLACK_DAYS = 1;

/** Parse a YYYY-MM-DD string as a UTC date; null when it is not a real date. */
function parseDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return d;
}

/** The verified date in a document's text, or null. */
function readVerifiedDate(text) {
  const m = DATE_RE.exec(text || '');
  return m ? parseDay(m[1]) : null;
}

/**
 * Evaluate every document. Returns one result per document:
 *   { file, ok, days|null, verified|null, reason|null }
 */
function evaluate({ root, today, maxDays = DEFAULT_MAX_DAYS, documents = DOCUMENTS }) {
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return documents.map((file) => {
    const full = path.join(root, file);
    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch {
      return { file, ok: false, days: null, verified: null, reason: 'file not found' };
    }
    const verified = readVerifiedDate(text);
    if (!verified) {
      return { file, ok: false, days: null, verified: null, reason: 'no "Last verified against code: YYYY-MM-DD" line' };
    }
    const raw = Math.floor((now - verified.getTime()) / DAY_MS);
    const iso = verified.toISOString().slice(0, 10);
    // One day of slack ahead: the author's calendar day can lead UTC.
    if (raw < -FUTURE_SLACK_DAYS) return { file, ok: false, days: raw, verified: iso, reason: 'verified date is in the future' };
    const days = Math.max(0, raw);
    if (days > maxDays) return { file, ok: false, days, verified: iso, reason: `older than ${maxDays} days` };
    return { file, ok: true, days, verified: iso, reason: null };
  });
}

function parseArgs(argv) {
  const out = { maxDays: DEFAULT_MAX_DAYS, root: path.resolve(__dirname, '..'), today: new Date() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--max-days') {
      const n = Number(next());
      if (!Number.isInteger(n) || n < 0) throw new Error('--max-days must be a non-negative integer');
      out.maxDays = n;
    } else if (a.startsWith('--max-days=')) {
      const n = Number(a.slice('--max-days='.length));
      if (!Number.isInteger(n) || n < 0) throw new Error('--max-days must be a non-negative integer');
      out.maxDays = n;
    } else if (a === '--root') {
      out.root = path.resolve(next());
    } else if (a === '--today') {
      const d = parseDay(next());
      if (!d) throw new Error('--today must be YYYY-MM-DD');
      out.today = d;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return out;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(`check-threat-model-age: ${e.message}`);
    return 2;
  }
  const results = evaluate(args);
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`ok · ${r.days} days · ${r.file} (verified ${r.verified})`);
    } else {
      failed++;
      const age = r.days === null ? '' : ` · ${r.days} days`;
      const msg = `${r.file}${age}: ${r.reason}. Re-verify every row against the code and update its "Last verified against code" date (limit ${args.maxDays} days).`;
      if (process.env.GITHUB_ACTIONS) console.log(`::error file=${r.file}::${msg}`);
      console.error(`STALE · ${msg}`);
    }
  }
  return failed ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { evaluate, readVerifiedDate, parseDay, parseArgs, DOCUMENTS, DEFAULT_MAX_DAYS };
