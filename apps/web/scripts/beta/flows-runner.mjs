/**
 * Deep-flow / destructive-flow tester — exercises end-to-end backend flows that go
 * beyond page-render, on an ISOLATED self-provisioned tenant. SAFE: the throwaway
 * tenant has NO paired screens, so an emergency trigger reaches no physical display.
 *
 * Usage: node flows-runner.mjs <flow> [api]
 *   flow: emergency
 * Prints structured JSON. A follow-up DB check (postgres MCP) confirms side effects.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const [flow = 'emergency', API = 'https://api-production-39a1.up.railway.app/api/v1'] = process.argv.slice(2);
const stamp = Date.now();
const outDir = `/tmp/beta-flow-${flow}-${stamp}`;
mkdirSync(outDir, { recursive: true });

const jpost = async (path, token, body) => {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, ok: res.ok, json };
};

const provision = async () => {
  const email = `beta+flow-${flow}-${stamp}@venue-os.app`;
  const r = await jpost('/signup', null, {
    districtName: `Beta Flow ${flow} ${stamp}`,
    slug: `beta-flow-${flow}-${stamp}`.slice(0, 60),
    adminEmail: email, password: 'BetaTester!2026x', vertical: 'K12',
    firstName: 'Beta', lastName: 'Tester',
  });
  if (!r.ok || !r.json?.access_token) throw new Error(`signup failed ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return { token: r.json.access_token, user: r.json.user, email };
};

const run = async () => {
  const out = { flow, stamp, outDir };
  const { token, user, email } = await provision();
  out.tenantId = user.tenantId;
  out.tenantSlug = user.tenantSlug;
  out.role = user.role;
  out.email = email;

  if (flow === 'emergency') {
    const expiresAt = new Date(stamp + 2 * 60 * 1000).toISOString(); // auto-expire 2 min (safety)
    // TRIGGER lockdown scoped to THIS throwaway tenant only (no screens paired -> nothing displays)
    out.trigger = await jpost('/emergency/trigger', token, {
      scopeType: 'tenant',
      scopeId: user.tenantId,
      overridePayload: {
        type: 'lockdown',
        severity: 'CRITICAL',
        textBlob: 'BETA AUTOMATED TEST — isolated tenant, ignore',
        expiresAt,
      },
    });
    out.overrideId = out.trigger?.json?.overrideId || null;

    // ALL-CLEAR (cancel) using the returned overrideId
    if (out.overrideId) {
      out.allClear = await jpost(`/emergency/${out.overrideId}/all-clear`, token, {
        scopeType: 'tenant', scopeId: user.tenantId,
      });
    } else {
      out.allClear = { skipped: 'no overrideId from trigger' };
    }
  }

  if (flow === 'content') {
    // Core operator loop: add URL asset -> create playlist -> create group -> schedule playlist to group.
    out.asset = await jpost('/assets/url', token, { url: 'https://example.com', name: `Beta URL asset ${stamp}` });
    out.playlist = await jpost('/playlists', token, { name: `Beta Playlist ${stamp}` });
    out.group = await jpost('/screen-groups', token, { name: `Beta Group ${stamp}` });
    const playlistId = out.playlist?.json?.id;
    const groupId = out.group?.json?.id;
    if (playlistId && groupId) {
      out.schedule = await jpost('/schedules', token, {
        playlistId, screenGroupId: groupId,
        startTime: new Date(stamp).toISOString(),
        mode: 'replace', isActive: true, priority: 1,
      });
    } else {
      out.schedule = { skipped: `missing playlistId(${playlistId}) or groupId(${groupId})` };
    }
  }

  writeFileSync(`${outDir}/result.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
};

run().catch((e) => { console.error(JSON.stringify({ flow, error: String(e) })); process.exit(1); });
