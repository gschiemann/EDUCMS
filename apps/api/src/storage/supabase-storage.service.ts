import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { makeStorageFetch, storageTransportState } from './storage-transport';

const BUCKET = 'assets';

// PRIVATE bucket for floor plans (Audit launch-readiness P1). Floor plans are
// operational-security data (building layouts + emergency exits). The `assets`
// bucket is PUBLIC (CDN-cacheable for everyday signage), so a leaked floor-plan
// URL would expose a building layout to the world forever. This bucket is
// created with `public: false` so objects are ONLY reachable via short-TTL
// signed URLs minted server-side from the RBAC-gated floor-plan endpoints.
// Do NOT route normal signage assets here — they must stay on the public,
// CDN-cacheable `assets` bucket.
const FLOORPLAN_BUCKET = 'floor-plans';

// PUBLIC bucket for brand-kit logos (task #223 fix — the Domino's SVG
// rasterization bug). `image/svg+xml` was REMOVED from the general `assets`
// bucket's allowlist on 2026-05-29 (Audit 37-infra U-1) because that bucket's
// main upload path is presign → direct browser→Supabase: the server never
// sees those bytes, so it can't sanitize an SVG before it lands in public
// storage — a stored-XSS vector. That hardening is correct for the media
// library, but it silently broke a DIFFERENT, already-safe path a month
// later: BrandingController's server-mediated logo rehost (`rehost()` /
// `pickVectorLogoCandidate()` / `manualAdopt()`). That path NEVER uses a
// presigned/direct-to-Supabase upload — the API server always fetches or
// receives the bytes itself, runs sanitizeLogoSvg() (DOMPurify) to produce
// the inline-render copy, and only THEN calls storage.upload() with a
// server-chosen content-type. Supabase's bucket-level `allowedMimeTypes` is
// enforced against the Content-Type header on every object write regardless
// of caller, so once U-1 dropped image/svg+xml from `assets`, every branding
// logo.svg upload started failing with "mime type not allowed" and silently
// fell through to the raster fallback (og:image / favicon) — a logo scraped
// as a crisp SVG (Domino's) came out rasterized/blurry on adopt.
// Giving logos their own bucket lets SVG be allowed here without reopening
// the media-library hole: there is no signed/presigned upload URL ever
// minted against this bucket (search `createSignedUploadUrl` — it always
// targets `BUCKET`), so the "someone hits the upload URL directly with raw
// bytes" attack the U-1 comment warned about does not apply here. Every
// write to this bucket is still an authenticated, server-mediated
// `storage.upload()` call, most of them downstream of sanitizeLogoSvg().
const LOGO_BUCKET = 'branding-logos';

// PRIVATE bucket for DESIGN IMPORTS (2026-09-15). An imported original is the
// operator's source document, not signage: a school deck routinely carries
// student names, speaker notes and hidden slides that were never meant to
// reach a display. The `assets` bucket is PUBLIC and serves inline, and the
// import pipeline had added the PowerPoint MIME types to it — so an original
// landed at a world-readable URL, and a random object name is not
// authorization. Originals and every staged derivative (page rasters,
// thumbnails) live here instead, reachable only through short-TTL signed URLs
// minted server-side from the RBAC-gated import endpoints.
//
// Two rules for anyone extending this:
//   • Only the operator's SOURCE document and its in-progress derivatives
//     belong here. The moment the operator commits an import, whatever a
//     screen must actually play is a normal Asset on the public, CDN-cacheable
//     `assets` bucket — a player fetching signage must never depend on a
//     signed URL that expires.
//   • Objects here are disposable by design. A job that is cancelled, expired
//     or failed leaves nothing a screen depends on, so a retention sweep can
//     remove them; that sweep is part of the import job lifecycle, not of this
//     service.
const IMPORT_STAGING_BUCKET = 'import-staging';

// Every bucket created with `public: true`. Used by uploadToBucket() to pick
// the correct `/object/public/...` URL shape — see the PUBLIC_BUCKETS
// callsite for why this can't just special-case the `assets` BUCKET anymore.
const PUBLIC_BUCKETS = new Set([BUCKET, LOGO_BUCKET]);

@Injectable()
export class SupabaseStorageService implements OnModuleInit {
  private client: SupabaseClient;
  private readonly logger = new Logger(SupabaseStorageService.name);

  // fetch-compatible transport with a node:https fallback + cause-chain
  // logging (2026-07-31 "fetch failed" incident — see storage-transport.ts).
  // Used for every raw Storage REST call AND injected into supabase-js, so
  // uploads, signed URLs, deletes, and boot-time bucket-ensure all ride it.
  private readonly storageFetch = makeStorageFetch((m) => this.logger.warn(m));

  private supabaseConfig(): { url: string; key: string } {
    // trim() + trailing-slash strip: env values pasted into dashboards pick
    // up invisible whitespace; a poisoned URL/key fails in ways that look
    // like network errors. Cheap insurance, applied at the single read site.
    const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

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
        global: { fetch: this.storageFetch },
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
      global: { fetch: this.storageFetch },
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
      // 2026-07-03 CRITICAL: do NOT `return` here. That silently ABORTED
      // onModuleInit before the floor-plan + brand-logo buckets below were
      // ever created — both were missing from prod (confirmed via
      // storage.buckets), which is why #223's SVG-logo adopt still fell back
      // to a raster (its `branding-logos` bucket never existed). The `assets`
      // bucket already exists and uploads work; the ONLY failure here is that
      // its requested fileSizeLimit (500MB) EXCEEDS the Supabase project's
      // global upload cap → Supabase returns "The object exceeded the maximum
      // allowed size" (which is not "already exists"/"duplicate"). That is
      // non-fatal — the bucket exists and is capped by the project global
      // regardless. Log and CONTINUE so the independent floor-plan / brand-logo
      // buckets still get set up.
      this.logger.warn(
        `assets bucket create returned "${error.message}" — continuing. ` +
        `(The bucket already exists; its per-object cap is limited by the ` +
        `Supabase project's GLOBAL upload size — raise it in Supabase → ` +
        `Storage → Settings if uploads larger than the global are needed.)`,
      );
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

    // PRIVATE floor-plan bucket (launch-readiness P1). public:false so objects
    // are never world-readable; floor-plan endpoints serve them via short-TTL
    // signed URLs only. Floor plans are images (PNG/JPG/WEBP) and rarely large,
    // so a 25MB cap matches the controller's multer limit — defense in depth in
    // case someone hits the Supabase upload URL directly.
    const FLOORPLAN_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
    const FLOORPLAN_SIZE_LIMIT = 25 * 1024 * 1024; // 25MB — matches controller cap
    const { error: fpErr } = await this.client.storage.createBucket(FLOORPLAN_BUCKET, {
      public: false,
      fileSizeLimit: FLOORPLAN_SIZE_LIMIT,
      allowedMimeTypes: FLOORPLAN_MIMES,
    });
    if (fpErr && !fpErr.message?.includes('already exists') && !fpErr.message?.includes('duplicate')) {
      this.logger.error(`Failed to create floor-plan storage bucket: ${fpErr.message}`);
    } else {
      // updateBucket on every boot — keeps public:false enforced and limits
      // current even on a bucket that already existed from a prior deploy.
      const { error: fpUpdErr } = await this.client.storage.updateBucket(FLOORPLAN_BUCKET, {
        public: false,
        fileSizeLimit: FLOORPLAN_SIZE_LIMIT,
        allowedMimeTypes: FLOORPLAN_MIMES,
      });
      if (fpUpdErr) {
        this.logger.warn(`Failed to update floor-plan bucket: ${fpUpdErr.message}`);
      } else {
        this.logger.log(`Supabase Storage bucket "${FLOORPLAN_BUCKET}" ready (private, cap ${FLOORPLAN_SIZE_LIMIT / (1024*1024)}MB)`);
      }
    }

    // PRIVATE import-staging bucket (2026-09-15). Same shape as the floor-plan
    // bucket above and for the same reason: these objects must never be
    // world-readable. The MIME list is the import capability contract —
    // the source documents we accept, plus the derivative types the converter
    // produces. The size cap matches the import controller's own 50MB limit,
    // so hitting the Supabase upload URL directly buys nothing.
    const IMPORT_STAGING_MIMES = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg', 'image/png', 'image/webp',
    ];
    const IMPORT_STAGING_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB — matches MAX_BYTES in imports.controller
    const { error: isErr } = await this.client.storage.createBucket(IMPORT_STAGING_BUCKET, {
      public: false,
      fileSizeLimit: IMPORT_STAGING_SIZE_LIMIT,
      allowedMimeTypes: IMPORT_STAGING_MIMES,
    });
    if (isErr && !isErr.message?.includes('already exists') && !isErr.message?.includes('duplicate')) {
      this.logger.error(`Failed to create import-staging bucket: ${isErr.message}`);
    } else {
      // updateBucket on every boot, like the floor-plan bucket: it re-asserts
      // public:false, so a bucket flipped public in the Supabase console (or
      // created by an older deploy) is corrected rather than trusted.
      const { error: isUpdErr } = await this.client.storage.updateBucket(IMPORT_STAGING_BUCKET, {
        public: false,
        fileSizeLimit: IMPORT_STAGING_SIZE_LIMIT,
        allowedMimeTypes: IMPORT_STAGING_MIMES,
      });
      if (isUpdErr) {
        this.logger.warn(`Failed to update import-staging bucket: ${isUpdErr.message}`);
      } else {
        this.logger.log(`Supabase Storage bucket "${IMPORT_STAGING_BUCKET}" ready (private, cap ${IMPORT_STAGING_SIZE_LIMIT / (1024 * 1024)}MB)`);
      }
    }

    // PUBLIC brand-logo bucket (task #223 — see the LOGO_BUCKET comment above
    // for why this is separate from `assets`). Raster types are included too
    // so BrandingController's raster fallback / manual-upload paths (which
    // share the same `rehostUrl`/`upload` helpers) work unchanged when the
    // scrape has no vector candidate. Small cap — logos are tiny files.
    const LOGO_MIMES = ['image/svg+xml', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/x-icon', 'image/bmp'];
    const LOGO_SIZE_LIMIT = 2 * 1024 * 1024; // 2MB — matches the branding controller's own logo-size guards
    const { error: logoErr } = await this.client.storage.createBucket(LOGO_BUCKET, {
      public: true,
      fileSizeLimit: LOGO_SIZE_LIMIT,
      allowedMimeTypes: LOGO_MIMES,
    });
    if (logoErr && !logoErr.message?.includes('already exists') && !logoErr.message?.includes('duplicate')) {
      this.logger.error(`Failed to create brand-logo storage bucket: ${logoErr.message}`);
    } else {
      // updateBucket on every boot — createBucket only applies these on
      // first create, so an existing bucket from before this fix (or one
      // missing image/svg+xml because it predates it) picks up the current
      // allowlist on the next deploy.
      const { error: logoUpdErr } = await this.client.storage.updateBucket(LOGO_BUCKET, {
        public: true,
        fileSizeLimit: LOGO_SIZE_LIMIT,
        allowedMimeTypes: LOGO_MIMES,
      });
      if (logoUpdErr) {
        this.logger.warn(`Failed to update brand-logo bucket: ${logoUpdErr.message}`);
      } else {
        this.logger.log(`Supabase Storage bucket "${LOGO_BUCKET}" ready (cap ${LOGO_SIZE_LIMIT / (1024*1024)}MB, SVG allowed)`);
      }
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
    return this.uploadToBucket(BUCKET, filePath, buffer, contentType);
  }

  /**
   * Upload a brand-kit logo to the dedicated `branding-logos` bucket (task
   * #223). Use this instead of `upload()` for every branding logo write —
   * `image/svg+xml` is allowed here but NOT in the general `assets` bucket
   * (see the LOGO_BUCKET comment at the top of this file for why). Returns
   * the public URL.
   */
  async uploadLogo(
    filePath: string,
    buffer: any,
    contentType: string,
  ): Promise<string> {
    return this.uploadToBucket(LOGO_BUCKET, filePath, buffer, contentType);
  }

  /**
   * Upload an import original or a staged derivative to the PRIVATE
   * `import-staging` bucket (2026-09-15). Use this — never `upload()` — for
   * anything that came out of a design the operator dropped on the import
   * screen. Returns the canonical `…/object/<bucket>/<path>` URL, which does
   * NOT resolve without a signature; callers re-sign on read via
   * `bucketFromObjectUrl` + `createSignedUrl`.
   */
  async uploadImportStaging(
    filePath: string,
    buffer: any,
    contentType: string,
  ): Promise<string> {
    return this.uploadToBucket(IMPORT_STAGING_BUCKET, filePath, buffer, contentType);
  }

  /**
   * Upload to an EXPLICIT bucket. The public `assets` bucket returns a public
   * URL; a private bucket (floor-plans) returns an `…/object/<bucket>/<path>`
   * URL whose bytes are only retrievable via a signed URL or service-role auth —
   * NEVER world-readable. Floor plans (launch-readiness P1) route here with
   * FLOORPLAN_BUCKET so the building layout isn't exposed by a leaked URL.
   *
   * Uses the Supabase Storage REST API directly via fetch because
   * @supabase/supabase-js v2 mangles Node.js Buffers (JSON-serializes them)
   * and produces 0-byte files with Uint8Array views.
   */
  async uploadToBucket(
    bucket: string,
    filePath: string,
    buffer: any,
    contentType: string,
  ): Promise<string> {
    // Through supabaseConfig() so the trim/normalize hardening covers THIS
    // read site too (review finding: the direct process.env reads here
    // bypassed it on the most important callsite).
    const { url, key } = this.supabaseConfig();

    // Convert whatever multer gave us into a real Buffer
    const buf = this.toSafeBuffer(buffer);
    const size = buf.length;

    // The health probe re-uploads its fixed object every ~30s — logging each
    // one would bury the real "Upload: bucket=…" signal this line exists for
    // (it's what the 2026-07-31 incident was diagnosed from).
    if (!filePath.startsWith('health/storage-probe')) {
      this.logger.log(`Upload: bucket=${bucket}, path=${filePath}, size=${size}, contentType=${contentType}, inputType=${typeof buffer}, isBuffer=${Buffer.isBuffer(buffer)}, constructor=${buffer?.constructor?.name}`);
    }

    // POST directly to the Storage REST API — bypasses the JS client entirely.
    const endpoint = `${url}/storage/v1/object/${bucket}/${filePath}`;

    // Copy into a guaranteed ArrayBuffer (not SharedArrayBuffer).
    const ab = new ArrayBuffer(size);
    new Uint8Array(ab).set(buf);

    const res = await this.storageFetch(endpoint, {
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
        // every request — the cause of the egress overages (98 MB stored →
        // 5.79 GB egress, each served ~59×).
        //
        // 2026-05-30 — MUST be the bare `max-age=N` form. Verified: the
        // previous full string `public, max-age=31536000, immutable` was
        // silently dropped by Supabase Storage to `no-cache` on the SERVED
        // header (it stored the string in the metadata JSONB but never served
        // it — which is why curling the live header showed no-cache while the
        // DB showed immutable). `max-age=31536000` is the form storage-js
        // sends and Supabase honors → CDN caches → one origin fetch per asset
        // per edge PoP per year.
        'cache-control': 'max-age=31536000',
      },
      body: new Blob([ab]),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Storage upload failed (${res.status}): ${body}`);
    }

    // Build the same URL shape the JS client returns. For a PUBLIC bucket we
    // return the public URL (`/object/public/<bucket>/...`); for a private
    // bucket (floor-plans) the public-style URL won't resolve without a
    // signature — callers re-sign on read via bucketFromObjectUrl +
    // createSignedUrl, so we store the canonical `…/object/<bucket>/<path>`
    // form from which both bucket and path parse back.
    //
    // PUBLIC_BUCKETS must list every bucket created with `public: true` above
    // — was hard-coded to just the `assets` BUCKET constant until the
    // LOGO_BUCKET fix (task #223), which silently returned a non-public URL
    // shape for logos (a 400/401 on load, not a rasterization, but equally
    // broken) until this was generalized.
    if (PUBLIC_BUCKETS.has(bucket)) {
      return `${url}/storage/v1/object/public/${bucket}/${filePath}`;
    }
    return `${url}/storage/v1/object/${bucket}/${filePath}`;
  }

  /** The private floor-plan bucket name. Exposed so the floor-plan controller
   *  and migration script can route uploads there without hard-coding it. */
  floorPlanBucketName(): string {
    return FLOORPLAN_BUCKET;
  }

  /** The private import-staging bucket name. Exposed so the import endpoints
   *  and the retention sweep can route without hard-coding it. */
  importStagingBucketName(): string {
    return IMPORT_STAGING_BUCKET;
  }

  /** The public brand-logo bucket name (task #223). Exposed so callers that
   *  need to build a Supabase URL manually don't have to hard-code it. */
  logoBucketName(): string {
    return LOGO_BUCKET;
  }

  publicUrlForPath(filePath: string): string {
    const { url } = this.supabaseConfig();
    return `${url}/storage/v1/object/public/${BUCKET}/${filePath}`;
  }

  /**
   * Best-effort: split a stored Supabase object URL (public OR signed) into its
   * { bucket, path }. Floor-plan rows persist a full URL in `imageUrl`; old
   * floor plans live in the public `assets` bucket, new ones in the private
   * `floor-plans` bucket — so to re-sign on read we must derive BOTH from the
   * stored URL (no schema change). Returns null if the URL isn't a recognizable
   * Supabase `…/object/(public|sign|authenticated)/<bucket>/<path>` shape.
   */
  parseObjectUrl(objectUrl: string): { bucket: string; path: string } | null {
    if (typeof objectUrl !== 'string' || !objectUrl) return null;
    try {
      const u = new URL(objectUrl);
      // Strip any query (signed URLs carry ?token=…) before matching.
      const marker = `/storage/v1/object/`;
      const idx = u.pathname.indexOf(marker);
      if (idx === -1) return null;
      let rest = u.pathname.slice(idx + marker.length); // e.g. "public/assets/<tenant>/floor-plans/x.png"
      // Drop the access-mode segment (public | sign | authenticated). Private
      // buckets omit it, so this is a no-op there.
      rest = rest.replace(/^(public|sign|authenticated)\//, '');
      const slash = rest.indexOf('/');
      if (slash <= 0) return null;
      const bucket = rest.slice(0, slash);
      const path = rest.slice(slash + 1);
      if (!bucket || !path) return null;
      return { bucket, path: decodeURIComponent(path) };
    } catch {
      return null;
    }
  }

  /**
   * Recover the bucket-relative storage PATH from a stored Supabase object URL.
   * Bucket-agnostic now (old floor plans live in `assets`, new in `floor-plans`).
   * Returns null if the URL isn't a recognizable Supabase object URL — caller
   * then falls back to the stored URL unchanged.
   */
  pathFromObjectUrl(objectUrl: string): string | null {
    return this.parseObjectUrl(objectUrl)?.path ?? null;
  }

  /**
   * Recover the BUCKET segment from a stored Supabase object URL. Floor-plan
   * re-signing (launch-readiness P1) must sign against the bucket the object
   * ACTUALLY lives in — old plans in the public `assets` bucket, new plans in
   * the private `floor-plans` bucket. Returns null if unparseable.
   */
  bucketFromObjectUrl(objectUrl: string): string | null {
    return this.parseObjectUrl(objectUrl)?.bucket ?? null;
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
  async createSignedUrl(filePath: string, expiresInSeconds = 300, bucket: string = BUCKET): Promise<string | null> {
    try {
      const storage = this.ensureClient().storage.from(bucket) as any;
      const { data, error } = await storage.createSignedUrl(filePath, expiresInSeconds);
      if (error) {
        this.logger.warn(`createSignedUrl failed for ${bucket}/${filePath}: ${error.message}`);
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
      this.logger.warn(`createSignedUrl threw for ${bucket}/${filePath}: ${e?.message ?? e}`);
      return null;
    }
  }

  /**
   * Re-set the SERVED Cache-Control on an existing object (2026-05-30 egress
   * incident). Verified root cause: every object was served
   * `cache-control: no-cache` → Cloudflare `MISS` → the full file re-pulled
   * from origin on EVERY load (98 MB stored → 5.79 GB egress). The earlier
   * "backfill" only patched the `storage.objects.metadata` JSONB column —
   * which Supabase does NOT serve from — so the served header never changed
   * (DB said `immutable`, the wire said `no-cache`).
   *
   * The ONLY way to change the served header is to re-write the object
   * through the Storage API. We download the bytes (service-role GET) and
   * re-POST with `cache-control: max-age=31536000` (the bare `max-age=N`
   * form Supabase honors — the full `public, …, immutable` string is
   * silently dropped to no-cache). One-time ~stored-size egress; permanent
   * fix (CDN then serves every repeat from edge).
   */
  async resetCacheControl(filePath: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const { url, key } = this.supabaseConfig();
      const getRes = await this.storageFetch(`${url}/storage/v1/object/${BUCKET}/${filePath}`, {
        headers: { Authorization: `Bearer ${key}`, apikey: key },
      });
      if (!getRes.ok) return { ok: false, error: `download ${getRes.status}` };
      const contentType = getRes.headers.get('content-type') || 'application/octet-stream';
      const ab = await getRes.arrayBuffer();
      const putRes = await this.storageFetch(`${url}/storage/v1/object/${BUCKET}/${filePath}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          'Content-Type': contentType,
          'Content-Length': String(ab.byteLength),
          'x-upsert': 'true',
          'cache-control': 'max-age=31536000',
        },
        body: new Blob([ab]),
      });
      if (!putRes.ok) {
        const b = await putRes.text();
        return { ok: false, error: `reupload ${putRes.status}: ${b.slice(0, 160)}` };
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  }

  /** Fetch the LIVE served Cache-Control header for a public object (used to
   *  VERIFY a reset actually changed the wire header, not just the DB).
   *  2026-06-09 Fable audit: must use GET, not HEAD. Supabase/its CDN returns
   *  `no-cache` on a HEAD for ALL objects (HEAD isn't cached the same way), so
   *  a HEAD probe falsely reported every object as uncached. A ranged GET
   *  (`bytes=0-0`) returns the REAL served Cache-Control + cf-cache-status
   *  without downloading the whole object. */
  async servedCacheControl(filePath: string): Promise<{ cacheControl: string | null; cfCacheStatus: string | null; status: number }> {
    try {
      const { url } = this.supabaseConfig();
      const res = await this.storageFetch(`${url}/storage/v1/object/public/${BUCKET}/${filePath}`, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      });
      return {
        cacheControl: res.headers.get('cache-control'),
        cfCacheStatus: res.headers.get('cf-cache-status'),
        status: res.status,
      };
    } catch (e: any) {
      return { cacheControl: null, cfCacheStatus: null, status: 0 };
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
    const res = await this.storageFetch(endpoint, {
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
      const res = await this.storageFetch(endpoint, {
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
      const res = await this.storageFetch(endpoint, {
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

  /**
   * Tiny end-to-end storage round-trip for GET /api/v1/health/storage
   * (2026-07-31 incident regression probe). Writes a ~60-byte probe object
   * to a FIXED path (x-upsert overwrites the same object every run — no
   * accumulation) then reads one byte back. Any failure carries the full
   * transport error text so a broken upload path is diagnosable from the
   * health endpoint alone instead of surfacing weeks later as "no logos /
   * no assets / no bug screenshots".
   */
  async storageHealthProbe(): Promise<{ ok: boolean; transport: string; upload: string; read: string; ms: number }> {
    const started = Date.now();
    // Snapshot fallback counters so we can tell whether THIS probe rode the
    // primary fetch or the node:https fallback — "working but on fallback"
    // is a degraded state the watchdog must alert on, not hide.
    const fallbacksBefore = storageTransportState.totalFallbackSuccesses + storageTransportState.totalFallbackFailures;
    // A real 1×1 transparent PNG: the assets bucket's allowedMimeTypes policy
    // rejects text/plain, so the probe must be a type production actually
    // uploads (image/png).
    const path = 'health/storage-probe.png';
    let upload = 'ok';
    let read = 'skipped';
    try {
      const body = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      );
      await this.uploadToBucket(BUCKET, path, body, 'image/png');
    } catch (e: any) {
      upload = `fail: ${String(e?.message ?? e).slice(0, 300)}`;
    }
    if (upload === 'ok') {
      try {
        await this.assertObjectExists(path);
        read = 'ok';
      } catch (e: any) {
        read = `fail: ${String(e?.message ?? e).slice(0, 300)}`;
      }
    }
    const fallbacksAfter = storageTransportState.totalFallbackSuccesses + storageTransportState.totalFallbackFailures;
    const ok = upload === 'ok' && read === 'ok';
    const transport = !ok ? 'none' : fallbacksAfter > fallbacksBefore ? 'fallback' : 'primary';
    return { ok, transport, upload, read, ms: Date.now() - started };
  }
}
