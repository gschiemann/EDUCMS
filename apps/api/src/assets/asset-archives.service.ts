import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import { extname, resolve } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import JSZip from 'jszip';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import type { AuditActorFields } from '../audit/audit-actor';

export const ARCHIVE_MAX_BYTES = 2 ** 31 - 1024 * 1024;
const PREPARE_MS = 30_000;
/**
 * The hosting proxy (Railway) cuts a response at 15 minutes even while data
 * flows. Stop at 14 so the download ends on our own clean error and the lease
 * is released by us, not by a cut we never see coming.
 */
export const ARCHIVE_DOWNLOAD_MS = 14 * 60_000;
/**
 * A running download's lease (the tenant key and its global slot) lives this
 * long, and is renewed every ARCHIVE_LEASE_REFRESH_MS while bytes flow. It used
 * to be set to 25 minutes when the download started and released only in
 * `finally`, so a container killed mid-download (every deploy) locked that
 * tenant out — and with two of them, every tenant — for 25 minutes.
 */
export const ARCHIVE_LEASE_TTL_SECONDS = 60;
export const ARCHIVE_LEASE_REFRESH_MS = 20_000;
const PREFIX = 'asset-archive:{downloads}:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET = /^[A-Za-z0-9_-]{43}$/;
const EXPIRED =
  'This ZIP download has expired or already started. Select the files and download again.';
const keys = (tenant: string, slot: number) => [
  PREFIX + 'tenant:' + tenant,
  PREFIX + 'slot:' + slot,
];
const ticketKey = (ticket: string) =>
  PREFIX + 'ticket:' + createHash('sha256').update(ticket).digest('hex');
const ACQUIRE = `if redis.call('EXISTS',KEYS[1])==1 or redis.call('EXISTS',KEYS[2])==1 then return 0 end
redis.call('SET',KEYS[1],ARGV[1],'EX',120); redis.call('SET',KEYS[2],ARGV[1],'EX',120); return 1`;
const RELEASE = `for _,key in ipairs(KEYS) do if redis.call('GET',key)==ARGV[1] then redis.call('DEL',key) end end return 1`;
// Extends only keys this download still owns; returns how many it renewed.
const REFRESH = `local n=0 for _,key in ipairs(KEYS) do if redis.call('GET',key)==ARGV[1] then redis.call('EXPIRE',key,ARGV[2]) n=n+1 end end return n`;
const CONSUME = `local data=redis.call('GET',KEYS[1]); if not data then return nil end
redis.call('DEL',KEYS[1]); local grant=cjson.decode(data)
local tenant='${PREFIX}tenant:'..grant.tenantId; local slot='${PREFIX}slot:'..grant.slot
if redis.call('GET',tenant)~=grant.owner or redis.call('GET',slot)~=grant.owner then return nil end
redis.call('EXPIRE',tenant,ARGV[1]); redis.call('EXPIRE',slot,ARGV[1]); return data`;

type FileRow = {
  id: string;
  fileUrl: string;
  originalName: string | null;
  mimeType: string;
};
type Entry = { id: string; fileUrl: string; name: string; size: number };
type Grant = {
  tenantId: string;
  actor: AuditActorFields;
  owner: string;
  slot: number;
  entries: Entry[];
  filename: string;
};

/** Flat, portable names: never directories, and duplicate names never overwrite files. */
export function archiveNames(names: Array<string | null>): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    let name = (raw || `asset-${i + 1}`)
      .normalize('NFC')
      // Control characters are deliberately removed from archive filenames.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f/\\<>:"|?*]/g, '_')
      .trim()
      .replace(/[. ]+$/g, '');
    name = name.slice(0, 180) || `asset-${i + 1}`;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
      name = '_' + name;
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++)
      candidate = `${stem} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

@Injectable()
export class AssetArchivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly redis: RedisService,
  ) {}

  private cache() {
    if (!this.redis.publisher || this.redis.publisher.status !== 'ready')
      throw new ServiceUnavailableException(
        'ZIP downloads are temporarily unavailable. Please try again.',
      );
    return this.redis.publisher;
  }

  private async release(grant: Pick<Grant, 'tenantId' | 'slot' | 'owner'>) {
    // Never remove a lease that a subsequent request owns. Redis TTL is the
    // fallback if the replica disappears or loses its Redis connection.
    await this.redis.publisher
      ?.eval(RELEASE, 2, ...keys(grant.tenantId, grant.slot), grant.owner)
      .catch(() => undefined);
  }

  private async rows(tenantId: string, ids: string[]): Promise<FileRow[]> {
    if (
      !UUID.test(tenantId) ||
      !Array.isArray(ids) ||
      ids.length < 2 ||
      ids.length > 50 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string' || !UUID.test(id))
    ) {
      throw new BadRequestException(
        'Select between 2 and 50 uploaded files for a ZIP.',
      );
    }
    const rows = await this.prisma.client.asset.findMany({
      where: { tenantId, id: { in: ids }, status: { not: 'ARCHIVED' } },
      select: { id: true, fileUrl: true, originalName: true, mimeType: true },
    });
    if (rows.length !== ids.length)
      throw new NotFoundException(
        'One or more selected files are unavailable in this account. Refresh the library and try again.',
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)!);
  }

  /**
   * Files in another tenant's folder that this selection may still read.
   *
   * Fleet distribution gives a location its own asset row whose `fileUrl`
   * points at the PARENT's object (playlist-distribution.service.ts), so a
   * location's library legitimately holds files outside its own folder. Such a
   * file is readable here only under the rule media-publication.service.ts
   * applies to the same copies: the tenant whose folder holds it must still
   * have a row serving exactly this URL. One query for the whole selection.
   * The caller's OWN rows were already selected by its tenant id (rows()), so
   * this never widens which asset ids a tenant can name.
   */
  private async sharedFiles(
    tenantId: string,
    rows: FileRow[],
  ): Promise<Set<string>> {
    const foreign = rows.flatMap((row) => {
      const object = this.storage.parseObjectUrl(row.fileUrl);
      const owner =
        object?.bucket === 'assets' ? object.path.split('/')[0] : undefined;
      return owner && owner !== tenantId && UUID.test(owner)
        ? [{ tenantId: owner, fileUrl: row.fileUrl }]
        : [];
    });
    if (!foreign.length) return new Set();
    const held = await this.prisma.client.asset.findMany({
      where: { OR: foreign },
      select: { fileUrl: true },
    });
    return new Set(held.map((row) => row.fileUrl));
  }

  private source(
    row: FileRow,
    tenantId: string,
    shared: ReadonlySet<string>,
  ): { url: string } | { path: string } {
    if (row.mimeType === 'text/html')
      throw new BadRequestException(
        'Web links cannot be put in a ZIP. Select uploaded files instead.',
      );
    if (
      /^\/api\/v1\/assets\/file\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(row.fileUrl)
    ) {
      const root = resolve(
        process.cwd(),
        process.env.UPLOAD_DIR ||
          (process.env.NODE_ENV === 'production'
            ? '/tmp/uploads'
            : './uploads'),
      );
      return { path: resolve(root, row.fileUrl.split('/').pop()!) };
    }
    const object = this.storage.parseObjectUrl(row.fileUrl);
    if (
      !object ||
      object.bucket !== 'assets' ||
      !(object.path.startsWith(tenantId + '/') || shared.has(row.fileUrl)) ||
      object.path
        .split('/')
        .some((p) => !p || p === '..' || p === '.' || p.includes('\\'))
    ) {
      throw new BadRequestException(
        'This selection contains a file hosted outside this account’s media library.',
      );
    }
    const canonical = new URL(this.storage.publicUrlForPath(object.path));
    const original = new URL(row.fileUrl);
    if (
      original.origin !== canonical.origin ||
      original.username ||
      original.password ||
      !['https:', 'http:'].includes(canonical.protocol)
    )
      throw new BadRequestException('Unsupported file storage URL.');
    return { url: canonical.href };
  }

  async prepare(tenantId: string, actor: AuditActorFields, ids: string[]) {
    const rows = await this.rows(tenantId, ids);
    const cache = this.cache();
    const owner = randomBytes(24).toString('base64url');
    let slot = -1;
    try {
      for (let i = 0; i < 2; i++) {
        if (
          Number(await cache.eval(ACQUIRE, 2, ...keys(tenantId, i), owner)) ===
          1
        ) {
          slot = i;
          break;
        }
      }
    } catch {
      throw new ServiceUnavailableException(
        'ZIP downloads are temporarily unavailable. Please try again.',
      );
    }
    if (slot < 0)
      throw new ConflictException(
        'A ZIP download is already being prepared or downloaded. Please try again when it finishes.',
      );
    const names = archiveNames(rows.map((row) => row.originalName));
    const grant: Grant = {
      tenantId,
      actor,
      owner,
      slot,
      entries: [],
      filename: `VenueOS-assets-${new Date().toISOString().slice(0, 10)}.zip`,
    };
    const signal = AbortSignal.timeout(PREPARE_MS);
    try {
      const shared = await this.sharedFiles(tenantId, rows);
      // Verify every selected object BEFORE authorizing an archive, with at
      // most four metadata requests and a 30-second overall preparation budget.
      for (let offset = 0; offset < rows.length; offset += 4) {
        const batch = await Promise.all(
          rows.slice(offset, offset + 4).map(async (row, i) => {
            const source = this.source(row, tenantId, shared);
            let size: number;
            if ('path' in source) {
              const stat = await fs.stat(source.path);
              if (!stat.isFile()) throw new Error('Not a file');
              size = stat.size;
            } else {
              const response = await fetch(source.url, {
                method: 'HEAD',
                redirect: 'error',
                signal,
              });
              if (!response.ok) throw new Error('File unavailable');
              const length = response.headers.get('content-length');
              size = length === null ? NaN : Number(length);
            }
            if (!Number.isSafeInteger(size) || size < 0)
              throw new Error('Unknown file size');
            return {
              id: row.id,
              fileUrl: row.fileUrl,
              name: names[offset + i],
              size,
            };
          }),
        );
        grant.entries.push(...batch);
        if (
          grant.entries.reduce((n, entry) => n + entry.size, 0) >
          ARCHIVE_MAX_BYTES
        )
          throw new BadRequestException(
            'ZIP downloads are limited to 2 GB. Select fewer files and try again.',
          );
      }
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          ...actor,
          action: 'ASSET_ARCHIVE_DOWNLOAD_PREPARED',
          targetType: 'Asset',
          details: JSON.stringify({
            assetIds: ids,
            fileCount: ids.length,
            totalBytes: grant.entries.reduce((n, e) => n + e.size, 0),
          }),
        },
      });
      const ticket = randomBytes(32).toString('base64url');
      await cache.set(ticketKey(ticket), JSON.stringify(grant), 'EX', 60);
      return { ticket, filename: grant.filename };
    } catch (error) {
      await this.release(grant);
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException(
        'Could not prepare all selected files. No ZIP was started. Please try again.',
      );
    }
  }

  /**
   * HEAD on the ticket link. Express answers HEAD with the GET handler, and
   * that handler SPENDS the single-use ticket — so a web filter, proxy or
   * download manager probing the link first left the real GET a 404. This
   * peeks at the grant (one Redis GET) and never consumes or leases anything.
   */
  async head(ticket: string, response: Response) {
    if (!TICKET.test(ticket)) throw new NotFoundException(EXPIRED);
    let data: unknown;
    try {
      data = await this.cache().get(ticketKey(ticket));
    } catch {
      throw new ServiceUnavailableException(
        'ZIP downloads are temporarily unavailable. Please try again.',
      );
    }
    if (typeof data !== 'string') throw new NotFoundException(EXPIRED);
    const grant = JSON.parse(data) as Grant;
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${grant.filename}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.status(200).end();
  }

  async download(ticket: string, response: Response) {
    if (!TICKET.test(ticket))
      throw new NotFoundException(
        'This ZIP download has expired. Select the files and download again.',
      );
    let data: unknown;
    try {
      data = await this.cache().eval(
        CONSUME,
        1,
        ticketKey(ticket),
        ARCHIVE_LEASE_TTL_SECONDS,
      );
    } catch {
      throw new ServiceUnavailableException(
        'ZIP downloads are temporarily unavailable. Please try again.',
      );
    }
    if (typeof data !== 'string') throw new NotFoundException(EXPIRED);
    const grant = JSON.parse(data) as Grant;
    const abort = new AbortController();
    const timeout = setTimeout(
      () => abort.abort(new Error('ZIP download timed out')),
      ARCHIVE_DOWNLOAD_MS,
    );
    timeout.unref();
    // Renew the short lease only while bytes are actually moving: a dead
    // container stops renewing and frees the tenant within a minute, and so
    // does a client that stopped reading.
    let total = 0;
    let renewedAt = 0;
    const lease = setInterval(() => {
      if (total === renewedAt) return;
      renewedAt = total;
      void this.redis.publisher
        ?.eval(
          REFRESH,
          2,
          ...keys(grant.tenantId, grant.slot),
          grant.owner,
          ARCHIVE_LEASE_TTL_SECONDS,
        )
        .catch(() => undefined);
    }, ARCHIVE_LEASE_REFRESH_MS);
    lease.unref();
    const inputs: Readable[] = [];
    let output: Readable | undefined;
    const close = () => {
      if (!response.writableFinished)
        abort.abort(new Error('Download cancelled'));
    };
    const stop = () => {
      inputs.forEach((input) => input.destroy());
      output?.destroy(
        abort.signal.reason instanceof Error
          ? abort.signal.reason
          : new Error('Download cancelled'),
      );
    };
    response.once('close', close);
    abort.signal.addEventListener('abort', stop, { once: true });
    try {
      const rows = await this.rows(
        grant.tenantId,
        grant.entries.map((entry) => entry.id),
      );
      rows.forEach((row, i) => {
        if (row.fileUrl !== grant.entries[i].fileUrl)
          throw new ConflictException(
            'A selected file changed. Prepare the ZIP again.',
          );
      });
      const shared = await this.sharedFiles(grant.tenantId, rows);
      const sources = rows.map((row) =>
        this.source(row, grant.tenantId, shared),
      );
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: grant.tenantId,
          ...grant.actor,
          action: 'ASSET_ARCHIVE_DOWNLOAD_STARTED',
          targetType: 'Asset',
          details: JSON.stringify({
            assetIds: rows.map((row) => row.id),
            fileCount: rows.length,
          }),
        },
      });
      const zip = new JSZip();
      grant.entries.forEach((entry, i) => {
        const source = sources[i];
        // JSZip resumes each input in turn. No video is buffered in RAM and
        // no storage connection is opened for files not yet being consumed.
        const input = Readable.from(
          (async function* () {
            let bytes = 0;
            let stream: AsyncIterable<Uint8Array>;
            if ('path' in source)
              stream = createReadStream(source.path, {
                signal: abort.signal,
                highWaterMark: 64 * 1024,
              });
            else {
              const remote = await fetch(source.url, {
                redirect: 'error',
                signal: abort.signal,
              });
              if (!remote.ok || !remote.body) {
                await remote.body?.cancel();
                throw new Error('Selected file became unavailable');
              }
              stream = remote.body as unknown as AsyncIterable<Uint8Array>;
            }
            for await (const chunk of stream) {
              bytes += chunk.byteLength;
              total += chunk.byteLength;
              if (bytes > entry.size || total > ARCHIVE_MAX_BYTES)
                throw new Error('Selected file exceeded its verified size');
              yield Buffer.from(chunk);
            }
            if (bytes !== entry.size)
              throw new Error('Selected file was incomplete');
          })(),
          { objectMode: false, highWaterMark: 64 * 1024 },
        );
        // jszip 3.10.1 (NodejsStreamInputAdapter) STORES an error that arrives
        // while it has this input paused for backpressure — and Readable.from
        // keeps reading ahead while paused, so a storage reset or a size check
        // usually lands exactly then — and never reports it: the response
        // just stops until the proxy cuts it. Fail the whole download instead.
        input.on('error', (error) => abort.abort(error));
        inputs.push(input);
        zip.file(entry.name, input);
      });
      // STORE is deliberate: MP4/JPEG are already compressed; re-compressing
      // them consumes API CPU while doing virtually nothing for ZIP size.
      output = zip.generateNodeStream({
        streamFiles: true,
        compression: 'STORE',
      }) as Readable;
      response.setHeader('Content-Type', 'application/zip');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${grant.filename}"`,
      );
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('Referrer-Policy', 'no-referrer');
      await pipeline(output, response);
    } finally {
      clearTimeout(timeout);
      clearInterval(lease);
      response.off('close', close);
      abort.signal.removeEventListener('abort', stop);
      abort.abort();
      inputs.forEach((input) => input.destroy());
      await this.release(grant);
    }
  }
}
