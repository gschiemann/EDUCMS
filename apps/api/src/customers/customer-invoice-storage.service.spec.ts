import {
  CustomerInvoiceStorageService,
  INVOICE_PDF_LIMIT,
  validateInvoicePdf,
} from './customer-invoice-storage.service';
const pdf = (
  content = '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n',
) =>
  ({
    originalname: 'invoice.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from(content),
  }) as Express.Multer.File;

describe('private invoice attachments', () => {
  it('validates actual PDF bytes, MIME, extension, completeness and size', () => {
    expect(validateInvoicePdf(pdf()).fileName).toBe('invoice.pdf');
    expect(() =>
      validateInvoicePdf(pdf('not a pdf at all, merely named invoice.pdf')),
    ).toThrow();
    expect(() =>
      validateInvoicePdf(pdf('%PDF-1.7\ntruncated content')),
    ).toThrow();
    expect(() =>
      validateInvoicePdf({
        ...pdf(),
        buffer: Buffer.alloc(INVOICE_PDF_LIMIT + 1),
      }),
    ).toThrow();
    expect(() =>
      validateInvoicePdf({ ...pdf(), mimetype: 'text/html' }),
    ).toThrow();
    expect(() =>
      validateInvoicePdf(pdf('%PDF-1.7\n/JavaScript (alert(1))\n%%EOF')),
    ).toThrow();
  });
  it('refuses a public storage bucket before writing or signing', async () => {
    const service = new CustomerInvoiceStorageService();
    const from = jest.fn();
    jest
      .spyOn(service as any, 'getClient')
      .mockReturnValue({
        storage: {
          getBucket: async () => ({ data: { public: true }, error: null }),
          from,
        },
      });
    await expect(
      service.upload('root', 'invoice', pdf().buffer),
    ).rejects.toMatchObject({ status: 503 });
    expect(from).not.toHaveBeenCalled();
  });
  it('signed downloads are short-lived attachments and confined to the exact tenant/invoice prefix', async () => {
    const service = new CustomerInvoiceStorageService();
    const createSignedUrl = jest.fn(async () => ({
      data: { signedUrl: 'https://private.test/signed' },
      error: null,
    }));
    jest
      .spyOn(service as any, 'privateBucket')
      .mockResolvedValue({ createSignedUrl });
    await expect(
      service.download('other/invoice/a.pdf', 'root', 'invoice', 'i.pdf'),
    ).rejects.toMatchObject({ status: 400 });
    await service.download(
      'root/invoice/12345678-1234-4123-8123-123456789abc.pdf',
      'root',
      'invoice',
      'i.pdf',
    );
    expect(createSignedUrl).toHaveBeenCalledWith(
      'root/invoice/12345678-1234-4123-8123-123456789abc.pdf',
      300,
      { download: 'i.pdf' },
    );
  });
  it.each([
    '../secret.pdf',
    '%2e%2e%2fsecret.pdf',
    'nested/file.pdf',
    'file\\name.pdf',
    'file.pdf?token=other',
  ])(
    'rejects malformed object suffix %s before touching storage',
    async (suffix) => {
      const service = new CustomerInvoiceStorageService();
      const bucket = jest.spyOn(service as any, 'privateBucket');
      await expect(
        service.download(`root/invoice/${suffix}`, 'root', 'invoice', 'i.pdf'),
      ).rejects.toMatchObject({ status: 400 });
      expect(bucket).not.toHaveBeenCalled();
    },
  );
  it('fails closed on bucket lookup errors and a public concurrently-created bucket', async () => {
    const service = new CustomerInvoiceStorageService();
    const createBucket = jest.fn(async () => ({ error: null }));
    const getBucket = jest
      .fn()
      .mockResolvedValueOnce({ error: { statusCode: '404' } })
      .mockResolvedValueOnce({ data: { public: true } });
    const from = jest.fn();
    jest
      .spyOn(service as any, 'getClient')
      .mockReturnValue({ storage: { getBucket, createBucket, from } });
    await expect(
      service.upload('root', 'invoice', pdf().buffer),
    ).rejects.toMatchObject({ status: 503 });
    expect(createBucket).toHaveBeenCalledWith('customer-invoices', {
      public: false,
      fileSizeLimit: INVOICE_PDF_LIMIT,
      allowedMimeTypes: ['application/pdf'],
    });
    expect(from).not.toHaveBeenCalled();
    getBucket.mockResolvedValueOnce({ error: { status: 403 } });
    await expect(
      service.upload('root', 'invoice', pdf().buffer),
    ).rejects.toMatchObject({ status: 503 });
    expect(createBucket).toHaveBeenCalledTimes(1);
  });
  it('creates a fresh immutable object per upload and propagates provider failures', async () => {
    const service = new CustomerInvoiceStorageService();
    const upload = jest.fn(async () => ({ error: null }));
    const remove = jest.fn(async () => ({ error: { message: 'unavailable' } }));
    const createSignedUrl = jest.fn(async () => ({
      data: null,
      error: { message: 'unavailable' },
    }));
    jest
      .spyOn(service as any, 'privateBucket')
      .mockResolvedValue({ upload, remove, createSignedUrl });
    const first = await service.upload('root', 'invoice', pdf().buffer);
    const second = await service.upload('root', 'invoice', pdf().buffer);
    expect(first).not.toBe(second);
    expect(upload).toHaveBeenCalledWith(first, pdf().buffer, {
      contentType: 'application/pdf',
      upsert: false,
    });
    await expect(
      service.download(first, 'root', 'invoice', 'i.pdf'),
    ).rejects.toMatchObject({ status: 503 });
    await expect(service.remove(first)).rejects.toMatchObject({ status: 503 });
  });
});
