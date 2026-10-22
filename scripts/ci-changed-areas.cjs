#!/usr/bin/env node
/**
 * ci-changed-areas — which parts of the monorepo a push / PR touched, and
 * whether the expensive jobs need to run at all
 * (2026-10-22, go-private CI budget: docs/research/2026-10-22-go-private/).
 *
 * Why this exists instead of `paths-ignore` on the workflow trigger:
 * a workflow skipped by `paths-ignore` never reports its checks, so a
 * REQUIRED check (Deploy Reliability jobs in the "Master deploy safety"
 * ruleset) stays "Expected — waiting" forever and a docs-only PR can never go
 * green. A workflow that RUNS and then skips a job with `if:` reports that job
 * as "skipped", which a required check accepts as success. So the gating
 * workflow always starts, runs this (seconds), and skips what is not needed.
 *
 * Area outputs (written to $GITHUB_OUTPUT as `name=true|false`):
 *   code     — anything outside the docs set ("not docs-only")
 *   app      — a code change that is not ONLY apps/renderer/**. Drives the
 *              API and web suites. Deliberately NOT split into "web" vs "api":
 *              ~13 API specs read apps/web source, ~20 web tests read API
 *              source, and web tests read the player's Kotlin (the native
 *              end-grade drift test) — the sides are coupled, so a change to
 *              any of them runs both.
 *   server   — a code change outside apps/player/** and apps/renderer/**:
 *              what can change the API Docker image.
 *   player   — anything under apps/player/**
 *   renderer — apps/renderer/**, the lockfile, root package.json, workflows
 *   deps     — Dockerfile*, pnpm-lock.yaml, any package.json, .trivyignore.yaml
 *
 * `heavy` — false when the expensive jobs can be skipped with NO loss of
 * coverage, in exactly two cases:
 *   1. a DRAFT pull request (opt in to the full run with "Ready for review";
 *      the workflow listens for `ready_for_review`, so marking it ready runs
 *      everything on the same commit before it can merge — a draft cannot
 *      merge);
 *   2. a push to master whose tree was ALREADY verified green as a PR:
 *      the pushed commit is the merge of PR N, the PR head contains the
 *      previous master tip (it was up to date, which the ruleset's strict
 *      required checks enforce), the pushed tree is byte-identical to the PR
 *      head's tree, and the PR's most recent run of this workflow on that head
 *      concluded SUCCESS with every job named in TESTED_JOBS for the touched
 *      areas concluding success (not skipped). Same tree + same workflow file
 *      + green = re-running it proves nothing new.
 *   Anything else — a direct push, an admin-bypass merge of a red or stale PR,
 *   a force push, an API error — is `heavy=true`.
 *
 * FAIL-OPEN everywhere: an unresolvable base or any error sets every area
 * true and heavy true. A wrong guess here may only cost minutes, never skip a
 * gate.
 *
 * The docs set matches the `paths-ignore` list every workflow already used:
 * docs/**, root-level *.md, .claude/**, scratch/**, LICENSE. Deliberately NOT
 * docs: apps/web/src/content/help/**.md — that markdown ships in the build.
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const DOCS = [/^docs\//, /^[^/]+\.md$/, /^\.claude\//, /^scratch\//, /^LICENSE$/];
const PLAYER = /^apps\/player\//;
const RENDERER = /^apps\/renderer\//;
const RENDERER_INPUTS = [RENDERER, /^pnpm-lock\.yaml$/, /^package\.json$/, /^\.github\/workflows\//, /^pnpm-workspace\.yaml$/];
const DEPS = [/(^|\/)Dockerfile[^/]*$/, /^pnpm-lock\.yaml$/, /(^|\/)package\.json$/, /^\.trivyignore\.yaml$/];

const ALL = { code: true, app: true, server: true, player: true, renderer: true, deps: true };

function classify(files) {
  const code = files.filter((f) => !DOCS.some((re) => re.test(f)));
  return {
    code: code.length > 0,
    app: code.some((f) => !RENDERER.test(f)),
    server: code.some((f) => !RENDERER.test(f) && !PLAYER.test(f)),
    player: code.some((f) => PLAYER.test(f)),
    renderer: code.some((f) => RENDERER_INPUTS.some((re) => re.test(f))),
    deps: files.some((f) => DEPS.some((re) => re.test(f))),
  };
}

const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

function changedFiles(base, head) {
  if (!base || /^0+$/.test(base)) return null;
  try {
    git('cat-file', '-e', `${base}^{commit}`);
    return git('diff', '--name-only', `${base}...${head || 'HEAD'}`).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

async function api(path) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/** Was this exact tree already verified green as a PR? (see header, case 2) */
async function testedInPr(sha, before, areas) {
  const workflow = process.env.WORKFLOW_FILE;
  if (!workflow || !process.env.GITHUB_REPOSITORY || !(process.env.GH_TOKEN || process.env.GITHUB_TOKEN)) return 'no workflow/token';
  const pulls = await api(`commits/${sha}/pulls`);
  const pr = pulls.find((p) => p.merged_at && p.merge_commit_sha === sha);
  if (!pr) return 'not the merge commit of a PR (direct push)';
  const head = pr.head.sha;
  try {
    git('cat-file', '-e', `${head}^{commit}`);
  } catch {
    return `PR #${pr.number} head ${head.slice(0, 12)} not fetched`;
  }
  try {
    git('merge-base', '--is-ancestor', before, head);
  } catch {
    return `PR #${pr.number} was not up to date with master at merge`;
  }
  if (git('rev-parse', `${sha}^{tree}`) !== git('rev-parse', `${head}^{tree}`)) return `tree differs from PR #${pr.number} head`;
  const runs = await api(`actions/workflows/${workflow}/runs?head_sha=${head}&event=pull_request&per_page=20`);
  const latest = (runs.workflow_runs || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  if (!latest) return `no ${workflow} run on PR #${pr.number} head`;
  if (latest.conclusion !== 'success') return `latest PR run ${latest.id} concluded ${latest.conclusion || latest.status}`;
  const required = JSON.parse(process.env.TESTED_JOBS || '{}');
  const need = Object.entries(required).filter(([area]) => areas[area]).flatMap(([, name]) => [].concat(name));
  if (need.length) {
    const jobs = (await api(`actions/runs/${latest.id}/jobs?per_page=100`)).jobs || [];
    for (const name of need) {
      const j = jobs.find((x) => x.name === name);
      if (!j || j.conclusion !== 'success') return `PR run ${latest.id}: "${name}" ${j ? j.conclusion : 'missing'}`;
    }
  }
  return { pr: pr.number, run: latest.id };
}

async function main() {
  const event = process.env.GITHUB_EVENT_NAME || '';
  const base = process.env.BASE_SHA || '';
  const head = process.env.HEAD_SHA || 'HEAD';
  let areas;
  let files = null;
  if (event === 'push' || event === 'pull_request') files = changedFiles(base, head);
  if (files === null) {
    areas = { ...ALL };
    console.log(`changed-areas: base unresolved (event=${event || 'local'} base=${base || '-'}) — fail-open, everything runs`);
  } else {
    areas = classify(files);
    console.log(`changed-areas: ${files.length} file(s) changed since ${base.slice(0, 12)}`);
    for (const f of files.slice(0, 40)) console.log(`  ${f}`);
    if (files.length > 40) console.log(`  … and ${files.length - 40} more`);
  }

  let heavy = true;
  if (event === 'pull_request' && process.env.PR_DRAFT === 'true') {
    heavy = false;
    console.log('heavy=false: DRAFT pull request — mark it "Ready for review" to run the full gates');
  } else if (event === 'push' && process.env.GITHUB_SHA && files !== null && areas.code) {
    try {
      const verdict = await testedInPr(process.env.GITHUB_SHA, base, areas);
      if (typeof verdict === 'object') {
        heavy = false;
        console.log(`heavy=false: identical tree verified green on PR #${verdict.pr} (run ${verdict.run})`);
      } else {
        console.log(`heavy=true: ${verdict}`);
      }
    } catch (e) {
      console.log(`heavy=true: could not check the PR run (${e.message}) — fail-open`);
    }
  }

  const out = { ...areas, heavy };
  const lines = Object.entries(out).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join(' '));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}

if (require.main === module) {
  main().catch((e) => {
    // Never fail the job on our own bug: fail OPEN.
    console.log(`changed-areas: unexpected error (${e && e.message}) — fail-open, everything runs`);
    const lines = Object.entries({ ...ALL, heavy: true }).map(([k, v]) => `${k}=${v}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  });
}
module.exports = { classify };
