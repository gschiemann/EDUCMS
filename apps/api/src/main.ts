import { config } from 'dotenv';
import { resolve } from 'path';

// Load env from apps/api/.env first, then fall back to monorepo root .env
config({ path: resolve(__dirname, '..', '.env') });
config({ path: resolve(__dirname, '..', '..', '..', '.env') });

// Sentry must be initialised before any other imports that may instrument code
import './sentry';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';
import { PrismaService } from './prisma/prisma.service';
import { ensureSystemPresets } from './templates/ensure-system-presets';
import { requireSecret } from './security/required-secret';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

// Last-resort crash guards. ioredis, Prisma, and passport-saml can all
// surface unhandled rejections on network flaps; we'd rather log than
// let Railway restart the container mid-demo.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[uncaughtException]', err);
});

/* eslint-disable @typescript-eslint/no-var-requires */
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));

  // Global exception filter — normalizes all error responses, scrubs
  // stack traces in prod, and captures 5xx to Sentry with route tags.
  // Registered BEFORE listen so it catches startup-adjacent errors too.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Mandatory: Helmet for basic strict transport + CSP
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'self'", "https:", "http:"], // Allow iframe previews
          imgSrc: ["'self'", "data:", "http:", "https:"], // Allow cross-origin images
          mediaSrc: ["'self'", "http:", "https:"], // Allow cross-origin video/audio
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow assets to be loaded cross-origin
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
      // sec-fix(wave1) #2: throws at boot in prod if SESSION_SECRET is unset.
      secret: requireSecret('SESSION_SECRET', {
        devFallback: 'edu_cms_dev_only_session_secret_CHANGE_FOR_PROD',
      }),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // true over HTTPS
        sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'strict' as const, // 'none' needed for cross-origin (Vercel→Railway)
        maxAge: 15 * 60 * 1000, // 15 mins (Aligns with short-lived tokens requirement)
      },
      name: 'edu_cms_sid',
    }),
  );

  // Mandatory: CORS limited to tenant portals in production
  //
  // sec-fix(wave1) #8: in production we refuse to boot without an explicit
  // ALLOWED_ORIGINS allowlist. Previously we silently fell through to a
  // wildcard that accepted any *.vercel.app — which means anybody could
  // host a malicious page on a throwaway Vercel project and make
  // authenticated cross-origin requests against our API. Fail-closed now.
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
    throw new Error(
      '[security] refusing to start: ALLOWED_ORIGINS is not set in production. Set a comma-separated list of allowed frontend origins (e.g. https://app.educms.com).',
    );
  }
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
      : (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
          // DEV ONLY: allow localhost, LAN, and tunnel origins. Production
          // never reaches this branch — we threw above if ALLOWED_ORIGINS
          // wasn't set.
          if (
            !origin ||
            origin.startsWith('http://localhost') ||
            origin.startsWith('http://192.168.') ||
            origin.startsWith('http://10.') ||
            origin.startsWith('http://172.') ||
            origin.endsWith('.trycloudflare.com') ||
            origin.endsWith('.ngrok-free.app') ||
            origin.endsWith('.ngrok.io') ||
            origin.endsWith('.vercel.app')
          ) {
            callback(null, true);
          } else {
            callback(new Error('Not allowed by CORS'));
          }
        },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-CSRF-Token'],
  });

  // Enable graceful shutdown — Railway sends SIGTERM on redeploy; without this,
  // in-flight requests are truncated and the next deploy races a half-dead pod.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`API listening on 0.0.0.0:${port}`);

  // Warm the Prisma connection pool before declaring the container ready.
  // Supabase pgbouncer + cold Prisma client can add 1.5s to the first query;
  // doing this here keeps the first real user request fast and surfaces any
  // DATABASE_URL misconfiguration in the boot log instead of a 500 later.
  try {
    const prisma = app.get(PrismaService);
    const t0 = Date.now();
    await prisma.client.$queryRaw`SELECT 1`;
    logger.log(`Prisma pool warm (${Date.now() - t0}ms)`);

    // Reconcile system presets — creates any preset defined in code that
    // doesn't have a matching DB row yet. Non-blocking background work so
    // the container is ready-to-serve before the seed finishes.
    ensureSystemPresets(prisma).catch((e) =>
      logger.warn(`ensureSystemPresets threw: ${(e as Error).message}`),
    );
  } catch (e) {
    logger.warn(`Prisma warm-up failed (continuing anyway): ${(e as Error).message}`);
  }
}
bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[bootstrap] fatal', err);
  process.exit(1);
});
