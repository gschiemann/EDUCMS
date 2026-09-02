#!/usr/bin/env node
/**
 * Hardware qualification gate.
 *
 * Reads apps/player/HARDWARE-QUALIFICATION.md and refuses a release whose
 * REQUIRED hardware classes have not been tested on real hardware.
 *
 * Headless Chromium does not reproduce OEM certificate stores, OEM DNS/network
 * stacks, memory pressure, broken WebView providers, remote-key-only firmware or
 * storage corruption. Two units bricked at install (2026-08-30) and an Android-9
 * Goodview LCD sat on "Connecting…" with CI green. This script is the gate that
 * stops "CI is green" from being restated as "the fleet is fine".
 *
 * Usage:
 *   node scripts/check-hardware-qual.cjs                       # player, version from build.gradle.kts
 *   node scripts/check-hardware-qual.cjs player 1.1.12
 *   node scripts/check-hardware-qual.cjs --app manager --version 1.0.24
 *   node scripts/check-hardware-qual.cjs --tag player-v1.1.13
 *   node scripts/check-hardware-qual.cjs --matrix /tmp/fixture.md --app player --version 9.9.9
 *   node scripts/check-hardware-qual.cjs --json
 *
 * Exit codes: 0 = qualified, 1 = not qualified / malformed input.
 *
 * Dependency-free plain Node so CI can run it with no `pnpm install`.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MATRIX = path.join(REPO_ROOT, 'apps', 'player', 'HARDWARE-QUALIFICATION.md');

const GRADLE_FOR_APP = {
  player: path.join(REPO_ROOT, 'apps', 'player', 'app', 'build.gradle.kts'),
  manager: path.join(REPO_ROOT, 'apps', 'player', 'manager', 'build.gradle.kts'),
};

// A cell satisfies the gate when it is PASS (tested), NA (justified as
// inapplicable) or OVERRIDE (an explicit, logged hotfix escape). FAIL and
// UNQUALIFIED never satisfy it.
const SATISFYING = new Set(['PASS', 'NA', 'OVERRIDE']);
const KNOWN_STATUSES = new Set(['PASS', 'FAIL', 'NA', 'UNQUALIFIED', 'OVERRIDE']);

const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;
const INITIALS_RE = /\b([A-Z]{2,4})\b/;

// ── markdown helpers ───────────────────────────────────────────────────────

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, '')));
}

/** Parse the first markdown table appearing at or after `startLine`. */
function parseTableAfter(lines, startLine, stopAtHeading) {
  let i = startLine;
  while (i < lines.length) {
    const line = lines[i];
    if (stopAtHeading && /^##\s/.test(line)) return null;
    if (line.trim().startsWith('|')) break;
    i += 1;
  }
  if (i >= lines.length) return null;

  const header = splitRow(lines[i]);
  i += 1;
  if (i < lines.length && isSeparatorRow(splitRow(lines[i]))) i += 1;

  const rows = [];
  while (i < lines.length && lines[i].trim().startsWith('|')) {
    const cells = splitRow(lines[i]);
    if (!isSeparatorRow(cells)) rows.push(cells);
    i += 1;
  }
  return { header, rows, endLine: i };
}

// ── matrix parsing ─────────────────────────────────────────────────────────

/**
 * @returns {{classes: Array<{id:string,tier:string}>, releases: Map<string,{header:string[],rows:Map<string,string[]>}>}}
 */
function parseMatrix(text) {
  const lines = text.split(/\r?\n/);

  // 1. Hardware classes table — the section headed "## Hardware classes".
  const classHeadingIdx = lines.findIndex((l) => /^##\s+Hardware classes\s*$/i.test(l.trim()));
  if (classHeadingIdx === -1) {
    throw new Error('matrix has no "## Hardware classes" section');
  }
  const classTable = parseTableAfter(lines, classHeadingIdx + 1, true);
  if (!classTable) throw new Error('"## Hardware classes" section has no table');

  const classes = [];
  for (const row of classTable.rows) {
    const id = (row[0] || '').replace(/`/g, '').trim();
    const tier = (row[1] || '').replace(/[`*]/g, '').trim().toUpperCase();
    if (!id || id.startsWith('_')) continue;
    if (tier !== 'REQUIRED' && tier !== 'OPTIONAL') {
      throw new Error(`hardware class "${id}" has an unknown tier "${row[1]}" (want REQUIRED or OPTIONAL)`);
    }
    classes.push({ id, tier });
  }
  if (classes.length === 0) throw new Error('no hardware classes found');

  // 2. Release sections — "## Release: <app> <version>".
  const releases = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^##\s+Release:\s+(\S+)\s+(\S+)\s*$/.exec(lines[i].trim());
    if (!m) continue;
    const key = `${m[1]} ${m[2]}`;
    const table = parseTableAfter(lines, i + 1, true);
    if (!table) throw new Error(`release section "${key}" has no table`);
    const rows = new Map();
    for (const cells of table.rows) {
      const id = (cells[0] || '').replace(/`/g, '').trim();
      if (!id || id.startsWith('_')) continue;
      rows.set(id, cells.slice(1));
    }
    releases.set(key, { header: table.header.slice(1).map((h) => h.replace(/`/g, '').trim()), rows });
  }

  return { classes, releases };
}

/** Classify one cell's text. */
function readCell(raw) {
  const text = (raw || '').trim();
  if (!text) return { status: 'UNQUALIFIED', reason: 'cell is empty' };
  const statusMatch = /^([A-Za-z-]+)/.exec(text);
  const status = statusMatch ? statusMatch[1].toUpperCase() : '';
  if (!KNOWN_STATUSES.has(status)) {
    return { status: 'MALFORMED', reason: `unrecognised status "${text}"` };
  }
  const rest = text.slice(statusMatch[1].length);
  if (status === 'PASS' || status === 'OVERRIDE') {
    if (!DATE_RE.test(rest)) return { status, ok: false, reason: `${status} without a YYYY-MM-DD date` };
    if (!INITIALS_RE.test(rest)) return { status, ok: false, reason: `${status} without initials` };
    return { status, ok: true, date: DATE_RE.exec(rest)[1], initials: INITIALS_RE.exec(rest)[1] };
  }
  if (status === 'NA') {
    const note = rest.replace(/^[\s—–-]+/, '').trim();
    if (!note) return { status, ok: false, reason: 'NA without a note explaining why it is inapplicable' };
    return { status, ok: true, note };
  }
  if (status === 'FAIL') return { status, ok: false, reason: 'FAIL recorded on hardware' };
  return { status: 'UNQUALIFIED', ok: false, reason: 'not tested on hardware yet' };
}

/**
 * Evaluate one release.
 * @returns {{ok:boolean, missing:Array<{class:string,check:string,reason:string}>, notes:string[]}}
 */
function evaluate(matrixText, app, version) {
  const { classes, releases } = parseMatrix(matrixText);
  const key = `${app} ${version}`;
  const release = releases.get(key);
  const missing = [];
  const notes = [];

  if (!release) {
    return {
      ok: false,
      missing: [
        {
          class: '(all)',
          check: '(all)',
          reason:
            `no "## Release: ${key}" section in the matrix — add one (copy the class rows ` +
            'from the previous release, reset every cell to UNQUALIFIED) and run the checklist',
        },
      ],
      notes,
    };
  }

  const checks = release.header;
  if (checks.length === 0) throw new Error(`release "${key}" table has no check columns`);

  for (const cls of classes) {
    if (cls.tier !== 'REQUIRED') continue;
    const row = release.rows.get(cls.id);
    if (!row) {
      missing.push({ class: cls.id, check: '(all)', reason: 'REQUIRED hardware class has no row in this release' });
      continue;
    }
    for (let c = 0; c < checks.length; c += 1) {
      const verdict = readCell(row[c]);
      if (verdict.status === 'MALFORMED') {
        missing.push({ class: cls.id, check: checks[c], reason: verdict.reason });
        continue;
      }
      if (SATISFYING.has(verdict.status) && verdict.ok) {
        if (verdict.status === 'NA') notes.push(`NA  ${cls.id} / ${checks[c]} — ${verdict.note}`);
        if (verdict.status === 'OVERRIDE') {
          notes.push(`OVERRIDE  ${cls.id} / ${checks[c]} — waved through ${verdict.date} by ${verdict.initials}`);
        }
        continue;
      }
      missing.push({ class: cls.id, check: checks[c], reason: verdict.reason });
    }
  }

  return { ok: missing.length === 0, missing, notes };
}

// ── override recording ─────────────────────────────────────────────────────

/**
 * Rewrite the matrix so `app`/`version` is explicitly waved through, and log the
 * wave-through. Used ONLY by `scripts/release-apk.sh --unqualified-override` for a
 * genuine hotfix. Every cell it touches becomes a visible OVERRIDE in git history —
 * the point is that an escape hatch leaves a permanent, greppable mark, never a
 * silent pass.
 *
 * @returns {{text:string, missing:Array, checks:string[]}}
 */
function recordOverride(matrixText, { app, version, operator, reason, date }) {
  const { classes, releases } = parseMatrix(matrixText);
  const key = `${app} ${version}`;
  const before = evaluate(matrixText, app, version);

  // Column set: this release's own, else the most recent release section's.
  let checks = releases.get(key) ? releases.get(key).header : null;
  if (!checks) {
    const all = [...releases.values()];
    if (all.length === 0) throw new Error('matrix has no release section to copy the check columns from');
    checks = all[all.length - 1].header;
  }

  const existing = releases.get(key);
  const cell = `OVERRIDE ${date} ${operator} -- ${reason}`;
  const rows = classes.map((cls) => {
    const prior = (existing && existing.rows.get(cls.id)) || [];
    const cells = checks.map((_, i) => (prior[i] || 'UNQUALIFIED').trim() || 'UNQUALIFIED');
    if (cls.tier === 'REQUIRED') {
      for (let i = 0; i < cells.length; i += 1) {
        const v = readCell(cells[i]);
        if (!(SATISFYING.has(v.status) && v.ok)) cells[i] = cell;
      }
    }
    return `| ${cls.id} | ${cells.join(' | ')} |`;
  });

  const section = [
    `## Release: ${key}`,
    '',
    `Released ${date} by ${operator} under \`--unqualified-override\`: ${reason}`,
    'The OVERRIDE cells below are UNPAID DEBT — run them on hardware and replace them.',
    '',
    `| class | ${checks.join(' | ')} |`,
    `|---|${checks.map(() => '---').join('|')}|`,
    ...rows,
    '',
  ];

  const lines = matrixText.split(/\r?\n/);
  const headingIdx = lines.findIndex((l) => new RegExp(`^##\\s+Release:\\s+${app}\\s+${version.replace(/\./g, '\\.')}\\s*$`).test(l.trim()));

  let out;
  if (headingIdx !== -1) {
    let end = headingIdx + 1;
    while (end < lines.length && !/^##\s/.test(lines[end])) end += 1;
    out = [...lines.slice(0, headingIdx), ...section, ...lines.slice(end)];
  } else {
    const logIdx = lines.findIndex((l) => /^##\s+Override log\s*$/i.test(l.trim()));
    const at = logIdx === -1 ? lines.length : logIdx;
    out = [...lines.slice(0, at), ...section, ...lines.slice(at)];
  }

  // Append a row to the Override log table, replacing the "(none yet)" placeholder.
  const logIdx = out.findIndex((l) => /^##\s+Override log\s*$/i.test(l.trim()));
  if (logIdx !== -1) {
    // Group by class so a wholly-untested class reads `class/*` rather than nine
    // near-identical entries — the log row has to stay readable to be read.
    const byClass = new Map();
    for (const m of before.missing) {
      if (!byClass.has(m.class)) byClass.set(m.class, []);
      byClass.get(m.class).push(m.check);
    }
    const cellsSummary = before.missing.length
      ? [...byClass.entries()]
          .map(([cls, list]) =>
            list.length === checks.length || list.includes('(all)') ? `${cls}/*` : `${cls}/{${list.join(',')}}`,
          )
          .join(', ')
      : '(none — already qualified)';
    const row = `| ${date} | ${app} | ${version} | ${operator} | ${cellsSummary} | ${reason} |`;
    let i = logIdx;
    let lastTableLine = -1;
    while (i < out.length) {
      if (i > logIdx && /^##\s/.test(out[i])) break;
      if (out[i].trim().startsWith('|')) lastTableLine = i;
      i += 1;
    }
    if (lastTableLine === -1) throw new Error('Override log section has no table');
    if (/_\(none yet\)_/.test(out[lastTableLine])) out[lastTableLine] = row;
    else out.splice(lastTableLine + 1, 0, row);
  }

  return { text: `${out.join('\n').replace(/\n{3,}/g, '\n\n')}`, missing: before.missing, checks };
}

// ── version discovery ──────────────────────────────────────────────────────

function versionFromGradle(app) {
  const file = GRADLE_FOR_APP[app];
  if (!file || !fs.existsSync(file)) return null;
  const m = /versionName\s*=\s*"([^"]+)"/.exec(fs.readFileSync(file, 'utf8'));
  return m ? m[1] : null;
}

function parseArgs(argv) {
  const out = { app: null, version: null, matrix: DEFAULT_MATRIX, json: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--record-override') out.recordOverride = true;
    else if (a === '--operator') out.operator = argv[++i];
    else if (a === '--reason') out.reason = argv[++i];
    else if (a === '--date') out.date = argv[++i];
    else if (a === '--app') out.app = argv[++i];
    else if (a === '--version') out.version = argv[++i];
    else if (a === '--matrix') out.matrix = argv[++i];
    else if (a === '--tag') {
      const t = argv[++i] || '';
      const m = /^(player|manager)-v(.+)$/.exec(t);
      if (!m) throw new Error(`--tag must look like player-v1.2.3 or manager-v1.2.3 (got "${t}")`);
      out.app = m[1];
      out.version = m[2];
    } else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else positional.push(a);
  }
  if (!out.app && positional[0]) out.app = positional[0];
  if (!out.version && positional[1]) out.version = positional[1];
  if (!out.app) out.app = 'player';
  if (out.app !== 'player' && out.app !== 'manager') {
    throw new Error(`app must be "player" or "manager" (got "${out.app}")`);
  }
  if (!out.version) out.version = versionFromGradle(out.app);
  if (!out.version) throw new Error(`could not determine a version for "${out.app}" — pass one explicitly`);
  return out;
}

const HELP = `check-hardware-qual.cjs — block a player release that has not been tested on real hardware

  node scripts/check-hardware-qual.cjs [player|manager] [x.y.z]
  node scripts/check-hardware-qual.cjs --tag player-v1.1.13
  node scripts/check-hardware-qual.cjs --app manager --version 1.0.24 [--matrix FILE] [--json]

Reads apps/player/HARDWARE-QUALIFICATION.md. Exits 1 unless every REQUIRED hardware
class has PASS (with date + initials), a justified NA, or a logged OVERRIDE for every
check. Prints the missing cells.

Hotfix escape hatch (used by scripts/release-apk.sh --unqualified-override):
  --record-override --operator GS --reason "..."   rewrite the matrix, logging the
  wave-through as OVERRIDE cells plus a row in the Override log. Never use this to
  make a red gate green — the missing cells stay owed.`;

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`hardware-qual: ${err.message}\n\n${HELP}`);
    process.exit(1);
  }
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (!fs.existsSync(args.matrix)) {
    console.error(`hardware-qual: matrix not found at ${args.matrix}`);
    process.exit(1);
  }

  if (args.recordOverride) {
    const operator = (args.operator || 'OVR').toUpperCase();
    const reason = args.reason || 'hotfix release, hardware qualification deferred';
    const date = args.date || new Date().toISOString().slice(0, 10);
    if (!/^[A-Z]{2,4}$/.test(operator)) {
      console.error(`hardware-qual: --operator must be 2-4 letters (got "${operator}")`);
      process.exit(1);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      console.error(`hardware-qual: --date must be YYYY-MM-DD (got "${date}")`);
      process.exit(1);
    }
    let res;
    try {
      res = recordOverride(fs.readFileSync(args.matrix, 'utf8'), {
        app: args.app,
        version: args.version,
        operator,
        reason: reason.replace(/\|/g, '/').replace(/\s+/g, ' ').trim(),
        date,
      });
    } catch (err) {
      console.error(`hardware-qual: cannot record override — ${err.message}`);
      process.exit(1);
    }
    fs.writeFileSync(args.matrix, res.text.endsWith('\n') ? res.text : `${res.text}\n`);
    console.log(
      `hardware-qual: recorded an OVERRIDE for ${args.app} v${args.version} ` +
        `(${res.missing.length} unqualified cell(s)) in ${path.relative(REPO_ROOT, args.matrix)}.`,
    );
    process.exit(0);
  }

  let result;
  try {
    result = evaluate(fs.readFileSync(args.matrix, 'utf8'), args.app, args.version);
  } catch (err) {
    console.error(`hardware-qual: cannot parse ${args.matrix} — ${err.message}`);
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify({ app: args.app, version: args.version, ...result }, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  const label = `${args.app} v${args.version}`;
  if (result.ok) {
    console.log(`hardware-qual: ${label} is QUALIFIED — every REQUIRED hardware class is covered.`);
    for (const n of result.notes) console.log(`  ${n}`);
    process.exit(0);
  }

  console.error(`hardware-qual: ${label} is NOT QUALIFIED — ${result.missing.length} missing cell(s).`);
  console.error('');
  console.error('  hardware class                check              why');
  console.error('  ---------------------------- ------------------ ----------------------------------');
  for (const m of result.missing) {
    console.error(`  ${m.class.padEnd(28)} ${m.check.padEnd(18)} ${m.reason}`);
  }
  console.error('');
  console.error('  Run docs/player/HARDWARE-QUAL-CHECKLIST.md on the physical units, record the');
  console.error(`  results in ${path.relative(REPO_ROOT, args.matrix)}, and re-run this check.`);
  console.error('  A genuine hotfix can use: scripts/release-apk.sh <app> <x.y.z> --unqualified-override');
  process.exit(1);
}

if (require.main === module) main();

module.exports = { parseMatrix, readCell, evaluate, versionFromGradle, recordOverride };
