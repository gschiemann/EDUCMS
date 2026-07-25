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

  private sanitizeObject(obj: any): any {
    const sanitizedObj = Array.isArray(obj) ? [] : {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const val = obj[key];
        if (typeof val === 'string') {
          sanitizedObj[key] = this.sanitizeString(val);
        } else if (typeof val === 'object' && val !== null) {
          sanitizedObj[key] = this.sanitizeObject(val);
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
