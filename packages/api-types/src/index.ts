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
