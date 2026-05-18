import {
  PlaylistCreateSchema,
  PlaylistUpdateSchema,
  PlaylistReorderItemsSchema,
  PlaylistSetActiveSchema,
  ScheduleCreateSchema,
  ScheduleUpdateSchema,
} from '@cms/api-types';

/**
 * Boundary validation for the playlist + schedule endpoints. Schemas
 * are `.passthrough()` — they type- and bound-check known fields but
 * never reject an extra key. Tenant ownership of every foreign id
 * stays enforced in the controllers.
 */
describe('playlist & schedule request schemas', () => {
  describe('PlaylistCreateSchema', () => {
    it('accepts a name; templateId is optional and may be empty', () => {
      expect(PlaylistCreateSchema.safeParse({ name: 'Morning Loop' }).success).toBe(true);
      expect(PlaylistCreateSchema.safeParse({ name: 'X', templateId: 'tmpl_123' }).success).toBe(true);
      expect(PlaylistCreateSchema.safeParse({ name: 'X', templateId: '' }).success).toBe(true);
    });

    it('passes unknown keys through', () => {
      expect(PlaylistCreateSchema.safeParse({ name: 'X', futureField: 1 }).success).toBe(true);
    });

    it('rejects a non-string, over-long, or missing name', () => {
      expect(PlaylistCreateSchema.safeParse({ name: 42 }).success).toBe(false);
      expect(PlaylistCreateSchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
      expect(PlaylistCreateSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('PlaylistUpdateSchema', () => {
    it('requires a name', () => {
      expect(PlaylistUpdateSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
      expect(PlaylistUpdateSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('PlaylistReorderItemsSchema', () => {
    const item = { assetId: 'asset_1', durationMs: 8000, sequenceOrder: 0 };

    it('accepts a well-formed (or empty) items array', () => {
      expect(PlaylistReorderItemsSchema.safeParse({ items: [item] }).success).toBe(true);
      expect(PlaylistReorderItemsSchema.safeParse({ items: [] }).success).toBe(true);
    });

    it('rejects an item missing assetId or with a non-numeric duration', () => {
      expect(PlaylistReorderItemsSchema.safeParse({ items: [{ durationMs: 1, sequenceOrder: 0 }] }).success).toBe(false);
      expect(PlaylistReorderItemsSchema.safeParse({ items: [{ ...item, durationMs: 'long' }] }).success).toBe(false);
    });

    it('rejects a non-array items field', () => {
      expect(PlaylistReorderItemsSchema.safeParse({ items: 'nope' }).success).toBe(false);
    });
  });

  describe('PlaylistSetActiveSchema', () => {
    it('requires a boolean active', () => {
      expect(PlaylistSetActiveSchema.safeParse({ active: true }).success).toBe(true);
      expect(PlaylistSetActiveSchema.safeParse({ active: 'true' }).success).toBe(false);
      expect(PlaylistSetActiveSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('ScheduleCreateSchema', () => {
    const base = { playlistId: 'pl_1', startTime: '2026-05-18T08:00:00Z' };

    it('accepts a minimal and a full body', () => {
      expect(ScheduleCreateSchema.safeParse(base).success).toBe(true);
      expect(
        ScheduleCreateSchema.safeParse({
          ...base,
          screenId: 'scr_1',
          endTime: '2026-05-18T15:00:00Z',
          daysOfWeek: 'Mon,Tue',
          timeStart: '08:00',
          timeEnd: '15:00',
          priority: 5,
          mode: 'replace',
          mutedOverride: null,
          isActive: false,
        }).success,
      ).toBe(true);
    });

    it('rejects a missing playlistId and an unknown mode', () => {
      expect(ScheduleCreateSchema.safeParse({ startTime: base.startTime }).success).toBe(false);
      expect(ScheduleCreateSchema.safeParse({ ...base, mode: 'sideways' }).success).toBe(false);
    });
  });

  describe('ScheduleUpdateSchema', () => {
    it('accepts an empty patch and a partial one (mutedOverride / daysOfWeek may be null)', () => {
      expect(ScheduleUpdateSchema.safeParse({}).success).toBe(true);
      expect(ScheduleUpdateSchema.safeParse({ priority: 3, mutedOverride: null }).success).toBe(true);
      expect(ScheduleUpdateSchema.safeParse({ daysOfWeek: null }).success).toBe(true);
    });
  });
});
