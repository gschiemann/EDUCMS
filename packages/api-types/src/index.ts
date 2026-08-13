// In-editor AI editing (Slice 1d/2a) — field-resolution map shared by API + web.
export * from './ai-edit/field-map';

// Interim template quarantine denylist (audit W0-08) — single source of truth
// consumed by BOTH the API (seed/clone gate) and web (picker/homepage filter).
export * from './quarantine';

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
// 2026-05-25 — added with the auth-Phase-1 ask. Phone is optional
// everywhere (the user volunteers it; SMS-2FA path needs it later
// but TOTP / passkey paths don't). Bounded to 32 chars to comfortably
// cover E.164 worst-case (+15 digits) plus formatting characters
// (spaces, dashes, parens) before the server normalizes.
const PhoneString = BoundedText(32);

export const SignupInputSchema = z
  .object({
    districtName: BoundedText(200).min(1),
    slug: BoundedText(80).optional(),
    adminEmail: EmailString,
    password: PasswordString,
    vertical: BoundedText(40).optional(),
    firstName: PersonNameString.optional(),
    lastName: PersonNameString.optional(),
    phone: PhoneString.optional(),
    // 2026-05-25 — optional physical address. Sprint 8's fleet map
    // plots tenants by lat/lng. When the client uses the
    // AddressAutocomplete component, it captures lat/lng at
    // pick-time from the Photon/Nominatim response and sends them
    // alongside the formatted address — no follow-up geocoding
    // pass needed. When the address is typed freeform, lat/lng
    // are absent and Sprint 8's deferred geocoding still fills
    // them later.
    address: BoundedText(500).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .passthrough();
export type SignupInput = z.infer<typeof SignupInputSchema>;

export const CreateInviteInputSchema = z
  .object({
    email: EmailString,
    role: RoleNameString,
    firstName: PersonNameString.optional(),
    lastName: PersonNameString.optional(),
    phone: PhoneString.optional(),
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
    phone: PhoneString.optional(),
  })
  .passthrough();
export type CreateUserDirectInput = z.infer<typeof CreateUserDirectInputSchema>;

export const AcceptInviteInputSchema = z
  .object({
    password: PasswordString,
    firstName: PersonNameString.optional(),
    lastName: PersonNameString.optional(),
    phone: PhoneString.optional(),
  })
  .passthrough();
export type AcceptInviteInput = z.infer<typeof AcceptInviteInputSchema>;

// ─────────────────────────────────────────────────────────────
// Playlist & schedule request bodies. `.passthrough()` — same
// retrofit contract as the onboarding schemas: type- and bound-
// check every known field, never reject an unexpected extra key.
// Tenant-ownership of every foreign id (playlistId / assetId /
// screenId / screenGroupId / templateId) stays enforced in the
// controllers. Optional id fields use BoundedText(128) rather
// than `Id` so a client sending "" for "unset" is not rejected.
// ─────────────────────────────────────────────────────────────

const PlaylistName = BoundedText(200);
const OptionalIdString = BoundedText(128);      // allows "" = unset
const ScheduleDateTimeString = BoundedText(64); // controller does new Date()
const TimeOfDayString = BoundedText(16);        // "08:00"
const DaysOfWeekString = BoundedText(64);       // "Mon,Tue,Wed"

export const PlaylistCreateSchema = z
  .object({
    name: PlaylistName,
    templateId: OptionalIdString.optional(),
  })
  .passthrough();
export type PlaylistCreateInput = z.infer<typeof PlaylistCreateSchema>;

export const PlaylistUpdateSchema = z
  .object({
    name: PlaylistName,
  })
  .passthrough();
export type PlaylistUpdateInput = z.infer<typeof PlaylistUpdateSchema>;

export const PlaylistItemInputSchema = z
  .object({
    assetId: Id,
    durationMs: z.number().int().nonnegative(),
    sequenceOrder: z.number().int().nonnegative(),
    daysOfWeek: DaysOfWeekString.nullish(),
    timeStart: TimeOfDayString.nullish(),
    timeEnd: TimeOfDayString.nullish(),
    transitionType: BoundedText(32).nullish(),
    muted: z.boolean().optional(),
  })
  .passthrough();
export type PlaylistItemInput = z.infer<typeof PlaylistItemInputSchema>;

export const PlaylistReorderItemsSchema = z
  .object({
    items: z.array(PlaylistItemInputSchema).max(5000),
  })
  .passthrough();
export type PlaylistReorderItemsInput = z.infer<typeof PlaylistReorderItemsSchema>;

export const PlaylistSetActiveSchema = z
  .object({
    active: z.boolean(),
  })
  .passthrough();
export type PlaylistSetActiveInput = z.infer<typeof PlaylistSetActiveSchema>;

export const ScheduleCreateSchema = z
  .object({
    playlistId: Id,
    screenGroupId: OptionalIdString.optional(),
    screenId: OptionalIdString.optional(),
    startTime: ScheduleDateTimeString,
    endTime: ScheduleDateTimeString.optional(),
    daysOfWeek: DaysOfWeekString.optional(),
    timeStart: TimeOfDayString.optional(),
    timeEnd: TimeOfDayString.optional(),
    priority: z.number().int().optional(),
    mode: z.enum(['append', 'replace']).optional(),
    mutedOverride: z.boolean().nullish(),
    isActive: z.boolean().optional(),
  })
  .passthrough();
export type ScheduleCreateInput = z.infer<typeof ScheduleCreateSchema>;

export const ScheduleUpdateSchema = z
  .object({
    playlistId: OptionalIdString.optional(),
    screenGroupId: OptionalIdString.optional(),
    screenId: OptionalIdString.optional(),
    daysOfWeek: DaysOfWeekString.nullish(),
    timeStart: TimeOfDayString.nullish(),
    timeEnd: TimeOfDayString.nullish(),
    priority: z.number().int().optional(),
    mutedOverride: z.boolean().nullish(),
    // PUT /schedules/:id may now flip the live/draft state too — previously
    // only PUT /schedules/:id/toggle could, which silently dropped any
    // isActive sent through the plain update (a confusing inconsistency).
    // Honored admin-side; routed through the same audit + go-dark fallback
    // as /toggle so deactivating here can never leave a screen blank.
    isActive: z.boolean().optional(),
  })
  .passthrough();
export type ScheduleUpdateInput = z.infer<typeof ScheduleUpdateSchema>;

// ─────────────────────────────────────────────────────────────
// Screen-group & submission request bodies. `.passthrough()` —
// same retrofit contract as the schemas above.
// ─────────────────────────────────────────────────────────────

const IdArray = z.array(Id).max(5000);

export const ScreenGroupCreateSchema = z
  .object({
    name: BoundedText(200),
    description: BoundedText(2000).optional(),
  })
  .passthrough();
export type ScreenGroupCreateInput = z.infer<typeof ScreenGroupCreateSchema>;

export const ScreenGroupUpdateSchema = z
  .object({
    name: BoundedText(200).optional(),
    description: BoundedText(2000).optional(),
    // 2026-07-28 — frame-locked multi-screen sync. 'locked' = every screen
    // in the group plays its shared schedule on the deterministic shared-
    // clock timeline; 'off'/null = today's free-run behavior.
    syncMode: z.enum(['off', 'locked']).nullable().optional(),
  })
  .passthrough();
export type ScreenGroupUpdateInput = z.infer<typeof ScreenGroupUpdateSchema>;

export const ScreenGroupAssignScreensSchema = z
  .object({
    screenIds: IdArray,
  })
  .passthrough();
export type ScreenGroupAssignScreensInput = z.infer<typeof ScreenGroupAssignScreensSchema>;

export const SubmissionCreateSchema = z
  .object({
    note: BoundedText(5000).optional(),
    notifyUserIds: IdArray.optional(),
    assetIds: IdArray.optional(),
    playlistIds: IdArray.optional(),
    scheduleIds: IdArray.optional(),
  })
  .passthrough();
export type SubmissionCreateInput = z.infer<typeof SubmissionCreateSchema>;

export const SubmissionDecisionSchema = z
  .object({
    reviewerNote: BoundedText(5000).optional(),
  })
  .passthrough();
export type SubmissionDecisionInput = z.infer<typeof SubmissionDecisionSchema>;

// ─────────────────────────────────────────────────────────────
// Template request bodies. `.passthrough()` — same retrofit
// contract. Zone defaultConfig / touchAction are arbitrary
// widget JSON, kept verbatim (z.any()); the controllers still
// run validateZoneBounds() and the brand-merge on every zone.
// ─────────────────────────────────────────────────────────────

const TemplateZoneBodySchema = z
  .object({
    name: BoundedText(200),
    widgetType: BoundedText(64),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    zIndex: z.number().int().optional(),
    sortOrder: z.number().int().optional(),
    defaultConfig: z.any().optional(),
    touchAction: z.any().optional(),
    sceneId: BoundedText(128).nullish(),
  })
  .passthrough();

export const TemplateNameOnlySchema = z
  .object({ name: BoundedText(200).optional() })
  .passthrough();
export type TemplateNameOnlyInput = z.infer<typeof TemplateNameOnlySchema>;

export const TemplateSceneUpdateSchema = z
  .object({
    name: BoundedText(200).optional(),
    sortOrder: z.number().int().optional(),
    isDefault: z.boolean().optional(),
  })
  .passthrough();
export type TemplateSceneUpdateInput = z.infer<typeof TemplateSceneUpdateSchema>;

export const TemplateCreateSchema = z
  .object({
    name: BoundedText(200).min(1),
    description: BoundedText(2000).optional(),
    category: BoundedText(64).optional(),
    orientation: BoundedText(32).optional(),
    screenWidth: z.number().optional(),
    screenHeight: z.number().optional(),
    bgColor: BoundedText(256).optional(),
    bgImage: BoundedText(2048).optional(),
    bgGradient: BoundedText(1024).optional(),
    zones: z.array(TemplateZoneBodySchema).max(500).optional(),
  })
  .passthrough();
export type TemplateCreateInput = z.infer<typeof TemplateCreateSchema>;

export const TemplateGenerateTouchSchema = z
  .object({
    prompt: BoundedText(8000),
    screenWidth: z.number().optional(),
    screenHeight: z.number().optional(),
    vertical: BoundedText(40).optional(),
  })
  .passthrough();
export type TemplateGenerateTouchInput = z.infer<typeof TemplateGenerateTouchSchema>;

// Slice 1c (2026-06-16) — 3-candidate generation. Same inputs as the
// single-shot generator, plus `interactive` (touch vs passive signage)
// and `count` (capped 1..3 server-side too). Returns drafts, NOT a
// persisted template.
export const TemplateGenerateTouchCandidatesSchema = z
  .object({
    prompt: BoundedText(8000),
    screenWidth: z.number().optional(),
    screenHeight: z.number().optional(),
    vertical: BoundedText(40).optional(),
    interactive: z.boolean().optional(),
    count: z.number().int().min(1).max(3).optional(),
    // Wave 2 (2026-06-26) — opt-in flag to route through the signage-design
    // ENGINE (art-director spec → grid-locked archetype + theme + scrim). When
    // true the candidates each carry a `background` descriptor + archetype/theme
    // metadata. The old (non-engine) path is untouched when this is absent/false.
    engine: z.boolean().optional(),
    // Wave 2a (2026-06-27) — opt-in "build a whole set": ONE prompt (or several,
    // newline-separated) → ONE cohesive multi-SCENE template (4-6 boards sharing
    // one theme) that plays itself. Implies engine. Returns a single candidate
    // whose `scenes[]` is the set. The old single-board candidate path is
    // untouched when absent/false.
    set: z.boolean().optional(),
    // GUIDED-INTAKE (2026-06-28) — OPTIONAL guided-builder directives. Every one
    // is OPTIONAL and, when omitted/'auto', the engine keeps its derive-from-
    // prompt + vertical-affinity behavior (zero regression). The service
    // re-parses/clamps these via parseGuidedIntake (apps/api/src/ai/guided-intake.ts)
    // — this schema just bounds the shapes at the boundary. Only meaningful on
    // the ENGINE path (engine:true or set:true).
    //   purpose    → archetype (welcome→hero-fullbleed, menu→menu-list, …)
    //   theme      → a friendly label (Modern/Bold/Elegant/Warm/Neon/Minimal/
    //                Playful) OR a real theme id OR 'brand'
    //   palette    → 'brand' | 'auto' | { colors: hex[] (≤6) }
    //   background → 'solid' | 'gradient' | 'textured' | 'photo' | 'auto'
    //   widgets    → required content zones (headline/subtext/logo/image/clock/
    //                date/weather/countdown/menu/ticker/qr/cta)
    purpose: z.enum([
      'welcome', 'menu', 'promo', 'event', 'announcement', 'feature', 'photo-hero', 'auto',
    ]).optional(),
    theme: BoundedText(40).optional(),
    palette: z.union([
      z.literal('brand'),
      z.literal('auto'),
      z.object({ colors: z.array(BoundedText(9)).max(6) }).passthrough(),
    ]).optional(),
    background: z.enum(['solid', 'gradient', 'textured', 'photo', 'auto']).optional(),
    widgets: z.array(z.enum([
      'headline', 'subtext', 'logo', 'image', 'clock', 'date',
      'weather', 'countdown', 'menu', 'ticker', 'qr', 'cta',
    ])).max(12).optional(),
  })
  .passthrough();
export type TemplateGenerateTouchCandidatesInput = z.infer<typeof TemplateGenerateTouchCandidatesSchema>;

// Wave 3 (2026-06-27) — CHAT-TO-EDIT. Refine an existing art-directed board by a
// natural-language instruction. `spec` is the ArtDirectorSpec the candidate was
// built from (round-trips through the browser → re-sanitized server-side via
// parseArtDirectorSpec, so it's accepted permissively here).
export const TemplateRefineSignageSchema = z
  .object({
    instruction: BoundedText(500),
    spec: z.any(),
    screenWidth: z.number().optional(),
    screenHeight: z.number().optional(),
    vertical: BoundedText(40).optional(),
  })
  .passthrough();
export type TemplateRefineSignageInput = z.infer<typeof TemplateRefineSignageSchema>;

// ─────────────────────────────────────────────────────────────────────
// Signage Concierge (2026-06-28) — conversational, reference-driven AI
// template intake. Instead of a fixed-question wizard, the operator CHATS
// with a signage-savvy AI that knows the end-game (great digital signage):
// it asks the right next question, accepts reference URLs + image uploads
// for the look they want, and fills a structured intake until it can
// generate 3 on-target boards. The intake field names + enums MIRROR the
// guided-intake directives on TemplateGenerateTouchCandidatesSchema so the
// FE can hand them straight to the existing 3-candidate generator.
// ─────────────────────────────────────────────────────────────────────

/** A reference the customer shared — a website to match, or an image of a
 *  look they like — already summarized server-side into compact text the
 *  concierge LLM can read. The FE stashes these and re-sends them each turn
 *  so the model always "sees" them (the system prompt is rebuilt per call). */
export const ConciergeReferenceSchema = z
  .object({
    kind: z.enum(['url', 'image']),
    /** The URL or filename, shown as a chip in the UI. */
    label: BoundedText(200).optional(),
    /** The compact text summary injected into the concierge's context. */
    summary: BoundedText(4000),
    /** Hexes derived from the reference (scraped brand palette / image colors). */
    palette: z.array(BoundedText(9)).max(8).optional(),
    /** A usable image URL (scraped hero image / uploaded reference) the
     *  generator may use as a background or style anchor. */
    imageUrl: BoundedText(2048).optional(),
    /** The brand's LOGO image URL (scraped). The generator places it on the
     *  board so it carries the real mark, not typeset text. */
    logoUrl: BoundedText(2048).optional(),
  })
  .passthrough();
export type ConciergeReference = z.infer<typeof ConciergeReferenceSchema>;

/** One turn in the concierge transcript. `content` is plain text — the
 *  user's message or the assistant's prior reply (NOT the JSON envelope). */
export const ConciergeMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: BoundedText(4000),
  })
  .passthrough();
export type ConciergeMessage = z.infer<typeof ConciergeMessageSchema>;

export const ConciergeChatSchema = z
  .object({
    messages: z.array(ConciergeMessageSchema).min(1).max(40),
    references: z.array(ConciergeReferenceSchema).max(6).optional(),
    vertical: BoundedText(40).optional(),
    screenWidth: z.number().optional(),
    screenHeight: z.number().optional(),
  })
  .passthrough();
export type ConciergeChatInput = z.infer<typeof ConciergeChatSchema>;

/** Scrape a customer URL into a reference summary (palette/logo/fonts/name). */
export const ConciergeReferenceUrlSchema = z
  .object({ url: BoundedText(2048) })
  .passthrough();
export type ConciergeReferenceUrlInput = z.infer<typeof ConciergeReferenceUrlSchema>;

/** The structured intake the concierge fills as the conversation progresses.
 *  Field names + enums mirror the guided-intake directives so the FE can pass
 *  them straight to /templates/generate-touch/candidates. All optional — the
 *  model fills what it knows so far. */
export interface ConciergeIntake {
  purpose?:
    | 'welcome'
    | 'menu'
    | 'promo'
    | 'event'
    | 'announcement'
    | 'feature'
    | 'photo-hero';
  /** Friendly theme label / real theme id / 'brand'. */
  theme?: string;
  palette?: 'brand' | { colors: string[] };
  background?: 'solid' | 'gradient' | 'textured' | 'photo';
  widgets?: Array<
    | 'headline'
    | 'subtext'
    | 'logo'
    | 'image'
    | 'clock'
    | 'date'
    | 'weather'
    | 'countdown'
    | 'menu'
    | 'ticker'
    | 'qr'
    | 'cta'
  >;
}

/** What POST /templates/concierge/chat returns each turn. */
export interface ConciergeTurnResponse {
  /** The next thing to SAY to the customer — the only text shown in chat. */
  reply: string;
  /** Cumulative structured intake derived from the whole conversation. */
  intake: ConciergeIntake;
  /** What still matters but isn't known yet (drives subtle UI hints). */
  missing: string[];
  /** True when the concierge has enough to generate boards they'll love. */
  ready: boolean;
  /** A synthesized design brief (rich prompt) for the generator. Best-effort
   *  every turn; always populated once `ready`. */
  brief: string;
  source: 'tenant' | 'platform';
  usage: { used: number; cap: number; resetAt: string } | null;
}

// Wave 2 (2026-06-26) — the background descriptor an engine candidate carries
// so create-from-candidate can persist Template.bgColor/bgGradient/bgImage.
export const TemplateBackgroundSchema = z
  .object({
    bgColor: BoundedText(64).optional(),
    bgGradient: BoundedText(1024).optional(),
    bgImage: BoundedText(2048).optional(),
  })
  .partial();
export type TemplateBackgroundInput = z.infer<typeof TemplateBackgroundSchema>;

// The operator's chosen candidate round-trips back to be persisted. The
// candidate JSON is RE-SANITIZED server-side (sanitizeTouchTemplate) — so
// this schema only needs to bound the shape (cap the zones/scenes arrays
// so a tampered client can't DoS the sanitizer). Never trust these fields.
export const TemplateCreateFromCandidateSchema = z
  .object({
    candidate: z
      .object({
        name: BoundedText(200).optional(),
        description: BoundedText(2000).optional(),
        zones: z.array(z.any()).max(50),
        scenes: z.array(z.any()).max(20).optional(),
      })
      .passthrough(),
    screenWidth: z.number().optional(),
    screenHeight: z.number().optional(),
    interactive: z.boolean().optional(),
    // Wave 2 (2026-06-26) — an engine candidate carries a background descriptor
    // (bgColor / bgGradient / bgImage). Persisted onto the Template's bg fields.
    background: TemplateBackgroundSchema.optional(),
  })
  .passthrough();
export type TemplateCreateFromCandidateInput = z.infer<typeof TemplateCreateFromCandidateSchema>;

export const TemplateDuplicateSchema = z
  .object({
    name: BoundedText(200).optional(),
    screenWidth: z.number().optional(),
    screenHeight: z.number().optional(),
    orientation: BoundedText(32).optional(),
  })
  .passthrough();
export type TemplateDuplicateInput = z.infer<typeof TemplateDuplicateSchema>;

export const TemplateUpdateSchema = z
  .object({
    name: BoundedText(200).optional(),
    description: BoundedText(2000).optional(),
    category: BoundedText(64).optional(),
    orientation: BoundedText(32).optional(),
    screenWidth: z.number().optional(),
    screenHeight: z.number().optional(),
    status: BoundedText(32).optional(),
    bgColor: BoundedText(256).nullish(),
    bgImage: BoundedText(2048).nullish(),
    bgGradient: BoundedText(1024).nullish(),
    isTouchEnabled: z.boolean().optional(),
    idleResetMs: z.number().optional(),
    // C2 (Wave C, 2026-07-02) — optimistic-concurrency staleness guard.
    // The client sends the `updatedAt` it loaded/last-saved; the
    // controller 409s with {code:'TEMPLATE_STALE', serverUpdatedAt}
    // when the row has moved since. BoundedText (not z.string().date
    // time()) to stay lenient on exact format — the controller
    // re-validates parseability itself before comparing, so a
    // malformed value here just fails open (no field = old behavior).
    // Omitted entirely by any pre-C2 client — fully backward compatible.
    expectedUpdatedAt: BoundedText(64).nullish(),
  })
  .passthrough();
export type TemplateUpdateInput = z.infer<typeof TemplateUpdateSchema>;

export const TemplateReplaceZonesSchema = z
  .object({
    zones: z.array(TemplateZoneBodySchema).max(500),
    // C2 — same staleness guard, applied to the zones replace-all path
    // (the endpoint that actually deletes+recreates every zone, the
    // most destructive of the two save calls a stale tab could fire).
    expectedUpdatedAt: BoundedText(64).nullish(),
  })
  .passthrough();
export type TemplateReplaceZonesInput = z.infer<typeof TemplateReplaceZonesSchema>;


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
// 2026-05-27 — player-hardware module pair:
//   ./hardware-models  (Agent A, commit c175aab) — canonical capability
//      catalog: HardwareModel union, HardwareCapabilities, HARDWARE_CATALOG,
//      resolveHardwareModel(), capabilitiesFor(). Backs Screen.hardwareModel,
//      the per-screen Hardware panel, and GET /hardware/catalog.
//   ./hardware         (Agent D, commit 88fac59) — vertical → recommended-
//      hardware lookup + I/O upsell metadata for the pair-screen wizard
//      and AI Integration Concierge.
// Both re-export here so consumers import via `@cms/api-types`. See
// docs/EP6N_HARDWARE_EVAL.md for the EP6N rationale.
export * from './hardware-models';
export * from './hardware';

// 2026-05-27 — One-click Bug Reporter contract. Shared between
// apps/web (capture bundle + review pages) and apps/api (controller
// + AI analyzer service). See bugs.ts for the full pipeline spec.
export * from './bugs';
// Capability Registry — §21 verification-before-claim keystone (its CI
// consumer is scripts/check-capability-registry.cjs).
export * from './capability-registry';

// 2026-08-13 — display control (volume / brightness / blank-wake / reboot /
// scheduled on-off) across Goodview, Taurus, TCL and future Android signage
// SoCs without a per-vendor SDK. Carries the capability verdict the player
// probe reports, the pure capability gate the API 409s on and the dashboard
// gates its controls with, the schedule contract, and the vendor-recipe
// document schema.
export * from './display-control';
