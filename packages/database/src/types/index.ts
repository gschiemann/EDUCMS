export enum AppRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  DISTRICT_ADMIN = 'DISTRICT_ADMIN',
  SCHOOL_ADMIN = 'SCHOOL_ADMIN',
  CONTRIBUTOR = 'CONTRIBUTOR',
  RESTRICTED_VIEWER = 'RESTRICTED_VIEWER',
}

export enum EmergencyStatus {
  INACTIVE = 'INACTIVE',
  LOCKDOWN = 'LOCKDOWN',
  WEATHER = 'WEATHER',
  EVACUATE = 'EVACUATE',
}

export enum AssetStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

// ─────────────────────────────────────────────────────────────
// Template Builder enums
// ─────────────────────────────────────────────────────────────

export enum TemplateStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum TemplateCategory {
  LOBBY = 'LOBBY',
  HALLWAY = 'HALLWAY',
  CAFETERIA = 'CAFETERIA',
  CLASSROOM = 'CLASSROOM',
  OFFICE = 'OFFICE',
  GYM = 'GYM',
  LIBRARY = 'LIBRARY',
  CUSTOM = 'CUSTOM',
}

export enum TemplateOrientation {
  LANDSCAPE = 'LANDSCAPE',
  PORTRAIT = 'PORTRAIT',
}

/**
 * Widget types that can be placed in a template zone.
 * Each type has its own rendering logic and configuration schema.
 */
export enum WidgetType {
  // Media widgets
  VIDEO = 'VIDEO',
  IMAGE = 'IMAGE',
  IMAGE_CAROUSEL = 'IMAGE_CAROUSEL',
  PLAYLIST = 'PLAYLIST',

  // Web & content widgets
  WEBPAGE = 'WEBPAGE',
  TEXT = 'TEXT',
  RICH_TEXT = 'RICH_TEXT',
  RSS_FEED = 'RSS_FEED',
  SOCIAL_FEED = 'SOCIAL_FEED',

  // Education-specific widgets
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  BELL_SCHEDULE = 'BELL_SCHEDULE',
  LUNCH_MENU = 'LUNCH_MENU',
  CALENDAR = 'CALENDAR',
  COUNTDOWN = 'COUNTDOWN',
  STAFF_SPOTLIGHT = 'STAFF_SPOTLIGHT',

  // Utility widgets
  CLOCK = 'CLOCK',
  WEATHER = 'WEATHER',
  LOGO = 'LOGO',
  TICKER = 'TICKER',
  EMPTY = 'EMPTY',
}

/**
 * High-level abstract Tenancy Entities.
 * These will map to the Prisma Models or DB entities later.
 */

export interface IDistrict {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISchool {
  id: string;
  districtId: string;
  name: string;
  address?: string;
  emergencyStatus: EmergencyStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUser {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  // Tenancy bindings
  districtId?: string; // Scope: Entire district
  schoolId?: string; // Scope: Single school
  createdAt: Date;
  updatedAt: Date;
}

export interface IScreenGroup {
  id: string;
  schoolId: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IScreen {
  id: string;
  schoolId: string;
  screenGroupId?: string;
  name: string;
  location: string;
  isConnected: boolean;
  lastHeartbeat?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAsset {
  id: string;
  schoolId: string;
  uploadedByUserId: string;
  fileUrl: string;
  mimeType: string;
  status: AssetStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPlaylist {
  id: string;
  schoolId: string;
  name: string;
  screenGroupId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────
// Template interfaces
// ─────────────────────────────────────────────────────────────

export interface ITemplateZone {
  id: string;
  templateId: string;
  name: string;
  widgetType: WidgetType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  sortOrder: number;
  defaultConfig?: Record<string, any>;
}

export interface ITemplate {
  id: string;
  tenantId?: string;
  name: string;
  description?: string;
  category: TemplateCategory;
  orientation: TemplateOrientation;
  isSystem: boolean;
  status: TemplateStatus;
  thumbnail?: string;
  createdById?: string;
  zones: ITemplateZone[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Per-widget default configuration schemas.
 * The frontend template builder uses these to render config panels.
 */
export interface WidgetConfigSchemas {
  VIDEO: { autoplay?: boolean; muted?: boolean; loop?: boolean; fitMode?: 'contain' | 'cover' | 'fill' };
  IMAGE: { fitMode?: 'contain' | 'cover' | 'fill'; alt?: string };
  IMAGE_CAROUSEL: { transitionEffect?: 'fade' | 'slide' | 'none'; intervalMs?: number; fitMode?: 'contain' | 'cover' | 'fill' };
  PLAYLIST: { playlistId?: string };
  WEBPAGE: { url?: string; refreshIntervalMs?: number; scrollEnabled?: boolean };
  TEXT: { content?: string; fontSize?: number; fontFamily?: string; color?: string; bgColor?: string; alignment?: 'left' | 'center' | 'right' };
  RICH_TEXT: { html?: string };
  RSS_FEED: { feedUrl?: string; maxItems?: number; refreshIntervalMs?: number; showImages?: boolean };
  SOCIAL_FEED: { platform?: string; handle?: string; maxPosts?: number };
  ANNOUNCEMENT: { title?: string; body?: string; priority?: 'normal' | 'urgent'; bgColor?: string; textColor?: string };
  BELL_SCHEDULE: { periods?: Array<{ name: string; startTime: string; endTime: string }>; showCurrentHighlight?: boolean };
  LUNCH_MENU: { meals?: Array<{ label: string; items: string[] }>; date?: string };
  CALENDAR: { sourceUrl?: string; daysToShow?: number; showWeekend?: boolean };
  COUNTDOWN: { targetDate?: string; label?: string; showDays?: boolean; showHours?: boolean };
  STAFF_SPOTLIGHT: { name?: string; title?: string; photoUrl?: string; quote?: string; rotateIntervalMs?: number };
  CLOCK: { format?: '12h' | '24h'; showSeconds?: boolean; timezone?: string };
  WEATHER: { location?: string; units?: 'imperial' | 'metric'; showForecast?: boolean };
  LOGO: { imageUrl?: string; fitMode?: 'contain' | 'cover' };
  TICKER: { messages?: string[]; speed?: 'slow' | 'medium' | 'fast'; direction?: 'left' | 'right' };
  EMPTY: {};
}
