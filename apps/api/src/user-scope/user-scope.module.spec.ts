/**
 * The list routes that narrow with `req.userScope` (screens, screen-groups,
 * schedules, display-schedules) and every route the policy refuses rely on
 * UserScopeInterceptor having run. Pin that it is a GLOBAL interceptor and
 * that the app imports the module — a refactor that drops either would open
 * every screen-scoped person to their whole location.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { UserScopeModule } from './user-scope.module';
import { UserScopeInterceptor } from './user-scope.interceptor';
import { UserScopeService } from './user-scope.service';

describe('UserScopeModule', () => {
  it('registers the interceptor as APP_INTERCEPTOR and is @Global', () => {
    const providers: any[] = Reflect.getMetadata('providers', UserScopeModule) ?? [];
    expect(providers).toContainEqual({ provide: APP_INTERCEPTOR, useClass: UserScopeInterceptor });
    expect(providers).toContain(UserScopeService);
    expect(Reflect.getMetadata('__module:global__', UserScopeModule)).toBe(true);
  });

  it('is imported by AppModule', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../app.module.ts'), 'utf8');
    expect(src).toMatch(/import \{ UserScopeModule \} from '\.\/user-scope\/user-scope\.module'/);
    expect(src).toMatch(/^\s+UserScopeModule,$/m);
  });
});
