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
import { backfillManagedAssetHashes } from './maintenance/backfill-asset-hashes';
import { requireSecret, assertRequiredSecretsAtBoot } from './security/required-secret';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { RedisService } from './realtime/redis.service';
import {
  SessionRedisClient,
  createRedisSessionStore,
} from './security/redis-session.store';

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
const compression = require('compression');

async function bootstrap() {
  // Launch-readiness S14: validate ALL load-bearing secrets up front so a
  // prod deploy missing DEVICE_JWT_SECRET / DEVICE_SECRET_KEY fails at boot
  // (before the healthcheck passes) instead of 500'ing every device/WS call
  // later. In dev/test each missing secret just warns.
  assertRequiredSecretsAtBoot();

  // rawBody: true exposes req.rawBody (a Buffer) alongside the parsed
  // body — required for Stripe webhook signature verification. Purely
  // additive; req.body is unchanged for every other route.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useWebSocketAdapter(new WsAdapter(app));

  // 2026-04-28 (Server audit P0) — trust the Railway edge proxy so
  // req.ip comes from X-Forwarded-For instead of the proxy's own
  // 10.x.x.x address. Without this, every @Throttle decorator on
  // a public endpoint degrades from per-IP to GLOBAL — meaning the
  // OTA state-report throttle (30/min) caps the ENTIRE FLEET at
  // 30 reports/min instead of 30 reports/min PER kiosk. With 50
  // kiosks reporting 5 phases each on a synchronized boot, the
  // cap trips after the first 6 reports and the rest of the fleet
  // gets 429s mid-install. Same problem hits anomaly middleware,
  // Screen.ipAddress logging for forensics, etc.
  // Trust ONE proxy hop (Railway's edge) — anything more invites
  // X-Forwarded-For spoofing.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Global exception filter — normalizes all error responses, scrubs
  // stack traces in prod, and captures 5xx to Sentry with route tags.
  // Registered BEFORE listen so it catches startup-adjacent errors too.
  app.useGlobalFilters(new AllExceptionsFilter());

  // 2026-05-27 — bump default body-parser limit from 100 KB to 5 MB.
  // The default rejected POST /api/v1/bugs the moment the bug
  // reporter started actually capturing screenshots (html-to-image
  // commit e14eff6 fixed the silent-fail-on-oklch issue, so payloads
  // grew from ~5 KB to 1-3 MB). Logged as
  //   [POST /api/v1/bugs] 500 INTERNAL_ERROR: request entity too large
  // The frontend already caps screenshot at BUG_SCREENSHOT_MAX_BYTES
  // (2 MB) + capturedContext at 512 KB, so 5 MB is the right server-
  // side ceiling. Per-endpoint validation in BugsController re-checks
  // both caps after parse, so this just lets the request reach the
  // controller instead of dying at the body parser. eslint-disable
  // for the require — express's types are awkward to import alongside
  // NestFactory and a require keeps this delta minimal.
  //
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expressBody = require('express');

  // Stripe webhook MUST verify the signature against the EXACT raw bytes.
  // The `{ rawBody: true }` flag on NestFactory.create populates
  // req.rawBody ONLY for parsers Nest itself registers — but the global
  // expressBody.json() below is registered here, during bootstrap, and so
  // runs BEFORE Nest's parsers (which register at app.init()/listen()).
  // express's json() reads the stream to completion and sets req._body,
  // so Nest's rawBody-capturing parser short-circuits and req.rawBody is
  // never set → constructWebhookEvent throws and EVERY webhook 400s the
  // moment Stripe goes live. Mount a path-scoped raw parser for JUST the
  // webhook route, BEFORE the global json(), and capture the exact bytes
  // via verify(). Deterministic regardless of Nest's parser ordering;
  // every other route still hits the global json() below unchanged.
  app.use(
    '/api/v1/billing/webhook',
    expressBody.raw({
      type: '*/*',
      limit: '1mb',
      verify: (req: any, _res: unknown, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );

  // Square POS webhook (2026-07-03 fix) — same problem, same fix as Stripe
  // above: Square signs the EXACT bytes it POSTed (HMAC over
  // notificationUrl + rawBody), and any parse→re-serialize round-trip is
  // NOT guaranteed byte-identical (non-ASCII item names, Square's own
  // key-order/whitespace/escaping), so verifying against
  // JSON.stringify(req.body) intermittently — and for many real payloads,
  // reliably — fails timingSafeEqual and 401s a legitimate event. Mount a
  // path-scoped raw parser for JUST the static `webhook/square` route,
  // mirroring the Stripe mount exactly. Deliberately scoped to this one
  // path (not `/api/v1/pos/webhook` broadly) so the sibling
  // `webhook/:providerId` route (`custom-webhook`, the bring-your-own-POS
  // escape hatch) keeps getting the normal parsed-JSON `req.body` its
  // handler relies on — untouched, unregressed.
  app.use(
    '/api/v1/pos/webhook/square',
    expressBody.raw({
      type: '*/*',
      limit: '1mb',
      verify: (req: any, _res: unknown, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );

  // Unified player telemetry (2026-09-02, efficiency program P0-1). The
  // global limit below is 5 MB because the bug reporter ships screenshots;
  // the fleet's once-a-minute telemetry POST is ~600 bytes and must NOT
  // inherit that ceiling. Mounted here, BEFORE the global json(), so an
  // oversized body is refused by the parser — never buffered to 5 MB and
  // then rejected in the handler. Same ordering mechanic as the Stripe and
  // Square mounts above (express's json() sets req._body, so whichever
  // parser runs first wins). A RegExp because the path carries a screen id.
  // The controller re-checks Content-Length as an in-handler backstop for a
  // chunked request that declares no length.
  app.use(
    /^\/api\/v1\/screens\/[^/]+\/telemetry\/?$/,
    expressBody.json({ limit: '32kb' }),
  );

  app.use(expressBody.json({ limit: '5mb' }));
  app.use(expressBody.urlencoded({ limit: '5mb', extended: true }));

  // 2026-07-02 efficiency #1 — gzip every JSON response over 1KB (board
  // polls, manifests, template lists ship 3-6x smaller). Asset bytes never
  // transit this API (they ride Supabase/CDN), so there's no
  // double-compression risk.
  app.use(compression({ threshold: 1024 }));

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

  // ── Session store (2026-09-02 multi-replica wave) ──────────────────
  //
  // express-session's DEFAULT store is an in-process Map: sessions die on
  // every redeploy and do not exist on a second replica. Both live consumers
  // are mid-flight cross-origin redirects that can land on either replica —
  // SSO OIDC state/nonce (sso.controller.ts) and the Clever OAuth nonce
  // mirror for browsers that block the third-party cookie
  // (clever.controller.ts) — so the memory store is exactly the wrong shape
  // for them. CSRF does not use the session (double-submit cookie), so
  // mutation protection is unaffected either way.
  //
  // Redis present → the shared store below, same cookie flags, TTL mirrored
  // from the cookie's maxAge so `rolling: true` slides both together.
  // Redis absent (local dev, a Railway deploy with no Redis plugin) →
  // DOCUMENTED FALLBACK to the in-memory store, i.e. today's behaviour, with
  // a loud line in the boot log. The API must still boot without Redis
  // (CLAUDE.md: "Redis missing → API boots anyway").
  //
  // Everything here is wrapped so that NO failure to build the store can stop
  // the API booting — a session store is not worth a crashloop.
  const bootLogger = new Logger('Bootstrap');
  const sessionStore = ((): object | undefined => {
    if (!process.env.REDIS_URL || process.env.REDIS_DISABLED === 'true') return undefined;
    try {
      const redisService = app.get(RedisService, { strict: false });
      if (!redisService || typeof session.Store !== 'function') return undefined;
      return createRedisSessionStore(
        session.Store,
        // Resolved per call, never captured: RedisService connects during
        // app.init(), which happens after this middleware is installed.
        () => (redisService.publisher as unknown as SessionRedisClient | null),
      );
    } catch (err) {
      bootLogger.warn(
        `Redis session store unavailable (${err instanceof Error ? err.message : err}) — ` +
          'falling back to the in-process memory store',
      );
      return undefined;
    }
  })();
  if (sessionStore) {
    bootLogger.log('Sessions are stored in Redis (shared across replicas, survive restarts)');
  } else {
    bootLogger.warn(
      'Sessions are using the in-process memory store. They will not survive a restart and ' +
        'CANNOT be shared across replicas — fine for local dev and a single instance, not for ' +
        'a horizontally scaled deploy. Set REDIS_URL to fix.',
    );
  }

  // Manadatory: Secure cookie strategy & session mechanics
  app.use(
    session({
      ...(sessionStore ? { store: sessionStore } : {}),
      // sec-fix(wave1) #2: throws at boot in prod if SESSION_SECRET is unset.
      secret: requireSecret('SESSION_SECRET', {
        devFallback: 'edu_cms_dev_only_session_secret_CHANGE_FOR_PROD',
      }),
      resave: false,
      saveUninitialized: false,
      // Rolling session: every authenticated request bumps the
      // cookie's expiry, so an active user never sees a surprise
      // logout while working. Previously the cookie had a flat 15min
      // TTL — users who clicked "Remember me" (which only extends the
      // JWT) still got CSRF-bearing 403s on mutations 15 minutes in
      // because the session cookie was gone. Inactive users still
      // time out (per the cookie maxAge below) which is the real
      // security guarantee we want.
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // true over HTTPS
        sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'strict' as const, // 'none' needed for cross-origin (Vercel→Railway)
        // 8h idle timeout — covers a typical school workday. Combined
        // with rolling:true, an active session stays alive all day;
        // leaving the tab idle 8h closes it.
        maxAge: 8 * 60 * 60 * 1000,
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

  // Lane-4 P0 fix: validate DATABASE_URL has a sane pool config. Memory:
  // "`connection_limit=1` was the silent killer" — Prisma's default with
  // `pgbouncer=true` is 1 connection, which causes every concurrent request
  // to time out fetching from the pool. We require `connection_limit>=10`
  // and `pool_timeout>=20` whenever `pgbouncer=true` is on (the typical
  // Supabase pooled setup).
  if (process.env.NODE_ENV === 'production') {
    const url = process.env.DATABASE_URL || '';
    if (!url) {
      throw new Error('[security] refusing to start: DATABASE_URL is not set.');
    }
    const usesPgBouncer = /[?&]pgbouncer=true\b/.test(url);
    if (usesPgBouncer) {
      const climMatch = url.match(/[?&]connection_limit=(\d+)/);
      const ptoMatch = url.match(/[?&]pool_timeout=(\d+)/);
      const clim = climMatch ? Number(climMatch[1]) : null;
      const pto = ptoMatch ? Number(ptoMatch[1]) : null;
      if (clim == null || clim < 10) {
        throw new Error(
          `[security] refusing to start: DATABASE_URL has pgbouncer=true without connection_limit>=10 (got ${clim ?? 'unset'}). Append &connection_limit=10&pool_timeout=20.`,
        );
      }
      if (pto == null || pto < 20) {
        throw new Error(
          `[security] refusing to start: DATABASE_URL has pgbouncer=true without pool_timeout>=20 (got ${pto ?? 'unset'}). Append &pool_timeout=20.`,
        );
      }
    }
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
    // If-None-Match: the player's conditional manifest poll (efficiency #2).
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-CSRF-Token', 'If-None-Match'],
    // ETag is not a CORS-safelisted response header — without this the
    // player's cross-origin fetch can't read it and every poll stays a 200.
    // X-Server-Time rides the sports-board conditional poll (a 304 has no
    // body, so the fresh clock sample travels in the header).
    exposedHeaders: ['ETag', 'X-Server-Time'],
    // Cache the CORS preflight. If-None-Match is a non-safelisted request
    // header, so Chromium preflights the conditional poll — without maxAge it
    // re-preflights constantly and every poll costs two requests.
    maxAge: 3600,
  });

  // Enable graceful shutdown — Railway sends SIGTERM on redeploy; without this,
  // in-flight requests are truncated and the next deploy races a half-dead pod.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port, '0.0.0.0');

  // ── HTTP keep-alive (P0-7 load test, 2026-09-04) ─────────────────────────
  //
  // Node's default `server.keepAliveTimeout` is 5 s. The player's HEALTHY
  // emergency-revision poll is 10 s (`apps/web/src/app/player/emergencyRev.ts`
  // REV_POLL_HEALTHY_MS), and its reconcile is 60 s — so EVERY routine player
  // request is sent on a connection this server has already decided to close.
  // The client's socket pool usually notices the FIN first, but a fraction of
  // requests lose that race and come back ECONNRESET.
  //
  // Measured on the 1,000-screen load test before this change: 7 of 9,870
  // requests (0.071 %) in a 75 s window, at every fleet size — and one of the
  // casualties was an operator's `POST /screens/:id/revoke-credential`, i.e. a
  // life-safety kill switch failing with a transport error and no retry.
  // Reproduced deterministically with one client and no load: a request on a
  // keep-alive socket idle for 6 s resets; idle for 3 s does not.
  //
  // A player transport failure is counted as a REAL failure (player
  // reliability rule 2) and feeds the counters behind nativeReload, so this is
  // not merely cosmetic.
  //
  // The value must exceed BOTH the player's slowest routine poll AND any
  // upstream proxy's idle timeout (Railway's edge), because the classic 502
  // in this shape is a proxy holding a connection the origin has already
  // closed. `headersTimeout` must stay strictly greater than
  // `keepAliveTimeout` or Node will not honour the latter.
  const httpServer = app.getHttpServer();
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;

  const logger = new Logger('Bootstrap');
  logger.log(
    `API listening on 0.0.0.0:${port} (keepAliveTimeout=${httpServer.keepAliveTimeout}ms)`,
  );

  // Warm the Prisma connection pool before declaring the container ready.
  // Supabase pgbouncer + cold Prisma client can add 1.5s to the first query;
  // doing this here keeps the first real user request fast and surfaces any
  // DATABASE_URL misconfiguration in the boot log instead of a 500 later.
  try {
    const prisma = app.get(PrismaService);
    const t0 = Date.now();
    await prisma.client.$queryRaw`SELECT 1`;
    logger.log(`Prisma pool warm (${Date.now() - t0}ms)`);

    // ─── Boot-time schema safety net ───────────────────────────
    // Railway's start command (`node apps/api/dist/main.js`) doesn't
    // run `prisma migrate deploy`, so new columns added to the
    // schema + regenerated into the client arrive in prod WITHOUT
    // a corresponding DB alter. First request to a table then hits
    // "column does not exist" and bubbles up as HTTP 500. Reported
    // by the Integration Lead right after the APK version-chip roll
    // ("update pushed but I get http 500 and reconnect does
    // nothing").
    //
    // We run idempotent ALTER TABLE IF NOT EXISTS for any columns
    // that postdate the last full migration. Pure SQL, safe to run
    // every boot. Keep this list short and retire entries once
    // we've verified the matching migration has made it through
    // every environment — this is a seatbelt, not a migration
    // replacement.
    try {
      await prisma.client.$executeRawUnsafe(
        // 2026-04-24 — APK version reporting. See migration
        // 20260424_add_screen_player_version.
        `ALTER TABLE "screens"
          ADD COLUMN IF NOT EXISTS "player_version" TEXT,
          ADD COLUMN IF NOT EXISTS "player_version_code" INTEGER,
          ADD COLUMN IF NOT EXISTS "player_version_at" TIMESTAMP(3);`,
      );
      logger.log('Schema safety net: screens.player_version* ensured');
    } catch (e) {
      // Don't block boot — log and keep going. Worst case any
      // endpoint that touches these columns 500s, which is the
      // state we were already in.
      logger.warn(`Schema safety net failed: ${(e as Error).message}`);
    }

    // Reconcile system presets — creates any preset defined in code that
    // doesn't have a matching DB row yet. Non-blocking background work so
    // the container is ready-to-serve before the seed finishes.
    ensureSystemPresets(prisma).catch((e) =>
      logger.warn(`ensureSystemPresets threw: ${(e as Error).message}`),
    );

    // 2026-06-06 (audit #6) — backfill SHA-256 for managed assets missing a
    // hash so the player can integrity-verify emergency / offline media that
    // pre-dates upload-time hashing. Background, best-effort, capped per boot;
    // never blocks boot and only writes Asset.fileHash (no emergency-path
    // logic touched). Disable with EMERGENCY_HASH_BACKFILL=off.
    backfillManagedAssetHashes(prisma, logger).catch((e) =>
      logger.warn(`asset hash backfill threw: ${(e as Error).message}`),
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
