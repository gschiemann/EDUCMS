#!/usr/bin/env node
/**
 * OPS SWEEP — the standing check that finds what nobody is watching.
 *
 * ── WHY (2026-09-13) ──────────────────────────────────────────────────
 * Greg found "DB Backup / dump — Failed in 16 seconds" and asked: "Why do I
 * have to find this? What tools do you need to always find every error?"
 *
 * The nightly backup had failed for NINE nights. Nobody noticed because the
 * only thing anyone watched was CI on a push. Two different causes hid behind
 * the same red icon: the database password rotated on 2026-09-04 while the
 * `SUPABASE_DB_URL` secret still carried the old one (dated 2026-07-30), and
 * — separately — the GitHub Actions spending limit, which refuses every job
 * with ZERO steps and the message "recent account payments have failed or
 * your spending limit needs to be increased" written on the check run, never
 * in a log.
 *
 * This script is the answer to the question. It checks every surface that
 * fails silently, in one run, and exits non-zero on any red:
 *   1. every GitHub workflow's latest run (scheduled ones especially), and
 *      whether a failure is a BILLING refusal (0 steps) or a real one;
 *   2. the age of the newest successful encrypted DB backup artifact;
 *   3. production liveness, readiness and the emergency-path probe;
 *   4. the Vercel keepwarm cron's last pings, via the Keep API warm workflow.
 * It writes `docs/research/ops/<date>.md` (gitignored, like all research)
 * and prints the same table. Run it every morning — or better, let a scheduled
 * task run it and hand the report to whoever is on duty:
 *
 *   node scripts/ops-sweep.mjs            # human summary + report file
 *   node scripts/ops-sweep.mjs --json     # machine-readable
 *
 * Needs `gh` authenticated (read) and network access to the API. No secrets.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.OPS_REPO || 'gschiemann/EDUCMS';
const API = process.env.OPS_API_BASE || 'https://api-production-39a1.up.railway.app/api/v1';
const BACKUP_MAX_AGE_H = Number(process.env.OPS_BACKUP_MAX_AGE_H || 36);
const JSON_OUT = process.argv.includes('--json');

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const ghJson = (args) => JSON.parse(gh(args));
const hoursAgo = (iso) => (Date.now() - new Date(iso).getTime()) / 36e5;

const findings = []; // { level: 'red'|'amber'|'ok', area, message }
const say = (level, area, message) => findings.push({ level, area, message });

// ── 1. Every workflow's latest run ─────────────────────────────────────
try {
  const workflows = ghJson(['api', `repos/${REPO}/actions/workflows?per_page=100`, '-q', '.workflows']);
  let billingRefusals = 0;
  for (const wf of workflows) {
    if (wf.state !== 'active') continue;
    const runs = ghJson(['api', `repos/${REPO}/actions/workflows/${wf.id}/runs?per_page=1`, '-q', '.workflow_runs']);
    const run = runs[0];
    if (!run) { say('amber', 'actions', `${wf.name}: no runs yet`); continue; }
    const age = hoursAgo(run.created_at).toFixed(1);
    if (run.status !== 'completed') { say('ok', 'actions', `${wf.name}: ${run.status} (${age}h ago)`); continue; }
    if (run.conclusion === 'success') { say('ok', 'actions', `${wf.name}: success ${age}h ago (${run.event})`); continue; }
    // The failure responder runs on EVERY completed workflow and skips itself when that run was green —
    // a skipped responder is the healthy state, not a warning (2026-09-14).
    if (run.conclusion === 'skipped' && /Workflow failure/.test(wf.name)) { say('green', 'actions', `${wf.name}: idle (last watched run was green, ${age}h ago)`); continue; }
    if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') { say('amber', 'actions', `${wf.name}: ${run.conclusion} ${age}h ago (${run.event}) — not a failure, but not a pass either`); continue; }
    // Distinguish a BILLING refusal (job never started: 0 steps) from a real failure.
    const jobs = ghJson(['api', `repos/${REPO}/actions/runs/${run.id}/jobs`, '-q', '.jobs']);
    const zeroStep = jobs.length > 0 && jobs.every((j) => (j.steps || []).length === 0 && j.conclusion === 'failure');
    if (zeroStep) {
      billingRefusals++;
      say('red', 'actions', `${wf.name}: REFUSED (0 steps) ${age}h ago — Actions spending limit / billing. Fix in GitHub → Settings → Billing & plans. Run ${run.html_url}`);
    } else {
      say('red', 'actions', `${wf.name}: ${run.conclusion} ${age}h ago (${run.event}). Run ${run.html_url}`);
    }
  }
  if (billingRefusals) say('red', 'actions', `${billingRefusals} workflow(s) refused for billing — every push's CI is blocked too, while Railway still deploys the push. DO NOT PUSH until it is lifted.`);
} catch (e) {
  say('red', 'actions', `could not list workflows: ${String(e.message || e).slice(0, 160)}`);
}

// ── 2. Newest successful encrypted DB backup ───────────────────────────
try {
  const runs = ghJson(['api', `repos/${REPO}/actions/workflows/db-backup.yml/runs?status=success&per_page=1`, '-q', '.workflow_runs']);
  if (!runs[0]) say('red', 'backup', 'no successful DB Backup run on record');
  else {
    const age = hoursAgo(runs[0].created_at);
    const arts = ghJson(['api', `repos/${REPO}/actions/artifacts?name=venueos-db-backup-${runs[0].id}`, '-q', '.artifacts']);
    const a = arts[0];
    const detail = a ? `${(a.size_in_bytes / 1e6).toFixed(1)} MB, expires ${a.expires_at.slice(0, 10)}${a.expired ? ' (EXPIRED)' : ''}` : 'artifact not found';
    say(age > BACKUP_MAX_AGE_H ? 'red' : 'ok', 'backup', `newest good backup is ${age.toFixed(0)}h old (${runs[0].created_at.slice(0, 10)}) — ${detail}. Threshold ${BACKUP_MAX_AGE_H}h.`);
  }
} catch (e) {
  say('red', 'backup', `could not read backup runs: ${String(e.message || e).slice(0, 160)}`);
}

// ── 3. Production health ───────────────────────────────────────────────
const probe = async (p, expectOk) => {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12_000);
    const res = await fetch(`${API}${p}`, { signal: ctl.signal }); clearTimeout(t);
    let body = null; try { body = await res.json(); } catch { /* not json */ }
    const summary = body ? `db=${body.db ?? body.checks?.db ?? '?'} redis=${body.redis ?? body.checks?.redis ?? '?'} status=${body.status ?? '?'}` : `HTTP ${res.status}`;
    say(res.ok === expectOk ? 'ok' : 'red', 'prod', `${p} → HTTP ${res.status} ${summary}`);
  } catch (e) {
    say('red', 'prod', `${p} → ${String(e.message || e).slice(0, 100)}`);
  }
};
await probe('/health', true);
await probe('/health/ready', true);
await probe('/health/emergency-path', true);

// ── Report ─────────────────────────────────────────────────────────────
const red = findings.filter((f) => f.level === 'red');
const amber = findings.filter((f) => f.level === 'amber');
const date = new Date().toISOString().slice(0, 10);
const lines = [
  `# Ops sweep — ${date}`, '',
  `**${red.length} red · ${amber.length} amber · ${findings.length - red.length - amber.length} ok**`, '',
  ...['red', 'amber', 'ok'].flatMap((lvl) => findings.filter((f) => f.level === lvl).map((f) => `- ${lvl === 'red' ? '🔴' : lvl === 'amber' ? '🟠' : '🟢'} **${f.area}** — ${f.message}`)),
];
const outDir = path.join(process.cwd(), 'docs', 'research', 'ops');
try { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, `${date}.md`), lines.join('\n') + '\n'); } catch { /* report dir optional */ }
if (JSON_OUT) console.log(JSON.stringify({ date, red, amber, findings }, null, 1));
else console.log(lines.join('\n'));
process.exit(red.length ? 1 : 0);
