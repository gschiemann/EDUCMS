import {
  TemplateNameOnlySchema,
  TemplateSceneUpdateSchema,
  TemplateCreateSchema,
  TemplateGenerateTouchSchema,
  TemplateDuplicateSchema,
  TemplateUpdateSchema,
  TemplateReplaceZonesSchema,
} from '@cms/api-types';

/**
 * Boundary validation for the template-builder endpoints. `.passthrough()`
 * schemas — type + bound the known fields; zone defaultConfig / touchAction
 * are arbitrary widget JSON kept verbatim. validateZoneBounds() and the
 * brand-merge still run in the controller.
 */
describe('template request schemas', () => {
  const zone = { name: 'Header', widgetType: 'CLOCK', x: 0, y: 0, width: 50, height: 20 };

  describe('TemplateCreateSchema', () => {
    it('accepts a name-only body and one with zones', () => {
      expect(TemplateCreateSchema.safeParse({ name: 'Lobby Board' }).success).toBe(true);
      expect(TemplateCreateSchema.safeParse({ name: 'Lobby', zones: [zone] }).success).toBe(true);
    });

    it('keeps an arbitrary defaultConfig object on a zone', () => {
      const r = TemplateCreateSchema.safeParse({
        name: 'X',
        zones: [{ ...zone, defaultConfig: { fontSize: 48, nested: { a: 1 } } }],
      });
      expect(r.success).toBe(true);
    });

    it('rejects a missing or empty name, and a non-array zones', () => {
      expect(TemplateCreateSchema.safeParse({}).success).toBe(false);
      expect(TemplateCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
      expect(TemplateCreateSchema.safeParse({ name: 'X', zones: 'nope' }).success).toBe(false);
    });

    it('rejects a zone missing widgetType or with a non-numeric x', () => {
      expect(TemplateCreateSchema.safeParse({ name: 'X', zones: [{ name: 'Z', x: 0, y: 0, width: 1, height: 1 }] }).success).toBe(false);
      expect(TemplateCreateSchema.safeParse({ name: 'X', zones: [{ ...zone, x: 'left' }] }).success).toBe(false);
    });
  });

  describe('TemplateUpdateSchema', () => {
    it('accepts an empty patch; bg fields may be null', () => {
      expect(TemplateUpdateSchema.safeParse({}).success).toBe(true);
      expect(TemplateUpdateSchema.safeParse({ name: 'Renamed', bgColor: null, bgImage: null }).success).toBe(true);
    });

    it('rejects a non-string status', () => {
      expect(TemplateUpdateSchema.safeParse({ status: 123 }).success).toBe(false);
    });
  });

  describe('TemplateReplaceZonesSchema', () => {
    it('requires a zones array; touchAction / sceneId are allowed', () => {
      expect(TemplateReplaceZonesSchema.safeParse({ zones: [zone] }).success).toBe(true);
      expect(TemplateReplaceZonesSchema.safeParse({ zones: [] }).success).toBe(true);
      expect(
        TemplateReplaceZonesSchema.safeParse({ zones: [{ ...zone, touchAction: { kind: 'nav' }, sceneId: null }] }).success,
      ).toBe(true);
    });

    it('rejects a missing zones field', () => {
      expect(TemplateReplaceZonesSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('TemplateDuplicateSchema', () => {
    it('accepts an empty body and a canvas-override body', () => {
      expect(TemplateDuplicateSchema.safeParse({}).success).toBe(true);
      expect(TemplateDuplicateSchema.safeParse({ name: 'Copy', screenWidth: 1920, screenHeight: 1080 }).success).toBe(true);
    });
  });

  describe('TemplateGenerateTouchSchema', () => {
    it('requires a prompt string', () => {
      expect(TemplateGenerateTouchSchema.safeParse({ prompt: 'lobby kiosk' }).success).toBe(true);
      expect(TemplateGenerateTouchSchema.safeParse({}).success).toBe(false);
      expect(TemplateGenerateTouchSchema.safeParse({ prompt: 123 }).success).toBe(false);
    });
  });

  describe('TemplateNameOnlySchema / TemplateSceneUpdateSchema', () => {
    it('accept empty and partial bodies', () => {
      expect(TemplateNameOnlySchema.safeParse({}).success).toBe(true);
      expect(TemplateNameOnlySchema.safeParse({ name: 'Scene 2' }).success).toBe(true);
      expect(TemplateSceneUpdateSchema.safeParse({}).success).toBe(true);
      expect(TemplateSceneUpdateSchema.safeParse({ name: 'S', sortOrder: 2, isDefault: true }).success).toBe(true);
    });
  });
});
