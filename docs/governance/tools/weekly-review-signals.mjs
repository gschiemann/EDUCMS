#!/usr/bin/env node
// Weekly review — signal pack (Foundry Standard, Article 44).
//
// Gathers the week's REAL signals so the weekly review quotes numbers instead of
// impressions. Reads ONLY: GitHub, through the caller's own `gh` login (merges,
// reverts, CI runs, ops issues, security alerts, commit attribution); the PUBLIC
// /health endpoint; and the governance files on origin/master. No database, no
// production secret, nothing written anywhere but stdout (and --json <path>).
// Every section degrades to "could not read: <why>" — a number is never invented.
//
//   node docs/governance/tools/weekly-review-signals.mjs [--json out.json] [--days 7]
//
// Lives under docs/governance/tools on purpose: scripts/** and package.json are
// deploy-watched paths; this file must never cause a redeploy.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO = process.env.OPS_REPO || 'gschiemann/EDUCMS';
const OWNER = REPO.split('/')[0];
const API = process.env.OPS_API_BASE || 'https://api-production-39a1.up.railway.app/api/v1';
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const DAYS = Number(flag('--days') || process.env.REVIEW_WINDOW_DAYS || 7);
if (!Number.isFinite(DAYS) || DAYS <= 0) { console.error('--days must be a positive number'); process.exit(2); }
const jsonOut = flag('--json') || null;
const now = new Date();
const since = new Date(now.getTime() - DAYS * 864e5);
const sinceIso = since.toISOString();
const couldNotRead = [];
const pack = { repo: REPO, windowDays: DAYS, since: sinceIso, generatedAt: now.toISOString() };

function sh(cmd, a, opts = {}) {
  return execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000, ...opts });
}
function section(name, fn) {
  try { pack[name] = fn(); }
  catch (e) { const why = String(e?.stderr || e?.message || e).split('\n')[0].slice(0, 160); pack[name] = { error: why }; couldNotRead.push(`${name}: ${why}`); }
}
const inWindow = (iso) => iso && new Date(iso) >= since;

// A. Flow: commits on master, merges vs direct pushes, merged PRs, open PRs.
section('flow', () => {
  const commits = [];
  for (const page of [1, 2, 3]) {
    const batch = JSON.parse(sh('gh', ['api', `repos/${REPO}/commits?sha=master&since=${sinceIso}&per_page=100&page=${page}`]));
    commits.push(...batch); if (batch.length < 100) break;
  }
  const merges = commits.filter((c) => c.parents.length > 1);
  const direct = commits.filter((c) => c.parents.length === 1);
  const mergedPrs = JSON.parse(sh('gh', ['pr', 'list', '--repo', REPO, '--state', 'merged', '--limit', '100', '--json', 'number,title,mergedAt,headRefName']))
    .filter((p) => inWindow(p.mergedAt));
  const openPrs = JSON.parse(sh('gh', ['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '100', '--json', 'number,title,createdAt,isDraft']));
  const oldestOpen = openPrs.map((p) => p.createdAt).sort()[0];
  return {
    commitsOnMaster: commits.length, mergeCommits: merges.length, directPushes: direct.length,
    mergedPrs: mergedPrs.length, mergedPrList: mergedPrs.map((p) => `#${p.number} ${p.title}`),
    openPrs: openPrs.length, oldestOpenPrDays: oldestOpen ? Math.round((now - new Date(oldestOpen)) / 864e5) : null,
    _commits: commits,
  };
});

// B. Reverts / hotfixes — the demotion trigger (a revert or hotfix ≤ 72 h after a merge).
section('reverts', () => {
  const commits = pack.flow?._commits || [];
  const merges = commits.filter((c) => c.parents.length > 1).map((c) => new Date(c.commit.committer.date));
  const hits = commits.filter((c) => /^Revert\b|\bhotfix\b/i.test(c.commit.message.split('\n')[0]));
  return hits.map((c) => {
    const t = new Date(c.commit.committer.date);
    const within72h = merges.some((m) => m < t && t - m <= 72 * 3600e3);
    return { sha: c.sha.slice(0, 8), subject: c.commit.message.split('\n')[0].slice(0, 100), date: c.commit.committer.date, within72hOfAMerge: within72h };
  });
});

// C. CI health per workflow, and the scheduled (nightly) runs separately.
section('ci', () => {
  const runs = JSON.parse(sh('gh', ['run', 'list', '--repo', REPO, '--limit', '400', '--json', 'workflowName,conclusion,status,event,createdAt,headBranch']))
    .filter((r) => inWindow(r.createdAt));
  const by = {};
  for (const r of runs) {
    const k = r.workflowName; by[k] ||= { runs: 0, success: 0, failure: 0, cancelled: 0, other: 0, scheduledFailures: 0 };
    by[k].runs++;
    if (r.conclusion === 'success') by[k].success++;
    else if (r.conclusion === 'failure') { by[k].failure++; if (r.event === 'schedule') by[k].scheduledFailures++; }
    else if (r.conclusion === 'cancelled') by[k].cancelled++; else by[k].other++;
  }
  const failing = Object.entries(by).filter(([, v]) => v.failure > 0).map(([k, v]) => `${k}: ${v.failure}/${v.runs} failed${v.scheduledFailures ? ` (${v.scheduledFailures} scheduled)` : ''}`);
  return { runsInWindow: runs.length, perWorkflow: by, failing };
});

// D. Ops issues (opened by scheduled-failure-issue.yml and by hand).
section('opsIssues', () => {
  const all = JSON.parse(sh('gh', ['issue', 'list', '--repo', REPO, '--label', 'ops', '--state', 'all', '--limit', '200', '--json', 'number,title,state,createdAt,closedAt']));
  const open = all.filter((i) => i.state === 'OPEN');
  return {
    open: open.length, openedInWindow: all.filter((i) => inWindow(i.createdAt)).length, closedInWindow: all.filter((i) => inWindow(i.closedAt)).length,
    oldestOpenDays: open.length ? Math.round((now - new Date(open.map((i) => i.createdAt).sort()[0])) / 864e5) : 0,
    openList: open.slice(0, 15).map((i) => `#${i.number} ${i.title.slice(0, 80)}`),
  };
});

// E. Security alerts GitHub knows about (counts only, never contents).
section('security', () => {
  const out = {};
  // One page of 100: a count of exactly 100 means "100 or more", and says so.
  const tryCount = (key, path, pick) => { try { const a = JSON.parse(sh('gh', ['api', `${path}?state=open&per_page=100`])); out[key] = pick ? pick(a) : (a.length >= 100 ? '100+ (page cap)' : a.length); } catch (e) { out[key] = `could not read: ${String(e?.stderr || e?.message).split('\n')[0].slice(0, 80)}`; } };
  tryCount('dependabotOpenBySeverity', `repos/${REPO}/dependabot/alerts`, (a) => a.reduce((m, x) => { const s = x.security_advisory?.severity || 'unknown'; m[s] = (m[s] || 0) + 1; return m; }, {}));
  tryCount('codeScanningOpen', `repos/${REPO}/code-scanning/alerts`);
  tryCount('secretScanningOpen', `repos/${REPO}/secret-scanning/alerts`);
  return out;
});

// F. Production health is read below (it needs await) — the public liveness endpoint only.

// G. Commit attribution — which model wrote what (routing evidence, Article 42).
section('attribution', () => {
  const commits = (pack.flow?._commits || []).filter((c) => c.parents.length === 1);
  const perModel = {}; let untrailed = 0;
  for (const c of commits) {
    const m = [...c.commit.message.matchAll(/Co-Authored-By:\s*([^<\n]+?)\s*</gi)].map((x) => x[1].trim());
    if (!m.length) { untrailed++; continue; }
    for (const name of new Set(m)) perModel[name] = (perModel[name] || 0) + 1;
  }
  return { directCommits: commits.length, perModel, untrailed };
});

// H. Governance state on origin/master.
section('governance', () => {
  sh('git', ['fetch', '-q', 'origin', 'master']);
  const show = (p) => sh('git', ['show', `origin/master:${p}`]);
  const mech = show('docs/governance/MECHANISMS.md');
  const m = mech.match(/MECHANIZED (\d+) · PARTIAL (\d+) · PROSE (\d+) · GAP (\d+)/);
  let freeze = false; try { sh('git', ['cat-file', '-e', 'origin/master:docs/governance/FREEZE.md']); freeze = true; } catch {}
  const lock = show('docs/governance/standard/standard.lock');
  const reviews = (() => { try { return sh('git', ['ls-tree', '--name-only', 'origin/master', 'docs/governance/reviews/']).trim().split('\n').filter((f) => /\d{4}-W\d{2}\.md$/.test(f)); } catch { return []; } })();
  return {
    headline: m ? { mechanized: +m[1], partial: +m[2], prose: +m[3], gap: +m[4] } : 'headline line not found',
    freezeActive: freeze, standardVersion: (lock.match(/version:\s*(\S+)/) || [])[1] || '?',
    previousReviews: reviews.slice(-3),
  };
});

// J. Cost — what GitHub exposes; the rest is owner-supplied (Article 38 GAP).
section('cost', () => {
  try { const b = JSON.parse(sh('gh', ['api', `users/${OWNER}/settings/billing/actions`])); return { actionsMinutesUsedThisCycle: b.total_minutes_used, includedMinutes: b.included_minutes, paidMinutes: b.total_paid_minutes_used }; }
  catch (e) { return { actions: `could not read: ${String(e?.stderr || e?.message).split('\n')[0].slice(0, 80)}`, note: 'Vercel, Railway, Supabase and AI spend are owner-supplied until a cost ledger exists (Article 38, Phase 1).' }; }
});

const health = await (async () => {
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(10_000) });
    const j = await r.json().catch(() => ({}));
    return { httpStatus: r.status, status: j.status, db: j.db, redis: j.redis, version: j.version, commit: j.commit, uptimeSeconds: j.uptime };
  } catch (e) { couldNotRead.push(`health: ${e.message}`); return { error: e.message }; }
})();
pack.health = health;
delete pack.flow?._commits;

// ---- Markdown ----
const f = pack.flow || {}, r = pack.reverts || [], c = pack.ci || {}, o = pack.opsIssues || {}, s = pack.security || {}, a = pack.attribution || {}, g = pack.governance || {}, k = pack.cost || {};
const lines = [];
lines.push(`# Weekly review — signal pack`, ``, `Repo ${REPO} · window ${DAYS} days since ${sinceIso.slice(0, 10)} · generated ${now.toISOString()} · GitHub + public /health only.`, ``);
lines.push(`## Flow`, `- Commits on master: ${f.commitsOnMaster ?? '?'} (${f.mergeCommits ?? '?'} merges, ${f.directPushes ?? '?'} direct pushes)`, `- PRs merged: ${f.mergedPrs ?? '?'} · open: ${f.openPrs ?? '?'}${f.oldestOpenPrDays != null ? ` (oldest ${f.oldestOpenPrDays} d)` : ''}`);
for (const p of f.mergedPrList || []) lines.push(`  - ${p}`);
lines.push(``, `## Reverts / hotfixes (demotion trigger if ≤ 72 h after a merge)`);
lines.push(...(Array.isArray(r) && r.length ? r.map((x) => `- ${x.sha} ${x.subject}${x.within72hOfAMerge ? ' — **within 72 h of a merge**' : ''}`) : ['- none in window']));
lines.push(``, `## CI`, `- Runs in window: ${c.runsInWindow ?? '?'}`, ...(c.failing?.length ? c.failing.map((x) => `- FAILING ${x}`) : ['- no failing workflows']));
lines.push(``, `## Ops issues`, `- Open: ${o.open ?? '?'} (oldest ${o.oldestOpenDays ?? '?'} d) · opened this window: ${o.openedInWindow ?? '?'} · closed: ${o.closedInWindow ?? '?'}`, ...(o.openList || []).map((x) => `  - ${x}`));
lines.push(``, `## Security (counts)`, `- Dependabot open: ${JSON.stringify(s.dependabotOpenBySeverity ?? '?')}`, `- Code scanning open: ${s.codeScanningOpen ?? '?'} · secret scanning open: ${s.secretScanningOpen ?? '?'}`);
lines.push(``, `## Production health (public /health)`, `- ${health.error ? `could not read: ${health.error}` : `HTTP ${health.httpStatus} · status ${health.status} · db ${health.db} · redis ${health.redis} · version ${health.version ?? '?'} · commit ${health.commit ?? '?'} · uptime ${health.uptimeSeconds ?? '?'} s`}`);
lines.push(``, `## Attribution (routing evidence)`, `- Direct commits: ${a.directCommits ?? '?'} · untrailed: ${a.untrailed ?? '?'}`, ...Object.entries(a.perModel || {}).map(([m, n]) => `  - ${m}: ${n}`));
lines.push(``, `## Governance`, `- Standard v${g.standardVersion ?? '?'} · freeze ${g.freezeActive ? 'ACTIVE' : 'none'} · mechanisms ${typeof g.headline === 'object' ? `MECHANIZED ${g.headline.mechanized} · PARTIAL ${g.headline.partial} · PROSE ${g.headline.prose} · GAP ${g.headline.gap}` : g.headline}`, `- Previous reviews: ${(g.previousReviews || []).join(', ') || 'none yet'}`);
lines.push(``, `## Cost`, `- ${k.actionsMinutesUsedThisCycle != null ? `GitHub Actions: ${k.actionsMinutesUsedThisCycle} min used this cycle (${k.includedMinutes} included, ${k.paidMinutes} paid)` : k.actions}`, ...(k.note ? [`- ${k.note}`] : []));
lines.push(``, `## Could not read`, ...(couldNotRead.length ? couldNotRead.map((x) => `- ${x}`) : ['- nothing — every section read']));
console.log(lines.join('\n'));
if (jsonOut) { pack.couldNotRead = couldNotRead; writeFileSync(jsonOut, JSON.stringify(pack, null, 2)); console.error(`json → ${jsonOut}`); }
