export interface MediaAsset {
  id: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "READY" | "INVALID";
  remoteUrl: string;
  hash: string;
  size: number;
}

export interface ManifestResponse {
  scheduleId: string;
  playlistIds: string[];
  assetList: MediaAsset[];
  hash: string;
}

// Legacy: kept for backward compatibility. Prefer the zod-validated
// TriggerEmergencyInputSchema / OverridePayloadSchema re-exported at the
// bottom of this file — those match what EmergencyController actually accepts.
export interface EmergencyOverrideRequest {
  severity: "CRITICAL" | "WEATHER" | "INFO";
  mediaUrl?: string;
  textBlob: string;
  expiresAt: number;
  scope: {
    districtId?: string;
    schoolId?: string;
  }
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actorId: string;
  subjectId: string;
  ipAddress: string;
  timestamp: string;
  diff: any;
}

// ─────────────────────────────────────────────────────────────
// Template Builder API types
// ─────────────────────────────────────────────────────────────

export interface TemplateZoneInput {
  name: string;
  widgetType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
  sortOrder?: number;
  defaultConfig?: Record<string, any>;
}

export interface CreateTemplateRequest {
  name: string;
  description?: string;
  category?: string;
  orientation?: string;
  screenWidth?: number;
  screenHeight?: number;
  zones?: TemplateZoneInput[];
}

export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  category?: string;
  orientation?: string;
  screenWidth?: number;
  screenHeight?: number;
  status?: string;
}

export interface TemplateResponse {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  category: string;
  orientation: string;
  screenWidth: number;
  screenHeight: number;
  isSystem: boolean;
  status: string;
  thumbnail: string | null;
  createdById: string | null;
  zones: TemplateZoneResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface TemplateZoneResponse {
  id: string;
  templateId: string;
  name: string;
  widgetType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  sortOrder: number;
  defaultConfig: Record<string, any> | null;
}

// ─────────────────────────────────────────────────────────────
// Zod-validated API boundary schemas. New in Sprint 1.
// Prefer these over the plain interfaces above for any new
// controller or form — runtime validation matches compile-time types.
//
// Inlined here (rather than re-exported from ./schemas) because Node's
// native TS loader in 24+ won't auto-resolve extensionless relative
// imports across a workspace package that's consumed as raw TS.
// ─────────────────────────────────────────────────────────────

import { z } from 'zod';

export const ScopeType = z.enum(['tenant', 'group', 'device']);
export type ScopeType = z.infer<typeof ScopeType>;

export const Severity = z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']);
export type Severity = z.infer<typeof Severity>;

export const OverrideIncidentType = z.enum(['lockdown', 'weather', 'evacuate']);
export type OverrideIncidentType = z.infer<typeof OverrideIncidentType>;

export const Id = z.string().trim().min(1).max(128);
export const Cuid = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]+$/i, 'Invalid identifier characters')
  .min(1)
  .max(128);

export const NonEmptyString = z.string().trim().min(1);
export const BoundedText = (max: number) => z.string().trim().max(max);
export const UrlString = z.string().trim().url().max(2048);

export const EpochSecondsOrIso = z.union([
  z.number().int().positive(),
  z.string().trim().datetime({ offset: true }),
]);

export const OverridePayloadSchema = z
  .object({
    overrideId: Id.optional(),
    type: OverrideIncidentType.optional(),
    severity: Severity.default('CRITICAL'),
    mediaUrl: UrlString.optional(),
    textBlob: BoundedText(5000).optional(),
    expiresAt: EpochSecondsOrIso.optional(),
    playlistId: Id.optional(),
  })
  .strict();
export type OverridePayload = z.infer<typeof OverridePayloadSchema>;

export const TriggerEmergencyInputSchema = z
  .object({
    scopeType: ScopeType,
    scopeId: Id,
    overridePayload: OverridePayloadSchema,
  })
  .strict();
export type TriggerEmergencyInput = z.infer<typeof TriggerEmergencyInputSchema>;

export const ClearEmergencyInputSchema = z
  .object({
    scopeType: ScopeType,
    scopeId: Id,
  })
  .strict();
export type ClearEmergencyInput = z.infer<typeof ClearEmergencyInputSchema>;
