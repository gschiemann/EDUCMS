/**
 * Panic phones (2026-11-14) — THE SCOPE BOUNDARY.
 *
 * A panic credential may do exactly two things: send an emergency the person
 * may send, and read what the panic page shows. It must never release an
 * alert (all-clear stays behind a full sign-in: "raise, never release"),
 * never reach the dashboard, never change anything else.
 *
 * That boundary is structural, and each of its three walls is pinned here:
 *
 *   1. ONE DOOR. `PanicDeviceController` is the only reader of the
 *      credential, and its route list is exactly enroll / status / targets /
 *      active / trigger / revoke. Its source never names a release or
 *      broadcast handler.
 *   2. NOT A JWT. Every other authenticated route in the API is behind
 *      `JwtAuthGuard`, which refuses the credential outright (it is an opaque
 *      `pd1.` string, not a signed token) — the all-clear routes included.
 *   3. NOBODY ELSE LOOKS. No file outside `emergency/panic-device/` hashes,
 *      shape-checks or authenticates a panic credential.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { EmergencyController } from '../emergency.controller';
import { ScreenEmergencyController } from '../screen-emergency.controller';
import { PanicDeviceController } from './panic-device.controller';
import { mintPanicCredential } from './panic-device.policy';

const API_SRC = path.resolve(__dirname, '..', '..');

function routesOf(controller: Function): Array<{ handler: string; method: string; path: string }> {
  const proto = controller.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && Reflect.hasMetadata(PATH_METADATA, proto[name]))
    .map((name) => ({
      handler: name,
      method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, proto[name])],
      path: Reflect.getMetadata(PATH_METADATA, proto[name]),
    }));
}

describe('wall 1 — one door, six routes, none of them a release', () => {
  it('the panic controller’s routes are exactly these', () => {
    expect(routesOf(PanicDeviceController).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { handler: 'active', method: 'POST', path: 'active' },
      { handler: 'enroll', method: 'POST', path: 'enroll' },
      { handler: 'revoke', method: 'POST', path: 'revoke' },
      { handler: 'status', method: 'POST', path: 'status' },
      { handler: 'targets', method: 'POST', path: 'targets' },
      { handler: 'trigger', method: 'POST', path: 'trigger' },
    ]);
  });

  it('its source never reaches a release, a broadcast, a media alert or a message all-clear', () => {
    const src = fs.readFileSync(path.join(__dirname, 'panic-device.controller.ts'), 'utf8');
    for (const forbidden of ['clearEmergency', 'clearMessage', 'broadcastText', 'mediaAlert', 'all-clear', 'triggerSos']) {
      expect(src).not.toContain(`.${forbidden}(`);
    }
    // The only emergency handlers it may name.
    const named = [...src.matchAll(/emergency\(\)\.(\w+)\(/g)].map((m) => m[1]).sort();
    expect([...new Set(named)]).toEqual(['activeAlerts', 'targets', 'triggerEmergency']);
  });

  it('the trigger body cannot name another organisation as "All screens" — the phone’s own tenant is always the tenant scope', () => {
    const src = fs.readFileSync(path.join(__dirname, 'panic-device.controller.ts'), 'utf8');
    expect(src).toMatch(/scopeId: body\.target \? body\.target\.scopeId : device\.tenantId/);
  });
});

describe('wall 2 — not a JWT: every JWT route refuses it, all-clear included', () => {
  const prevSecret = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'dev_only_jwt_secret_CHANGE_ME';
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
  });

  it('JwtAuthGuard answers 401 to a panic credential presented as a bearer token', async () => {
    const guard = new JwtAuthGuard(new JwtService({ secret: 'dev_only_jwt_secret_CHANGE_ME' }), {
      sismember: jest.fn(async () => false),
      getTokenInvalidBefore: jest.fn(async () => null),
    } as any);
    const credential = mintPanicCredential();
    const request: any = { method: 'POST', url: '/api/v1/emergency/ovr_1/all-clear', headers: { authorization: `Bearer ${credential}` } };
    const ctx: any = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => undefined, getClass: () => undefined };
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });

  it.each([
    [EmergencyController, 'clearEmergency'],
    [EmergencyController, 'clearMessage'],
    [EmergencyController, 'broadcastText'],
    [EmergencyController, 'mediaAlert'],
    [ScreenEmergencyController, 'allClear'],
  ])('%p.%s sits behind JwtAuthGuard', (controller: any, handler) => {
    const proto = controller.prototype;
    if (typeof proto[handler] !== 'function') {
      // Name drift must fail loudly, not pass silently.
      throw new Error(`${controller.name}.${handler} no longer exists — update this list`);
    }
    const guards = [
      ...(Reflect.getMetadata(GUARDS_METADATA, controller) ?? []),
      ...(Reflect.getMetadata(GUARDS_METADATA, proto[handler]) ?? []),
    ];
    expect(guards).toContain(JwtAuthGuard);
  });
});

describe('wall 3 — nobody else reads the credential', () => {
  it('no file outside emergency/panic-device/ hashes, shape-checks or authenticates one', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
          walk(abs);
        } else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) {
          if (abs.includes(`${path.sep}panic-device${path.sep}`)) continue;
          const text = fs.readFileSync(abs, 'utf8');
          if (/hashPanicCredential|isPanicCredentialShape|mintPanicCredential|devices?\.authenticate\(|panicDevices?\.authenticate\(/.test(text)) {
            offenders.push(path.relative(API_SRC, abs));
          }
        }
      }
    };
    walk(API_SRC);
    expect(offenders).toEqual([]);
  });
});
