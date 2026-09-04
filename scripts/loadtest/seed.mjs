/**
 * seed.mjs — build the fleet the load test drives.
 *
 * Shape (defaults; override with LOADTEST_SCREENS / LOADTEST_TENANTS):
 *   40 tenants ("venues"), each with
 *     · 1 SCHOOL_ADMIN who can trigger panic
 *     · 1 screen group
 *     · 1 template with 4 zones          → the manifest is NOT a stub
 *     · 3 PUBLISHED assets
 *     · 1 playlist (template-bound) with 3 items
 *     · 1 active schedule pinned to the group
 *     · 25 screens
 *
 * CONTENT is inserted as SQL (via the container's own psql — a fresh worktree
 * has no node_modules, so there is no Prisma client or `pg` to lean on).
 * CREDENTIALS are NOT: every device token is minted through the real
 * endpoints, in the real order, so the load test exercises the real auth path:
 *
 *   POST /screens/register {deviceFingerprint}        → bootstrap token (1 h,
 *                                                       `unproven`, aud=bootstrap)
 *   POST /screens/pair     {pairingCode}   (admin JWT) → claims + epoch rotate
 *   POST /screens/register {…, priorDeviceToken}      → 180-day PROVEN token
 *
 * That last step is the `unproven-restorable` branch in screens.controller.ts:
 * the operator's fresh pair is the authorizer. A fingerprint alone cannot get
 * a long-lived credential (SEC-001/DEVAUTH-01), and this harness does not try.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertDisposableStack, CONFIG, venueIp } from './lib/env.mjs';
import { exec, sql, nodeInApi, scalar } from './lib/sql.mjs';
import { request, parseJson, destroyAgents } from './lib/http.mjs';

const { apiUrl } = assertDisposableStack();
const OUT_DIR = path.join(process.cwd(), 'scripts', 'loadtest', '.out');
const PASSWORD = 'loadtest-Only-Local-9271';

const uuid = () => crypto.randomUUID();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function seedContent(tenantCount, screensPerTenant) {
  console.log(`[seed] hashing the shared admin password (argon2, inside the API container)…`);
  // pnpm's layout is not hoisted, so resolve argon2 the way the API itself
  // does (from apps/api) rather than from the CWD of the -e script.
  const passwordHash = await nodeInApi(
    `const{createRequire}=require('module');` +
      `const r=createRequire('/app/apps/api/index.js');` +
      `r('argon2').hash(${JSON.stringify(PASSWORD)}).then(h=>process.stdout.write(h))`,
  );
  if (!passwordHash.startsWith('$argon2')) throw new Error(`unexpected hash: ${passwordHash.slice(0, 20)}`);

  const tenants = [];
  const stmts = [];
  for (let t = 0; t < tenantCount; t++) {
    const tenantId = uuid();
    const userId = uuid();
    const groupId = uuid();
    const templateId = uuid();
    const playlistId = uuid();
    const email = `admin-${t}@loadtest.invalid`;
    tenants.push({ index: t, tenantId, userId, groupId, templateId, playlistId, email, ip: venueIp(t) });

    stmts.push(
      `INSERT INTO tenants (id,name,slug) VALUES (${q(tenantId)},${q(`Loadtest Venue ${t}`)},${q(`loadtest-venue-${t}`)});`,
      `INSERT INTO users (id,tenant_id,email,password_hash,role,status,can_trigger_panic)
         VALUES (${q(userId)},${q(tenantId)},${q(email)},${q(passwordHash)},'SCHOOL_ADMIN','ACTIVE',true);`,
      `INSERT INTO screen_groups (id,tenant_id,name) VALUES (${q(groupId)},${q(tenantId)},'Main Concourse');`,
      `INSERT INTO templates (id,tenant_id,name,description,orientation,screen_width,screen_height,is_system,bg_color)
         VALUES (${q(templateId)},${q(tenantId)},'Loadtest Board','seeded',
                 'landscape',1920,1080,false,'#0b1220');`,
    );
    // Four zones: the manifest fan-out has real rows to serialize.
    const zones = [
      ['Clock', 'CLOCK', 0, 0, 30, 20],
      ['Headline', 'TEXT', 30, 0, 70, 20],
      ['Media', 'IMAGE', 0, 20, 100, 65],
      ['Ticker', 'TICKER', 0, 85, 100, 15],
    ];
    zones.forEach(([name, widget, x, y, w, h], i) => {
      stmts.push(
        `INSERT INTO template_zones (id,template_id,name,widget_type,x,y,width,height,z_index,sort_order,default_config)
           VALUES (${q(uuid())},${q(templateId)},${q(name)},${q(widget)},${x},${y},${w},${h},${i},${i},
                   ${q(JSON.stringify({ fontSize: 48, color: '#ffffff' }))}::jsonb);`,
      );
    });

    stmts.push(
      `INSERT INTO playlists (id,tenant_id,name,template_id,created_by_user_id)
         VALUES (${q(playlistId)},${q(tenantId)},'Everyday Loop',${q(templateId)},${q(userId)});`,
    );
    for (let a = 0; a < 3; a++) {
      const assetId = uuid();
      stmts.push(
        `INSERT INTO assets (id,tenant_id,uploaded_by_user_id,file_url,mime_type,status,file_size,original_name)
           VALUES (${q(assetId)},${q(tenantId)},${q(userId)},
                   ${q(`https://cdn.loadtest.invalid/t${t}/slide-${a}.jpg`)},'image/jpeg','PUBLISHED',482913,
                   ${q(`slide-${a}.jpg`)});`,
        `INSERT INTO playlist_items (id,playlist_id,asset_id,duration_ms,sequence_order,transition_type)
           VALUES (${q(uuid())},${q(playlistId)},${q(assetId)},15000,${a},'fade');`,
      );
    }
    stmts.push(
      `INSERT INTO schedules (id,tenant_id,playlist_id,screen_group_id,start_time,priority,mode,is_active)
         VALUES (${q(uuid())},${q(tenantId)},${q(playlistId)},${q(groupId)},NOW() - INTERVAL '7 days',10,'replace',true);`,
    );
  }

  console.log(`[seed] inserting ${tenantCount} tenants of content (${stmts.length} statements)…`);
  await exec(`BEGIN;\n${stmts.join('\n')}\nCOMMIT;`);
  return tenants;
}

async function loginAll(tenants) {
  console.log(`[seed] logging in ${tenants.length} tenant admins (real POST /auth/login)…`);
  const failures = [];
  await pool(tenants, 20, async (t) => {
    const res = await request({
      apiUrl,
      method: 'POST',
      path: '/api/v1/auth/login',
      venueIndex: t.index,
      clientIp: t.ip,
      body: { email: t.email, password: PASSWORD },
    });
    const json = parseJson(res);
    const token = json?.access_token || json?.accessToken || json?.token;
    if (!token) {
      failures.push(`${t.email} -> ${res.status} ${res.body.slice(0, 160)}`);
      return;
    }
    t.adminToken = token;
  });
  if (failures.length) throw new Error(`[seed] admin login failed:\n  ${failures.slice(0, 5).join('\n  ')}`);
}

async function mintScreens(tenants, screensPerTenant) {
  const jobs = [];
  for (const t of tenants) {
    for (let s = 0; s < screensPerTenant; s++) {
      jobs.push({ tenant: t, seq: s, fingerprint: `lt-${t.index}-${s}-${crypto.randomBytes(6).toString('hex')}` });
    }
  }
  console.log(`[seed] minting ${jobs.length} device credentials through the real endpoints…`);

  // 1. register (anonymous) → screenId + pairingCode + bootstrap token
  const failures = [];
  await pool(jobs, 40, async (j) => {
    const res = await request({
      apiUrl,
      method: 'POST',
      path: '/api/v1/screens/register',
      venueIndex: j.tenant.index,
      clientIp: j.tenant.ip,
      body: {
        deviceFingerprint: j.fingerprint,
        resolution: '1920x1080',
        osInfo: 'Android 11',
        browserInfo: 'Chrome/87.0.4280.141',
        userAgent: 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/87.0.4280.141 Safari/537.36',
      },
    });
    const json = parseJson(res);
    if (res.status !== 200 && res.status !== 201) {
      failures.push(`register ${j.fingerprint} -> ${res.status} ${res.body.slice(0, 120)}`);
      return;
    }
    j.screenId = json?.screenId;
    j.pairingCode = json?.pairingCode;
    j.bootstrapToken = json?.deviceToken;
  });
  if (failures.length) throw new Error(`[seed] register failed (${failures.length}):\n  ${failures.slice(0, 5).join('\n  ')}`);

  // 2. admin pair (claims the screen; rotates the credential epoch).
  //
  // ⚠️ FINDING LT-2 (see the report). `POST /screens/pair` wraps the licence
  // seat check + the claim in a SERIALIZABLE transaction, and `withDbRetry`
  // gives it 3 attempts inside a 600 ms wall-clock budget. Two admins racing
  // the last seat is what that was built for; a BULK PROVISION is not. Pairing
  // several screens of the SAME tenant concurrently makes the transactions
  // conflict with each other, the retry budget is spent immediately, and the
  // rest come back 500 DATABASE_ERROR. Measured below, deliberately, so the
  // number is reproducible — then the fleet is paired the way an operator
  // actually does it: one screen at a time per tenant, tenants in parallel.
  const pairOnce = (j) =>
    request({
      apiUrl,
      method: 'POST',
      path: '/api/v1/screens/pair',
      venueIndex: j.tenant.index,
      clientIp: j.tenant.ip,
      headers: { Authorization: `Bearer ${j.tenant.adminToken}` },
      body: { pairingCode: j.pairingCode, name: `Screen ${j.tenant.index}-${j.seq}`, screenGroupId: j.tenant.groupId },
    });

  const probeTenant = tenants[0];
  const probeJobs = jobs.filter((j) => j.tenant === probeTenant).slice(0, Math.min(8, screensPerTenant));
  let contention = null;
  if (probeJobs.length >= 2) {
    console.log(`[seed] bulk-pair contention probe: ${probeJobs.length} concurrent pairs in ONE tenant…`);
    const results = await Promise.all(probeJobs.map((j) => pairOnce(j)));
    const ok = results.filter((r) => r.status === 200 || r.status === 201).length;
    contention = {
      concurrency: probeJobs.length,
      ok,
      failed: results.length - ok,
      statuses: results.reduce((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), {}),
      sampleBody: results.find((r) => r.status >= 500)?.body.slice(0, 200) ?? null,
    };
    console.log(`[seed]   → ${ok}/${results.length} succeeded  ${JSON.stringify(contention.statuses)}`);
    // Re-pair whatever the probe lost, serially, so the fleet is intact.
    for (let i = 0; i < probeJobs.length; i++) {
      if (results[i].status === 200 || results[i].status === 201) continue;
      const retry = await pairOnce(probeJobs[i]);
      if (retry.status !== 200 && retry.status !== 201) {
        failures.push(`pair(serial-retry) ${probeJobs[i].pairingCode} -> ${retry.status} ${retry.body.slice(0, 160)}`);
      }
    }
  }

  // The rest: serial within a tenant, parallel across tenants — i.e. the
  // shape a 40-location bulk provision actually has.
  //
  // ⚠️ FINDING LT-2 (measured, see the report). Serialising WITHIN a tenant is
  // NOT enough. `assertSeatAvailable` COUNTs that tenant's screens inside the
  // SERIALIZABLE transaction, and PostgreSQL SSI takes predicate locks at
  // INDEX-PAGE granularity — on a fleet-sized `screens` table every tenant's
  // entries share the same handful of pages of `screens_tenant_id_status_idx`,
  // so a pair in tenant A conflicts with a pair in tenant B. The API's own
  // retry (`withDbRetry`, 600 ms hard deadline) cannot absorb it because the
  // transaction it wraps is allowed 20 s + 10 s maxWait — one slow attempt
  // spends the whole retry budget. So the client has to retry, and the number
  // of retries it needs IS the finding.
  const remaining = jobs.filter((j) => !probeJobs.includes(j));
  const byTenant = new Map();
  for (const j of remaining) {
    if (!byTenant.has(j.tenant.index)) byTenant.set(j.tenant.index, []);
    byTenant.get(j.tenant.index).push(j);
  }
  const PAIR_MAX_ATTEMPTS = 12;
  const retryHistogram = new Map(); // attempts -> screens that needed them
  let firstAttemptOk = 0;
  let conflictResponses = 0;
  const bulkStart = Date.now();
  await pool([...byTenant.values()], 20, async (group) => {
    for (const j of group) {
      let attempt = 0;
      for (;;) {
        attempt += 1;
        const res = await pairOnce(j);
        if (res.status === 200 || res.status === 201) {
          if (attempt === 1) firstAttemptOk += 1;
          retryHistogram.set(attempt, (retryHistogram.get(attempt) || 0) + 1);
          break;
        }
        if (res.status >= 500) conflictResponses += 1;
        if (attempt >= PAIR_MAX_ATTEMPTS) {
          failures.push(`pair ${j.pairingCode} -> ${res.status} after ${attempt} attempts ${res.body.slice(0, 160)}`);
          break;
        }
        // Full jitter, so 40 retrying provisioners do not re-collide.
        await new Promise((r) => setTimeout(r, Math.round(Math.random() * (60 * 2 ** Math.min(attempt, 5)))));
      }
    }
  });
  const bulkMs = Date.now() - bulkStart;
  if (failures.length) throw new Error(`[seed] pair failed (${failures.length}):\n  ${failures.slice(0, 5).join('\n  ')}`);
  mintScreens.contention = contention;
  mintScreens.bulkPair = {
    screens: remaining.length,
    tenantsInParallel: Math.min(20, byTenant.size),
    serialWithinTenant: true,
    wallClockMs: bulkMs,
    firstAttemptOk,
    firstAttemptSuccessRate: remaining.length ? firstAttemptOk / remaining.length : null,
    serverErrorResponses: conflictResponses,
    attemptsHistogram: Object.fromEntries([...retryHistogram.entries()].sort((a, b) => a[0] - b[0])),
    maxAttempts: Math.max(...retryHistogram.keys(), 0),
  };
  console.log(
    `[seed]   bulk pair: ${firstAttemptOk}/${remaining.length} succeeded first try; ` +
      `${conflictResponses} 5xx responses absorbed by client retry; worst screen needed ` +
      `${mintScreens.bulkPair.maxAttempts} attempts (${bulkMs} ms wall clock)`,
  );

  // 3. re-register with the prior token → the 180-day PROVEN credential
  await pool(jobs, 40, async (j) => {
    const res = await request({
      apiUrl,
      method: 'POST',
      path: '/api/v1/screens/register',
      venueIndex: j.tenant.index,
      clientIp: j.tenant.ip,
      body: { deviceFingerprint: j.fingerprint, priorDeviceToken: j.bootstrapToken },
    });
    const json = parseJson(res);
    if (res.status !== 200 && res.status !== 201 || !json?.deviceToken) {
      failures.push(`renew ${j.fingerprint} -> ${res.status} ${res.body.slice(0, 160)}`);
      return;
    }
    j.deviceToken = json.deviceToken;
    j.requiresRePair = !!json.requiresRePair;
  });
  if (failures.length) throw new Error(`[seed] renew failed (${failures.length}):\n  ${failures.slice(0, 5).join('\n  ')}`);

  const downgraded = jobs.filter((j) => j.requiresRePair).length;
  if (downgraded) {
    throw new Error(
      `[seed] ${downgraded}/${jobs.length} screens ended on a 1-hour re-pair-required credential. ` +
        `The fleet must be PROVEN before the run or the load test measures the wrong thing.`,
    );
  }
  return jobs;
}

async function main() {
  const tenantCount = CONFIG.tenants;
  const screensPerTenant = Math.ceil(CONFIG.screens / tenantCount);
  console.log(
    `[seed] target fleet: ${tenantCount} tenants x ${screensPerTenant} screens = ${tenantCount * screensPerTenant}`,
  );

  const already = await scalar(`SELECT count(*)::text FROM tenants WHERE slug LIKE 'loadtest-venue-%';`);
  if (Number(already) > 0) {
    console.log(`[seed] wiping ${already} pre-existing loadtest tenants…`);
    // Disposable database only. `session_replication_role = replica` suspends
    // FK and trigger enforcement for THIS session, which is what makes a
    // whole-tenant wipe possible without hand-maintaining a delete order
    // against a 2,000-line schema (and it is the only way to clear the
    // audit-log rows, which carry an immutability trigger by design).
    await exec(`
      SET session_replication_role = 'replica';
      DO $do$
      DECLARE t text;
      BEGIN
        FOR t IN
          SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'tenant_id'
        LOOP
          EXECUTE format(
            'DELETE FROM %I WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE %L)',
            t, 'loadtest-venue-%');
        END LOOP;
        DELETE FROM tenants WHERE slug LIKE 'loadtest-venue-%';
        DELETE FROM playlist_items WHERE playlist_id NOT IN (SELECT id FROM playlists);
        DELETE FROM template_zones WHERE template_id NOT IN (SELECT id FROM templates);
      END $do$;
      SET session_replication_role = 'origin';`);
  }

  const tenants = await seedContent(tenantCount, screensPerTenant);
  await loginAll(tenants);
  const screens = await mintScreens(tenants, screensPerTenant);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fleet = {
    seededAt: new Date().toISOString(),
    apiUrl,
    pairContention: mintScreens.contention ?? null,
    bulkPair: mintScreens.bulkPair ?? null,
    tenants: tenants.map((t) => ({
      index: t.index,
      tenantId: t.tenantId,
      groupId: t.groupId,
      email: t.email,
      ip: t.ip,
      adminToken: t.adminToken,
    })),
    screens: screens.map((j) => ({
      screenId: j.screenId,
      fingerprint: j.fingerprint,
      deviceToken: j.deviceToken,
      tenantIndex: j.tenant.index,
      tenantId: j.tenant.tenantId,
    })),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'fleet.json'), JSON.stringify(fleet));

  const counts = await sql(`
    SELECT 'screens', count(*)::text FROM screens WHERE tenant_id IS NOT NULL
    UNION ALL SELECT 'paired', count(*)::text FROM screens WHERE paired_at IS NOT NULL
    UNION ALL SELECT 'proven', count(*)::text FROM screens WHERE auth_state = 'PROVEN'
    UNION ALL SELECT 'schedules', count(*)::text FROM schedules
    UNION ALL SELECT 'playlist_items', count(*)::text FROM playlist_items
    UNION ALL SELECT 'template_zones', count(*)::text FROM template_zones;`);
  console.log('[seed] done:', counts.map(([k, v]) => `${k}=${v}`).join(' '));
  destroyAgents();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
