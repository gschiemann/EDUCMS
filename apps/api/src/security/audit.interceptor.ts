import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditLog');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, url, ip } = req;
    
    // In compliance with "immutable audit logs for privileged actions"
    // We filter for mutating operations implicitly tied to backend overrides
    const isPrivilegedAction = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
    
    if (!isPrivilegedAction) {
      return next.handle();
    }

    const userId = (req as any).user?.id || 'anonymous';
    const timestamp = new Date().toISOString();

    return next.handle().pipe(
      tap(() => {
        // Here we output to stdout which is consumed by an immutable log shipper (e.g. FluentBit -> S3/CloudWatch)
        this.logger.log(JSON.stringify({
          eventType: 'PRIVILEGED_ACTION_AUDIT',
          timestamp,
          actorId: userId,
          ipAddress: ip,
          action: method,
          resource: url,
          status: 'SUCCESS'
        }));
      }),
    );
  }
}
