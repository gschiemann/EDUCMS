import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';

@Injectable()
export class SanitizationPipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {
    if (typeof value === 'object' && value !== null) {
      return this.sanitizeObject(value);
    }
    if (typeof value === 'string') {
      return this.sanitizeString(value);
    }
    return value;
  }

  /**
   * Values this pipe must hand back untouched, because cloning them destroys
   * them and there is no markup inside them to sanitize.
   *
   * 2026-09-15 — the pipe used to recurse into ANY object, and `@UploadedFile()`
   * is an object whose `buffer` is a Buffer, which is also an object. So every
   * upload in this app was rebuilt key by key into a plain object with one
   * numeric property PER BYTE. Measured on the real pipe:
   *
   *     1 MB upload  →  56 MB of heap,  94 ms
   *     8 MB upload  → 431 MB of heap, 771 ms
   *
   * At the 50 MB upload cap that extrapolates to roughly 2.7 GB of HEAP — not
   * external Buffer memory that a heap ceiling cannot see, but heap — inside a
   * single-replica process that also publishes lockdown alerts. It also meant
   * `Buffer.isBuffer(file.buffer)` was false everywhere, which is why
   * `SupabaseStorageService.toSafeBuffer` exists at all: it has been quietly
   * reassembling the damage on every upload path for months.
   *
   * Binary, dates and streams carry nothing an HTML sanitizer acts on, so
   * skipping them removes a large cost and a correctness bug without weakening
   * anything. Strings, arrays and plain objects are sanitized exactly as before.
   */
  private isOpaque(val: object): boolean {
    return (
      Buffer.isBuffer(val) ||
      ArrayBuffer.isView(val) ||
      val instanceof ArrayBuffer ||
      val instanceof Date ||
      val instanceof RegExp ||
      typeof (val as { pipe?: unknown }).pipe === 'function'
    );
  }

  private sanitizeObject(obj: any): any {
    if (this.isOpaque(obj)) return obj;
    const sanitizedObj = Array.isArray(obj) ? [] : {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const val = obj[key];
        if (typeof val === 'string') {
          sanitizedObj[key] = this.sanitizeString(val);
        } else if (typeof val === 'object' && val !== null) {
          sanitizedObj[key] = this.isOpaque(val) ? val : this.sanitizeObject(val);
        } else {
          sanitizedObj[key] = val;
        }
      }
    }
    return sanitizedObj;
  }

  private sanitizeString(value: string): string {
    // 2026-07-25 — DO NOT run the HTML sanitizer over plain scalar strings.
    // sanitize-html entity-escapes `&`, so a value that contains no markup at
    // all was still rewritten: `https://x.com/a?b=1&c=2` came back as
    // `...&amp;c=2`. This pipe is registered globally (APP_PIPE), so EVERY query
    // param and body string with an `&` was corrupted — any URL with two or
    // more query params, plus ordinary copy like "Q&A" or "Tom & Jerry".
    //
    // A string containing neither `<` nor `>` cannot open a tag, so there is no
    // markup for an HTML sanitizer to remove; escaping `&` in it buys nothing
    // and breaks real data. Anything that DOES look like markup still goes
    // through the full sanitizer below, unchanged. (Output encoding remains the
    // real XSS defense — React escapes text nodes on render.)
    if (!/[<>]/.test(value)) return value;
    // Mandates strict HTML sanitization policy per the baseline
    return sanitizeHtml(value, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'img' ]),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        '*': ['style'] // Adjust based on strict organizational needs
      },
    });
  }
}
