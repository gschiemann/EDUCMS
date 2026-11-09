import {
  MANAGER_LEGACY_LANE_ENV,
  installViaPlayerAnswer,
  legacyWorkerWouldDownload,
  managerLaneMode,
} from './manager-update-lane';

describe('the Manager self-update lane (one release unit, 2026-11-08)', () => {
  it('is retired by default: unset, blank, or anything but `on`', () => {
    expect(managerLaneMode({})).toBe('player');
    expect(managerLaneMode({ [MANAGER_LEGACY_LANE_ENV]: '' })).toBe('player');
    expect(managerLaneMode({ [MANAGER_LEGACY_LANE_ENV]: 'true' })).toBe('player');
    expect(managerLaneMode({ [MANAGER_LEGACY_LANE_ENV]: '1' })).toBe('player');
    expect(managerLaneMode({ [MANAGER_LEGACY_LANE_ENV]: 'off' })).toBe('player');
    expect(managerLaneMode({ [MANAGER_LEGACY_LANE_ENV]: 'github' })).toBe('player');
  });

  it('re-opens the legacy GitHub lane only on exactly `on`', () => {
    expect(managerLaneMode({ [MANAGER_LEGACY_LANE_ENV]: 'on' })).toBe('legacy-github');
    expect(managerLaneMode({ [MANAGER_LEGACY_LANE_ENV]: ' ON ' })).toBe('legacy-github');
  });

  describe('back-compat with the deployed Manager 1.0.24 worker', () => {
    // ManagerSelfUpdateWorker (1.0.24): `resp.optJSONObject("latest") == null`
    // → "up to date", exit; otherwise download only when latest.versionCode >
    // its own 10024.
    const CALLER_1_0_24 = 10024;

    it('the retired answer carries no `latest`, so 1.0.24 exits before any fetch', () => {
      const answer = installViaPlayerAnswer();
      expect(answer).toEqual({ uptoDate: true, installVia: 'player' });
      expect('latest' in answer).toBe(false);
      expect(legacyWorkerWouldDownload(answer, CALLER_1_0_24)).toBe(false);
    });

    it('a legacy offer at or below the caller never downloads either', () => {
      expect(legacyWorkerWouldDownload({ latest: { versionCode: 10024 } }, CALLER_1_0_24)).toBe(false);
      expect(legacyWorkerWouldDownload({ latest: { versionCode: 10000 } }, CALLER_1_0_24)).toBe(false);
    });

    it('only a newer legacy offer would make 1.0.24 download — the lane the switch guards', () => {
      expect(legacyWorkerWouldDownload({ latest: { versionCode: 10129 } }, CALLER_1_0_24)).toBe(true);
    });

    it('a malformed answer never downloads', () => {
      expect(legacyWorkerWouldDownload(null, CALLER_1_0_24)).toBe(false);
      expect(legacyWorkerWouldDownload({ latest: null }, CALLER_1_0_24)).toBe(false);
      expect(legacyWorkerWouldDownload({ latest: { versionCode: 'x' } }, CALLER_1_0_24)).toBe(false);
    });
  });
});
