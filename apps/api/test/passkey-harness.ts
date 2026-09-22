/**
 * Shared harness for the passkey specs.
 *
 * The Prisma double is STATEFUL on purpose. These flows are sequences —
 * register, then list, then rename, then delete; register eleven times and
 * expect the eleventh to be refused; delete the last factor and expect a
 * refusal that depends on how many rows are left. A `findUnique` that returns
 * a fixed fixture cannot express any of that, and a cap test written against
 * one would pass whether or not the cap exists.
 *
 * What it does NOT model is Prisma's `select` / `include` projection: reads
 * return the whole row plus the relation counts. That is the same shortcut
 * `mfa.controller.spec.ts` takes, and it has the same known cost — these
 * specs cannot catch a forgotten `select` field. The typed-required keys on
 * `assertEnrollmentRequired` and `MfaPolicyOptions` are what catch those, at
 * compile time, which is the better place for it.
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { PasskeyController } from '../src/auth/passkey.controller';
import { MfaController } from '../src/auth/mfa.controller';
import { MfaRateLimiter } from '../src/auth/mfa-rate-limiter';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/realtime/redis.service';
import { cryptoPlatformConfig } from '../src/auth/crypto.config';

export const TEST_ORIGIN = 'https://app.venueos.example';
export const TEST_RP_ID = 'app.venueos.example';
/** Not a credential: a fixed string the specs hash with the real argon2id. */
export const TEST_PASSWORD = 'correct-horse-battery-staple';

export interface FakeUser {
  id: string;
  email: string;
  tenantId: string;
  role: string;
  canTriggerPanic: boolean;
  mfaRequired: boolean;
  mfaTotpSecret: string | null;
  mfaTotpVerifiedAt: Date | null;
  mfaBackupCodes: unknown;
  passwordHash: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  deletedAt: Date | null;
  mustSetupCredentials: boolean;
  tenant: { mfaEnforced: boolean | null; archivedAt: Date | null } | null;
}

export interface FakePasskey {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Buffer;
  counter: bigint;
  transports: string[];
  deviceLabel: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface Harness {
  controller: PasskeyController;
  mfa: MfaController;
  rateLimiter: MfaRateLimiter;
  auth: { login: jest.Mock };
  jwt: { sign: jest.Mock; signAsync: jest.Mock; verifyAsync: jest.Mock };
  users: Map<string, FakeUser>;
  passkeys: FakePasskey[];
  audits: Array<{
    action: string;
    tenantId: string;
    userId?: string;
    details: string;
  }>;
  /** An Express-ish request carrying a session principal and an Origin. */
  req(opts?: {
    userId?: string | null;
    origin?: string | null;
    kind?: string;
  }): any;
  /** Resolve the audit actions written so far, newest last. */
  auditActions(): string[];
  /** Parse one audit row's details JSON. */
  auditDetails(action: string): Record<string, unknown> | null;
}

let passkeySeq = 0;

export async function buildHarness(seedUsers: FakeUser[]): Promise<Harness> {
  const users = new Map<string, FakeUser>(seedUsers.map((u) => [u.id, u]));
  const passkeys: FakePasskey[] = [];
  const audits: Harness['audits'] = [];

  const countFor = (userId: string) =>
    passkeys.filter((p) => p.userId === userId).length;

  /** Attach the relation shapes every read in the controllers expects. */
  const project = (u: FakeUser | undefined) =>
    u
      ? {
          ...u,
          _count: { passkeys: countFor(u.id) },
          passkeys: passkeys.filter((p) => p.userId === u.id),
        }
      : null;

  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => row[k] === v);

  const prisma = {
    client: {
      /**
       * Interactive-transaction shim. The forced-enrollment passkey route
       * writes the credential and the backup codes inside one
       * `$transaction(async (tx) => …)`, because a passkey that exists
       * without its recovery codes is the lockout the feature exists to
       * prevent.
       *
       * The double runs the callback against the same client, so it is NOT
       * atomic — it proves the callback's CONTENTS and their order, not
       * Postgres's rollback. A `tx` handed the real client is the honest
       * shape of that limitation: the specs can assert both writes happened
       * and neither can claim the rollback was tested.
       */
      $transaction: jest.fn(async (arg: any) =>
        typeof arg === 'function'
          ? arg(prisma.client)
          : Promise.all(arg as Promise<unknown>[]),
      ),
      user: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where?.id) return project(users.get(where.id));
          if (where?.email) {
            return project(
              [...users.values()].find((u) => u.email === where.email),
            );
          }
          return null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const u = users.get(where.id);
          if (!u) throw new Error('user not found');
          Object.assign(u, data);
          return project(u);
        }),
      },
      passkey: {
        findMany: jest.fn(async ({ where }: any) =>
          passkeys.filter((p) => matches(p, where)),
        ),
        findFirst: jest.fn(
          async ({ where }: any) =>
            passkeys.find((p) => matches(p, where)) ?? null,
        ),
        findUnique: jest.fn(
          async ({ where }: any) =>
            passkeys.find((p) => matches(p, where)) ?? null,
        ),
        count: jest.fn(
          async ({ where }: any) =>
            passkeys.filter((p) => matches(p, where)).length,
        ),
        create: jest.fn(async ({ data }: any) => {
          if (passkeys.some((p) => p.credentialId === data.credentialId)) {
            // Model the unique constraint — the controller maps P2002 to 409.
            throw Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
            });
          }
          const row: FakePasskey = {
            id: `pk-${++passkeySeq}`,
            userId: data.userId,
            credentialId: data.credentialId,
            publicKey: Buffer.from(data.publicKey),
            counter: BigInt(data.counter ?? 0),
            transports: data.transports ?? [],
            deviceLabel: data.deviceLabel ?? null,
            createdAt: new Date('2026-09-21T00:00:00.000Z'),
            lastUsedAt: null,
          };
          passkeys.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = passkeys.find((p) => p.id === where.id);
          if (!row) throw new Error('passkey not found');
          Object.assign(row, data);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const hits = passkeys.filter((p) => matches(p, where));
          hits.forEach((p) => Object.assign(p, data));
          return { count: hits.length };
        }),
        deleteMany: jest.fn(async ({ where }: any) => {
          const hits = passkeys.filter((p) => matches(p, where));
          for (const h of hits) passkeys.splice(passkeys.indexOf(h), 1);
          return { count: hits.length };
        }),
      },
      auditLog: {
        create: jest.fn(async ({ data }: any) => {
          audits.push(data);
          return data;
        }),
      },
    },
  };

  const jwt = {
    sign: jest.fn().mockReturnValue('signed-token'),
    signAsync: jest.fn().mockResolvedValue('signed-token'),
    verifyAsync: jest.fn(),
  };
  const auth = {
    login: jest
      .fn()
      .mockResolvedValue({ access_token: 'final-jwt', user: { id: 'user-1' } }),
    // The real thing for the couple of specs that exercise it.
    verifyPassword: jest.fn(),
  };
  // No Redis in the suite — the challenge store falls back to its memory
  // backend, which the store spec covers in its own right.
  const redis = { publisher: null };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PasskeyController,
      MfaController,
      MfaRateLimiter,
      { provide: PrismaService, useValue: prisma },
      { provide: JwtService, useValue: jwt },
      { provide: AuthService, useValue: auth },
      { provide: RedisService, useValue: redis },
    ],
  }).compile();

  return {
    controller: module.get(PasskeyController),
    mfa: module.get(MfaController),
    rateLimiter: module.get(MfaRateLimiter),
    auth: auth as any,
    jwt: jwt as any,
    users,
    passkeys,
    audits,
    req: ({ userId = 'user-1', origin = TEST_ORIGIN, kind }: any = {}) => ({
      user: userId
        ? { id: userId, userId, ...(kind ? { kind } : {}) }
        : undefined,
      headers: origin ? { origin } : {},
    }),
    auditActions: () => audits.map((a) => a.action),
    auditDetails: (action: string) => {
      const row = [...audits].reverse().find((a) => a.action === action);
      return row ? JSON.parse(row.details) : null;
    },
  };
}

/** A real argon2id hash of {@link TEST_PASSWORD}, computed once per suite. */
let cachedHash: string | null = null;
export async function testPasswordHash(): Promise<string> {
  if (!cachedHash) {
    cachedHash = await argon2.hash(TEST_PASSWORD, {
      type: cryptoPlatformConfig.type,
      memoryCost: cryptoPlatformConfig.memoryCost,
      timeCost: cryptoPlatformConfig.timeCost,
      parallelism: cryptoPlatformConfig.parallelism,
    });
  }
  return cachedHash;
}

export async function makeUser(
  overrides: Partial<FakeUser> = {},
): Promise<FakeUser> {
  return {
    id: 'user-1',
    email: 'operator@example.test',
    tenantId: 'tenant-1',
    // SCHOOL_ADMIN + an enforcing tenant is the STRICT default: the suite
    // pins `MFA_REQUIRED_ENFORCE_AFTER=now` (see test/jest.setup.ts), so such
    // an account is blocking-required unless it holds a factor. A laxer
    // default would hide exactly the regressions these specs exist to catch.
    role: 'SCHOOL_ADMIN',
    canTriggerPanic: false,
    mfaRequired: false,
    mfaTotpSecret: null,
    mfaTotpVerifiedAt: null,
    mfaBackupCodes: null,
    passwordHash: await testPasswordHash(),
    firstName: 'Test',
    lastName: 'Operator',
    status: 'ACTIVE',
    deletedAt: null,
    mustSetupCredentials: false,
    tenant: { mfaEnforced: true, archivedAt: null },
    ...overrides,
  };
}

/** The ceremony coordinates the soft authenticator signs against. */
export const CEREMONY = { origin: TEST_ORIGIN, rpID: TEST_RP_ID };

/**
 * Point the RP resolver at {@link TEST_ORIGIN} for the duration of a suite,
 * under the PRODUCTION posture — so the specs exercise what the deploy
 * actually runs, including the refusal of http loopback.
 *
 * Pinning `NODE_ENV=production` has one consequence worth naming: it also
 * switches `required-secret.ts` out of its dev-fallback branch, so any secret
 * the exercised code reads has to exist or the read THROWS. The passkey and
 * MFA routes verify partial `mfaToken`s with `JWT_SECRET`, so the value below
 * is set for the same reason `mfa.controller.spec.ts` pins
 * `DEVICE_SECRET_KEY`: it is a fixed, published test constant, never a
 * credential, and it never leaves the suite.
 */
export function pinAllowedOrigins(): () => void {
  const prev = {
    allowed: process.env.ALLOWED_ORIGINS,
    nodeEnv: process.env.NODE_ENV,
    jwt: process.env.JWT_SECRET,
    device: process.env.DEVICE_SECRET_KEY,
  };
  process.env.ALLOWED_ORIGINS = TEST_ORIGIN;
  process.env.NODE_ENV = 'production';
  // 64 hex chars = 32 bytes. Pinned for reproducibility; test scope only.
  process.env.JWT_SECRET =
    process.env.JWT_SECRET ??
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.DEVICE_SECRET_KEY =
    process.env.DEVICE_SECRET_KEY ??
    'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
  return () => {
    process.env.ALLOWED_ORIGINS = prev.allowed;
    process.env.NODE_ENV = prev.nodeEnv;
    process.env.JWT_SECRET = prev.jwt;
    process.env.DEVICE_SECRET_KEY = prev.device;
  };
}
