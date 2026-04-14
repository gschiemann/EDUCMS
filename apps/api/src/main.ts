import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import * as session from 'express-session';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));

  // Mandatory: Helmet for basic strict transport + CSP
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  app.use(cookieParser());

  // Manadatory: Secure cookie strategy & session mechanics
  app.use(
    session({
      secret: process.env.SESSION_SECRET || (() => {
        if (process.env.NODE_ENV === 'production') throw new Error('CRITICAL: SESSION_SECRET missing in production');
        return 'fallback_dev_secret_change_me';
      })(),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // true over HTTPS
        sameSite: 'strict',
        maxAge: 15 * 60 * 1000, // 15 mins (Aligns with short-lived tokens requirement)
      },
      name: 'edu_cms_sid',
    }),
  );

  // Mandatory: CORS limited to tenant portals in production
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 8080);
}
bootstrap();
