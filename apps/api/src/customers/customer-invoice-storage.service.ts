import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

export const INVOICE_PDF_LIMIT = 10 * 1024 * 1024;
const BUCKET = 'customer-invoices';

export function validateInvoicePdf(file?: Express.Multer.File): {
  fileName: string;
  sizeBytes: number;
} {
  if (
    !file?.buffer ||
    file.mimetype !== 'application/pdf' ||
    !/\.pdf$/i.test(file.originalname)
  )
    throw new BadRequestException('Upload a PDF invoice.');
  if (file.buffer.length > INVOICE_PDF_LIMIT || file.buffer.length < 20)
    throw new BadRequestException('PDF must be between 20 bytes and 10 MiB.');
  if (
    !file.buffer
      .subarray(0, 8)
      .toString('ascii')
      .match(/^%PDF-\d\.\d/) ||
    !file.buffer.subarray(-2048).includes(Buffer.from('%%EOF'))
  )
    throw new BadRequestException('This file does not contain a complete PDF.');
  // Download-only storage; reject obvious active payloads too. This is a file format check, not an antivirus claim.
  const source = file.buffer.toString('latin1');
  if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/i.test(source))
    throw new BadRequestException(
      'Invoice PDFs must not contain scripts or embedded files.',
    );
  const fileName = file.originalname
    .split(/[\\/]/)
    .pop()!
    .replace(/[^a-zA-Z0-9 ._()-]/g, '_')
    .slice(-160);
  return { fileName, sizeBytes: file.buffer.length };
}

@Injectable()
export class CustomerInvoiceStorageService {
  private client: SupabaseClient | null = null;
  private getClient() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
      throw new ServiceUnavailableException({
        code: 'INVOICE_STORAGE_UNAVAILABLE',
        message: 'Private invoice storage is not configured.',
      });
    return (this.client ??= createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    ));
  }
  private async privateBucket() {
    const client = this.getClient();
    let result = await client.storage.getBucket(BUCKET);
    const bucketError = result.error as {
      status?: number;
      statusCode?: string;
    } | null;
    if (
      bucketError &&
      String(bucketError.status ?? bucketError.statusCode) === '404'
    ) {
      await client.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: INVOICE_PDF_LIMIT,
        allowedMimeTypes: ['application/pdf'],
      });
      result = await client.storage.getBucket(BUCKET); // Also handles a concurrent creator.
    }
    if (result.error || !result.data || result.data.public)
      throw new ServiceUnavailableException({
        code: 'INVOICE_STORAGE_UNAVAILABLE',
        message: 'Invoice storage must be a private bucket.',
      });
    return client.storage.from(BUCKET);
  }
  async upload(tenantId: string, invoiceId: string, buffer: Buffer) {
    const bucket = await this.privateBucket();
    const path = `${tenantId}/${invoiceId}/${randomUUID()}.pdf`;
    const { error } = await bucket.upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (error)
      throw new ServiceUnavailableException('Invoice PDF upload failed.');
    return path;
  }
  async download(
    path: string,
    tenantId: string,
    invoiceId: string,
    fileName: string,
  ) {
    if (
      !path.startsWith(`${tenantId}/${invoiceId}/`) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i.test(
        path.slice(`${tenantId}/${invoiceId}/`.length),
      )
    )
      throw new BadRequestException('Invalid invoice attachment.');
    const bucket = await this.privateBucket();
    const { data, error } = await bucket.createSignedUrl(path, 300, {
      download: fileName,
    });
    if (error || !data?.signedUrl)
      throw new ServiceUnavailableException('Invoice download is unavailable.');
    return {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      fileName,
    };
  }
  async remove(path: string) {
    const bucket = await this.privateBucket();
    const { error } = await bucket.remove([path]);
    if (error)
      throw new ServiceUnavailableException('Invoice PDF cleanup failed.');
  }
}
