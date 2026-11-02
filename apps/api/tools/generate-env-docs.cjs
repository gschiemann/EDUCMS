#!/usr/bin/env node
/**
 * generate-env-docs.cjs - renders the environment declaration
 * (apps/api/src/config/env-schema.ts) into the two places people read it, so neither can drift
 * from the code the way prose did (Foundry mechanism #15).
 *
 *   docs/ENVIRONMENT.md   a GENERATED REGION between two markers:
 *                           variable | default | purpose | kill switch? | failure direction |
 *                           documented in CLAUDE.md?   (plus a kill-switch table)
 *   .env.example          a generated, fully COMMENTED section listing every operator-settable
 *                         variable the file does not already name, each with its default. Existing
 *                         lines are never removed or changed: the section is appended once, then
 *                         only the block between its own markers is ever rewritten.
 *
 * docs/ENVIRONMENT.md is HAND-KEPT text in this repo (the former CLAUDE.md env table moved there),
 * so this tool never writes the file wholesale. It only owns the block between
 *     <!-- ENV-SCHEMA:BEGIN ... -->  and  <!-- ENV-SCHEMA:END -->
 * and everything outside it is left byte for byte. Whether a variable is "documented in
 * CLAUDE.md" is read from the hand-kept tables (CLAUDE.md's Environment Variables section, and
 * docs/ENVIRONMENT.md OUTSIDE the generated block), so the column survives the table moving.
 *
 * MODES
 *   (no flag)               dry run: print what would be written; touch nothing
 *   --check                 exit 1 when a target on disk differs from what the schema renders
 *                           (a missing docs file or a missing block counts as drift: a check that
 *                           silently skips its target is a false green)
 *   --write                 rewrite the generated block of each selected target
 *   --only=docs|env-example restrict to one target (default: both)
 *   --docs-path=<path>      docs target (default docs/ENVIRONMENT.md)
 *   --env-example-path=<p>  .env.example target (default .env.example)
 *
 * Examples
 *   node apps/api/tools/generate-env-docs.cjs --check --only=env-example
 *   node apps/api/tools/generate-env-docs.cjs --write --only=env-example
 *   node apps/api/tools/generate-env-docs.cjs --check            # docs + .env.example, strict
 *
 * Needs `pnpm install` first (it loads the TypeScript compiler and zod from apps/api).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadEnvSchema, REPO_ROOT } = require('./env-scan.cjs');

const SCHEMA_REL = 'apps/api/src/config/env-schema.ts';
const SELF_REL = 'apps/api/tools/generate-env-docs.cjs';
const DEFAULT_DOCS_REL = 'docs/ENVIRONMENT.md';
const DEFAULT_ENV_EXAMPLE_REL = '.env.example';

const DOCS_REGION_RE = /<!-- ENV-SCHEMA:BEGIN[^>]*-->[\s\S]*?<!-- ENV-SCHEMA:END -->/;
const EX_REGION_RE = /^# >>> BEGIN GENERATED[^\n]*\n[\s\S]*?^# <<< END GENERATED[^\n]*$/m;

// ── source of the group headings ───────────────────────────────────────────────────────────

/**
 * The schema groups its entries under `// ─── Title ───…` comment lines. Read them so the
 * generated .env.example is sectioned the way the declaration is. A heading that goes missing
 * (someone reformatted the file) only costs the grouping: entries fall under "Other".
 */
function groupsFromSource(text) {
  const byName = new Map();
  const order = [];
  let group = 'Other';
  for (const line of text.split('\n')) {
    const h = line.match(/^\s*\/\/ ─── (.+?) ─+\s*$/);
    if (h) {
      group = h[1].trim();
      if (!order.includes(group)) order.push(group);
      continue;
    }
    const n = line.match(/^\s*\{ name: '([A-Z][A-Z0-9_]*)'/);
    if (n) byName.set(n[1], group);
  }
  return { byName, order };
}

// ── "documented in CLAUDE.md?" ─────────────────────────────────────────────────────────────

/** Names in the first cell of a markdown table row; `FOO_*` becomes a wildcard. */
function tableNames(text) {
  const names = new Set();
  const wild = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*(.+?)\s*\|/);
    if (!m) continue;
    for (const t of m[1].matchAll(/`([A-Z][A-Z0-9_*]*)`/g)) {
      if (t[1].includes('*')) wild.push(new RegExp('^' + t[1].replace(/\*/g, '[A-Z0-9_]*') + '$'));
      else names.add(t[1]);
    }
  }
  return { names, wild };
}

function mentionedNames(text) {
  return new Set([...text.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map((m) => m[1]));
}

/** The text of one `## ` section (the Environment Variables table lives in a section of CLAUDE.md). */
function section(text, headingRe) {
  const out = [];
  let on = false;
  for (const line of text.split('\n')) {
    if (/^## /.test(line)) on = headingRe.test(line);
    if (on) out.push(line);
  }
  return out.join('\n');
}

/**
 * name -> 'claude' | 'environment-md' | 'mentioned' | 'none'.
 * `docsText` is the current docs/ENVIRONMENT.md (or null); its generated block is ignored so a
 * variable never counts as documented by its own generated row.
 */
function documentationStatus(claudeText, docsText) {
  const claude = tableNames(section(claudeText || '', /^## Environment Variables/));
  const handKept = docsText ? docsText.replace(DOCS_REGION_RE, '') : '';
  const env = tableNames(handKept);
  const mentions = new Set([...mentionedNames(claudeText || ''), ...mentionedNames(handKept)]);
  return (name) => {
    if (claude.names.has(name) || claude.wild.some((r) => r.test(name))) return 'claude';
    if (env.names.has(name) || env.wild.some((r) => r.test(name))) return 'environment-md';
    return mentions.has(name) ? 'mentioned' : 'none';
  };
}

// ── markdown rendering ─────────────────────────────────────────────────────────────────────

/** Escape a table cell: pipes everywhere, angle brackets outside code spans (so <NAME> survives). */
function cell(text) {
  return String(text)
    .split(/(`[^`]*`)/)
    .map((part, i) => {
      const piped = part.replace(/\|/g, '\\|');
      return i % 2 === 1 ? piped : piped.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    })
    .join('');
}

function defaultCell(v) {
  const bits = [];
  if (v.default === null) bits.push(v.type === 'secret' ? 'unset (secret)' : 'unset');
  else bits.push('`' + String(v.default).replace(/`/g, "'") + '`');
  if (v.type === 'boolean' && v.accepts) bits.push('accepts `' + v.accepts.replace(/\|/g, '/') + '`');
  if (v.type === 'enum' && v.values) bits.push('one of ' + v.values.map((x) => '`' + x + '`').join(', '));
  return bits.map(cell).join('<br>');
}

function purposeCell(v) {
  const tags = [];
  if (v.retired) tags.push('RETIRED');
  if (v.origin === 'platform') tags.push('platform-provided');
  if (v.origin === 'internal') tags.push('set by the API');
  const head = tags.length ? '[' + tags.join(', ') + '] ' : '';
  return cell(head + v.purpose + (v.note ? ' ' + v.note : ''));
}

function docLabel(status) {
  return { claude: 'yes', 'environment-md': 'yes (ENVIRONMENT.md)', mentioned: 'mentioned', none: 'no' }[status];
}

function renderDocsRegion(vars, statusOf) {
  const sorted = [...vars].sort((a, b) => a.name.localeCompare(b.name));
  const switches = sorted.filter((v) => v.killSwitch);
  const undocumented = sorted.filter((v) => statusOf(v.name) === 'none').length;
  const row = (v) =>
    `| \`${v.name}\` | ${defaultCell(v)} | ${purposeCell(v)} | ${v.killSwitch ? 'yes' : '-'} | ${v.failureDirection} | ${docLabel(statusOf(v.name))} |`;
  const head = ['| Variable | Default | Purpose | Kill switch? | Failure direction | Documented in CLAUDE.md? |', '|---|---|---|---|---|---|'];
  const lines = [
    `<!-- ENV-SCHEMA:BEGIN generated by ${SELF_REL} from ${SCHEMA_REL}; do not edit between the markers -->`,
    '## Declared environment variables (generated)',
    '',
    `Generated from \`${SCHEMA_REL}\` by \`${SELF_REL}\`. ${sorted.length} variables, ${switches.length} kill switches, ${undocumented} not documented by hand anywhere.`,
    'Defaults are copies of what each reader falls back to; "unset" means the code has no fallback value (the Purpose cell says what happens instead).',
    '',
    '**Failure direction** is Article 15\'s decided direction for a missing or unusable setting: **closed** = the code refuses or withholds (a required secret stops the boot, a gate stays shut, an opt-in capability stays off, a protection stays in force); **open** = it carries on without it (an optional integration goes dormant, a limit or check is not applied, a job skips its tick); **n/a** = the variable gates nothing (plain tuning). A kill switch is never n/a.',
    '',
    '### Kill switches',
    '',
    ...head,
    ...switches.map(row),
    '',
    '### Every variable',
    '',
    ...head,
    ...sorted.map(row),
    '<!-- ENV-SCHEMA:END -->',
  ];
  return lines.join('\n');
}

function applyDocsRegion(text, region) {
  if (DOCS_REGION_RE.test(text)) return text.replace(DOCS_REGION_RE, () => region);
  const sep = text.length === 0 ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return text + sep + region + '\n';
}

function newDocsFile(region) {
  return '# Environment variables\n\n' + region + '\n';
}

// ── .env.example rendering ─────────────────────────────────────────────────────────────────

function wrap(text, width, prefix) {
  const out = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (cur && (prefix + cur + ' ' + word).length > width) {
      out.push(prefix + cur);
      cur = word;
    } else cur = cur ? cur + ' ' + word : word;
  }
  if (cur) out.push(prefix + cur);
  return out;
}

function exampleValue(v) {
  if (v.default === null) return '';
  const s = String(v.default);
  return /[\s#"'$`\\<>]/.test(s) ? JSON.stringify(s) : s;
}

/** Names already in the file OUTSIDE the generated section, as `NAME=` or `# NAME=`. */
function namesInEnvExample(text) {
  const present = new Set();
  for (const line of text.replace(EX_REGION_RE, '').split('\n')) {
    const m = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/);
    if (m) present.add(m[1]);
  }
  return present;
}

/** Only variables an operator sets, not retired ones, and not ones the file already names. */
function envExampleCandidates(vars, present) {
  return vars.filter((v) => !v.retired && (v.origin ?? 'operator') === 'operator' && !present.has(v.name));
}

function renderEnvExampleRegion(vars, present, groups) {
  const todo = envExampleCandidates(vars, present);
  const lines = [
    '# >>> BEGIN GENERATED - ' + SELF_REL + ' (source: ' + SCHEMA_REL + ')',
    '# Every operator-settable variable the API reads that is not named above, with the value its reader',
    '# falls back to. ALL ROWS ARE COMMENTED OUT: copying this file changes nothing. Uncomment to set.',
    '# Left out on purpose: variables the platform provides (PATH, PORT, RAILWAY_*) and retired ones.',
    '# Do not edit between the markers: the next run replaces the block. Regenerate with',
    '#   node ' + SELF_REL + ' --write --only=env-example',
  ];
  if (!todo.length) lines.push('#', '# (every variable is already named above)');
  const order = [...groups.order, 'Other'];
  for (const title of order) {
    const rows = todo.filter((v) => (groups.byName.get(v.name) || 'Other') === title);
    if (!rows.length) continue;
    lines.push('', '# -- ' + title + ' --');
    for (const v of rows) {
      const meta = [];
      if (v.type === 'secret') meta.push('secret');
      if (v.killSwitch) meta.push('kill switch');
      if (v.failureDirection !== 'n/a') meta.push('fails ' + v.failureDirection);
      if (v.type === 'boolean' && v.accepts) meta.push('set with: ' + v.accepts);
      if (v.type === 'enum' && v.values) meta.push('one of: ' + v.values.join(' | '));
      lines.push(...wrap(v.purpose + (meta.length ? ' [' + meta.join('; ') + ']' : ''), 104, '# '));
      lines.push('# ' + v.name + '=' + exampleValue(v));
    }
  }
  lines.push('# <<< END GENERATED');
  return lines.join('\n');
}

function applyEnvExampleRegion(text, region) {
  if (EX_REGION_RE.test(text)) return text.replace(EX_REGION_RE, () => region);
  const base = text.length === 0 || text.endsWith('\n') ? text : text + '\n';
  return base + '\n' + region + '\n';
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const o = { check: false, write: false, only: null, docsPath: DEFAULT_DOCS_REL, exPath: DEFAULT_ENV_EXAMPLE_REL, help: false };
  for (const a of argv) {
    if (a === '--check') o.check = true;
    else if (a === '--write') o.write = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--only=')) o.only = a.slice(7);
    else if (a.startsWith('--docs-path=')) o.docsPath = a.slice(12);
    else if (a.startsWith('--env-example-path=')) o.exPath = a.slice(19);
    else throw new Error('unknown argument: ' + a);
  }
  if (o.only && !['docs', 'env-example'].includes(o.only)) throw new Error('--only must be docs or env-example');
  if (o.check && o.write) throw new Error('use --check or --write, not both');
  return o;
}

function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  if (o.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
    return 0;
  }

  const schema = loadEnvSchema();
  const vars = schema.ENV_VARS;
  const schemaText = fs.readFileSync(path.join(REPO_ROOT, SCHEMA_REL), 'utf8');
  const groups = groupsFromSource(schemaText);
  const abs = (p) => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p));
  const targets = [];

  if (o.only !== 'env-example') {
    const file = abs(o.docsPath);
    const current = readIfExists(file);
    const claudeText = readIfExists(path.join(REPO_ROOT, 'CLAUDE.md'));
    const region = renderDocsRegion(vars, documentationStatus(claudeText, current));
    targets.push({ name: 'docs', file, current, region, next: current === null ? newDocsFile(region) : applyDocsRegion(current, region), hasRegion: current !== null && DOCS_REGION_RE.test(current) });
  }
  if (o.only !== 'docs') {
    const file = abs(o.exPath);
    const current = readIfExists(file);
    if (current === null) {
      console.error(`.env.example not found at ${file}`);
      return 2;
    }
    const region = renderEnvExampleRegion(vars, namesInEnvExample(current), groups);
    targets.push({ name: 'env-example', file, current, region, next: applyEnvExampleRegion(current, region), hasRegion: EX_REGION_RE.test(current) });
  }

  const rel = (f) => path.relative(REPO_ROOT, f) || f;
  if (o.check) {
    let bad = 0;
    for (const t of targets) {
      if (t.current === null) {
        console.error(`DRIFT  ${rel(t.file)} does not exist. Create the generated block with: node ${SELF_REL} --write --only=${t.name}`);
        bad++;
      } else if (!t.hasRegion) {
        console.error(`DRIFT  ${rel(t.file)} has no generated block yet. Add it with: node ${SELF_REL} --write --only=${t.name}`);
        bad++;
      } else if (t.next !== t.current) {
        console.error(`DRIFT  ${rel(t.file)} no longer matches ${SCHEMA_REL}. Regenerate with: node ${SELF_REL} --write --only=${t.name}`);
        bad++;
      } else console.log(`ok     ${rel(t.file)} matches ${SCHEMA_REL}`);
    }
    return bad ? 1 : 0;
  }

  if (o.write) {
    for (const t of targets) {
      if (t.next === t.current) console.log(`unchanged  ${rel(t.file)}`);
      else {
        fs.mkdirSync(path.dirname(t.file), { recursive: true });
        fs.writeFileSync(t.file, t.next);
        console.log(`wrote      ${rel(t.file)}`);
      }
    }
    return 0;
  }

  // dry run
  for (const t of targets) {
    console.log(`----- ${t.name}: ${rel(t.file)} (${t.current === null ? 'does not exist' : t.next === t.current ? 'up to date' : 'would change'}) -----`);
    console.log(t.region);
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  groupsFromSource,
  documentationStatus,
  renderDocsRegion,
  applyDocsRegion,
  renderEnvExampleRegion,
  applyEnvExampleRegion,
  namesInEnvExample,
  envExampleCandidates,
  cell,
  main,
};
