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
