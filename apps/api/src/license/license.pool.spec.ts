import { LicenseService } from './license.service';
import { assertPoolCapacity, customerTree } from './license-pool';
import { FakeDb } from '../customers/customer-console.fakedb-spec';

const tree = [
  { id: 'root', parentId: null, allocatedSeats: null, depth: 0 },
  { id: 'a', parentId: 'root', allocatedSeats: 3, depth: 1 },
  { id: 'b', parentId: 'root', allocatedSeats: null, depth: 1 },
];

describe('corporate reservations', () => {
  it('protects reserved seats from unallocated locations while allowing allocated locations to fill their reservation', () => {
    const usage = new Map([['a', 1], ['b', 2]]);
    expect(() => assertPoolCapacity(tree, usage, 5, 'b')).toThrow('corporate pool');
    expect(() => assertPoolCapacity(tree, usage, 5, 'a')).not.toThrow();
  });
  it('zero is an explicit allocation, null shares the unreserved pool', () => {
    expect(() => assertPoolCapacity([{ ...tree[1], allocatedSeats: 0 }], new Map(), 10, 'a')).toThrow('allocated screens');
    expect(() => assertPoolCapacity([{ ...tree[1], allocatedSeats: null }], new Map(), 10, 'a')).not.toThrow();
  });
  it('counts existing over-allocation usage rather than pretending reservations freed used seats', () => {
    expect(() => assertPoolCapacity(tree, new Map([['a', 7]]), 5)).toThrow('corporate pool');
  });
  it('rejects an unrelated pairing tenant', () => {
    expect(() => assertPoolCapacity(tree, new Map(), 5, 'foreign')).toThrow('Location not found');
  });
  it('finds arbitrarily nested descendants and detects cycles', async () => {
    const db = new FakeDb();
    db.addTenant({ id: 'root', name: 'Root' });
    for (let i = 0; i < 7; i++) db.addTenant({ id: `c${i}`, name: `C${i}`, parentId: i === 0 ? 'root' : `c${i - 1}` });
    expect((await customerTree(db.client, 'root')).map((t) => t.depth)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    db.s.tenants[0].parentId = 'c6';
    await expect(customerTree(db.client, 'root')).rejects.toThrow('cyclic');
  });
  it('enforces the root pool at the real pairing gate for a deeply nested location with no license', async () => {
    const db = new FakeDb();
    db.addTenant({ id: 'root', name: 'Root' });
    let parentId = 'root';
    for (let i = 0; i < 5; i++) { db.addTenant({ id: `c${i}`, name: `C${i}`, parentId }); parentId = `c${i}`; }
    db.addLicense({ tenantId: 'root', seatLimit: 1, pooledSeats: true });
    db.addScreens('c0', 1);
    const svc = new LicenseService({ client: db.client } as any);
    await expect(svc.assertSeatAvailable('c4', db.client)).rejects.toThrow('corporate pool');
    db.s.licenses[0].status = 'SUSPENDED';
    await expect(svc.assertSeatAvailable('c4', db.client)).rejects.toThrow('suspended');
  });
});
