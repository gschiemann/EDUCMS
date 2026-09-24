"use client";

/**
 * Settings Command Center — the reads the Workspace group's three
 * category pages share (Overview §7.1, Organization §7.2, Locations §7.3).
 *
 * Every hook here wraps an endpoint that ALREADY EXISTS and is already
 * role-guarded server-side. Nothing polls: a settings page that ticks in the
 * background is banned by the mobile-perf standard, and readiness is
 * computed on mount + on an explicit re-check.
 *
 * §19.4: "do not let the Overview page fan out into dozens of unbounded
 * client requests". Overview reads THREE category queries — emergency
 * readiness, license, and the recent audit page — on top of the `/tenants`
 * payload the shell already loads for every settings route. Each one is
 * `enabled`-gated on the caller's role, so a CONTRIBUTOR fires none of them
 * rather than firing three requests that can only 403.
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

/** Roles the server lets read readiness / license / audit / children. */
export const CC_ADMIN_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'] as const;
/** Roles the server lets WRITE org identity + the location structure. */
export const CC_ORG_ADMIN_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN'] as const;

export function isCcAdmin(role: string | null | undefined): boolean {
  return !!role && (CC_ADMIN_ROLES as readonly string[]).includes(role);
}
export function isCcOrgAdmin(role: string | null | undefined): boolean {
  return !!role && (CC_ORG_ADMIN_ROLES as readonly string[]).includes(role);
}

// ── Emergency readiness (GET /emergency/readiness) ──────────────────
// The one composed, server-side check we already own. It is the honest
// source for Overview's emergency attention items: each item carries the
// observed state AND the one-line fix, computed from real tenant wiring —
// never inferred in the browser.

export type CcReadinessStatus = 'ok' | 'warn' | 'missing';
export interface CcReadinessItem {
  key: string;
  status: CcReadinessStatus;
  label: string;
  detail: string;
  fixHint: string;
}
export interface CcReadinessReport {
  /** DISABLED (2026-09-24): the capability is off, nothing was graded. */
  verdict: 'READY' | 'NEEDS_ATTENTION' | 'NOT_CONFIGURED' | 'DISABLED';
  enabled?: boolean;
  locked?: boolean;
  score: number;
  items: CcReadinessItem[];
  computedAt: string;
}

/**
 * Shares the exact query key EmergencyReadinessCard uses, so opening
 * Overview and then Emergency in the same session is ONE request, not two.
 */
export function useEmergencyReadiness(opts?: { enabled?: boolean }) {
  return useQuery<CcReadinessReport>({
    queryKey: ['emergency-readiness'],
    queryFn: () => apiFetch<CcReadinessReport>('/emergency/readiness'),
    enabled: opts?.enabled ?? true,
    staleTime: 60_000,
    refetchInterval: false,
    retry: false,
  });
}

// ── Child locations (GET /tenants/children) ─────────────────────────
// SUPER_ADMIN / DISTRICT_ADMIN only, and the server excludes archived
// rows — so this list is "active locations", never "every location that
// ever existed". Callers must say so rather than implying completeness.

export interface CcChildTenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  _count: { screens: number; users: number };
}
export interface CcChildrenResponse {
  districtId: string;
  children: CcChildTenant[];
}

export function useTenantChildren(opts?: { enabled?: boolean }) {
  return useQuery<CcChildrenResponse>({
    queryKey: ['tenants', 'children'],
    queryFn: () => apiFetch<CcChildrenResponse>('/tenants/children'),
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
    refetchInterval: false,
    retry: false,
  });
}

// ── Recent settings changes (GET /audit) ────────────────────────────
// The audit list is every action for the tenant, newest first. Overview
// wants the SETTINGS subset, so it reads one page and filters against the
// allowlist below. The copy states exactly that window ("in the N most
// recent recorded events") — an empty list here is never presented as
// "this organization has never changed a setting".

export interface CcAuditRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: string | null;
  createdAt: string;
  user?: { email?: string; role?: string } | null;
}

/** How many recent events the settings filter looks at. */
export const CC_AUDIT_WINDOW = 25;

/**
 * Actions that ARE a settings change, mapped to the category that owns
 * them. Anything not listed (content edits, device telemetry, logins,
 * emergency TRIGGERS) is deliberately excluded — this is a configuration
 * history, not an activity feed, and the dashboard already has the latter.
 */
export const CC_SETTINGS_ACTIONS: Record<string, string> = {
  TENANT_UPDATED: 'organization',
  TENANT_POSTER_STANDARD_CHANGED: 'organization',
  CHILD_TENANT_CREATED: 'locations',
  CHILD_TENANT_DELETED: 'locations',
  ADOPT_BRANDING: 'brand',
  ADOPT_BRANDING_MANUAL: 'brand',
  REVERT_BRANDING: 'brand',
  BRANDING_VOICE_UPDATED: 'brand',
  BRANDING_APPLY_TO_TEMPLATES: 'brand',
  PANIC_SETTINGS_UPDATED: 'emergency',
  PANIC_CONTENT_ASSET_ADDED: 'emergency',
  PANIC_CONTENT_ASSET_REMOVED: 'emergency',
  UPDATE_SCREEN_EMERGENCY_CONTENT: 'emergency',
  OTA_WINDOW_UPDATED: 'player',
  CANARY_ROLLOUT_UPDATED: 'player',
  USER_INVITED: 'people',
  USER_CREATED: 'people',
  USER_CREATED_DIRECT: 'people',
  USER_DELETED: 'people',
  USER_DISABLED: 'people',
  USER_ROLE_CHANGED: 'people',
  USER_MFA_REQUIRED_CHANGED: 'people',
  USER_CAN_TRIGGER_PANIC_CHANGED: 'people',
  SSO_CONFIG_UPSERT: 'people',
  SSO_CONFIG_DELETE: 'people',
  AI_KEY_SET: 'integrations',
  AI_KEY_CLEARED: 'integrations',
  AI_KEY_MODEL_CHANGED: 'integrations',
  CLEVER_DISCONNECTED: 'integrations',
  POS_CONNECTION_DELETED: 'integrations',
  STREAM_CONNECTION_DELETED: 'integrations',
  AD_CONNECTION_DELETED: 'integrations',
  LICENSE_UPSERT: 'billing',
  LICENSE_STATUS_CHANGED: 'billing',
  API_KEY_CREATED: 'developer',
  API_KEY_REVOKED: 'developer',
  WEBHOOK_CREATED: 'developer',
  WEBHOOK_DELETED: 'developer',
};

export interface CcAuditPage {
  items: CcAuditRow[];
  total: number;
  limit: number;
  offset: number;
}

export function useRecentSettingsChanges(opts?: { enabled?: boolean; limit?: number }) {
  const limit = opts?.limit ?? CC_AUDIT_WINDOW;
  return useQuery<CcAuditPage>({
    queryKey: ['audit', { limit, offset: 0, settingsCc: true }],
    queryFn: () => apiFetch<CcAuditPage>(`/audit?limit=${limit}&offset=0`),
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
    refetchInterval: false,
    retry: false,
  });
}

/** One row of "last changed" evidence for a single action. */
export function useLastChange(action: string, opts?: { enabled?: boolean }) {
  return useQuery<CcAuditPage>({
    queryKey: ['audit', { action, limit: 1, offset: 0, settingsCc: true }],
    queryFn: () => apiFetch<CcAuditPage>(`/audit?action=${encodeURIComponent(action)}&limit=1&offset=0`),
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
    refetchInterval: false,
    retry: false,
  });
}
