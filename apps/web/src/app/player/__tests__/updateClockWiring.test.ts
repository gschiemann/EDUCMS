/**
 * Source guard for the update-window clock wiring in player/page.tsx (2026-11-14).
 * The page is too large to mount; the pure halves are tested in
 * offHoursUpdate.test.ts and updateClock.test.ts. Same pattern as pushGate.test.ts.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const page = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8');
const effect = page.slice(
  page.indexOf('const clockRelearn = createClockRelearnState();'),
  page.indexOf("const sameOriginBuildInfoUrl = '/api/build-info?playerPolicy=idle';"),
);

describe('update window ↔ server clock wiring', () => {
  it('every assignment of the offset from a real server time also records the measurement', () => {
    const sites = page.split('serverClockOffsetRef.current = ').length - 1;
    expect(sites).toBe(3); // stale-drop re-learn, SSE AUTH_OK, WS AUTH_OK — the update path never moves it
    let at = -1;
    for (let i = 0; i < sites; i++) {
      at = page.indexOf('serverClockOffsetRef.current = ', at + 1);
      expect(page.slice(at, at + 140)).toContain('noteServerClockMeasured(');
    }
  });

  it('the decision reads the clock sample, never a bare offset ref', () => {
    expect(effect.length).toBeGreaterThan(1000);
    expect(effect).toContain('readUpdateClock(serverClockSampleRef.current, Date.now(), performance.now())');
    expect(effect).toMatch(/decideUpdateApply\(\{[\s\S]*?\bclock,/);
    expect(effect).not.toContain('serverClockOffsetRef');
  });

  it('applyUpdate re-decides at the boundary and again right before the reload, and gives a declined boundary back', () => {
    const body = effect.slice(effect.indexOf('const applyUpdate = ('), effect.indexOf('const evaluate = () =>'));
    const gate = body.indexOf('const gate = decide(p, clock).decision;');
    const last = body.indexOf('const last = decide(p, readClock()).decision;');
    const reload = body.indexOf('hardCacheBustingReload();');
    expect(gate).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(gate);
    expect(reload).toBeGreaterThan(last);
    expect(body.slice(gate, body.indexOf('updateApplyingRef.current = true;'))).toContain('return false;');
    expect(body).toContain('...clockEvidence(clock),');
    expect(page).toContain('return fn() === true;');
    expect(effect).toContain("updateAtBoundaryRef.current = () => applyUpdate(windowKind, 'item');");
  });

  it('an unverified clock asks for a bounded re-measure, not a loop', () => {
    expect(effect).toContain("if (decision.reason === 'clock-unverified') relearnClockIfDue();");
    expect(effect).toContain('planClockRelearn(clockRelearn, performance.now(), Date.now())');
    expect(effect).toContain('relearnServerClockOffset({ apiRoot: getApiRoot() })');
  });
});
