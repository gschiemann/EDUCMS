#!/usr/bin/env node
'use strict';

/**
 * check-incident-records.cjs — keeps docs/incidents/*.md in the Foundry Standard's shape
 * (no dependencies).
 *
 * WHAT: every incident file (docs/incidents/*.md except README.md) must carry these seven
 * headings, in this order:
 *   What happened · Root cause · Why our system let it reach a customer · What pins it ·
 *   What worked · The rule it produced · Evidence
 * and "What pins it" must either list at least one backticked repo path that exists in the
 * tree, or be exactly the sentence "Nothing pins this yet — GAP."
 *
 * WHY: the standard demands TWO investigations per failure (Article 47: why the product
 * failed, and why our system let it reach a customer), a bug-to-test link (Article 48: the
 * test, guard or CI job that now prevents recurrence) and a record of what worked
 * (Article 25). A record without them is a story, not a closed incident. Phase 1 backlog
 * item 15. An honest GAP is allowed (it is a visible debt); a missing or dead pin is not.
 *
 * HOW: exits 1 and prints one line per file ("ok" / "missing: ...") when any file fails.
 * `--list-gaps` prints the files whose "What pins it" is the GAP sentence and exits 0.
 * Wired as a blocking step in .github/workflows/rulebook.yml, right after check-rulebook.
 * Tests: scripts/__tests__/check-incident-records.test.cjs.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const INCIDENTS = path.join(REPO, 'docs', 'incidents');

const HEADINGS = [
  'What happened',
  'Root cause',
  'Why our system let it reach a customer',
  'What pins it',
  'What worked',
  'The rule it produced',
  'Evidence',
];
const GAP_SENTENCE = 'Nothing pins this yet — GAP.';

/** Split a markdown text into its "## " sections: [{ title, body }] in file order. */
function sections(text) {
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) {
      cur = { title: m[1], body: [] };
      out.push(cur);
    } else if (cur) {
      cur.body.push(line);
    }
  }
  return out.map((s) => ({ title: s.title, body: s.body.join('\n').trim() }));
}

/** True when `body` is exactly the GAP sentence. */
function isGap(body) {
  return body.trim() === GAP_SENTENCE;
}

/**
 * Check one record's text. Returns an array of problems (empty = ok).
 * `root` is the directory backticked paths are resolved against.
 */
function checkRecord(text, root) {
  const problems = [];
  const secs = sections(text);
  let from = 0;
  for (const h of HEADINGS) {
    const idx = secs.findIndex((s, i) => i >= from && s.title === h);
    if (idx === -1) {
      problems.push(secs.some((s) => s.title === h) ? `"${h}" out of order` : `"${h}"`);
    } else {
      from = idx + 1;
    }
  }
  const pins = secs.find((s) => s.title === 'What pins it');
  if (pins && !isGap(pins.body)) {
    const paths = [...pins.body.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]).filter((p) => p.includes('/') || /\.\w+$/.test(p));
    const existing = paths.filter((p) => fs.existsSync(path.join(root, p)));
    if (paths.length === 0) {
      problems.push('"What pins it" has no backticked repo path and is not the GAP sentence');
    } else if (existing.length === 0) {
      problems.push(`"What pins it" cites no path that exists (${paths.join(', ')})`);
    } else {
      for (const p of paths) if (!existing.includes(p)) problems.push(`"What pins it" cites a dead path: ${p}`);
    }
  }
  return problems;
}

function recordFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort();
}

function main(argv) {
  const files = recordFiles(INCIDENTS);
  if (argv.includes('--list-gaps')) {
    for (const f of files) {
      const pins = sections(fs.readFileSync(path.join(INCIDENTS, f), 'utf8')).find((s) => s.title === 'What pins it');
      if (pins && isGap(pins.body)) console.log(f);
    }
    return 0;
  }
  let bad = 0;
  for (const f of files) {
    const problems = checkRecord(fs.readFileSync(path.join(INCIDENTS, f), 'utf8'), REPO);
    if (problems.length) {
      bad++;
      console.log(`${f}: missing: ${problems.join('; ')}`);
    } else {
      console.log(`${f}: ok`);
    }
  }
  if (bad) {
    console.log(`FAIL - ${bad} of ${files.length} incident records are not in the standard's shape`);
    return 1;
  }
  console.log(`PASS - ${files.length} incident records`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { checkRecord, sections, isGap, HEADINGS, GAP_SENTENCE };
