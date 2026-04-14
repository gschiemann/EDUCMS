import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScreensController } from './screens/screens.controller';
import { EmergencyController } from './emergency/emergency.controller';
import { StatsController } from './stats/stats.controller';
import { AuditController } from './audit/audit.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_PIPE, APP_INTERCEPTOR } from '@nestjs/core';
import { SanitizationPipe } from './security/sanitization.pipe';
import { AuditInterceptor } from './security/audit.interceptor';
import { AnomalyMiddleware } from './security/anomaly.middleware';

@Module({
  imports: [
    PrismaModule,
    AuthModule, 
    RealtimeModule,
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100, 
    }]),
  ],
  controllers: [AppController, ScreensController, EmergencyController, StatsController, AuditController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_PIPE,
      useClass: SanitizationPipe,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    }
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AnomalyMiddleware)
      .forRoutes('*');
  }
}
