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
   * Safely convert any multer buffer input into a real Node.js Buffer.
   * Multer on Railway/Docker sometimes provides:
   *   - A real Buffer
   *   - A Uint8Array or ArrayBuffer
   *   - A serialized object: { type: 'Buffer', data: [1,2,3,...] }
   *   - A plain object with numeric keys: { '0': 1, '1': 2, ... }
   */
  private toSafeBuffer(input: any): Buffer {
    // Already a real Buffer
    if (Buffer.isBuffer(input)) {
      return input;
    }

    // Uint8Array — wrap via its underlying ArrayBuffer
    if (input instanceof Uint8Array) {
      return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    }

    // ArrayBuffer
    if (input instanceof ArrayBuffer) {
      return Buffer.from(new Uint8Array(input));
    }

    // Array of byte values
    if (Array.isArray(input)) {
      return Buffer.from(input);
    }

    // Serialized Buffer object: { type: 'Buffer', data: [...] }
    if (input && typeof input === 'object' && Array.isArray(input.data)) {
      return Buffer.from(input.data);
    }

    // Plain object with numeric keys (e.g. { '0': 137, '1': 80, ... })
    if (input && typeof input === 'object') {
      const keys = Object.keys(input);
      if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
        const arr = new Uint8Array(keys.length);
        for (let i = 0; i < keys.length; i++) {
          arr[i] = input[String(i)];
        }
        return Buffer.from(arr);
      }
      // Last resort: try Object.values
      const vals = Object.values(input);
      if (vals.length > 0 && vals.every(v => typeof v === 'number')) {
        return Buffer.from(vals as number[]);
      }
    }

    throw new Error(
      `Cannot convert to Buffer: type=${typeof input}, ` +
      `constructor=${input?.constructor?.name}, ` +
      `keys=${input ? Object.keys(input).slice(0, 5).join(',') : 'null'}`,
    );
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
    buffer: any,
    contentType: string,
  ): Promise<string> {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error('Supabase Storage not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }

    // Convert whatever multer gave us into a real Buffer
    const buf = this.toSafeBuffer(buffer);
    const size = buf.length;

    this.logger.log(`Upload: path=${filePath}, size=${size}, contentType=${contentType}, inputType=${typeof buffer}, isBuffer=${Buffer.isBuffer(buffer)}, constructor=${buffer?.constructor?.name}`);

    // POST directly to the Storage REST API — bypasses the JS client entirely.
    const endpoint = `${url}/storage/v1/object/${BUCKET}/${filePath}`;

    // Copy into a guaranteed ArrayBuffer (not SharedArrayBuffer).
    const ab = new ArrayBuffer(size);
    new Uint8Array(ab).set(buf);

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
