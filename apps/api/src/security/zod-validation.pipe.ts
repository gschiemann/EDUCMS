import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        code: i.code,
        message: i.message,
      }));
      throw new BadRequestException({
        error: 'ValidationError',
        // A readable sentence for the dashboard to show (2026-10-11). Without
        // it the exception filter fell back to Nest's class name and every
        // form error read "Bad Request Exception".
        message: validationMessage(issues),
        issues,
      });
    }
    return result.data as T;
  }
}

/** "name: Required; email: Invalid email" — the first few issues, field first. */
export function validationMessage(issues: Array<{ path: string; message: string }>): string {
  if (issues.length === 0) return 'Some of the information sent was not valid.';
  const parts = issues.slice(0, 3).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
  const more = issues.length > 3 ? ` (and ${issues.length - 3} more)` : '';
  return `Please check ${parts.join('; ')}${more}`;
}
