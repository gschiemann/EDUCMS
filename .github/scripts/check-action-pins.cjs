#!/usr/bin/env node
/*
 * Action-pin gate (2026-11-01) — every `uses:` in .github/workflows must be pinned to a
 * full 40-hex commit SHA.
 *
 * WHY. A tag (`@v4`) or a branch is a MUTABLE pointer: whoever controls the action's
 * repository can move it to code that then runs in our jobs, next to our GITHUB_TOKEN and,
 * in the release workflow, the APK signing keystore. Every workflow here already pins by
 * SHA (SUPPLY-02), and Dependabot's github-actions entry is the update path for those pins
 * — but nothing ENFORCED the pinning, so the first `uses: foo/bar@v1` added in a hurry
 * would have gone unseen. This is that enforcement.
 *
 * WHAT COUNTS AS PINNED
 *   owner/repo[/path]@<40 lowercase hex>   an action or reusable workflow, third-party or not
 *   docker://image@sha256:<64 hex>         a container action pinned by digest
 *   ./path                                 a local action / workflow in this repository (the
 *                                          checked-out commit IS its pin — nothing can float)
 * Everything else is a violation: a tag, a branch, an abbreviated SHA, no ref at all, a
 * docker tag, an expression, or flow-style YAML this scanner cannot read (fails closed).
 *
 * Usage:   node .github/scripts/check-action-pins.cjs [--dir <workflows directory>]
 * Exit:    0  every reference is pinned
 *          1  at least one is not
 *          2  could not check — missing directory, no workflow files, or ZERO `uses:` found
 *             (a gate that scanned nothing is not a pass)
 * Output:  one `file:line: uses: <value> — <reason>` per violation, and under GitHub Actions
 *          also an `::error` annotation so the run page shows them without opening the log.
 *
 * Dependency-free on purpose: it must run before / without `pnpm install`. The scan is
 * line-based and skips comment lines and block scalars (`run: |` bodies), so a shell script
 * that merely PRINTS the word "uses:" is not a reference.
 *
 * Lives in .github/scripts/, NOT scripts/: a change under scripts/ redeploys the API.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FULL_SHA = /^[0-9a-f]{40}$/;
const DOCKER_DIGEST = /@sha256:[0-9a-f]{64}$/;
const ACTION_REF = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^@\s]+)?@(.+)$/;

// `uses:` as a block-style key, with or without the leading "- " of a list entry.
const USES_KEY = /^(\s*)(?:-\s+)?uses\s*:\s*(.*)$/;
// `uses:` buried in a flow mapping (`- { uses: x@v1 }`) — not parsed, so reported, not ignored.
const USES_FLOW = /[{,]\s*uses\s*:/;
// A key whose value is a block scalar (`run: |`, `script: >-`), and a bare `- |` list entry.
const BLOCK_KEY = /^(\s*)(-\s+)?[^\s#:][^:]*:\s*[|>][+-]?\d*\s*(?:#.*)?$/;
const BLOCK_ENTRY = /^(\s*)-\s+[|>][+-]?\d*\s*(?:#.*)?$/;

function usage() {
  return 'usage: node .github/scripts/check-action-pins.cjs [--dir <workflows directory>]';
}

function parseArgs(argv) {
  let dir = path.join(REPO_ROOT, '.github', 'workflows');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { help: true };
    if (a === '--dir') {
      if (!argv[i + 1]) return { error: '--dir needs a value' };
      dir = path.resolve(argv[++i]);
    } else if (a.startsWith('--dir=')) {
      if (a.length === 6) return { error: '--dir needs a value' };
      dir = path.resolve(a.slice(6));
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return { dir };
}

// The YAML scalar after `uses:` — quotes removed, a trailing `# comment` dropped.
function scalar(raw) {
  const s = raw.trim();
  if (s.startsWith('"') || s.startsWith("'")) {
    const end = s.indexOf(s[0], 1);
    return end === -1 ? s.slice(1) : s.slice(1, end);
  }
  const hash = s.search(/\s#/);
  return (hash === -1 ? s : s.slice(0, hash)).trim();
}

// -> { kind: 'pinned' | 'local' | 'docker' } or { violation: '<why>' }
function classify(value) {
  if (value === '') return { violation: 'an empty value' };
  if (value.startsWith('./')) return { kind: 'local' };
  if (value.includes('${{')) {
    return { violation: 'an expression — a computed ref cannot be a pin (GitHub does not evaluate expressions in uses:)' };
  }
  if (value.startsWith('docker://')) {
    return DOCKER_DIGEST.test(value)
      ? { kind: 'docker' }
      : { violation: 'a docker image not pinned by an @sha256:<digest>' };
  }
  if (!value.includes('@')) return { violation: 'no @ref at all — floats on the default branch' };
  const m = ACTION_REF.exec(value);
  if (!m) return { violation: 'not in owner/repo[/path]@<sha> form' };
  const ref = m[1];
  if (FULL_SHA.test(ref)) return { kind: 'pinned' };
  if (/^[0-9a-fA-F]{40}$/.test(ref)) return { violation: 'an upper-case SHA — use the lower-case 40-hex form' };
  if (/^[0-9a-fA-F]{7,39}$/.test(ref)) {
    return { violation: `an abbreviated SHA (${ref.length} characters) — pin the full 40` };
  }
  return { violation: `a mutable ref "${ref}" (a tag or branch), not a commit SHA` };
}

// Every `uses:` reference in one workflow file: [{ line, value, flow }].
function findUses(text) {
  const lines = text.split(/\r?\n/);
  const found = [];
  let blockKeyColumn = null; // set while inside a block scalar; its lines are text, not YAML
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (blockKeyColumn !== null) {
      if (line.trim() === '') continue;
      const indent = line.length - line.trimStart().length;
      if (indent > blockKeyColumn) continue;
      blockKeyColumn = null;
    }
    if (/^\s*#/.test(line)) continue;
    const bk = BLOCK_KEY.exec(line);
    if (bk) {
      blockKeyColumn = bk[1].length + (bk[2] ? bk[2].length : 0);
      continue;
    }
    const be = BLOCK_ENTRY.exec(line);
    if (be) {
      blockKeyColumn = be[1].length;
      continue;
    }
    const u = USES_KEY.exec(line);
    if (u) {
      found.push({ line: i + 1, value: scalar(u[2]), flow: false });
    } else if (USES_FLOW.test(line)) {
      found.push({ line: i + 1, value: line.trim(), flow: true });
    }
  }
  return found;
}

// GitHub workflow-command escaping, so a hostile value can never inject a command.
const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const clip = (s) => (s.length > 160 ? `${s.slice(0, 157)}...` : s);

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (args.error) {
    console.error(`check-action-pins: ${args.error}\n${usage()}`);
    return 2;
  }

  let names;
  try {
    names = fs
      .readdirSync(args.dir)
      .filter((n) => /\.ya?ml$/.test(n))
      .sort();
  } catch (e) {
    console.error(`check-action-pins: cannot read ${args.dir}: ${e.message}`);
    return 2;
  }
  if (names.length === 0) {
    console.error(`check-action-pins: no workflow files in ${args.dir} — nothing was checked`);
    return 2;
  }

  const onActions = process.env.GITHUB_ACTIONS === 'true';
  const counts = { pinned: 0, local: 0, docker: 0 };
  const violations = [];
  let total = 0;

  for (const name of names) {
    const file = path.join(args.dir, name);
    const shown = path.relative(REPO_ROOT, file).startsWith('..') ? file : path.relative(REPO_ROOT, file);
    for (const ref of findUses(fs.readFileSync(file, 'utf8'))) {
      total++;
      const verdict = ref.flow
        ? { violation: 'flow-style YAML this scanner cannot read — write the step block-style so it can be checked' }
        : classify(ref.value);
      if (verdict.kind) {
        counts[verdict.kind]++;
        continue;
      }
      const text = ref.flow ? ref.value : `uses: ${ref.value}`;
      violations.push({ shown, line: ref.line, text: clip(text), why: verdict.violation });
    }
  }

  if (total === 0) {
    console.error(`check-action-pins: found no \`uses:\` in ${names.length} workflow file(s) — the scan matched nothing, so it proves nothing`);
    return 2;
  }

  for (const v of violations) {
    console.log(`${v.shown}:${v.line}: ${v.text} — ${v.why}`);
    if (onActions) {
      console.log(`::error file=${escProp(v.shown)},line=${v.line},title=Action not pinned to a commit SHA::${escData(`${v.text} — ${v.why}`)}`);
    }
  }

  const summary =
    `check-action-pins: ${names.length} workflow file(s), ${total} uses: reference(s) — ` +
    `${counts.pinned} pinned to a full commit SHA, ${counts.docker} docker digest(s), ${counts.local} local, ` +
    `${violations.length} violation(s)`;
  if (violations.length > 0) {
    console.error(`${summary}\nPin each one to the full commit SHA of the release you trust: \`uses: owner/repo@<40-hex> # vX.Y.Z\`.`);
    return 1;
  }
  console.log(`${summary} ✓`);
  return 0;
}

process.exitCode = main();
