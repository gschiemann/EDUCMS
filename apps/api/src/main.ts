import { config } from 'dotenv';
import { resolve } from 'path';

// Load env from apps/api/.env first, then fall back to monorepo root .env
config({ path: resolve(__dirname, '..', '.env') });
config({ path: resolve(__dirname, '..', '..', '..', '.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';

/* eslint-disable @typescript-eslint/no-var-requires */
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');

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
      secret: process.env.SESSION_SECRET || 'edu_cms_beta_session_secret_CHANGE_FOR_PROD',
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
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
          // In dev, allow localhost, LAN, and tunnel origins
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
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  await app.listen(process.env.PORT ?? 8080);
}
bootstrap();
