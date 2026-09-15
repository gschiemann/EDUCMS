import { SanitizationPipe } from './sanitization.pipe';

describe('SanitizationPipe Security Properties', () => {
  let pipe: SanitizationPipe;

  beforeEach(() => {
    pipe = new SanitizationPipe();
  });

  describe('HTML Payload Injection Protection', () => {
    it('should sanitize raw strings containing malicious scripts', () => {
      const malicious = '<script>alert("xss")</script><b>Hello</b>';
      const result = pipe.transform(malicious, { type: 'body' });
      expect(result).not.toContain('<script>');
      expect(result).toContain('<b>Hello</b>');
    });

    it('should sanitize deeply nested object properties', () => {
      const payload = {
        title: 'Valid Title',
        metadata: {
          bio: '<img src=x onerror=alert(1)> and some text'
        }
      };
      
      const result = pipe.transform(payload, { type: 'body' });
      expect(result.metadata.bio).not.toContain('onerror=alert(1)');
      // sanitize-html will wipe the bad attrs but potentially leave the img or text
      expect(result.metadata.bio).toContain('and some text');
    });

    it('should preserve standard valid HTML structure defined in policy', () => {
      const validHTML = '<p>Normal text <b>bold</b> and <i>italic</i></p>';
      const result = pipe.transform(validHTML, { type: 'body' });
      expect(result).toEqual(validHTML);
    });
  });
});

/**
 * The pipe is global, so it sees every uploaded file. It used to rebuild them.
 *
 * `@UploadedFile()` is an object whose `buffer` is a Buffer, which is also an
 * object — so the recursive clone walked it byte by byte into a plain object
 * with one numeric property per byte. That is both a correctness bug
 * (`Buffer.isBuffer` went false, which is why `toSafeBuffer` exists) and a
 * serious memory one, on a single-replica process that also publishes lockdown
 * alerts.
 */
describe('SanitizationPipe — binary passes through untouched', () => {
  const pipe = new SanitizationPipe();
  const meta = { type: 'custom' } as any;

  it('hands back the SAME Buffer instance, not a copy of it', () => {
    const buffer = Buffer.from('%PDF-1.7 binary \x00\x01\x02');
    const file = { fieldname: 'file', originalname: 'deck.pdf', mimetype: 'application/pdf', size: buffer.length, buffer };
    const out = pipe.transform(file, meta);
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
    // Identity, not equality: a copy would still be a Buffer but would have
    // cost a full duplicate of the upload.
    expect(out.buffer).toBe(buffer);
    expect(out.buffer.length).toBe(buffer.length);
  });

  it('does not explode the heap on a realistic upload', () => {
    // The regression this guards is not subtle: 8 MB in cost 431 MB of heap
    // and 771 ms before the fix, and a 50 MB upload extrapolated to ~2.7 GB.
    const buffer = Buffer.alloc(8 * 1024 * 1024, 7);
    const before = process.memoryUsage().heapUsed;
    const t0 = Date.now();
    const out = pipe.transform({ fieldname: 'file', buffer, size: buffer.length }, meta);
    const grewMb = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
    expect(grewMb).toBeLessThan(16);
    expect(Date.now() - t0).toBeLessThan(250);
  });

  it('leaves typed arrays, dates and streams alone', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const when = new Date('2026-09-15T00:00:00Z');
    const stream = { pipe: () => undefined, on: () => undefined };
    const out = pipe.transform({ bytes, when, stream }, meta);
    expect(out.bytes).toBe(bytes);
    expect(out.when).toBe(when);
    expect(out.stream).toBe(stream);
  });

  it('still sanitizes the text fields sitting beside the binary', () => {
    // The whole point is that skipping binary costs nothing elsewhere.
    const buffer = Buffer.from('bytes');
    const out = pipe.transform(
      { buffer, originalname: '<script>alert(1)</script>report.pdf', note: 'Tom & Jerry' },
      meta,
    );
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
    expect(out.originalname).not.toContain('<script>');
    // …and the 2026-07-25 ampersand fix is still in force.
    expect(out.note).toBe('Tom & Jerry');
  });
});

