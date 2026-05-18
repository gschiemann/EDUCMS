import {
  ScreenGroupCreateSchema,
  ScreenGroupUpdateSchema,
  ScreenGroupAssignScreensSchema,
  SubmissionCreateSchema,
  SubmissionDecisionSchema,
} from '@cms/api-types';

/**
 * Boundary validation for the screen-group and submission (reviewer
 * workflow) endpoints. `.passthrough()` schemas — bound + type the
 * known fields, never reject an unexpected key.
 */
describe('screen-group & submission request schemas', () => {
  describe('ScreenGroupCreateSchema', () => {
    it('accepts a name, with optional description', () => {
      expect(ScreenGroupCreateSchema.safeParse({ name: 'Hallway A' }).success).toBe(true);
      expect(ScreenGroupCreateSchema.safeParse({ name: 'Hallway A', description: 'East wing' }).success).toBe(true);
    });

    it('rejects a non-string or missing name; passes unknown keys through', () => {
      expect(ScreenGroupCreateSchema.safeParse({ name: 7 }).success).toBe(false);
      expect(ScreenGroupCreateSchema.safeParse({}).success).toBe(false);
      expect(ScreenGroupCreateSchema.safeParse({ name: 'X', futureField: true }).success).toBe(true);
    });
  });

  describe('ScreenGroupUpdateSchema', () => {
    it('accepts an empty or partial patch', () => {
      expect(ScreenGroupUpdateSchema.safeParse({}).success).toBe(true);
      expect(ScreenGroupUpdateSchema.safeParse({ description: 'updated' }).success).toBe(true);
    });
  });

  describe('ScreenGroupAssignScreensSchema', () => {
    it('requires a screenIds array (empty allowed = clear the group)', () => {
      expect(ScreenGroupAssignScreensSchema.safeParse({ screenIds: ['s1', 's2'] }).success).toBe(true);
      expect(ScreenGroupAssignScreensSchema.safeParse({ screenIds: [] }).success).toBe(true);
    });

    it('rejects a missing or non-array screenIds — guards the assign-all bug', () => {
      expect(ScreenGroupAssignScreensSchema.safeParse({}).success).toBe(false);
      expect(ScreenGroupAssignScreensSchema.safeParse({ screenIds: 'all' }).success).toBe(false);
    });
  });

  describe('SubmissionCreateSchema', () => {
    it('accepts an empty body and a fully-populated one', () => {
      // The "at least one item" rule stays in the controller.
      expect(SubmissionCreateSchema.safeParse({}).success).toBe(true);
      expect(
        SubmissionCreateSchema.safeParse({
          note: 'Please review',
          notifyUserIds: ['u1'],
          assetIds: ['a1', 'a2'],
          playlistIds: ['p1'],
          scheduleIds: [],
        }).success,
      ).toBe(true);
    });

    it('rejects a non-array id field', () => {
      expect(SubmissionCreateSchema.safeParse({ assetIds: 'a1' }).success).toBe(false);
    });
  });

  describe('SubmissionDecisionSchema', () => {
    it('accepts an empty body or a reviewer note, rejects an over-long note', () => {
      expect(SubmissionDecisionSchema.safeParse({}).success).toBe(true);
      expect(SubmissionDecisionSchema.safeParse({ reviewerNote: 'Looks good' }).success).toBe(true);
      expect(SubmissionDecisionSchema.safeParse({ reviewerNote: 'x'.repeat(5001) }).success).toBe(false);
    });
  });
});
