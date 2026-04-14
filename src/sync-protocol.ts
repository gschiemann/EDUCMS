import { z } from 'zod';

export const AssetSchema = z.object({
  id: z.string().uuid("Asset ID must be a valid strict UUID v4"),
  url: z.string().url("Asset definition requires a secure pre-signed download URL"),
  sha256: z.string().length(64, "Strict SHA-256 string validation required to prevent file corruption on disk"),
  type: z.enum(['video', 'image']),
  sizeBytes: z.number().positive("Cannot cache 0-byte invalid files or negative file sizes")
});

export const PlaybackRuleSchema = z.object({
  playlistId: z.string().uuid(),
  cronSchedule: z.string(), // Standard POSIX cron format
  priority: z.number().int()
});

export const ManifestSchema = z.object({
  versionHash: z.string().min(1, "Manifest must provide a hash for differential sync"),
  deviceId: z.string().uuid(),
  assets: z.array(AssetSchema),
  schedule: z.array(PlaybackRuleSchema),
  settings: z.object({
    rebootCron: z.string().optional(),
    brightness: z.number().min(0).max(100).optional()
  })
});

export type SyncManifest = z.infer<typeof ManifestSchema>;

/**
 * Mathematically validates the Sync Manifest payload against the Sync Protocol contracts.
 * This should be used on both the Backend (before serialization) and Android Edge Device
 * (before SQLite caching) to ensure neither agent violates the contract.
 */
export function validateManifest(payload: unknown): SyncManifest {
  return ManifestSchema.parse(payload);
}
