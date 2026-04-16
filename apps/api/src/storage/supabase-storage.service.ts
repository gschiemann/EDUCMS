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
   */
  async upload(
    filePath: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    if (!this.client) {
      throw new Error('Supabase Storage not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }

    // Convert raw Node Buffer to a strictly sliced Web Standard ArrayBuffer
    // This physically prevents both @supabase/supabase-js v2 boundary stringification
    // AND runtime Node 18 native Blob DOM polyfill payload truncation issues completely.
    const fileBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const { error } = await this.client.storage
      .from(BUCKET)
      .upload(filePath, fileBytes, {
        contentType,
        upsert: true,
      });

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    const { data } = this.client.storage.from(BUCKET).getPublicUrl(filePath);
    return data.publicUrl;
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
