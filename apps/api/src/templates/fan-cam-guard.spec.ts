/**
 * K-12 sports launch, lane B3, leftover (b) — a Fan Cam may not ask for a
 * kiss where students are on screen; everywhere else the operator's words
 * stand. The rule's word list is tested in packages/api-types/src/fan-cam.spec.ts;
 * this is who it applies to, and what a refused save says.
 */
import { HttpException } from '@nestjs/common';
import {
  FAN_CAM_TITLE_NOT_SCHOOL_SAFE,
  FAN_CAM_VARIANT_ID,
} from '@cms/api-types';
import { assertFanCamTextSchoolSafe } from './fan-cam-guard';
import type { StudentPrivacyDb } from '../sports/student-privacy';

type TenantRow = {
  id: string;
  name: string;
  vertical: string | null;
  parentId: string | null;
};

function db(
  tenants: TenantRow[],
  policies: Array<Record<string, unknown>> = [],
  fail = false,
) {
  const byId = new Map(tenants.map((t) => [t.id, t]));
  const findUnique = jest.fn(({ where }: { where: { id: string } }) =>
    fail
      ? Promise.reject(new Error('database unreachable'))
      : Promise.resolve(byId.get(where.id) ?? null),
  );
  const findMany = jest.fn(() => Promise.resolve(policies));
  return {
    db: {
      tenant: { findUnique },
      studentPrivacyPolicy: { findMany },
    } as unknown as StudentPrivacyDb,
    findUnique,
  };
}

const zone = (cfg: Record<string, unknown>) => ({
  defaultConfig: { variant: FAN_CAM_VARIANT_ID, ...cfg },
});

async function refusal(
  p: Promise<void>,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    const h = e as HttpException;
    return {
      status: h.getStatus(),
      body: h.getResponse() as Record<string, unknown>,
    };
  }
}

describe('assertFanCamTextSchoolSafe', () => {
  const school = {
    id: 's1',
    name: 'Eastview High',
    vertical: 'K12',
    parentId: null,
  };

  it('a school cannot save a KISS CAM: 400 with a code the builder translates and the words it refused', async () => {
    const { db: d } = db([school]);
    const r = await refusal(
      assertFanCamTextSchoolSafe(d, 's1', [
        zone({ kind: 'KISS CAM', sponsor: 'PRESENTED BY THE PTA' }),
      ]),
    );
    expect(r?.status).toBe(400);
    expect(r?.body.code).toBe(FAN_CAM_TITLE_NOT_SCHOOL_SAFE);
    expect(r?.body.titles).toEqual(['KISS CAM']);
    expect(String(r?.body.message)).toMatch(/school-safe/i);
  });

  it('…nor hide it in the sponsor line', async () => {
    const { db: d } = db([school]);
    const r = await refusal(
      assertFanCamTextSchoolSafe(d, 's1', [
        zone({ kind: 'FAN CAM', sponsor: 'SMOOCH TIME BROUGHT TO YOU BY…' }),
      ]),
    );
    expect(r?.body.titles).toEqual(['SMOOCH TIME BROUGHT TO YOU BY…']);
  });

  it('a school under a K-12 district is covered by the district', async () => {
    const { db: d } = db([
      { id: 's2', name: 'Westfield Middle', vertical: null, parentId: 'd1' },
      { id: 'd1', name: 'Unified District', vertical: 'K12', parentId: null },
    ]);
    expect(
      (
        await refusal(
          assertFanCamTextSchoolSafe(d, 's2', [zone({ kind: 'Kiss Cam' })]),
        )
      )?.status,
    ).toBe(400);
  });

  it('a version snapshot (config stored as JSON text) is refused the same way', async () => {
    const { db: d } = db([school]);
    const r = await refusal(
      assertFanCamTextSchoolSafe(d, 's1', [
        {
          defaultConfig: JSON.stringify({
            variant: FAN_CAM_VARIANT_ID,
            kind: 'KISS CAM',
          }),
        },
      ]),
    );
    expect(r?.status).toBe(400);
  });

  it('school-safe words save, and never cost a database read', async () => {
    const { db: d, findUnique } = db([school]);
    await expect(
      assertFanCamTextSchoolSafe(d, 's1', [
        zone({ kind: 'SPIRIT CAM', sponsor: 'PRESENTED BY THE PTA' }),
      ]),
    ).resolves.toBeUndefined();
    await expect(
      assertFanCamTextSchoolSafe(d, 's1', [
        { defaultConfig: { variant: 'ribbon-sponsor', kind: 'KISS CAM' } },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      assertFanCamTextSchoolSafe(d, 's1', undefined),
    ).resolves.toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('a pro venue keeps its Kiss Cam (other verticals are unchanged)', async () => {
    const { db: d } = db([
      { id: 'v1', name: 'Arena', vertical: 'SPORTS', parentId: null },
    ]);
    await expect(
      assertFanCamTextSchoolSafe(d, 'v1', [zone({ kind: 'KISS CAM' })]),
    ).resolves.toBeUndefined();
  });

  it('a venue that says its athletes include minors is treated like a school', async () => {
    const { db: d } = db(
      [{ id: 'v2', name: 'Youth League', vertical: 'SPORTS', parentId: null }],
      [{ tenantId: 'v2', servesMinors: true }],
    );
    expect(
      (
        await refusal(
          assertFanCamTextSchoolSafe(d, 'v2', [zone({ kind: 'KISS CAM' })]),
        )
      )?.status,
    ).toBe(400);
  });

  it('when the location cannot be read, the save is refused (fail closed)', async () => {
    const { db: d } = db([], [], true);
    expect(
      (
        await refusal(
          assertFanCamTextSchoolSafe(d, 'v1', [zone({ kind: 'KISS CAM' })]),
        )
      )?.status,
    ).toBe(400);
  });
});
