#!/usr/bin/env node
'use strict';

/**
 * check-rulebook.cjs — keeps the rulebook honest (no dependencies; TypeScript is
 * resolved only for the preset count in check (d)).
 *
 * The rulebook is CLAUDE.md (the always-loaded core), AGENTS.md, every nested
 * CLAUDE.md, docs/ENVIRONMENT.md, docs/DEPLOY.md, docs/governance/*.md and
 * docs/incidents/*.md. This script FAILS (exit 1, every offence listed) when, in
 * any of those files:
 *
 *   (a) a backticked repo path does not exist in the tree. A path is "backticked
 *       and path-like" when it sits in inline code, has no whitespace, contains a
 *       "/", and is not a URL, a route (leading "/"), a glob / placeholder
 *       (<kind>/v<code>, *, {a,b}, ...), an @scope or @/alias name, a MIME type, a
 *       git ref or an allow-listed non-path. A path that starts at a top-level
 *       entry of the repository must exist exactly. A partial path
 *       (realtime/redis.service.ts) must be the tail of some tracked path.
 *       Only paths that end in a known file extension, end in "/", or start at a
 *       top-level repository entry are checked — other slash-bearing words
 *       (fb0/modes, N/A) are prose.
 *   (b) a pointer to a code line exists: "path.ext:NNN", "line NNN", "~line NNN",
 *       "#L12". History cites commits, never lines; a line number is stale the
 *       day someone edits the file.
 *   (c) CLAUDE.md is over 3,000 words or AGENTS.md is over 1,800.
 *   (d) a template count stated in apps/web/public/templates/CLAUDE.md differs
 *       from what re-derives: unique preset ids (the *-presets.ts files under
 *       apps/api/src/templates, transpiled with the TypeScript compiler API), board
 *       files (apps/web/public/templates/**.html, any path segment starting with
 *       "_" excluded) and the shim version (the EDUCMS-SHIM-V<n> MARKER constant of
 *       apps/web/scripts/inject-shim-v2.cjs). The derived numbers are always
 *       printed.
 *
 * "The tree" is what git would hold: tracked files plus untracked files that are
 * not ignored (so gitignored docs/research/ paths are NOT in the tree, exactly as
 * in CI). Outside a git checkout it falls back to walking the directory.
 *
 *   node scripts/check-rulebook.cjs                 # check the repository
 *   node scripts/check-rulebook.cjs --self-test     # negative + positive control
 *   node scripts/check-rulebook.cjs --verbose       # also list the tolerated mentions
 *   node scripts/check-rulebook.cjs --root <dir>    # check another checkout
 *
 * TypeScript is found like any module (node_modules, NODE_PATH). In CI the
 * workflow installs the lockfile's version into a temp dir and sets NODE_PATH.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WORD_LIMITS = { 'CLAUDE.md': 3000, 'AGENTS.md': 1800 };
const TEMPLATES_RULEBOOK = 'apps/web/public/templates/CLAUDE.md';
const PRESETS_DIR = 'apps/api/src/templates';
const BOARDS_DIR = 'apps/web/public/templates';
const SHIM_INJECTOR = 'apps/web/scripts/inject-shim-v2.cjs';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '.pnpm-store', '.cache',
]);

const FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'cjs', 'mjs', 'md', 'mdx', 'json', 'yml', 'yaml', 'sh', 'kt', 'kts', 'java',
  'gradle', 'sql', 'prisma', 'html', 'css', 'scss', 'png', 'jpg', 'jpeg', 'svg', 'webp', 'mp4', 'xml',
  'toml', 'txt', 'lock', 'properties', 'pro', 'gitignore', 'example', 'sample',
]);

// Slash-bearing words that are not repository paths.
const NON_PATH_ALLOWLIST = new Set([
  'N/A', 'n/a', 'and/or', 'w/o', 'I/O', 'i/o', 'CI/CD', 'TCP/IP', 'read/write', 'yes/no',
  'gschiemann/EDUCMS', 'gschiemann/foundry-standard',
]);

const NON_PATH_PREFIX = /^(origin|upstream|refs|wip|backup|phase\d+|governance|claude|codex|gemini|chore|fix|feat|feature|hotfix|dependabot)\//;
const MIME = /^(application|image|video|audio|text|font|multipart|message)\/[\w.+-]+$/i;

// Build output is generated, never tracked: a path through one of these segments is not a dead pointer.
const GENERATED = /(^|\/)(\.next|dist|build|coverage|node_modules|\.turbo|out)(\/|$)/;
// Local env files are gitignored by design (.env.example is tracked and checked like any path).
const DOTENV = /(^|\/)\.env(\.[\w.-]+)?$/;
// A line (or its neighbours - the rulebook is hard-wrapped) that says the path is gone, not yet
// created or lives outside this repository is an honest mention, not a dead pointer.
const HONEST_MARKER = /\bdeleted\b|\bno longer exist|\bdoes(?: not|n't) exist|\bnot yet exist|\bexists? yet\b|\bgitignored\b|\bprivate (?:standard )?repo|\(private\)|lead's machine|\boutside the repo|\bnever committed\b/i;

// ---------------------------------------------------------------- tree listing

function walk(root, dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const rel = dir ? `${dir}/${ent.name}` : ent.name;
    if (rel === '.claude/worktrees') continue;
    if (ent.isDirectory()) walk(root, rel, out);
    else if (ent.isFile() || ent.isSymbolicLink()) out.push(rel);
  }
}

function listTree(root, { noGit = false } = {}) {
  let files = null;
  if (!noGit && fs.existsSync(path.join(root, '.git'))) {
    const res = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
    if (res.status === 0) {
      files = res.stdout.split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f)));
    }
  }
  if (!files) {
    files = [];
    walk(root, '', files);
  }
  const fileSet = new Set(files);
  const dirSet = new Set();
  const topLevel = new Set();
  for (const f of files) {
    const parts = f.split('/');
    topLevel.add(parts[0]);
    for (let i = 1; i < parts.length; i += 1) dirSet.add(parts.slice(0, i).join('/'));
  }
  return { files, fileSet, dirSet, topLevel };
}

function endsWithPath(set, candidate) {
  const tail = `/${candidate}`;
  for (const p of set) {
    if (p === candidate || p.endsWith(tail)) return true;
  }
  return false;
}

// ----------------------------------------------------------------- rule files

function ruleFiles(tree) {
  const out = new Set();
  for (const f of tree.files) {
    if (f === 'CLAUDE.md' || f === 'AGENTS.md') out.add(f);
    else if (/(^|\/)CLAUDE\.md$/.test(f)) out.add(f);
    else if (f === 'docs/ENVIRONMENT.md' || f === 'docs/DEPLOY.md') out.add(f);
    else if (/^docs\/governance\/[^/]+\.md$/.test(f)) out.add(f);
    else if (/^docs\/incidents\/[^/]+\.md$/.test(f)) out.add(f);
  }
  return [...out].sort();
}

// ----------------------------------------------------------------- (a) paths

function pathCandidate(raw, tree) {
  let t = raw.trim();
  if (!t || /\s/.test(t) || !t.includes('/')) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(mailto:|data:|javascript:)/i.test(t)) return null;
  if (/^[/~$%]/.test(t)) return null; // route, absolute, home, variable
  if (/[<>*{}|=()[\]$\\'"`;,!?^…]/.test(t) || t.includes('...') || t.includes('@')) return null;
  if (NON_PATH_ALLOWLIST.has(t) || NON_PATH_PREFIX.test(t) || MIME.test(t)) return null;
  if (GENERATED.test(t) || DOTENV.test(t)) return null;
  if (/^\d+(\.\d+)?\/\d+(\.\d+)?$/.test(t)) return null;
  t = t.replace(/#[^/]*$/, '').replace(/:\d+(-\d+)?$/, '').replace(/^\.\//, '');
  const isDir = t.endsWith('/');
  t = t.replace(/\/+$/, '');
  if (!t) return null;
  const ext = path.extname(t).slice(1).toLowerCase();
  const rooted = tree.topLevel.has(t.split('/')[0]);
  if (!rooted && !isDir && !FILE_EXTENSIONS.has(ext)) return null;
  return { value: t, rooted };
}

function pathExists(c, tree) {
  if (c.rooted) return tree.fileSet.has(c.value) || tree.dirSet.has(c.value);
  return endsWithPath(tree.fileSet, c.value) || endsWithPath(tree.dirSet, c.value);
}

function checkPaths(rel, lines, tree, offences, tolerated) {
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const re = /`([^`]+)`/g;
    let m;
    while ((m = re.exec(line))) {
      const c = pathCandidate(m[1], tree);
      if (c && !pathExists(c, tree)) {
        const near = lines.slice(Math.max(0, i - 2), i + 3).join(' ');
        if (HONEST_MARKER.test(near)) {
          tolerated.push({ file: rel, line: i + 1, text: m[1] });
          continue;
        }
        offences.push({ kind: 'dead-path', file: rel, line: i + 1, text: m[1] });
      }
    }
  });
}

// ------------------------------------------------------------ (b) line pointers

const LINE_POINTERS = [
  /(?<![\w./-])[\w./@-]+\.(?:md|mdx|ts|tsx|js|jsx|cjs|mjs|kt|kts|java|gradle|json|ya?ml|sh|sql|prisma|py|css|scss|html|xml|toml):\d+(?:[-–]\d+)?/g,
  /(?:~\s?)?\blines?\s+\d+/gi,
  /#L\d+\b/g,
];

function checkLinePointers(rel, lines, offences) {
  lines.forEach((line, i) => {
    for (const re of LINE_POINTERS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        offences.push({ kind: 'line-pointer', file: rel, line: i + 1, text: m[0] });
      }
    }
  });
}

// ---------------------------------------------------------------- (c) length

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// ------------------------------------------------------------- (d) counts

function loadTypeScript() {
  try {
    return require('typescript');
  } catch (e) {
    return null;
  }
}

function derivePresets(root) {
  const ts = loadTypeScript();
  if (!ts) return { error: 'typescript is not installed (run pnpm install, or put it on NODE_PATH)' };
  const dir = path.join(root, PRESETS_DIR);
  const previous = require.extensions['.ts'];
  require.extensions['.ts'] = (m, f) => {
    m._compile(
      ts.transpileModule(fs.readFileSync(f, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      }).outputText,
      f,
    );
  };
  try {
    const ids = new Set();
    const perExport = {};
    const names = fs.readdirSync(dir)
      .filter((f) => /-presets\.ts$/.test(f) && !f.startsWith('ensure-') && !/\.spec\./.test(f))
      .sort();
    for (const f of names) {
      const mod = require(path.join(dir, f));
      for (const [k, v] of Object.entries(mod)) {
        if (Array.isArray(v) && /_TEMPLATE_PRESETS$/.test(k)) {
          perExport[k] = v.length;
          v.forEach((p) => ids.add(p.id));
        }
      }
    }
    return { count: ids.size, perExport };
  } catch (e) {
    return { error: `could not evaluate the preset files: ${e.message}` };
  } finally {
    if (previous) require.extensions['.ts'] = previous;
    else delete require.extensions['.ts'];
  }
}

function deriveBoards(tree) {
  // Same rule as `find apps/web/public/templates -name '*.html' -not -path '*/_*'`:
  // a board is an .html file with no path segment (below the templates root) starting with "_".
  const prefix = `${BOARDS_DIR}/`;
  let count = 0;
  for (const f of tree.files) {
    if (!f.startsWith(prefix) || !f.endsWith('.html')) continue;
    if (f.slice(prefix.length).split('/').some((seg) => seg.startsWith('_'))) continue;
    count += 1;
  }
  return count;
}

function deriveShim(root) {
  try {
    const src = fs.readFileSync(path.join(root, SHIM_INJECTOR), 'utf8');
    const m = src.match(/const\s+MARKER\s*=\s*['"]EDUCMS-SHIM-V(\d+)['"]/);
    return m ? Number(m[1]) : null;
  } catch (e) {
    return null;
  }
}

// Hand-typed counts that the script verifies wherever they appear in a rule file. A count typed
// anywhere else is not checked - say "produced by scripts/check-rulebook.cjs" instead of typing it.
const TYPED_COUNTS = {
  presets: [
    /\*\*(\d+) system presets\*\*/g,
    /\((\d+) system presets \+ custom/g,
    /\*\*TOTAL \(unique ids\)\*\*\s*\|\s*\*\*(\d+)\*\*/g,
  ],
  boards: [
    /the \*\*(\d+)\*\* self-contained HTML files/g,
    /wc -l\s+# (\d+)/g,
  ],
  shim: [/EDUCMS-SHIM-V(\d+)\*\*/g],
};

/** Derive the three counts. Returns null when the template sources are not in the tree. */
function deriveCounts(root, tree, offences, report) {
  if (!tree.dirSet.has(PRESETS_DIR) || !tree.dirSet.has(BOARDS_DIR)) {
    report.push('counts: template sources not present - skipped');
    return null;
  }
  const presets = derivePresets(root);
  const boards = deriveBoards(tree);
  const shim = deriveShim(root);
  if (presets.error) {
    offences.push({ kind: 'cannot-derive', file: TEMPLATES_RULEBOOK, line: 0, text: `preset count: ${presets.error}` });
  }
  if (shim === null) {
    offences.push({ kind: 'cannot-derive', file: TEMPLATES_RULEBOOK, line: 0, text: `shim version: no MARKER in ${SHIM_INJECTOR}` });
  }
  report.push(
    `derived: presets=${presets.error ? 'ERROR' : presets.count} boards=${boards} shim=V${shim === null ? '?' : shim}`,
  );
  if (!presets.error) {
    report.push(`derived per export: ${Object.entries(presets.perExport).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }
  return { presets: presets.error ? null : presets.count, boards, shim };
}

/** The templates rulebook must state the counts on one line the script can read, and they must match. */
function checkDeclaredCounts(root, tree, derived, offences, report) {
  const rel = TEMPLATES_RULEBOOK;
  if (!tree.fileSet.has(rel)) {
    report.push(`counts: ${rel} not present - declared line not checked`);
    return;
  }
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const declared = text.match(/presets\s+(\d+)\s*·\s*boards\s+(\d+)\s*·\s*shim\s+V(\d+)/i);
  if (!declared) {
    offences.push({
      kind: 'missing-counts',
      file: rel,
      line: 0,
      text: 'no "presets N · boards N · shim V<n>" line - the file must state the counts the script verifies',
    });
    return;
  }
  report.push(`declared (${rel}): presets=${declared[1]} boards=${declared[2]} shim=V${declared[3]}`);
  const compare = (what, stated, truth) => {
    if (truth !== null && Number(stated) !== truth) {
      offences.push({ kind: 'stale-count', file: rel, line: 0, text: `${what}: the file says ${stated}, the tree derives ${truth}` });
    }
  };
  compare('presets', declared[1], derived.presets);
  compare('boards', declared[2], derived.boards);
  compare('shim version', declared[3], derived.shim);
}

function scanTypedCounts(rel, text, derived, offences) {
  for (const [what, patterns] of Object.entries(TYPED_COUNTS)) {
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const stated = Number(m[1]);
        if (derived[what] !== null && stated !== derived[what]) {
          const lineNo = text.slice(0, m.index).split('\n').length;
          offences.push({ kind: 'stale-count', file: rel, line: lineNo, text: `${what}: "${m[0]}" but the tree derives ${derived[what]}` });
        }
      }
    }
  }
}

// ------------------------------------------------------------------ driver

function check(root, { noGit = false, skipCounts = false } = {}) {
  const tree = listTree(root, { noGit });
  const offences = [];
  const report = [];
  const tolerated = [];
  const files = ruleFiles(tree);
  const derived = skipCounts ? null : deriveCounts(root, tree, offences, report);
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const lines = text.split('\n');
    checkPaths(rel, lines, tree, offences, tolerated);
    checkLinePointers(rel, lines, offences);
    if (derived) scanTypedCounts(rel, text, derived, offences);
    const limit = WORD_LIMITS[rel];
    const words = wordCount(text);
    if (limit) {
      report.push(`${rel}: ${words} words (limit ${limit})`);
      if (words > limit) {
        offences.push({ kind: 'too-long', file: rel, line: 0, text: `${words} words, limit ${limit}` });
      }
    }
  }
  if (derived) checkDeclaredCounts(root, tree, derived, offences, report);
  report.push(`tolerated mentions of paths that the text itself says are gone, not yet created or outside this repo: ${tolerated.length}`);
  return { offences, report, files, tolerated };
}

function print(result, root, verbose) {
  console.log(`rulebook check - root: ${root}`);
  console.log(`  rule files scanned: ${result.files.length}`);
  for (const r of result.report) console.log(`  ${r}`);
  if (verbose) for (const t of result.tolerated) console.log(`    tolerated: ${t.file}:${t.line}  ${t.text}`);
  if (!result.offences.length) {
    console.log('PASS - no offences');
    return;
  }
  console.log(`FAIL - ${result.offences.length} offence(s):`);
  for (const o of result.offences) {
    const where = o.line ? `${o.file}:${o.line}` : o.file;
    console.log(`  [${o.kind}] ${where}  ${o.text}`);
  }
}

// --------------------------------------------------------------- self-test

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rulebook-selftest-'));
  const failures = [];
  const write = (dir, rel, body) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  try {
    // Negative control: a dead path, a path:line pointer and an oversize core.
    const bad = path.join(tmp, 'bad');
    write(bad, 'scripts/real.cjs', '// exists\n');
    write(bad, 'AGENTS.md', '# agents\n');
    write(
      bad,
      'CLAUDE.md',
      [
        '# core',
        'A dead path: `docs/nope/missing-file.md`.',
        'A line pointer: `scripts/real.cjs:12`.',
        'A prose pointer: see line 7 of the file.',
        'A live path that must NOT be reported: `scripts/real.cjs`.',
        'A route that must NOT be reported: `/api/v1/health`.',
        'A placeholder that must NOT be reported: `docs/<date>-<topic>/`.',
        'word '.repeat(3100),
      ].join('\n'),
    );
    const r = check(bad, { noGit: true, skipCounts: true });
    const kinds = new Set(r.offences.map((o) => o.kind));
    for (const k of ['dead-path', 'line-pointer', 'too-long']) {
      if (!kinds.has(k)) failures.push(`negative control did not report "${k}"`);
    }
    const dead = r.offences.filter((o) => o.kind === 'dead-path');
    if (dead.length !== 1 || dead[0].text !== 'docs/nope/missing-file.md') {
      failures.push(`dead-path should report exactly the missing file, got ${JSON.stringify(dead.map((d) => d.text))}`);
    }
    const lp = r.offences.filter((o) => o.kind === 'line-pointer').map((o) => o.text);
    if (lp.length !== 2) failures.push(`line-pointer should report 2 pointers, got ${JSON.stringify(lp)}`);

    // Control for check (d): stale template counts must be reported (needs TypeScript; skipped without it).
    if (loadTypeScript()) {
      const counts = path.join(tmp, 'counts');
      write(counts, 'AGENTS.md', '# agents\n');
      write(counts, 'CLAUDE.md', '# core\n');
      write(counts, 'apps/api/src/templates/x-presets.ts', "export const X_TEMPLATE_PRESETS = [{ id: 'a' }, { id: 'b' }];\n");
      write(counts, 'apps/web/public/templates/signage/one.html', '<html></html>\n');
      write(counts, 'apps/web/public/templates/_thumbs/skipped.html', '<html></html>\n');
      write(counts, 'apps/web/scripts/inject-shim-v2.cjs', "const MARKER = 'EDUCMS-SHIM-V7';\n");
      write(
        counts,
        'apps/web/public/templates/CLAUDE.md',
        '# templates\npresets 3 · boards 2 · shim V6\nThe catalogue is **5 system presets**.\n',
      );
      const c = check(counts, { noGit: true });
      const stale = c.offences.filter((o) => o.kind === 'stale-count').map((o) => o.text).join(' | ');
      for (const needle of ['presets: the file says 3', 'boards: the file says 2', 'shim version: the file says 6', 'presets: "**5 system presets**"']) {
        if (!stale.includes(needle)) failures.push(`count control did not report: ${needle} (got: ${stale})`);
      }
    }

    // Positive control: a clean fixture must pass.
    const good = path.join(tmp, 'good');
    write(good, 'scripts/real.cjs', '// exists\n');
    write(good, 'apps/x/realtime/redis.service.ts', '// exists\n');
    write(good, 'AGENTS.md', '# agents\n');
    write(
      good,
      'CLAUDE.md',
      '# core\nA live path: `scripts/real.cjs`. A partial path: `realtime/redis.service.ts`. A directory: `realtime/`.\n',
    );
    const g = check(good, { noGit: true, skipCounts: true });
    if (g.offences.length) failures.push(`clean fixture reported offences: ${JSON.stringify(g.offences)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failures.length) {
    console.log('SELF-TEST FAIL');
    failures.forEach((f) => console.log(`  - ${f}`));
    return 1;
  }
  console.log(
    `SELF-TEST PASS - the checker reports a dead path, a path:line pointer, a prose line pointer and an oversize CLAUDE.md${
      loadTypeScript() ? ', stale template counts' : ' (stale-count control skipped: typescript not installed)'
    }, and passes a clean fixture`,
  );
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    process.exit(selfTest());
  }
  const ri = args.indexOf('--root');
  const root = path.resolve(ri >= 0 ? args[ri + 1] : path.join(__dirname, '..'));
  const result = check(root);
  print(result, root, args.includes('--verbose'));
  process.exit(result.offences.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { check, pathCandidate, selfTest, listTree };
