import { Controller, Get, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || (process.env.NODE_ENV === 'production' ? '/tmp/uploads' : './uploads');

/**
 * Public file serving controller — no auth, no throttle.
 * Used by <img>, <video>, <audio> tags which can't send Authorization headers.
 * Security: files are named with UUIDs (unguessable).
 */
@Controller('api/v1/assets/file')
@SkipThrottle()
export class AssetFilesController {
  @Get(':filename')
  serveFile(@Param('filename') filename: string, @Res() res: Response) {
    // Sanitize filename to prevent path traversal
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    // Lane-1 P1 fix: the strip leaves bare `..`/`.`/`` intact (regex passes
    // through dots and underscores). Those resolve to the UPLOAD_DIR's
    // parent or to UPLOAD_DIR itself — a directory-listing primitive.
    // Reject any input that doesn't look like a file name.
    if (!safe || safe === '.' || safe === '..' || safe.startsWith('.')) {
      return res.status(404).json({ error: 'File not found' });
    }
    const uploadRoot = resolve(process.cwd(), UPLOAD_DIR);
    const filePath = resolve(uploadRoot, safe);
    // Belt-and-suspenders — refuse anything that escapes UPLOAD_DIR.
    if (filePath !== uploadRoot && !filePath.startsWith(uploadRoot + '/')) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set cache headers for performance. Files are content-addressed
    // (UUID filenames), never mutated in place — safe to cache forever.
    // Bumped from `max-age=86400` to immutable on 2026-05-23 to match
    // the Supabase upload posture and prevent any chance of a daily
    // re-download cycle on a 1-day-only header. Same value as
    // supabase-storage.service.ts:212.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(filePath);
  }
}
