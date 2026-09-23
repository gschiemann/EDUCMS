import { PosService } from './pos.service';

function harness(stores: Array<{ id: string; name: string; locationTenantId: string | null }>, children: Array<{ id: string; name: string }>) {
  const client = {
    posLocation: { findMany: jest.fn().mockResolvedValue(stores), update: jest.fn().mockResolvedValue({}) },
    tenant: { findMany: jest.fn().mockResolvedValue(children) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(client)),
  };
  const service = new PosService({ client } as any, {} as any);
  return { client, service };
}

describe('Toast store auto mapping', () => {
  it('maps a sole Toast store to the sole location before catalog ingestion', async () => {
    const { client, service } = harness([{ id: 'store-1', name: 'Calvine', locationTenantId: null }], [{ id: 'location-1', name: 'Calvine' }]);
    await (service as any).autoMapToastLocations('account-1', 'connection-1', 'admin-1');
    expect(client.posLocation.update).toHaveBeenCalledWith({ where: { id: 'store-1', tenantId: 'account-1' }, data: { locationTenantId: 'location-1' } });
    expect(client.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('only maps uniquely named stores in a multi-location account', async () => {
    const { client, service } = harness([
      { id: 'store-1', name: 'Calvine', locationTenantId: null },
      { id: 'store-2', name: 'Unknown Store', locationTenantId: null },
    ], [{ id: 'location-1', name: 'Calvine' }, { id: 'location-2', name: 'Laguna Blvd' }]);
    await (service as any).autoMapToastLocations('account-1', 'connection-1', 'admin-1');
    expect(client.posLocation.update).toHaveBeenCalledTimes(1);
    expect(client.posLocation.update).toHaveBeenCalledWith({ where: { id: 'store-1', tenantId: 'account-1' }, data: { locationTenantId: 'location-1' } });
  });
});

describe('Toast manual store remapping', () => {
  it('clears the old Toast price, audits the move, and refreshes the new location immediately', async () => {
    const client: any = {
      posLocation: {
        findFirst: jest.fn().mockResolvedValueOnce({ id: 'store-1', locationTenantId: 'old-location' }).mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValue({ id: 'store-1', locationTenantId: 'new-location' }),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 'new-location', parentId: 'account-1' }) },
      posProviderConnection: { findFirst: jest.fn().mockResolvedValue({ id: 'connection-1', providerId: 'toast' }) },
      menuCatalog: { findFirst: jest.fn().mockResolvedValue({ id: 'catalog-1' }) },
      menuItem: { findMany: jest.fn().mockResolvedValue([{ id: 'item-1' }]) },
      menuLocationOverride: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    client.$transaction = jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(client));
    const service = new PosService({ client } as any, {} as any);
    jest.spyOn(service, 'syncConnection').mockResolvedValue({ status: 'ok', itemCount: 1, categoryCount: 1, message: 'ok' });
    await service.mapConnectionLocation('account-1', 'connection-1', 'store-1', 'new-location', 'admin-1');
    expect(client.menuLocationOverride.deleteMany).toHaveBeenCalledWith({ where: {
      tenantId: 'account-1', locationTenantId: 'old-location', source: 'toast', menuItemId: { in: ['item-1'] },
    } });
    expect(client.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'POS_LOCATION_MAPPED', targetId: 'store-1' }) }));
    expect(service.syncConnection).toHaveBeenCalledTimes(1);
  });
});
