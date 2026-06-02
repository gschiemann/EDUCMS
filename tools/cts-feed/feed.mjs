#!/usr/bin/env node
/**
 * tools/cts-feed/feed.mjs — file-driven live-feed simulator for the
 * VenueOS sports board + ribbon.
 *
 * Watches `game-state.json`; on every SAVE it maps the file to a CTS
 * snapshot and POSTs it to the SAME endpoint a real CTS bridge uses
 * (`POST /api/v1/sports/board/:gameId/cts-snapshot`, x-feed-token auth).
 * The board polls that snapshot (~750ms) and the scoreboard + ribbon
 * update live; bumping a score auto-fires the goal celebration.
 *
 * Zero dependencies — Node 18+ (built-in fetch + fs). No build step.
 *
 *   CTS_API=https://your-api-root \    # no trailing /api/v1
 *   CTS_GAME_ID=<game id> \
 *   CTS_FEED_TOKEN=<feed token> \
 *   node tools/cts-feed/feed.mjs
 *
 * Flags / env:
 *   --dry-run        (or CTS_DRY_RUN=1)  print the body, don't POST.
 *   --once                                push once and exit (no watch).
 *   --file <path>    (or CTS_FILE=...)    state file (default ./game-state.json).
 *   --interval <ms>  (or CTS_INTERVAL)    poll interval for file changes (default 200).
 *
 * Get CTS_GAME_ID + CTS_FEED_TOKEN from the dashboard: Sports → your
 * game → feed credentials (or `GET /api/v1/sports/games/:id/feed-credentials`).
 * NEVER commit the token — keep it in your shell env only.
 */

import { readFileSync, watchFile } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── config ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, env, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return process.env[env] ?? dflt;
};

const API = (opt('api', 'CTS_API', 'http://localhost:8080')).replace(/\/+$/, '');
const GAME_ID = opt('game', 'CTS_GAME_ID', '');
const TOKEN = opt('token', 'CTS_FEED_TOKEN', '');
const FILE = resolve(opt('file', 'CTS_FILE', resolve(HERE, 'game-state.json')));
const INTERVAL = parseInt(opt('interval', 'CTS_INTERVAL', '200'), 10) || 200;
const DRY = flag('dry-run') || process.env.CTS_DRY_RUN === '1';
const ONCE = flag('once');

const URL = `${API}/api/v1/sports/board/${GAME_ID}/cts-snapshot`;

// ── helpers ─────────────────────────────────────────────────────────
const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, grn: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`, yel: (s) => `\x1b[33m${s}\x1b[0m`,
  cyn: (s) => `\x1b[36m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };

/** "M:SS" | "M:SS.t" | ":SS.t" | "SS.t" | "SS" | "" → milliseconds. */
function clockToMs(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (s === '') return 0;
  let mins = 0, rest = s;
  if (s.includes(':')) {
    const [mm, ss] = s.split(':');
    mins = parseInt(mm || '0', 10) || 0;
    rest = ss;
  }
  const sec = parseFloat(rest);
  if (Number.isNaN(sec)) return 0;
  return Math.round((mins * 60 + sec) * 1000);
}

function shotClock(state, side) {
  const key = `${side}ShotClock`;
  if (!(key in state)) return undefined;
  const raw = String(state[key] ?? '').trim();
  const ms = raw === '' ? 0 : Math.round((parseFloat(raw) || 0) * 1000);
  return { raw, ms, running: !!state[`${side}ShotClockRunning`] };
}

function cleanExclusions(arr) {
  if (!Array.isArray(arr)) return undefined;
  return arr.map((e) =>
    e && typeof e === 'object'
      ? { playerJersey: Number(e.playerJersey) || 0, secondsRemaining: Number(e.secondsRemaining) || 0 }
      : null,
  );
}

/** Map the friendly state file → the cts-snapshot request body. */
function buildBody(state) {
  const body = {};
  if ('homeScore' in state) body.homeScore = Number(state.homeScore) || 0;
  if ('awayScore' in state) body.awayScore = Number(state.awayScore) || 0;
  if ('clock' in state) body.clockMs = clockToMs(state.clock);
  if ('clockRunning' in state) body.clockRunning = !!state.clockRunning;
  if ('period' in state) body.segment = Number(state.period) || 0;
  const hsc = shotClock(state, 'home');
  const asc = shotClock(state, 'away');
  if (hsc) body.homeShotClock = hsc;
  if (asc) body.awayShotClock = asc;
  const hex = cleanExclusions(state.homeExclusions);
  const aex = cleanExclusions(state.awayExclusions);
  if (hex) body.homeExclusions = hex;
  if (aex) body.awayExclusions = aex;
  if ('homeTimeoutsRemaining' in state) body.homeTimeoutsRemaining = Number(state.homeTimeoutsRemaining) || 0;
  if ('awayTimeoutsRemaining' in state) body.awayTimeoutsRemaining = Number(state.awayTimeoutsRemaining) || 0;
  if ('horn' in state) body.horn = !!state.horn;
  return body;
}

let prev = null;
function describeDelta(body) {
  const parts = [];
  if (prev) {
    if (body.homeScore != null && body.homeScore > (prev.homeScore ?? 0)) parts.push(c.grn(`🟦 HOME GOAL → ${body.homeScore}`));
    if (body.awayScore != null && body.awayScore > (prev.awayScore ?? 0)) parts.push(c.grn(`⬜ AWAY GOAL → ${body.awayScore}`));
    if (body.horn && !prev.horn) parts.push(c.yel('📢 HORN'));
  }
  return parts.join('  ');
}

async function push() {
  let state;
  try {
    state = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch (e) {
    console.log(c.red(`✗ parse error (${e.message}) — fix the JSON and save again`));
    return;
  }
  const body = buildBody(state);
  const delta = describeDelta(body);
  const summary = `H ${body.homeScore ?? '·'}-${body.awayScore ?? '·'} A  ${body.clockMs != null ? (body.clockMs / 1000).toFixed(1) + 's' : '·'}  P${body.segment ?? '·'}` +
    `  shot[${body.homeShotClock?.raw || '-'}/${body.awayShotClock?.raw || '-'}]` +
    `  excl[${(body.homeExclusions || []).filter(Boolean).length}/${(body.awayExclusions || []).filter(Boolean).length}]` +
    `  TO[${body.homeTimeoutsRemaining ?? '·'}/${body.awayTimeoutsRemaining ?? '·'}]`;
  const ts = new Date().toTimeString().slice(0, 8);

  if (DRY) {
    console.log(`${c.dim(ts)} ${c.cyn('DRY')} ${summary}${delta ? '  ' + delta : ''}`);
    console.log(c.dim('     body: ' + JSON.stringify(body)));
    prev = body;
    return;
  }
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-feed-token': TOKEN },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      console.log(`${c.dim(ts)} ${c.grn('✓ pushed')} ${summary}${delta ? '  ' + delta : ''}`);
    } else {
      const txt = await res.text().catch(() => '');
      console.log(`${c.dim(ts)} ${c.red(`✗ ${res.status}`)} ${txt.slice(0, 160)}`);
      if (res.status === 401) console.log(c.red('     → bad/missing CTS_FEED_TOKEN (or it was revoked). Re-fetch from the dashboard.'));
      if (res.status === 404) console.log(c.red('     → game not found — check CTS_GAME_ID and CTS_API.'));
    }
  } catch (e) {
    console.log(`${c.dim(ts)} ${c.red('✗ network')} ${e.message}  ${c.dim('(is CTS_API reachable?)')}`);
  }
  prev = body;
}

// ── boot ────────────────────────────────────────────────────────────
console.log(c.bold('VenueOS CTS file-feed simulator'));
console.log(`  file   ${c.cyn(FILE)}`);
console.log(`  target ${c.cyn(DRY ? '(dry-run — not posting)' : URL)}`);
if (!DRY) {
  if (!GAME_ID) { console.log(c.red('  ✗ CTS_GAME_ID is required (or pass --game). Try --dry-run to test the mapping first.')); process.exit(1); }
  if (!TOKEN) { console.log(c.red('  ✗ CTS_FEED_TOKEN is required (or pass --token). Get it from Sports → game → feed credentials.')); process.exit(1); }
}
console.log(c.dim('  Edit game-state.json and save — each save pushes. Ctrl-C to stop.\n'));

await push(); // initial push so the board reflects the file immediately
if (!ONCE) {
  watchFile(FILE, { interval: INTERVAL }, (cur, old) => {
    if (cur.mtimeMs !== old.mtimeMs) push();
  });
}
