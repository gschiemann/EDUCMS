/**
 * Settings Command Center — section registry (2026-09-01).
 *
 * Source: scratch/design/settings-page/SETTINGS-COMMAND-CENTER-V2-DESIGN-DEV-HANDOFF.md
 * §5 (information architecture), §8 (route migration map), §10
 * (permission presentation), §12 (search synonyms), §19.1 (registry shape).
 *
 * This is a PRESENTATION filter only. Every API route keeps its own guard;
 * hiding a section here never grants or denies anything server-side.
 */
import type { ComponentType } from 'react';
import {
  Gauge,
  Building2,
  MapPin,
  Palette,
  ShieldAlert,
  MonitorUp,
  Plug,
  Users,
  CreditCard,
  Code2,
  Lock,
} from 'lucide-react';

export type SettingsGroup = 'workspace' | 'operations' | 'access' | 'account';
export type SettingsScope = 'account' | 'organization' | 'location';
export type SettingsSectionId =
  | 'overview'
  | 'organization'
  | 'locations'
  | 'brand'
  | 'emergency'
  | 'player'
  | 'integrations'
  | 'people'
  | 'billing'
  | 'developer'
  | 'security';

export type SettingsRole =
  | 'SUPER_ADMIN'
  | 'DISTRICT_ADMIN'
  | 'SCHOOL_ADMIN'
  | 'CONTRIBUTOR'
  | 'RESTRICTED_VIEWER';

export const ALL_ROLES: readonly SettingsRole[] = [
  'SUPER_ADMIN',
  'DISTRICT_ADMIN',
  'SCHOOL_ADMIN',
  'CONTRIBUTOR',
  'RESTRICTED_VIEWER',
];
const ADMIN_ROLES: readonly SettingsRole[] = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'];
const ORG_ADMIN_ROLES: readonly SettingsRole[] = ['SUPER_ADMIN', 'DISTRICT_ADMIN'];

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  /** i18n key under `settings.shell.sections.<id>.label` */
  labelKey: string;
  /** i18n key under `settings.shell.sections.<id>.description` */
  descriptionKey: string;
  group: SettingsGroup;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /** Canonical path segment under `/[schoolId]/settings/`. '' = the index itself. */
  path: string;
  /**
   * Path segments (under /settings/) that belong to this section for
   * index highlighting + breadcrumbs. Old URLs are preserved (§8), so the
   * legacy segment is listed here rather than redirected.
   */
  matches: readonly string[];
  /** Search synonyms (§12). Category label is always searchable. */
  keywords: readonly string[];
  scopes: readonly SettingsScope[];
  /** Roles that see the section in the index. Never the auth policy. */
  roles: readonly SettingsRole[];
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    id: 'overview',
    labelKey: 'overview',
    descriptionKey: 'overview',
    group: 'workspace',
    icon: Gauge,
    path: 'overview',
    matches: ['overview'],
    keywords: ['readiness', 'status', 'attention', 'summary', 'home'],
    scopes: ['organization', 'location'],
    roles: ALL_ROLES,
  },
  {
    id: 'organization',
    labelKey: 'organization',
    descriptionKey: 'organization',
    group: 'workspace',
    icon: Building2,
    path: 'organization',
    matches: ['organization'],
    keywords: ['vertical', 'industry', 'name', 'time zone', 'timezone', 'locale', 'defaults', 'company', 'district'],
    scopes: ['organization'],
    roles: ORG_ADMIN_ROLES,
  },
  {
    id: 'locations',
    labelKey: 'locations',
    descriptionKey: 'locations',
    group: 'workspace',
    icon: MapPin,
    path: 'locations',
    matches: ['locations'],
    keywords: ['hierarchy', 'sites', 'schools', 'venues', 'clubs', 'stores', 'address', 'add location', 'child'],
    scopes: ['organization', 'location'],
    roles: ADMIN_ROLES,
  },
  {
    id: 'brand',
    labelKey: 'brand',
    descriptionKey: 'brand',
    group: 'workspace',
    icon: Palette,
    path: 'branding',
    matches: ['branding'],
    keywords: ['logo', 'colors', 'color', 'appearance', 'theme', 'fonts', 'palette', 'brand voice', 'reskin'],
    scopes: ['organization', 'location'],
    roles: ALL_ROLES,
  },
  {
    id: 'emergency',
    labelKey: 'emergency',
    descriptionKey: 'emergency',
    group: 'operations',
    icon: ShieldAlert,
    path: 'emergency',
    matches: ['emergency'],
    keywords: ['lockdown', 'weather', 'evacuation', 'evacuate', 'security alert', 'panic', 'floor plan', 'drill', 'alert', 'readiness'],
    scopes: ['organization', 'location'],
    roles: ALL_ROLES,
  },
  {
    id: 'player',
    labelKey: 'player',
    descriptionKey: 'player',
    group: 'operations',
    icon: MonitorUp,
    path: 'player',
    matches: ['player', 'usb'],
    keywords: ['apk', 'update window', 'maintenance window', 'canary', 'rollout', 'auto update', 'ota', 'usb', 'offline', 'sneakernet', 'device key', 'version'],
    scopes: ['organization', 'location'],
    roles: ALL_ROLES,
  },
  {
    id: 'integrations',
    labelKey: 'integrations',
    descriptionKey: 'integrations',
    group: 'operations',
    icon: Plug,
    path: 'integrations',
    matches: ['integrations', 'ai', 'streaming', 'pos', 'monetize'],
    keywords: ['clever', 'hls', 'toast', 'square', 'clover', 'lightspeed', 'ads', 'ad network', 'ai key', 'openai', 'anthropic', 'gemini', 'streaming', 'menu', 'monetization', 'sponsors', 'brand voice'],
    scopes: ['organization', 'location'],
    roles: ALL_ROLES,
  },
  {
    id: 'people',
    labelKey: 'people',
    descriptionKey: 'people',
    group: 'access',
    icon: Users,
    path: 'people',
    matches: ['people', 'sso'],
    keywords: ['users', 'team', 'invite', 'roles', 'mfa policy', 'require mfa', 'saml', 'oidc', 'login', 'sso', 'okta', 'google', 'approval', 'content approval'],
    scopes: ['organization', 'location'],
    roles: ADMIN_ROLES,
  },
  {
    id: 'billing',
    labelKey: 'billing',
    descriptionKey: 'billing',
    group: 'access',
    icon: CreditCard,
    path: 'billing',
    matches: ['billing'],
    keywords: ['license', 'plan', 'seats', 'invoice', 'stripe', 'subscription', 'payment', 'trial'],
    scopes: ['organization'],
    roles: ADMIN_ROLES,
  },
  {
    id: 'developer',
    labelKey: 'developer',
    descriptionKey: 'developer',
    group: 'access',
    icon: Code2,
    path: 'developer',
    matches: ['developer', 'test-integrations'],
    keywords: ['api key', 'api keys', 'webhook', 'webhooks', 'sdk', 'docs', 'audit log', 'build', 'system info', 'token'],
    scopes: ['organization'],
    roles: ORG_ADMIN_ROLES,
  },
  {
    id: 'security',
    labelKey: 'security',
    descriptionKey: 'security',
    group: 'account',
    icon: Lock,
    path: 'security',
    matches: ['security'],
    keywords: ['password', 'two-factor', '2fa', 'mfa', 'authenticator', 'recovery codes', 'my account', 'personal'],
    scopes: ['account'],
    roles: ALL_ROLES,
  },
];

export const SETTINGS_GROUP_ORDER: readonly SettingsGroup[] = ['workspace', 'operations', 'access', 'account'];

/**
 * Sections whose canonical route does not exist yet. They stay OUT of the
 * index (and out of search) until the route lands — a nav row that 404s or
 * a "coming soon" wearing a real-button costume is banned by §11.
 * Each category agent removes its id from this set in the same commit that
 * adds the route.
 */
export const PENDING_SECTION_IDS: ReadonlySet<SettingsSectionId> = new Set<SettingsSectionId>([
  'organization',
  'locations',
  'people',
  'player',
  'integrations',
]);

export function settingsHref(schoolId: string, section: SettingsSectionDefinition | SettingsSectionId): string {
  const def = typeof section === 'string' ? SETTINGS_SECTIONS.find((s) => s.id === section) : section;
  if (!def) return `/${schoolId}/settings`;
  return `/${schoolId}/settings/${def.path}`;
}

/** Resolve which section a `/[schoolId]/settings/<segment>/...` path belongs to. */
export function sectionForPathname(pathname: string): SettingsSectionDefinition | null {
  const m = pathname.match(/\/settings(?:\/([^/?#]+))?/);
  if (!m) return null;
  const seg = m[1] ?? '';
  if (!seg) return null;
  return SETTINGS_SECTIONS.find((s) => s.matches.includes(seg)) ?? null;
}

export function visibleSections(role: string | null | undefined): SettingsSectionDefinition[] {
  if (!role) return [];
  return SETTINGS_SECTIONS.filter(
    (s) => !PENDING_SECTION_IDS.has(s.id) && (s.roles as readonly string[]).includes(role),
  );
}
