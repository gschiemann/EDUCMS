/**
 * apply-brand-to-zone — pure helpers for the
 * `POST /api/v1/branding/apply-to-templates` endpoint.
 *
 * Splitting the per-zone + per-template patch logic out of the controller
 * so it's testable without spinning up Nest + Prisma. The controller
 * still owns the transaction + audit-log; this file owns the math.
 *
 * Modes (must mirror the controller's contract exactly):
 *   - 'fill-blanks' (default, safe): only set keys that are unset on
 *     the zone's defaultConfig. Won't override a template the operator
 *     already customized.
 *   - 'override' (bold): force the brand on every zone, replacing
 *     existing colors / fonts. Demo-friendly.
 *
 * The shape of the patch matches what `BuilderZone`'s scoped <style>
 * override reads at render time, so any text descendant inside the zone
 * inherits the brand:
 *   - cfg.color       → text color (paints via `var(--brand-ink, …)`
 *                       fallback chain in the renderer)
 *   - cfg.fontFamily  → heading font family
 *
 * fontBody is reserved for a future "apply body font separately"
 * toggle — kept out of the patch today so we don't blow away custom
 * fonts the operator picked per-zone.
 */

export type ApplyBrandMode = 'fill-blanks' | 'override';

export interface BrandInputs {
  /** Resolved ink color from the tenant palette (`palette.ink` or fallback). */
  ink: string;
  /** Resolved surface color (`palette.surface` or `palette.surfaceAlt` or fallback). */
  surface: string;
  /** Heading font family name (Google Font name when present, raw family otherwise). */
  fontHeading: string | null;
}

/** Zone shape we need — anything with a JSON-string `defaultConfig`. */
export interface ZoneInput {
  /** Raw defaultConfig blob from Prisma (string OR null OR JSON value). */
  defaultConfig: string | null | unknown;
}

/** Result of patching one zone — what we'd write back, or null when no-op. */
export interface ZonePatchResult {
  /** Merged config object (existing cfg + patch). Null when there's no change. */
  mergedConfig: Record<string, unknown> | null;
  /** JSON.stringify of mergedConfig — what the DB column wants. */
  serialized: string | null;
  /** True when we changed at least one key. */
  changed: boolean;
}

/**
 * Decide which keys of a zone's defaultConfig should change for this brand.
 *
 * Pure function — no DB, no side effects. Caller writes the result.
 *
 * `fill-blanks` only patches a key when the existing cfg has it undefined.
 *   - cfg.color === undefined → patch.color = brand.ink
 *   - cfg.fontFamily === undefined AND brand.fontHeading != null → patch.fontFamily = brand.fontHeading
 *
 * `override` ALWAYS patches:
 *   - patch.color = brand.ink
 *   - patch.fontFamily = brand.fontHeading (only when a heading font exists — never write null)
 *
 * If the brand has no heading font, `fontFamily` is never patched (we
 * don't want to clobber a zone's existing custom font with `null`).
 */
export function patchZoneForBrand(
  zone: ZoneInput,
  brand: BrandInputs,
  mode: ApplyBrandMode,
): ZonePatchResult {
  const cfg = parseZoneConfig(zone.defaultConfig);
  const patch: Record<string, unknown> = {};

  if (mode === 'override' || cfg.color === undefined) {
    patch.color = brand.ink;
  }
  if (brand.fontHeading && (mode === 'override' || cfg.fontFamily === undefined)) {
    patch.fontFamily = brand.fontHeading;
  }

  if (Object.keys(patch).length === 0) {
    return { mergedConfig: null, serialized: null, changed: false };
  }
  const merged = { ...cfg, ...patch };
  return { mergedConfig: merged, serialized: JSON.stringify(merged), changed: true };
}

/**
 * Decide which template-level background fields should change for this brand.
 *
 * Mirrors the controller's contract: the template gets a brand-surface
 * background ONLY in 'override' mode OR when the template has no
 * background of any kind set (no bgColor, no bgGradient, no bgImage).
 *
 * Returns the patch object for `prisma.template.update({ data: … })`.
 * Empty object → caller skips the write.
 */
export interface TemplateBgInput {
  bgColor: string | null;
  bgGradient: string | null;
  bgImage: string | null;
}

export function patchTemplateBackgroundForBrand(
  tpl: TemplateBgInput,
  brand: BrandInputs,
  mode: ApplyBrandMode,
): { bgColor?: string; bgGradient?: null } {
  const hasAnyBg = Boolean(tpl.bgColor || tpl.bgGradient || tpl.bgImage);
  if (mode === 'override' || !hasAnyBg) {
    return { bgColor: brand.surface, bgGradient: null };
  }
  return {};
}

/**
 * Resolve the brand inputs from a TenantBranding row's palette + fonts.
 *
 * Defaults match the controller's old inline fallback chain so we
 * don't change behavior — only refactor it into a single helper.
 */
export function resolveBrandInputs(
  palette: Record<string, unknown> | null | undefined,
  fontHeading: string | null | undefined,
): BrandInputs {
  const p = (palette || {}) as Record<string, unknown>;
  const ink = (typeof p.ink === 'string' && p.ink) || '#0f172a';
  const surface =
    (typeof p.surface === 'string' && p.surface) ||
    (typeof p.surfaceAlt === 'string' && p.surfaceAlt) ||
    (typeof p.primary === 'string' && p.primary) ||
    '#ffffff';
  return {
    ink,
    surface,
    fontHeading: fontHeading || null,
  };
}

// ─── internals ───────────────────────────────────────────────────

/**
 * Parse a zone's defaultConfig defensively. The column stores a string
 * in prod but tests sometimes pass an already-parsed object — accept
 * both. Malformed JSON falls back to an empty object (the legacy
 * controller behavior).
 */
function parseZoneConfig(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}
