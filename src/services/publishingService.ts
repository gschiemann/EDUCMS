import db from '../db/index';
import crypto from 'crypto';

export interface ManifestItem {
  assetUrl: string;
  hash: string;
  duration: number;
  position: number;
}

export interface DeviceManifest {
  schoolId: string;
  screenGroupId: string;
  hash: string;
  timestamp: string;
  items: ManifestItem[];
  emergencyOverride: any | null;
}

/**
 * Implements the idempotent publishing model.
 * Deterministically generates caching manifests and signs them.
 */
export async function generateAndPublishManifest(
  schoolId: string,
  screenGroupId: string,
  publishedBy: string,
  ipAddress: string
): Promise<string> {
  
  // 1. Snapshot the staging schedule and playlists using Parameterized Query
  const itemsQuery = `
    SELECT a.url as "assetUrl", a.hash, pi.duration, pi.position
    FROM schedules s
    JOIN playlists p ON s.playlist_id = p.id
    JOIN playlist_items pi ON p.id = pi.playlist_id
    JOIN assets a ON pi.asset_id = a.id
    WHERE s.screen_group_id = $1
      AND s.start_time <= NOW()
      AND s.end_time >= NOW()
    ORDER BY pi.position ASC;
  `;
  
  const result = await db.query(itemsQuery, [screenGroupId]);
  const items: ManifestItem[] = result.rows;

  // 2. Draft deterministic manifest
  const manifestRaw = {
    schoolId,
    screenGroupId,
    timestamp: new Date().toISOString(),
    items,
    emergencyOverride: null // Overrides bypass normal caching entirely
  };

  // 3. Compute immutable cryptographic hash
  const signatureString = JSON.stringify(manifestRaw.items) + schoolId + screenGroupId;
  const versionHash = crypto.createHash('sha256').update(signatureString).digest('hex');

  const manifestPayload: DeviceManifest = {
    ...manifestRaw,
    hash: versionHash
  };

  // 4. Save immutably to content_versions
  const insertManifestQuery = `
    INSERT INTO content_versions (school_id, version_hash, status, manifest_payload, published_by)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (version_hash) DO NOTHING
    RETURNING id;
  `;
  
  await db.query(insertManifestQuery, [
    schoolId,
    versionHash,
    'published',
    manifestPayload,
    publishedBy
  ]);

  // 5. Audit Log privileged action
  await db.logAuditAction(
    publishedBy,
    'PUBLISH_MANIFEST',
    'screen_group',
    screenGroupId,
    { versionHash, itemsCount: items.length },
    ipAddress
  );

  return versionHash;
}
