import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'assets';

@Injectable()
export class SupabaseStorageService implements OnModuleInit {
  private client: SupabaseClient;
  private readonly logger = new Logger(SupabaseStorageService.name);

  private supabaseConfig(): { url: string; key: string } {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error('Supabase Storage not configured - set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }

    return { url, key };
  }

  private ensureClient(): SupabaseClient {
    if (!this.client) {
      const { url, key } = this.supabaseConfig();
      this.client = createClient(url, key, {
        auth: { persistSession: false },
      });
    }
    return this.client;
  }

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

    // Bucket file-size limit. Multer cap (500MB) + Railway request body
    // cap mean the actual uploadable ceiling is whichever is lower; this
    // is the Supabase side. Bumped from 50MB to 500MB to match Multer.
    // 2026-05-13 — Dropped video/quicktime + video/x-msvideo. .mov files
    // (especially QuickTime-only ftyp=qt containers) and AVI don't play
    // in Android WebView / Chromium / WebKit, breaking the screen
    // experience. Kept here as defense-in-depth alongside the
    // assets.controller assertUploadIntent gate — if someone hits the
    // Supabase upload URL directly, the bucket policy still rejects.
    // 2026-05-29 (Audit 37-infra U-1) — dropped image/svg+xml. The bucket is
    // PUBLIC and serves inline, so an SVG is a stored-XSS vector if it ever
    // reaches a same-origin context. The assets controller already blocks SVG
    // at upload (assets.controller.ts assertUploadIntent); this is the
    // defense-in-depth bucket-policy half — without it, a direct hit on the
    // Supabase upload URL could still land an SVG. Inconsistency removed.
    const ALLOWED_MIMES = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'image/x-icon', 'image/bmp',
      'video/mp4', 'video/webm', 'video/x-m4v',
      'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
      'application/pdf',
      // 2026-05-03 BUG FIX (cycle 1 ai-imports BUG-002) — added PowerPoint
      // mimes for the Canva / Slides / PPTX import pipeline. Without these
      // the imports controller's MIME filter accepts the upload but
      // Supabase rejects it with "mime type not allowed" so the upload
      // silently fails after multer + before Asset row creation.
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'application/vnd.ms-powerpoint', // .ppt
    ];
    const FILE_SIZE_LIMIT = 500 * 1024 * 1024; // 500MB

    // Ensure the bucket exists (idempotent on create)
    const { error } = await this.client.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: FILE_SIZE_LIMIT,
      allowedMimeTypes: ALLOWED_MIMES,
    });

    if (error && !error.message?.includes('already exists') && !error.message?.includes('duplicate')) {
      this.logger.error(`Failed to create storage bucket: ${error.message}`);
      return;
    }

    // updateBucket on every boot — createBucket only sets these on first
    // create, so existing buckets retain their original (smaller) limits.
    // Without this, raising fileSizeLimit in code does nothing for any
    // tenant that already has an "assets" bucket.
    const { error: updErr } = await this.client.storage.updateBucket(BUCKET, {
      public: true,
      fileSizeLimit: FILE_SIZE_LIMIT,
      allowedMimeTypes: ALLOWED_MIMES,
    });
    if (updErr) {
      this.logger.warn(`Failed to update bucket limits: ${updErr.message}`);
    } else {
      this.logger.log(`Supabase Storage bucket "assets" ready (cap ${FILE_SIZE_LIMIT / (1024*1024)}MB)`);
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
  /** Normalize whatever-shape multer / IPC handed us into a real Buffer.
   *  Multer sometimes gives us Buffer, Uint8Array, ArrayBuffer, or a JSON-
   *  serialised `{type:'Buffer',data:[...]}` (e.g. when the request body
   *  was passed through a process boundary). Public so callers that need
   *  the same bytes for hashing/etc can normalize once and reuse. */
  toSafeBuffer(input: any): Buffer {
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
        // Assets are content-addressed (UUID filenames) → never mutated in
        // place, so they are safe to cache forever. Without this, Supabase
        // Storage serves `cache-control: no-cache`, which forces Cloudflare
        // and every browser/player/CI run to re-download the full file on
        // every request — the cause of the 12GB egress overage on 256MB of
        // stored assets (each served ~46×). One year + immutable collapses
        // that to one origin fetch per asset per edge PoP.
        'Cache-Control': 'public, max-age=31536000, immutable',
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

  publicUrlForPath(filePath: string): string {
    const { url } = this.supabaseConfig();
    return `${url}/storage/v1/object/public/${BUCKET}/${filePath}`;
  }

  /**
   * Best-effort: recover the bucket-relative storage PATH from a stored
   * Supabase object URL (public OR signed). Floor-plan rows persist a full
   * public URL in `imageUrl`; to re-sign on read (Audit 37-infra F-1) we need
   * the path back. Returns null if the URL isn't a recognizable Supabase
   * `…/object/(public|sign)/<bucket>/<path>` shape for OUR bucket — caller
   * then falls back to the stored URL unchanged.
   */
  pathFromObjectUrl(objectUrl: string): string | null {
    if (typeof objectUrl !== 'string' || !objectUrl) return null;
    try {
      const u = new URL(objectUrl);
      // Strip any query (signed URLs carry ?token=…) before matching.
      const marker = `/storage/v1/object/`;
      const idx = u.pathname.indexOf(marker);
      if (idx === -1) return null;
      let rest = u.pathname.slice(idx + marker.length); // e.g. "public/assets/<tenant>/floor-plans/x.png"
      // Drop the access-mode segment (public | sign | authenticated).
      rest = rest.replace(/^(public|sign|authenticated)\//, '');
      const prefix = `${BUCKET}/`;
      if (!rest.startsWith(prefix)) return null;
      const path = rest.slice(prefix.length);
      return path ? decodeURIComponent(path) : null;
    } catch {
      return null;
    }
  }

  /**
   * Create a short-TTL SIGNED URL for a bucket object (Audit 37-infra F-1).
   * Floor plans are operational-security data (building layouts/exits) and
   * Sprint-8b mandates signed short-TTL serving rather than a permanent
   * public URL that, once leaked (browser history / referrer / cache), is
   * world-readable forever. We generate these on READ from the RBAC-gated
   * floor-plan endpoints. Returns null on any failure so the caller can fall
   * back to the stored URL instead of breaking the page.
   */
  async createSignedUrl(filePath: string, expiresInSeconds = 300): Promise<string | null> {
    try {
      const storage = this.ensureClient().storage.from(BUCKET) as any;
      const { data, error } = await storage.createSignedUrl(filePath, expiresInSeconds);
      if (error) {
        this.logger.warn(`createSignedUrl failed for ${filePath}: ${error.message}`);
        return null;
      }
      const raw = data?.signedUrl || data?.signedURL;
      if (typeof raw !== 'string' || !raw) return null;
      // The JS client returns an absolute URL in v2; if it ever returns a
      // path-relative one, prefix the Supabase origin.
      if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
      const { url } = this.supabaseConfig();
      return raw.startsWith('/storage/v1') ? `${url}${raw}` : `${url}/storage/v1${raw.startsWith('/') ? '' : '/'}${raw}`;
    } catch (e: any) {
      this.logger.warn(`createSignedUrl threw for ${filePath}: ${e?.message ?? e}`);
      return null;
    }
  }

  async createSignedUploadUrl(filePath: string): Promise<{
    path: string;
    token: string;
    signedUrl: string;
    publicUrl: string;
  }> {
    const { url } = this.supabaseConfig();
    const storage = this.ensureClient().storage.from(BUCKET) as any;
    const { data, error } = await storage.createSignedUploadUrl(filePath, { upsert: true });

    if (error) {
      throw new Error(`Signed upload URL failed: ${error.message}`);
    }

    const rawUrl = data?.signedUrl || data?.signedURL || data?.url;
    const signedUrl = typeof rawUrl === 'string' && rawUrl.startsWith('/')
      ? `${url}/storage/v1${rawUrl}`
      : rawUrl;
    const token = data?.token || (signedUrl ? new URL(signedUrl).searchParams.get('token') : null);

    if (!signedUrl || !token) {
      throw new Error('Signed upload URL response did not include a usable upload URL/token');
    }

    return {
      path: data?.path || filePath,
      token,
      signedUrl,
      publicUrl: this.publicUrlForPath(filePath),
    };
  }

  async assertObjectExists(filePath: string): Promise<void> {
    const { url, key } = this.supabaseConfig();
    const endpoint = `${url}/storage/v1/object/${BUCKET}/${filePath}`;
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        Range: 'bytes=0-0',
      },
    });

    if (!res.ok && res.status !== 206) {
      const body = await res.text().catch(() => '');
      throw new Error(`Uploaded object was not found in storage (${res.status}): ${body}`);
    }
  }

  /**
   * Fetch an object's stored metadata (real byte size + content-type) WITHOUT
   * downloading it. Used by the presigned-upload completion to record the
   * actual stored size/mime instead of trusting the client-claimed values
   * (a client could otherwise lie about size/mime, which then drives the
   * player's rendering + cache-status display). We deliberately do NOT
   * re-hash the bytes here — that would require downloading the whole object
   * and defeat the entire point of presigned (direct-to-storage) uploads for
   * large files. Returns null if the info endpoint is unavailable so the
   * caller can fall back to client-claimed values rather than fail the upload.
   */
  async getObjectInfo(filePath: string): Promise<{ size: number | null; contentType: string | null } | null> {
    try {
      const { url, key } = this.supabaseConfig();
      const endpoint = `${url}/storage/v1/object/info/public/${BUCKET}/${filePath}`;
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${key}`, apikey: key },
      });
      if (!res.ok) return null;
      const j: any = await res.json();
      const size = Number(j?.size ?? j?.metadata?.size);
      const contentType = j?.content_type ?? j?.contentType ?? j?.metadata?.mimetype ?? null;
      return {
        size: Number.isFinite(size) ? size : null,
        contentType: typeof contentType === 'string' ? contentType : null,
      };
    } catch {
      return null;
    }
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
   * Bulk delete — Supabase storage `.remove()` accepts an array.
   * Used by the SUPER_ADMIN wipe-all-assets endpoint to clear the
   * bucket without making N separate HTTP calls. Chunks at 1000
   * per request because the API has a per-request limit somewhere
   * in the few-thousands and we don't want to find it the hard way.
   *
   * Returns the count of paths the API accepted as removed (which is
   * usually all of them — Supabase ignores non-existent paths silently).
   */
  async deleteMany(filePaths: string[]): Promise<number> {
    if (!this.client || filePaths.length === 0) return 0;
    const CHUNK = 1000;
    let removed = 0;
    for (let i = 0; i < filePaths.length; i += CHUNK) {
      const slice = filePaths.slice(i, i + CHUNK);
      const { data, error } = await this.client.storage
        .from(BUCKET)
        .remove(slice);
      if (error) {
        this.logger.warn(`deleteMany chunk failed (${slice.length} paths): ${error.message}`);
        continue;
      }
      removed += data?.length ?? 0;
    }
    return removed;
  }

  /**
   * Download an object's bytes from Supabase storage back to the API.
   * Used by the server-side optimization step in completeUpload — after
   * the browser PUTs the raw bytes via presign, we pull them back,
   * run them through MediaOptimizationService, then upsert the
   * optimized version to the same path so the public URL stays stable.
   *
   * Returns null on miss so the caller can skip optimization gracefully
   * rather than fail the whole upload.
   */
  async download(filePath: string): Promise<Buffer | null> {
    const { url, key } = this.supabaseConfig();
    const endpoint = `${url}/storage/v1/object/${BUCKET}/${filePath}`;
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}`, apikey: key },
      });
      if (!res.ok) {
        this.logger.warn(`download(${filePath}) failed: ${res.status}`);
        return null;
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch (err: any) {
      this.logger.warn(`download(${filePath}) threw: ${err?.message ?? err}`);
      return null;
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

  /**
   * The bucket name. Exposed so admin endpoints can reference it in
   * audit log entries without hard-coding the string elsewhere.
   */
  bucketName(): string {
    return BUCKET;
  }
}
