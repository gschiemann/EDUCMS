/**
 * Tests for GET /screens/:id/menu — device-authed per-location menu read
 * (menu-mgmt-at-scale, 2026-05-29).
 *
 * This is the Tier-0 unblock: before this endpoint, MenuBoardWidget on a
 * real kiosk fetched the SESSION-authed /api/v1/pos/items with a token
 * the player never has → 403 → hardcoded DEMO_ITEMS. The new endpoint
 * accepts a DEVICE token (same `verifyDeviceForScreen` model as
 * /:id/manifest + /:id/emergency-assets) and returns the screen's
 * location-resolved menu.
 *
 * Asserted behaviours:
 *   1. A valid device JWT bound to the screenId returns the resolved menu.
 *   2. A device token for a DIFFERENT screen is rejected (subject mismatch)
 *      — a stolen token can't read another screen's menu.
 *   3. A SESSION (non-device) JWT is rejected (wrong token kind) — the
 *      exact failure that sent the widget to DEMO_ITEMS before.
 *   4. No auth → 401.
 *   5. Location resolution: the screen's posLocation.locationTenantId wins
 *      as the override location; the location-tenant's parent is the
 *      catalog-owning chain tenant.
 */
import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';

function deviceToken(screenId: string): string {
  return jwt.sign({ sub: screenId, kind: 'device', fp: 'fp-test' }, DEVICE_JWT_SECRET, { expiresIn: '365d' });
}
function sessionToken(screenId: string): string {
  // A normal user/session JWT — kind is NOT 'device'.
  return jwt.sign({ sub: 'user-1', kind: 'session', tenantId: 't' }, DEVICE_JWT_SECRET, { expiresIn: '1h' });
}
function reqWithBearer(token: string) {
  return { headers: { authorization: `Bearer ${token}` }, ip: '10.0.0.1', socket: { remoteAddress: '10.0.0.1' } } as any;
}

const mockPrisma: any = {
  client: { screen: { findUnique: jest.fn() } },
};
const mockRedis: any = { publish: jest.fn() };
const mockSigner: any = { signMessage: jest.fn() };
const mockLicense: any = {};
const mockStripe: any = {};
const mockMenu: any = { resolveMenuForLocation: jest.fn() };

let controller: ScreensController;

beforeEach(() => {
  jest.clearAllMocks();
  controller = new ScreensController(mockPrisma, mockRedis, mockSigner, mockLicense, mockStripe, mockMenu);
  mockMenu.resolveMenuForLocation.mockResolvedValue({
    locationTenantId: 'loc-A',
    generatedAt: '2026-05-29T12:00:00.000Z',
    sourceConfigured: true,
    categories: [{ id: 'c1', name: 'Mains', sortOrder: 0, daypartId: null }],
    items: [
      { id: 'i1', externalId: 'burger', name: 'Burger', description: 'tasty', priceCents: 949, priceOverridden: true, imageUrl: null, allergens: ['GF'], tags: ['popular'], category: 'Mains', categoryId: 'c1', sortOrder: 0, available: true, soldOut: false },
    ],
  });
});

it('returns the resolved menu for a valid device token bound to the screen', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue({
    tenantId: 'loc-A',
    posLocationId: null,
    posLocation: null,
    tenant: { id: 'loc-A', parentId: 'chain-1' },
  });

  const res: any = await controller.getMenu('screen-1', reqWithBearer(deviceToken('screen-1')));

  expect(res.screenId).toBe('screen-1');
  expect(res.locationTenantId).toBe('loc-A');
  expect(res.sourceConfigured).toBe(true);
  expect(res.items).toHaveLength(1);
  expect(res.items[0]).toMatchObject({ name: 'Burger', priceCents: 949, priceOverridden: true });
  // badges = allergens + tags (the shape MenuBoardWidget reads).
  expect(res.items[0].badges).toEqual(['GF', 'popular']);
  expect(res.items[0].available).toBe(true);
});

it('resolves location = the screen tenant and chain = its parent when not POS-location-mapped', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue({
    tenantId: 'loc-A',
    posLocationId: null,
    posLocation: null,
    tenant: { id: 'loc-A', parentId: 'chain-1' },
  });
  await controller.getMenu('screen-1', reqWithBearer(deviceToken('screen-1')));
  expect(mockMenu.resolveMenuForLocation).toHaveBeenCalledWith('loc-A', expect.objectContaining({ catalogTenantId: 'chain-1' }));
});

it('prefers posLocation.locationTenantId as the resolution location when mapped', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue({
    tenantId: 'loc-A',
    posLocationId: 'pl-1',
    posLocation: { locationTenantId: 'loc-store-4' },
    tenant: { id: 'loc-A', parentId: 'chain-1' },
  });
  await controller.getMenu('screen-1', reqWithBearer(deviceToken('screen-1')));
  // location = the mapped store; chain = the screen-tenant's parent.
  expect(mockMenu.resolveMenuForLocation).toHaveBeenCalledWith('loc-store-4', expect.objectContaining({ catalogTenantId: 'chain-1' }));
});

it('uses the location tenant itself as the chain when it has no parent (single-location operator)', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue({
    tenantId: 'solo',
    posLocationId: null,
    posLocation: null,
    tenant: { id: 'solo', parentId: null },
  });
  await controller.getMenu('screen-1', reqWithBearer(deviceToken('screen-1')));
  expect(mockMenu.resolveMenuForLocation).toHaveBeenCalledWith('solo', expect.objectContaining({ catalogTenantId: 'solo' }));
});

it('rejects a device token issued for a DIFFERENT screen (no cross-screen reads)', async () => {
  await expect(
    controller.getMenu('screen-1', reqWithBearer(deviceToken('screen-OTHER'))),
  ).rejects.toThrow(/Device auth required/);
  expect(mockPrisma.client.screen.findUnique).not.toHaveBeenCalled();
  expect(mockMenu.resolveMenuForLocation).not.toHaveBeenCalled();
});

it('rejects a SESSION (non-device) JWT — the exact 403 path the widget hit before', async () => {
  await expect(
    controller.getMenu('screen-1', reqWithBearer(sessionToken('screen-1'))),
  ).rejects.toThrow(/Device auth required/);
  expect(mockMenu.resolveMenuForLocation).not.toHaveBeenCalled();
});

it('401s with no auth header', async () => {
  await expect(controller.getMenu('screen-1', { headers: {} } as any)).rejects.toThrow(/Device auth required/);
});

it('404s when the screen is unknown / unpaired', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue(null);
  await expect(
    controller.getMenu('screen-1', reqWithBearer(deviceToken('screen-1'))),
  ).rejects.toThrow(/not found or not paired/);
});
