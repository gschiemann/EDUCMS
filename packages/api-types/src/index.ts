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
// ─────────────────────────────────────────────────────────────

export * from './schemas/common';
export * from './schemas/emergency';
