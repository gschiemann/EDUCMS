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

// SRP-aligned panic types. Hold + Secure + Medical added 2026-04-17 to
// match the I Love U Guys Standard Response Protocol used by US K-12.
export const OverrideIncidentType = z.enum([
  'lockdown', 'weather', 'evacuate',
  'hold', 'secure', 'medical',
]);
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

// ─────────────────────────────────────────────────────────────
// Sprint 5: Emergency System Expansion
// ─────────────────────────────────────────────────────────────

// Tri-tier severity used by SOS / broadcast / media-alert rendering.
export const BroadcastSeverity = z.enum(['INFO', 'WARN', 'CRITICAL']);
export type BroadcastSeverity = z.infer<typeof BroadcastSeverity>;

export const SosInputSchema = z
  .object({
    location: BoundedText(500).optional(),
    voiceClipUrl: UrlString.optional(),
  })
  .strict();
export type SosInput = z.infer<typeof SosInputSchema>;

export const BroadcastInputSchema = z
  .object({
    scopeType: ScopeType,
    scopeId: Id,
    text: BoundedText(2000).min(1),
    severity: BroadcastSeverity.default('WARN'),
    durationMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
    expiresAt: EpochSecondsOrIso.optional(),
  })
  .strict();
export type BroadcastInput = z.infer<typeof BroadcastInputSchema>;

export const MediaAlertInputSchema = z
  .object({
    scopeType: ScopeType,
    scopeId: Id,
    mediaUrls: z.array(UrlString).max(10).default([]),
    audioUrl: UrlString.optional(),
    textBlob: BoundedText(5000).min(1),
    severity: BroadcastSeverity.default('CRITICAL'),
    expiresAt: EpochSecondsOrIso.optional(),
  })
  .strict();
export type MediaAlertInput = z.infer<typeof MediaAlertInputSchema>;

// ─────────────────────────────────────────────────────────────
// Auth — credential endpoints (login first; signup/reset to follow)
//
// Bounds the input shape that flows into argon2.verify and Prisma
// findUnique. Without these, a 10MB email or password can DoS the
// hash check, and non-string inputs reach the DB layer with cryptic
// errors. Email format is RFC-compliant but lenient (allows
// `admin@school.local` for on-prem deployments). Passwords are
// NOT trimmed: leading/trailing whitespace can be part of the secret.
// ─────────────────────────────────────────────────────────────

export const EmailString = z
  .string()
  .min(3)
  .max(254) // RFC 5321 envelope max
  .email({ message: 'Invalid email address' });

export const PasswordString = z
  .string()
  .min(1)
  .max(256); // ≫ any real password; below the argon2 DoS threshold

export const LoginInputSchema = z
  .object({
    email: EmailString,
    password: PasswordString,
    rememberMe: z.boolean().optional(),
  })
  .strict();
export type LoginInput = z.infer<typeof LoginInputSchema>;

// New-credential flows (signup, password reset, invite accept,
// admin-direct-create) accept passwords being SET for the first time.
// Enforce a min-length now — only future credentials need to clear
// the bar; existing accounts are unaffected because login validates
// against the OLD looser PasswordString shape (min 1).
//
// 8 chars is the OWASP soft minimum and matches what most school
// districts already require. We deliberately don't enforce
// complexity rules (digits/symbols/case) — research consistently
// shows length beats complexity, and complexity rules push users
// toward predictable patterns ("Password1!").
const NewPasswordString = z
  .string()
  .min(8, { message: 'Password must be at least 8 characters' })
  .max(256);

const ResetTokenString = z
  .string()
  .min(16) // tokens are sha256 → 64 hex chars; min 16 catches truncation
  .max(256);

export const PasswordResetRequestSchema = z
  .object({
    email: EmailString,
  })
  .strict();
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordResetCompleteSchema = z
  .object({
    token: ResetTokenString,
    newPassword: NewPasswordString,
  })
  .strict();
export type PasswordResetComplete = z.infer<typeof PasswordResetCompleteSchema>;

// ─────────────────────────────────────────────────────────────
// Onboarding & user-management request bodies.
//
// Retrofit validation onto endpoints that previously accepted an
// untyped `any` body. `.passthrough()` is deliberate: these
// schemas validate the TYPE and BOUNDS of every known field (so a
// 10 MB string can no longer reach argon2 / Prisma, and a non-
// string can't reach the DB layer) but never reject an unexpected
// extra key — so adding one can never break a live client. The
// semantic checks (role-rank escalation, vertical enum, email-
// already-exists, min password length) stay in OnboardingService.
// Password fields use the loose PasswordString (1..256); the
// service remains the authority on the 8-char minimum.
// ─────────────────────────────────────────────────────────────

const RoleNameString = BoundedText(40).min(1);
const PersonNameString = BoundedText(80);

export const SignupInputSchema = z
  .object({
    districtName: BoundedText(200).min(1),
    slug: BoundedText(80).optional(),
    adminEmail: EmailString,
    password: PasswordString,
    vertical: BoundedText(40).optional(),
  })
  .passthrough();
export type SignupInput = z.infer<typeof SignupInputSchema>;

export const CreateInviteInputSchema = z
  .object({
    email: EmailString,
    role: RoleNameString,
    firstName: PersonNameString.optional(),
    lastName: PersonNameString.optional(),
  })
  .passthrough();
export type CreateInviteInput = z.infer<typeof CreateInviteInputSchema>;

export const CreateUserDirectInputSchema = z
  .object({
    email: EmailString,
    role: RoleNameString,
    password: PasswordString,
    firstName: PersonNameString.optional(),
    lastName: PersonNameString.optional(),
  })
  .passthrough();
export type CreateUserDirectInput = z.infer<typeof CreateUserDirectInputSchema>;

export const AcceptInviteInputSchema = z
  .object({
    password: PasswordString,
  })
  .passthrough();
export type AcceptInviteInput = z.infer<typeof AcceptInviteInputSchema>;


// VenueOS — multi-industry vertical taxonomy (2026-05-02).
// Drives Tenant.vertical, Template.vertical, terminology, defaults.
export * from './verticals';
// VenueOS Sports — Sprint 13. Sport Engine: SportDefinition + flagship sports.
export * from './sports';
export * from './streaming';
export * from './streaming-presets';
export * from './billing';
export * from './pos';
export * from './ad-network';
