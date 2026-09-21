/**
 * screenOps — the Calm Operations v3 derivation matrix.
 *
 * Every row of the handoff's §9 status table gets a case here: input shape →
 * dominant status key + tone + action verb. The §3.1 worst-first precedence
 * is proved by CONFLICT cases (a screen wearing three conditions at once must
 * report exactly one), because that is the rule the whole design rests on.
 */

import {
  buildScreenOps,
  compactAge,
  deriveEvidenceChain,
  deriveExpectedContent,
  deriveRecovery,
  deriveReportedContent,
  deriveScreenStatus,
  matchesFilter,
  matchesQuery,
  STATUS_ORDER,
  UNGROUPED_ID,
  type OpsPlaylist,
  type OpsSchedule,
  type OpsScreen,
  previewOf,
  syncStatusFor,
} from '../screenOps';

const NOW = Date.parse('2026-08-31T17:00:00.000Z');
const MIN = 60_000;
const SHA = 'abc123def456';

function scr(over: Partial<OpsScreen> = {}): OpsScreen {
  return {
    id: over.id ?? 'scr-1',
    name: 'G43',
    status: 'ONLINE',
    lastPingAt: new Date(NOW - 8_000).toISOString(),
    renderHealth: 'OK',
    renderStale: false,
    lastRenderedAt: new Date(NOW - 20_000).toISOString(),
    lastRenderedHash: 'content:9f2',
    lastBundleSha: SHA,
    pendingRefreshAt: null,
    pushChannel: 'live',
    lastPushConnectedAt: new Date(NOW - 30_000).toISOString(),
    authState: 'PROVEN',
    ...over,
  };
}

const status = (over: Partial<OpsScreen> = {}, deployedSha: string | null = SHA) =>
  deriveScreenStatus({ screen: scr(over), deployedSha, now: NOW });


// ═══════════════════════════════════════════════════════════════════
// §9 — one case per row of the status table
// ═══════════════════════════════════════════════════════════════════

describe('deriveScreenStatus — §9 taxonomy', () => {
  it('correct revision + fresh render proof → Current (green, View)', () => {
    const s = status();
    expect(s.key).toBe('current');
    expect(s.tone).toBe('ok');
    expect(s.label).toBe('Current');
    expect(s.action).toBe('View');
    expect(s.needsAttention).toBe(false);
  });

  it('render evidence pending briefly → Confirming picture… (amber, not an alarm)', () => {
    const s = status({
      renderHealth: 'STALE',
      renderStale: true,
      lastRenderedAt: new Date(NOW - 2 * MIN).toISOString(),
    });
    expect(s.key).toBe('confirming');
    expect(s.tone).toBe('warn');
    expect(s.label).toBe('Confirming picture…');
    expect(s.needsAttention).toBe(false);
  });

  it('recently stopped painting while reachable → No picture confirmed (red, Resync)', () => {
    const s = status({
      renderHealth: 'STALE',
      renderStale: true,
      lastRenderedAt: new Date(NOW - 20 * MIN).toISOString(),
    });
    expect(s.key).toBe('not-painting');
    expect(s.tone).toBe('bad');
    expect(s.label).toBe('No picture confirmed');
    expect(s.action).toBe('Resync');
    expect(s.age).toBe('20m');
  });

  it('video frame stalled → Video stuck · fixing itself', () => {
    const s = status({ lastRenderedHash: 'stall|content:9f2' });
    expect(s.key).toBe('media-stalled');
    expect(s.label).toBe('Video stuck · fixing itself');
    expect(s.needsAttention).toBe(true);
  });

  it('unacknowledged refresh → Content behind · 18m (red, Resync)', () => {
    const s = status({ pendingRefreshAt: new Date(NOW - 18 * MIN).toISOString() });
    expect(s.key).toBe('content-behind');
    expect(s.tone).toBe('bad');
    expect(s.label).toBe('Content behind');
    expect(s.age).toBe('18m');
    expect(s.action).toBe('Resync');
    expect(s.evidence).toBe('Reported: update not confirmed');
  });

  // CHANGED 2026-09-16, deliberately. This case used to assert
  // `content-behind` for a stale page bundle. It was wrong, and Greg found it
  // twice in one afternoon during a live test — once fleet-wide ("why is every
  // screen showing its behind? i havent changed anything on the playlists"),
  // once on the stragglers ("they are online and rotating content right now").
  // Both were caused by a web deploy moving deployedSha under the whole fleet.
  // A screen on an older BUNDLE is not behind on CONTENT; it is playing exactly
  // what it was told to play. The old expectation is kept below as the thing
  // that must NOT come back.
  it('stale page bundle with no pending push → Updating itself, NOT an exception', () => {
    const s = status({ lastBundleSha: 'oldsha000000' });
    expect(s.key).toBe('app-updating');
    expect(s.label).toBe('Updating itself');
    expect(s.tone).toBe('muted');
    expect(s.needsAttention).toBe(false);
    expect(s.age).toBeUndefined();
    // The regression guard: never again claim a content failure from bundle skew.
    expect(s.key).not.toBe('content-behind');
    expect(s.label).not.toMatch(/behind/i);
    expect(s.evidence).not.toMatch(/older app version/i);
  });

  // 2026-09-21 — the operator, from his phone, the morning of three web deploys:
  //   "why does every screen say resync on it…our app needs to self heal not
  //    … be asking me to do shit all the time"
  // Every deploy puts the WHOLE fleet in this state until each panel reloads
  // itself. A row action of Resync/Retry renders a button on the Screens page
  // (desktop and mobile); anything else renders none. So this state must never
  // carry one — it heals on its own and says so.
  it('a self-updating screen ASKS FOR NOTHING: no Resync on the row, and the copy says so', () => {
    const s = status({ lastBundleSha: 'oldsha000000' });
    expect(s.action).toBe('View');
    expect(['Resync', 'Retry']).not.toContain(s.action);
    expect(s.detail).toMatch(/on its own/i);
    expect(s.detail).toMatch(/nothing for you to do/i);
    expect(s.detail).not.toMatch(/resync/i);
  });

  it('a stale bundle does NOT drag the screen into the attention set', () => {
    const s = status({ lastBundleSha: 'oldsha000000' });
    expect(s.needsAttention).toBe(false);
  });

  it('an unacked push still outranks bundle skew and still reads Content behind', () => {
    // Both conditions at once — the shape every screen wears during a deploy
    // that also pushed a refresh. The stronger claim must win.
    const s = status({
      lastBundleSha: 'oldsha000000',
      pendingRefreshAt: new Date(NOW - 18 * MIN).toISOString(),
    });
    expect(s.key).toBe('content-behind');
    expect(s.tone).toBe('bad');
    expect(s.needsAttention).toBe(true);
    expect(s.evidence).toBe('Reported: update not confirmed');
  });

  it('push degraded → Push delayed · 42m (amber, Retry, polling backstop)', () => {
    const s = status({
      pushChannel: 'stale',
      lastPushConnectedAt: new Date(NOW - 42 * MIN).toISOString(),
    });
    expect(s.key).toBe('push-delayed');
    expect(s.tone).toBe('warn');
    expect(s.age).toBe('42m');
    expect(s.action).toBe('Retry');
    expect(s.evidence).toBe('Polling backstop active');
  });

  it('heartbeat stale → Offline · 18m (red, Troubleshoot)', () => {
    const s = status({ status: 'OFFLINE', lastPingAt: new Date(NOW - 18 * MIN).toISOString() });
    expect(s.key).toBe('offline');
    expect(s.tone).toBe('bad');
    expect(s.age).toBe('18m');
    expect(s.action).toBe('Troubleshoot');
    expect(s.detail).toContain('18 minutes');
  });

  it('credential downgraded → Re-pair required (amber, Re-pair)', () => {
    const s = status({ authState: 'REPAIR_REQUIRED' });
    expect(s.key).toBe('repair-required');
    expect(s.tone).toBe('warn');
    expect(s.action).toBe('Re-pair');
  });

  it('player alive with no schedule → Screen on · nothing scheduled (neutral, not a failure)', () => {
    const s = status({ lastRenderedHash: 'idle:boot' });
    expect(s.key).toBe('idle');
    expect(s.tone).toBe('neutral');
    expect(s.needsAttention).toBe(false);
  });

  it('paused on the screen by an operator → Paused on the screen (neutral; NEVER "nothing scheduled")', () => {
    // 2026-09-01 (TC22 field find): content was scheduled, the operator had
    // paused from the remote, and this row said "nothing scheduled".
    const s = status({ lastRenderedHash: 'paused:pl-42' });
    expect(s.key).toBe('paused');
    expect(s.tone).toBe('neutral');
    expect(s.needsAttention).toBe(false);
    expect(s.label).toBe('Paused on the screen');
    expect(s.label).not.toMatch(/nothing scheduled/i);
  });

  it('no evidence capability → Can’t confirm picture yet (gray, never red)', () => {
    const s = status({ renderHealth: 'UNKNOWN', lastRenderedAt: null, lastRenderedHash: null });
    expect(s.key).toBe('unknown');
    expect(s.tone).toBe('muted');
    expect(s.needsAttention).toBe(false);
  });

  it('emergency showing but server contact lost → red, outranks everything', () => {
    const s = status({
      lastRenderedHash: 'unconfirmed|em:lockdown',
      pendingRefreshAt: new Date(NOW - 30 * MIN).toISOString(),
      pushChannel: 'stale',
    });
    expect(s.key).toBe('alert-unconfirmed');
    expect(s.tone).toBe('bad');
    expect(s.action).toBe('Troubleshoot');
  });

  it('chronic missing proof over 48h → gray documented condition, not an alarm', () => {
    const s = status({
      renderHealth: 'STALE',
      renderStale: true,
      lastRenderedAt: new Date(NOW - 60 * 3600_000).toISOString(),
    });
    expect(s.key).toBe('stale-chronic');
    expect(s.tone).toBe('muted');
    expect(s.needsAttention).toBe(false);
  });

  it('paired but never checked in → Waiting for first check-in (Set up)', () => {
    const s = status({ status: 'PENDING', lastPingAt: null });
    expect(s.key).toBe('pending');
    expect(s.action).toBe('Set up');
  });

  it('revoked → Access removed, calm', () => {
    const s = status({ status: 'REVOKED' });
    expect(s.key).toBe('revoked');
    expect(s.needsAttention).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// §3.1 / §8 — exactly ONE dominant condition, worst first
// ═══════════════════════════════════════════════════════════════════

describe('precedence — one dominant status per row (§3.1)', () => {
  it('offline beats content-behind and push-delayed', () => {
    const s = status({
      status: 'OFFLINE',
      lastPingAt: new Date(NOW - 5 * MIN).toISOString(),
      pendingRefreshAt: new Date(NOW - 40 * MIN).toISOString(),
      pushChannel: 'stale',
    });
    expect(s.key).toBe('offline');
  });

  it('no-picture beats offline-ranked conditions below it', () => {
    const s = status({
      renderHealth: 'STALE',
      renderStale: true,
      lastRenderedAt: new Date(NOW - 30 * MIN).toISOString(),
      pendingRefreshAt: new Date(NOW - 40 * MIN).toISOString(),
      pushChannel: 'stale',
    });
    expect(s.key).toBe('not-painting');
  });

  it('content-behind beats push-delayed', () => {
    const s = status({
      pendingRefreshAt: new Date(NOW - 3 * MIN).toISOString(),
      pushChannel: 'stale',
    });
    expect(s.key).toBe('content-behind');
  });

  it('content-behind beats re-pair — the fixable-from-here fact wins', () => {
    const s = status({
      pendingRefreshAt: new Date(NOW - 3 * MIN).toISOString(),
      authState: 'REPAIR_REQUIRED',
    });
    expect(s.key).toBe('content-behind');
  });

  it('push-delayed beats re-pair', () => {
    const s = status({ pushChannel: 'stale', authState: 'REPAIR_REQUIRED' });
    expect(s.key).toBe('push-delayed');
  });

  it('STATUS_ORDER has no duplicates and every key is reachable in the rank map', () => {
    expect(new Set(STATUS_ORDER).size).toBe(STATUS_ORDER.length);
  });
});

describe('fail-closed rules (§3.5 / §13)', () => {
  it('no deployed SHA grades content unknown — never an accusation', () => {
    const s = deriveScreenStatus({ screen: scr({ lastBundleSha: 'whatever0000' }), deployedSha: null, now: NOW });
    expect(s.key).toBe('current');
  });

  it('a future timestamp yields no age rather than a negative one', () => {
    expect(compactAge(NOW + 5 * MIN, NOW)).toBeUndefined();
  });

  it('an offline screen reports content as Not reported, never confirmed', () => {
    const r = deriveReportedContent(scr({ status: 'OFFLINE' }), SHA, NOW);
    expect(r.state).toBe('unknown');
    expect(r.line).toBe('Not reported');
  });

  it('a screen that never reported a bundle SHA is unknown, not confirmed', () => {
    const r = deriveReportedContent(scr({ lastBundleSha: null }), SHA, NOW);
    expect(r.state).toBe('unknown');
  });
});

/**
 * ── THE 2026-09-21 PER-SCREEN SYMPTOM ────────────────────────────────────
 * Greg: "why does every screen say resync on it…our app needs to self heal."
 *
 * Every row wore "Updating soon · Resync" forever after any commit that left
 * the client bundle untouched — the deployed SHA moved, the player (correctly)
 * did not reload, and the SHA comparison had no way to tell the difference.
 * Resync could never clear it: the screen reloads the identical bundle and
 * reports the identical SHA.
 */
describe('screenOps — graded on the identity the player RELOADS on', () => {
  const BUNDLE = '1f2e3d4c5b6a';
  const OTHER_BUNDLE = '9988776655ff';

  it('THE BUG: different SHA, SAME bundleId → current, no Resync ask', () => {
    const s = deriveScreenStatus({
      screen: scr({ lastBundleSha: 'oldsha000000', lastBundleId: BUNDLE }),
      deployedSha: SHA,
      deployedBundleId: BUNDLE,
      now: NOW,
    });
    expect(s.key).toBe('current');
    expect(s.key).not.toBe('app-updating');
    expect(s.needsAttention).toBe(false);
  });

  it('…and the reported-content line stops saying "Older app version"', () => {
    const r = deriveReportedContent(
      scr({ lastBundleSha: 'oldsha000000', lastBundleId: BUNDLE }),
      SHA,
      NOW,
      BUNDLE,
    );
    expect(r.state).toBe('confirmed');
    expect(r.line).toBe('On the published version');
  });

  it('a screen genuinely on an older BUNDLE still reads Updating itself — and asks for nothing', () => {
    // The calm self-healing state must survive — silent would hide a panel
    // actually stuck on old code.
    const s = deriveScreenStatus({
      screen: scr({ lastBundleSha: SHA, lastBundleId: OTHER_BUNDLE }),
      deployedSha: SHA, // SHAs agree; only the bundle moved
      deployedBundleId: BUNDLE,
      now: NOW,
    });
    expect(s.key).toBe('app-updating');
    expect(s.label).toBe('Updating itself');
    expect(s.needsAttention).toBe(false);
    expect(s.action).toBe('View'); // no Resync button: it reloads on its own
  });

  it('an unacked push still outranks a matching bundleId', () => {
    const s = deriveScreenStatus({
      screen: scr({
        lastBundleSha: 'oldsha000000',
        lastBundleId: BUNDLE,
        pendingRefreshAt: new Date(NOW - 18 * MIN).toISOString(),
      }),
      deployedSha: SHA,
      deployedBundleId: BUNDLE,
      now: NOW,
    });
    expect(s.key).toBe('content-behind');
    expect(s.evidence).toBe('Reported: update not confirmed');
  });

  it('no deployed bundleId → falls back to the SHA, unchanged behaviour', () => {
    const s = deriveScreenStatus({
      screen: scr({ lastBundleSha: 'oldsha000000', lastBundleId: BUNDLE }),
      deployedSha: SHA,
      deployedBundleId: null,
      now: NOW,
    });
    expect(s.key).toBe('app-updating');
  });

  it('buildScreenOps threads it through: a whole list stops asking for Resync', () => {
    const ops = buildScreenOps({
      screens: [
        scr({ id: 'a', lastBundleSha: 'oldsha000000', lastBundleId: BUNDLE }),
        scr({ id: 'b', lastBundleSha: 'oldsha000000', lastBundleId: BUNDLE }),
        scr({ id: 'c', lastBundleSha: 'oldsha000000', lastBundleId: BUNDLE }),
      ],
      schedules: [],
      playlists: [],
      deployedSha: SHA,
      deployedBundleId: BUNDLE,
      now: NOW,
    });
    const rows = ops.groups.flatMap((g) => g.rows);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status.key === 'current')).toBe(true);
    expect(rows.some((r) => r.status.key === 'app-updating')).toBe(false);
    expect(ops.totals.attention).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// §10 — content comparison, evidence chain, recovery
// ═══════════════════════════════════════════════════════════════════

describe('deriveExpectedContent — mirrors the API winner rule', () => {
  const playlists: OpsPlaylist[] = [
    { id: 'pl-a', name: 'Summer Strength', items: [{ asset: { fileUrl: '/a.png', mimeType: 'image/png' } }] },
    { id: 'pl-b', name: 'Lobby Loop', items: [{ asset: { fileUrl: '/b.mp4', mimeType: 'video/mp4' } }] },
  ];
  const byId = new Map(playlists.map((p) => [p.id, p]));

  const sched = (over: Partial<OpsSchedule>): OpsSchedule => ({
    id: 'sc',
    playlistId: 'pl-a',
    isActive: true,
    mode: 'replace',
    priority: 0,
    startTime: new Date(NOW - 3600_000).toISOString(),
    playlist: { id: 'pl-a', name: 'Summer Strength' },
    ...over,
  });

  it('screen-pinned beats group-targeted', () => {
    const screen = scr({ screenGroupId: 'grp-1' });
    const out = deriveExpectedContent(
      screen,
      [
        sched({ id: 's-group', screenGroupId: 'grp-1', playlistId: 'pl-b', playlist: { id: 'pl-b', name: 'Lobby Loop' } }),
        sched({ id: 's-pin', screenId: screen.id }),
      ],
      byId,
      NOW,
    );
    expect(out.name).toBe('Summer Strength');
    expect(out.viaGroup).toBe(false);
    expect(out.thumbnailUrl).toBe('/a.png');
  });

  it('falls back to the group schedule and says so', () => {
    const screen = scr({ screenGroupId: 'grp-1' });
    const out = deriveExpectedContent(screen, [sched({ id: 's-group', screenGroupId: 'grp-1' })], byId, NOW);
    expect(out.name).toBe('Summer Strength');
    expect(out.viaGroup).toBe(true);
  });

  // Superseded 2026-09-01. This used to assert a video-only playlist yielded
  // NOTHING — the point being that it must never borrow some other item's
  // still. That intent is intact: it now yields the VIDEO'S OWN first frame,
  // marked `frame` so the UI decodes it as video rather than claiming it is a
  // slide. The operator's report was that these rows drew a blank grey box.
  it('a video-only playlist previews the video itself, never a borrowed still', () => {
    const screen = scr({});
    const out = deriveExpectedContent(
      screen,
      [sched({ screenId: screen.id, playlistId: 'pl-b', playlist: { id: 'pl-b', name: 'Lobby Loop' } })],
      byId,
      NOW,
    );
    expect(out.thumbnailUrl).toBe('/b.mp4');
    expect(out.thumbnailKind).toBe('frame');
  });

  it('a closed day/time window is reported, not hidden', () => {
    const screen = scr({});
    const out = deriveExpectedContent(
      screen,
      [sched({ screenId: screen.id, daysOfWeek: 'Mon', timeStart: '01:00', timeEnd: '02:00' })],
      byId,
      NOW,
    );
    expect(out.windowClosed).toBe(true);
  });

  it('no schedule at all → nothing scheduled', () => {
    expect(deriveExpectedContent(scr({}), [], byId, NOW).name).toBeNull();
  });

  it('inactive schedules never win', () => {
    const screen = scr({});
    const out = deriveExpectedContent(screen, [sched({ screenId: screen.id, isActive: false })], byId, NOW);
    expect(out.name).toBeNull();
  });
});

describe('deriveEvidenceChain — three steps, Downloaded deliberately absent', () => {
  it('never emits a Downloaded step (no per-deployment download milestone exists)', () => {
    const screen = scr();
    const chain = deriveEvidenceChain(screen, status(), NOW);
    expect(chain.map((s) => s.key)).toEqual(['sent', 'rendered', 'physical']);
  });

  it('Physical display is always not-instrumented', () => {
    const chain = deriveEvidenceChain(scr(), status(), NOW);
    expect(chain[2].state).toBe('not-instrumented');
    expect(chain[2].note).toContain('Not instrumented');
  });

  it('Rendered is green only for an earned green status', () => {
    expect(deriveEvidenceChain(scr(), status(), NOW)[1].state).toBe('ok');
  });

  it('an outstanding update marks Sent green and Rendered pending', () => {
    const over = { pendingRefreshAt: new Date(NOW - 4 * MIN).toISOString() };
    const chain = deriveEvidenceChain(scr(over), status(over), NOW);
    expect(chain[0].state).toBe('ok');
    expect(chain[1].state).toBe('pending');
  });

  it('an offline screen proves nothing — Rendered is unknown, never red-by-assumption', () => {
    const over = { status: 'OFFLINE', lastPingAt: new Date(NOW - 20 * MIN).toISOString() };
    const chain = deriveEvidenceChain(scr(over), status(over), NOW);
    expect(chain[1].state).toBe('unknown');
  });
});

describe('deriveRecovery — states come from events, never from a timer', () => {
  it('renders nothing when no command is in flight', () => {
    expect(
      deriveRecovery({ screen: scr(), status: status(), sending: false, justSent: false, now: NOW }),
    ).toBeNull();
  });

  it('an outstanding pendingRefreshAt is "waiting for the screen to confirm"', () => {
    const over = { pendingRefreshAt: new Date(NOW - 2 * MIN).toISOString() };
    const card = deriveRecovery({
      screen: scr(over), status: status(over), sending: false, justSent: false, now: NOW,
    })!;
    expect(card.state).toBe('waiting-ack');
    expect(card.body).toContain('2 minutes');
    // Never claims the player fetched anything it did not report.
    expect(card.body).not.toMatch(/fetched/i);
  });

  it('an ack alone is not recovery — a picture confirmation completes it', () => {
    const stale = { renderHealth: 'STALE' as const, renderStale: true, lastRenderedAt: new Date(NOW - 30 * MIN).toISOString() };
    const waiting = deriveRecovery({
      screen: scr(stale), status: status(stale), sending: false, justSent: false, ackedAtMs: NOW - MIN, now: NOW,
    })!;
    expect(waiting.state).toBe('waiting-render');

    const done = deriveRecovery({
      screen: scr(), status: status(), sending: false, justSent: false, ackedAtMs: NOW - MIN, now: NOW,
    })!;
    expect(done.state).toBe('recovered');
  });
});

// ═══════════════════════════════════════════════════════════════════
// §6 / §7 / §8 — the strip, the chips, the grouping
// ═══════════════════════════════════════════════════════════════════

describe('buildScreenOps', () => {
  const fleet = (): OpsScreen[] => [
    scr({ id: 'g43', name: 'G43', screenGroupId: 'sac', screenGroup: { id: 'sac', name: 'RIOT Sacramento' }, pendingRefreshAt: new Date(NOW - 18 * MIN).toISOString() }),
    scr({ id: 'm43', name: 'M43', screenGroupId: 'sac', screenGroup: { id: 'sac', name: 'RIOT Sacramento' }, pushChannel: 'stale', lastPushConnectedAt: new Date(NOW - 42 * MIN).toISOString() }),
    scr({ id: 'aframe', name: 'Mobile A-Frame', screenGroupId: 'sac', screenGroup: { id: 'sac', name: 'RIOT Sacramento' } }),
    scr({ id: 'hen1', name: 'Henderson Lobby', screenGroupId: 'hen', screenGroup: { id: 'hen', name: 'RIOT Henderson' } }),
    scr({ id: 'hen2', name: 'Henderson Cardio', screenGroupId: 'hen', screenGroup: { id: 'hen', name: 'RIOT Henderson' } }),
    scr({ id: 'loose', name: 'Back Office', screenGroupId: null, screenGroup: null, status: 'OFFLINE', lastPingAt: new Date(NOW - 3 * 3600_000).toISOString() }),
  ];

  const build = (over: Partial<Parameters<typeof buildScreenOps>[0]> = {}) =>
    buildScreenOps({
      screens: fleet(), schedules: [], playlists: [], deployedSha: SHA, now: NOW, ...over,
    });

  it('sorts worst-first across the whole fleet', () => {
    expect(build().rows.map((r) => r.status.key)).toEqual([
      'offline', 'content-behind', 'push-delayed', 'current', 'current', 'current',
    ]);
  });

  it('every group with a screen starts EXPANDED; an empty group has nothing to open (2026-09-14)', () => {
    // Greg, once each group became its own card: "expand the ones that have
    // screens in them and keep the others closed by default".
    const ops = build();
    for (const g of ops.groups) expect(ops.autoExpanded.has(g.id)).toBe(g.rows.length > 0);
    expect(ops.autoExpanded.size).toBe(ops.groups.filter((g) => g.rows.length > 0).length);
  });

  it('keeps the selected screen’s group expanded even when healthy', () => {
    expect(build({ selectedScreenId: 'hen1' }).autoExpanded.has('hen')).toBe(true);
  });

  it('orders groups worst-first and parks the ungrouped bucket among equals', () => {
    expect(build().groups.map((g) => g.id)).toEqual([UNGROUPED_ID, 'sac', 'hen']);
  });

  it('a healthy group carries one quiet summary', () => {
    const hen = build().groups.find((g) => g.id === 'hen')!;
    expect(hen.summary).toBe('All screens current');
    expect(hen.attention).toBe(0);
  });

  it('counts Need action as unique screens, not the sum of problem types', () => {
    // g43 is behind AND on a healthy push; m43 is push-delayed; loose is
    // offline. Three screens, three problems, one count each.
    const ops = build();
    expect(ops.totals.attention).toBe(3);
    expect(ops.chips.find((c) => c.key === 'attention')!.count).toBe(3);
  });

  it('emits an All chip so there is always a path back to the full fleet', () => {
    expect(build().chips.map((c) => c.key)).toEqual([
      'all', 'attention', 'content-behind', 'push-delayed', 'offline',
    ]);
    expect(build().chips[0].count).toBe(6);
  });

  it('chip counts match the rows each chip actually shows', () => {
    const ops = build();
    for (const chip of ops.chips) {
      expect(ops.rows.filter((r) => matchesFilter(r, chip.key)).length).toBe(chip.count);
    }
  });

  it('search matches name, group and model', () => {
    const ops = build();
    const g43 = ops.rows.find((r) => r.screen.id === 'g43')!;
    expect(matchesQuery(g43, 'g4')).toBe(true);
    expect(matchesQuery(g43, 'sacramento')).toBe(true);
    expect(matchesQuery(g43, 'henderson')).toBe(false);
    expect(matchesQuery(g43, '')).toBe(true);
  });

  it('an empty fleet reports unknown, not a green zero', () => {
    const ops = buildScreenOps({
      screens: [], schedules: [], playlists: [], deployedSha: SHA, now: NOW,
    });
    expect(ops.rows).toHaveLength(0);
    expect(ops.totals).toEqual({ screens: 0, online: 0, attention: 0 });
    expect(ops.chips.every((c) => c.count === 0)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// previewOf — "everything should preview" (operator, 2026-09-01)
//
// The report: on the Screens page only image playlists drew a thumbnail; a
// playlist that IS a board, or that holds only video, drew a blank grey box.
// Measured on the fleet that day: 42 playlists previewed, 49 did not.
// ═══════════════════════════════════════════════════════════════════
describe('previewOf — the expected picture of a playlist', () => {
  const boardZones = [
    { widgetType: 'EXTERNAL_HTML', defaultConfig: { url: '/templates/signage/gym/leaderboard.html' } },
  ];

  it('prefers the playlist own still over the board it is laid onto', () => {
    const out = previewOf({
      id: 'p', items: [{ asset: { fileUrl: '/a.png', mimeType: 'image/png' } }],
      template: { id: 't', zones: boardZones },
    });
    expect(out).toEqual({ url: '/a.png', kind: 'still', tint: null });
  });

  it('previews a video-only playlist with the video first frame', () => {
    const out = previewOf({ id: 'p', items: [{ asset: { fileUrl: '/clip.mp4', mimeType: 'video/mp4' } }] });
    expect(out).toEqual({ url: '/clip.mp4', kind: 'frame', tint: null });
  });

  it('previews a board-backed playlist that has no items of its own', () => {
    // Exactly the operator's LED posters row: 0 items, one EXTERNAL_HTML board.
    const out = previewOf({ id: 'p', items: [], template: { id: 't', zones: boardZones } });
    expect(out.kind).toBe('board');
    expect(out.url).toContain('/templates/_thumbs/signage/gym/leaderboard.png');
  });

  it('previews a customized board too — a blank box is worse than the pristine look', () => {
    const out = previewOf({
      id: 'p', items: [],
      template: { id: 't', zones: [{ widgetType: 'EXTERNAL_HTML', defaultConfig: { url: '/templates/hs/a.html', brand: { primary: '#f00' } } }] },
    });
    expect(out.kind).toBe('board');
  });

  it('falls back to the template own background when no poster exists', () => {
    const out = previewOf({
      id: 'p', items: [],
      template: { id: 't', zones: [{ widgetType: 'CLOCK' }], bgGradient: 'linear-gradient(#fff,#000)' },
    });
    expect(out).toEqual({ url: null, kind: 'tint', tint: 'linear-gradient(#fff,#000)' });
  });

  it('wraps a bare background image url so it is usable as a CSS value', () => {
    const out = previewOf({ id: 'p', items: [], template: { id: 't', zones: [], bgImage: 'https://cdn/x.jpg' } });
    expect(out).toEqual({ url: null, kind: 'tint', tint: 'url(https://cdn/x.jpg)' });
  });

  it('says none when there is genuinely nothing — never invents a picture', () => {
    expect(previewOf({ id: 'p', items: [] })).toEqual({ url: null, kind: 'none', tint: null });
    expect(previewOf(undefined)).toEqual({ url: null, kind: 'none', tint: null });
  });

  it('ignores a non-media item rather than linking a pdf as an image', () => {
    const out = previewOf({ id: 'p', items: [{ asset: { fileUrl: '/menu.pdf', mimeType: 'application/pdf' } }] });
    expect(out.kind).toBe('none');
  });
});


// ─── Frame-lock status (ported from the classic row chip, 2026-09-14) ──────
describe('syncStatusFor — synced playback, as the player reports it (gated on the screen since 2026-09-16)', () => {
  const T = Date.UTC(2026, 8, 14, 12, 0, 0);
  const inGroup = (over: Record<string, unknown> = {}) => ({
    // 2026-09-16 — `syncActive` is the server's per-screen answer, derived from
    // the PLAYLIST's "keep screens in sync". The group's syncMode is retired.
    id: 'a', name: 'A', status: 'ONLINE', screenGroupId: 'g', screenGroup: { id: 'g', name: 'Lobby' },
    syncActive: true,
    lastSyncReportAt: new Date(T - 10_000).toISOString(),
    lastSyncReport: { locked: true, errMs: 6, clockUncertaintyMs: 4, rttMs: 30, contentSig: 'x' },
    ...over,
  }) as any;
  it('is null unless the screen is frame-locked and online', () => {
    expect(syncStatusFor(inGroup({ syncActive: false }), [], T)).toBeNull();
    expect(syncStatusFor(inGroup({ syncActive: undefined }), [], T)).toBeNull();
    expect(syncStatusFor(inGroup({ status: 'OFFLINE' }), [], T)).toBeNull();
  });
  it('reads the screen, not its group — a locked group no longer drives the chip (2026-09-16)', () => {
    // The whole point of the move: a group holds several playlists, so it can
    // be part-synced. Only the server's per-screen verdict may light this up.
    const groupSaysLocked = inGroup({ syncActive: false, screenGroup: { id: 'g', name: 'Lobby', syncMode: 'locked' } });
    expect(syncStatusFor(groupSaysLocked, [], T)).toBeNull();
  });
  it('locked with a fresh report → clock agreement in ms, jittery when the network is the problem', () => {
    expect(syncStatusFor(inGroup(), [], T)).toEqual({ kind: 'locked', ms: 6, jittery: false, detail: 'flip 6ms · clock ±4ms · rtt 30ms' });
    expect(syncStatusFor(inGroup({ lastSyncReport: { locked: true, errMs: 3, clockUncertaintyMs: 40, rttMs: 200, contentSig: 'x' } }), [], T)).toMatchObject({ kind: 'locked', ms: 40, jittery: true });
  });
  it('a stale or missing report → still locking', () => {
    expect(syncStatusFor(inGroup({ lastSyncReportAt: new Date(T - 10 * 60_000).toISOString() }), [], T)).toEqual({ kind: 'locking' });
    expect(syncStatusFor(inGroup({ lastSyncReport: null }), [], T)).toEqual({ kind: 'locking' });
  });
  it('a screen playing different content than its group → diverged, never "locked"', () => {
    const me = inGroup({ lastSyncReport: { locked: true, errMs: 1, clockUncertaintyMs: 1, rttMs: 20, contentSig: 'mine' } });
    const sib = (id: string) => inGroup({ id, lastSyncReport: { locked: true, contentSig: 'theirs' } });
    expect(syncStatusFor(me, [me, sib('b'), sib('c')], T)).toEqual({ kind: 'diverged' });
  });
});
