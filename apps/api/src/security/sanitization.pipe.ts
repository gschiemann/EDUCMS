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
