# The tenant-wide alert carries an id; a stale all-clear cannot end a newer alert (EMG-01, 2026-11-21)

**Status.** Branch `claude/fix-emg-01`, four commits: the fix, review rounds 1 and 2, and the review-round-3 revision. Not pushed, no pull request, **not merged**. This is life-safety CHANGE class. Before anyone relies on it, it needs a different vendor's review, the owner's written go, and the on-glass drill at the end of this file.

Model: Claude Opus 5.5, Claude Code cloud session, dispatched by a workflow script as the author. The independent review ran in a separate session.

## Situation

The tenant-wide ("All screens") alert lived on the Tenant row as `emergencyStatus` / `emergencyType`, with no id. The tenant all-clear used `:overrideId` only in the signed message and the audit row. The failing scenario:

1. Operator A sees "Hold".
2. Operator B escalates the same tenant to LOCKDOWN.
3. A types CLEAR to end the Hold.
4. The LOCKDOWN ends on every screen.

The district path had the same flaw. A district all-clear also ended a school's own alert raised after the district's, and the district admin's alert list did not show that school's alert.

## What the change is

- **Schema.** `Tenant.emergencyAlertId` and `Tenant.emergencyTriggeredAt`, both nullable. One idempotent `ALTER TABLE` adds both under `lock_timeout` (`20261121120000_tenant_emergency_alert_identity`).
- **Trigger.** Every tenant-level trigger writes the id in the same update as the status. That covers the dashboard, `/panic`, panic phones, drills and the district fan-out (one id for every school).
- **All-clear.** The request can name a real id while the tenant holds a different, identified, active alert. Such a request is refused before anything is dispatched, with 409 `ALERT_CHANGED` and an immutable `CLEAR_EMERGENCY_REFUSED` row. The root write is a compare-and-set, so a trigger that lands between the read and the commit rolls the whole batch back.
- **The wire.** The production `AllExceptionsFilter` drops extra fields, so the 409 goes out through a method-scoped filter (`apps/api/src/emergency/tenant-alert-changed.filter.ts`). Its body carries the newer alert twice: nested as `currentAlert`, and as flat `currentAlert*` fields. `tenant-alert-changed.http.spec.ts` checks the body over real HTTP with the global filter registered.
- **District path.** A school that holds its own, different alert is left out of the district clear. It gets no push, no row write, no override-row change, no CLEAR row and no "cleared" email. The descendants' write carries the same guard as the root's. `GET /emergency/active` lists the school's alert beside the district's.
- **Backward compatibility.** These requests clear exactly as before:
  - a request with no id;
  - `clear_<uuid>`;
  - `global_clear`;
  - a stored NULL id (an alert raised before deploy).
- **Kill switch.** `EMERGENCY_ALERT_IDENTITY_DISABLED` (`1|true|yes`, read per request) also restores the old behaviour.
- **Web.** The overlay and `/panic` send the listed id. On a 409 they:
  - say in en/es/zh that a newer alert of type X is active and nothing was cleared;
  - re-read the list;
  - need a fresh confirmation.

  If the 409 carries no type, they name it from the list they re-read.
- **Review round 2.**
  - `GET /emergency/active` lists one tenant-wide alert once when the caller's root is calm, too. A school's own alert is written on its child locations as well; before, each location listed it again under the same id, so both web surfaces keyed the entries alike and a click on a location could select and clear the school. A child whose visible, active parent holds the same identified alert is now that parent's entry; a child with no id lists on its own, as before. Both surfaces also key tenant-wide entries by `tenant:<scopeId>:<alertId>`, so even an older server's list cannot share a key.
  - Release latency: the subtree walk runs beside the root read (one round trip less on every tenant all-clear), and the district pre-read (override rows, then the schools' identities) has a 1.5 s budget (`districtPreReadBudgetMs`). Past it, the all-clear goes ahead as if the reads had failed: nobody is kept, and the guarded descendants' write still keeps a school's own alert on its row and its glass.
  - After a 409, the overlay and `/panic` aim the next freshly confirmed clear at the alert the 409 named (its id now travels in `currentAlert`), and show that alert in place of the replaced one when the list cannot be re-read. A list or tenant status that cannot be refreshed no longer means a 409 on every retry.
  - A district all-clear that left locations in their own alert returns `keptTenantIds`; the overlay says "N locations keep their own alerts…" in a toast (en/es/zh), which stays visible after the dashboard lock comes down.
- **Review round 3.**
  - `keptTenantIds` is one entry per kept ALERT. A school's own alert is also written on its child locations, so the round-2 list named one alert once per location ("2 locations…" for one listed alert). A kept location whose parent is also kept with the same id is that parent's entry (`onePerKeptAlert`, the same rule `GET /emergency/active` lists by). The `CLEAR_EMERGENCY` audit row still names every kept location.
  - The response also carries `keptListedForCaller`: true only when the caller's own `GET /emergency/active` lists those alerts (a district admin, or a super admin whose own tenant is the scope or above it). The toast says "open Emergency Trigger, where it is listed" only then. Otherwise (a school admin whose annex kept its own alert, or a reply without the flag) it says the alert is not in the operator's list and that the location's own operators or a district administrator must end it (en/es/zh, `emergency.overlay.keptOwnAlertNotListed`).
  - "End Drill" that loses the read-to-commit race to a newer alert is now the same 409 as the live path. The drill root write is an `updateMany`, which ends nothing and throws nothing in that race, so the batch used to commit its `CLEAR_EMERGENCY_DRILL` rows and report success. The batch now carries one more statement, `tenant.update({ where: { id, ...guard }, data: {} })`: Prisma 5.22 runs it as a guarded `SELECT` that writes nothing, and it throws P2025 only when the root holds a different identified alert. That rolls the batch back and takes the existing at-commit 409 path. An End Drill on a calm root, or on a root a live alert with the same or no id replaced, succeeds exactly as before. Proved on Postgres 16 (table below).
  - The all-clear and trigger actions bound the response BODY read to 3 s. `fetchWithTimeout` clears its timer once headers arrive, so a stalled body could leave the operator's all-clear pending and then read as "NOT sent" for an all-clear that had landed. The status is the verdict; a late body reads as "no body".
  - `/panic` computes the id an entry names from the same tenant the request is sent under (after a 401 the resend may run under a restored session of another tenant).
  - When a list holds more than one tenant-wide alert, each is labelled with its location: "Lockdown — Washington Elementary, 6 screens", the words a group entry already uses (`emergency.target.activeOne`; no new copy). A single tenant-wide entry reads as before.

## The reproduction against a real database

These steps ran on 2026-11-21 in both rounds, each time on a throwaway local Postgres 16. Each cluster was started, used and deleted the same day. No shared or deployed database was touched.

1. **Schema.** `initdb` a cluster on a local socket. Run `prisma migrate deploy` with every migration in the repository, then `psql -f` the new migration twice.
   - Result: exit 0 both times, with the NOTICE "already exists, skipping" for each column.
   - Both columns are nullable.
2. **District path.** From `packages/database`, with `DATABASE_URL` pointing at that cluster, run the script below. It sends the same guarded batch `clearEmergency` sends.

Round 1 output, condensed:

| Case | Result |
|---|---|
| 1. District `W`; school-l raised its own `L`; school-null is pre-identity. The clear names `W`, and school-l is left out as read. | 2 descendants written, 3 audit rows. school-l keeps `CRITICAL/LOCKDOWN/L`; the rest are `INACTIVE`. |
| 2. The same, but school-l raised `L` after the read, so it is still in the descendants' write. | 2 descendants written, school-l keeps `L`. 4 audit rows: this is the named residual below. |
| 3. A newer district alert `X` replaced `W` on the root. | P2025 and 0 audit rows. Every row is unchanged (the batch rolled back). |
| 4. End Drill naming drill `W` after a newer district drill `X` replaced it everywhere. | 0 rows written at the root and 0 in the descendants. Every school keeps drill `X`. |
| 5. A district clear with no real id (an older client). | 3 descendants written. The whole subtree is `INACTIVE`, as before. |

```js
// emg01-district-repro.cjs. THROWAWAY LOCAL DATABASE ONLY. Run from packages/database with DATABASE_URL set.
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [process.cwd()] }));
const p = new PrismaClient();
const guard = (id) => (id ? { OR: [{ emergencyAlertId: id }, { emergencyAlertId: null }, { emergencyStatus: 'INACTIVE' }] } : {});
const cleared = { emergencyStatus: 'INACTIVE', emergencyType: null, emergencyPlaylistId: null, emergencyPortraitPlaylistId: null, emergencyIsDrill: false, emergencyAlertId: null, emergencyTriggeredAt: null };
const alert = (type, id, isDrill = false) => ({ emergencyStatus: 'CRITICAL', emergencyType: type, emergencyAlertId: id, emergencyTriggeredAt: id ? new Date() : null, emergencyIsDrill: isDrill });
(async () => {
  const mk = (slug, parentId) => p.tenant.create({ data: { name: slug, slug: `${slug}-${Date.now()}`, ...(parentId ? { parentId } : {}) } });
  const d = await mk('district'); const l = await mk('school-l', d.id); const s = await mk('school-s', d.id); const n = await mk('school-null', d.id);
  const all = [d.id, l.id, s.id, n.id];
  const name = new Map([[d.id, 'district'], [l.id, 'school-l'], [s.id, 'school-s'], [n.id, 'school-null']]);
  const show = async () => (await p.tenant.findMany({ where: { id: { in: all } } })).map((t) => `${name.get(t.id)}=${t.emergencyStatus}/${t.emergencyType}/${t.emergencyAlertId}${t.emergencyIsDrill ? '/drill' : ''}`).sort().join('  ');
  const set = (id, data) => p.tenant.update({ where: { id }, data });
  const audits = () => p.auditLog.count({ where: { tenantId: { in: all } } });
  const batch = (rootId, descIds, expected, drill) => [
    drill
      ? p.tenant.updateMany({ where: { id: rootId, emergencyIsDrill: true, ...guard(expected) }, data: cleared })
      : p.tenant.update({ where: { id: rootId, ...guard(expected) }, data: cleared }),
    ...(descIds.length ? [p.tenant.updateMany({ where: { id: { in: descIds }, ...(drill ? { emergencyIsDrill: true } : {}), ...guard(expected) }, data: cleared })] : []),
    ...[rootId, ...descIds].map((tid) => p.auditLog.create({ data: { action: drill ? 'CLEAR_EMERGENCY_DRILL' : 'CLEAR_EMERGENCY', targetType: 'tenant', targetId: tid, tenantId: tid, details: '{}' } })),
  ];
  const reset = async () => {
    for (const id of [d.id, s.id]) await set(id, alert('WEATHER', 'W'));
    await set(l.id, alert('LOCKDOWN', 'L'));
    await set(n.id, alert('WEATHER', null));
  };
  let a0, r;
  await reset(); a0 = await audits(); r = await p.$transaction(batch(d.id, [s.id, n.id], 'W', false));
  console.log('1.', r[1].count, (await audits()) - a0, await show());
  await reset(); a0 = await audits(); r = await p.$transaction(batch(d.id, [l.id, s.id, n.id], 'W', false));
  console.log('2.', r[1].count, (await audits()) - a0, await show());
  await reset(); for (const id of [d.id, s.id]) await set(id, alert('LOCKDOWN', 'X'));
  a0 = await audits(); let code = null;
  try { await p.$transaction(batch(d.id, [s.id, n.id], 'W', false)); } catch (e) { code = e.code; }
  console.log('3.', code, (await audits()) - a0, await show());
  for (const id of all) await set(id, alert('LOCKDOWN', 'X', true));
  r = await p.$transaction(batch(d.id, [l.id, s.id, n.id], 'W', true));
  console.log('4.', r[0].count, r[1].count, await show());
  await reset(); r = await p.$transaction(batch(d.id, [l.id, s.id, n.id], null, false));
  console.log('5.', r[1].count, await show());
  await p.$disconnect();
})().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
```

### Review round 3: the End Drill guard on a real database

Run on 2026-11-22 on a throwaway local Postgres 16 (`initdb` under the postgres user's home, every migration applied with `prisma migrate deploy`, the generated Prisma 5.22 client), then stopped and deleted. The batch is the one `clearEmergency` sends for an End Drill that names its drill, with the round-3 guard statement second. With query logging on, the guard runs as a `SELECT … WHERE id = $1 AND (emergency_alert_id = $2 OR emergency_alert_id IS NULL OR emergency_status = $3)` and no `UPDATE`.

| Case (district + one school; End Drill names `W`) | Result |
|---|---|
| A. Drill `W` on both, no race | Commit. Root `updateMany` count 1, 2 audit rows, both `INACTIVE`. |
| B. A newer drill `X` replaced `W` on both (the race) | P2025, ROLLBACK, 0 audit rows. Both keep drill `X`. |
| C. Root already cleared (a second End Drill) | Commit, as before. Count 0, 2 audit rows, both stay `INACTIVE`. |
| D. Root holds a LIVE alert with id `W` (an old build replaced the drill) | Commit, as before. Count 0; both keep the live alert. |
| E. Root holds a LIVE alert with no id | Commit, as before. Count 0; both keep the live alert. |
| F. A newer LIVE alert `X` replaced drill `W` (the race) | P2025, ROLLBACK, 0 audit rows. Both keep `X`. |

```js
// emg01-r3-drill-guard.cjs. THROWAWAY LOCAL DATABASE ONLY. Run from packages/database with DATABASE_URL set.
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [process.cwd()] }));
const p = new PrismaClient({ log: process.env.LOG_SQL ? ['query'] : [] });
const guard = (id) => (id ? { OR: [{ emergencyAlertId: id }, { emergencyAlertId: null }, { emergencyStatus: 'INACTIVE' }] } : {});
const cleared = { emergencyStatus: 'INACTIVE', emergencyType: null, emergencyPlaylistId: null, emergencyPortraitPlaylistId: null, emergencyIsDrill: false, emergencyAlertId: null, emergencyTriggeredAt: null };
const alert = (type, id, isDrill = false) => ({ emergencyStatus: 'CRITICAL', emergencyType: type, emergencyAlertId: id, emergencyTriggeredAt: id ? new Date() : null, emergencyIsDrill: isDrill });
(async () => {
  const mk = (slug, parentId) => p.tenant.create({ data: { name: slug, slug: `${slug}-${Date.now()}-${Math.random()}`, ...(parentId ? { parentId } : {}) } });
  const d = await mk('district'); const s = await mk('school', d.id);
  const all = [d.id, s.id];
  const name = new Map([[d.id, 'district'], [s.id, 'school']]);
  const show = async () => (await p.tenant.findMany({ where: { id: { in: all } } })).map((t) => `${name.get(t.id)}=${t.emergencyStatus}/${t.emergencyType}/${t.emergencyAlertId}${t.emergencyIsDrill ? '/drill' : ''}`).sort().join('  ');
  const set = (id, data) => p.tenant.update({ where: { id }, data });
  const audits = () => p.auditLog.count({ where: { tenantId: { in: all } } });
  const batch = (expected) => [
    p.tenant.updateMany({ where: { id: d.id, emergencyIsDrill: true, ...guard(expected) }, data: cleared }),
    p.tenant.update({ where: { id: d.id, ...guard(expected) }, data: {} }),
    p.tenant.updateMany({ where: { id: { in: [s.id] }, emergencyIsDrill: true, ...guard(expected) }, data: cleared }),
    ...all.map((tid) => p.auditLog.create({ data: { action: 'CLEAR_EMERGENCY_DRILL', targetType: 'tenant', targetId: tid, tenantId: tid, details: '{}' } })),
  ];
  const run = async (label, setup, expected) => {
    await setup();
    const a0 = await audits();
    let code = null; let r = null;
    try { r = await p.$transaction(batch(expected)); } catch (e) { code = e.code || String(e); }
    console.log(label, '| code:', code, '| root updateMany count:', r ? r[0].count : '-', '| audit rows added:', (await audits()) - a0, '|', await show());
  };
  await run('A.', async () => { for (const id of all) await set(id, alert('HOLD', 'W', true)); }, 'W');
  await run('B.', async () => { for (const id of all) await set(id, alert('LOCKDOWN', 'X', true)); }, 'W');
  await run('C.', async () => { for (const id of all) await set(id, cleared); }, 'W');
  await run('D.', async () => { for (const id of all) await set(id, alert('LOCKDOWN', 'W', false)); }, 'W');
  await run('E.', async () => { for (const id of all) await set(id, alert('LOCKDOWN', null, false)); }, 'W');
  await run('F.', async () => { for (const id of all) await set(id, alert('LOCKDOWN', 'X', false)); }, 'W');
  await p.$disconnect();
})().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
```

## Residuals (named, not fixed)

- **A district clear that cannot confirm which schools hold their own alert.** This happens when a school raises its own alert in the milliseconds between the district clear's read and its commit, and (review round 2) whenever the district pre-read misses its 1.5 s budget or fails, for example in a pooler stall. The guarded write keeps the school's alert on its row and on its glass. That school still gets:
  - the district's signed ALL_CLEAR push (the player only re-reads its manifest);
  - an epoch saying "no alert up";
  - a `CLEAR_EMERGENCY` row naming the district's id;
  - the "cleared" email.

  It also gets no "kept" toast (`keptTenantIds` is empty), so the district admin's lock can drop while that school's screens stay in alert. A batch transaction cannot make those depend on the guarded write. The fix the round-3 review suggested: when the request names an id and the pre-read produced no kept list, re-read the descendants after the commit (after the dispatch, so release latency is unchanged), report any school still holding another identified alert in `keptTenantIds`, leave it out of the email and the ledger, and write a follow-up audit row. Deferred from round 3: it adds a read, a new audit row and a change to the email and ledger paths, which needs its own review.
- ~~"End Drill" races a newer drill on the root.~~ Fixed in review round 3 (the guard statement above). It is now the 409, with nothing committed and the epoch put back to "an alert is up".
- **Launch-week support note. An old cached overlay bundle (from before EMG-01) whose alert list cannot load** sends the browser's stored `activeEmergencyOverrideId`. If another alert replaced that one, every retry gets a 409 until the list loads (the bundle then sends the listed id) or the tab reloads. Meanwhile it shows "All clear failed: 409" and keeps the lock up, so the alert stays visible. The current bundle sends the id from `GET /tenants` instead. To clear it: reload the tab, or end the alert from `/panic` or another device.
- **A district alert raised before deploy (district id NULL) with a school's own alert raised after.** The district list shows both. A district all-clear that names no real id (`clear_<uuid>`) also ends the school's alert, which is today's behaviour for a stored NULL. One that names a real id from the browser's store leaves the school alone. This only happens during the deploy transition.
- **Precedence between a district alert and a school's own alert (EMG-02).** A district trigger still overwrites a school's own alert. A school's own all-clear can still end the district's alert for that school. Neither is changed here.
- **Rolling back to a build from before EMG-01, then forward again, leaves old ids on tenants that raised an alert meanwhile** (the old build neither writes nor nulls the columns). List-driven clients send the listed id and clear normally; a client that cannot read the list gets a 409 on every try. Remedy before rolling forward: `EMERGENCY_ALERT_IDENTITY_DISABLED=1` until those alerts are cleared, or the owner nulls both columns just before the roll-forward deploy. See `docs/BACKUP_AND_ROLLBACK.md`, section A.
- **Pre-existing, not introduced here (its own finding).** A tenant all-clear that names an alert that has already ended (tenant INACTIVE) is not refused, and still sweeps per-screen rows with a null `alertId`. Those rows come from the GPIO panic button (`gpio.service.ts` `triggerScreenEmergency`) and from screen-emergency triggers. So a stale CLEAR can still end a newer GPIO LOCKDOWN that has its own device-scope entry in the list. The sweep is `planAllClear`'s predicate `e.scopeType === 'tenant' || !e.alertId`. It is the same on master.
- ~~Two tenant-wide entries look alike in a district admin's list.~~ Fixed in review round 3: with more than one tenant-wide entry listed, each is named by its location, using the existing group-entry wording. A single entry still reads "<type> — all screens (N)", even when it is a school's own alert shown to a district admin; naming it there too is a copy change for the owner.
- **`CLEAR_EMERGENCY_REFUSED` is not in the customer Activity feed.** The allowlist in `packages/api-types/src/customer-activity.ts` excludes every `*_REFUSED` guard row by design. SUPER_ADMIN "All events" shows it. Adding it is a proposal for the owner, with en/es/zh labels.

## On-glass drill (bench screens or a test tenant only; never a live trigger in production)

1. **Deploy and confirm.** Deploy to the bench. Confirm that `/api/v1/health` `commit` equals the merge SHA and that `tenants.emergency_alert_id` exists.
2. **A stale CLEAR is refused.**
   - Browser A (dashboard) sends a Hold drill to All screens.
   - Browser B escalates the same tenant to a Lockdown drill.
   - A types CLEAR before its 15 s refresh.
   - Expect "Nothing was cleared: a newer alert is now active (Lockdown)…". The lock stays up, and every screen stays on Lockdown with no blink.
   - Expect one `CLEAR_EMERGENCY_REFUSED` row in Activity → All events (SUPER_ADMIN).
3. **The current alert clears.** A types CLEAR again. The Lockdown ends everywhere, and a `CLEAR_EMERGENCY_DRILL` row carries its id.
4. **`/panic`.** Repeat step 2 with `/panic` as A. Expect the same words in the sheet; a second hold ends the Lockdown.
5. **District.**
   - The district sends a Weather drill to All screens.
   - One school raises its own Lockdown drill. The district admin's overlay lists both.
   - The district ends the Weather. The school's screens stay on Lockdown; every other school releases.
   - The district admin, or the school, then ends the Lockdown from the list.
   - Round 2: give that school a child location first. With the district calm, the district admin's list shows the school's Lockdown once (not once per location). After the district ends its Weather, a toast says one location keeps its own alert, and it stays visible after the dashboard lock comes down.
   - Round 3, with that child location: while both alerts are up, the district admin's list names each by location ("Weather — <district>, N screens", "Lockdown — <school>, M screens"). The toast after the Weather clear says **1** location (not 2) and "open Emergency Trigger, where it is listed".
   - Round 3, school admin: the school raises a Hold drill, the child location raises its own drill (from a district admin), and the school admin ends the Hold. The child keeps its drill. The toast says it is not in the school admin's list and that the location's own operators or a district administrator must end it.
6. **Old bundle, list down (if an old cached bundle is available).** Block `/emergency/active` for the old tab and repeat step 2. Expect "All clear failed: 409" on every retry while the Lockdown stays on the glass. Then unblock the list or reload the tab, and the clear works.
   - Round 2, the current bundle: repeat step 2, but block `/emergency/active` and `GET /tenants` for A right after the 409. The list shows the Lockdown in place of the Hold, and A's next CLEAR ends it at the first try. Repeat on `/panic`.
   - Round 3, End Drill: start a Hold drill, open the overlay in browser A, escalate to a Lockdown drill in browser B, then send A's End Drill before its list refreshes. Expect the 409 message (Lockdown), the Lockdown drill on every screen, a `CLEAR_EMERGENCY_REFUSED` row, and no `CLEAR_EMERGENCY_DRILL` row for the Hold. By hand this almost always reaches the refusal before the dispatch; the at-commit race itself is proved by `emergency.alert-identity.spec.ts` and the Postgres run above, not on glass.
7. **Kill switch.** Set `EMERGENCY_ALERT_IDENTITY_DISABLED=1` and restart. Step 2's stale CLEAR now ends the Lockdown, as before EMG-01. Unset it and restart.
8. **Paint and WebKit.**
   - Throughout, every screen shows `PLAYER_EMERGENCY_PAINTED` with no `NO_PAINT_PROOF`, and releases after each successful clear.
   - Run steps 2 to 5 once in Safari.
