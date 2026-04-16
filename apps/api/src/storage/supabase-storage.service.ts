import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'assets';

@Injectable()
export class SupabaseStorageService implements OnModuleInit {
  private client: SupabaseClient;
  private readonly logger = new Logger(SupabaseStorageService.name);

  async onModuleInit() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      this.logger.warn(
        'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — file uploads will fail. ' +
        'Set these env vars to enable Supabase Storage.',
      );
      return;
    }

    this.client = createClient(url, key, {
      auth: { persistSession: false },
    });

    // Ensure the bucket exists (idempotent)
    const { error } = await this.client.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 50 * 1024 * 1024, // 50 MB (Supabase default project limit boundary)
      allowedMimeTypes: [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
        'image/x-icon', 'image/bmp',
        'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
        'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
        'application/pdf',
      ],
    });

    if (error && !error.message?.includes('already exists') && !error.message?.includes('duplicate')) {
      this.logger.error(`Failed to create storage bucket: ${error.message}`);
    } else {
      this.logger.log('Supabase Storage bucket "assets" ready');
    }
  }

  /**
   * Upload a file buffer to Supabase Storage.
   * Returns the public URL.
   *
   * Uses the Supabase Storage REST API directly via fetch because
   * @supabase/supabase-js v2 mangles Node.js Buffers (JSON-serializes them)
   * and produces 0-byte files with Uint8Array views.
   */
  async upload(
    filePath: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error('Supabase Storage not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }

    this.logger.log(`Upload: path=${filePath}, bufferType=${typeof buffer}, len=${buffer?.byteLength}, contentType=${contentType}`);

    // POST directly to the Storage REST API — bypasses the JS client entirely.
    const endpoint = `${url}/storage/v1/object/${BUCKET}/${filePath}`;

    // Copy into a guaranteed ArrayBuffer (not SharedArrayBuffer).
    const size = buffer.byteLength;
    const ab = new ArrayBuffer(size);
    new Uint8Array(ab).set(buffer);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': contentType,
        'Content-Length': String(size),
        'x-upsert': 'true',
      },
      body: new Blob([ab]),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Storage upload failed (${res.status}): ${body}`);
    }

    // Build the public URL the same way the JS client does
    return `${url}/storage/v1/object/public/${BUCKET}/${filePath}`;
  }

  /**
   * Delete a file from Supabase Storage.
   */
  async delete(filePath: string): Promise<void> {
    if (!this.client) return;

    const { error } = await this.client.storage
      .from(BUCKET)
      .remove([filePath]);

    if (error) {
      this.logger.warn(`Failed to delete ${filePath}: ${error.message}`);
    }
  }

  /**
   * Extract the storage path from a full Supabase public URL.
   * e.g. "https://xxx.supabase.co/storage/v1/object/public/assets/tenant/file.jpg"
   *   → "tenant/file.jpg"
   */
  extractPath(publicUrl: string): string | null {
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return null;
    return publicUrl.substring(idx + marker.length);
  }
}
